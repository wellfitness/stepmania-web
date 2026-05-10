// ============================================================================
//  SONG SELECT — list/filter/sort songs, render diff screen with mods,
//  apply lane permutation modifiers (mirror/left/right/shuffle).
// ============================================================================

let selectedSong = null;
let selectedChart = null;
// solo/full are mutually exclusive lane-count overrides; randomFixed pins
// the redistribution to a per-song seed (vs full random each play).
const activeMods = { mirror:false, left:false, right:false, shuffle:false, hidden:false, sudden:false, solo:false, full:false, randomFixed:false, chartSpeed: 1.0 };
let _allSongsCache = [];

// ----- PLAYLIST SESSION STATE -----------------------------------------------
// `selectedSongIds` rastrea las canciones marcadas en la biblioteca (Set de
// IDs). Cuando size > 0 aparece la barra sticky con el CTA "Jugar todas".
//
// `playSession` es el estado de una sesión activa de reproducción continua:
//   { songs: [{songId, songData, chartKey, chartData}], difficultyKey,
//     index, scores: [{grade, accuracy, score}] }
// Cuando es null, el flow es "una canción a la vez" (modo clásico).
//
// `_visibleSongIds` es la lista de IDs filtrados/visibles tras aplicar los
// filtros de search/rating/grade/tag. Lo necesita el "select all" para
// operar solo sobre lo que el usuario VE, no sobre la librería entera.
const selectedSongIds = new Set();
let playSession = null;
let _sessionCountdownTimer = null;
let _visibleSongIds = [];

async function refreshSongs() {
  const songs = await dbAll();
  _allSongsCache = songs;
  document.getElementById('songsSubtitle').textContent = `${songs.length} canciones en tu librería`;
  // Attach best score to each song
  for (const s of songs) {
    const scores = await dbScoresForSong(s.id);
    s._bestGrade = scores.length ? scores.sort((a,b) => (b.score||0) - (a.score||0))[0] : null;
  }
  // Repopulate tag filter dropdown with the union of all tags
  const sel = document.getElementById('songFilterTag');
  if (sel) {
    const allTags = new Set();
    for (const s of songs) for (const t of (s.tags || [])) allTags.add(t);
    const current = sel.value;
    sel.innerHTML = '<option value="">Todos los tags</option>' +
      [...allTags].sort().map(t => `<option value="${escapeHtml(t)}">🏷 ${escapeHtml(t)}</option>`).join('');
    if ([...allTags].includes(current)) sel.value = current;
  }
  renderSongList();
}

