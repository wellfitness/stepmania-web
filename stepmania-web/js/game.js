// ============================================================================
//  GAME ENGINE (Player) — countdown → audio start → main loop with lane
//  judging, holds/rolls lifecycle, mine penalty, render (receptors, holds,
//  notes, hit FX, beat pulse), and end-of-song scoring + persistence.
//  Timing windows scale per settings.timingWindow (J4..J7 = SM5/ITG presets).
// ============================================================================

// Base windows match SM5 J5 (in seconds); scale with TIMING_SCALE per judge level.
const TIMING_BASE = {
  marvelous: 0.0225, perfect: 0.045, great: 0.090, good: 0.135, bad: 0.180, mine: 0.071
};
const TIMING_SCALE = { j4: 1.50, j5: 1.00, j6: 0.84, j7: 0.66 };
function getTimingWindows() {
  const k = TIMING_SCALE[settings.timingWindow] || 1.0;
  const r = {};
  for (const t in TIMING_BASE) r[t] = TIMING_BASE[t] * k;
  return r;
}
const SCORES = { marvelous: 1000, perfect: 800, great: 500, good: 200, bad: 50, miss: 0 };
const HOLD_LIFE = 0.300; // seconds you can release before hold goes NG (StepMania default ~0.3s)

// All lane-count-dependent constants live here. Single source of truth.
//   4 — dance-single (cardinals)
//   6 — dance-solo  (cardinals + ↖ ↗)             column order: L ↖ U D ↗ R
//   8 — dance-double (cardinals + 4 diagonals)    column order: L ↖ ↙ U D ↗ ↘ R
// keyMap uses event.code (ArrowLeft, KeyQ...). padMap maps lane→gamepad button index.
const LANE_CONFIGS = {
  4: {
    lanes: 4,
    keyMap:    ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'],
    padMap:    [0, 1, 2, 3],
    rotations: [-90, 180, 0, 90],
    tints:     ['#ff006e', '#3a86ff', '#00ff64', '#ffbe0b'],
    mirrorPerm:[3, 2, 1, 0],
    leftPerm:  [1, 3, 0, 2],
    rightPerm: [2, 0, 3, 1],
    label:     'Single (4)',
    stepType:  'dance-single'
  },
  6: {
    lanes: 6,
    keyMap:    ['ArrowLeft', 'KeyQ', 'ArrowUp', 'ArrowDown', 'KeyE', 'ArrowRight'],
    padMap:    [0, 4, 2, 1, 5, 3],
    rotations: [-90, -45, 0, 180, 45, 90],
    tints:     ['#ff006e', '#a259ff', '#00ff64', '#3a86ff', '#ffbe0b', '#ff8800'],
    mirrorPerm:[5, 4, 3, 2, 1, 0],
    leftPerm:  [3, 0, 5, 1, 2, 4],   // approx CCW: down→left, ul→down, etc
    rightPerm: [1, 3, 4, 0, 5, 2],   // approx CW
    label:     'Solo (6)',
    stepType:  'dance-solo',
    _diagonalLayout: 'up'
  },
  // Variante de Solo (6) para alfombras que tienen solo diagonales
  // inferiores (típico en mats baratos de 6 botones: cardinales + ↙ ↘).
  // Las flechas diagonales en pantalla apuntan ↙ y ↘ (rotaciones -135° y
  // 135°) en lugar de ↖ y ↗. Misma paleta de colores que el 6 estándar para
  // que la usuaria sienta continuidad visual entre cardinales y diagonales.
  // El motor selecciona esta config automáticamente cuando el mat-mapping
  // del usuario tiene downLeft+downRight asignados pero no upLeft+upRight.
  '6-down': {
    lanes: 6,
    keyMap:    ['ArrowLeft', 'KeyQ', 'ArrowUp', 'ArrowDown', 'KeyE', 'ArrowRight'],
    padMap:    [0, 6, 2, 1, 7, 3],
    rotations: [-90, -135, 0, 180, 135, 90],
    tints:     ['#ff006e', '#a259ff', '#00ff64', '#3a86ff', '#ffbe0b', '#ff8800'],
    mirrorPerm:[5, 4, 3, 2, 1, 0],
    leftPerm:  [3, 0, 5, 1, 2, 4],
    rightPerm: [1, 3, 4, 0, 5, 2],
    label:     'Solo (6) ↙↘',
    stepType:  'dance-solo',
    _diagonalLayout: 'down'
  },
  8: {
    lanes: 8,
    keyMap:    ['ArrowLeft', 'KeyQ', 'KeyZ', 'ArrowUp', 'ArrowDown', 'KeyE', 'KeyC', 'ArrowRight'],
    padMap:    [0, 4, 6, 2, 1, 5, 7, 3],
    rotations: [-90, -45, -135, 0, 180, 45, 135, 90],
    tints:     ['#ff006e', '#a259ff', '#ff66c4', '#00ff64', '#3a86ff', '#ffbe0b', '#ff8800', '#00f5d4'],
    mirrorPerm:[7, 6, 5, 4, 3, 2, 1, 0],
    leftPerm:  [4, 1, 0, 3, 5, 7, 6, 2],
    rightPerm: [3, 1, 7, 6, 0, 5, 2, 4],
    label:     'Full (8)',
    stepType:  'dance-double',
    _diagonalLayout: 'both'
  }
};
function getActiveLaneConfig(nativeLanes) {
  // Runtime decides lane count via mods. Default is always 4 (clásico), the
  // chart's nativeLanes is just the "master" complexity from which we
  // redistribute. Authoring at 8 + playing default 4 = compress 8→4 every play.
  //
  // Para Solo (6), consultamos la calibración de la alfombra del usuario:
  // si tiene solo diagonales inferiores asignadas (mat barato 6-button), el
  // motor devuelve la variante '6-down' para que las flechas en pantalla
  // apunten ↙↘ en vez de ↖↗ — la usuaria pisa donde su lona dice y juega
  // sin volver la alfombra del revés. Si tiene las superiores (o ambas, o
  // ninguna), devolvemos el Solo canónico DDR (↖↗).
  if (typeof activeMods !== 'undefined') {
    if (activeMods.full) return LANE_CONFIGS[8];
    if (activeMods.solo) {
      const layout = (typeof window !== 'undefined' && window.MatLayout)
        ? window.MatLayout.detectMatDiagonalLayout()
        : 'up';
      return layout === 'down' ? LANE_CONFIGS['6-down'] : LANE_CONFIGS[6];
    }
  }
  return LANE_CONFIGS[4];
}

// Mapa columna→rol de calibración. Los roles ('left', 'upLeft', etc.) son los
// que guarda test-pad.html en localStorage['mat-mapping']. Imprescindible para
// que un pad recalibrado (alfombras chinas, ImpactDX, Cobalt Flux…) funcione
// en el juego: sin esto, el motor lee `padMap` hardcoded y las diagonales que
// el usuario asignó a botones distintos no se reconocen.
//
// Indexado por (lanes, _diagonalLayout) porque el Solo (6) tiene dos
// variantes según qué diagonales tenga la alfombra: la columna 1 puede ser
// 'upLeft' (cabinet DDR) o 'downLeft' (mat barato 6-button), análogo para 4.
function getMatRolesForConfig(cfg) {
  if (cfg.lanes === 4) return ['left', 'down', 'up', 'right'];
  if (cfg.lanes === 8) return ['left', 'upLeft', 'downLeft', 'up', 'down', 'upRight', 'downRight', 'right'];
  if (cfg.lanes === 6) {
    return cfg._diagonalLayout === 'down'
      ? ['left', 'downLeft', 'up', 'down', 'downRight', 'right']
      : ['left', 'upLeft', 'up', 'down', 'upRight', 'right'];
  }
  return null;
}

// Devuelve una COPIA superficial del laneConfig con `padMap` reescrito según la
// calibración del usuario (si existe). Cualquier rol sin asignar conserva el
// valor por defecto de LANE_CONFIGS — degrada gracefully cuando no hay
// calibración o solo se calibraron algunos paneles.
function applyMatCalibrationToConfig(cfg) {
  let mapping = null;
  try {
    const raw = localStorage.getItem('mat-mapping');
    if (raw) mapping = JSON.parse(raw);
  } catch (e) { /* localStorage o JSON corruptos: cae al default */ }
  if (!mapping) return cfg;
  const roles = getMatRolesForConfig(cfg);
  if (!roles) return cfg;
  const padMap = cfg.padMap.slice();
  for (let i = 0; i < roles.length; i++) {
    const btn = mapping[roles[i]];
    if (typeof btn === 'number' && btn >= 0 && btn < 20) padMap[i] = btn;
  }
  return { ...cfg, padMap };
}

let gameState = null;
const canvas = document.getElementById('gameCanvas');
const ctx2d = canvas.getContext('2d');
let canvasW = 0, canvasH = 0;
// Sizing del playfield. Modelo "lane-width-first": cada carril intenta tener
// un ancho ideal CONSTANTE (~220 px), y el playfield total crece con
// numLanes. Así un chart Full (8 carriles) ocupa el doble de ancho que un
// chart clásico (4 carriles) pero cada flecha conserva su tamaño en pantalla.
//
//   target     = numLanes × LANE_WIDTH_IDEAL
//   maxPlayfield = canvasW × 0.92        (deja margen para no tocar bordes)
//   minPlayfield = 540                    (mínimo legible incluso en 4 lanes)
//   playfieldW = clamp(minPlayfield, target, maxPlayfield)
//   laneWidth  = playfieldW / numLanes
//   ARROW_SIZE = laneWidth × 0.78         (deja ~22% de respiro entre lanes)
//
// Histórico: antes el playfield era FIJO (clamp 540..1040 sin tocar numLanes)
// para evitar solapar el HUD lateral. El HUD se reubicó a footer hace tiempo
// y esa restricción desapareció, así que el modo Solo/Full ya no necesita
// "comprimir" las flechas.
//
// En portátiles estrechos o tablets, el target puede exceder maxPlayfield;
// el clamp superior reduce proporcionalmente pero el resultado SIGUE siendo
// más grande que el modelo viejo (que estaba clampeado a canvasW × 0.5).
//
// uiScale se mantiene solo para receptorY (margen superior — no afecta a
// la geometría de los lanes).
const LANE_WIDTH_IDEAL = 220;
let uiScale = 1;
let playfieldW = 540;
let ARROW_SIZE = 56;
function recomputePlayfieldSize() {
  uiScale = Math.max(1, Math.min(1.6, canvasW / 1100));
  const numLanes = (gameState && gameState.laneConfig) ? gameState.laneConfig.lanes : 4;
  const target = numLanes * LANE_WIDTH_IDEAL;
  const maxPlayfield = canvasW * 0.92;
  playfieldW = Math.max(540, Math.min(target, maxPlayfield));
  ARROW_SIZE = Math.round((playfieldW / numLanes) * 0.78);
  buildArrowSprites();
}
function resizeCanvas() {
  // Reservamos 52px abajo para el footer .gameHUD, que es position:fixed.
  // Sin esto las notas que aún no han llegado al receptor (viven en la mitad
  // inferior del canvas mientras caen) se ocultarían tras el footer.
  const HUD_FOOTER_H = 52;
  canvasW = canvas.width = window.innerWidth;
  canvasH = canvas.height = Math.max(200, window.innerHeight - HUD_FOOTER_H);
  recomputePlayfieldSize();
}
window.addEventListener('resize', resizeCanvas);

// ----- Pre-rendered arrow sprite cache (rotated per lane) -------------------
// Cache key is rotation+color (not lane index) so the same rotation is
// reused across configs (e.g. lane 0 in single and lane 0 in solo are both
// the "left" arrow at -90°). Sprites get rebuilt on canvas resize.
const arrowSpriteCache = new Map();
function buildArrowSprites() { arrowSpriteCache.clear(); }

// Optional user-uploaded NoteSkin PNG. If present, overrides the polygonal
// sprite. Color tint is applied via 'source-atop' overlay so quant colors
// still work. Persisted in localStorage as a dataURL.
const NOTESKIN_KEY = 'stepmania-web-noteskin';
let noteskinImage = null;
(function loadNoteskinIfStored() {
  try {
    const stored = localStorage.getItem(NOTESKIN_KEY);
    if (!stored) return;
    const img = new Image();
    img.onload = () => { noteskinImage = img; arrowSpriteCache.clear(); };
    img.src = stored;
  } catch (e) {}
})();
function setNoteskinFromFile(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try { localStorage.setItem(NOTESKIN_KEY, fr.result); } catch (e) {}
    const img = new Image();
    img.onload = () => { noteskinImage = img; arrowSpriteCache.clear(); };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}
function clearNoteskin() {
  try { localStorage.removeItem(NOTESKIN_KEY); } catch (e) {}
  noteskinImage = null;
  arrowSpriteCache.clear();
}

// ----- Optional global background image -------------------------------------
// Persisted as dataURL in localStorage. Falls back to a per-song procedural
// gradient (drawProceduralBg) when nothing is loaded, so the play screen
// never looks like flat black. Video was intentionally removed — too costly
// to drawImage every frame and distracts from the rhythm focus.
const BG_KEY = 'stepmania-web-bg-data';
let bgImage = null;
(function loadStoredBg() {
  try {
    // Cleanup leftover key from older versions that supported video BG
    localStorage.removeItem('stepmania-web-bg-type');
    const data = localStorage.getItem(BG_KEY);
    if (!data) return;
    const img = new Image();
    img.onload = () => { bgImage = img; };
    img.src = data;
  } catch (e) {}
})();
function setBgFromFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      bgImage = img;
      try { localStorage.setItem(BG_KEY, fr.result); } catch(e) {}
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}
function clearBg() {
  bgImage = null;
  try { localStorage.removeItem(BG_KEY); } catch(e) {}
}

// Per-song procedural background — derives 2 hue values from title hash
// for a unique gradient. Works as a deterministic visual identity per song.
function drawProceduralBg(W, H, title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0;
  const h1 = ((hash >>> 0) % 360);
  const h2 = ((hash >>> 8) % 360);
  const grad = ctx2d.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `hsl(${h1}, 50%, 8%)`);
  grad.addColorStop(1, `hsl(${h2}, 50%, 4%)`);
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(0, 0, W, H);
}
function getArrowSprite(rotation, color) {
  const key = rotation + '_' + color + (noteskinImage ? '_png' : '');
  let s = arrowSpriteCache.get(key);
  if (s) return s;
  const c = document.createElement('canvas');
  c.width = c.height = ARROW_SIZE;
  const cx = c.getContext('2d');
  // PNG noteskin path — draw image rotated, then tint with quant color
  if (noteskinImage) {
    cx.translate(ARROW_SIZE/2, ARROW_SIZE/2);
    cx.rotate(rotation * Math.PI/180);
    cx.drawImage(noteskinImage, -ARROW_SIZE/2, -ARROW_SIZE/2, ARROW_SIZE, ARROW_SIZE);
    // Tint: only paints where the image already has alpha
    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle = color;
    cx.globalAlpha = 0.55;
    cx.fillRect(-ARROW_SIZE/2, -ARROW_SIZE/2, ARROW_SIZE, ARROW_SIZE);
    arrowSpriteCache.set(key, c);
    return c;
  }
  cx.translate(ARROW_SIZE/2, ARROW_SIZE/2);
  cx.rotate(rotation * Math.PI/180);
  // Up-pointing arrow
  const r = ARROW_SIZE/2 - 4;
  cx.fillStyle = color;
  cx.strokeStyle = '#000';
  cx.lineWidth = 2;
  cx.beginPath();
  cx.moveTo(0, -r);                 // tip
  cx.lineTo(r*0.85, -r*0.05);
  cx.lineTo(r*0.40, -r*0.05);
  cx.lineTo(r*0.40,  r*0.85);
  cx.lineTo(-r*0.40, r*0.85);
  cx.lineTo(-r*0.40, -r*0.05);
  cx.lineTo(-r*0.85, -r*0.05);
  cx.closePath();
  cx.fill();
  cx.stroke();
  // Glossy highlight
  cx.fillStyle = 'rgba(255,255,255,0.25)';
  cx.beginPath();
  cx.moveTo(0, -r*0.85);
  cx.lineTo(r*0.55, -r*0.15);
  cx.lineTo(r*0.20, -r*0.15);
  cx.lineTo(r*0.20,  r*0.55);
  cx.lineTo(0, r*0.55);
  cx.closePath();
  cx.fill();
  arrowSpriteCache.set(key, c);
  return c;
}

resizeCanvas();

// ----- Game lifecycle --------------------------------------------------------
// startGame() puede tardar 1-3s entre awaits (resume, arrayBuffer, decodeAudioData,
// runCountdown). Si el usuario navega a otra pantalla durante ese intervalo,
// `goto()` bumpea el navToken — capturamos el token al inicio y verificamos
// tras cada await; si ya no es el actual, abandonamos sin tocar UI ni crear
// gameState. Sin esto, una promesa abandonada terminaba creando un loop
// fantasma sobre la pantalla equivocada.
//
// Errores en decodeAudioData (formato corrupto, OGG en iOS Safari…) se
// capturan en el try/catch externo y se muestran al usuario en la pantalla
// `diff` con mensaje accionable, no como pantalla negra silenciosa.
async function startGame() {
  if (!selectedSong || !selectedChart) { goto('songs'); return; }
  const myNavToken = currentNavToken();
  const aborted = () => !isCurrentNav(myNavToken);
  try {
    resizeCanvas();
    await ensureAudioCtxRunning();
    if (aborted()) return;

    // Decode audio
    const arrayBuf = await selectedSong.audioBlob.arrayBuffer();
    if (aborted()) return;
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));
    if (aborted()) return;

  // Parse chart from sscText with timing engine
  const parsed = parseSscOrSm(selectedSong.sscText);
  const chartData = parsed.charts.find(c => (c.DIFFICULTY||'').toLowerCase() === selectedChart.key) || parsed.charts[0];
  const tEngine = buildTimingEngine(parsed.header, chartData);
  // Parse #ATTACKS — chart-level overrides song-level. Stored on gameState
  // and applied per-frame in gameLoop. Snapshot user mods so attacks don't
  // permanently mutate them across plays.
  const attacks = parseAttacks((chartData && chartData.ATTACKS) || parsed.header.ATTACKS || '');
  const baseMods = { ...activeMods };
  const parseRes = parseNotesToEvents(chartData.NOTES, tEngine, chartData);
  let notes = parseRes.notes;
  const nativeLanes = parseRes.numLanes;
  // Resolve which lane config we'll actually play with: solo/full mods override
  // the chart's native lane count by REDISTRIBUTING notes; otherwise we play
  // with whatever the chart was authored for.
  const laneConfig = applyMatCalibrationToConfig(getActiveLaneConfig(nativeLanes));
  if (laneConfig.lanes !== nativeLanes) {
    // Redistribute notes from `nativeLanes` to `laneConfig.lanes`. Fixed mode
    // (random per song-id+noteIndex) gives memorable charts; full random mode
    // re-shuffles every play.
    const fixedSeed = !!activeMods.randomFixed;
    const songSeed = (selectedSong.id || 0) + ':' + (selectedSong.title || '');
    // Group hold-tail to its head: same-lane mapping per beat.
    // Approach: for each unique (beat, originalLane) pair pick one new lane
    // and apply it consistently (so head + tail map to same target).
    const remap = new Map();
    notes.forEach((n, idx) => {
      const key = n.beat + ':' + n.lane;
      if (!remap.has(key)) {
        let target;
        if (fixedSeed) {
          let h = 0; const s = songSeed + ':' + key;
          for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
          target = Math.abs(h) % laneConfig.lanes;
        } else {
          target = Math.floor(Math.random() * laneConfig.lanes);
        }
        remap.set(key, target);
      }
      n.lane = remap.get(key);
    });
  }
  // Apply lane permutation modifiers (mirror/left/right/shuffle) on the FINAL lane count
  if (activeMods.shuffle) rerollShuffle(laneConfig.lanes);
  for (const n of notes) n.lane = applyModsToLane(n.lane, laneConfig.lanes);
  // Mark each note with judging/hold state
  for (const n of notes) {
    n.judged = null;
    n.holdState = null;       // 'active' | 'released-grace' | 'ok' | 'ng'
    n.lastHoldHeldAt = null;
  }
  notes.sort((a,b) => a.time - b.time);

  // Compute beat times for receptor pulse
  const beatTimes = [];
  const totalBeats = Math.ceil((audioBuffer.duration + 2) * tEngine.bpmAtBeat(0) / 60);
  for (let b = 0; b < totalBeats; b++) {
    const t = tEngine.beatToTime(b);
    if (t !== null && t >= 0 && t < audioBuffer.duration + 2) beatTimes.push(t);
  }

  // Countdown 3-2-1-GO before starting audio
  await runCountdown(aborted);
  if (aborted()) { document.getElementById('countdown').classList.add('hidden'); return; }

  // Start audio. LEAD_IN_SEC añade 3s de silencio entre el fin del countdown
  // y el inicio del audio. Durante ese intervalo el gameLoop renderiza con
  // audioTime negativo: las notas ya están scrolling hacia los receptores
  // pero todavía no hay sonido — la jugadora ve qué viene antes de que
  // empiece la música. Sin este lead-in, las primeras notas llegaban al
  // receptor en menos de 1s y eran prácticamente imposibles de leer.
  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(audioCtx.destination);
  const LEAD_IN_SEC = 3.0;
  const startAt = audioCtx.currentTime + LEAD_IN_SEC;
  src.start(startAt);

  const N = laneConfig.lanes;
  gameState = {
    notes, audioBuffer, src,
    startTime: startAt,
    bpm: selectedSong.bpm,
    timingEngine: tEngine,
    beatTimes,
    duration: audioBuffer.duration,
    score: 0, combo: 0, maxCombo: 0,
    judgments: { marvelous: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0 },
    pressedLanes: new Array(N).fill(false),
    keyHeld:      new Array(N).fill(false),
    padPrev:      new Array(N).fill(false),
    flashTime:    new Array(N).fill(0),
    // Flash rojo en el receptor cuando se pierde una nota (no se presionó a
    // tiempo) o cuando se golpea una mine. Es el feedback visual inmediato
    // pegado al receptor — sin esto el jugador solo ve el texto MISS lejos.
    missFlashTime: new Array(N).fill(0),
    hitFx: [],   // {lane, t}
    songInfo: `${selectedSong.title} — ${diffLabel(selectedChart.name)} ★${selectedChart.rating}${laneConfig.lanes !== nativeLanes ? ` · ${laneConfig.label}` : ''}`,
    finished: false,
    pixelsPerSec: computePixelsPerSec(selectedSong.bpm, activeMods.chartSpeed),
    timing: getTimingWindows(),
    attacks,
    baseMods,
    laneConfig,
    nativeLanes,
  };
  // El playfield CRECE con numLanes (target = numLanes × LANE_WIDTH_IDEAL,
  // clamp en canvasW × 0.92). Recomputamos aquí porque gameState.laneConfig
  // acaba de fijarse, así que la fórmula necesita el numLanes correcto. Sin
  // esta llamada, un chart de 8 lanes renderiza sprites pre-cacheados al
  // tamaño de 4 lanes y el playfield queda anchísimo con flechas pequeñas.
  recomputePlayfieldSize();
  document.getElementById('hudSongInfo').textContent = gameState.songInfo;
  document.getElementById('hudScore').textContent = '0';
  document.getElementById('hudCombo').textContent = '0';
  updateComboMeter(0);

  src.onended = () => {
    if (gameState && !gameState.finished) {
      setTimeout(() => endGame(), 500);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  showTouchControls();
  requestAnimationFrame(gameLoop);
  } catch (err) {
    // Cualquier fallo en la cadena async (decodeAudioData con OGG en iOS,
    // arrayBuffer corrupto, parseSscOrSm con chart inválido…) cae aquí.
    // En vez de pantalla negra silenciosa, mostramos el motivo y devolvemos
    // al usuario a la pantalla de dificultad para que pueda elegir otra.
    if (aborted()) return; // navegó fuera mientras cargaba — silencio OK
    console.error('startGame failed:', err);
    const msg = (err && err.name === 'EncodingError')
      ? 'No se pudo decodificar el audio. Formato no soportado por este navegador (prueba MP3 o WAV).'
      : (err && err.message) ? err.message : 'Error desconocido al iniciar la canción.';
    document.getElementById('countdown').classList.add('hidden');
    // Toast simple: alert() es invasivo pero garantiza visibilidad. Si en
    // futuro hay sistema de toasts global, reemplazar aquí.
    alert('No se pudo iniciar la canción.\n\n' + msg);
    goto('diff');
  }
}

// Countdown extendido a 5 segundos (5 pasos × 1000ms). El countdown previo
// (~2.5s) era demasiado breve — la usuaria no llegaba a centrarse antes del
// primer paso. Cinco pasos con animación scale-pop + tier de color + beep
// auditivo en cada uno usando el AudioContext ya inicializado. El beep es un
// oscilador sinusoidal de 12ms (corto, no enmascara la música pre-canción ni
// la siguiente nota); ¡VAMOS! va con frecuencia más alta y duración doble
// para subrayarlo. Tras esta cuenta se aplica además LEAD_IN_SEC=3 de silencio
// con notas ya cayendo, así la primera nota llega cuando la jugadora está
// realmente en posición.
const COUNTDOWN_STEPS_SM = [
  { text: '¡PREPÁRATE!', cls: 'cd-prep', beep: { freq: 660,  dur: 0.10 } },
  { text: '3',           cls: 'cd-3',    beep: { freq: 880,  dur: 0.10 } },
  { text: '2',           cls: 'cd-2',    beep: { freq: 880,  dur: 0.10 } },
  { text: '1',           cls: 'cd-1',    beep: { freq: 880,  dur: 0.10 } },
  { text: '¡VAMOS!',     cls: 'cd-go',   beep: { freq: 1320, dur: 0.22 } },
];
const COUNTDOWN_STEP_MS = 1000;
const COUNTDOWN_TIER_CLASSES = 'cd-prep cd-3 cd-2 cd-1 cd-go pop';

function playCountdownBeep(freq, dur) {
  // Beep generado con Web Audio API en lugar de un asset .mp3 para evitar
  // dependencias y mantener latencia <1ms. Sine wave + ramp up/down lineal
  // (10ms attack, decay hasta dur) — sin attack hay click audible al inicio.
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = 0;
    osc.connect(g);
    g.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime;
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (e) { /* AudioContext suspended o detached — silencio OK */ }
}

function runCountdown(isAborted) {
  return new Promise(resolve => {
    const el = document.getElementById('countdown');
    el.classList.remove('hidden');
    let i = 0;
    // isAborted devuelve true si el usuario navegó fuera mientras estábamos
    // en la cuenta. Sin este check, los beeps + animaciones seguirían 5s
    // después de que la usuaria ya saltó a otra pantalla.
    const aborted = () => typeof isAborted === 'function' && isAborted();
    const showStep = () => {
      const s = COUNTDOWN_STEPS_SM[i];
      el.textContent = s.text;
      el.className = '';
      void el.offsetWidth;
      el.className = s.cls + ' pop';
      playCountdownBeep(s.beep.freq, s.beep.dur);
    };
    showStep();
    const advance = () => {
      if (aborted()) {
        el.classList.add('hidden');
        el.className = 'hidden';
        resolve();
        return;
      }
      i++;
      if (i >= COUNTDOWN_STEPS_SM.length) {
        // Último paso (¡VAMOS!) ya está pintado — mantenerlo visible 1s antes
        // de ocultar para que se lea bien (antes era solo 400ms y se perdía).
        setTimeout(() => {
          el.classList.add('hidden');
          el.className = 'hidden';
          resolve();
        }, COUNTDOWN_STEP_MS);
        return;
      }
      showStep();
      setTimeout(advance, COUNTDOWN_STEP_MS);
    };
    setTimeout(advance, COUNTDOWN_STEP_MS);
  });
}

function stopGame() {
  if (!gameState) return;
  // Anular onended ANTES de stop(): src.stop() también dispara onended, y si
  // no lo limpiamos primero queda agendado un setTimeout(endGame) que se
  // ejecuta 500ms después con gameState ya nulo. Funcionaba por defensa
  // interna de endGame, no por diseño — ahora cortamos en origen.
  if (gameState.src) {
    gameState.src.onended = null;
    try { gameState.src.stop(); } catch(e) {}
  }
  // Restore user mods snapshot so attacks don't bleed into the next play
  if (gameState.baseMods) Object.assign(activeMods, gameState.baseMods);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  hideTouchControls();
  // Oculta combo meter si quedó visible al salir (pausa / quit antes del
  // endGame natural). Sin esto la siguiente canción arrancaría con el meter
  // mostrando el combo final de la anterior por un frame.
  const cm = document.getElementById('hudComboMeter');
  if (cm) cm.classList.remove('show', 'pulse', 'tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5');
  _comboMeterLast = 0;
  // Oculta countdown por si la usuaria abandona durante los 5s de cuenta o
  // los 3s de lead-in (el aborted() check de runCountdown solo cubre navegar
  // fuera de play-screen, no parar la canción ya iniciada).
  const cd = document.getElementById('countdown');
  if (cd) { cd.className = 'hidden'; }
  gameState = null;
}

// ----- Touch overlay para móvil ---------------------------------------------
// La PWA se instala en Android y se enlaza desde la landing móvil ("Pisa el
// ritmo, …"), pero el motor solo escuchaba teclado + Gamepad API → en móvil
// el usuario llegaba a una pantalla muerta. Este overlay añade 4 zonas táctiles
// (← ↓ ↑ →) en la mitad inferior de la pantalla, mapeadas a los carriles
// cardinales por nombre vía LANE_CONFIGS[4].keyMap. Solo activo cuando:
//   - El dispositivo expone touch ('ontouchstart' || maxTouchPoints > 0).
//   - El chart se juega en modo default 4-lane (no Solo, no Full — los mods
//     6/8 carriles requieren teclas extra que no tienen mapeo táctil natural).
// Si el chart pide 6/8, mostramos un mensaje en vez del overlay.
let _touchOverlayEl = null;
const _IS_TOUCH = (typeof window !== 'undefined') && (
  ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
);

function _ensureTouchOverlay() {
  if (_touchOverlayEl) return _touchOverlayEl;
  const root = document.createElement('div');
  root.id = 'touchPad';
  root.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:52px', // 52px = HUD footer
    'height:38vh', 'display:none', 'z-index:50',
    'pointer-events:none', // solo los hijos capturan
    'user-select:none', '-webkit-user-select:none',
    'touch-action:none', // evitar scroll/zoom en gestos
  ].join(';');
  // 4 botones en fila, 25% width cada uno. Orden y rótulos coinciden con
  // LANE_CONFIGS[4]: lane 0=Left, 1=Down, 2=Up, 3=Right.
  const labels = ['←', '↓', '↑', '→'];
  const colors = LANE_CONFIGS[4].tints;
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('div');
    b.dataset.lane = String(i);
    b.style.cssText = [
      'position:absolute', 'top:0', 'bottom:0',
      `left:${i * 25}%`, 'width:25%',
      'margin:6px',
      'border-radius:14px',
      `background:linear-gradient(180deg, ${colors[i]}33, ${colors[i]}10)`,
      `border:2px solid ${colors[i]}88`,
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-size:clamp(48px, 12vh, 96px)', 'font-weight:bold',
      `color:${colors[i]}`,
      'pointer-events:auto', 'cursor:pointer',
      'transition:transform 80ms ease, background 80ms ease',
      'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
    ].join(';');
    b.textContent = labels[i];
    // touch + pointer events: pointer cubre lápiz/stylus/touch en navegadores
    // modernos. Mantenemos touchstart como fallback explícito iOS Safari viejo.
    const press = (e) => {
      e.preventDefault();
      if (!gameState || gameState.finished) return;
      const lane = parseInt(b.dataset.lane);
      if (gameState.keyHeld[lane]) return;
      gameState.keyHeld[lane] = true;
      gameState.pressedLanes[lane] = true;
      gameState.flashTime[lane] = performance.now();
      b.style.transform = 'scale(0.95)';
      b.style.background = `linear-gradient(180deg, ${colors[lane]}aa, ${colors[lane]}44)`;
      handleLanePress(lane);
    };
    const release = (e) => {
      e.preventDefault();
      if (!gameState) return;
      const lane = parseInt(b.dataset.lane);
      gameState.keyHeld[lane] = false;
      if (!gamepadButtonState[gameState.laneConfig.padMap[lane]]) {
        gameState.pressedLanes[lane] = false;
        handleLaneRelease(lane);
      }
      b.style.transform = '';
      b.style.background = `linear-gradient(180deg, ${colors[lane]}33, ${colors[lane]}10)`;
    };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('pointerleave', release);
    root.appendChild(b);
  }
  document.body.appendChild(root);
  _touchOverlayEl = root;
  return root;
}

function showTouchControls() {
  if (!_IS_TOUCH) return;
  if (!gameState || gameState.laneConfig.lanes !== 4) {
    // Modo Solo/Full no tiene mapeo táctil natural — avisamos.
    if (gameState && gameState.laneConfig.lanes !== 4) {
      console.info('Touch overlay omitido: chart de ' + gameState.laneConfig.lanes + ' carriles. Usa teclado o alfombra.');
    }
    return;
  }
  const el = _ensureTouchOverlay();
  el.style.display = 'block';
}
function hideTouchControls() {
  if (_touchOverlayEl) _touchOverlayEl.style.display = 'none';
}

function onKeyDown(e) {
  if (!gameState || gameState.finished) return;
  if (e.code === 'Escape') { e.preventDefault(); stopGame(); goto('diff'); return; }
  const lane = gameState.laneConfig.keyMap.indexOf(e.code);
  if (lane === -1) return;
  e.preventDefault();
  if (gameState.keyHeld[lane]) return;
  gameState.keyHeld[lane] = true;
  gameState.pressedLanes[lane] = true;
  gameState.flashTime[lane] = performance.now();
  handleLanePress(lane);
}
function onKeyUp(e) {
  if (!gameState) return;
  const lane = gameState.laneConfig.keyMap.indexOf(e.code);
  if (lane === -1) return;
  gameState.keyHeld[lane] = false;
  if (!gamepadButtonState[gameState.laneConfig.padMap[lane]]) {
    gameState.pressedLanes[lane] = false;
    handleLaneRelease(lane);
  }
}

// Lift notes are judged when the player RELEASES the lane (instead of pressing).
// We pick the closest unjudged lift in window, like handleLanePress does.
function handleLaneRelease(lane) {
  if (!gameState || gameState.finished) return;
  const audioTime = (audioCtx.currentTime - gameState.startTime) - settings.globalOffset / 1000;
  const T = gameState.timing;
  let best = null, bestDist = Infinity;
  for (const n of gameState.notes) {
    if (n.lane !== lane || n.judged || n.type !== 'lift') continue;
    const dist = Math.abs(audioTime - n.time);
    if (dist < bestDist && dist <= T.bad) { best = n; bestDist = dist; }
  }
  if (!best) return;
  let judg;
  if (bestDist <= T.marvelous) judg = 'marvelous';
  else if (bestDist <= T.perfect) judg = 'perfect';
  else if (bestDist <= T.great)   judg = 'great';
  else if (bestDist <= T.good)    judg = 'good';
  else                             judg = 'bad';
  best.judged = judg;
  gameState.judgments[judg]++;
  gameState.score += SCORES[judg];
  if (judg === 'bad') gameState.combo = 0;
  else { gameState.combo++; gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo); }
  gameState.hitFx.push(makeHitFx(lane, judg));
  showJudgment(judg);
}

function gameLoop() {
  if (!gameState) return;
  // audioTime adjusted by user calibration (positive globalOffset = user hits late = subtract)
  const audioTime = (audioCtx.currentTime - gameState.startTime) - settings.globalOffset / 1000;
  const T = gameState.timing;

  // Apply per-time #ATTACKS by overriding activeMods. Reset to baseMods first
  // so we don't accumulate stale flags across attack windows.
  if (gameState.attacks && gameState.attacks.length) {
    Object.assign(activeMods, gameState.baseMods);
    for (const a of gameState.attacks) {
      if (audioTime >= a.time && audioTime < a.time + a.len) {
        for (const m of a.mods) activeMods[m] = true;
      }
    }
  }

  // Gamepad input — track press AND release for lift notes
  const padMap = gameState.laneConfig.padMap;
  for (let i = 0; i < gameState.laneConfig.lanes; i++) {
    const padBtn = padMap[i];
    const pressed = gamepadButtonState[padBtn];
    const wasPressed = gameState.padPrev[i];
    if (gamepadJustPressed[padBtn]) {
      gameState.pressedLanes[i] = true;
      gameState.flashTime[i] = performance.now();
      handleLanePress(i);
    }
    if (wasPressed && !pressed && !gameState.keyHeld[i]) {
      handleLaneRelease(i);
    }
    gameState.padPrev[i] = pressed;
    // Combine keyboard + gamepad for hold detection
    gameState.pressedLanes[i] = pressed || gameState.keyHeld[i];
  }

  // Missed taps + mine handling
  for (const n of gameState.notes) {
    if (n.judged) continue;
    if (n.type === 'fake') {
      // Fakes never score; mark them passed once their window closes
      if (audioTime > n.time + T.bad) n.judged = 'fake-pass';
      continue;
    }
    if (n.type === 'mine') {
      if (Math.abs(audioTime - n.time) <= T.mine && gameState.pressedLanes[n.lane]) {
        n.judged = 'mine-hit';
        gameState.score = Math.max(0, gameState.score - 200);
        gameState.combo = 0;
        gameState.missFlashTime[n.lane] = performance.now();
        showJudgment('miss');
      } else if (audioTime > n.time + T.mine) {
        n.judged = 'mine-pass';
      }
      continue;
    }
    if (audioTime - n.time > T.bad) {
      n.judged = 'miss';
      gameState.judgments.miss++;
      gameState.combo = 0;
      gameState.missFlashTime[n.lane] = performance.now();
      showJudgment('miss');
    }
  }

  // Hold/roll lifecycle (with TICKCOUNTS-aware tick scoring)
  for (const n of gameState.notes) {
    if (n.type !== 'hold' && n.type !== 'roll') continue;
    if (!n.judged || n.endTime === null) continue;
    if (!['marvelous','perfect','great','good','bad'].includes(n.judged)) continue;
    if (n.holdState === 'ok' || n.holdState === 'ng') continue;
    if (n.holdState === null) {
      n.holdState = 'active';
      n.lastHoldHeldAt = audioTime;
      n.lastTickAt = n.time; // first tick eligible at note's start time
    }
    if (gameState.pressedLanes[n.lane]) {
      n.lastHoldHeldAt = audioTime;
      if (n.holdState === 'released-grace') n.holdState = 'active';
      // Award +5 per tick interval the user holds correctly
      const interval = n.tickInterval || 0.125; // ~4 ticks/beat at 120bpm
      while (n.lastTickAt + interval <= Math.min(audioTime, n.endTime)) {
        n.lastTickAt += interval;
        gameState.score += 5;
      }
    } else if (n.holdState === 'active') {
      if (audioTime - n.lastHoldHeldAt > HOLD_LIFE) n.holdState = 'released-grace';
    }
    if (audioTime > n.endTime) {
      const heldOk = (n.lastHoldHeldAt !== null && (audioTime - n.lastHoldHeldAt) <= HOLD_LIFE);
      if (heldOk) {
        n.holdState = 'ok';
        gameState.score += 100; // hold completion bonus (ticks already paid above)
      } else {
        n.holdState = 'ng';
        gameState.combo = 0;
      }
    }
  }

  document.getElementById('hudScore').textContent = gameState.score.toLocaleString();
  document.getElementById('hudCombo').textContent = gameState.combo;
  updateComboMeter(gameState.combo);

  render(audioTime);

  if (audioTime > gameState.duration + 1) { endGame(); return; }
  requestAnimationFrame(gameLoop);
}

function handleLanePress(lane) {
  if (!gameState || gameState.finished) return;
  const audioTime = (audioCtx.currentTime - gameState.startTime) - settings.globalOffset / 1000;
  const T = gameState.timing;
  let best = null, bestDist = Infinity;
  for (const n of gameState.notes) {
    if (n.lane !== lane || n.judged) continue;
    if (n.type === 'mine' || n.type === 'lift' || n.type === 'fake') continue;
    const dist = Math.abs(audioTime - n.time);
    if (dist < bestDist && dist <= T.bad) { best = n; bestDist = dist; }
  }
  if (!best) return;

  let judg;
  if (bestDist <= T.marvelous) judg = 'marvelous';
  else if (bestDist <= T.perfect) judg = 'perfect';
  else if (bestDist <= T.great)   judg = 'great';
  else if (bestDist <= T.good)    judg = 'good';
  else                             judg = 'bad';
  best.judged = judg;
  gameState.judgments[judg]++;
  // Apply per-section #COMBOS multiplier to score AND combo gain
  const tEng = gameState.timingEngine;
  const curBeat = tEng.timeToBeat ? tEng.timeToBeat(audioTime) : 0;
  const cm = tEng.comboMulAt ? tEng.comboMulAt(curBeat) : 1;
  gameState.score += SCORES[judg] * cm;
  if (judg === 'bad') {
    gameState.combo = 0;
  } else {
    gameState.combo += Math.max(1, Math.round(cm));
    gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo);
  }
  gameState.hitFx.push(makeHitFx(lane, judg));
  showJudgment(judg);
}

// Perfil de FX por tier de juicio. La idea: clavar la nota debe SENTIRSE
// distinto físicamente a rasparla, no solo cambiar el texto. Cuanto mejor
// el acierto, más espectáculo (más anillos, más partículas, core blanco).
//
// Diseño:
//   - Baseline siempre = anillo blanco exterior + anillo lane-tinted interior
//     (firma visual de SM, no se toca).
//   - Sobre eso, multiplicadores por tier escalan radio, lineWidth, partículas,
//     velocidad y vida. Más opciones discretas: extraRing y coreFlash solo en
//     marvelous para que sea inequívocamente "el bueno".
//   - Las partículas mantienen gravedad real (G=280) — look de fuente clásica
//     de DDR, mejor que las balísticas planas. Solo varía la densidad.
//
// Tier "great" es el baseline neutro (multipliers = 1.0, 8 partículas).
const SM_HIT_PROFILES = {
  marvelous: { duration: 0.42, expandMul: 1.50, lineWidthMul: 1.2, blur: 30,
               particleCount: 16, particleSpeedMul: 1.4, particleLifeMul: 1.4,
               extraRing: true, coreFlash: true },
  perfect:   { duration: 0.38, expandMul: 1.25, lineWidthMul: 1.1, blur: 22,
               particleCount: 12, particleSpeedMul: 1.2, particleLifeMul: 1.2,
               extraRing: false, coreFlash: false },
  great:     { duration: 0.34, expandMul: 1.00, lineWidthMul: 1.0, blur: 16,
               particleCount: 8,  particleSpeedMul: 1.0, particleLifeMul: 1.0,
               extraRing: false, coreFlash: false },
  good:      { duration: 0.28, expandMul: 0.85, lineWidthMul: 0.9, blur: 12,
               particleCount: 5,  particleSpeedMul: 0.9, particleLifeMul: 0.85,
               extraRing: false, coreFlash: false },
  bad:       { duration: 0.22, expandMul: 0.75, lineWidthMul: 0.8, blur: 8,
               particleCount: 3,  particleSpeedMul: 0.85, particleLifeMul: 0.75,
               extraRing: false, coreFlash: false },
};

// Particle burst on hit. Cada partícula tiene velocidad propia + gravedad
// para arco natural (look de fuente DDR clásica). Cleanup en render por edad.
// El número de partículas y su vida/velocidad escalan con el tier (perfil).
function makeHitFx(lane, judg) {
  const profile = SM_HIT_PROFILES[judg] || SM_HIT_PROFILES.great;
  const particles = [];
  const N = profile.particleCount;
  for (let i = 0; i < N; i++) {
    const angle = (Math.PI * 2 * i / N) + (Math.random() - 0.5) * 0.3;
    const speed = (80 + Math.random() * 120) * profile.particleSpeedMul;
    particles.push({
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,    // initial upward bias
      x0: 0, y0: 0
    });
  }
  return { lane, t: performance.now(), kind: judg, particles };
}

// Texto castellano por tier — Sincro habla español. Mantenemos el `judg`
// interno (marvelous/perfect/great/good/bad/miss) intacto para no romper
// SCORES, judgments[], CSS .judgment.{kind} ni el resumen final; solo
// traducimos lo que ve el jugador.
const JUDGMENT_LABELS = {
  marvelous: 'EXCELENTE',
  perfect:   'PERFECTO',
  great:     'GENIAL',
  good:      'BIEN',
  bad:       'MAL',
  miss:      'FALLO',
};

function showJudgment(judg) {
  // TODOS los juicios se muestran (incluido FALLO) porque el usuario necesita
  // saber qué pasó al pulsar — sin canal "verbal" se confunde "no llegué a
  // tiempo" con "no se registró mi input". La X + contracción del receptor
  // (animación visual en render()) sigue ocurriendo Y AHORA además se imprime
  // el texto, redundancia intencional para clavar el feedback.
  const el = document.getElementById('hudJudgment');
  if (!el) return;
  el.textContent = JUDGMENT_LABELS[judg] || judg.toUpperCase();
  // Re-trigger CSS animation: limpiamos la clase un frame y la re-aplicamos.
  // Sin esto, dos juicios consecutivos del mismo tier no re-disparan el pop.
  el.className = 'judgment';
  // Force reflow para que el navegador "vea" el cambio de clase antes del show.
  void el.offsetWidth;
  el.className = 'judgment show ' + judg;
  // Posición JUSTO ENCIMA del receptor. receptorY = 110 × uiScale (~110-176px).
  // Restamos 90px para que el centro del texto (transform translateY -50%)
  // quede claramente arriba del círculo del receptor. Clamp 40px protege
  // pantallas muy pequeñas para no invadir el topbar. Antes el CSS fijaba
  // top:24% del viewport, que en pantallas grandes (1080p) caía a ~260px,
  // SOBRE los receptores en uiScale 1.6 — confusión visual señalada por el
  // usuario ("aparecen sobre los círculos").
  const receptorY = Math.round(110 * uiScale);
  el.style.top = Math.max(40, receptorY - 90) + 'px';
  setTimeout(() => { if (el.classList) el.classList.remove('show'); }, 700);
}

// Combo meter (estilo SM clásico). Visible a partir de combo ≥ 4 — los
// primeros aciertos no merecen UI dedicada (sería ruido constante al inicio).
// Cinco tiers visuales escalonados: 4 / 50 / 100 / 200 / 500. El pulse se
// dispara SOLO cuando el combo crece (no en cada frame del gameLoop), así la
// animación no se reinicia perpetuamente. `_lastShown` recuerda el último
// valor pintado para detectar cambios; si el combo se rompe a 0, oculta y
// limpia tiers — el siguiente combo arranca desde tier-1 limpio.
let _comboMeterLast = 0;
function comboTierFor(c) {
  if (c >= 500) return 5;
  if (c >= 200) return 4;
  if (c >= 100) return 3;
  if (c >=  50) return 2;
  return 1;
}
function updateComboMeter(combo) {
  const el = document.getElementById('hudComboMeter');
  if (!el) return;
  const num = document.getElementById('hudComboNumber');
  // Threshold de visibilidad: 4. Antes de eso, el meter no aparece — los
  // primeros aciertos los celebra el texto de juicio (EXCELENTE/PERFECTO),
  // no necesitan racha redundante. Si el combo cae bajo el umbral (incluido
  // a 0), oculta y limpia clases.
  if (combo < 4) {
    if (el.classList.contains('show')) {
      el.classList.remove('show', 'pulse', 'tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5');
    }
    _comboMeterLast = combo;
    return;
  }
  if (combo === _comboMeterLast) return; // sin cambios — gameLoop tick sin hit
  num.textContent = combo;
  // Aplica tier correcto y limpia los demás. La transición de tier coincide
  // con el pulse, así un combo 50 entra con halo dorado pulsando.
  const tier = comboTierFor(combo);
  for (let i = 1; i <= 5; i++) el.classList.toggle('tier-' + i, i === tier);
  el.classList.add('show');
  // Re-trigger del pulse: quitar la clase, force reflow, reañadir. Mismo
  // patrón que showJudgment para que dos hits consecutivos del mismo tier
  // re-disparen la animación en vez de quedarse congelados.
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
  _comboMeterLast = combo;
}

function render(audioTime) {
  const W = canvasW, H = canvasH;
  ctx2d.clearRect(0, 0, W, H);

  // Background layer: user-loaded image > procedural gradient per song.
  if (bgImage && bgImage.complete) {
    ctx2d.drawImage(bgImage, 0, 0, W, H);
    ctx2d.fillStyle = 'rgba(0,0,0,0.55)'; // dim so notes pop
    ctx2d.fillRect(0, 0, W, H);
  } else if (selectedSong) {
    drawProceduralBg(W, H, selectedSong.title || '');
  }

  // Lane geometry depends on the active config (4/6/8 lanes).
  const cfg = gameState.laneConfig;
  const numLanes = cfg.lanes;
  const tints = cfg.tints;
  const rotations = cfg.rotations;
  // El playfield total es FIJO (clamp 540-1040 según viewport, mismo target
  // que el highway de gh-play.html). Los carriles se reparten dentro: 4 lanes
  // → flechas grandes; 8 lanes → flechas más ajustadas pero playfield igual.
  // Esto garantiza que un chart full-mode de 8 carriles no se desborde.
  const laneWidth = Math.round(playfieldW / numLanes);
  const totalWidth = laneWidth * numLanes;
  const startX = W/2 - totalWidth/2;
  // receptorY proporcional a uiScale — en pantallas grandes ofrecemos algo
  // más de margen superior sin tapar la HUD.
  const receptorY = Math.round(110 * uiScale);
  // Apply per-section #SPEEDS and #SCROLLS modifiers based on current beat.
  // Negative scroll = reverse direction (notes flow upward from below).
  const T = gameState.timingEngine;
  const curBeat = T.timeToBeat ? T.timeToBeat(audioTime) : 0;
  const localSpeed = T.speedAtBeat ? T.speedAtBeat(curBeat) : 1;
  const localScroll = T.scrollAtBeat ? T.scrollAtBeat(curBeat) : 1;
  const pps = gameState.pixelsPerSec * localSpeed * localScroll;

  // Lane background gradient
  const bg = ctx2d.createLinearGradient(startX, 0, startX+totalWidth, 0);
  bg.addColorStop(0,    'rgba(255,0,110,0.04)');
  bg.addColorStop(0.5,  'rgba(131,56,236,0.06)');
  bg.addColorStop(1,    'rgba(58,134,255,0.04)');
  ctx2d.fillStyle = bg;
  ctx2d.fillRect(startX, 0, totalWidth, H);

  // Lane separators
  ctx2d.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx2d.lineWidth = 1;
  for (let i = 0; i <= numLanes; i++) {
    ctx2d.beginPath();
    ctx2d.moveTo(startX + i*laneWidth, 0);
    ctx2d.lineTo(startX + i*laneWidth, H);
    ctx2d.stroke();
  }

  // Beat pulse: subtle flash on each quarter note, stronger on downbeats (every 4).
  // Pulse duration scales with current BPM so it never overlaps the next beat.
  let beatPulse = 0;
  if (gameState.beatTimes && gameState.beatTimes.length) {
    let lo = 0, hi = gameState.beatTimes.length - 1;
    while (lo < hi) { const m = (lo+hi)>>1; if (gameState.beatTimes[m] < audioTime) lo = m+1; else hi = m; }
    const prevIdx = Math.max(0, lo-1);
    const dt = audioTime - gameState.beatTimes[prevIdx];
    const bpmHere = gameState.timingEngine.bpmAtBeat ? gameState.timingEngine.bpmAtBeat(curBeat) : gameState.bpm;
    const beatDur = 60 / bpmHere;
    const pulseDur = beatDur * 0.15; // 15% of beat — never overlaps
    const isDownbeat = (prevIdx % 4) === 0;
    const intensity = isDownbeat ? 1.0 : 0.5;
    if (dt >= 0 && dt < pulseDur) beatPulse = (1 - dt/pulseDur) * intensity;
  }

  // Receptor radius proporcional al lane (36% → diámetro ≈72% del lane,
  // similar al ratio del receptor circular de gh-play.html y consistente
  // entre 4/6/8 carriles).
  const receptorRadius = Math.round(laneWidth * 0.36);
  for (let i = 0; i < numLanes; i++) {
    const cx = startX + i*laneWidth + laneWidth/2;
    const cy = receptorY;
    // Outer ring (beat pulse)
    ctx2d.strokeStyle = `rgba(255,255,255,${0.15 + beatPulse*0.5})`;
    ctx2d.lineWidth = 2 + beatPulse*2;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, receptorRadius + 4 + beatPulse*4, 0, Math.PI*2);
    ctx2d.stroke();
    // Lane-color receptor
    ctx2d.strokeStyle = tints[i];
    ctx2d.lineWidth = 3;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, receptorRadius, 0, Math.PI*2);
    ctx2d.stroke();
    // Press flash
    const flashAge = (performance.now() - gameState.flashTime[i]) / 200;
    const flashAlpha = Math.max(0, 1 - flashAge);
    if (flashAlpha > 0) {
      ctx2d.fillStyle = `rgba(255,255,255,${flashAlpha*0.5})`;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, receptorRadius - 2, 0, Math.PI*2);
      ctx2d.fill();
    }
    // Miss flash: anillo rojo CONTRACTIVO + X superpuesta. Antes el anillo
    // expandía igual que los aciertos pero en rojo — ambiguo (forma idéntica,
    // solo cambia el color). Ahora el patrón es opuesto:
    //   - Aciertos → anillos EXPANDEN hacia afuera (hacia el éxito)
    //   - Fallos   → anillo CONTRAE hacia el receptor (rotura) + X inequívoca
    // Esa asimetría de forma da feedback más rápido que el contraste de color.
    const missAge = (performance.now() - gameState.missFlashTime[i]) / 350;
    if (missAge >= 0 && missAge < 1) {
      const a = 1 - missAge;
      ctx2d.save();
      ctx2d.globalAlpha = a;
      ctx2d.shadowBlur = 22;
      ctx2d.shadowColor = '#ff3366';
      ctx2d.strokeStyle = '#ff3366';
      ctx2d.lineWidth = 5;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, receptorRadius * (1.4 - missAge * 0.7), 0, Math.PI*2);
      ctx2d.stroke();
      // X grande sobre el receptor — solo el fallo dibuja diagonales,
      // así el ojo distingue acierto/fallo por geometría sin leer texto.
      ctx2d.lineCap = 'round';
      ctx2d.lineWidth = 4;
      ctx2d.shadowBlur = 14;
      const r = receptorRadius * 0.55;
      ctx2d.beginPath();
      ctx2d.moveTo(cx - r, cy - r); ctx2d.lineTo(cx + r, cy + r);
      ctx2d.moveTo(cx + r, cy - r); ctx2d.lineTo(cx - r, cy + r);
      ctx2d.stroke();
      ctx2d.restore();
    }
    // Receptor arrow outline (transparent)
    const sprite = getArrowSprite(rotations[i], 'rgba(160,160,180,0.35)');
    ctx2d.drawImage(sprite, cx - ARROW_SIZE/2, cy - ARROW_SIZE/2);
  }

  // Holds first (so notes draw above)
  for (const n of gameState.notes) {
    if (n.type !== 'hold' && n.type !== 'roll') continue;
    if (n.endTime === null) continue;
    const dtH = n.time - audioTime;
    const dtT = n.endTime - audioTime;
    if (dtT < -1 || dtH > 5) continue;
    const yH = receptorY + dtH * pps;
    const yT = receptorY + dtT * pps;
    const cx = startX + n.lane*laneWidth + laneWidth/2;
    const released = n.holdState === 'released-grace' || n.holdState === 'ng';
    const inProgress = (n.holdState === 'active' || n.holdState === 'released-grace');
    const top = inProgress ? receptorY : Math.min(yH, yT);
    const bot = Math.max(yH, yT);
    if (bot < -10 || top > H + 10) continue;
    const grad = ctx2d.createLinearGradient(0, top, 0, bot);
    if (n.type === 'roll') { grad.addColorStop(0,'rgba(255,200,0,0.85)'); grad.addColorStop(1,'rgba(255,120,0,0.6)'); }
    else                   { grad.addColorStop(0,'rgba(0,255,180,0.85)'); grad.addColorStop(1,'rgba(0,140,255,0.55)'); }
    // Hold/roll body: 55% del laneWidth (antes 44 px hardcoded sobre lane 80).
    // Escala automáticamente con uiScale al estar referenciado a laneWidth.
    const holdHalfW = Math.round(laneWidth * 0.275);
    const holdCapH = Math.round(laneWidth * 0.225);
    ctx2d.fillStyle = released ? 'rgba(120,120,120,0.4)' : grad;
    ctx2d.fillRect(cx-holdHalfW, top, holdHalfW*2, Math.max(0, bot-top));
    // Tail cap
    ctx2d.fillStyle = released ? 'rgba(120,120,120,0.55)' : (n.type === 'roll' ? '#ff8800' : '#00f5d4');
    ctx2d.beginPath();
    ctx2d.moveTo(cx-holdHalfW, bot);
    ctx2d.lineTo(cx+holdHalfW, bot);
    ctx2d.lineTo(cx, bot+holdCapH);
    ctx2d.closePath();
    ctx2d.fill();
  }

  // Note heads (taps + mines + hold heads + lifts + fakes)
  for (const n of gameState.notes) {
    const dt = n.time - audioTime;
    if (dt > 5 || dt < -1) continue;
    if (['marvelous','perfect','great','good','bad'].includes(n.judged) && n.type !== 'hold' && n.type !== 'roll') continue;
    // For active holds/rolls the head is stuck to the receptor while held —
    // body shrinks underneath. Only force receptorY while still in active grace.
    const inProgress = (n.type === 'hold' || n.type === 'roll')
      && (n.holdState === 'active' || n.holdState === 'released-grace');
    const y = inProgress ? receptorY : receptorY + dt * pps;
    const cx = startX + n.lane*laneWidth + laneWidth/2;
    if (y < -50 || y > H + 50) continue;

    // Mods: hidden / sudden
    let alpha = 1;
    if (activeMods.hidden) { // disappears in upper half
      const fadeStart = H * 0.55, fadeEnd = H * 0.30;
      if (y < fadeStart) alpha = Math.max(0, (y - fadeEnd) / (fadeStart - fadeEnd));
    }
    if (activeMods.sudden) { // appears late
      const showStart = H * 0.85, showEnd = H * 0.60;
      if (y > showStart) alpha = 0;
      else if (y > showEnd) alpha = (showStart - y) / (showStart - showEnd);
    }
    if (alpha <= 0) continue;

    if (n.type === 'mine') {
      ctx2d.save();
      ctx2d.globalAlpha = alpha;
      // Pulsating mine — radio y font escalan con ARROW_SIZE para coincidir
      // visualmente con las notas (antes 18 px fijos sobre flecha de 56).
      const mineR = Math.round(ARROW_SIZE * 0.32);
      const pulse = 0.7 + 0.3 * Math.sin(performance.now()/100);
      ctx2d.fillStyle = `rgba(255,51,102,${pulse})`;
      ctx2d.beginPath(); ctx2d.arc(cx, y, mineR, 0, Math.PI*2); ctx2d.fill();
      ctx2d.fillStyle = '#fff';
      ctx2d.font = `bold ${mineR}px sans-serif`;
      ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
      ctx2d.fillText('M', cx, y);
      ctx2d.restore();
      continue;
    }

    if (n.type === 'fake') {
      // Fakes: ghosted arrow (40% alpha), no scoring
      ctx2d.save();
      ctx2d.globalAlpha = alpha * 0.4;
      const sprite = getArrowSprite(rotations[n.lane], '#888');
      ctx2d.drawImage(sprite, cx - ARROW_SIZE/2, y - ARROW_SIZE/2);
      ctx2d.restore();
      continue;
    }

    if (n.type === 'lift') {
      // Lifts: hollow arrow outline (released-on-beat semantics)
      ctx2d.save();
      ctx2d.globalAlpha = alpha;
      const color = quantColorFor(n.row || 0, n.total || 4);
      const sprite = getArrowSprite(rotations[n.lane], color);
      // Draw the sprite at lower alpha + a bright outline ring
      ctx2d.globalAlpha = alpha * 0.5;
      ctx2d.drawImage(sprite, cx - ARROW_SIZE/2, y - ARROW_SIZE/2);
      ctx2d.globalAlpha = alpha;
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = 3;
      ctx2d.beginPath();
      ctx2d.arc(cx, y, ARROW_SIZE/2 - 2, 0, Math.PI*2);
      ctx2d.stroke();
      ctx2d.restore();
      continue;
    }

    if (n.judged === 'miss') {
      ctx2d.save();
      ctx2d.globalAlpha = alpha * 0.4;
      const sprite = getArrowSprite(rotations[n.lane], '#666');
      ctx2d.drawImage(sprite, cx - ARROW_SIZE/2, y - ARROW_SIZE/2);
      ctx2d.restore();
      continue;
    }

    const color = quantColorFor(n.row || 0, n.total || 4);
    ctx2d.save();
    ctx2d.globalAlpha = alpha;
    const sprite = getArrowSprite(rotations[n.lane], color);
    ctx2d.drawImage(sprite, cx - ARROW_SIZE/2, y - ARROW_SIZE/2);
    ctx2d.restore();
  }

  // Lane covers (hidden / sudden) — physical opaque gradients over the lanes
  // for the ITG-authentic look (alpha tween on each note still works as backup).
  if (activeMods.hidden) {
    const fadeStart = H * 0.30, fadeEnd = H * 0.55;
    const grad = ctx2d.createLinearGradient(0, fadeStart, 0, fadeEnd);
    grad.addColorStop(0, 'rgba(0,0,0,0.95)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(startX, 0, totalWidth, fadeEnd);
  }
  if (activeMods.sudden) {
    const showStart = H * 0.60, showEnd = H * 0.85;
    const grad = ctx2d.createLinearGradient(0, showStart, 0, showEnd);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.95)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(startX, showStart, totalWidth, H - showStart);
  }

  // Hit FX estratificado por tier (ver SM_HIT_PROFILES). Capas:
  //   1) Anillo blanco exterior (baseline — firma SM)
  //   2) Anillo lane-tinted interior (baseline — refuerza color de carril)
  //   3) Anillo extra grande lane-tinted (solo marvelous, escalonado)
  //   4) Core blanco brillante (solo marvelous, primera mitad)
  //   5) Partículas con gravedad real (densidad/velocidad/vida según perfil)
  //
  // Cleanup por edad usa la duration propia del perfil (marvelous dura más
  // porque el efecto es más rico; bad dura menos porque no merece pantalla).
  const now = performance.now();
  gameState.hitFx = gameState.hitFx.filter(fx => {
    const p = SM_HIT_PROFILES[fx.kind] || SM_HIT_PROFILES.great;
    return now - fx.t < p.duration * 1000;
  });
  for (const fx of gameState.hitFx) {
    const profile = SM_HIT_PROFILES[fx.kind] || SM_HIT_PROFILES.great;
    const ageMs = now - fx.t;
    const dur = profile.duration * 1000;
    const age = ageMs / dur;
    const alpha = 1 - age;
    // Anillo escalado a ARROW_SIZE: 55% como base, expande hasta +90% × expandMul.
    const baseRadius = ARROW_SIZE * 0.55;
    const radius = baseRadius + age * ARROW_SIZE * 0.9 * profile.expandMul;
    const cx = startX + fx.lane*laneWidth + laneWidth/2;

    // Capa 1 — outer white ring (baseline)
    ctx2d.save();
    if (profile.blur) { ctx2d.shadowBlur = profile.blur; ctx2d.shadowColor = 'rgba(255,255,255,0.6)'; }
    ctx2d.strokeStyle = `rgba(255,255,255,${alpha*0.6})`;
    ctx2d.lineWidth = 3 * profile.lineWidthMul * (1-age);
    ctx2d.beginPath(); ctx2d.arc(cx, receptorY, radius, 0, Math.PI*2); ctx2d.stroke();
    ctx2d.restore();

    // Capa 2 — inner lane-tinted ring (baseline, smaller)
    ctx2d.save();
    if (profile.blur) { ctx2d.shadowBlur = profile.blur; ctx2d.shadowColor = tints[fx.lane]; }
    ctx2d.strokeStyle = `${tints[fx.lane]}${Math.floor(alpha*255).toString(16).padStart(2,'0')}`;
    ctx2d.lineWidth = 5 * profile.lineWidthMul * (1-age);
    ctx2d.beginPath(); ctx2d.arc(cx, receptorY, radius*0.7, 0, Math.PI*2); ctx2d.stroke();
    ctx2d.restore();

    // Capa 3 — extra ring (solo marvelous): segunda onda más grande, arranca
    // 15% del ciclo después que las baseline para dar sensación de eco/réplica.
    if (profile.extraRing && age > 0.15) {
      const extraAge = (age - 0.15) / 0.85;
      ctx2d.save();
      ctx2d.globalAlpha = 1 - extraAge;
      ctx2d.shadowBlur = 26;
      ctx2d.shadowColor = tints[fx.lane];
      ctx2d.strokeStyle = tints[fx.lane];
      ctx2d.lineWidth = 4 * (1 - extraAge);
      ctx2d.beginPath();
      ctx2d.arc(cx, receptorY, radius * 1.4, 0, Math.PI*2);
      ctx2d.stroke();
      ctx2d.restore();
    }

    // Capa 4 — core flash blanco (solo marvelous): fogonazo de cámara
    // breve, decae en la primera mitad de la animación.
    if (profile.coreFlash && age < 0.5) {
      const coreAge = age / 0.5;
      ctx2d.save();
      ctx2d.globalAlpha = (1 - coreAge) * 0.85;
      ctx2d.shadowBlur = 32;
      ctx2d.shadowColor = '#fff';
      ctx2d.fillStyle = '#fff';
      ctx2d.beginPath();
      ctx2d.arc(cx, receptorY, baseRadius * (0.5 + coreAge * 0.5), 0, Math.PI*2);
      ctx2d.fill();
      ctx2d.restore();
    }

    // Capa 5 — partículas con gravedad. Cada una respeta la duration global
    // del fx (no vida individual como en GH); se desvanecen junto con los
    // anillos para no dejar puntos huérfanos al final.
    if (fx.particles && fx.particles.length) {
      const t = ageMs / 1000;
      const G = 280; // gravity (px/s²)
      ctx2d.save();
      ctx2d.shadowBlur = profile.blur ? 8 : 0;
      ctx2d.shadowColor = tints[fx.lane];
      ctx2d.fillStyle = tints[fx.lane];
      for (const p of fx.particles) {
        const px = cx + p.vx * t;
        const py = receptorY + p.vy * t + 0.5 * G * t * t;
        const size = 4 * profile.lineWidthMul * (1 - age);
        if (size <= 0) continue;
        ctx2d.globalAlpha = alpha;
        ctx2d.beginPath(); ctx2d.arc(px, py, size, 0, Math.PI*2); ctx2d.fill();
      }
      ctx2d.restore();
    }
  }

  // Progress bar
  const pct = Math.min(1, audioTime / gameState.duration);
  ctx2d.fillStyle = 'rgba(255,255,255,0.1)';
  ctx2d.fillRect(0, 0, W, 4);
  const grad2 = ctx2d.createLinearGradient(0,0,W,0);
  grad2.addColorStop(0,'#ff006e'); grad2.addColorStop(0.5,'#8338ec'); grad2.addColorStop(1,'#3a86ff');
  ctx2d.fillStyle = grad2;
  ctx2d.fillRect(0, 0, W * pct, 4);
}

// Run "pendiente" — construido en endGame, persistido en saveCurrentRun tras
// capturar el nombre. Vive a nivel de módulo (no en gameState) porque stopGame()
// nulifica gameState ANTES de que el usuario haya escrito su nombre y dado a
// Guardar; necesitamos sobrevivir esa transición.
let _pendingRun = null;

async function endGame() {
  if (!gameState || gameState.finished) return;
  gameState.finished = true;
  const j = gameState.judgments;
  const total = j.marvelous + j.perfect + j.great + j.good + j.bad + j.miss;
  const accuracy = total ? ((j.marvelous + j.perfect*0.9 + j.great*0.7 + j.good*0.4) / total * 100) : 0;
  const grade = accuracy >= 95 ? 'AAA' : accuracy >= 90 ? 'AA' : accuracy >= 80 ? 'A' : accuracy >= 70 ? 'B' : accuracy >= 60 ? 'C' : 'D';

  // Construimos el run pendiente — solo se persiste tras capturar el nombre.
  // Si no hay selectedSong/Chart (ej. test mode), pendingRun queda en null y
  // el form de guardar no se renderiza.
  if (selectedSong && selectedChart) {
    _pendingRun = {
      gameType: 'sm',
      songId:   selectedSong.id,
      chartKey: selectedChart.key,
      chartId:  chartIdOf(selectedSong.id, selectedChart.key),
      score:    gameState.score,
      grade,
      accuracy: +accuracy.toFixed(2),
      maxCombo: gameState.maxCombo,
      judgments: j,
      mods:     {...activeMods},
      playedAt: Date.now()
    };
  } else {
    _pendingRun = null;
  }

  document.getElementById('resultsTitle').textContent = gameState.songInfo || 'Resultados';
  // Resumen estilo SM5: grade gigante + score/accuracy/maxcombo arriba, grid
  // de judgments con barra proporcional al % del total. Cada barra usa
  // currentColor de su clase (.j-marvelous, .j-perfect…) para el relleno.
  const gradeClass = 'g-' + grade.toLowerCase();
  const rows = [
    ['marvelous','Excelente'], ['perfect','Perfecto'], ['great','Genial'],
    ['good','Bien'],            ['bad','Mal'],          ['miss','Fallo'],
  ];
  const judgmentRows = rows.map(([k, label]) => {
    const count = j[k] || 0;
    const pct = total ? (count / total) * 100 : 0;
    return `
      <div class="judgment-row j-${k}">
        <span class="jname">${label}</span>
        <span class="jbar"><i style="width:${pct.toFixed(1)}%"></i></span>
        <span class="jcount">${count}</span>
      </div>`;
  }).join('');
  // El form de guardar solo aparece cuando hay un run válido pendiente.
  const lastName = escapeHtml(getLastPlayerName());
  const saveFormHtml = _pendingRun ? `
    <div id="resultsScoreSave" class="score-save-form">
      <label for="playerNameInput">Tu nombre</label>
      <input id="playerNameInput" type="text" maxlength="12" value="${lastName}" placeholder="Tu nombre" autocomplete="off">
      <button id="saveRunBtn" class="action-btn primary">Guardar puntuación</button>
    </div>` : '';
  document.getElementById('resultsContent').innerHTML = `
    <div class="results-header">
      <div class="results-grade ${gradeClass}">${grade}</div>
      <div class="results-summary">
        <div class="cell"><div class="lbl">Score</div><div class="val" style="color:#ffbe0b">${gameState.score.toLocaleString()}</div></div>
        <div class="cell"><div class="lbl">Accuracy</div><div class="val">${accuracy.toFixed(2)}%</div></div>
        <div class="cell"><div class="lbl">Max Combo</div><div class="val" style="color:#00ff64">${gameState.maxCombo}</div></div>
      </div>
    </div>
    <div class="results-judgments">${judgmentRows}</div>
    ${saveFormHtml}
  `;
  // Wire-up del form: Enter en input dispara click en botón. Autofocus solo
  // si el nombre prefilled está vacío — si ya hay nombre del último jugador,
  // dejamos al usuario decidir si lo cambia (no robamos foco al texto).
  if (_pendingRun) {
    const inp = document.getElementById('playerNameInput');
    const btn = document.getElementById('saveRunBtn');
    if (inp && btn) {
      btn.addEventListener('click', () => { saveCurrentRun().catch(e => console.error('saveCurrentRun:', e)); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });
      if (!lastName) inp.focus();
    }
  }
  stopGame();
  goto('results');
  // Hook de modo playlist: si hay sesión activa, inyecta banner de siguiente
  // canción + countdown, o resumen agregado en la última canción.
  if (typeof updateResultsForSession === 'function') {
    updateResultsForSession({ grade, accuracy: +accuracy.toFixed(2), score: gameState.score });
  }
}

