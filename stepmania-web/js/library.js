// ============================================================================
//  LIBRARY UI — list/delete songs from IndexedDB, import .ssc/.sm + audio
//  pairs (best-effort name pairing). Uses parseSscOrSm from parser.js.
//
//  Render unificado con gh-play.html: filas `.lib-row` con checkbox de
//  selección múltiple + banner sticky `playlist-bar` para borrado masivo +
//  drop-zones (drag-and-drop) en la card de importar. Estilo turquesa
//  (StepMania); el patrón es idéntico al de la biblioteca GH (naranja).
// ============================================================================

// `navigator.storage.estimate()` aggregates IndexedDB + localStorage + caches
// — it doesn't separate them. In Chrome desktop quota is multi-GB; in Safari
// iOS it's ~50MB hard cap. Most useful as a "you're nowhere near limit" hint.
async function getStorageInfo() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const usedMB = (usage / 1024 / 1024).toFixed(1);
    const quotaMB = (quota / 1024 / 1024).toFixed(0);
    const pct = quota ? ((usage / quota) * 100).toFixed(1) : '?';
    return { usedMB, quotaMB, pct, usage, quota };
  } catch (e) { return null; }
}

// ----- Selección múltiple (mismo patrón que selectedManageIds de gh-play) ----
const selectedLibraryIds = new Set();
let _visibleLibraryIds = [];

// Caché para que los filtros de texto no peguen a IndexedDB en cada keystroke.
// `refreshLibrary()` hace fetch + render; `renderLibraryFromCache()` solo
// re-renderiza con los filtros aplicados. Los listeners de los inputs llaman
// SOLO al segundo (delete/import siguen usando refreshLibrary para invalidar).
let _libraryCache = [];
let _libraryRunsBySong = new Map();
let _libraryStorageInfo = null;

async function refreshLibrary() {
  const c = document.getElementById('libraryContainer');
  if (c) c.innerHTML = 'Cargando...';
  // Una sola lectura de runs para toda la biblioteca — agrupamos en memoria.
  // Alternativa N+1 (dbRunsForSong por cada fila) lanzaría 1 transacción de
  // IndexedDB por canción y en bibliotecas de 50+ canciones es notablemente
  // más lento (cada `transaction()` paga overhead aunque sea readonly).
  // Filtramos por gameType='sm' porque la DB se comparte con GH y los songIds
  // de `songs` y `gh-songs` son autoincrement independientes.
  const [songs, info, allRunsRaw] = await Promise.all([dbAll(), getStorageInfo(), dbRunsAll()]);
  const allRuns = filterRunsByGame(allRunsRaw, 'sm');
  _libraryRunsBySong = new Map();
  for (const r of allRuns) {
    if (!_libraryRunsBySong.has(r.songId)) _libraryRunsBySong.set(r.songId, []);
    _libraryRunsBySong.get(r.songId).push(r);
  }
  _libraryStorageInfo = info;
  // Sort UNA vez aquí (más recientes primero); el render solo filtra y pinta.
  songs.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  _libraryCache = songs;
  renderLibraryFromCache();
  // Auto-corrección silenciosa de tags rotos en background. NO bloquea el
  // primer render — la biblioteca aparece inmediatamente con los datos
  // actuales y, si el parser nuevo encuentra mejores tags, refresca después.
  // El campo _metaParserVersion en cada entry evita re-procesar lo ya OK.
  _autoFixBrokenLibraryTags().then((fixed) => {
    if (fixed > 0) {
      // Recargar caché desde DB para reflejar los cambios y re-renderizar.
      dbAll().then((fresh) => {
        fresh.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        _libraryCache = fresh;
        if (typeof _allSongsCache !== 'undefined') _allSongsCache = fresh;
        renderLibraryFromCache();
      });
    }
  }).catch(() => { /* nunca propagar — es opcional */ });
}