function renderSongList() {
  const c = document.getElementById('songsContainer');
  if (!_allSongsCache.length) {
    c.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎵</div>
        <div class="empty-title">Tu biblioteca está vacía</div>
        <div class="empty-desc">Crea tu primera coreografía desde un MP3, o importa un paquete de StepMania.</div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button class="action-btn" onclick="goto('create')">🎵 Crear coreografía</button>
          <button class="action-btn secondary" onclick="goto('library')">📥 Importar archivos</button>
        </div>
      </div>`;
    return;
  }
  const q = (document.getElementById('songSearch')?.value || '').toLowerCase().trim();
  const sort = document.getElementById('songSort')?.value || 'addedAt-desc';
  const ratingFilter = document.getElementById('songFilterRating')?.value || '';
  const gradeFilter = document.getElementById('songFilterGrade')?.value || '';
  const tagFilter = document.getElementById('songFilterTag')?.value || '';

  let songs = _allSongsCache.filter(s => !q || s.title.toLowerCase().includes(q) || (s.artist||'').toLowerCase().includes(q));

  if (tagFilter) songs = songs.filter(s => (s.tags || []).includes(tagFilter));

  // Rating filter: keep songs whose set has at least one chart in the range
  if (ratingFilter) {
    const [lo, hi] = ratingFilter.split('-').map(Number);
    songs = songs.filter(s => (s.charts || []).some(ch => ch.rating >= lo && ch.rating <= hi));
  }

  // Grade filter: based on _bestGrade attached in refreshSongs()
  if (gradeFilter) {
    const order = { AAA: 5, AA: 4, A: 3, B: 2, C: 1, D: 0 };
    if (gradeFilter === 'any')   songs = songs.filter(s => !!s._bestGrade);
    else if (gradeFilter === 'none') songs = songs.filter(s => !s._bestGrade);
    else {
      const min = order[gradeFilter];
      songs = songs.filter(s => s._bestGrade && (order[s._bestGrade.grade] ?? -1) >= min);
    }
  }

  const [field, dir] = sort.split('-');
  const mul = dir === 'desc' ? -1 : 1;
  songs.sort((a,b) => {
    let av = a[field], bv = b[field];
    if (typeof av === 'string') return av.localeCompare(bv) * mul;
    return ((av||0) - (bv||0)) * mul;
  });
  // Guardar IDs visibles para el "select all" (opera sobre filtrados, no
  // sobre la librería entera).
  _visibleSongIds = songs.map(s => s.id);
  // 6 columnas: checkbox · título/artista · BPM · duración · best · ✏
  // El click en la fila arranca la canción directamente con la configuración
  // global. El botón ✏ lleva a diff-screen para edición avanzada (Tags,
  // BPM/offset edit) sin lanzar la canción.
  const COLS = '32px 1fr 90px 80px 80px 36px';
  let html = `<div class="queue"><div class="queue-row header" style="grid-template-columns:${COLS}">
      <div onclick="event.stopPropagation()" title="Marcar/desmarcar todas las visibles">
        <input type="checkbox" class="playlist-checkbox" id="selectAllVisible" onchange="toggleAllVisible()" aria-label="Seleccionar todas las visibles">
      </div>
      <div>Canción</div><div>BPM</div><div>Duración</div><div>Best</div><div></div>
    </div>`;
  for (const s of songs) {
    const grade = s._bestGrade ? `<span class="grade-pill grade-${s._bestGrade.grade}">${s._bestGrade.grade}</span>` : '<span style="color:#444">—</span>';
    const isMarked = selectedSongIds.has(s.id);
    html += `<div class="queue-row${isMarked ? ' in-playlist' : ''}" style="cursor:pointer;grid-template-columns:${COLS}"
      onmouseenter="scheduleSongPreview(${s.id})"
      onmouseleave="cancelSongPreview()">
      <div onclick="event.stopPropagation()">
        <input type="checkbox" class="playlist-checkbox" ${isMarked ? 'checked' : ''}
          onchange="togglePlaylistSelection(${s.id})"
          title="Marcar para sesión continua" aria-label="Marcar ${escapeHtml(s.title)}">
      </div>
      <div onclick="selectSong(${s.id})">
        <div style="font-weight:700">${escapeHtml(s.title)}</div>
        <div style="color:var(--gris-400);font-size:0.82em">${escapeHtml(s.artist||'—')} · ${s.charts.length} dif.</div></div>
      <div onclick="selectSong(${s.id})">${s.bpm.toFixed(0)}</div>
      <div onclick="selectSong(${s.id})">${formatTime(s.duration)}</div>
      <div onclick="selectSong(${s.id})">${grade}</div>
      <div onclick="event.stopPropagation()">
        <button class="icon-btn" title="Tags · BPM/offset · charts disponibles" onclick="openSongConfig(${s.id})" style="font-size:0.9em">✏</button>
      </div>
    </div>`;
  }
  html += '</div>';
  c.innerHTML = html;
  updatePlaylistBar();
}

// Click en una canción de la lista → arranca PLAY directamente con la
// configuración global (dificultad+mods+chartSpeed elegidos arriba). No
// pasa por diff-screen — el flow ahora es: configuras una vez arriba,
// luego cada click es una partida. diff-screen queda para edición avanzada
// (Tags, BPM/offset edit) accesible vía botón "✏" por fila.
async function selectSong(id) {
  selectedSong = await dbGet(id);
  if (!selectedSong) return;
  selectedChart = pickClosestChart(selectedSong, _globalDiffKey);
  if (!selectedChart) {
    alert('Esta canción no tiene charts disponibles.');
    return;
  }
  goto('play');
}
// Acceso explícito a la pantalla de ajustes/tags/BPM-edit de UNA canción.
async function openSongConfig(id) {
  selectedSong = await dbGet(id);
  if (!selectedSong) return;
  goto('diff');
}
async function playSong(id) { return selectSong(id); }

// Lanza la canción actual desde diff-screen usando la configuración global.
function playCurrentSongWithGlobalConfig() {
  if (!selectedSong) return;
  selectedChart = pickClosestChart(selectedSong, _globalDiffKey);
  if (!selectedChart) { alert('Esta canción no tiene charts disponibles.'); return; }
  goto('play');
}

async function renderDiffScreen() {
  if (!selectedSong) { goto('songs'); return; }
  document.getElementById('diffTitle').textContent = selectedSong.title;
  document.getElementById('diffSubtitle').textContent = (selectedSong.artist||'—') + ' · BPM ' + selectedSong.bpm.toFixed(0);
  renderTagChips();
  // Solo render informativo de los charts disponibles — ya no son clickables
  // para elegir dificultad (eso se hace arriba en songs-screen).
  const c = document.getElementById('diffsContainer');
  c.innerHTML = '';
  const scores = await dbScoresForSong(selectedSong.id);
  const scoreMap = Object.fromEntries(scores.map(s => [s.chartKey, s]));
  for (const chart of selectedSong.charts) {
    const el = document.createElement('div');
    el.className = 'chart-row';
    el.dataset.chartKey = chart.key;
    const sc = scoreMap[chart.key];
    const gradeCell = sc ? `<span class="grade-pill grade-${sc.grade}">${sc.grade}</span>` : '<span class="chart-row-empty">—</span>';
    const deleteBtn = sc
      ? `<button class="icon-btn danger" title="Eliminar high score" onclick="event.stopPropagation();deleteChartScore('${chart.key}')">×</button>`
      : '';
    const ratingNum = Math.max(0, Math.min(15, chart.rating || 0));
    // Resaltar el chart que coincide con la dificultad global elegida.
    const isMatch = chart.name === _globalDiffKey;
    if (isMatch) el.classList.add('selected');
    el.innerHTML = `
      <div class="chart-row-name"><strong>${chart.name}</strong>${isMatch ? ' <span style="color:var(--turquesa-400);font-size:0.78em">← global</span>' : ''}</div>
      <div class="chart-row-rating" title="Dificultad ${ratingNum}/15">
        <span class="chart-row-stars">★</span> ${ratingNum}
      </div>
      <div class="chart-row-meta">${chart.count} pasos</div>
      <div class="chart-row-grade">${gradeCell}</div>
      <div class="chart-row-action">${deleteBtn}</div>
    `;
    c.appendChild(el);
  }
}

// ----- Configuración global de partida en songs-screen ----------------------
// Sincroniza el dropdown de dificultad, los mod-toggles y el slider de
// chartSpeed con activeMods + _globalDiffKey. Se llama una sola vez en
// init (no en cada renderSongList — los listeners persisten).
let _globalDiffKey = 'Medium';

function bindSongsScreenConfig() {
  const diffSel = document.getElementById('globalDiff');
  if (!diffSel) return;
  diffSel.value = _globalDiffKey;

  // Mod toggles: misma lógica de exclusión mutua que diff-screen tenía.
  const modsContainer = document.getElementById('globalModsContainer');
  if (modsContainer) {
    modsContainer.querySelectorAll('.mod-toggle').forEach(t => {
      const m = t.dataset.mod;
      t.classList.toggle('on', !!activeMods[m]);
      t.onclick = () => {
        activeMods[m] = !activeMods[m];
        // mirror/left/right/shuffle: una sola permutación de carriles a la vez
        if (['mirror','left','right','shuffle'].includes(m) && activeMods[m]) {
          for (const x of ['mirror','left','right','shuffle']) if (x !== m) activeMods[x] = false;
        }
        // hidden vs sudden: mutuamente exclusivos
        if (m === 'hidden' && activeMods.hidden) activeMods.sudden = false;
        if (m === 'sudden' && activeMods.sudden) activeMods.hidden = false;
        // solo vs full: ambos alteran lane count
        if (m === 'solo' && activeMods.solo) activeMods.full = false;
        if (m === 'full' && activeMods.full) activeMods.solo = false;
        // Re-render visual de todos para reflejar exclusiones aplicadas
        modsContainer.querySelectorAll('.mod-toggle').forEach(other => {
          other.classList.toggle('on', !!activeMods[other.dataset.mod]);
        });
      };
    });
  }

  // ChartSpeed slider
  const cs = document.getElementById('globalChartSpeed');
  const csVal = document.getElementById('globalChartSpeedVal');
  if (cs && csVal) {
    cs.value = activeMods.chartSpeed;
    csVal.textContent = activeMods.chartSpeed.toFixed(1) + 'x';
    cs.oninput = e => {
      activeMods.chartSpeed = parseFloat(e.target.value);
      csVal.textContent = activeMods.chartSpeed.toFixed(1) + 'x';
    };
  }
}

function onGlobalDiffChange() {
  const sel = document.getElementById('globalDiff');
  if (sel) _globalDiffKey = sel.value;
}

// Exponer flag para que la inicialización en app.js pueda llamar al binder
// tras cargar el DOM.
window._bindSongsScreenConfig = bindSongsScreenConfig;

// ============================================================================
//                      PREVIEW VIVO (canvas en config-card)
// ============================================================================
// Renderiza flechas sintéticas con la MISMA dirección de scroll y el MISMO
// tiempo de lead que tendrá el juego real. BPM virtual fijo de 120 (un beat
// cada 500ms) — sin audio.
//
// Calibración honesta:
//   - Las notas SUBEN (igual que game.js: receptor cerca del top, dt>0 ⇒
//     nota debajo del receptor que sube hasta él).
//   - El lead time del preview = lead time del juego real con el viewport
//     actual. Fórmula equivalente al juego (game.js:351):
//       juego_pps = 600 * settings.scrollSpeed * activeMods.chartSpeed
//       lead_time = (innerHeight - 110) / juego_pps
//     El preview escala su pps para cubrir ese mismo lead_time en su canvas.
//   - Aplicamos settings.scrollSpeed además de activeMods.chartSpeed (antes
//     solo aplicaba chartSpeed → ignoraba el slider global).
//
// Decisión de diseño: el loop solo corre cuando songs-screen está visible.
// Al cambiar de pantalla cancelamos el rAF para no quemar GPU.

const _PREVIEW_BPM = 120;           // BPM virtual del patrón sintético
const _GAME_RECEPTOR_Y = 110;       // game.js:655 (uiScale=1)
const _GAME_BASE_PPS  = 600;        // game.js:351

let _previewState = {
  notes: [],          // [{lane, time}]
  lastBeat: -1,
  startedAt: 0,
  rafId: 0,
  running: false
};

function startPreviewLoop() {
  if (_previewState.running) return;
  const canvas = document.getElementById('previewCanvas');
  if (!canvas) return;
  _previewState.running = true;
  _previewState.startedAt = performance.now();
  _previewState.notes = [];
  _previewState.lastBeat = -1;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Receptor del preview cerca del TOP — igual que el juego real.
  const PREVIEW_RECEPTOR_Y = 32;
  const PREVIEW_LEAD_DIST = H - PREVIEW_RECEPTOR_Y;

  const tick = () => {
    if (!_previewState.running) return;
    const now = performance.now();
    const t = (now - _previewState.startedAt) / 1000; // segundos
    const beatPeriod = 60 / _PREVIEW_BPM;
    const beat = Math.floor(t / beatPeriod);

    // Determinar número de carriles según mods
    let lanes = 4;
    if (activeMods.solo) lanes = 6;
    else if (activeMods.full) lanes = 8;

    // Generar una nota nueva cada beat en un carril (semi)aleatorio
    if (beat > _previewState.lastBeat) {
      _previewState.lastBeat = beat;
      let lane = Math.floor(Math.random() * lanes);
      // Mirror: invierte horizontalmente
      if (activeMods.mirror) lane = (lanes - 1) - lane;
      _previewState.notes.push({ lane, time: t });
      // Cada 4 beats genera un par simultáneo (chord) para que se vea variado
      if (beat % 4 === 3) {
        let lane2 = (lane + 2) % lanes;
        if (activeMods.mirror) lane2 = (lanes - 1) - lane2;
        _previewState.notes.push({ lane: lane2, time: t });
      }
    }

    // Lead time real del juego con la config actual. Replicar exactamente
    // game.js:351 + game.js:655 para que la sensación coincida.
    const gamePPS = _GAME_BASE_PPS * (settings.scrollSpeed || 1) * activeMods.chartSpeed;
    const gameLeadDist = Math.max(100, window.innerHeight - _GAME_RECEPTOR_Y);
    const leadTime = gameLeadDist / gamePPS; // segundos visibles antes del receptor
    const pixelsPerSec = PREVIEW_LEAD_DIST / leadTime;

    // Limpiar notas que ya pasaron por el receptor (con margen)
    _previewState.notes = _previewState.notes.filter(n => (t - n.time) <= leadTime * 1.1);

    // Render
    ctx.clearRect(0, 0, W, H);
    const laneW = W / lanes;

    // Receptors (línea horizontal en la posición de hit, cerca del top)
    ctx.strokeStyle = 'rgba(0,190,200,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, PREVIEW_RECEPTOR_Y);
    ctx.lineTo(W, PREVIEW_RECEPTOR_Y);
    ctx.stroke();
    // Receptor squares por carril
    for (let i = 0; i < lanes; i++) {
      const x = i * laneW + laneW / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.strokeRect(x - 12, PREVIEW_RECEPTOR_Y - 12, 24, 24);
    }

    // Notas SUBIENDO desde abajo hasta el receptor.
    // y = receptorY + dt * pps  donde dt = leadTime - elapsed (tiempo que
    // falta para que llegue al receptor). Replica exactamente la fórmula del
    // juego (game.js:738: yH = receptorY + dtH * pps).
    for (const n of _previewState.notes) {
      const elapsed = t - n.time;
      const dt = leadTime - elapsed; // segundos hasta llegar al receptor
      const y = PREVIEW_RECEPTOR_Y + dt * pixelsPerSec;
      if (y > H + 10 || y < PREVIEW_RECEPTOR_Y - 20) continue;
      const x = n.lane * laneW + laneW / 2;

      // Aplicar Hidden/Sudden a la opacidad — progress 0=cerca del receptor
      // (justo antes de hitear), 1=lejos abajo (recién aparecida).
      const progress = dt / leadTime;
      let alpha = 1;
      if (activeMods.hidden && progress < 0.5) {
        // Hidden: desaparece cuando se acerca al receptor (mitad superior)
        alpha = Math.max(0, progress * 4 - 1);
      }
      if (activeMods.sudden && progress > 0.5) {
        // Sudden: aparece tarde (cuando ya está cerca del receptor)
        alpha = Math.max(0, 1 - (progress - 0.5) * 4);
      }
      if (alpha <= 0) continue;

      // Color por carril (paleta DDR clásica)
      const colors = ['#ff006e', '#3a86ff', '#00ff64', '#ffbe0b', '#9b5de5', '#f15bb5', '#06d6a0', '#fb5607'];
      ctx.fillStyle = colors[n.lane % colors.length];
      ctx.globalAlpha = alpha;
      const sz = 18;
      ctx.beginPath();
      ctx.roundRect(x - sz/2, y - sz/2, sz, sz, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    _previewState.rafId = requestAnimationFrame(tick);
  };
  tick();
}

function stopPreviewLoop() {
  _previewState.running = false;
  if (_previewState.rafId) cancelAnimationFrame(_previewState.rafId);
  _previewState.rafId = 0;
}

// Hook: bindSongsScreenConfig debe arrancar/parar el preview según pantalla.
// Lo manejamos vía el goto() en app.js (entrada/salida de songs-screen).
window._startPreviewLoop = startPreviewLoop;
window._stopPreviewLoop = stopPreviewLoop;

async function deleteChartScore(chartKey) {
  if (!selectedSong) return;
  if (!confirm('¿Borrar el high score de esta dificultad?')) return;
  await dbScoreDelete(selectedSong.id, chartKey);
  renderDiffScreen();
}

// ----- Chart selection UI ---------------------------------------------------
// Mantiene la dificultad elegida visualmente y habilita el botón "Jugar"
// (CTA grande). El juego solo arranca al pulsar "Jugar" — el patrón clásico
// arcade: seleccionas → confirmas. Antes el clic en la fila lanzaba la canción
// directamente, lo cual era poco intuitivo.
function selectChartUI(chart, rowEl) {
  selectedChart = chart;
  // Quitar selección de todas las filas y marcar solo la actual
  document.querySelectorAll('#diffsContainer .chart-row').forEach(r => r.classList.remove('selected'));
  if (rowEl) rowEl.classList.add('selected');
  updatePlayCtaState();
}
function updatePlayCtaState() {
  const btn = document.getElementById('playCtaBtn');
  const hint = document.getElementById('playCtaHint');
  if (!btn) return;
  if (selectedChart) {
    btn.disabled = false;
    btn.classList.add('ready');
    if (hint) hint.textContent = `Listo: ${selectedChart.name} · ${selectedChart.count} pasos`;
  } else {
    btn.disabled = true;
    btn.classList.remove('ready');
    if (hint) hint.textContent = 'Elige una dificultad para empezar';
  }
}
function confirmChartAndPlay() {
  if (!selectedChart) return;
  goto('play');
}

// ----- Manual BPM/offset edit (per song) -----------------------------------
// Modifies #BPMS first segment and #OFFSET in the stored sscText, plus
// `bpm` and `offsetSec` cached on the song row. Multi-segment BPMS get a
// warning since editing only the first segment desynchronizes later sections.
function openBpmEdit() {
  if (!selectedSong) return;
  const bpmsRaw = (selectedSong.sscText.match(/#BPMS:([^;]*);/) || [,''])[1].trim();
  const segments = bpmsRaw.split(',').filter(Boolean);
  const warnEl = document.getElementById('bpmEditWarn');
  if (segments.length > 1) {
    warnEl.innerHTML = `<div style="padding:10px 14px;background:rgba(245,158,11,0.12);border-left:3px solid var(--color-warning);border-radius:6px;color:var(--color-warning-dark);font-size:0.85em">⚠ Esta canción tiene <strong>${segments.length} cambios de BPM</strong>. Editar aquí solo modifica el primero — el resto se desincronizará. Usa con cuidado.</div>`;
  } else {
    warnEl.innerHTML = '';
  }
  document.getElementById('bpmEditInput').value = selectedSong.bpm.toFixed(2);
  document.getElementById('bpmEditVal').textContent = selectedSong.bpm.toFixed(1);
  document.getElementById('offsetEditInput').value = (-selectedSong.offsetSec).toFixed(3);
  document.getElementById('offsetEditVal').textContent = (-selectedSong.offsetSec).toFixed(3);
  document.getElementById('bpmEditModal').classList.add('show');
  // Live preview of the displayed value next to the label
  document.getElementById('bpmEditInput').oninput = e => {
    document.getElementById('bpmEditVal').textContent = parseFloat(e.target.value || '0').toFixed(1);
  };
  document.getElementById('offsetEditInput').oninput = e => {
    document.getElementById('offsetEditVal').textContent = parseFloat(e.target.value || '0').toFixed(3);
  };
}
function closeBpmEdit() {
  document.getElementById('bpmEditModal').classList.remove('show');
}
async function saveBpmEdit() {
  if (!selectedSong) return;
  const newBpm = parseFloat(document.getElementById('bpmEditInput').value);
  const newOffsetPositive = parseFloat(document.getElementById('offsetEditInput').value);
  if (!isFinite(newBpm) || newBpm < 40 || newBpm > 300) { alert('BPM debe estar entre 40 y 300.'); return; }
  if (!isFinite(newOffsetPositive)) { alert('Offset inválido.'); return; }
  // SSC convention: #OFFSET stored is positive (audio starts after second 0).
  // Internal offsetSec is negated (audioTime(beat 0) = -offset).
  const newOffsetSec = -newOffsetPositive;
  // Rewrite #BPMS first segment AND #OFFSET in sscText
  let ssc = selectedSong.sscText;
  ssc = ssc.replace(/#BPMS:([^;]*);/, (_m, body) => {
    const segs = body.trim().split(',').filter(Boolean);
    if (segs.length === 0) return `#BPMS:0.000=${newBpm.toFixed(3)};`;
    const [firstBeat] = segs[0].split('=');
    segs[0] = `${(parseFloat(firstBeat)||0).toFixed(3)}=${newBpm.toFixed(3)}`;
    return `#BPMS:${segs.join(',')};`;
  });
  ssc = ssc.replace(/#OFFSET:[^;]*;/, `#OFFSET:${newOffsetPositive.toFixed(3)};`);
  if (!/#OFFSET:/.test(ssc)) ssc = `#OFFSET:${newOffsetPositive.toFixed(3)};\n` + ssc;
  // Persist
  selectedSong.sscText = ssc;
  selectedSong.bpm = newBpm;
  selectedSong.offsetSec = newOffsetSec;
  await dbPut(selectedSong);
  closeBpmEdit();
  renderDiffScreen(); // refresh subtitle showing new BPM
}

// Bind search/sort/filters listeners once.
(function bindSongFilters() {
  const s = document.getElementById('songSearch');
  if (!s) return;
  s.addEventListener('input', renderSongList);
  document.getElementById('songSort').addEventListener('change', renderSongList);
  document.getElementById('songFilterRating')?.addEventListener('change', renderSongList);
  document.getElementById('songFilterGrade')?.addEventListener('change', renderSongList);
  document.getElementById('songFilterTag')?.addEventListener('change', renderSongList);
})();

// ----- Audio preview on hover (debounced + cached) --------------------------
// Plays ~12s starting from sampleStart with linear fade in/out. Hover delay
// (250ms) avoids preview while just scrolling through the list.
const _previewCache = new Map(); // songId -> AudioBuffer
let _previewSrc = null;
let _previewGain = null;
let _previewTimer = null;
let _previewCurrentId = null;

async function startSongPreview(songId) {
  const song = _allSongsCache.find(s => s.id === songId);
  if (!song || !song.audioBlob) return;
  stopSongPreview();
  _previewCurrentId = songId;
  ensureAudioCtx();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  let buffer = _previewCache.get(songId);
  if (!buffer) {
    try {
      const arr = await song.audioBlob.arrayBuffer();
      buffer = await audioCtx.decodeAudioData(arr.slice(0));
      _previewCache.set(songId, buffer);
    } catch (e) { return; }
  }
  if (_previewCurrentId !== songId) return; // user moved on while decoding
  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  src.buffer = buffer;
  src.connect(gain).connect(audioCtx.destination);
  const start = Math.min(buffer.duration - 1, song.sampleStart || Math.min(30, buffer.duration * 0.3));
  const previewLen = Math.min(12, buffer.duration - start);
  const t0 = audioCtx.currentTime;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.55, t0 + 0.5);
  gain.gain.setValueAtTime(0.55, t0 + previewLen - 0.5);
  gain.gain.linearRampToValueAtTime(0, t0 + previewLen);
  src.start(t0, start);
  src.stop(t0 + previewLen + 0.05);
  _previewSrc = src; _previewGain = gain;
  src.onended = () => { if (_previewSrc === src) { _previewSrc = null; _previewGain = null; } };
}