// Captura el nombre del input, persiste el run pendiente y reemplaza el form
// por el panel de ranking con la posición conseguida. Llamada idempotente:
// si _pendingRun ya se guardó (doble click), no hace nada.
async function saveCurrentRun() {
  if (!_pendingRun) return;
  const inp = document.getElementById('playerNameInput');
  const name = sanitizePlayerName(inp ? inp.value : '');
  setLastPlayerName(name);
  const run = {
    ..._pendingRun,
    playerName: name,
    playerLower: name.toLowerCase()
  };
  const { songId, chartKey } = run;
  _pendingRun = null;  // marcamos como consumido antes del await — evita doble save
  let newId;
  try {
    newId = await dbRunAdd(run);
  } catch (e) {
    console.error('No se pudo guardar la puntuación:', e);
    _pendingRun = run;  // restaurar para que el usuario pueda reintentar
    return;
  }
  // Sustituimos solo el form por el panel — el resumen (grade, judgments) sigue
  // arriba. Si el contenedor no existe (usuario navegó fuera), salimos limpios.
  const form = document.getElementById('resultsScoreSave');
  if (!form) return;
  const panel = document.createElement('div');
  panel.id = 'resultsRankingPanel';
  panel.className = 'ranking-panel';
  form.replaceWith(panel);
  await renderRankingPanel(panel, songId, chartKey, newId, name);
}

// Renderiza la posición del run + 2 tabs (Top canción / Mi progresión).
// Tabs son CSS-only (radio buttons ocultos + :checked + ~ selectors).
async function renderRankingPanel(container, songId, chartKey, justSavedId, playerName) {
  // Solo runs de SM — la DB es compartida con GH, así que filtramos por
  // gameType para no mezclar rankings de bailar y de guitarra.
  const allRuns = filterRunsByGame(await dbRunsForChart(songId, chartKey), 'sm');
  const bestRanking = bestRunPerPlayer(allRuns);
  const myRuns = allRuns
    .filter(r => r.playerLower === playerName.toLowerCase())
    .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0)); // newest first

  // Posición del run recién guardado en el ranking (best-per-player).
  const myBestRow = bestRanking.find(r => r.playerLower === playerName.toLowerCase());
  const myPos = myBestRow ? bestRanking.indexOf(myBestRow) + 1 : null;
  const totalPlayers = bestRanking.length;
  const justSavedIsBest = myBestRow && myBestRow.id === justSavedId;

  // Mejora vs run anterior del mismo jugador (excluyendo el actual).
  let deltaHtml = '';
  if (myRuns.length >= 2) {
    const prev = myRuns.find(r => r.id !== justSavedId);  // 2º más reciente
    if (prev) {
      const delta = (myRuns[0].score - prev.score);
      const sign = delta >= 0 ? '+' : '−';
      const cls = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-zero';
      deltaHtml = `<span class="ranking-delta ${cls}">${sign}${Math.abs(delta).toLocaleString()} vs partida anterior</span>`;
    }
  }

  let posPillHtml = '';
  if (myPos === 1 && justSavedIsBest) {
    posPillHtml = `<div class="position-pill is-top">¡Nuevo #1 en ${escapeHtml(diffLabel(chartKey))}!</div>`;
  } else if (myPos) {
    posPillHtml = `<div class="position-pill">Tu posición: #${myPos} de ${totalPlayers} jugador${totalPlayers === 1 ? '' : 'es'}</div>`;
  }

  // Top 5 globales (best por jugador).
  const topRows = bestRanking.slice(0, 5).map((r, i) => {
    const isMe = r.playerLower === playerName.toLowerCase();
    const isJust = r.id === justSavedId;
    const cls = [isMe ? 'is-me' : '', isJust ? 'is-just-saved' : ''].filter(Boolean).join(' ');
    return `
      <li class="ranking-row ${cls}">
        <span class="rank-num">#${i + 1}</span>
        <span class="rank-name">${escapeHtml(r.playerName || 'Anónimo')}</span>
        <span class="rank-grade g-${(r.grade || '').toLowerCase()}">${escapeHtml(r.grade || '—')}</span>
        <span class="rank-score">${(r.score || 0).toLocaleString()}</span>
      </li>`;
  }).join('');

  // Mi progresión: hasta 8 partidas más recientes con delta entre filas
  // consecutivas (cuando hay siguiente más antigua).
  const progRows = myRuns.slice(0, 8).map((r, i, arr) => {
    const next = arr[i + 1];
    const delta = next ? (r.score - next.score) : null;
    const deltaSpan = delta !== null
      ? `<span class="ranking-delta ${delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-zero'}">${delta >= 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()}</span>`
      : '<span class="ranking-delta"></span>';
    const date = r.playedAt ? new Date(r.playedAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const isJust = r.id === justSavedId ? 'is-just-saved' : '';
    return `
      <li class="ranking-row ${isJust}">
        <span class="rank-date">${escapeHtml(date)}</span>
        <span class="rank-grade g-${(r.grade || '').toLowerCase()}">${escapeHtml(r.grade || '—')}</span>
        <span class="rank-score">${(r.score || 0).toLocaleString()}</span>
        ${deltaSpan}
      </li>`;
  }).join('');

  container.innerHTML = `
    ${posPillHtml}
    ${deltaHtml ? `<div class="ranking-delta-wrap">${deltaHtml}</div>` : ''}
    <div class="ranking-tabs">
      <input type="radio" name="rankingTab" id="rkTabTop" checked>
      <label for="rkTabTop" class="ranking-tab">Top de la canción</label>
      <input type="radio" name="rankingTab" id="rkTabMine"${myRuns.length < 2 ? ' disabled' : ''}>
      <label for="rkTabMine" class="ranking-tab${myRuns.length < 2 ? ' disabled' : ''}" title="${myRuns.length < 2 ? 'Necesitas al menos 2 partidas en esta dificultad' : ''}">Mi progresión</label>
      <div class="ranking-pane ranking-pane-top">
        <ol class="ranking-list">${topRows || '<li class="ranking-empty">Sin puntuaciones todavía</li>'}</ol>
      </div>
      <div class="ranking-pane ranking-pane-mine">
        <ol class="ranking-list">${progRows || '<li class="ranking-empty">Solo has jugado esta partida</li>'}</ol>
      </div>
    </div>
  `;
}
