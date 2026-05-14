// Tests del motor de flow biomecánico que asigna flechas en el autostepper SM.
//
// Decisión bajo test: dado un onset (posición en 192nds) y el estado del último
// pie usado, `pickArrowFlow` devuelve un carril que respeta:
//   1. Alternancia L→R→L→R con tolerancia (alternationProb < 1.0 por defecto).
//   2. Anti-crossover (pie L solo elige carriles del lado izquierdo + pivots).
//   3. Anti-repeat de las últimas 2 flechas.
//   4. Drills L-R automáticos en runs ≥4 onsets a gap uniforme ≤ 1/8 beat.
//
// Los pivots (↓↑) son carriles de pie "heredable" — el pie efectivo lo decide
// el último pie usado, así una corchea ↓↑↓↑ se baila L→R→L→R sin cross-over.
//
// Aleatoriedad: el módulo acepta `opts.rng`. Aquí inyectamos Mulberry32 con
// seed fija para que cada test sea determinista. Forzar rng=0 / rng=0.999
// permite probar las dos ramas de probabilidad sin flakiness.

import { describe, it, expect } from 'vitest';
import sf from '../stepmania-web/js/sm-flow.js';

const {
  LANE_FOOT, LEFT_LANES, RIGHT_LANES, PIVOT_LANES, DRILL_PAIRS,
  footOfLane, computeRunInfo, pickArrowFlow, pickJumpLane,
} = sf;

