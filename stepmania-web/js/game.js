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
    stepType:  'dance-solo'
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
    stepType:  'dance-double'
  }
};
function getActiveLaneConfig(nativeLanes) {
  // mod overrides chart-native; otherwise use whatever the chart was authored for
  if (typeof activeMods !== 'undefined') {
    if (activeMods.full) return LANE_CONFIGS[8];
    if (activeMods.solo) return LANE_CONFIGS[6];
  }
  return LANE_CONFIGS[nativeLanes] || LANE_CONFIGS[4];
}

let gameState = null;
const canvas = document.getElementById('gameCanvas');
const ctx2d = canvas.getContext('2d');
let canvasW = 0, canvasH = 0;
// Sizing del playfield. Antes ARROW_SIZE/laneWidth eran constantes pensadas
// para 1280×720 → en laptop FHD el playfield ocupaba <20% del ancho.
//
// Modelo nuevo (espejo del highway de gh-play.html):
//   playfieldW = clamp(540, canvasW × 0.5, 1040)
//   laneWidth  = playfieldW / numLanes   (4/6/8 según el chart)
//   ARROW_SIZE = laneWidth × 0.78        (deja ~22% de respiro entre lanes)
//
// Beneficio: en 4 carriles las flechas son grandes (≈186 px en FHD), pero
// cuando un chart de 6 u 8 carriles entra, el playfield NO se ensancha —
// los lanes simplemente se reparten dentro de los mismos ~960 px, así que
// las 8 flechas siguen cabiendo cómodas (≈94 px cada una en FHD) sin que
// el HUD lateral se solape.
//
// uiScale se mantiene solo para receptorY (margen superior — no afecta a
// la geometría de los lanes).
let uiScale = 1;
let playfieldW = 540;
let ARROW_SIZE = 56;
function recomputePlayfieldSize() {
  uiScale = Math.max(1, Math.min(1.6, canvasW / 1100));
  playfieldW = Math.max(540, Math.min(canvasW * 0.5, 1040));
  const numLanes = (gameState && gameState.laneConfig) ? gameState.laneConfig.lanes : 4;
  ARROW_SIZE = Math.round((playfieldW / numLanes) * 0.78);
  buildArrowSprites();
}
function resizeCanvas() {
  canvasW = canvas.width = window.innerWidth;
  canvasH = canvas.height = window.innerHeight;
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
async function startGame() {
  if (!selectedSong || !selectedChart) { goto('songs'); return; }
  resizeCanvas();
  ensureAudioCtx();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  // Decode audio
  const arrayBuf = await selectedSong.audioBlob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));

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
  const laneConfig = getActiveLaneConfig(nativeLanes);
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
  await runCountdown();

  // Start audio
  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(audioCtx.destination);
  const startAt = audioCtx.currentTime + 0.05;
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
    hitFx: [],   // {lane, t}
    songInfo: `${selectedSong.title} — ${selectedChart.name} ★${selectedChart.rating}${laneConfig.lanes !== nativeLanes ? ` · ${laneConfig.label}` : ''}`,
    finished: false,
    pixelsPerSec: 600 * settings.scrollSpeed * activeMods.chartSpeed,
    timing: getTimingWindows(),
    attacks,
    baseMods,
    laneConfig,
    nativeLanes,
  };
  // El playfield es FIJO en ancho (clamp 540-1040 px). ARROW_SIZE depende
  // de cuántos lanes reparten ese ancho, así que se recomputa ahora que
  // gameState.laneConfig.lanes ya está fijado para este chart. Sin esto,
  // un chart de 8 lanes renderiza sprites pre-cacheados al tamaño de 4 lanes.
  recomputePlayfieldSize();
  document.getElementById('hudSongInfo').textContent = gameState.songInfo;
  document.getElementById('hudScore').textContent = '0';
  document.getElementById('hudCombo').textContent = '0';

  src.onended = () => {
    if (gameState && !gameState.finished) {
      setTimeout(() => endGame(), 500);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  requestAnimationFrame(gameLoop);
}

function runCountdown() {
  return new Promise(resolve => {
    const el = document.getElementById('countdown');
    el.classList.remove('hidden');
    const seq = ['3','2','1','¡VAMOS!'];
    let i = 0;
    el.textContent = seq[0];
    const tick = () => {
      i++;
      if (i >= seq.length) {
        el.classList.add('hidden');
        resolve();
        return;
      }
      el.textContent = seq[i];
      setTimeout(tick, i === seq.length-1 ? 400 : 700);
    };
    setTimeout(tick, 700);
  });
}

function stopGame() {
  if (!gameState) return;
  try { gameState.src.stop(); } catch(e) {}
  // Restore user mods snapshot so attacks don't bleed into the next play
  if (gameState.baseMods) Object.assign(activeMods, gameState.baseMods);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  gameState = null;
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
  gameState.hitFx.push(makeHitFx(lane));
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
  gameState.hitFx.push(makeHitFx(lane));
  showJudgment(judg);
}

// Particle burst on hit. Each particle has its own velocity + gravity for
// natural arc. ~10 particles per hit, ~350ms life. Cleanup is handled in render
// (filter by age). Cheap: ~100 active particles in worst case.
function makeHitFx(lane) {
  const particles = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const angle = (Math.PI * 2 * i / N) + (Math.random() - 0.5) * 0.3;
    const speed = 80 + Math.random() * 120;
    particles.push({
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,    // initial upward bias
      x0: 0, y0: 0
    });
  }
  return { lane, t: performance.now(), particles };
}

function showJudgment(judg) {
  const el = document.getElementById('hudJudgment');
  el.textContent = judg.toUpperCase();
  el.className = 'judgment show ' + judg;
  setTimeout(() => { if (el.classList) el.classList.remove('show'); }, 400);
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

  // Hit FX: radial ring + particle burst per hit. Particles use ballistic
  // motion (vx const, vy with gravity) — gives a fountain-like splash.
  const now = performance.now();
  gameState.hitFx = gameState.hitFx.filter(fx => now - fx.t < 350);
  for (const fx of gameState.hitFx) {
    const ageMs = now - fx.t;
    const age = ageMs / 350;
    const alpha = 1 - age;
    // Anillo escalado a ARROW_SIZE: 55% como base, expande hasta +90%.
    const radius = ARROW_SIZE * 0.55 + age * ARROW_SIZE * 0.9;
    const cx = startX + fx.lane*laneWidth + laneWidth/2;
    // Outer white ring
    ctx2d.strokeStyle = `rgba(255,255,255,${alpha*0.6})`;
    ctx2d.lineWidth = 3 * (1-age);
    ctx2d.beginPath(); ctx2d.arc(cx, receptorY, radius, 0, Math.PI*2); ctx2d.stroke();
    // Lane-tinted ring (smaller)
    ctx2d.strokeStyle = `${tints[fx.lane]}${Math.floor(alpha*255).toString(16).padStart(2,'0')}`;
    ctx2d.lineWidth = 5 * (1-age);
    ctx2d.beginPath(); ctx2d.arc(cx, receptorY, radius*0.7, 0, Math.PI*2); ctx2d.stroke();
    // Particles (if present — old fx without particles still render the rings)
    if (fx.particles) {
      const t = ageMs / 1000;
      const G = 280; // gravity (px/s²)
      ctx2d.fillStyle = tints[fx.lane];
      for (const p of fx.particles) {
        const px = cx + p.vx * t;
        const py = receptorY + p.vy * t + 0.5 * G * t * t;
        const size = 4 * (1 - age);
        if (size <= 0) continue;
        ctx2d.globalAlpha = alpha;
        ctx2d.beginPath(); ctx2d.arc(px, py, size, 0, Math.PI*2); ctx2d.fill();
      }
      ctx2d.globalAlpha = 1;
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

async function endGame() {
  if (!gameState || gameState.finished) return;
  gameState.finished = true;
  const j = gameState.judgments;
  const total = j.marvelous + j.perfect + j.great + j.good + j.bad + j.miss;
  const accuracy = total ? ((j.marvelous + j.perfect*0.9 + j.great*0.7 + j.good*0.4) / total * 100) : 0;
  const grade = accuracy >= 95 ? 'AAA' : accuracy >= 90 ? 'AA' : accuracy >= 80 ? 'A' : accuracy >= 70 ? 'B' : accuracy >= 60 ? 'C' : 'D';

  // Save high score (only if better than previous)
  if (selectedSong && selectedChart) {
    const prev = await dbScoreGet(selectedSong.id, selectedChart.key);
    if (!prev || (gameState.score > (prev.score||0))) {
      await dbScoreSet(selectedSong.id, selectedChart.key, {
        score: gameState.score, grade, accuracy: +accuracy.toFixed(2),
        maxCombo: gameState.maxCombo, judgments: j, mods: {...activeMods},
        playedAt: Date.now()
      });
    }
  }

  document.getElementById('resultsTitle').textContent = grade + ' — ' + Math.round(accuracy) + '%';
  let html = `<div style="text-align:center;font-size:0.9em;color:#aaa;margin-bottom:14px">${gameState.songInfo}</div>`;
  html += `<div class="stat-line"><span class="key">Score:</span><span style="color:#ffbe0b;font-weight:700">${gameState.score.toLocaleString()}</span></div>`;
  html += `<div class="stat-line"><span class="key">Combo máximo:</span><span>${gameState.maxCombo}</span></div>`;
  html += `<div class="stat-line"><span class="key" style="color:#00f5d4">Marvelous:</span><span>${j.marvelous}</span></div>`;
  html += `<div class="stat-line"><span class="key" style="color:#ffbe0b">Perfect:</span><span>${j.perfect}</span></div>`;
  html += `<div class="stat-line"><span class="key" style="color:#00ff64">Great:</span><span>${j.great}</span></div>`;
  html += `<div class="stat-line"><span class="key" style="color:#3a86ff">Good:</span><span>${j.good}</span></div>`;
  html += `<div class="stat-line"><span class="key" style="color:#ff006e">Bad:</span><span>${j.bad}</span></div>`;
  html += `<div class="stat-line"><span class="key" style="color:#ff3366">Miss:</span><span>${j.miss}</span></div>`;
  document.getElementById('resultsContent').innerHTML = html;
  stopGame();
  goto('results');
}
