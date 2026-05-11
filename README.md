# Sincro

> Suite rítmica de [Movimiento Funcional](https://movimientofuncional.com) — entrena cuerpo, oído y función ejecutiva pisando flechas o tocando notas en el navegador.

**Producción:** [play.movimientofuncional.app](https://play.movimientofuncional.app)

Sincro convierte cualquier alfombra de baile USB y/o guitarra Guitar Hero en una herramienta de exergaming científicamente fundamentada para mujeres 40+ (y cualquiera que quiera entrenar 3 cerebros a la vez). Lee tus propios MP3, genera charts automáticos, y los juega con el motor clásico de StepMania o Clone Hero — todo en navegador, sin instalación.

---

## Qué incluye

| Módulo | Para qué |
|--------|----------|
| **Sincro Play (DDR)** — `play.html` | Motor de juego StepMania completo: parser `.ssc/.sm`, J4-J7 timing, mines, holds/rolls, lifts, fakes, hands, 6 modifiers, librería en IndexedDB, calibración. |
| **Sincro Play GH** — `gh-play.html` | Simulador Guitar Hero con hit-detection canónica de Clone Hero (anchor, HOPO 65 ticks, taps, sustains). Lee charts `.chart` Feedback/CH. |
| **Crear DDR** — `autostepper.html` | Generador automático de charts `.ssc/.sm` desde MP3/WAV con BPM detection, ODF picking, 5 dificultades calibradas a SM5 oficial. |
| **Crear GH** — `gh-autostepper.html` | Generador de charts `.chart` para Clone Hero con 4 dificultades calibradas a YARG/scan-chart. |
| **Test de hardware** — `test-pad.html` | Diagnóstico Gamepad API: calibrar mats genéricos chinos / X-Pads / receptores PS2→USB; medir latencia, sync de audio, bouncing, ghost inputs. |
| **Landing** — `index.html` | Página pública con copy + 8 referencias DOI verificadas (BJSM 2025, meta-meta-análisis exergaming). |
| **Shell SPA** — `app.html` | PWA instalable que envuelve los 6 HTMLs vía iframe + hash routing. |

---

## Stack técnico

- **Vanilla JS** sin bundler, sin TypeScript, sin frameworks. Cada HTML es autocontenido o carga módulos classic-script desde `stepmania-web/js/`.
- **PWA completa**: `manifest.webmanifest`, service worker (`sw.js`) con cache versionado y network-first para HTML, iconos SVG.
- **IndexedDB** para librería de canciones + scores + charts GH (DB `StepManiaWebDB` v3, store compartido entre suite SM y GH).
- **Web Audio API** para reproducción de audio + `AudioContext.decodeAudioData` para análisis offline.
- **Gamepad API** para alfombras USB y guitarras GH (con calibración de roles vía localStorage).
- **Pointer Events + `touch-action:none`** para overlay táctil en móvil (DDR 4-lane).
- **Vitest** para tests de algoritmos puros (parser, difficulty tiers, timing engine).

Decisión consciente: **sin bundler ni transpilación**. Doble click sobre cualquier `.html` lo abre en el navegador y funciona — incluso bajo `file://`. Los paths son todos relativos. Esto sacrifica ergonomía moderna (no hay HMR, no hay imports tipados) a cambio de cero ceremonia y cero deuda de build.

---

## Hardware soportado

### Alfombras de baile
- **RedOctane USB Pad** (VID `1430`, PID `8888`) — el clásico de PS2/PS3, plug-and-play.
- **Cualquier mat genérico** (X-Pad, ImpactDX, Cobalt Flux, mats chinos…) — calibrable desde `test-pad.html` (10 roles físicos: 4 cardinales + 4 diagonales + start/back).

### Guitarras Guitar Hero
- **Guitar Hero PS2** vía receptor USB Sony-emulado (VID `054C`, PID `0268`) — reverse-engineered, calibración completa de 11 roles (5 trastes + strum ↑/↓ + tilt + Star Power + Select + Start). Discriminación strum vs whammy en `axes[1]` compartido (algoritmo en `test-pad.html` y `gh-play.html`).
- **Receptores PS3 nativos / GH3 USB** — soportados transparentemente vía detección automática de tipo (button vs axis).

### Móvil
- **Touch overlay de 4 zonas** se activa automáticamente en dispositivos con `'ontouchstart' in window`. Modo Solo/Full (6/8 carriles) requiere teclado o alfombra.

---

## Desarrollo

### Requisitos
- **Node.js 18+** (probado en 24.5.0).
- **pnpm 10+** (CLAUDE.md global del proyecto exige `pnpm`, no `npm`).
- **Python 3.x** (solo para los scripts `test_pad*.py` de diagnóstico via WinMM).

### Setup
```bash
git clone https://github.com/<tu-org>/sincro
cd sincro
pnpm install         # instala Vitest (única devDep)
```

### Probar manualmente
```bash
# Opción 1 (más simple): doble click sobre cualquier .html en el explorador
# Opción 2: servir desde un dev server (recomendado para PWA / Service Worker)
python -m http.server 8000
# Abrir http://localhost:8000/play.html
```

El service worker y la instalación PWA solo funcionan en `https://` o `localhost`. Bajo `file://` la app sigue jugable pero sin offline cache ni instalación.

### Tests
```bash
pnpm test           # run-once (~430ms, 46 tests)
pnpm test:watch     # watch mode mientras desarrollas
pnpm test:ui        # UI visual de Vitest
```

Los tests cubren **algoritmos puros**: parser SSC/SM, timing engine (BPMs/STOPS/WARPS), filtrado por dificultad calibrado a StepMania 5 oficial. **No** se testean Web Audio, render de canvas, IndexedDB, Gamepad API ni DOM — esos se validan jugando.

Para añadir tests de un módulo nuevo, ver patrón en `tests/parser.test.mjs`. Si el módulo no exporta nada (vive solo en `window`), añadir el guard CJS al final:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { funcion1, funcion2 };
}
```

---

## Despliegue

Despliegue por FTP a `play.movimientofuncional.app`. Credenciales en `.env.local` (no versionado, formato: `FTP_HOST`, `FTP_USER`, `FTP_PASS`, `FTP_REMOTE_DIR`).

```bash
bash scripts/deploy.sh
```

El script sube **26 archivos** del shell (HTML + sw.js + manifest + iconos + carpeta `stepmania-web/`) con una lista de inclusión explícita — eso evita que archivos como `README.md`, `package.json`, `tests/` o `.env.local` se filtren accidentalmente a producción. Cero dependencias (solo `bash` + `curl`).

**Importante:** después de cualquier cambio en archivos del precache, bumpear `CACHE_VERSION` en `sw.js` (p.ej. `sincro-v3` → `sincro-v4`) para que los clientes con SW antiguo detecten la nueva versión.

Headers HTTP recomendados:
- `sw.js` → `Cache-Control: no-cache`
- `manifest.webmanifest` → `Content-Type: application/manifest+json`
- `*.html` → `Cache-Control: no-cache` o ETags
- `*.svg`, `*.css`, `*.js` → cache largo (1 año), invalidación vía `CACHE_VERSION`

Detalles completos: ver sección "Despliegue" de [`CLAUDE.md`](CLAUDE.md).

---

## Estructura del repo

```
sincro/
├── index.html                    Landing pública (copy + ciencia)
├── app.html                      Shell SPA con iframe + hash routing
├── play.html                     Motor DDR (StepMania)
├── gh-play.html                  Motor Guitar Hero (Clone Hero)
├── autostepper.html              Generador de charts DDR
├── gh-autostepper.html           Generador de charts GH
├── test-pad.html                 Diagnóstico de hardware
├── manifest.webmanifest          PWA manifest
├── sw.js                         Service worker
├── icons/                        Iconos SVG (regular + maskable)
├── stepmania-web/
│   ├── css/styles.css            Estilos globales del motor
│   └── js/                       Módulos classic-script
│       ├── core.js               Globals, utils, gamepad polling, IndexedDB, navToken
│       ├── parser.js             Parser .ssc/.sm + timing engine
│       ├── audio-pipeline.js     Análisis de audio compartido (BPM, ODF)
│       ├── difficulty-tiers.js   Filtrado por dificultad calibrado a SM5/CH
│       ├── autostepper.js        Generador de charts SM (integrado en play.html)
│       ├── library.js            UI de import/delete + IndexedDB
│       ├── backup.js             Backup/restore ZIP completo
│       ├── song-select.js        Pantalla de selección de canción
│       ├── pad-test.js           Lógica del test de hardware
│       ├── calibration.js        Pantalla de calibración con metrónomo
│       ├── game.js               Motor de juego (loop, render, scoring)
│       ├── gh-db.js              Wrapper IndexedDB para charts GH
│       ├── app.js                Router top-level + bindings de settings
│       └── pwa-bootstrap.js      Registro del SW + detección de shell
├── tests/                        Tests Vitest (algoritmos puros)
│   ├── parser.test.mjs
│   └── difficulty-tiers.test.mjs
├── scripts/
│   └── deploy.sh                 Deploy FTP a Hostinger (bash + curl)
├── package.json                  Scripts pnpm + Vitest
├── vitest.config.mjs             Config de tests
├── CLAUDE.md                     Documentación técnica profunda (interno)
└── README.md                     Este archivo
```

---

## Documentación más profunda

[`CLAUDE.md`](CLAUDE.md) cubre con detalle exhaustivo:
- Arquitectura interna de cada `.html` y módulo JS.
- Algoritmos: detección de BPM, calibración de dificultades, hit-detection HOPO/tap, redistribución 8→4 lanes.
- Constantes canónicas validadas contra código fuente de StepMania 5.1 (PredictMeter, Stream/Voltage) y Clone Hero (scan-chart, YARG.Core).
- Quirks de hardware (receptores PS2→USB chinos, discriminación strum/whammy en `axes[1]`).
- Workflow de tests, doble export CJS, decisiones de no testear.

Si vas a contribuir o mantener, **lee `CLAUDE.md` primero**. Está pensado para que un agente de IA (o un humano nuevo) pueda construir el modelo mental completo del proyecto sin sesiones de pair-programming.

---

## Roadmap

- Detección de tempo variable (BPM changes) en autosteppers.
- Generación automática de banner/background art (bloqueado por CORS desde navegador — necesitaría proxy o backend).
- Update mode: re-generar charts conservando BPM/offset que el usuario afinó a mano.
- Star Power + whammy modulation en `gh-play.html`.
- Open notes / drums tracks en GH.
- Ampliar cobertura de tests a `audio-pipeline.js` (mockear `AudioBuffer`) y `autostepper.js` (snapshot de output `.ssc`).

---

## Disclaimer médico

Sincro NO es un dispositivo médico ni un sustituto de prescripción profesional. Las referencias científicas en `index.html` (Singh 2025 BJSM, Yoong 2024, Chen 2021…) respaldan beneficios de exergaming para población general. Si tienes patologías cardiovasculares, articulares o neurológicas, consulta con tu médico antes de empezar cualquier programa de ejercicio.

## Licencia

Proyecto privado de Movimiento Funcional. Todos los derechos reservados. Si quieres usarlo o adaptarlo, escribe a [movimientofuncional.net@gmail.com](mailto:movimientofuncional.net@gmail.com).

---

*Hecho con cuidado en castellano por [Elena Cruces](https://movimientofuncional.com) y agentes de IA varios.*