function stopSongPreview() {
  _previewCurrentId = null;
  if (_previewTimer) { clearTimeout(_previewTimer); _previewTimer = null; }
  if (_previewSrc && _previewGain) {
    try {
      const t = audioCtx.currentTime;
      _previewGain.gain.cancelScheduledValues(t);
      _previewGain.gain.setValueAtTime(_previewGain.gain.value, t);
      _previewGain.gain.linearRampToValueAtTime(0, t + 0.15);
      _previewSrc.stop(t + 0.16);
    } catch (e) {}
    _previewSrc = null; _previewGain = null;
  }
}

function scheduleSongPreview(songId) {
  if (_previewTimer) clearTimeout(_previewTimer);
  _previewTimer = setTimeout(() => startSongPreview(songId), 250);
}

function cancelSongPreview() {
  if (_previewTimer) { clearTimeout(_previewTimer); _previewTimer = null; }
  stopSongPreview();
}

// Permutations are now lane-count aware. The base perms live in LANE_CONFIGS
// (game.js); we look them up dynamically via the count of lanes the chart
// is actually playing with after any solo/full redistribution.
let _shufflePerm = [];
function applyModsToLane(lane, numLanes) {
  const cfg = (typeof LANE_CONFIGS !== 'undefined') ? LANE_CONFIGS[numLanes] : null;
  if (!cfg) return lane; // safety: unknown lane count
  if (activeMods.mirror)  return cfg.mirrorPerm[lane];
  if (activeMods.left)    return cfg.leftPerm[lane];
  if (activeMods.right)   return cfg.rightPerm[lane];
  if (activeMods.shuffle) return (_shufflePerm[lane] !== undefined ? _shufflePerm[lane] : lane);
  return lane;
}
function rerollShuffle(numLanes) {
  const n = numLanes || 4;
  const a = []; for (let i = 0; i < n; i++) a.push(i);
  for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  _shufflePerm = a;
}