function renderLibraryFromCache() {
  const c = document.getElementById('libraryContainer');
  const countEl = document.getElementById('libraryCount');
  if (!c) return;
  const info = _libraryStorageInfo;
  const allSongs = _libraryCache;

  const storageBar = info
    ? `<div style="margin-bottom:14px;padding:10px 14px;background:rgba(0,190,200,0.08);border:1px solid rgba(0,190,200,0.2);border-radius:8px;font-size:0.85em;color:var(--gris-300)">
         💾 Librería ocupa <strong style="color:var(--turquesa-400)">${info.usedMB} MB</strong> de ${info.quotaMB} MB disponibles (${info.pct}%)
       </div>` : '';

  if (countEl) countEl.textContent = allSongs.length ? `(${allSongs.length})` : '';

  if (!allSongs.length) {
    selectedLibraryIds.clear();
    _visibleLibraryIds = [];
    c.innerHTML = storageBar + '<p style="color:var(--gris-400);text-align:center;padding:30px">Tu biblioteca está vacía. Importa archivos abajo o <a href="autostepper.html" style="color:var(--turquesa-400)">crea tu primer chart</a>.</p>';
    updateLibraryManageBar();
    return;
  }

  // Filtros de texto (AND entre ambos campos; vacío = cualquiera).
  const qTitle  = (document.getElementById('librarySearchTitle')?.value || '').toLowerCase().trim();
  const qArtist = (document.getElementById('librarySearchArtist')?.value || '').toLowerCase().trim();
  const songs = allSongs.filter(s =>
    (!qTitle  || (s.title  || '').toLowerCase().includes(qTitle)) &&
    (!qArtist || (s.artist || '').toLowerCase().includes(qArtist))
  );

  _visibleLibraryIds = songs.map(s => s.id);
  // Limpiar selección de ids que ya no están visibles tras el filtro
  for (const id of [...selectedLibraryIds]) {
    if (!_visibleLibraryIds.includes(id)) selectedLibraryIds.delete(id);
  }

  if (!songs.length) {
    c.innerHTML = storageBar + `<p style="color:var(--gris-400);text-align:center;padding:24px">Sin resultados para los filtros actuales. <button class="icon-btn" onclick="clearLibrarySearch()" style="margin-left:6px">Limpiar filtros</button></p>`;
    updateLibraryManageBar();
    return;
  }

  let html = storageBar + `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:8px">
      <input type="checkbox" class="playlist-checkbox" id="selectAllVisibleLibrary" onchange="toggleAllVisibleLibrary()" aria-label="Seleccionar todas las canciones visibles">
      <span style="color:var(--gris-300);font-size:0.88em;flex:1">💡 Marca varias canciones con la casilla para eliminarlas a la vez${(qTitle || qArtist) ? ` · <strong>${songs.length}/${allSongs.length}</strong> tras filtros` : ''}</span>
    </div>`;

  for (const s of songs) {
    const dur = s.duration ? formatTime(s.duration) : '?';
    const isMarked = selectedLibraryIds.has(s.id);
    const chartCount = (s.charts || []).length;
    // Biblioteca SM = pantalla "Mis canciones" pura gestión (paridad con la
    // de GH en `gh-play.html → refreshManageList`). Para tocar se usa la
    // pantalla "Tocar" (songs-screen). Por eso aquí NO va el botón ▶ Tocar
    // ni el chip de campeón — solo info + botón de eliminar.
    html += `<div class="lib-row${isMarked ? ' in-playlist' : ''}"
      onmouseenter="scheduleSongPreview(${s.id})"
      onmouseleave="cancelSongPreview()">
      <input type="checkbox" class="playlist-checkbox" ${isMarked ? 'checked' : ''}
        onchange="togglePlaylistSelectionLibrary(${s.id})" title="Marcar para eliminar en grupo"
        aria-label="Marcar ${escapeHtml(s.title || 'canción')}">
      <div style="flex:1;min-width:0">
        <div style="color:#fff;font-weight:600">${escapeHtml(s.title || 'Sin título')}${audioFlagBadge(s.audioFlags)}</div>
        <div style="color:var(--gris-400);font-size:0.85em">${escapeHtml(s.artist || 'Unknown')} · ${s.bpm ? s.bpm.toFixed(1) + ' BPM' : '? BPM'} · ${dur} · ${chartCount} chart${chartCount === 1 ? '' : 's'}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="action-btn secondary" style="padding:8px 14px;font-size:0.95em;background:linear-gradient(90deg,var(--color-error),#9f1239)" onclick="deleteSong(${s.id})" title="Eliminar esta canción">🗑 Eliminar</button>
      </div>
    </div>`;
  }

  c.innerHTML = html;
  updateLibraryManageBar();
}

