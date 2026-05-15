// Tests del pipeline de audio — verificamos la respuesta en frecuencia del
// pre-filtro `bassEmphasize` que cubre bass (<200 Hz) + mid (200-2500 Hz) en
// una sola pasada con blend 0.4/0.6 sin doblar la RAM.
//
// Estrategia: alimentamos senos puros de frecuencias conocidas y medimos el
// RMS de salida vs entrada. La salida de un filtro LTI a un tono puro es
// otro tono de la misma frecuencia con amplitud |H(f)|, así que el cociente
// RMS_out / RMS_in equivale a |H(f)|. Esperamos:
//   - Bass (50-100 Hz): ratio cerca de BLEND_BASS=0.4 (el band-pass del mid
//     a estas frecuencias da ~0 porque LP_2500 ≈ LP_200 ≈ x).
//   - Mid (1 kHz): ratio significativo por la contribución BLEND_MID·(LP_2500
//     - LP_200), que a 1 kHz vale ~0.88 en magnitud → ~0.53 ponderado.
//   - Alto (5 kHz): ratio bajo porque LP_2500 (2-polo) ya está en roll-off.
//   - Muy alto (10 kHz): ratio casi nulo.
//
// Saltamos el inicio del buffer al medir el RMS para evitar el transient
// (~100 ms) del rise del IIR — sin eso, el RMS sale artificialmente bajo
// y los tests se vuelven flaky con tolerancias estrechas.

import { describe, it, expect } from 'vitest';
import AudioPipeline from '../stepmania-web/js/audio-pipeline.js';
const { bassEmphasize } = AudioPipeline;

function makeSinusoid(freqHz, sr, durationSec, amp = 1) {
  const N = Math.floor(sr * durationSec);
  const samples = new Float32Array(N);
  const omega = 2 * Math.PI * freqHz / sr;
  for (let i = 0; i < N; i++) samples[i] = amp * Math.sin(omega * i);
  return samples;
}

function rms(samples, skipStart = 0) {
  let sum = 0;
  let count = 0;
  for (let i = skipStart; i < samples.length; i++) {
    sum += samples[i] * samples[i];
    count++;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

describe('bassEmphasize', () => {
  const SR = 44100;
  const DUR = 1;
  // ~113 ms de skip para que las dos cascadas IIR (BASS_FC y MID_LP_FC)
  // hayan llegado a régimen permanente antes de medir.
  const SKIP = 5000;

  it('preserva la longitud del buffer de entrada', () => {
    const input = makeSinusoid(100, SR, DUR);
    const output = bassEmphasize(input, SR);
    expect(output.length).toBe(input.length);
  });

  it('deja pasar las frecuencias bass (50 Hz) cerca de BLEND_BASS', () => {
    const input = makeSinusoid(50, SR, DUR);
    const output = bassEmphasize(input, SR);
    const ratio = rms(output, SKIP) / rms(input, SKIP);
    // Esperado ~0.40 (BLEND_BASS). Contribución del mid ≈ 0 porque LP_2500 y
    // LP_200 dejan pasar 50 Hz casi sin atenuar → su diferencia se cancela.
    expect(ratio).toBeGreaterThan(0.30);
    expect(ratio).toBeLessThan(0.55);
  });

  it('deja pasar las frecuencias bass (100 Hz) cerca de BLEND_BASS', () => {
    const input = makeSinusoid(100, SR, DUR);
    const output = bassEmphasize(input, SR);
    const ratio = rms(output, SKIP) / rms(input, SKIP);
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.55);
  });

  it('deja pasar las frecuencias mid (1 kHz) con contribución del band-pass', () => {
    const input = makeSinusoid(1000, SR, DUR);
    const output = bassEmphasize(input, SR);
    const ratio = rms(output, SKIP) / rms(input, SKIP);
    // A 1 kHz: LP_2500 2-polo ≈ 0.865, LP_200 2-polo ≈ 0.04. Su diferencia
    // (considerando fase) ≈ 0.88, ponderada por BLEND_MID=0.6 → ~0.53. El
    // bass contribuye despreciablemente. Tolerancia amplia por la suma
    // compleja con fase del bass residual.
    expect(ratio).toBeGreaterThan(0.20);
    expect(ratio).toBeLessThan(0.70);
  });

  it('atenúa frecuencias fuera de banda (5 kHz)', () => {
    const input = makeSinusoid(5000, SR, DUR);
    const output = bassEmphasize(input, SR);
    const ratio = rms(output, SKIP) / rms(input, SKIP);
    // 5 kHz > MID_LP_FC (2500): LP_2500 2-polo ≈ 0.21. Ponderado por mid
    // queda ~0.12. Bass es nulo. El filtro NO es brick-wall, así que
    // esperamos atenuación significativa pero no completa.
    expect(ratio).toBeLessThan(0.30);
  });

  it('atenúa fuertemente frecuencias muy altas (10 kHz)', () => {
    const input = makeSinusoid(10000, SR, DUR);
    const output = bassEmphasize(input, SR);
    const ratio = rms(output, SKIP) / rms(input, SKIP);
    expect(ratio).toBeLessThan(0.10);
  });

  it('es determinista: misma entrada produce salida bit-a-bit idéntica', () => {
    const input = makeSinusoid(440, SR, 0.1);
    const out1 = bassEmphasize(input, SR);
    const out2 = bassEmphasize(input, SR);
    for (let i = 0; i < out1.length; i++) {
      expect(out2[i]).toBe(out1[i]);
    }
  });

  it('no introduce NaN ni Infinity en la salida', () => {
    const input = makeSinusoid(200, SR, 0.5);
    const output = bassEmphasize(input, SR);
    for (let i = 0; i < output.length; i++) {
      expect(Number.isFinite(output[i])).toBe(true);
    }
  });
});