// ----- Tags ------------------------------------------------------------------
// Tags live on the song row (`tags: string[]`). Old songs without the field
// fall back to `[]`. Filter dropdown in song-select reads the union of all tags
// after every refresh; adding a tag here also triggers a refresh on next visit.
function renderTagChips() {
  const el = document.getElementById('tagChips');
  if (!el || !selectedSong) return;
  const tags = selectedSong.tags || [];
  el.innerHTML = tags.length === 0
    ? '<span style="color:var(--gris-500);font-size:0.85em;font-style:italic">sin tags</span>'
    : tags.map(t => `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(0,190,200,0.18);color:var(--turquesa-400);border-radius:10px;font-size:0.8em">${escapeHtml(t)} <button onclick="removeSongTag('${t.replace(/'/g, "\\'")}')" style="background:none;border:none;color:var(--rosa-500);cursor:pointer;font-weight:700;padding:0 0 0 2px;font-size:1em" title="Quitar tag">×</button></span>`).join('');
  const input = document.getElementById('tagInput');
  if (input && !input._tagBound) {
    input._tagBound = true;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value.trim().toLowerCase();
        if (v) addSongTag(v);
        input.value = '';
      }
    });
  }
}

async function addSongTag(tag) {
  if (!selectedSong) return;
  selectedSong.tags = selectedSong.tags || [];
  if (selectedSong.tags.includes(tag)) return;
  selectedSong.tags.push(tag);
  await dbPut(selectedSong);
  renderTagChips();
  // Update cached row in _allSongsCache so filter reflects it without a full refetch
  const cached = _allSongsCache.find(s => s.id === selectedSong.id);
  if (cached) cached.tags = selectedSong.tags;
}

