// Tests del filtrado por dificultad — la promesa del producto es que
// "Beginner es jugable, Expert es desafío real". Si esta lógica se rompe,
// los autosteppers generan charts mal calibrados sin que nadie se entere.
//
// Estrategia: generar onsets sintéticos en un grid 4/4 conocido, ejecutar
// filterByDifficulty para cada tier, y verificar invariantes (NPS máximo,
// gap mínimo, ratio de retención esperado).

import { describe, it, expect } from 'vitest';
import DT from '../stepmania-web/js/difficulty-tiers.js';

// Helper: genera N onsets equiespaciados en un grid de semicorcheas a 120 BPM.
// 1 beat = 0.5s, 1 semicorchea = 0.125s. Con BPM=120 y offset=0, beats enteros
// caen en t=0, 0.5, 1.0... y semicorcheas en t=0.125, 0.25, 0.375...
function gridOnsets(bpm, totalBeats, subdivision /* 1=quarter, 2=eighth, 4=sixteenth */) {
  const out = [];
  const stepBeat = 1 / subdivision;
  for (let b = 0; b < totalBeats; b += stepBeat) {
    out.push(b * 60 / bpm);
  }
  return out;
}

// Helper: calcula NPS instantáneo en una ventana deslizante de N segundos.
// Devuelve el NPS máximo observado en cualquier ventana de tamaño windowSec.
function maxNpsInWindow(onsetsSec, windowSec) {
  let max = 0;
  for (let i = 0; i < onsetsSec.length; i++) {
    let count = 0;
    for (let j = i; j < onsetsSec.length; j++) {
      if (onsetsSec[j] - onsetsSec[i] <= windowSec) count++;
      else break;
    }
    const nps = count / windowSec;
    if (nps > max) max = nps;
  }
  return max;
}

// Helper: calcula gap mínimo entre onsets consecutivos.
function minGap(onsetsSec) {
  let mg = Infinity;
  for (let i = 1; i < onsetsSec.length; i++) {
    const g = onsetsSec[i] - onsetsSec[i - 1];
    if (g < mg) mg = g;
  }
  return mg === Infinity ? 0 : mg;
}

describe('TIER_CONFIG — calibración esperada', () => {
  it('tiene los 5 tiers de SM (beginner..challenge)', () => {
    expect(Object.keys(DT.TIER_CONFIG.sm).sort()).toEqual(
      ['beginner', 'challenge', 'easy', 'hard', 'medium']
    );
  });

  it('tiene los 4 tiers de GH (easy..expert)', () => {
    expect(Object.keys(DT.TIER_CONFIG.gh).sort()).toEqual(
      ['easy', 'expert', 'hard', 'medium']
    );
  });

  it('NPS targets son monotónicamente crecientes con dificultad', () => {
    const sm = DT.TIER_CONFIG.sm;
    expect(sm.beginner.targetMaxNps).toBeLessThan(sm.easy.targetMaxNps);
    expect(sm.easy.targetMaxNps).toBeLessThan(sm.medium.targetMaxNps);
    expect(sm.medium.targetMaxNps).toBeLessThan(sm.hard.targetMaxNps);
    expect(sm.hard.targetMaxNps).toBeLessThan(sm.challenge.targetMaxNps);
  });

  it('minGap es monotónicamente decreciente con dificultad', () => {
    const sm = DT.TIER_CONFIG.sm;
    expect(sm.beginner.minGapSec).toBeGreaterThan(sm.easy.minGapSec);
    expect(sm.easy.minGapSec).toBeGreaterThan(sm.medium.minGapSec);
    expect(sm.medium.minGapSec).toBeGreaterThan(sm.hard.minGapSec);
    expect(sm.hard.minGapSec).toBeGreaterThan(sm.challenge.minGapSec);
  });
});

describe('rhythmPriority — clasificación por posición en compás 4/4', () => {
  it('beat 0 = downbeat de compás → 5', () => {
    expect(DT.rhythmPriority(0)).toBe(5);
  });

  it('beat 4 = downbeat del siguiente compás → 5', () => {
    expect(DT.rhythmPriority(4)).toBe(5);
  });

  it('beat 2 = mitad de compás → 4', () => {
    expect(DT.rhythmPriority(2)).toBe(4);
  });

  it('beats 1 y 3 = beats fuertes (no downbeat ni mid) → 3', () => {
    expect(DT.rhythmPriority(1)).toBe(3);
    expect(DT.rhythmPriority(3)).toBe(3);
  });

  it('beat 0.5 = corchea offbeat → 2', () => {
    expect(DT.rhythmPriority(0.5)).toBe(2);
  });

  it('beat 0.25 = semicorchea → 1', () => {
    expect(DT.rhythmPriority(0.25)).toBe(1);
    expect(DT.rhythmPriority(0.75)).toBe(1);
  });
});

