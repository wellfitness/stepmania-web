# Sincro — Suite rítmica de Movimiento Funcional

> 📄 Detalles técnicos profundos (algoritmos paso a paso, mapeos físicos completos, historial de decisiones, constantes canónicas con extractos, tests): ver [PROJECT-DETAILS.md](./PROJECT-DETAILS.md)

Suite de juego rítmico en navegador para alfombra de baile (RedOctane USB Pad VID 1430 / PID 8888 + cualquier mat genérico calibrable) y guitarra Guitar Hero (PS2 vía receptor USB Sony-emulado VID 054C/PID 0268, recalibrable). Marca paraguas: **Sincro**. Compatible con el formato `.ssc/.sm` de StepMania 5 (instalado opcionalmente en `C:\Games\StepMania 5`).

## Archivos

### HTML raíz

- **`index.html`** — Landing pública SEO. Hero + 3 pilares (físico/mental/cognitivo) + FAQ + bloqueo a no-compatibles (viewport < 1024×600 o sin `pointer:fine`). 8 DOI verificados.
- **`app.html`** — Shell SPA con topbar persistente + iframe que envuelve los 9 HTMLs clásicos vía hash routing. Es lo que abre la PWA por defecto.
- **`play.html`** — Dashboard puro con 8 cards en 3 secciones (StepMania / Guitar Hero / Comunes). Carga solo `pwa-bootstrap.js` + `core.js`. ~280 líneas.
- **`stepmania-play.html`** — Motor DDR (SPA con songs/diff/play/results/library). Carga `core` → `parser` → `difficulty-tiers` → `library` → `backup` → `song-select` → `game` → `app`.
- **`gh-play.html`** — Simulador Guitar Hero (charts `.chart` Clone Hero). Self-contained, lee `guitarMapping` calibrado en test-pad.
- **`autostepper.html`** — Generador SM standalone (output `.ssc/.sm` en ZIP).
- **`gh-autostepper.html`** — Generador GH standalone (output `.chart` + `song.ini` en ZIP).
- **`test-pad.html`** — Diagnóstico hardware (Gamepad API). Modo Alfombra (9 tabs) y Guitarra (11 tabs). Calibración persistida en `localStorage` (`mat-mapping` / `guitar-mapping`).
- **`tutorial.html`** — Página estática con 8 pestañas de tutorial.
- **`calibration.html`** — Redirect HTML a `test-pad.html#alfombra-sync` (consolidación 2026-05-12).

### Módulos JS (`stepmania-web/js/`)

- **`core.js`** — Helpers, AudioContext, `pollGamepad()`, IndexedDB wrappers, `settings`, `navToken`. Cargado por TODOS los HTMLs.
- **`audio-pipeline.js`** — Pipeline de detección (bassEmphasize bass+mid en una pasada → ODF → BPM → offset). Compartido por SM y GH autosteppers.
- **`audio-metadata.js`** — Parser binario ID3v2.3/v2.4/v1 (MP3) + Vorbis Comments (FLAC). Sin deps.
- **`sm-flow.js`** — Motor de flow biomecánico (alternancia L/R, anti-crossover, drills automáticos). Reemplaza al `Math.random()` del SM autostepper.
- **`mat-layout.js`** — Detección automática de diagonales (`'up' | 'down'`) según `mat-mapping`.
- **`difficulty-tiers.js`** — Filtrado por dificultad (NPS objetivo + minGap + priority rítmica).
- **`parser.js`** — Parser `.ssc/.sm`.
- **`gh-db.js`** — IndexedDB store `gh-songs`.
- **`pwa-bootstrap.js`** — Registra SW, expone `window.SincroPWA`, captura `beforeinstallprompt`, oculta topbars internos cuando está en shell.
- Otros: `game.js`, `song-select.js`, `library.js`, `backup.js`, `app.js`, `pad-test.js`.

### Scripts Python

`test_pad*.py`, `detectar-guitarra.py` — Tests vía WinMM `joyGetPosEx`. Útiles si la Gamepad API del navegador no detecta el dispositivo. Solo `ctypes`, sin pygame. Mapping físico distinto al del navegador (ver PROJECT-DETAILS).

---

## Reglas de negocio que no se pueden romper

### Política 8-lane unificada

Todos los charts del autostepper (SM integrado y standalone) son `dance-double` (8 carriles, master único). El motor decide en runtime cómo jugarlos vía `getActiveLaneConfig` en `game.js`: **default = 4 carriles**, mod Solo = 6, mod Full = 8. Mods Solo y Full mutuamente excluyentes. El remap simétrico (8→4, 8→6) vive en `game.js:279-303`. Charts antiguos `dance-single` o `dance-solo` siguen funcionando.

### Adaptación automática de diagonales

Cuando el modo Solo está activo, `getActiveLaneConfig` consulta `MatLayout.detectMatDiagonalLayout()` y elige entre `[6]` (diagonales superiores ↖↗ canónicas DDR) y `['6-down']` (diagonales inferiores ↙↘) según qué tenga calibrado el usuario en `mat-mapping`. Caso real: alfombras Amazon 10-25€ con cardinales + 2 diagonales inferiores. Cuando hay las 4 diagonales el layout es `'up'`. Sin setting de UI — automático y silencioso.

### Sistema de speed mods (3 modos)

Réplica de SM5 oficial. Usuario elige uno en el modal de ajustes:
- **xMod** (`scrollSpeed`, 0.5–3.0): multiplicador clásico sobre base 600 px/s.
- **CMod** (`cmodBPM`, 100–700, default 300): velocidad CONSTANTE en BPM equivalente, independiente del BPM real.
- **MMod** (`mmodBPM`, 100–700, default 450): xMod con techo. `min(scrollSpeed × 600, mmodBPM × 3)`.

**Equivalencia**: `xMod 1.0 ≡ CMod 200` (alineado con `CMOD_DEFAULT` del repo oficial). Constante: `SCROLL_PPS_PER_BPM = 600/200 = 3` en `core.js`. Cálculo central: `computePixelsPerSec(songBPM, chartSpeedMul)`. Nuestro xMod NO escala con songBPM (decisión heredada — motor "tiempo absoluto"). UI vía `refreshSpeedModeUi()`.

### Filtrado por dificultad

La densidad NO se controla por stride relativo a los onsets, sino por: NPS objetivo absoluto + `minGapSec` absoluto + priority rítmica (5=downbeat, 4=mid-measure, 3=beat, 2=corchea offbeat, 1=semicorchea, 0=otro) + cap por ventana deslizante de 3s.

Tabla calibrada (tier → minGap / NPS max / minRhythmPriority):

| Tier         | minGap | NPS max | minPriority |
|--------------|--------|---------|-------------|
| SM Beginner  | 1.00s  | 1.0     | 4           |
| SM Easy      | 0.50s  | 2.0     | 3           |
| SM Medium    | 0.45s  | 2.2     | 3           |
| SM Hard      | 0.28s  | 3.5     | 2           |
| SM Challenge | 0.12s  | 7.0     | 0           |
| GH Easy      | 0.70s  | 1.4     | 4           |
| GH Medium    | 0.55s  | 1.9     | 3           |
| GH Hard      | 0.30s  | 3.5     | 2           |
| GH Expert    | 0.17s  | 6.0     | 0           |

**Presets globales** (multiplicadores): 🌿 Suave ×0.7 · ⚡ Normal ×1.0 · 🔥 Intenso ×1.3.

API: `window.DifficultyTiers.{filterByDifficulty, filterPositions48, filterTicks}`.

### Sesión multijugador

Al marcar ≥1 canción y "🎮 Crear partida", se pide el nombre vía `prompt()` UNA vez. Se guarda en `playSession.playerName` y `endGame()`/`finishGame()` auto-persisten cada run a IndexedDB. Banner entre canciones muestra chip "Próxima jugada: **X** [✎ cambiar]" — al pulsar Cambiar, input editable + pausa countdown. Resumen final con desglose por jugador (`playerCounts` Map). Implementado simétrico en SM (`song-select.js` + `game.js`) y GH (`gh-play.html`).

**Razón**: caso real de uso en casa (madre + peque alternando turnos). Antes solo se guardaba si la usuaria pulsaba Guardar en < 5s, así que las canciones intermedias se perdían.

### Menú de pausa canónico SM5/ITG arcade

`ESC` durante partida abre overlay con 3 botones: **▶ Reanudar** (default, focus forzado) · **↻ Reiniciar canción** · **✕ Salir al menú**. Implementado en SM (`game.js`) y GH (`gh-play.html`). Variables `isPaused` + `pausedAtCtxTime` + `LEAD_IN_SEC`. `togglePause()` recrea `AudioBufferSourceNode` (one-shot) al reanudar. Guards `if (isPaused) return` en handlers de input; en `gameLoop`/`tick` guard que sigue pidiendo frames pero no renderiza.

### HOPO threshold canónico CH

**65 ticks** a resolución 192 (≈ 1/3 de un beat, tresillo de corcheas). Default en `gh-play.html`. Validado contra `natural-hopo.ts` de `scan-chart` de Geomitron. Si el `song.ini` define `hopo_frequency`, sobrescribe.

### Sincro NO soporta móvil/táctil

