// ============================================================================
//  SM-FLOW — generador de coreografía biomecánica para autostepper SM.
//
//  Sustituye el Math.random() puro del generador antiguo por reglas que
//  imitan cómo un charter humano coloca flechas:
//    1. Alternancia de pie (L → R → L → R) con tolerancia para variedad.
//    2. Anti-crossover: nunca dos lanes opuestos consecutivos con el mismo pie.
//    3. Drills en runs rápidas: cuando hay ≥4 onsets con gap uniforme < 1/4
//       beat, alterna estrictamente un par L-R para crear patrones bailables.
//    4. Anti-repeat: no repetir las últimas 2 flechas (preservado del motor
//       antiguo, ahora dentro de los candidatos del pie objetivo).
//
//  Mapeo de pies en 8 carriles (dance-double, master único del autostepper):
//    0 = ←    L
//    1 = ↓    P (pivot)
//    2 = ↑    P (pivot)
//    3 = →    R
//    4 = ↖    L
//    5 = ↗    R
//    6 = ↙    L
//    7 = ↘    R
//
//  Los pivots (↑↓) heredan el pie contrario del último uso — sirven de
//  "puente" cuando la run necesita un compás vertical sin romper alternancia.
//
//  El chart se genera siempre con 8 carriles. El motor (`game.js:279-303`)
//  remapea simétricamente a 4 lanes en modo default y a 6 en Solo. La
//  asignación de pies respeta la simetría L/R del eje vertical, así el flow
//  sobrevive al remap.
//
//  API:
//    SMFlow.LANE_FOOT, LEFT_LANES, RIGHT_LANES, PIVOT_LANES
//    SMFlow.footOfLane(lane, lastFoot)
//    SMFlow.computeRunInfo(positions48, opts)
//    SMFlow.pickArrowFlow(state, opts)
//
//  Aleatoriedad inyectable: todas las funciones aceptan `rng` (default
//  `Math.random`). Los tests usan un PRNG con seed fija para ser deterministas.
// ============================================================================