// Toggle individual: añade/quita un id del Set y re-renderiza desde caché
// (los toggles de selección no cambian la lista de canciones, así que no
// hace falta volver a IndexedDB — evita el flash de "Cargando..." al marcar).
function togglePlaylistSelectionLibrary(id) {
  if (selectedLibraryIds.has(id)) selectedLibraryIds.delete(id);
  else selectedLibraryIds.add(id);
  renderLibraryFromCache();
}

// Limpia toda la selección.
function clearLibraryManageSelection() {
  selectedLibraryIds.clear();
  renderLibraryFromCache();
}

// Checkbox maestro tri-state: vacío / indeterminate / todo. Si el usuario
// marca el master con todas seleccionadas, las desmarca; en cualquier otro
// caso, las marca todas.
function toggleAllVisibleLibrary() {
  if (_visibleLibraryIds.length === 0) return;
  const allMarked = _visibleLibraryIds.every(id => selectedLibraryIds.has(id));
  if (allMarked) for (const id of _visibleLibraryIds) selectedLibraryIds.delete(id);
  else for (const id of _visibleLibraryIds) selectedLibraryIds.add(id);
  renderLibraryFromCache();
}

// Auto-corrección silenciosa de canciones con tags rotos o ausentes. Se
// ejecuta en background al abrir la biblioteca para reparar lo que el parser
// viejo dejó mal (artist = "Unknown", título con `�` por bug UTF-16, o
// archivos M4A importados antes de tener parser para ese formato).
//
// Filtros para evitar re-procesar lo que ya está bien:
//   - artist === 'Unknown' o vacío → el parser viejo falló o no había tags
//   - title o artist contienen `�` → parser corrupto v24
//   - flag `_metaParserVersion < 30` → optimización para no re-procesar
//     canciones ya verificadas con el parser actual aunque queden mal por
//     archivos sin tags reales (UI muestra esos como vacío sin reintentar)
//
// El re-parseo solo OK los rotos, no toca los buenos. Tras corregir,
// re-render automático.
async function _autoFixBrokenLibraryTags() {
  if (!window.AudioMetadata || !window.AudioMetadata.extractMetadata) return 0;
  const songs = await dbAll();
  const PARSER_VERSION = 30;  // bump cuando se descubra otro bug del parser
  let fixed = 0;
  for (const s of songs) {
    if (!s.audioBlob) continue;
    const alreadyChecked = (s._metaParserVersion || 0) >= PARSER_VERSION;
    if (alreadyChecked) continue;
    try {
      const meta = await window.AudioMetadata.extractMetadata(s.audioBlob);
      const newTitle = meta.title || s.title;
      const newArtist = meta.artist || s.artist;
      const changed = newTitle !== s.title || newArtist !== s.artist;
      s.title = newTitle;
      s.artist = newArtist;
      s._metaParserVersion = PARSER_VERSION;
      await dbPut(s);
      if (changed) fixed++;
    } catch (err) {
      // Una canción rota no debe parar el batch.
    }
  }
  return fixed;
}

// Limpia los filtros de texto y re-renderiza. Lo expone el "Sin resultados"
// inline para que el usuario tenga una salida rápida cuando se ha pasado
// con un filtro.
function clearLibrarySearch() {
  const t = document.getElementById('librarySearchTitle');
  const a = document.getElementById('librarySearchArtist');
  if (t) t.value = '';
  if (a) a.value = '';
  renderLibraryFromCache();
}

// Listeners de los filtros de texto. La pantalla library-screen vive en
// stepmania-play.html (no en otros HTMLs que carguen library.js), así que
// los inputs pueden no existir — `?.` cubre el caso.
(function bindLibrarySearch() {
  const t = document.getElementById('librarySearchTitle');
  const a = document.getElementById('librarySearchArtist');
  if (!t && !a) return;
  t?.addEventListener('input', renderLibraryFromCache);
  a?.addEventListener('input', renderLibraryFromCache);
})();