async function removeSongTag(tag) {
  if (!selectedSong) return;
  selectedSong.tags = (selectedSong.tags || []).filter(t => t !== tag);
  await dbPut(selectedSong);
  renderTagChips();
  const cached = _allSongsCache.find(s => s.id === selectedSong.id);
  if (cached) cached.tags = selectedSong.tags;
}

// ============================================================================
//                          PLAYLIST MODE (sesión continua)
// ============================================================================
// Flow:
//   1. Usuario marca varias canciones con el checkbox de cada song-row.
//   2. Aparece la barra sticky-bottom con el contador y "Jugar todas".
//   3. Click → modal de dificultad común. Si una canción no la tiene, se usa
//      la más cercana en el orden Beginner→Easy→Medium→Hard→Challenge.
//   4. Empieza la primera canción. Al terminar, results-screen muestra un
//      banner "Siguiente: …" con countdown 5s y botones para continuar antes
//      o saltar el resto.
//   5. Tras la última canción, se muestra un resumen agregado de la sesión.
//
// Decisión: NO persistimos las sesiones — la usuaria pidió ad-hoc.

const _DIFF_ORDER = ['Beginner', 'Easy', 'Medium', 'Hard', 'Challenge'];

function togglePlaylistSelection(id) {
  if (selectedSongIds.has(id)) selectedSongIds.delete(id);
  else selectedSongIds.add(id);
  renderSongList();
}