Landing (`index.html`) bloquea con modal `#req-modal` enlaces al motor si viewport < 1024×600 o `pointer:fine` ausente. Shell (`app.html`) bloquea entrada directa con clase `shell-blocked` + flag `window.__sincroShellBlocked`. **Sin bypass** — el coste de frustración (1 hora con cables OTG que no van) supera al de prohibir entrar. El overlay táctil existió hasta 2026-05-15 y se eliminó porque la heurística (`maxTouchPoints > 0`) daba falso positivo en monitores Windows con pantalla táctil.

### Cuenta atrás solapada con audio (2026-05-15)

`src.start()` ANTES de `await runCountdown`, así la música suena durante todo el countdown. `LEAD_IN_SEC = 5.0` (= duración countdown). Pasos numéricos `5 → 4 → 3 → 2 → 1` (sin palabras), beep ascendente 660→740→820→900→1320 Hz. Aplicado simétrico en SM (`game.js`) y GH (`gh-play.html`).

---

## Constantes canónicas (resumen)

Toda decisión de timing/densidad está validada contra código fuente abierto:

- **StepMania 5.1** (`stepmania-5_1-new/`): `Stream = NPS/7` (`NoteDataUtil.cpp:1142`), `voltage_window = 8 beats` (`NoteDataUtil.cpp:1023`), PredictMeter formula (`Steps.cpp:235`). Validación de nuestros caps: Beginner ≈ meter 2, Challenge ≈ 13-14.
- **`scan-chart` de Geomitron** (https://github.com/Geomitron/scan-chart): HOPO threshold `.chart` = `floor((65/192)·resolution)` = 65 ticks a res 192. Reglas de natural HOPO en `natural-hopo.ts`.
- **YARG.Core** (https://github.com/YARC-Official/YARG.Core): `HopoLeniency=80ms`, `StrumLeniency=50ms`, `MaxWindow=140ms` (±70ms hitbox). Nuestras windows (45/90/135 ms) son más estrictas pero entran dentro del 140ms.

**Importante**: ni CH ni YARG auto-generan charts por dificultad — todas las dificultades son creadas a mano. Nuestra calibración GH se basa en análisis estadístico de GH 1/2/3 + guías comunitarias `diff_guitar` 0-6 + validación cruzada con SM5 PredictMeter.

---

## Cómo usar

Doble click sobre los `.html` los abre en el navegador. Dos modos de entrada:

- **Web pública / SEO**: `index.html` (landing) → CTAs al shell SPA (`app.html#/stepmania-play`, etc.). Sirve `play.movimientofuncional.app/`.
- **App instalada (PWA)**: manifest abre `app.html#/play` (dashboard). Shell envuelve los 9 HTMLs vía iframe + hash routing.

Puntos de entrada sin shell (debug, link directo):
- `play.html` → dashboard.
- `stepmania-play.html` / `gh-play.html` (con hash `#library` para abrir biblioteca).
- `autostepper.html` / `gh-autostepper.html` → generadores.
- `test-pad.html` → diagnóstico.
- `tutorial.html`, `calibration.html`.

Para los Python: `python test_pad.py` desde PowerShell (Python 3.x estándar, sin paquetes).

Para tests: `pnpm install` → `pnpm test` (~450ms, 167 tests). Ver sección Tests.

---

## Estado de StepMania 5 local

- **Instalado en**: `C:\Games\StepMania 5`
- **Config**: `C:\Users\HP\AppData\Roaming\StepMania 5\Save\`
  - `Keymaps.ini`: alfombra mapeada a Joy1 (Up=B1, Down=B2, Left=B3, Right=B4).
  - `Preferences.ini`: `LastSeenInputDevices=...|RedOctane USB Pad|...`, `AutoMapOnJoyChange=1`.
- **Canciones**: `C:\Games\StepMania 5\Songs\` (los ZIPs del autostepper se descomprimen aquí).

---

## Despliegue

- **Dominio**: `play.movimientofuncional.app` (subdominio MF). El antiguo `stepmania.movimientofuncional.app` se retiró tras el rebrand.
- **Credenciales FTP**: en `.env.local` (raíz). **Nunca commitear** — ignorado por `.gitignore`.
- **Script**: `bash scripts/deploy.sh` (curl, cero deps). Lee `.env.local` y sube **todos los archivos versionados en git** excepto los que matchean `EXCLUDE_REGEX` (docs `.md`, `LICENSE`, `package.json` / `pnpm-lock.yaml` / `vitest.config.mjs`, scripts `*.py`, fuentes `*.png`, y dirs no-prod: `scripts/`, `tests/`, `design-system/`, `stepmania-5_1-new/`, `.claude/`, `.husky/`, `node_modules/`).
- **Ventaja**: añadir un asset nuevo solo requiere `git add` + commit — el deploy lo recoge automáticamente.
- **Anti-leak**: si añades un archivo cuyo path matchea un prefijo excluido (p.ej. `notas.md` en raíz, `.py` en raíz), NO se sube.
- **CRÍTICO**: bumpear `CACHE_VERSION` en `sw.js` en cada deploy que cambie archivos del precache. Sin bump, los clientes con SW antiguo siguen sirviendo desde caché y los fixes nunca llegan. Versión al 2026-05-12: `'sincro-v25'`.

---

## Tests

Suite con **Vitest**. Filosofía: testeamos lo matemáticamente verificable sin navegador; lo demás (render, Web Audio, Gamepad, IndexedDB) se valida jugando. **Total: 167 tests, ~450ms.**

- `tests/parser.test.mjs` — 23 tests del parser `.ssc/.sm`.
- `tests/difficulty-tiers.test.mjs` — 23 tests del filtrado por dificultad.
- `tests/audio-metadata.test.mjs` — 27 tests del parser ID3/FLAC.
- `tests/mat-layout.test.mjs` — 11 tests de detección de diagonales.
- `tests/sm-flow.test.mjs` — 24 tests del flow biomecánico.
- `tests/scores.test.mjs` — 23 tests del sistema de scores (helpers puros).
- `tests/radar.test.mjs` — 28 tests del Groove Radar.
- `tests/audio-pipeline.test.mjs` — 8 tests de respuesta en frecuencia de `bassEmphasize` (bass+mid en una pasada).

**Doble export CJS** en archivos source para que Vitest pueda `import`: `if (typeof module !== 'undefined' && module.exports) module.exports = api;` al final del módulo (ver `parser.js:275-289`, `difficulty-tiers.js:259-274`).

**NO se testea** (decisión consciente): render del canvas, Service Worker, wrappers IndexedDB, gamepad polling, Web Audio playback.

---

## PWA

- **`manifest.webmanifest`**: `start_url: /app.html#/play`, `display: standalone`, `theme_color: #00bec8`, 4 shortcuts.
- **`sw.js`** (raíz, scope `/`):
  - `install`: precache del shell estático (lista en `PRECACHE_URLS`).
  - HTML navigation: network-first con fallback inteligente por ruta (shell SPA → `/app.html`, otras → `/index.html`).
  - CSS/JS/iconos same-origin: cache-first.
  - Range requests: passthrough (no romper audio segmentado).
  - `CACHE_VERSION` debe bumpearse en cada deploy con cambios en precache.
- **Headers HTTP**: `sw.js` y `*.html` con `Cache-Control: no-cache`; `manifest.webmanifest` con `Content-Type: application/manifest+json`.

Cada HTML inyecta en `<head>` link al manifest, theme-color, icon SVG, apple-touch-icon, y `pwa-bootstrap.js`.

---

## Pendiente / ideas futuras

- Detección de tempo variable (BPM changes) en autostepper.
- Pitch-aware fret assignment en `gh-autostepper.html` (FFT + low→Verde, high→Naranja).
- Generación de banner/background art automática (bloqueado por CORS — requiere proxy o backend).
- Update mode: re-generar charts conservando BPM/offset que el usuario afinó a mano.
- Modo couple/double y edit mode (no replicados desde StepMania nativo).
- Variable BPM en `gh-play.html` (parser ya soporta múltiples `B` en SyncTrack pero `tickToTime` solo usa el primero).
- Tap notes (fret 6) y open notes (fret 7) explícitos en `gh-autostepper.html`.
- Considerar simplificar timing windows GH a hitbox único ±70 ms (más fiel a CH/YARG).

---

## Índice de PROJECT-DETAILS.md

Para detalles profundos consulta [PROJECT-DETAILS.md](./PROJECT-DETAILS.md):

- **Detalles por archivo HTML** — lifecycle async, guards de pausa, navToken, decisiones de UI por archivo.
- **Detalles por módulo JS** — `core.js`, `audio-metadata.js` (synchsafe ints, UTF-16 NUL post-decode), `sm-flow.js`, `gh-db.js`.
- **Hardware: mapeos físicos** — alfombra/guitarra defaults, discriminación strum vs whammy, selección de gamepad en 3 capas (regex blacklist).
- **Algoritmos** — audio pipeline paso a paso, filtrado por dificultad pseudocódigo.
- **IndexedDB schema y helpers** — store `runs`, helpers puros (`chartIdOf`, `sanitizePlayerName`, `rankRuns`, `bestRunPerPlayer`).
- **Constantes canónicas (extractos)** — fórmulas SM5 PredictMeter, reglas natural HOPO, valores YARG.Core preset.
- **Historial de decisiones y reverts** — multi-banda revertida (2026-05-15), recalibración tiers (2026-05-12 dos pasadas), eliminación overlay táctil, fix UTF-16 v25.
- **Shell SPA y PWA detallado** — rutas, bloqueo no-compatibles, estrategia SW completa.
- **Tests por archivo** — qué cubre cada `.test.mjs`, doble export CJS, qué NO se testea.