(function() {

  // Pie preferido para cada lane. P = pivot (hereda).
  const LANE_FOOT = ['L', 'P', 'P', 'R', 'L', 'R', 'L', 'R'];

  const LEFT_LANES  = [0, 4, 6];   // ←, ↖, ↙
  const RIGHT_LANES = [3, 5, 7];   // →, ↗, ↘
  const PIVOT_LANES = [1, 2];      // ↓, ↑

  // Pares de lanes para drills: izquierda + derecha. Se eligen ponderados
  // hacia cardinales (más cómodos físicamente que diagonales puras).
  const DRILL_PAIRS = [
    [0, 3], [0, 3], [0, 3],   // ← →   (peso 3, cardinal puro)
    [1, 2], [1, 2],           // ↓ ↑   (peso 2, vertical bounce)
    [4, 5],                   // ↖ ↗   (peso 1)
    [6, 7],                   // ↙ ↘   (peso 1)
    [4, 7],                   // ↖ ↘   (peso 1, diagonal cruzada)
    [6, 5],                   // ↙ ↗   (peso 1, diagonal cruzada)
  ];

  // Devuelve el pie que pisa este lane. Para pivots (↓↑), depende del último
  // pie usado: el pivot lo pisa el pie contrario (mantiene la alternancia).
  function footOfLane(lane, lastFoot) {
    const f = LANE_FOOT[lane];
    if (f !== 'P') return f;
    if (lastFoot === 'L') return 'R';
    if (lastFoot === 'R') return 'L';
    return 'L'; // arranque sin contexto: arbitrario pero estable
  }

  // Calcula info de runs sobre el array de positions48 (ya ordenado).
  // Una "run" es una secuencia ≥ minRunLength con gaps uniformes pequeños
  // (gap <= maxGapForDrill). Marca los onsets de la run con drillLanes
  // (par L-R) e idx (posición dentro de la run, para alternar).
  //
  // Retorna array paralelo a positions: [{ inRun, drillLanes, idx }]
  function computeRunInfo(positions, opts = {}) {
    const minRunLength    = opts.minRunLength    ?? 4;
    const maxGapForDrill  = opts.maxGapForDrill  ?? 24;   // 24 = 1/8 beat (corchea)
    const rng             = opts.rng             ?? Math.random;

    const out = positions.map(() => ({ inRun: false, drillLanes: null, idx: 0 }));
    if (positions.length < minRunLength) return out;

    let i = 0;
    while (i < positions.length - 1) {
      const gap0 = positions[i + 1] - positions[i];
      if (gap0 <= 0 || gap0 > maxGapForDrill) { i++; continue; }

      let runEnd = i + 1;
      while (runEnd < positions.length - 1
             && (positions[runEnd + 1] - positions[runEnd]) === gap0) {
        runEnd++;
      }
      const runLen = runEnd - i + 1;

      if (runLen >= minRunLength) {
        const pair = DRILL_PAIRS[Math.floor(rng() * DRILL_PAIRS.length)];
        const startSide = rng() < 0.5 ? 0 : 1;
        for (let k = i; k <= runEnd; k++) {
          out[k] = {
            inRun: true,
            drillLanes: pair,
            idx: (k - i + startSide) % 2,
          };
        }
        i = runEnd + 1;
      } else {
        i++;
      }
    }
    return out;
  }

  // Escoge la siguiente flecha respetando flow. Si runInfo.inRun, sigue
  // estrictamente el drill. Si no, alterna pie respecto al último con
  // alternationProb (default 0.85) y anti-repeat de las últimas 2 flechas.
  //
  // state: { lastFoot, lastLane, beforeLastLane }
  // opts:  { rng, alternationProb, runInfo }
  // Returns: { lane, foot }
  function pickArrowFlow(state, opts = {}) {
    const rng             = opts.rng             ?? Math.random;
    const alternationProb = opts.alternationProb ?? 0.85;
    const runInfo         = opts.runInfo         ?? null;

    if (runInfo && runInfo.inRun && runInfo.drillLanes) {
      const lane = runInfo.drillLanes[runInfo.idx % 2];
      return { lane, foot: footOfLane(lane, state.lastFoot) };
    }

    let wantedFoot;
    if (state.lastFoot === null || state.lastFoot === undefined) {
      wantedFoot = rng() < 0.5 ? 'L' : 'R';
    } else {
      const alt = state.lastFoot === 'L' ? 'R' : 'L';
      wantedFoot = rng() < alternationProb ? alt : state.lastFoot;
    }

    // Candidatos: lanes del pie deseado. Los pivots se incluyen solo cuando
    // su pie efectivo (contrario al último) coincide con wantedFoot.
    const pivotsForWanted = (wantedFoot !== state.lastFoot) ? PIVOT_LANES : [];
    const baseCandidates = wantedFoot === 'L'
      ? [...LEFT_LANES, ...pivotsForWanted]
      : [...RIGHT_LANES, ...pivotsForWanted];

    // Anti-repeat: excluir últimas 2 flechas. Si queda vacío, relaja.
    let candidates = baseCandidates.filter(c =>
      c !== state.lastLane && c !== state.beforeLastLane);
    if (candidates.length === 0) {
      candidates = baseCandidates.filter(c => c !== state.lastLane);
    }
    if (candidates.length === 0) {
      // Fallback total (no debería ocurrir, pero blindamos)
      candidates = [0, 1, 2, 3, 4, 5, 6, 7].filter(c => c !== state.lastLane);
    }

    const lane = candidates[Math.floor(rng() * candidates.length)];
    return { lane, foot: footOfLane(lane, state.lastFoot) };
  }

  // Escoge un lane "jump" complementario al primary, preferentemente del pie
  // contrario para producir saltos bilaterales (más bailables que dos lanes
  // del mismo lado).
  function pickJumpLane(primaryLane, primaryFoot, rng) {
    rng = rng ?? Math.random;
    const oppLanes = primaryFoot === 'L' ? RIGHT_LANES : LEFT_LANES;
    const filtered = oppLanes.filter(c => c !== primaryLane);
    if (filtered.length === 0) {
      const all = [0, 1, 2, 3, 4, 5, 6, 7].filter(c => c !== primaryLane);
      return all[Math.floor(rng() * all.length)];
    }
    return filtered[Math.floor(rng() * filtered.length)];
  }

  const api = {
    LANE_FOOT,
    LEFT_LANES,
    RIGHT_LANES,
    PIVOT_LANES,
    DRILL_PAIRS,
    footOfLane,
    computeRunInfo,
    pickArrowFlow,
    pickJumpLane,
  };

  if (typeof window !== 'undefined') window.SMFlow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();