function clearPlaylistSelection() {
  selectedSongIds.clear();
  renderSongList();
}

function updatePlaylistBar() {
  const bar = document.getElementById('playlistBar');
  const count = document.getElementById('playlistCount');
  const clearBtn = document.getElementById('playlistClearBtn');
  const startBtn = document.getElementById('playlistStartBtn');
  if (bar && count) {
    const n = selectedSongIds.size;
    if (n === 0) {
      // Idle: barra siempre visible pero apagada, botones disabled.
      bar.classList.remove('has-selection');
      count.textContent = 'Marca varias canciones para crear una partida';
      if (clearBtn) clearBtn.disabled = true;
      if (startBtn) startBtn.disabled = true;
    } else {
      // Activa: brilla, contador real, botones habilitados.
      bar.classList.add('has-selection');
      count.textContent = `${n} ${n === 1 ? 'canción seleccionada' : 'canciones seleccionadas'}`;
      if (clearBtn) clearBtn.disabled = false;
      if (startBtn) startBtn.disabled = false;
    }
  }
  updateMasterCheckbox();
}

// Sincroniza el estado del checkbox maestro con la intersección entre
// las canciones visibles (filtradas) y las seleccionadas. Tres estados:
//   - vacío: 0 visibles marcadas
//   - indeterminate: algunas visibles marcadas, no todas
//   - marcado: todas las visibles marcadas
function updateMasterCheckbox() {
  const cb = document.getElementById('selectAllVisible');
  if (!cb) return;
  const total = _visibleSongIds.length;
  if (total === 0) {
    cb.checked = false;
    cb.indeterminate = false;
    cb.disabled = true;
    return;
  }
  cb.disabled = false;
  const markedVisible = _visibleSongIds.filter(id => selectedSongIds.has(id)).length;
  if (markedVisible === 0) {
    cb.checked = false;
    cb.indeterminate = false;
  } else if (markedVisible === total) {
    cb.checked = true;
    cb.indeterminate = false;
  } else {
    cb.checked = false;
    cb.indeterminate = true; // selección parcial
  }
}