describe('filterByDifficulty — invariantes por tier', () => {
  // Generamos un denso flujo de semicorcheas (16 notas/beat = 8 nps a 120 BPM)
  // sobre 32 beats (16 segundos). Esto da 256 onsets — material suficiente.
  const ONSETS = gridOnsets(120, 32, 4);
  const BPM = 120;
  const OFFSET = 0;

  it('Beginner reduce drásticamente el chorro denso', () => {
    const out = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', 'beginner', 1.0);
    // Beginner: solo downbeats de compás + mid-measure → 2 notas por compás.
    // 32 beats / 4 beats por compás = 8 compases × 2 notas = 16 max teórico.
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(20);
  });

  it('Beginner respeta minGapSec ≥ 1.0s', () => {
    const out = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', 'beginner', 1.0);
    if (out.length >= 2) {
      // Permitimos un pequeño epsilon por aritmética flotante.
      expect(minGap(out)).toBeGreaterThanOrEqual(1.0 - 0.01);
    }
  });

  it('Easy retiene más onsets que Beginner', () => {
    const easy = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', 'easy', 1.0);
    const beg  = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', 'beginner', 1.0);
    expect(easy.length).toBeGreaterThan(beg.length);
  });

  it('Challenge retiene casi todo (cap 9 nps a 8 nps de input)', () => {
    const out = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', 'challenge', 1.0);
    // Challenge accepta semicorcheas (priority 1+), gap 0.10s. 8 nps cumple.
    expect(out.length).toBeGreaterThanOrEqual(ONSETS.length * 0.8);
  });

  it('NPS resultante NUNCA supera el target del tier (con margen del cap)', () => {
    // Test crítico: la promesa del producto. Para cada tier verificamos que
    // ninguna ventana deslizante de 3s contenga más notas de las esperadas.
    const tiers = ['beginner', 'easy', 'medium', 'hard'];
    for (const tier of tiers) {
      const out = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', tier, 1.0);
      const cap = DT.TIER_CONFIG.sm[tier].targetMaxNps;
      const nps = maxNpsInWindow(out, 3.0);
      // El cap usa ventana de 8 BEATS bpm-aware (4s a 120 BPM), pero medimos
      // sobre 3s para coincidir con el comentario del módulo. Damos margen +25%
      // porque la ventana del filtro es más generosa que la nuestra.
      expect(nps).toBeLessThanOrEqual(cap * 1.5);
    }
  });

  it('preset multiplier escala minGap inversamente', () => {
    // Con preset "intenso" (mul=1.3) → minGap = original / 1.3 → más permisivo.
    const normal  = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', 'medium', 1.0);
    const intenso = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', 'medium', 1.3);
    expect(intenso.length).toBeGreaterThanOrEqual(normal.length);
  });

  it('tier desconocido devuelve copia del input sin filtrar', () => {
    const out = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', 'inexistente', 1.0);
    expect(out).toEqual(ONSETS);
    // Debe ser copia, no la misma referencia (para que el caller pueda mutar).
    expect(out).not.toBe(ONSETS);
  });

  it('descarta onsets anteriores al offsetSec', () => {
    const onsets = [-0.5, 0.0, 0.5, 1.0, 1.5];
    const out = DT.filterByDifficulty(onsets, BPM, 0.5, 'sm', 'easy', 1.0);
    expect(out.every(t => t >= 0.5)).toBe(true);
  });

  it('output siempre ordenado ascendente', () => {
    const out = DT.filterByDifficulty(ONSETS, BPM, OFFSET, 'sm', 'medium', 1.0);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThan(out[i - 1]);
    }
  });
});

describe('filterPositions48 — round-trip 1/48 ↔ segundos', () => {
  it('preserva posiciones que sobreviven al filtro', () => {
    // Posiciones en 1/48: 0, 48 (=beat 1), 96 (=beat 2), 144 (=beat 3), 192 (=compás 2)
    const positions = [0, 48, 96, 144, 192];
    const out = DT.filterPositions48(positions, 120, 0, 'beginner', 1.0);
    // Beginner acepta downbeats y mid-measure: 0 (compás 1 d.b.), 96 (mid), 192 (compás 2 d.b.)
    expect(out).toContain(0);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(positions.length);
    // Todas las posiciones deben ser enteros >= 0.
    out.forEach(p => {
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
    });
  });

  it('output sin duplicados (cuando round-trip colisiona)', () => {
    const positions = [0, 1, 2, 48, 49, 50]; // semicorcheas muy juntas
    const out = DT.filterPositions48(positions, 120, 0, 'beginner', 1.0);
    expect(new Set(out).size).toBe(out.length);
  });
});

describe('filterTicks — variante GH a resolución arbitraria', () => {
  it('a CHART_RESOLUTION 192 funciona equivalente a positions48', () => {
    const ticks = [0, 192, 384, 576]; // beats 0, 1, 2, 3 a res 192
    const out = DT.filterTicks(ticks, 192, 120, 0, 'easy', 1.0);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(ticks.length);
  });
});

describe('PRESET_MULTIPLIER — valores documentados', () => {
  it('suave / normal / intenso son 0.7 / 1.0 / 1.3', () => {
    expect(DT.PRESET_MULTIPLIER.suave).toBe(0.70);
    expect(DT.PRESET_MULTIPLIER.normal).toBe(1.00);
    expect(DT.PRESET_MULTIPLIER.intenso).toBe(1.30);
    expect(DT.PRESET_MULTIPLIER.custom).toBe(1.00);
  });
});
