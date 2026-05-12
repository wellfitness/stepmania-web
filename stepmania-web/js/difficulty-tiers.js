// ============================================================================
//  DIFFICULTY TIERS — filtrado de onsets por dificultad calibrado a estándares
//  oficiales de DDR (Groove Radar) y Guitar Hero / Clone Hero (diff_guitar).
//
//  Filosofía: cada dificultad tiene un NPS objetivo MÁXIMO (notas/segundo) y
//  un spacing mínimo en SEGUNDOS reales (no en beats). Esto desacopla la
//  dificultad efectiva del BPM/percusividad de la canción — un Beginner a
//  180 BPM se siente igual de "espaciado" que un Beginner a 90 BPM.
//
//  Algoritmo:
//    1. A cada onset (en segundos) se le asigna una prioridad rítmica según
//       dónde cae en el compás 4/4:
//         5 = downbeat de compás
//         4 = mitad de compás (beat 3)
//         3 = beat fuerte (1, 2, 3, 4)
//         2 = corchea offbeat
//         1 = semicorchea
//         0 = fuera de grid
//    2. Filtrar por minRhythmPriority del tier (ej: Beginner solo acepta
//       prioridad ≥4 — downbeats y mitades de compás).
//    3. Greedy desde el principio respetando minGapSec.
//    4. Capar a targetMaxNps con ventana deslizante de 3 segundos.
//
//  Calibración validada contra código fuente de StepMania 5.1
//  (NoteDataUtil.cpp:1142 — `Stream = (total_taps / fSongSeconds) / 7.0f`):
//
//    Stream value oficial → NPS = Stream * 7
//    DDR Beginner:  Stream <0.15      → NPS <1.0    (cap nuestro: 1.0 — top del rango)
//    DDR Easy:      Stream 0.10-0.25  → NPS 0.7-1.75 (cap: 2.0 — un pelo por encima a propósito)
//    DDR Medium:    Stream 0.20-0.45  → NPS 1.4-3.15 (cap: 2.2 — parte baja del rango)
//    DDR Hard:      Stream 0.40-0.70  → NPS 2.8-4.9  (cap: 3.5 — parte media-baja)
//    DDR Challenge: Stream 0.65+      → NPS 4.5+     (cap: 7.0 — Challenge accesible)
//
//  Recalibración 2026-05-12 (dos pasadas):
//   - Pasada 1 (commit 52cb36f): caps anteriores (Medium 3.5, Hard 5.5, Challenge 9.0)
//     estaban por encima del techo de los rangos oficiales DDR. Bajados a 2.6/4.2/7.5
//     para alinear con el rango y reducir ratio Easy→Medium de 1.75x a 1.30x.
//   - Pasada 2 (commit posterior): tras sesión real, Medium aún se sentía denso. Bajada
//     adicional a 2.2/3.5/7.0 NPS. Ratio Easy→Medium queda en 1.10x — Medium se vive
//     como "Easy con un pelín más de densidad". La razón: el autostepper coloca nota
//     en cada onset detectado SIN respiros coreográficos, así que la misma cifra de
//     NPS se siente más densa en chart auto que en chart humano. Los caps siguen
//     dentro del rango oficial DDR y el preset Intenso (×1.30) restaura algo de
//     densidad para quien quiera más caña.
//
//  Para Voltage SM5 usa ventana fija de 8 BEATS (no segundos), formula:
//    Voltage = (max_notes_in_8_beats / 8) * avg_bps / 10
//  Por consistencia con el motor oficial replicamos esa ventana variable
//  en BPM en lugar de segundos absolutos.
//
//  Fórmula oficial SM5 PredictMeter (Steps.cpp:235) para validar el rating:
//    pMeter = 0.775 + 10.1*Stream + 5.27*Voltage - 0.905*Air - 1.10*Freeze
//           + 2.86*Chaos + DifficultyCoeff - 6.35*(Stream*Voltage) - 2.58*Chaos²
//    DifficultyCoeff = {-0.877, -0.877, 0, 0.722, 0.722, 0}  // Beg,Easy,Med,Hard,Ch,Edit
//  Verificación con los caps nuevos (pasada 2):
//    Beginner (Stream=0.10, Voltage=0.20): pMeter ≈ 1.8  → meter ~2 ✓
//    Easy     (Stream=0.20, Voltage=0.30): pMeter ≈ 3.1  → meter ~3 ✓
//    Medium   (Stream=0.31, Voltage=0.40): pMeter ≈ 4.7  → meter ~4-5
//    Hard     (Stream=0.50, Voltage=0.55): pMeter ≈ 7.0  → meter ~7
//    Chall.   (Stream=1.00, Voltage=0.80): pMeter ≈ 10   → meter ~10 (sin coreografía humana
//                                                                     no se alcanza el meter 13-14
//                                                                     típico de Challenge oficial)
//
//  GH Easy (diff_guitar 0-1):  G/R/Y solo, casi sin chords, NPS típico oficial 0.5-1.2 (cap: 1.4)
//  GH Medium (diff_guitar 2-3): añade Blue, chords ocasionales,            NPS típico 1.0-2.2 (cap: 1.9)
//  GH Hard (diff_guitar 4):    los 5, chords frecuentes,                   NPS típico 2.0-4.0 (cap: 3.5)
//  GH Expert (diff_guitar 5-6): todo, HOPOs, taps,                         NPS típico 3.5-7+  (cap: 6.0)
//
//  Uso:
//    <script src="stepmania-web/js/difficulty-tiers.js"></script>
//    const filtered = DifficultyTiers.filterByDifficulty(
//      onsetTimesSec, bpm, offsetSec, 'sm', 'beginner', 1.0
//    );
//    // filtered es un Array<sec> con los onsets que sobreviven
// ============================================================================

(function() {

  // Configuración por dificultad — NPS objetivo, gap mínimo, prioridad rítmica.
  // minRhythmPriority: solo se aceptan onsets con priority >= a este valor
  //   (5=downbeat, 4=mid-measure, 3=beat, 2=offbeat corchea, 1=semicorchea, 0=otro)
  // minGapSec: spacing mínimo absoluto entre notas consecutivas
  // targetMaxNps: cap de notas/segundo en ventana deslizante de 3s
  const TIER_CONFIG = {
    sm: {
      beginner:  { minGapSec: 1.00, targetMaxNps: 1.0, minRhythmPriority: 4 },
      easy:      { minGapSec: 0.50, targetMaxNps: 2.0, minRhythmPriority: 3 },
      medium:    { minGapSec: 0.45, targetMaxNps: 2.2, minRhythmPriority: 3 },
      hard:      { minGapSec: 0.28, targetMaxNps: 3.5, minRhythmPriority: 2 },
      challenge: { minGapSec: 0.12, targetMaxNps: 7.0, minRhythmPriority: 0 }
    },
    gh: {
      easy:   { minGapSec: 0.70, targetMaxNps: 1.4, minRhythmPriority: 4 },
      medium: { minGapSec: 0.55, targetMaxNps: 1.9, minRhythmPriority: 3 },
      hard:   { minGapSec: 0.30, targetMaxNps: 3.5, minRhythmPriority: 2 },
      expert: { minGapSec: 0.17, targetMaxNps: 6.0, minRhythmPriority: 0 }
    }
  };

  // Multiplicadores por preset: aplican uniforme a todas las dificultades.
  // Los applyo así: minGapSec / mul, targetMaxNps * mul. Un preset "intenso"
  // (mul 1.3) reduce el gap y sube el cap en TODAS las dificultades.
  // Los presets actuales mezclan sensitivity de detección (que altera cuántos
  // onsets vienen del ODF) con el filtrado por dificultad. Aquí solo modifico
  // el filtrado; la sensitivity se sigue gestionando aparte.
  const PRESET_MULTIPLIER = {
    suave:   0.70,
    normal:  1.00,
    intenso: 1.30,
    custom:  1.00
  };

  // Tolerancia (en fracción de beat) al asignar prioridad rítmica a un onset.
  // El ODF puede detectar onsets ligeramente desviados del grid teórico; con
  // 0.10 (un 10% de un beat) damos margen sin que se "cuele" un offbeat
  // como si fuera beat fuerte.
  const RHYTHM_TOLERANCE = 0.10;

  // Calcula la prioridad rítmica de un instante respecto al grid 4/4.
  // beats: posición en BEATS desde el offset musical (0 = primer downbeat).
  function rhythmPriority(beats) {
    const measureFrac = mod1(beats / 4);  // 0..1 dentro del compás
    const beatFrac    = mod1(beats);      // 0..1 dentro del beat actual

    // Downbeat de compás (1 de 4/4)
    if (nearZero(measureFrac, RHYTHM_TOLERANCE / 4)) return 5;
    // Mitad de compás (3 de 4/4)
    if (nearZero(measureFrac - 0.5, RHYTHM_TOLERANCE / 4)) return 4;
    // Cualquier beat (2 o 4 de 4/4 — los que no son ni 1 ni 3)
    if (nearZero(beatFrac, RHYTHM_TOLERANCE)) return 3;
    // Corchea offbeat (medio beat)
    if (nearZero(beatFrac - 0.5, RHYTHM_TOLERANCE)) return 2;
    // Semicorchea (cuarto y tres-cuartos del beat)
    if (nearZero(beatFrac - 0.25, RHYTHM_TOLERANCE) ||
        nearZero(beatFrac - 0.75, RHYTHM_TOLERANCE)) return 1;
    return 0;
  }

  function mod1(x) { return x - Math.floor(x); }
  function nearZero(x, tol) {
    const a = Math.abs(x);
    return a < tol || (1 - a) < tol;
  }

  // Filtra los onsets para una dificultad concreta.
  //   onsetsSec: Array<number> en segundos absolutos desde el inicio del audio
  //   bpm: tempo de la canción
  //   offsetSec: instante del primer downbeat
  //   gameType: 'sm' | 'gh'
  //   difficultyKey: 'beginner'/'easy'/'medium'/'hard'/'challenge' o 'easy'/'medium'/'hard'/'expert'
  //   presetMultiplier: 0.70 (suave) / 1.00 (normal) / 1.30 (intenso) — opcional, default 1.0
  //
  // Devuelve Array<number> con los segundos de los onsets que sobreviven,
  // ordenados ascendente. La duración del array es <= onsetsSec.length.
  function filterByDifficulty(onsetsSec, bpm, offsetSec, gameType, difficultyKey, presetMultiplier) {
    const cfg = TIER_CONFIG[gameType] && TIER_CONFIG[gameType][difficultyKey];
    if (!cfg) {
      console.warn('[DifficultyTiers] tier desconocido:', gameType, difficultyKey);
      return onsetsSec.slice();
    }
    const mul = (typeof presetMultiplier === 'number' && presetMultiplier > 0)
      ? presetMultiplier : 1.0;
    const minGap = cfg.minGapSec / mul;
    const maxNps = cfg.targetMaxNps * mul;

    const beatPerSec = bpm / 60;

    // 1. Calcular prioridad rítmica de cada onset
    const items = onsetsSec
      .filter(t => t >= offsetSec)
      .map(t => {
        const beats = (t - offsetSec) * beatPerSec;
        return { t, rp: rhythmPriority(beats) };
      })
      .filter(x => x.rp >= cfg.minRhythmPriority)
      .sort((a, b) => a.t - b.t);

    if (items.length === 0) return [];

    // 2. Greedy con minGap absoluto. Si un candidato queda demasiado cerca del
    //    último aceptado, se descarta — SALVO si tiene mayor prioridad rítmica
    //    (entonces reemplaza al último, conservando el "musicalmente más fuerte").
    const accepted = [];
    for (const x of items) {
      if (accepted.length === 0) {
        accepted.push(x);
        continue;
      }
      const prev = accepted[accepted.length - 1];
      const gap = x.t - prev.t;
      if (gap >= minGap) {
        accepted.push(x);
      } else if (x.rp > prev.rp) {
        // Sustitución: el nuevo es musicalmente más fuerte aunque viole minGap.
        accepted[accepted.length - 1] = x;
      }
      // else: descartar (gap insuficiente y prioridad no superior)
    }

    // 3. Cap por ventana deslizante de 8 BEATS (alineado con SM5 Voltage).
    //    A 120 BPM eso son 4s; a 90 BPM ~5.3s; a 180 BPM ~2.67s. La ventana
    //    BPM-aware es lo que usa StepMania 5 oficialmente para Voltage —
    //    así "X NPS sostenido" significa lo mismo independientemente del tempo.
    const WINDOW_SEC = (8.0 / beatPerSec);
    const maxInWindow = Math.max(1, Math.round(WINDOW_SEC * maxNps));
    const final = [];
    for (let i = 0; i < accepted.length; i++) {
      const cur = accepted[i];
      // Cuántos onsets ya aceptados hay en [cur.t - WINDOW_SEC, cur.t]
      let countInWin = 0;
      for (let j = final.length - 1; j >= 0; j--) {
        if (cur.t - final[j].t > WINDOW_SEC) break;
        countInWin++;
      }
      if (countInWin < maxInWindow) {
        final.push(cur);
      } else {
        // Intentar reemplazar: si cur.rp > el de menor rp en la ventana, swap
        let weakestIdx = -1, weakestRp = cur.rp;
        for (let j = final.length - 1; j >= 0; j--) {
          if (cur.t - final[j].t > WINDOW_SEC) break;
          if (final[j].rp < weakestRp) { weakestRp = final[j].rp; weakestIdx = j; }
        }
        if (weakestIdx >= 0) final[weakestIdx] = cur;
      }
    }

    return final.map(x => x.t).sort((a, b) => a - b);
  }

  // Devuelve los timestamps de un grid teórico de beats fuertes para una
  // canción dada, usado por el "fallback" cuando el ODF detecta muy pocos
  // onsets en una sección y queremos al menos garantizar el pulso.
  // No se llama hoy desde los autoSteppers — útil si quieres añadir un modo
  // "garantizar al menos 1 nota cada 2 compases" en el futuro.
  function generateBeatGrid(bpm, offsetSec, durationSec, beatsBetween) {
    const gap = (60 / bpm) * beatsBetween;
    const out = [];
    for (let t = offsetSec; t < durationSec; t += gap) out.push(t);
    return out;
  }

  // Versión específica para el SM autostepper que trabaja en posiciones 192nd
  // (1 beat = 48 units). Convierte a segundos, llama a filterByDifficulty,
  // y reconvierte a posiciones. Mantiene las posiciones que sobreviven.
  function filterPositions48(positions48, bpm, offsetSec, difficultyKey, presetMultiplier) {
    const beatPerSec = bpm / 60;
    // pos en 1/48 → segundos absolutos
    const onsetsSec = positions48.map(p => offsetSec + (p / 48) / beatPerSec);
    const filteredSec = filterByDifficulty(onsetsSec, bpm, offsetSec, 'sm', difficultyKey, presetMultiplier);
    // Reconvertir a positions48 redondeadas (set para evitar duplicados)
    const set = new Set();
    for (const t of filteredSec) {
      const pos = Math.round((t - offsetSec) * beatPerSec * 48);
      if (pos >= 0) set.add(pos);
    }
    return [...set].sort((a, b) => a - b);
  }

  // Versión para GH que trabaja en ticks (1 beat = CHART_RESOLUTION ticks).
  function filterTicks(tickArray, ticksPerBeat, bpm, offsetSec, difficultyKey, presetMultiplier) {
    const beatPerSec = bpm / 60;
    const onsetsSec = tickArray.map(tk => offsetSec + (tk / ticksPerBeat) / beatPerSec);
    const filteredSec = filterByDifficulty(onsetsSec, bpm, offsetSec, 'gh', difficultyKey, presetMultiplier);
    const set = new Set();
    for (const t of filteredSec) {
      const tk = Math.round((t - offsetSec) * beatPerSec * ticksPerBeat);
      if (tk >= 0) set.add(tk);
    }
    return [...set].sort((a, b) => a - b);
  }

  // Doble export: classic-script (window) + CommonJS (Node/Vitest).
  // En navegador `module` es undefined, así que el guard CJS no se ejecuta.
  // En Node, `window` puede no existir — guardamos también ese caso.
  const api = {
    TIER_CONFIG,
    PRESET_MULTIPLIER,
    rhythmPriority,
    filterByDifficulty,
    filterPositions48,
    filterTicks,
    generateBeatGrid
  };
  if (typeof window !== 'undefined') window.DifficultyTiers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();
