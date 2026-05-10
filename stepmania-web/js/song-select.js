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
  let html = `<div class="queue"><div class="queue-row header" style="grid-template-columns:1fr 90px 80px 80px 60px"><div>Canción</div><div>BPM</div><div>Duración</div><div>Best</div><div></div></div>`;
  for (const s of songs) {
    const grade = s._bestGrade ? `<span class="grade-pill grade-${s._bestGrade.grade}">${s._bestGrade.grade}</span>` : '<span style="color:#444">—</span>';
    html += `<div class="queue-row" style="cursor:pointer;grid-template-columns:1fr 90px 80px 80px 60px"
      onclick="selectSong(${s.id})"
      onmouseenter="scheduleSongPreview(${s.id})"
      onmouseleave="cancelSongPreview()">
      <div><div style="font-weight:700">${escapeHtml(s.title)}</div>
        <div style="color:var(--gris-400);font-size:0.82em">${escapeHtml(s.artist||'—')} · ${s.charts.length} dif.</div></div>
      <div>${s.bpm.toFixed(0)}</div>
      <div>${formatTime(s.duration)}</div>
      <div>${grade}</div>
      <div><button class="icon-btn">▶</button></div>
    </div>`;
  }
  html += '</div>';
  c.innerHTML = html;
}

async function selectSong(id) {
  selectedSong = await dbGet(id);
  if (!selectedSong) return;
  goto('diff');
}
async function playSong(id) {
  selectedSong = await dbGet(id);
  if (!selectedSong) return;
  goto('diff');
}

async function renderDiffScreen() {
  if (!selectedSong) { goto('songs'); return; }
  document.getElementById('diffTitle').textContent = selectedSong.title;
  document.getElementById('diffSubtitle').textContent = (selectedSong.artist||'—') + ' · BPM ' + selectedSong.bpm.toFixed(0);
  renderTagChips();
  const c = document.getElementById('diffsContainer');
  c.innerHTML = '';
  // Reset chart selection cada vez que entramos a la pantalla — la usuaria
  // debe elegir explícitamente, y el botón "Jugar" arranca solo cuando hay
  // chart elegido (patrón arcade clásico: selecciona → confirma).
  selectedChart = null;
  updatePlayCtaState();
  const scores = await dbScoresForSong(selectedSong.id);
  const scoreMap = Object.fromEntries(scores.map(s => [s.chartKey, s]));
  for (const chart of selectedSong.charts) {
    const el = document.createElement('div');
    el.className = 'chart-row';
    el.style.cursor = 'pointer';
    el.dataset.chartKey = chart.key;
    const sc = scoreMap[chart.key];
    const gradeCell = sc ? `<span class="grade-pill grade-${sc.grade}">${sc.grade}</span>` : '<span class="chart-row-empty">—</span>';
    const deleteBtn = sc
      ? `<button class="icon-btn danger" title="Eliminar high score" onclick="event.stopPropagation();deleteChartScore('${chart.key}')">×</button>`
      : '';
    // Estrellas visuales según rating (max 15)
    const ratingNum = Math.max(0, Math.min(15, chart.rating || 0));
    el.innerHTML = `
      <div class="chart-row-name"><strong>${chart.name}</strong></div>
      <div class="chart-row-rating" title="Dificultad ${ratingNum}/15">
        <span class="chart-row-stars">★</span> ${ratingNum}
      </div>
      <div class="chart-row-meta">${chart.count} pasos</div>
      <div class="chart-row-grade">${gradeCell}</div>
      <div class="chart-row-action">${deleteBtn}</div>
    `;
    el.addEventListener('click', () => selectChartUI(chart, el));
    c.appendChild(el);
  }
  // Init mods UI
  document.querySelectorAll('#modsContainer .mod-toggle').forEach(t => {
    const m = t.dataset.mod;
    t.classList.toggle('on', !!activeMods[m]);
    t.onclick = () => {
      activeMods[m] = !activeMods[m];
      // mirror/left/right/shuffle are mutually exclusive (one permutation at a time)
      if (['mirror','left','right','shuffle'].includes(m) && activeMods[m]) {
        for (const x of ['mirror','left','right','shuffle']) if (x !== m) activeMods[x] = false;
        document.querySelectorAll('#modsContainer .mod-toggle').forEach(other => {
          if (['mirror','left','right','shuffle'].includes(other.dataset.mod)) other.classList.toggle('on', !!activeMods[other.dataset.mod]);
        });
      }
      // hidden vs sudden mutually exclusive
      if ((m === 'hidden' && activeMods.hidden) || (m === 'sudden' && activeMods.sudden)) {
        if (m === 'hidden') { activeMods.sudden = false; document.querySelector('[data-mod="sudden"]').classList.remove('on'); }
        if (m === 'sudden') { activeMods.hidden = false; document.querySelector('[data-mod="hidden"]').classList.remove('on'); }
      }
      // solo vs full mutually exclusive (both alter lane count)
      if (m === 'solo' && activeMods.solo) { activeMods.full = false; document.querySelector('[data-mod="full"]')?.classList.remove('on'); }
      if (m === 'full' && activeMods.full) { activeMods.solo = false; document.querySelector('[data-mod="solo"]')?.classList.remove('on'); }
      t.classList.toggle('on', activeMods[m]);
    };
  });
  const cs = document.getElementById('chartSpeed');
  cs.value = activeMods.chartSpeed;
  document.getElementById('chartSpeedVal').textContent = activeMods.chartSpeed.toFixed(1) + 'x';
  cs.oninput = e => {
    activeMods.chartSpeed = parseFloat(e.target.value);
    document.getElementById('chartSpeedVal').textContent = activeMods.chartSpeed.toFixed(1) + 'x';
  };
}

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
