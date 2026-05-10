// ============================================================================
//  CORE — globals, utilities, gamepad polling, IndexedDB, settings
//  All names live on window since classic <script> tags share global scope.
// ============================================================================

// ----- Generic utils --------------------------------------------------------
function escapeHtml(s) {
  return String(s||'').replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#39;' }[c]));
}
function formatTime(s) {
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}
function safeFn(s) { return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim() || 'song'; }
function getExt(n) { const m = n.match(/\.[^.]+$/); return m ? m[0] : '.mp3'; }
function yieldUI() { return new Promise(r => setTimeout(r, 0)); }

// ----- Audio context (shared) -----------------------------------------------
// `ensureAudioCtx` es síncrono y devuelve el contexto inmediatamente para
// callers que NO necesitan reproducir (decodeAudioData funciona en estado
// 'suspended'). Para callers que SÍ van a reproducir audio audible, usar
// `ensureAudioCtxRunning()` que además hace el resume — los navegadores
// móviles (iOS Safari, Chrome Android) crean el contexto en 'suspended'
// hasta el primer gesto de usuario, y reproducir en ese estado falla en
// silencio. Centralizar el resume aquí evita que cada call-site lo olvide.
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
async function ensureAudioCtxRunning() {
  const ctx = ensureAudioCtx();
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch (e) { /* puede fallar si no hay gesto */ }
  }
  return ctx;
}

// ----- Gamepad polling (always running) -------------------------------------
// El loop se auto-reagenda con rAF. Pausa automáticamente cuando la pestaña
// está oculta (visibilityState === 'hidden') para no quemar batería en móvil
// ni gastar CPU en background. Se rearranca al volver a 'visible'.
//
// `padPill` puede no existir en páginas que cargan core.js sin la HUD del
// shell (futuras páginas satellite). Se cachea una sola vez y se usa con
// optional chaining para que el polling no muera si falta el elemento.
let gamepadConnected = false;
const gamepadButtonState = new Array(20).fill(false);
const gamepadJustPressed = new Array(20).fill(false);
let _padPillEl = null;
let _gamepadRafId = null;
function _getPadPill() {
  // Cache lazy: el primer DOM lookup se hace en el primer frame, no a
  // module-load (algunas páginas cargan core.js antes del DOM listo).
  if (_padPillEl === null) _padPillEl = document.getElementById('padPill') || false;
  return _padPillEl || null;
}

function pollGamepad() {
  _gamepadRafId = null;
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }

    if (gp) {
      if (!gamepadConnected) {
        gamepadConnected = true;
        const pill = _getPadPill();
        if (pill) {
          pill.textContent = 'alfombra: ' + (gp.id.length > 24 ? gp.id.slice(0,24)+'...' : gp.id);
          pill.classList.remove('off');
        }
      }
      for (let i = 0; i < gp.buttons.length && i < 20; i++) {
        const pressed = gp.buttons[i].pressed || gp.buttons[i].value > 0.5;
        gamepadJustPressed[i] = pressed && !gamepadButtonState[i];
        gamepadButtonState[i] = pressed;
      }
    } else if (gamepadConnected) {
      gamepadConnected = false;
      const pill = _getPadPill();
      if (pill) {
        pill.textContent = 'alfombra: no detectada';
        pill.classList.add('off');
      }
    }
  } catch (e) {
    // No dejamos morir el loop por una excepción transitoria (DOM no listo,
    // gamepad desconectado mid-frame, etc.). Loggeamos en consola y seguimos.
    console.warn('pollGamepad error:', e);
  }
  // Solo reagendamos si la pestaña está visible. visibilitychange dispara el
  // re-arranque cuando el usuario vuelve.
  if (document.visibilityState !== 'hidden') {
    _gamepadRafId = requestAnimationFrame(pollGamepad);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _gamepadRafId === null) {
    _gamepadRafId = requestAnimationFrame(pollGamepad);
  }
});

// ----- IndexedDB: songs + scores + gh-songs (compartida con GH suite) -------
// Schema v3 añade `gh-songs` para la biblioteca de Guitar Hero. La suite GH
// usa stepmania-web/js/gh-db.js para esta misma DB con sus propias funciones.
const DB_NAME = 'StepManiaWebDB';
const DB_VERSION = 3;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
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
  return dbPromise;
}
async function dbAdd(song) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('songs', 'readwrite');
    const req = tx.objectStore('songs').add(song);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function dbAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('songs', 'readonly');
    const req = tx.objectStore('songs').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function dbGet(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('songs', 'readonly');
    const req = tx.objectStore('songs').get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('songs', 'readwrite');
    const req = tx.objectStore('songs').delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
async function dbPut(song) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('songs', 'readwrite');
    const req = tx.objectStore('songs').put(song);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function dbScoreGet(songId, chartKey) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('scores', 'readonly');
    const req = tx.objectStore('scores').get(songId + ':' + chartKey);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}
async function dbScoreSet(songId, chartKey, data) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('scores', 'readwrite');
    const req = tx.objectStore('scores').put({ key: songId+':'+chartKey, songId, chartKey, ...data });
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
async function dbScoresForSong(songId) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('scores', 'readonly');
    const req = tx.objectStore('scores').index('songId').getAll(songId);
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}
async function dbScoreDelete(songId, chartKey) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('scores', 'readwrite');
    const req = tx.objectStore('scores').delete(songId + ':' + chartKey);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

// ----- Settings (localStorage) ----------------------------------------------
const SETTINGS_KEY = 'stepmania-web-settings';
const settings = Object.assign({
  globalOffset: 0,    // ms
  scrollSpeed: 1.0,
  timingWindow: 'j5',
}, (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch(e) { return {}; } })());

const TIMING_WIN_LABEL = { j4:'J4 (suave)', j5:'J5 (SM5)', j6:'J6 (estricto)', j7:'J7 (ITG pro)' };

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch(e) {}
}

// ----- Navigation token (cancellation for in-flight async work) -------------
// Sin framework no hay "esta navegación canceló esa promesa". Cada goto()
// bumpea _navToken; las funciones async largas (startGame, decodeAudioData,
// loadSongPreview) capturan el token al inicio y verifican después de cada
// await que sigue siendo el actual. Si no, abandonan limpiamente sin tocar
// estado de UI que ahora pertenece a otra pantalla.
let _navToken = 0;
function bumpNavToken() { return ++_navToken; }
function isCurrentNav(token) { return token === _navToken; }
function currentNavToken() { return _navToken; }
function openSettings() {
  document.getElementById('settingsModal').classList.add('show');
  document.getElementById('globalOffset').value = settings.globalOffset;
  document.getElementById('globalOffsetVal').textContent = settings.globalOffset + ' ms';
  document.getElementById('scrollSpeed').value = settings.scrollSpeed;
  document.getElementById('scrollSpeedVal').textContent = settings.scrollSpeed.toFixed(1) + 'x';
  document.getElementById('timingWindow').value = settings.timingWindow;
  document.getElementById('timingWinVal').textContent = TIMING_WIN_LABEL[settings.timingWindow] || 'J5';
}
function closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }
