// ============================================================================
//  AUDIO PIPELINE — análisis musical compartido entre autostepper SM y GH.
//  Toda la lógica de detección de BPM/onsets/offset es agnóstica al juego;
//  solo cambia el output downstream (.ssc/.sm para DDR vs .chart para GH).
//
//  Pipeline:
//    decode → toMono → bassEmphasize → computeEnergyEnvelope → computeODF
//          → pickPeaks (onsets) ⊕ detectBPM ⊕ detectOffset
//
//  Optimizado para música bailable (techno, dance, pop, rock). El bass-emphasis
//  pre-filtra a ~200 Hz para que el envelope esté dominado por kick + bajo;
//  desestima voces, hi-hats, guitarras distorsionadas. Eso da BPM detection
//  estable en el rango 90-180 BPM con corrección de octava al mismo rango.
//
//  Uso:
//    <script src="stepmania-web/js/audio-pipeline.js"></script>
//    const ctx = AudioPipeline.ensureAudioContext();
//    const buffer = await AudioPipeline.decodeFile(file);
//    const mono = AudioPipeline.toMono(buffer);
//    const bass = AudioPipeline.bassEmphasize(mono, buffer.sampleRate);
//    const { env, framesPerSec } = AudioPipeline.computeEnergyEnvelope(bass, buffer.sampleRate);
//    const odf = AudioPipeline.computeODF(env);
//    const peakFrames = AudioPipeline.pickPeaks(odf, framesPerSec, sensitivity);
//    const bpm = AudioPipeline.detectBPM(odf, framesPerSec);
//    const offsetSec = AudioPipeline.detectOffset(odf, framesPerSec, bpm);
// ============================================================================

(function() {
  let _audioCtx = null;

  // El AudioContext se crea on-demand en la primera llamada y se cachea.
  // Compartido entre análisis (decodeFile) y reproducción (autostepper preview)
  // para no instanciar múltiples contextos en la misma página.
  function ensureAudioContext() {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _audioCtx;
  }

  async function decodeFile(file) {
    const ctx = ensureAudioContext();
    const buf = await file.arrayBuffer();
    return await ctx.decodeAudioData(buf.slice(0));
  }

  function toMono(buffer) {
    const ch0 = buffer.getChannelData(0);
    if (buffer.numberOfChannels === 1) return ch0;
    const ch1 = buffer.getChannelData(1);
    const out = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) out[i] = (ch0[i] + ch1[i]) * 0.5;
    return out;
  }

  // Bass-emphasis pre-filter — IIR low-pass 2-polo cascado a ~200 Hz.
  // Aísla el kick + bajo, descarta voces, hi-hats, guitarras distorsionadas.
  // El kick domina el envelope → BPM detection más estable.
  function bassEmphasize(samples, sr) {
    const fc = 200;
    const alpha = Math.exp(-2 * Math.PI * fc / sr);
    const oneMinus = 1 - alpha;
    const out = new Float32Array(samples.length);
    let y = 0;
    for (let i = 0; i < samples.length; i++) {
      y = alpha * y + oneMinus * samples[i];
      out[i] = y;
    }
    // Segunda pasada en cascada para ~12 dB/octava de rolloff
    y = 0;
    for (let i = 0; i < out.length; i++) {
      y = alpha * y + oneMinus * out[i];
      out[i] = y;
    }
    return out;
  }

  // RMS energy envelope con ventanas de 23ms y hop de 5ms.
  function computeEnergyEnvelope(samples, sr) {
    const winMs = 23, hopMs = 5;
    const winSize = Math.floor(sr * winMs / 1000);
    const hopSize = Math.floor(sr * hopMs / 1000);
    const numFrames = Math.max(0, Math.floor((samples.length - winSize) / hopSize));
    const env = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      let sum = 0;
      const start = f * hopSize;
      for (let i = 0; i < winSize; i++) { const s = samples[start + i]; sum += s*s; }
      env[f] = Math.sqrt(sum / winSize);
    }
    return { env, hopSize, framesPerSec: sr / hopSize };
  }

  // ODF = log-derivada rectificada del envelope. Picos = onsets.
  function computeODF(env) {
    const odf = new Float32Array(env.length);
    for (let i = 1; i < env.length; i++) {
      const a = env[i] + 1e-6;
      const b = env[i-1] + 1e-6;
      const d = Math.log(a) - Math.log(b);
      odf[i] = d > 0 ? d : 0;
    }
    let max = 0;
    for (let i = 0; i < odf.length; i++) if (odf[i] > max) max = odf[i];
    if (max > 0) for (let i = 0; i < odf.length; i++) odf[i] /= max;
    return odf;
  }

  // Pico-detección con umbral adaptativo local (75ms window) y minSpacing 50ms.
  // `sensitivity` < 1 detecta más onsets, > 1 detecta menos.
  function pickPeaks(odf, framesPerSec, sensitivity) {
    const peaks = [];
    const halfWin = Math.floor(framesPerSec * 0.075);
    const minSpacing = Math.floor(framesPerSec * 0.05);

    const meanArr = new Float32Array(odf.length);
    let sum = 0;
    const winLen = Math.min(2*halfWin + 1, odf.length);
    for (let i = 0; i < winLen; i++) sum += odf[i];
    for (let i = 0; i < odf.length; i++) {
      const lo = i - halfWin - 1;
      const hi = i + halfWin;
      if (lo >= 0 && hi < odf.length) sum += odf[hi] - odf[lo];
      meanArr[i] = sum / Math.max(1, winLen);
    }

    for (let i = 1; i < odf.length - 1; i++) {
      const thresh = Math.max(0.02, meanArr[i] * sensitivity);
      if (odf[i] > thresh && odf[i] > odf[i-1] && odf[i] >= odf[i+1]) {
        if (peaks.length === 0 || i - peaks[peaks.length-1] >= minSpacing) {
          peaks.push(i);
        }
      }
    }
    return peaks;
  }

  // BPM via autocorrelación de la ODF. Rango 90-180 BPM con corrección de
  // octava (multiplica/divide por 2 hasta caer en rango).
  // Cubre pop/rock 90-130, house 120-130, techno 125-145, DnB 165-180.
  function detectBPM(odf, framesPerSec) {
    const minLag = Math.floor(framesPerSec * 60 / 180);
    const maxLag = Math.floor(framesPerSec * 60 / 90);
    let best = { lag: 0, score: 0 };
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      const N = odf.length - lag;
      for (let i = 0; i < N; i++) s += odf[i] * odf[i + lag];
      if (s > best.score) best = { lag, score: s };
    }
    let bpm = 60 * framesPerSec / best.lag;
    while (bpm < 90) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return bpm;
  }

  // Offset (en segundos) via correlación de fase con grilla de beats.
  function detectOffset(odf, framesPerSec, bpm) {
    const beatFrames = framesPerSec * 60 / bpm;
    const numBeats = Math.floor(odf.length / beatFrames);
    let best = { phase: 0, score: 0 };
    const step = Math.max(1, Math.floor(beatFrames / 100));
    for (let phase = 0; phase < beatFrames; phase += step) {
      let s = 0;
      for (let b = 0; b < numBeats; b++) {
        const idx = Math.round(phase + b * beatFrames);
        if (idx < odf.length) s += odf[idx];
      }
      if (s > best.score) best = { phase, score: s };
    }
    return best.phase / framesPerSec;
  }

  window.AudioPipeline = {
    ensureAudioContext,
    decodeFile,
    toMono,
    bassEmphasize,
    computeEnergyEnvelope,
    computeODF,
    pickPeaks,
    detectBPM,
    detectOffset
  };
})();
