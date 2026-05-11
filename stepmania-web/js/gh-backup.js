// ============================================================================
//  GH-BACKUP — exporta toda la biblioteca Guitar Hero (charts + audio +
//  calibración de la guitarra) a un ZIP, y la restaura desde uno previo.
//
//  Equivalente a backup.js (StepMania) pero opera sobre GHLibrary (gh-db.js).
//  Lleva su propio `ghMakeZip`/`ghReadZip` (modo store, sin compresión) para
//  no depender de autostepper.js, que vive en otra página.
// ============================================================================

// ----- ZIP encoder (mode "store", no compression) ---------------------------
// Duplicado funcional de makeZip de autostepper.js. Mantenerlos en sync si
// hay cambios — son 50 líneas de bit-banging del formato ZIP.
let _GH_CRC_TABLE = null;
function _ghCrc32(data) {
  if (!_GH_CRC_TABLE) {
    _GH_CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _GH_CRC_TABLE[n] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ _GH_CRC_TABLE[(crc ^ data[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function ghMakeZip(files) {
  const enc = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = _ghCrc32(data), size = data.length;
    const lh = new Uint8Array(30 + nameBytes.length);
    const lhv = new DataView(lh.buffer);
    lhv.setUint32(0, 0x04034b50, true); lhv.setUint16(4, 20, true);
    lhv.setUint16(6, 0, true); lhv.setUint16(8, 0, true);
    lhv.setUint16(10, 0, true); lhv.setUint16(12, 0x0021, true);
    lhv.setUint32(14, crc, true); lhv.setUint32(18, size, true); lhv.setUint32(22, size, true);
    lhv.setUint16(26, nameBytes.length, true); lhv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    local.push(lh, data);
    const ch = new Uint8Array(46 + nameBytes.length);
    const chv = new DataView(ch.buffer);
    chv.setUint32(0, 0x02014b50, true); chv.setUint16(4, 20, true); chv.setUint16(6, 20, true);
    chv.setUint16(8, 0, true); chv.setUint16(10, 0, true); chv.setUint16(12, 0, true);
    chv.setUint16(14, 0x0021, true); chv.setUint32(16, crc, true);
    chv.setUint32(20, size, true); chv.setUint32(24, size, true);
    chv.setUint16(28, nameBytes.length, true); chv.setUint16(30, 0, true);
    chv.setUint16(32, 0, true); chv.setUint16(34, 0, true);
    chv.setUint16(36, 0, true); chv.setUint32(38, 0, true); chv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  let centralSize = 0; for (const c of central) centralSize += c.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  let total = 0;
  for (const p of local) total += p.length;
  total += centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of local) { out.set(p, pos); pos += p.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

// ----- ZIP reader (store mode only) -----------------------------------------
function ghReadZip(uint8) {
  const dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  let eocdOffset = -1;
  for (let i = uint8.length - 22; i >= Math.max(0, uint8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('ZIP inválido: EOCD no encontrado');
  const numEntries = dv.getUint16(eocdOffset + 10, true);
  const cdOffset   = dv.getUint32(eocdOffset + 16, true);
  const dec = new TextDecoder();
  const out = [];
  let p = cdOffset;
  for (let i = 0; i < numEntries; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP corrupto: entrada CD inválida');
    const method  = dv.getUint16(p + 10, true);
    const sizeU   = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extLen  = dv.getUint16(p + 30, true);
    const cmtLen  = dv.getUint16(p + 32, true);
    const lhOff   = dv.getUint32(p + 42, true);
    const name    = dec.decode(uint8.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error(`ZIP: ${name} usa compresión no soportada (método ${method})`);
    const lhNameLen = dv.getUint16(lhOff + 26, true);
    const lhExtLen  = dv.getUint16(lhOff + 28, true);
    const dataStart = lhOff + 30 + lhNameLen + lhExtLen;
    out.push({ name, data: uint8.subarray(dataStart, dataStart + sizeU) });
    p += 46 + nameLen + extLen + cmtLen;
  }
  return out;
}

// ----- Helpers --------------------------------------------------------------
function _ghSafeFn(s) {
  return String(s || 'song').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}
function _ghGetExt(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  return m ? '.' + m[1].toLowerCase() : '';
}

// ----- Export ----------------------------------------------------------------
async function exportGHBackupZip() {
  const status = document.getElementById('ghBackupStatus');
  const setStatus = (html) => { if (status) status.innerHTML = html; };
  setStatus('Empaquetando biblioteca...');
  if (!window.GHLibrary) {
    setStatus('<span style="color:var(--color-error)">✗ GHLibrary no disponible</span>');
    return;
  }
  const entries = await window.GHLibrary.all();
  const enc = new TextEncoder();
  const files = [];

  // metadata.json incluye la calibración de la guitarra (única configuración
  // persistente que GH guarda en localStorage). El backup permite restaurar
  // todo el flujo: charts + audio + mapping físico de la guitarra.
  let guitarMapping = null;
  try {
    const stored = localStorage.getItem('guitar-mapping');
    if (stored) guitarMapping = JSON.parse(stored);
  } catch (e) { /* mapping inválido → no se incluye, sigue */ }

  const meta = {
    version: 1,
    kind: 'gh-backup',
    exportedAt: new Date().toISOString(),
    guitarMapping,
    songs: []
  };

  for (const e of entries) {
    const folder = _ghSafeFn(e.title) + '_' + e.id;
    const audioExt = _ghGetExt(e.audioName || 'song.mp3') || '.mp3';
    const audioPath = `${folder}/song${audioExt}`;
    const chartPath = `${folder}/notes.chart`;
    const audioBytes = new Uint8Array(await e.audioBlob.arrayBuffer());
    files.push({ name: audioPath, data: audioBytes });
    files.push({ name: chartPath, data: enc.encode(e.chartText || '') });
    meta.songs.push({
      title: e.title, artist: e.artist,
      bpm: e.bpm, duration: e.duration,
      audioName: e.audioName, audioPath, chartPath,
      diffs: e.diffs, totalNotes: e.totalNotes,
      genre: e.genre, charter: e.charter,
      addedAt: e.addedAt
    });
  }
  files.push({ name: 'metadata.json', data: enc.encode(JSON.stringify(meta, null, 2)) });

  const zipBytes = ghMakeZip(files);
  const blob = new Blob([zipBytes], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sincro-gh-backup-${new Date().toISOString().slice(0,10)}.zip`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus(`<span style="color:var(--color-success)">✓ Backup descargado (${(blob.size/1024/1024).toFixed(1)} MB · ${entries.length} chart${entries.length === 1 ? '' : 's'})</span>`);
}

// ----- Import ----------------------------------------------------------------
async function importGHBackupZip(file) {
  const status = document.getElementById('ghBackupStatus');
  const setStatus = (html) => { if (status) status.innerHTML = html; };
  setStatus('Leyendo ZIP...');
  if (!window.GHLibrary) {
    setStatus('<span style="color:var(--color-error)">✗ GHLibrary no disponible</span>');
    return;
  }
  let entries;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    entries = ghReadZip(buf);
  } catch (e) {
    setStatus(`<span style="color:var(--color-error)">✗ ${e.message}</span>`);
    return;
  }
  const dec = new TextDecoder();
  const metaEntry = entries.find(e => e.name === 'metadata.json');
  if (!metaEntry) {
    setStatus('<span style="color:var(--color-error)">✗ ZIP sin metadata.json (¿es un backup de Sincro GH?)</span>');
    return;
  }
  let meta;
  try { meta = JSON.parse(dec.decode(metaEntry.data)); }
  catch (e) {
    setStatus('<span style="color:var(--color-error)">✗ metadata.json malformado</span>');
    return;
  }
  if (meta.kind && meta.kind !== 'gh-backup') {
    setStatus(`<span style="color:var(--color-warning)">⚠️ El ZIP es de ${meta.kind}, no de gh-backup. Aborto.</span>`);
    return;
  }
  // Restaurar la calibración de la guitarra (sobrescribe la actual; el
  // backup es fuente de verdad).
  if (meta.guitarMapping) {
    try { localStorage.setItem('guitar-mapping', JSON.stringify(meta.guitarMapping)); }
    catch (e) { /* quota o storage off → seguimos sin bloquear charts */ }
  }
  let imported = 0;
  for (const songMeta of meta.songs || []) {
    const audioEntry = entries.find(e => e.name === songMeta.audioPath);
    const chartEntry = entries.find(e => e.name === songMeta.chartPath);
    if (!audioEntry || !chartEntry) continue;
    // MIME del blob: si el nombre acaba en .ogg/.wav lo respetamos, si no
    // dejamos audio/mpeg como sensato default (mismo criterio que el
    // autostepper al guardar en biblioteca).
    const ext = _ghGetExt(songMeta.audioName || songMeta.audioPath);
    const mime = ext === '.wav' ? 'audio/wav'
              : ext === '.ogg' ? 'audio/ogg'
              : ext === '.flac' ? 'audio/flac'
              : 'audio/mpeg';
    const audioBlob = new Blob([audioEntry.data], { type: mime });
    const chartText = dec.decode(chartEntry.data);
    try {
      await window.GHLibrary.add({
        title: songMeta.title, artist: songMeta.artist,
        bpm: songMeta.bpm, duration: songMeta.duration,
        chartText, audioBlob, audioName: songMeta.audioName,
        diffs: songMeta.diffs, totalNotes: songMeta.totalNotes,
        genre: songMeta.genre, charter: songMeta.charter,
        addedAt: songMeta.addedAt || Date.now()
      });
      imported++;
      setStatus(`Restaurando ${imported}/${(meta.songs||[]).length}...`);
    } catch (err) {
      console.warn('Error restaurando chart:', err);
      if (err && err.name === 'QuotaExceededError') {
        setStatus(`<span style="color:var(--color-warning)">⚠️ Almacenamiento lleno tras restaurar ${imported} charts. Libera espacio y reintenta.</span>`);
        break;
      }
    }
  }
  setStatus(`<span style="color:var(--color-success)">✓ ${imported} chart${imported === 1 ? '' : 's'} restaurado${imported === 1 ? '' : 's'}</span>`);
  // Refresh UI si estamos viéndolo
  if (typeof refreshManageList === 'function') refreshManageList();
  if (typeof refreshLibraryList === 'function') refreshLibraryList();
}

// Bind del input restore (vive en gh-library-screen) + drag-and-drop sobre
// la drop-zone. Patrón equivalente a wireDropZone() de library.js.
(function wireGHRestoreDrop() {
  const drop = document.getElementById('ghRestoreDrop');
  const input = document.getElementById('ghBackupRestoreInput');
  if (!drop || !input) return;
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    try {
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    } catch (err) {
      // Fallback si el browser no soporta DataTransfer.items.add — llamar directo.
      importGHBackupZip(f);
    }
  });
  input.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const name = document.getElementById('ghRestoreDropName');
    if (name) name.textContent = f.name;
    drop.classList.add('loaded');
    importGHBackupZip(f);
    e.target.value = '';
  });
})();
