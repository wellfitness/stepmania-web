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

  // IIR low-pass 2-polo cascado a fc Hz. Filtra in-place en dos pasadas.
  // alpha = exp(-2π·fc/sr) — cuanto más bajo fc, más lento el rise del filtro.
  function iirLowPass(samples, sr, fc) {
    const alpha = Math.exp(-2 * Math.PI * fc / sr);
    const oneMinus = 1 - alpha;
    const out = new Float32Array(samples.length);
    let y = 0;
    for (let i = 0; i < samples.length; i++) {
      y = alpha * y + oneMinus * samples[i];
      out[i] = y;
    }
    y = 0;
    for (let i = 0; i < out.length; i++) {
      y = alpha * y + oneMinus * out[i];
      out[i] = y;
    }
    return out;
  }

  // Bass-emphasis pre-filter — low-pass a ~200 Hz.
  // Aísla el kick + bajo, descarta voces, hi-hats, guitarras distorsionadas.
  // El kick domina el envelope → BPM detection más estable en DDR/SM.
  function bassEmphasize(samples, sr) {
    return iirLowPass(samples, sr, 200);
  }

  // Mid-emphasis filter para GH — bandpass ~200–2500 Hz.
  // Captura guitarra, voz y caja; descarta bombo puro y hiss/cymbals.
  // Implementación: high-pass 200 Hz (samples - bass) + low-pass 2500 Hz.
  function midEmphasize(samples, sr) {
    const bass = iirLowPass(samples, sr, 200);
    const hp = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) hp[i] = samples[i] - bass[i];
    return iirLowPass(hp, sr, 2500);
  }

  // Calcula 5 envolventes de energía por banda de frecuencia.
  // Útil para detectar el pitch dominante en cada frame.
  // Bandas: <250 Hz · 250-600 · 600-1500 · 1500-3500 · >3500 Hz.
  // Devuelve array de 5 Float32Arrays (misma indexación de frames que el
  // computeEnergyEnvelope estándar — hopMs=5ms, winMs=23ms).
  function computeBandEnvelopes(mono, sr) {
    const cuts = [250, 600, 1500, 3500];
    const filters = cuts.map(fc => iirLowPass(mono, sr, fc));
    const envelopes = [];
    // Banda 0: todo lo que pasa el primer low-pass (<250 Hz)
    envelopes.push(computeEnergyEnvelope(filters[0], sr).env);
    // Bandas 1-3: diferencia entre low-passes consecutivos (bandpass)
    for (let i = 1; i < cuts.length; i++) {
      const band = new Float32Array(mono.length);
      for (let j = 0; j < mono.length; j++) band[j] = filters[i][j] - filters[i-1][j];
      envelopes.push(computeEnergyEnvelope(band, sr).env);
    }
    // Banda 4: lo que queda por encima de 3500 Hz
    const hp = new Float32Array(mono.length);
    for (let j = 0; j < mono.length; j++) hp[j] = mono[j] - filters[3][j];
    envelopes.push(computeEnergyEnvelope(hp, sr).env);
    return envelopes;
  }

  // Devuelve la banda (0-4) con mayor energía en el frame dado.
  // 0 = graves (<250 Hz) → Verde; 4 = agudos (>3500 Hz) → Naranja.
  function getPitchBandAtFrame(bandEnvs, frameIdx) {
    let max = -1, band = 2;
    for (let b = 0; b < bandEnvs.length; b++) {
      const v = bandEnvs[b][frameIdx] ?? 0;
      if (v > max) { max = v; band = b; }
    }
    return band;
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

  // Normaliza la ODF localmente por secciones de 1s con ventana de ±2s.
  // Permite detectar onsets en tramos dinámicamente quietos (intro, break) que
  // quedarían aplastados por el umbral global. BPM y offset usan la ODF global.
  function normalizeODFLocally(odf, framesPerSec) {
    const granFrames = Math.max(1, Math.floor(framesPerSec));
    const winRadius = 2;
    const numSamples = Math.ceil(odf.length / granFrames);
    const coarse = new Float32Array(numSamples);
    for (let s = 0; s < numSamples; s++) {
      const lo = s * granFrames, hi = Math.min(odf.length, (s + 1) * granFrames);
      let mx = 0;
      for (let i = lo; i < hi; i++) if (odf[i] > mx) mx = odf[i];
      coarse[s] = mx;
    }
    const out = new Float32Array(odf.length);
    for (let i = 0; i < odf.length; i++) {
      const s = Math.floor(i / granFrames);
      let localMax = 0;
      for (let d = -winRadius; d <= winRadius; d++) {
        const si = Math.max(0, Math.min(numSamples - 1, s + d));
        if (coarse[si] > localMax) localMax = coarse[si];
      }
      out[i] = localMax > 0 ? odf[i] / localMax : odf[i];
    }
    return out;
  }

  // Detección de BPM variable — ventanas de 8s con step de 4s.
  // Cada ventana usa la misma autocorrelación de detectBPM.
  // Segmentos consecutivos cuyo BPM difiere < 6% se fusionan.
  // Devuelve [{ timeSec, bpm }]. Con tempo constante, array de 1 elemento.
  function detectBPMSegments(odf, framesPerSec) {
    const winFrames  = Math.floor(framesPerSec * 8);
    const stepFrames = Math.floor(framesPerSec * 4);
    const raw = [];
    for (let start = 0; start < odf.length; start += stepFrames) {
      const end = Math.min(odf.length, start + winFrames);
      if (end - start < Math.floor(framesPerSec * 2)) break;
      raw.push({ timeSec: start / framesPerSec, bpm: detectBPM(odf.slice(start, end), framesPerSec) });
    }
    if (!raw.length) return [{ timeSec: 0, bpm: detectBPM(odf, framesPerSec) }];
    const merged = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const ratio = raw[i].bpm / merged[merged.length - 1].bpm;
      if (ratio >= 0.94 && ratio <= 1.06) continue;
      merged.push(raw[i]);
    }
    return merged;
  }

  // Recorta un AudioBuffer a maxDurationSec y lo encoda como WAV PCM 16-bit.
  // Se aplica un fade-out lineal de fadeOutSec al final para evitar clicks
  // de truncación. Si maxDurationSec es null/0/>=duration, encoda completo.
  // Devuelve un Blob con MIME audio/wav.
  function audioBufferToWav(buffer, maxDurationSec, fadeOutSec) {
    const sr = buffer.sampleRate;
    const numCh = buffer.numberOfChannels;
    const fullFrames = buffer.length;
    const numFrames = (maxDurationSec && maxDurationSec > 0)
      ? Math.min(fullFrames, Math.floor(sr * maxDurationSec))
      : fullFrames;
    const fade = Math.max(0, Math.min(numFrames, Math.floor(sr * (fadeOutSec || 0))));
    const fadeStart = numFrames - fade;

    const dataSize = numFrames * numCh * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);              // fmt chunk size
    view.setUint16(20, 1, true);               // PCM format
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCh * 2, true);  // byte rate
    view.setUint16(32, numCh * 2, true);       // block align
    view.setUint16(34, 16, true);              // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    const channels = [];
    for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < numFrames; i++) {
      const gain = (fade > 0 && i >= fadeStart) ? (numFrames - i) / fade : 1;
      for (let c = 0; c < numCh; c++) {
        let s = channels[c][i] * gain;
        if (s > 1) s = 1; else if (s < -1) s = -1;
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  window.AudioPipeline = {
    ensureAudioContext,
    decodeFile,
    toMono,
    bassEmphasize,
    midEmphasize,
    computeEnergyEnvelope,
    computeODF,
    pickPeaks,
    detectBPM,
    detectBPMSegments,
    detectOffset,
    audioBufferToWav,
    computeBandEnvelopes,
    getPitchBandAtFrame,
    normalizeODFLocally
  };
})();
