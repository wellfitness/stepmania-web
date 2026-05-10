// Vitest config — node environment porque los tests cubren algoritmos puros
// (parser SSC/SM, difficulty tiers, timing engine). NO testeamos motor de
// render / Web Audio / Gamepad / DOM — para eso se usa el navegador real.
//
// Si en el futuro quieres tests con DOM (overlay táctil, settings modal,
// IndexedDB), cambia environment a 'jsdom' e instala vitest-environment-jsdom.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs', 'tests/**/*.test.js'],
    reporters: ['default'],
  },
});
