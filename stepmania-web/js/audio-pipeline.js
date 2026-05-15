// ============================================================================
//  AUDIO PIPELINE — análisis musical compartido entre autostepper SM y GH.
//  Toda la lógica de detección de BPM/onsets/offset es agnóstica al juego;
//  solo cambia el output downstream (.ssc/.sm para DDR vs .chart para GH).
//
//  Pipeline:
//    decode → toMono → bassEmphasize → computeEnergyEnvelope → computeODF
//          → pickPeaks (onsets) ⊕ detectBPM ⊕ detectOffset
//
//  Optimizado para música bailable (techno, dance, pop, rock, latina). El
//  `bassEmphasize` mezcla en una sola pasada el rango bass (<200 Hz, kick +
//  bajo) y el rango mid (200–2500 Hz, snare, voz, guitarra rítmica, percusión
//  latina) con blend 0.4/0.6 — sin doblar la RAM porque el band-pass del mid
//  vive en estado escalar (4 floats) en lugar de materializarse como buffer
//  paralelo. Captura el groove completo respetando un pico de memoria similar
//  al bass-only original. BPM detection estable en 90-180 BPM con corrección
//  de octava al mismo rango.
//
//  Uso:
//    <script src="stepmania-web/js/audio-pipeline.js"></script>
//    const ctx = AudioPipeline.ensureAudioContext();
//    const buffer = await AudioPipeline.decodeFile(file);
//    const mono = AudioPipeline.toMono(buffer);
//    const emphasized = AudioPipeline.bassEmphasize(mono, buffer.sampleRate);
//    const { env, framesPerSec } = AudioPipeline.computeEnergyEnvelope(emphasized, buffer.sampleRate);
//    const odf = AudioPipeline.computeODF(env);
//    const peakFrames = AudioPipeline.pickPeaks(odf, framesPerSec, sensitivity);
//    const bpm = AudioPipeline.detectBPM(odf, framesPerSec);
//    const offsetSec = AudioPipeline.detectOffset(odf, framesPerSec, bpm);
// ============================================================================