// Actualiza el header inline de la card (contador + estado de los botones)
// y propaga el estado tri-state al checkbox maestro (indeterminate es
// propiedad JS pura — se reaplica tras cada innerHTML).
function updateLibraryManageBar() {
  const count = document.getElementById('libraryManageCount');
  const clearBtn = document.getElementById('libraryManageClearBtn');
  const delBtn = document.getElementById('libraryManageDeleteBtn');
  const n = selectedLibraryIds.size;
  if (n === 0) {
    if (count) count.textContent = '';
    if (clearBtn) clearBtn.disabled = true;
    if (delBtn) { delBtn.disabled = true; delBtn.textContent = '🗑 Eliminar seleccionadas'; }
  } else {
    if (count) count.textContent = `${n} ${n === 1 ? 'seleccionada' : 'seleccionadas'}`;
    if (clearBtn) clearBtn.disabled = false;
    if (delBtn) { delBtn.disabled = false; delBtn.textContent = `🗑 Eliminar (${n})`; }
  }
  // Tri-state del checkbox maestro
  const cb = document.getElementById('selectAllVisibleLibrary');
  if (cb) {
    const total = _visibleLibraryIds.length;
    if (total === 0) {
      cb.checked = false; cb.indeterminate = false; cb.disabled = true;
    } else {
      cb.disabled = false;
      const marked = _visibleLibraryIds.filter(id => selectedLibraryIds.has(id)).length;
      if (marked === 0) { cb.checked = false; cb.indeterminate = false; }
      else if (marked === total) { cb.checked = true; cb.indeterminate = false; }
      else { cb.checked = false; cb.indeterminate = true; }
    }
  }
}

async function bulkDeleteFromLibrary() {
  const ids = [...selectedLibraryIds];
  if (!ids.length) return;
  const msg = ids.length === 1
    ? '¿Eliminar 1 canción de la biblioteca?'
    : `¿Eliminar ${ids.length} canciones de la biblioteca? Esta acción no se puede deshacer.`;
  if (!confirm(msg)) return;
  for (const id of ids) {
    await dbDelete(id);
  }
  selectedLibraryIds.clear();
  refreshLibrary();
}

async function deleteSong(id) {
  if (!confirm('¿Eliminar canción de la biblioteca?')) return;
  if (typeof cancelSongPreview === 'function') cancelSongPreview();
  await dbDelete(id);
  selectedLibraryIds.delete(id);
  refreshLibrary();
}

// ----------------------------------------------------------------------------
//  IMPORT — paquete completo (carpeta) + archivos sueltos (.ssc/.sm + audio)
// ----------------------------------------------------------------------------

