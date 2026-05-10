// ============================================================================
//  APP — top-level navigation, settings modal bindings, app kickoff.
//  Loaded LAST: depends on every other module being defined.
// ============================================================================

const SCREENS = ['menu', 'pad', 'create', 'library', 'songs', 'diff', 'play', 'results', 'calib', 'tutorial'];
const CRUMBS = {
  menu: '', pad: 'Test de alfombra', create: 'Crear coreografías',
  library: 'Librería', songs: 'Jugar', diff: 'Dificultad',
  play: 'Jugando', results: 'Resultados', calib: 'Calibración',
  tutorial: 'Tutorial'
};
let currentScreen = 'menu';

function goto(name) {
  if (currentScreen === 'play' && name !== 'play') stopGame();
  if (currentScreen === 'songs' && name !== 'songs') {
    if (typeof cancelSongPreview === 'function') cancelSongPreview();
    // Cancelar el preview-loop al salir de songs-screen para no quemar GPU
    if (typeof _stopPreviewLoop === 'function') _stopPreviewLoop();
  }
  for (const s of SCREENS) {
    document.getElementById(s + '-screen').classList.toggle('hidden', s !== name);
  }
  currentScreen = name;
  document.getElementById('crumb').textContent = CRUMBS[name] ? '· ' + CRUMBS[name] : '';
  if (name === 'library') refreshLibrary();
  if (name === 'songs')   {
    refreshSongs();
    if (typeof bindSongsScreenConfig === 'function') bindSongsScreenConfig();
    // Arrancar el preview-loop al entrar a songs-screen
    if (typeof _startPreviewLoop === 'function') _startPreviewLoop();
  }
  if (name === 'diff')    renderDiffScreen();
  if (name === 'play')    startGame();
}

// ----- Settings modal bindings (live update + persist) ----------------------
(function bindSettingsControls() {
  const go = document.getElementById('globalOffset');
  if (!go) return;
  go.addEventListener('input', e => {
    settings.globalOffset = parseInt(e.target.value);
    document.getElementById('globalOffsetVal').textContent = settings.globalOffset + ' ms';
    saveSettings();
  });
  document.getElementById('scrollSpeed').addEventListener('input', e => {
    settings.scrollSpeed = parseFloat(e.target.value);
    document.getElementById('scrollSpeedVal').textContent = settings.scrollSpeed.toFixed(1) + 'x';
    saveSettings();
  });
  document.getElementById('timingWindow').addEventListener('change', e => {
    settings.timingWindow = e.target.value;
    document.getElementById('timingWinVal').textContent = TIMING_WIN_LABEL[settings.timingWindow] || 'J5';
    saveSettings();
  });
})();

// ----- NoteSkin upload (PNG) ------------------------------------------------
function clearNoteskinUi() {
  if (typeof clearNoteskin === 'function') clearNoteskin();
  document.getElementById('noteskinStatus').textContent = 'por defecto';
}
document.getElementById('noteskinInput')?.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  if (typeof setNoteskinFromFile === 'function') setNoteskinFromFile(f);
  document.getElementById('noteskinStatus').textContent = f.name.length > 18 ? f.name.slice(0,18)+'...' : f.name;
  e.target.value = '';
});

// ----- Background upload (image or video) -----------------------------------
function clearBgUi() {
  if (typeof clearBg === 'function') clearBg();
  document.getElementById('bgStatus').textContent = 'procedural';
}
document.getElementById('bgInput')?.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  if (typeof setBgFromFile === 'function') setBgFromFile(f);
  document.getElementById('bgStatus').textContent = f.name.length > 18 ? f.name.slice(0,18)+'...' : f.name;
  e.target.value = '';
});

// ----- Auto-detect audio latency --------------------------------------------
//   baseLatency = browser-imposed minimum buffer (typically ~5ms in Chrome)
//   outputLatency = real hardware delay (drivers + DAC + speakers; 30-300ms)
//   Their sum is the offset the user is "behind" the audio. We push it into
//   globalOffset as a starting point — fine-tune via the calibration screen.
function autoDetectLatency() {
  const ctx = ensureAudioCtx();
  const hint = document.getElementById('autoLatencyHint');
  const base = (ctx.baseLatency || 0) * 1000;
  const out  = (ctx.outputLatency || 0) * 1000;
  const total = Math.round(base + out);
  if (total === 0) {
    hint.textContent = 'Tu navegador no expone outputLatency (Safari/Firefox antiguos). Usa la calibración manual.';
    hint.style.color = 'var(--color-warning)';
    return;
  }
  const clamped = Math.max(-200, Math.min(200, total));
  settings.globalOffset = clamped;
  document.getElementById('globalOffset').value = clamped;
  document.getElementById('globalOffsetVal').textContent = clamped + ' ms';
  saveSettings();
  hint.textContent = `base ${base.toFixed(1)}ms + output ${out.toFixed(1)}ms = ${total}ms aplicado.`;
  hint.style.color = 'var(--color-success)';
}

// ----- Kickoff ---------------------------------------------------------------
pollGamepad();   // start gamepad RAF loop (defined in core.js)
padTestLoop();   // start pad-test RAF loop (defined in pad-test.js)

// Si la URL incluye ?screen=tutorial (o cualquier screen válida), abrimos
// directo allí. Permite a los archivos satellite (gh-play, gh-autostepper,
// test-pad) enlazar a screens concretas del SPA con `play.html?screen=X`.
const _initialScreen = (() => {
  const want = new URLSearchParams(window.location.search).get('screen');
  return SCREENS.includes(want) ? want : 'menu';
})();
goto(_initialScreen);
