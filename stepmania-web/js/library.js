// ============================================================================
//  LIBRARY UI — list/delete songs from IndexedDB, import .ssc/.sm + audio
//  pairs (best-effort name pairing). Uses parseSscOrSm from parser.js.
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

async function refreshLibrary() {
  const c = document.getElementById('libraryContainer');
  c.innerHTML = 'Cargando...';
  const [songs, info] = await Promise.all([dbAll(), getStorageInfo()]);
  const storageBar = info
    ? `<div style="margin-bottom:14px;padding:10px 14px;background:rgba(0,190,200,0.08);border:1px solid rgba(0,190,200,0.2);border-radius:8px;font-size:0.85em;color:var(--gris-300)">
         💾 Librería ocupa <strong style="color:var(--turquesa-400)">${info.usedMB} MB</strong> de ${info.quotaMB} MB disponibles (${info.pct}%)
       </div>` : '';
  if (!songs.length) {
    c.innerHTML = storageBar + '<p style="color:var(--gris-400);text-align:center;padding:30px">Tu librería está vacía. <a href="#" onclick="goto(\'create\')" style="color:var(--turquesa-600)">Crea tu primer chart</a> o <button class="icon-btn" onclick="document.getElementById(\'importInput\').click()">importa archivos</button>.</p>';
    return;
  }
  let html = storageBar + `<div class="queue"><div class="queue-row header"><div>Canción</div><div>BPM</div><div>Duración</div><div>Charts</div><div>Acciones</div></div>`;
  for (const s of songs) {
    html += `<div class="queue-row">
      <div class="name"><div style="font-weight:600">${escapeHtml(s.title)}</div><div style="color:#888;font-size:0.78em">${escapeHtml(s.artist)}</div></div>
      <div>${s.bpm.toFixed(1)}</div>
      <div>${formatTime(s.duration)}</div>
      <div>${s.charts.length}</div>
      <div style="display:flex;gap:4px">
        <button class="icon-btn" onclick="playSong(${s.id})">▶</button>
        <button class="icon-btn danger" onclick="deleteSong(${s.id})">×</button>
      </div>
    </div>`;
  }
  html += '</div>';
  c.innerHTML = html;
}

async function deleteSong(id) {
  if (!confirm('¿Eliminar canción de la librería?')) return;
  await dbDelete(id);
  refreshLibrary();
}

// ----- Recursive SM pack import ---------------------------------------------
// Uses <input webkitdirectory>: each File carries webkitRelativePath (e.g.
// "Pack/Song1/song.ssc"). Group files by their immediate parent folder, then
// pair each .sm/.ssc with the largest audio file in the same folder
// (heuristic that avoids confusing banner.mp3 with the actual song).
document.getElementById('importPackInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  if (!files.length) return;
  const status = document.getElementById('backupStatus');
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
    status.innerHTML = `<span style="color:var(--color-warning)">⚠️ Almacenamiento lleno tras importar ${imported} canciones. Tu navegador limita la librería a ${used}. Elimina canciones antiguas o haz un backup ZIP y libera espacio antes de seguir.</span>`;
  } else {
    const reasonsText = errorReasons.size
      ? ' (' + [...errorReasons.entries()].map(([k,v]) => `${v}× ${k}`).join(', ') + ')'
      : '';
    status.innerHTML = `<span style="color:var(--color-success)">✓ ${imported} canciones importadas${skipped ? ` · ${skipped} omitidas${reasonsText}` : ''}</span>`;
  }
  refreshLibrary();
  e.target.value = '';
});

document.getElementById('importInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  const audioFiles = files.filter(f => f.type.startsWith('audio/'));
  const sscFiles = files.filter(f => f.name.endsWith('.ssc') || f.name.endsWith('.sm'));
  if (sscFiles.length === 0 || audioFiles.length === 0) {
    alert('Selecciona al menos un .ssc/.sm y un audio juntos.');
    return;
  }
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
    alert(`Almacenamiento lleno tras importar ${imported} canciones.\n\nTu navegador limita la librería a ${used}. Elimina canciones antiguas o haz un backup ZIP antes de seguir.`);
  } else if (lastError) {
    alert(`${imported} canción(es) importada(s).\nAlgunas fallaron: ${lastError.name || 'error'}.`);
  } else {
    alert(imported + ' canción(es) importada(s).');
  }
  refreshLibrary();
  e.target.value = '';
});