(function() {
  let _audioCtx = null;

  // === Constantes del filtro de énfasis bass+mid ===
  // BASS_FC: corte del low-pass para aislar kick + bajo.
  // MID_LP_FC: techo del band-pass del mid (snare, voz, guitarra, percusión).
  // El band-pass del mid se construye como (LP_MID_LP - LP_BASS) → no necesita
  // constante adicional para el borde inferior, comparte BASS_FC.
  // BLEND_BASS / BLEND_MID: pesos del mix. 0.4/0.6 replica el blend del
  // pipeline multi-banda revertido (commits 13905cb GH + e243d93 SM, revert
  // db03ef7), pero con coste de memoria igual al bass-only original.
  const BASS_FC = 200;
  const MID_LP_FC = 2500;
  const BLEND_BASS = 0.4;
  const BLEND_MID = 0.6;

  // El AudioContext se crea on-demand en la primera llamada y se cachea.
  // Compartido entre análisis (decodeFile) y reproducción (autostepper preview)
  // para no instanciar múltiples contextos en la misma página.
  function ensureAudioContext() {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _audioCtx;
  }

  // Cierra el AudioContext actual liberando TODO lo asociado al thread nativo
  // de audio (AudioBuffer decodificados, scratch buffers internos, etc.). El
  // próximo ensureAudioContext() creará uno nuevo automáticamente. Útil entre
  // canciones de un batch para que el navegador libere realmente la memoria
  // del audio anterior — la garbage collection de JS no puede liberarla por sí
  // sola porque vive en el thread de audio, fuera del heap V8.
  async function resetAudioContext() {
    if (_audioCtx) {
      try { await _audioCtx.close(); } catch (e) { /* ignore */ }
      _audioCtx = null;
    }
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

  // Énfasis bass + mid en una única pasada. El bass (<BASS_FC) se calcula con
  // la misma cascada 2-polo de iirLowPass y se escala por BLEND_BASS. El mid
  // (BASS_FC–MID_LP_FC) se construye inline como diferencia de dos low-pass
  // 2-polo en estado escalar (4 floats yH1/yH2/yL1/yL2) — esto evita
  // materializar un segundo buffer Float32 del tamaño de la canción, que era
  // la causa de los ~300 MB/canción del pipeline multi-banda revertido en
  // commit db03ef7. RAM pico final = samples + out (idéntico al bass-only
  // original); el coste extra es ~3x CPU en los IIR (lineal, irrelevante
  // frente a decodeAudioData y pickPeaks).
  //
  // Cubrir el rango mid devuelve la sensibilidad a snare en 2/4, voz, guitarra
  // rítmica y percusión latina (clave, congas) que el bass-only ignoraba por
  // completo. En rock/pop/latina/trance los charts en tiers Hard/Challenge
  // ganan los onsets del backbeat; tiers bajos quedan acotados por los topes
  // de NPS y minGap de difficulty-tiers, así que no suben densidad ahí.
  function bassEmphasize(samples, sr) {
    const N = samples.length;
    const out = new Float32Array(N);

    const aB = Math.exp(-2 * Math.PI * BASS_FC / sr);
    const aH = Math.exp(-2 * Math.PI * MID_LP_FC / sr);
    const omB = 1 - aB;
    const omH = 1 - aH;

    // Componente BASS: cascada 2-polo low-pass @ BASS_FC, escrita en `out`.
    // Pasada 1 forward (1er polo) — escribe el resultado en `out`.
    let yB = 0;
    for (let i = 0; i < N; i++) {
      yB = aB * yB + omB * samples[i];
      out[i] = yB;
    }
    // Pasada 2 forward (2º polo en cascada), aplicando blend bass al final.
    yB = 0;
    for (let i = 0; i < N; i++) {
      yB = aB * yB + omB * out[i];
      out[i] = yB * BLEND_BASS;
    }

    // Componente MID: band-pass (LP_MID_LP - LP_BASS) en estado escalar.
    // Cada cascada usa 2 escalares (poles 1 y 2). El borde inferior del
    // band-pass coincide con BASS_FC (se reusa aB/omB) para evitar añadir
    // otro corte. La contribución se suma al `out` con peso BLEND_MID.
    let yH1 = 0, yH2 = 0;  // cascada LP @ MID_LP_FC
    let yL1 = 0, yL2 = 0;  // cascada LP @ BASS_FC
    for (let i = 0; i < N; i++) {
      const x = samples[i];
      yH1 = aH * yH1 + omH * x;
      yH2 = aH * yH2 + omH * yH1;
      yL1 = aB * yL1 + omB * x;
      yL2 = aB * yL2 + omB * yL1;
      out[i] += (yH2 - yL2) * BLEND_MID;
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
    // Guard: si la ODF está degenerada (silencio, intro quiet, ventana corta)
    // todos los lags dan score 0 y best.lag se queda en 0. Sin guard,
    // 60/0 = Infinity y `while (bpm > 180) bpm /= 2` cuelga el navegador
    // en bucle infinito (Infinity / 2 = Infinity). Devolver 120 BPM (4/4
    // pop/dance medio) es un default razonable; el usuario puede sobreescribir
    // con bpmOverride si la canción real difiere mucho.
    if (best.lag === 0 || !isFinite(best.score) || best.score === 0) return 120;
    let bpm = 60 * framesPerSec / best.lag;
    if (!isFinite(bpm) || bpm <= 0) return 120;
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
      // Skip de ventanas con energía despreciable (intros quiet, breaks).
      // Sin skip, detectBPM sobre ODF ~0 antes devolvía Infinity y colgaba
      // el navegador en bucle infinito (caso real: intro de "L'amour
      // Toujours" Eurodance). Ahora detectBPM ya tiene guard que devuelve
      // 120, pero seguimos saltando estas ventanas para no contaminar el
      // merge con BPMs ficticios — si no hay nada audible, no hay tempo.
      let energy = 0;
      for (let i = start; i < end; i++) energy += odf[i];
      if (energy < 1e-3) continue;
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

  // Doble export: classic-script (window) + CommonJS (Node/Vitest).
  // En navegador `module` es undefined, así que el guard CJS no se ejecuta.
  // En Node, `window` puede no existir — guardamos también ese caso.
  const api = {
    ensureAudioContext,
    resetAudioContext,
    decodeFile,
    toMono,
    bassEmphasize,
    computeEnergyEnvelope,
    computeODF,
    pickPeaks,
    detectBPM,
    detectBPMSegments,
    detectOffset,
    audioBufferToWav,
    normalizeODFLocally
  };
  if (typeof window !== 'undefined') window.AudioPipeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