// ----- Recursive SM pack import ---------------------------------------------
// Uses <input webkitdirectory>: each File carries webkitRelativePath (e.g.
// "Pack/Song1/song.ssc"). Group files by their immediate parent folder, then
// pair each .sm/.ssc with the largest audio file in the same folder
// (heuristic that avoids confusing banner.mp3 with the actual song).
document.getElementById('importPackInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  if (!files.length) return;
  const status = document.getElementById('backupStatus');
  const packName = document.getElementById('packDropName');
  if (packName) packName.textContent = `${files.length} archivos`;
  status.textContent = `Analizando ${files.length} archivos...`;

  // Group by parent folder
  const folders = new Map(); // folder path -> { sscs: [], audios: [] }
  for (const f of files) {
    const path = f.webkitRelativePath || f.name;
    const lastSlash = path.lastIndexOf('/');
    const folder = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
    const lower = f.name.toLowerCase();
    if (!folders.has(folder)) folders.set(folder, { sscs: [], audios: [] });
    const bucket = folders.get(folder);
    if (lower.endsWith('.ssc') || lower.endsWith('.sm')) bucket.sscs.push(f);
    else if (f.type.startsWith('audio/') || /\.(mp3|ogg|wav|flac|m4a)$/i.test(lower)) bucket.audios.push(f);
  }

  // Prefer .ssc over .sm when both exist for the same song.
  let imported = 0, skipped = 0;
  const toProcess = [];
  for (const [folder, b] of folders) {
    if (!b.sscs.length || !b.audios.length) { skipped += b.sscs.length; continue; }
    const ssc = b.sscs.find(f => f.name.toLowerCase().endsWith('.ssc')) || b.sscs[0];
    // Largest audio in this folder is almost certainly the song (banners are tiny)
    const audio = b.audios.slice().sort((x,y) => y.size - x.size)[0];
    toProcess.push({ ssc, audio, folder });
  }

  // Distinguimos QuotaExceededError del resto: en iOS Safari (~50MB total) y
  // en Android con almacenamiento bajo es la causa más común y merece mensaje
  // accionable. Si la cuota truena, parar el bucle (los siguientes también
  // fallarán) y avisar; el resto de errores se cuentan como "omitidas" con
  // motivo agrupado.
  let quotaHit = false;
  const errorReasons = new Map();
  for (const { ssc, audio, folder } of toProcess) {
    if (quotaHit) { skipped++; continue; }
    try {
      const sscText = await ssc.text();
      const parsed = parseSscOrSm(sscText);
      const baseName = ssc.name.replace(/\.[^.]+$/, '');
      const bpm = parseFloat((parsed.header.BPMS || '0=120').split('=')[1]) || 120;
      const offsetSec = -parseFloat(parsed.header.OFFSET || '0');
      const sampleStart = parseFloat(parsed.header.SAMPLESTART || '30');
      const ctx2 = ensureAudioCtx();
      const arrayBuf = await audio.arrayBuffer();
      const decoded = await ctx2.decodeAudioData(arrayBuf.slice(0));
      await dbAdd({
        title: parsed.header.TITLE || baseName,
        artist: parsed.header.ARTIST || folder.split('/').pop() || 'Unknown',
        audioBlob: audio,
        audioName: audio.name,
        sscText,
        bpm, offsetSec,
        duration: decoded.duration,
        sampleStart,
        charts: parsed.charts.map(c => {
          const stepType = (c.STEPSTYPE || 'dance-single');
          const numLanes = (typeof lanesFromStepType === 'function') ? lanesFromStepType(stepType) : 4;
          const emptyRow = '0'.repeat(numLanes);
          return {
            name: c.DIFFICULTY || 'Edit',
            key: (c.DIFFICULTY || 'edit').toLowerCase(),
            rating: parseInt(c.METER || '1') || 1,
            count: (c.NOTES || '').split('\n').filter(r => r.length >= numLanes && r !== emptyRow).length,
            stepType, numLanes
          };
        }),
        tags: [],
        addedAt: Date.now()
      });
      imported++;
      status.textContent = `Importando ${imported}/${toProcess.length}...`;
    } catch (err) {
      skipped++;
      const reason = (err && (err.name || err.constructor && err.constructor.name)) || 'desconocido';
      errorReasons.set(reason, (errorReasons.get(reason) || 0) + 1);
      if (err && err.name === 'QuotaExceededError') quotaHit = true;
    }
  }

  if (quotaHit) {
    const info = await getStorageInfo();
    const used = info ? `${info.usedMB} MB` : 'la cuota disponible';
    status.innerHTML = `<span style="color:var(--color-warning)">⚠️ Almacenamiento lleno tras importar ${imported} canciones. Tu navegador limita la biblioteca a ${used}. Elimina canciones antiguas o haz un backup ZIP y libera espacio antes de seguir.</span>`;
  } else {
    const reasonsText = errorReasons.size
      ? ' (' + [...errorReasons.entries()].map(([k,v]) => `${v}× ${k}`).join(', ') + ')'
      : '';
    status.innerHTML = `<span style="color:var(--color-success)">✓ ${imported} canciones importadas${skipped ? ` · ${skipped} omitidas${reasonsText}` : ''}</span>`;
  }
  // Marcamos visualmente la drop-zone como "loaded" tras un import correcto.
  if (imported > 0) document.getElementById('packDrop')?.classList.add('loaded');
  refreshLibrary();
  e.target.value = '';
});