// Toggle del checkbox maestro: si todas las visibles están marcadas → las
// desmarca; si no → marca todas las visibles (las ya marcadas fuera del
// filtro se conservan, no se tocan).
function toggleAllVisible() {
  if (_visibleSongIds.length === 0) return;
  const allMarked = _visibleSongIds.every(id => selectedSongIds.has(id));
  if (allMarked) {
    for (const id of _visibleSongIds) selectedSongIds.delete(id);
  } else {
    for (const id of _visibleSongIds) selectedSongIds.add(id);
  }
  renderSongList();
}

function openPlaylistModal() {
  if (selectedSongIds.size === 0) return;
  const modal = document.getElementById('playlistModal');
  const count = document.getElementById('playlistModalCount');
  count.textContent = `${selectedSongIds.size} canciones se reproducirán en cadena.`;
  modal.classList.remove('hidden');
}

function closePlaylistModal() {
  document.getElementById('playlistModal').classList.add('hidden');
}

// Encuentra el chart cuya `name` (Beginner/Easy/Medium/Hard/Challenge) está
// más cerca del target. En empate prefiere el chart con meter más alto.
function pickClosestChart(song, targetKey) {
  if (!song.charts || !song.charts.length) return null;
  const exact = song.charts.find(c => c.name === targetKey);
  if (exact) return exact;
  const targetIdx = _DIFF_ORDER.indexOf(targetKey);
  if (targetIdx < 0) return song.charts[0];
  const ranked = song.charts.map(c => {
    const idx = _DIFF_ORDER.indexOf(c.name);
    return { chart: c, dist: idx < 0 ? 99 : Math.abs(idx - targetIdx), meter: c.rating || 0 };
  });
  ranked.sort((a, b) => a.dist - b.dist || b.meter - a.meter);
  return ranked[0].chart;
}