// PRNG determinista (Mulberry32). Sin deps externas.
function mulberry32(seed) {
  return function() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Helpers que devuelven SIEMPRE el extremo del rango. Útiles para forzar las
// ramas de probabilidad (alternationProb < rng vs >).
const rngZero = () => 0;
const rngAlmostOne = () => 0.9999;

describe('constantes', () => {
  it('LANE_FOOT cubre los 8 carriles con valores L/P/R', () => {
    expect(LANE_FOOT).toHaveLength(8);
    for (const f of LANE_FOOT) expect(['L', 'P', 'R']).toContain(f);
  });

  it('LEFT_LANES y RIGHT_LANES son disjuntos y no incluyen pivots', () => {
    for (const l of LEFT_LANES) {
      expect(RIGHT_LANES).not.toContain(l);
      expect(PIVOT_LANES).not.toContain(l);
    }
    for (const r of RIGHT_LANES) expect(PIVOT_LANES).not.toContain(r);
  });

  it('PIVOT_LANES son exactamente [1, 2] (↓ y ↑)', () => {
    expect(PIVOT_LANES).toEqual([1, 2]);
  });

  it('DRILL_PAIRS pondera cardinales sobre diagonales', () => {
    const cardinalCount = DRILL_PAIRS.filter(p =>
      (p[0] === 0 && p[1] === 3) || (p[0] === 1 && p[1] === 2)
    ).length;
    expect(cardinalCount).toBeGreaterThanOrEqual(5);
  });
});

describe('footOfLane', () => {
  it('lanes laterales devuelven su pie fijo', () => {
    expect(footOfLane(0)).toBe('L');   // ←
    expect(footOfLane(3)).toBe('R');   // →
    expect(footOfLane(4)).toBe('L');   // ↖
    expect(footOfLane(7)).toBe('R');   // ↘
  });

  it('pivot ↓ hereda el pie contrario al último', () => {
    expect(footOfLane(1, 'L')).toBe('R');
    expect(footOfLane(1, 'R')).toBe('L');
  });

  it('pivot ↑ con lastFoot indefinido devuelve un default estable', () => {
    // El default arbitrario es 'L' (no testeamos el valor exacto sino que es
    // determinista — el motor no debe romperse en el primer onset).
    const f = footOfLane(2);
    expect(['L', 'R']).toContain(f);
    expect(footOfLane(2)).toBe(f);   // mismo input, mismo output
  });
});

describe('computeRunInfo', () => {
  it('lista vacía devuelve array vacío', () => {
    expect(computeRunInfo([])).toEqual([]);
  });

  it('menos de minRunLength → todo inRun:false', () => {
    const info = computeRunInfo([0, 12, 24]);   // 3 onsets, gap 12
    expect(info.every(x => x.inRun === false)).toBe(true);
  });

  it('4 onsets con gap uniforme 12 (1/16 beat) → toda la secuencia es drill', () => {
    const rng = mulberry32(42);
    const info = computeRunInfo([0, 12, 24, 36], { rng });
    expect(info).toHaveLength(4);
    for (const it of info) {
      expect(it.inRun).toBe(true);
      expect(it.drillLanes).toBeTruthy();
      expect(it.drillLanes).toHaveLength(2);
    }
    // Los idx alternan 0,1,0,1 o 1,0,1,0 (depende de startSide)
    expect(info[0].idx).not.toBe(info[1].idx);
    expect(info[1].idx).not.toBe(info[2].idx);
    expect(info[2].idx).not.toBe(info[3].idx);
  });

  it('gap > maxGapForDrill no genera drill aunque sean ≥4 onsets', () => {
    // Gap 30 > maxGapForDrill default (24)
    const info = computeRunInfo([0, 30, 60, 90, 120]);
    expect(info.every(x => x.inRun === false)).toBe(true);
  });

  it('gap no uniforme rompe la run en el punto del cambio', () => {
    // 4 onsets a gap 12, luego un onset a gap 13 (rompe), luego 4 más a gap 13
    const positions = [0, 12, 24, 36, 49, 62, 75, 88];
    const info = computeRunInfo(positions);
    // Primeros 4 forman drill (gap 12 uniforme)
    expect(info[0].inRun).toBe(true);
    expect(info[1].inRun).toBe(true);
    expect(info[2].inRun).toBe(true);
    expect(info[3].inRun).toBe(true);
    // El quinto en adelante: gap 13 también uniforme entre ellos, forma 2ª run
    expect(info[4].inRun).toBe(true);
    expect(info[7].inRun).toBe(true);
  });

  it('todas las posiciones de un drill comparten el mismo par de lanes', () => {
    const rng = mulberry32(7);
    const info = computeRunInfo([0, 12, 24, 36, 48], { rng });
    const pair = info[0].drillLanes;
    for (const it of info) expect(it.drillLanes).toBe(pair);
  });
});

describe('pickArrowFlow — modo drill', () => {
  it('en drill devuelve estrictamente drillLanes[idx % 2]', () => {
    const runInfo = { inRun: true, drillLanes: [0, 3], idx: 0 };
    const r0 = pickArrowFlow({ lastFoot: 'R', lastLane: 5, beforeLastLane: 2 }, { runInfo });
    expect(r0.lane).toBe(0);

    const r1 = pickArrowFlow({ lastFoot: 'R', lastLane: 5, beforeLastLane: 2 },
      { runInfo: { ...runInfo, idx: 1 } });
    expect(r1.lane).toBe(3);
  });

  it('drill ignora rng — siempre el lane del par, no aleatorio', () => {
    const runInfo = { inRun: true, drillLanes: [1, 2], idx: 0 };
    const a = pickArrowFlow({ lastFoot: null, lastLane: -1, beforeLastLane: -1 },
      { runInfo, rng: rngZero });
    const b = pickArrowFlow({ lastFoot: null, lastLane: -1, beforeLastLane: -1 },
      { runInfo, rng: rngAlmostOne });
    expect(a.lane).toBe(b.lane);
    expect(a.lane).toBe(1);
  });
});

describe('pickArrowFlow — modo libre', () => {
  const noRun = { inRun: false, drillLanes: null, idx: 0 };

  it('sin historia devuelve un lane válido y un foot consistente', () => {
    const r = pickArrowFlow(
      { lastFoot: null, lastLane: -1, beforeLastLane: -1 },
      { runInfo: noRun, rng: mulberry32(1) }
    );
    expect(r.lane).toBeGreaterThanOrEqual(0);
    expect(r.lane).toBeLessThan(8);
    expect(['L', 'R']).toContain(r.foot);
  });

  it('alternationProb=1 fuerza pie contrario al último', () => {
    // rng=0 < 1.0 siempre, así que wantedFoot = contrario al lastFoot.
    const rL = pickArrowFlow(
      { lastFoot: 'L', lastLane: 0, beforeLastLane: -1 },
      { runInfo: noRun, rng: rngZero, alternationProb: 1.0 }
    );
    expect(rL.foot).toBe('R');
    expect(RIGHT_LANES.concat(PIVOT_LANES)).toContain(rL.lane);

    const rR = pickArrowFlow(
      { lastFoot: 'R', lastLane: 3, beforeLastLane: -1 },
      { runInfo: noRun, rng: rngZero, alternationProb: 1.0 }
    );
    expect(rR.foot).toBe('L');
    expect(LEFT_LANES.concat(PIVOT_LANES)).toContain(rR.lane);
  });

  it('alternationProb=0 fuerza mismo pie que el último', () => {
    // rng>=0 siempre, así que nunca alterna. Repetir pie con un cardinal del
    // mismo lado (los pivots no aplican porque su pie efectivo es el contrario
    // al último, no el mismo).
    const r = pickArrowFlow(
      { lastFoot: 'L', lastLane: 0, beforeLastLane: -1 },
      { runInfo: noRun, rng: rngZero, alternationProb: 0.0 }
    );
    expect(r.foot).toBe('L');
    // Sin pivots permitidos (mismo pie → pivotsForWanted = []), debe ser
    // un lane lateral izquierdo distinto del 0.
    expect(LEFT_LANES).toContain(r.lane);
    expect(r.lane).not.toBe(0);
  });

  it('anti-repeat: nunca devuelve lastLane ni beforeLastLane si hay alternativas', () => {
    // Forzar wantedFoot = L (alternationProb=1, lastFoot=R).
    // lastLane=0, beforeLastLane=4 (ambos lanes L). Debe elegir 6 (↙) — único
    // lane L restante; los pivots (1,2) también son válidos porque wantedFoot !== lastFoot.
    const r = pickArrowFlow(
      { lastFoot: 'R', lastLane: 0, beforeLastLane: 4 },
      { runInfo: noRun, rng: rngZero, alternationProb: 1.0 }
    );
    expect(r.lane).not.toBe(0);
    expect(r.lane).not.toBe(4);
    expect([6, 1, 2]).toContain(r.lane);
  });

  it('cuando alterna, los pivots son candidatos válidos (puente vertical)', () => {
    // Forzando rng cerca de 1.0 para que el random index dentro de candidatos
    // caiga al final de la lista, donde están los pivots. La aserción real es
    // estructural: con wantedFoot != lastFoot, los pivots aparecen en
    // candidates, así con suficientes iteraciones aparecerán.
    const rng = mulberry32(123);
    let pivotSeen = false;
    for (let i = 0; i < 200; i++) {
      const r = pickArrowFlow(
        { lastFoot: 'R', lastLane: 3, beforeLastLane: 5 },
        { runInfo: noRun, rng, alternationProb: 1.0 }
      );
      if (PIVOT_LANES.includes(r.lane)) { pivotSeen = true; break; }
    }
    expect(pivotSeen).toBe(true);
  });

  it('100 picks consecutivos respetan anti-cross (sin lane R cuando wantedFoot=L)', () => {
    // Test estadístico: con alternationProb=1.0 desde lastFoot='R', wantedFoot
    // siempre será L, y ningún resultado puede ser un lane puramente R.
    const rng = mulberry32(99);
    for (let i = 0; i < 100; i++) {
      const r = pickArrowFlow(
        { lastFoot: 'R', lastLane: 3, beforeLastLane: 5 },
        { runInfo: noRun, rng, alternationProb: 1.0 }
      );
      expect(RIGHT_LANES).not.toContain(r.lane);
    }
  });
});

describe('pickJumpLane', () => {
  it('primaryFoot L → devuelve un lane R distinto del primary', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 30; i++) {
      const j = pickJumpLane(0, 'L', rng);
      expect(RIGHT_LANES).toContain(j);
      expect(j).not.toBe(0);
    }
  });

  it('primaryFoot R → devuelve un lane L distinto del primary', () => {
    const rng = mulberry32(6);
    for (let i = 0; i < 30; i++) {
      const j = pickJumpLane(3, 'R', rng);
      expect(LEFT_LANES).toContain(j);
      expect(j).not.toBe(3);
    }
  });

  it('fallback total cuando oppLanes coincide entero con primary (defensivo)', () => {
    // primaryLane fuera del lado contrario no rompe — el filter pasa todo.
    // Es un test de no-throw, blindando la rama de fallback.
    expect(() => pickJumpLane(7, 'R', () => 0)).not.toThrow();
  });
});