document.getElementById('importInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  const audioFiles = files.filter(f => f.type.startsWith('audio/'));
  const sscFiles = files.filter(f => f.name.endsWith('.ssc') || f.name.endsWith('.sm'));
  const filesName = document.getElementById('filesDropName');
  if (sscFiles.length === 0 || audioFiles.length === 0) {
    alert('Selecciona al menos un .ssc/.sm y un audio juntos.');
    if (filesName) filesName.textContent = '';
    e.target.value = '';
    return;
  }
  if (filesName) filesName.textContent = `${sscFiles.length} chart${sscFiles.length === 1 ? '' : 's'} + ${audioFiles.length} audio${audioFiles.length === 1 ? '' : 's'}`;
  // Pair them by name (best effort)
  let imported = 0;
  let quotaHit = false;
  let lastError = null;
  for (const sFile of sscFiles) {
    if (quotaHit) break;
    try {
      const sscText = await sFile.text();
      const parsed = parseSscOrSm(sscText);
      const baseName = sFile.name.replace(/\.[^.]+$/, '');
      let audio = audioFiles.find(a => a.name.replace(/\.[^.]+$/, '') === baseName)
               || audioFiles.find(a => a.name === parsed.header.MUSIC)
               || audioFiles[0];
      const bpm = parseFloat((parsed.header.BPMS || '0=120').split('=')[1]) || 120;
      const offsetSec = -parseFloat(parsed.header.OFFSET || '0');
      const sampleStart = parseFloat(parsed.header.SAMPLESTART || '30');
      // Determine duration from audio
      const ctx2 = ensureAudioCtx();
      const arrayBuf = await audio.arrayBuffer();
      const decoded = await ctx2.decodeAudioData(arrayBuf.slice(0));
      await dbAdd({
        title: parsed.header.TITLE || baseName,
        artist: parsed.header.ARTIST || 'Unknown',
        audioBlob: audio,
        audioName: audio.name,
        sscText,
        bpm, offsetSec,
        duration: decoded.duration,
        sampleStart,
        charts: parsed.charts.map(c => {
          const stepType = (c.STEPSTYPE || 'dance-single');
          const numLanes = (typeof lanesFromStepType === 'function') ? lanesFromStepType(stepType) : 4;
          const emptyRow = '0'.repeat(numLanes);
          return {
            name: c.DIFFICULTY || 'Edit',
            key: (c.DIFFICULTY || 'edit').toLowerCase(),
            rating: parseInt(c.METER || '1') || 1,
            count: (c.NOTES || '').split('\n').filter(r => r.length >= numLanes && r !== emptyRow).length,
            stepType, numLanes
          };
        }),
        addedAt: Date.now()
      });
      imported++;
    } catch (err) {
      lastError = err;
      if (err && err.name === 'QuotaExceededError') quotaHit = true;
    }
  }
  if (quotaHit) {
    const info = await getStorageInfo();
    const used = info ? `${info.usedMB} MB` : 'la cuota disponible';
    alert(`Almacenamiento lleno tras importar ${imported} canciones.\n\nTu navegador limita la biblioteca a ${used}. Elimina canciones antiguas o haz un backup ZIP antes de seguir.`);
  } else if (lastError) {
    alert(`${imported} canción(es) importada(s).\nAlgunas fallaron: ${lastError.name || 'error'}.`);
  } else if (imported) {
    document.getElementById('filesDrop')?.classList.add('loaded');
  }
  refreshLibrary();
  e.target.value = '';
});

// ----------------------------------------------------------------------------
//  DRAG-AND-DROP sobre las drop-zones (visual feedback + arrastrar archivos
//  directamente a cualquier zona dispara el input correspondiente). Patrón
//  idéntico al de gh-play.html — los listeners viven en el módulo, no en el
//  HTML, así que se atan solo si los elementos existen (la pantalla library
//  vive en stepmania-play.html; en otros HTMLs que carguen library.js no
//  hay drop-zones y los listeners simplemente no se atan).
// ----------------------------------------------------------------------------
function wireDropZone(dropId, inputId) {
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  if (!drop || !input) return;
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    // Asignar los archivos al input y disparar el change para reusar la
    // lógica de import existente.
    try {
      const dt = new DataTransfer();
      for (const f of e.dataTransfer.files) dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    } catch (err) {
      // DataTransfer no soportado: fallback intentando llamar al handler manualmente
      console.warn('Drop fallback:', err);
    }
  });
}
wireDropZone('filesDrop', 'importInput');
wireDropZone('packDrop', 'importPackInput');
wireDropZone('restoreDrop', 'backupRestoreInput');

