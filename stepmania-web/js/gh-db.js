// ============================================================================
//  GH DB — IndexedDB para biblioteca de charts Guitar Hero (.chart).
//
//  Comparte la base de datos `StepManiaWebDB` con la suite SM (core.js abre
//  la misma DB, mismo nombre). Para evitar conflictos de version y schema:
//
//   - Si core.js (SM) NO ha abierto la DB todavía, la abrimos nosotros con
//     version 3 y creamos todos los stores que conocemos (`songs`, `scores`,
//     `gh-songs`). core.js cuando se cargue después usará la misma instancia.
//   - Si core.js ya la abrió con version 2 (sin gh-songs), forzamos un
//     upgrade a version 3 que añade `gh-songs` sin tocar `songs`/`scores`.
//
//  Schema de un entry en `gh-songs`:
//   {
//     id: autoincrement,
//     title: string,
//     artist: string,
//     bpm: number,
//     duration: number (segundos),
//     chartText: string (notes.chart completo),
//     audioBlob: Blob (mp3/ogg/wav),
//     audioName: string (filename original con extensión),
//     diffs: ['EasySingle','MediumSingle','HardSingle','ExpertSingle'],
//     totalNotes: number (suma de todas las dificultades),
//     addedAt: timestamp ms
//   }
// ============================================================================

const GH_DB_NAME = 'StepManiaWebDB';
const GH_DB_VERSION = 3;
let _ghDbPromise = null;

function ghOpenDB() {
  if (_ghDbPromise) return _ghDbPromise;
  _ghDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(GH_DB_NAME, GH_DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // Garantizar todos los stores que la suite usa (idempotente)
      if (!db.objectStoreNames.contains('songs')) {
        db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('scores')) {
        const ss = db.createObjectStore('scores', { keyPath: 'key' });
        ss.createIndex('songId', 'songId', { unique: false });
      }
      if (!db.objectStoreNames.contains('gh-songs')) {
        db.createObjectStore('gh-songs', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
  return _ghDbPromise;
}

async function ghDbAdd(entry) {
  const db = await ghOpenDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('gh-songs', 'readwrite');
    const req = tx.objectStore('gh-songs').add({
      ...entry,
      addedAt: entry.addedAt || Date.now()
    });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function ghDbAll() {
  const db = await ghOpenDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('gh-songs', 'readonly');
    const req = tx.objectStore('gh-songs').getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}

async function ghDbGet(id) {
  const db = await ghOpenDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('gh-songs', 'readonly');
    const req = tx.objectStore('gh-songs').get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}

async function ghDbDelete(id) {
  const db = await ghOpenDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('gh-songs', 'readwrite');
    const req = tx.objectStore('gh-songs').delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

// Helper: extrae metadata del .chart text para guardar como entry de biblioteca.
// Lo usan tanto gh-autostepper (al guardar) como gh-play (al cargar para mostrar).
function ghExtractChartMeta(chartText) {
  const meta = { name: '', artist: '', bpm: 120, diffs: [], totalNotes: 0 };
  // Parsear [Song] header rápido
  const songMatch = chartText.match(/\[Song\]\s*\{([^}]*)\}/);
  if (songMatch) {
    const body = songMatch[1];
    const nameMatch = body.match(/Name\s*=\s*"([^"]*)"/);
    const artistMatch = body.match(/Artist\s*=\s*"([^"]*)"/);
    if (nameMatch) meta.name = nameMatch[1];
    if (artistMatch) meta.artist = artistMatch[1];
  }
  // SyncTrack: primer BPM
  const syncMatch = chartText.match(/\[SyncTrack\]\s*\{([\s\S]*?)\}/);
  if (syncMatch) {
    const bpmLine = syncMatch[1].match(/0\s*=\s*B\s+(\d+)/);
    if (bpmLine) meta.bpm = parseInt(bpmLine[1]) / 1000;
  }
  // Difficulties + total notas + breakdown por dificultad.
  // Agrupamos por tick para que un chord (varias líneas N con mismo tick) cuente
  // como UNA nota — alineado con `parseChart` en gh-play.html que también agrupa
  // por tick. Sin esto, `totalNotes` mostraba un número inflado vs lo que el HUD
  // del motor enseña al jugar, y los acordes hacían que el resumen final pareciera
  // "perder" notas (e.g., setup decía 58, el juego terminaba en 56-57).
  // Solo cuenta frets 0..4 (los 5/6 son flags forceHopo/Tap, 7 es open note y
  // tampoco genera nota propia salvo para el counting puro — lo dejamos fuera
  // porque parseChart actual descarta open notes en gh-play).
  const diffs = ['EasySingle','MediumSingle','HardSingle','ExpertSingle'];
  meta.notesByDiff = {};
  for (const d of diffs) {
    const re = new RegExp('\\[' + d + '\\]\\s*\\{([\\s\\S]*?)\\}', 'm');
    const m = chartText.match(re);
    if (m) {
      meta.diffs.push(d);
      const ticks = new Set();
      const lineRe = /^\s*(\d+)\s*=\s*N\s+(\d+)\s+\d+/gm;
      let lm;
      while ((lm = lineRe.exec(m[1])) !== null) {
        const fret = parseInt(lm[2]);
        if (fret > 4) continue; // 5/6 son flags, 7 es open — no son notas jugables
        ticks.add(lm[1]);
      }
      meta.notesByDiff[d] = ticks.size;
      meta.totalNotes += ticks.size;
    }
  }
  return meta;
}

// Expone API global
window.GHLibrary = {
  open: ghOpenDB,
  add: ghDbAdd,
  all: ghDbAll,
  get: ghDbGet,
  delete: ghDbDelete,
  extractMeta: ghExtractChartMeta
};
