// ============================================================================
//  CALIBRATION — dedicated screen with metronome + tap. Measures the user's
//  consistent offset against the metronome beat and writes it directly to
//  settings.globalOffset. Inspired by the Sync tab of test-pad.html.
//
//  Why this matters: outputLatency only reports the audio path delay; it can't
//  account for human reaction time, perceptual offset, or pad sensor latency.
//  Measuring with actual taps captures the *full* loop and produces a much
//  better calibration than the auto-detect button alone.
// ============================================================================

let calibState = null;
let calibBpm = 120;

function calibUpdateBpm(v) {
  calibBpm = parseInt(v) || 120;
  document.getElementById('calibBpmDisplay').textContent = calibBpm;
}

function calibTickSound() {
  const ctx = ensureAudioCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 1200;
  osc.connect(gain).connect(ctx.destination);
  gain.gain.setValueAtTime(0.18, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
  osc.start();
  osc.stop(ctx.currentTime + 0.06);
}

function startCalib() {
  if (calibState) return;
  ensureAudioCtx();
  calibState = {
    bpm: calibBpm,
    interval: 60000 / calibBpm,
    nextBeat: performance.now() + 250,
    lastBeat: 0,
    beats: 0,
    presses: [],
    timer: null
  };
  document.getElementById('calibStart').disabled = true;
  document.getElementById('calibStop').disabled = false;
  document.getElementById('calibBeats').textContent = '0';
  document.getElementById('calibSteps').textContent = '0';
  document.getElementById('calibOffset').textContent = '-- ms';
  document.getElementById('calibRecommendation').innerHTML = '';
  calibTick();
}

function calibTick() {
  if (!calibState) return;
  const now = performance.now();
  if (now >= calibState.nextBeat) {
    calibState.lastBeat = calibState.nextBeat;
    calibState.beats++;
    calibState.nextBeat += calibState.interval;
    document.getElementById('calibBeats').textContent = calibState.beats;
    const m = document.getElementById('calibPulse');
    m.style.transform = 'scale(1.25)';
    m.style.background = 'rgba(0,190,200,0.45)';
    setTimeout(() => {
      m.style.transform = 'scale(1)';
      m.style.background = 'rgba(0,190,200,0.15)';
    }, 90);
    calibTickSound();
  }
  calibState.timer = requestAnimationFrame(calibTick);
}

function stopCalib() {
  if (!calibState) return;
  if (calibState.timer) cancelAnimationFrame(calibState.timer);
  document.getElementById('calibStart').disabled = false;
  document.getElementById('calibStop').disabled = true;
  const offsets = calibState.presses;
  if (offsets.length === 0) {
    document.getElementById('calibRecommendation').innerHTML = '<span style="color:var(--gris-400)">No se detectaron pisadas. Intenta de nuevo.</span>';
    calibState = null;
    return;
  }
  const avg = offsets.reduce((a,b)=>a+b,0)/offsets.length;
  const sorted = [...offsets].sort((a,b)=>Math.abs(a)-Math.abs(b));
  const best = sorted[0];
  const worst = sorted[sorted.length-1];
  document.getElementById('calibOffset').textContent = (avg>=0?'+':'') + Math.round(avg) + ' ms';
  let html = `<div style="margin-top:8px">Mejor: ${(best>=0?'+':'')}${Math.round(best)} ms · Peor: ${(worst>=0?'+':'')}${Math.round(worst)} ms · ${offsets.length} pisadas</div>`;
  if (Math.abs(avg) < 15) {
    html += `<div style="margin-top:8px;color:var(--color-success)">✓ Excelente sincronización (offset &lt; 15ms). No hace falta ajustar.</div>`;
  } else {
    const suggested = Math.max(-200, Math.min(200, Math.round(avg)));
    html += `<div style="margin-top:8px;color:var(--tulip-tree-500)">Sugerencia: globalOffset = <strong>${suggested >= 0 ? '+' : ''}${suggested} ms</strong></div>`;
    html += `<div style="margin-top:10px"><button class="action-btn" onclick="applyCalibration(${suggested})">Aplicar a Ajustes</button></div>`;
  }
  document.getElementById('calibRecommendation').innerHTML = html;
  calibState = null;
}

function applyCalibration(ms) {
  settings.globalOffset = ms;
  document.getElementById('globalOffset').value = ms;
  document.getElementById('globalOffsetVal').textContent = ms + ' ms';
  saveSettings();
  document.getElementById('calibRecommendation').innerHTML += `<div style="margin-top:6px;color:var(--color-success)">✓ Aplicado. Ya está guardado en Ajustes.</div>`;
}

// Register the press handler. Lane press: keyboard or pad. We use SPACE on
// keyboard and ANY of the 4 pad arrows. We listen on every gamepad-just-pressed
// from the global polling loop via a hook in app.js → calibPressTick.
function calibRegisterPress() {
  if (!calibState || !calibState.lastBeat) return;
  const time = performance.now();
  const prevBeat = calibState.lastBeat;
  const nextBeat = prevBeat + calibState.interval;
  const distPrev = time - prevBeat;
  const distNext = time - nextBeat;
  const offset = Math.abs(distPrev) < Math.abs(distNext) ? distPrev : distNext;
  // Discard if outside half-beat window (likely a missed press or noise)
  if (Math.abs(offset) > calibState.interval/2) return;
  calibState.presses.push(offset);
  document.getElementById('calibSteps').textContent = calibState.presses.length;
  const avg = calibState.presses.reduce((a,b)=>a+b,0)/calibState.presses.length;
  document.getElementById('calibOffset').textContent = (avg>=0?'+':'') + Math.round(avg) + ' ms';
}

// Keyboard SPACE handler — only active while on the calib screen
window.addEventListener('keydown', e => {
  if (currentScreen === 'calib' && e.code === 'Space') {
    e.preventDefault();
    calibRegisterPress();
  }
});