// El input backupRestoreInput ya tiene su listener en backup.js. Solo
// añadimos aquí el feedback visual del "loaded" tras seleccionar archivo.
document.getElementById('backupRestoreInput')?.addEventListener('change', e => {
  const name = document.getElementById('restoreDropName');
  if (e.target.files && e.target.files[0]) {
    if (name) name.textContent = e.target.files[0].name;
    document.getElementById('restoreDrop')?.classList.add('loaded');
  }
});

// ----- Modal de puntuaciones de una canción (vista global) ------------------
// Acordeón por dificultad: cada sección muestra el ranking por jugador + las
// últimas 10 partidas. Se reusa la misma clase `.scores-modal` que el modal
// de song-select para coherencia visual.
async function openSongScoresModal(songId) {
  const [song, runsRaw] = await Promise.all([dbGet(songId), dbRunsForSong(songId)]);
  if (!song) return;
  // Filtramos por gameType='sm' — la DB se comparte con GH y los songIds
  // pueden colisionar (autoincrement separado en cada store).
  const runs = filterRunsByGame(runsRaw, 'sm');
  // Agrupamos runs por chartKey y ordenamos cada grupo.
  const byChart = new Map();
  for (const r of runs) {
    if (!byChart.has(r.chartKey)) byChart.set(r.chartKey, []);
    byChart.get(r.chartKey).push(r);
  }
  const _ORDER = ['Beginner','Easy','Medium','Hard','Challenge','Edit'];
  const orderedKeys = Array.from(byChart.keys()).sort((a, b) => {
    const ia = _ORDER.indexOf(a), ib = _ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const sections = orderedKeys.map(chartKey => {
    const chartRuns = byChart.get(chartKey);
    const ranking = bestRunPerPlayer(chartRuns).slice(0, 10);
    const totalPlays = chartRuns.length;
    const rankRows = ranking.map((r, i) => `
      <li class="ranking-row">
        <span class="rank-num">#${i + 1}</span>
        <span class="rank-name">${escapeHtml(r.playerName || 'Anónimo')}</span>
        <span class="rank-grade g-${(r.grade || '').toLowerCase()}">${escapeHtml(r.grade || '—')}</span>
        <span class="rank-score">${(r.score || 0).toLocaleString()}</span>
      </li>`).join('');
    return `
      <details class="scores-modal-chart" open>
        <summary>
          <strong>${escapeHtml(diffLabel(chartKey))}</strong>
          <span class="muted">${totalPlays} partida${totalPlays === 1 ? '' : 's'} · ${ranking.length} jugador${ranking.length === 1 ? '' : 'es'}</span>
        </summary>
        <ol class="ranking-list">${rankRows}</ol>
      </details>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'scores-modal';
  overlay.innerHTML = `
    <div class="scores-modal-inner">
      <button class="scores-modal-close" aria-label="Cerrar">×</button>
      <h2>${escapeHtml(song.title || 'Sin título')}</h2>
      <p class="scores-modal-sub">${escapeHtml(song.artist || 'Unknown')} · ${runs.length} partida${runs.length === 1 ? '' : 's'} en total</p>
      <div class="scores-modal-section">
        ${sections || '<p class="muted">Sin puntuaciones todavía.</p>'}
      </div>
      <div class="scores-modal-actions">
        <button class="action-btn danger scores-clear-btn">Limpiar todas las puntuaciones de esta canción</button>
        <button class="action-btn scores-close-btn">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); refreshLibrary(); };
  overlay.querySelector('.scores-modal-close').addEventListener('click', close);
  overlay.querySelector('.scores-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.scores-clear-btn').addEventListener('click', async () => {
    if (!confirm(`¿Borrar TODAS las puntuaciones de "${song.title}"? Esto no se puede deshacer.`)) return;
    await dbRunsClearForSong(songId);
    close();
  });
}