async function startPlaylistSession() {
  if (selectedSongIds.size === 0) return;
  // La dificultad y mods vienen de la configuración global (songs-screen).
  // Ya no abrimos un modal — el flow es directo.
  const diffKey = _globalDiffKey;
  const songs = [];
  // Set preserva insertion order: respetamos el orden de marcado.
  for (const id of selectedSongIds) {
    const s = await dbGet(id);
    if (!s) continue;
    const chart = pickClosestChart(s, diffKey);
    if (!chart) continue;
    songs.push({ songId: id, songData: s, chartKey: chart.key, chartData: chart });
  }
  if (!songs.length) {
    alert('Ninguna canción seleccionada tiene un chart compatible.');
    return;
  }
  playSession = {
    songs, difficultyKey: diffKey,
    index: 0, scores: [],
    startedAt: Date.now()
  };
  selectedSongIds.clear();
  loadSessionSong(0);
}

function loadSessionSong(idx) {
  if (!playSession || idx < 0 || idx >= playSession.songs.length) return;
  playSession.index = idx;
  const s = playSession.songs[idx];
  selectedSong = s.songData;
  selectedChart = s.chartData;
  goto('play');
}

function endPlaylistSession() {
  if (_sessionCountdownTimer) {
    clearInterval(_sessionCountdownTimer);
    _sessionCountdownTimer = null;
  }
  playSession = null;
}

// Hook llamado desde game.js → endGame al final de cada canción de sesión.
// Inyecta el banner de "siguiente" o el resumen final en el results-screen.
function updateResultsForSession(lastResult) {
  if (!playSession) {
    // Asegurar que los botones por defecto están visibles fuera de sesión
    const actions = document.getElementById('resultsActions');
    if (actions) actions.style.display = '';
    return;
  }
  if (lastResult) playSession.scores.push({
    songId: selectedSong?.id,
    title: selectedSong?.title || '?',
    chartName: selectedChart?.name || '?',
    ...lastResult
  });
  const isLast = playSession.index >= playSession.songs.length - 1;
  const resultsContent = document.getElementById('resultsContent');
  if (!resultsContent) return;
  // Durante una sesión los botones default (Reintentar/Otra canción/Menú)
  // se ocultan: el banner inyectado tiene "Continuar ahora" y "Salir de la
  // sesión" que son los únicos relevantes. En la última canción se muestran
  // de nuevo para que la usuaria pueda navegar normalmente.
  const actions = document.getElementById('resultsActions');
  if (actions) actions.style.display = isLast ? '' : 'none';

  if (isLast) {
    const totalScore = playSession.scores.reduce((s, r) => s + (r.score || 0), 0);
    const avgAcc = playSession.scores.reduce((s, r) => s + (r.accuracy || 0), 0) / playSession.scores.length;
    const summary = playSession.scores.map(r =>
      `<div class="row"><span>${escapeHtml(r.title)} <small style="color:var(--gris-500)">· ${r.chartName}</small></span>` +
      `<span><span class="grade-pill grade-${r.grade}">${r.grade}</span> ${(r.accuracy||0).toFixed(0)}%</span></div>`
    ).join('');
    resultsContent.insertAdjacentHTML('afterbegin',
      `<div class="session-summary">
        <div style="font-family:var(--font-display);color:var(--turquesa-400);font-size:1.1em;margin-bottom:8px">
          🏁 Sesión completa · ${playSession.songs.length} canciones
        </div>
        ${summary}
        <div class="row" style="margin-top:8px;padding-top:10px;border-top:1px solid rgba(0,190,200,0.3)">
          <strong>Score total</strong>
          <strong style="color:#ffbe0b">${totalScore.toLocaleString()} · acc media ${avgAcc.toFixed(1)}%</strong>
        </div>
      </div>`
    );
    endPlaylistSession();
    return;
  }

  const nextIdx = playSession.index + 1;
  const next = playSession.songs[nextIdx];
  const banner = document.createElement('div');
  banner.className = 'session-next-banner';
  banner.innerHTML = `
    <div class="label">Siguiente canción</div>
    <div class="next-title">${escapeHtml(next.songData.title)}</div>
    <div class="countdown" id="sessionCountdown">5</div>
    <div class="progress-text">Canción ${nextIdx + 1} de ${playSession.songs.length} · ${escapeHtml(next.chartData.name)}</div>
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      <button class="action-btn" onclick="continueSessionNow()">▶ Continuar ahora</button>
      <button class="action-btn secondary" onclick="endPlaylistSession();goto('songs')">⊘ Salir de la sesión</button>
    </div>`;
  resultsContent.insertAdjacentElement('afterbegin', banner);

  let secs = 5;
  if (_sessionCountdownTimer) clearInterval(_sessionCountdownTimer);
  _sessionCountdownTimer = setInterval(() => {
    secs--;
    const el = document.getElementById('sessionCountdown');
    if (el) el.textContent = secs;
    if (secs <= 0) {
      clearInterval(_sessionCountdownTimer);
      _sessionCountdownTimer = null;
      continueSessionNow();
    }
  }, 1000);
}

function continueSessionNow() {
  if (!playSession) return;
  if (_sessionCountdownTimer) {
    clearInterval(_sessionCountdownTimer);
    _sessionCountdownTimer = null;
  }
  loadSessionSong(playSession.index + 1);
}
