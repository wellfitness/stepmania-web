# Sincro

> Suite rítmica de [Movimiento Funcional](https://movimientofuncional.com) — entrena cuerpo, oído y función ejecutiva pisando flechas o tocando notas en el navegador.

**Producción:** [play.movimientofuncional.app](https://play.movimientofuncional.app)

Sincro convierte cualquier alfombra de baile USB y/o guitarra Guitar Hero en una herramienta de exergaming científicamente fundamentada para mujeres 40+ (y cualquiera que quiera entrenar 3 cerebros a la vez). Lee tus propios MP3/FLAC/M4A, genera charts automáticos, y los juega con el motor clásico de StepMania o Clone Hero — todo en navegador, sin instalación. PWA instalable como app nativa en Android, Windows, Mac y ChromeOS.

---

## Qué incluye

| Módulo | Para qué |
|--------|----------|
| **Dashboard** — `play.html` | Hub con 8 cards organizadas en 3 secciones (StepMania / Guitar Hero / Comunes). Punto de entrada de la app instalada. |
| **Motor DDR** — `stepmania-play.html` | Motor StepMania completo: parser `.ssc/.sm`, J4-J7 timing, mines, holds/rolls, lifts, fakes, hands, 6 modifiers (mirror/left/right/shuffle/hidden/sudden), librería en IndexedDB, redistribución 4/6/8 lanes en runtime. |
| **Motor GH** — `gh-play.html` | Simulador Guitar Hero con hit-detection canónica de Clone Hero: anchor en single notes, chord matching estricto, HOPO 65 ticks (default de `scan-chart`), taps, sustains, multiplicador 1x-4x. Lee charts `.chart` Feedback/CH. |
| **Crear DDR** — `autostepper.html` | Generador automático de charts `.ssc/.sm` desde MP3/WAV/FLAC/M4A. Bass-emphasis IIR + ODF + autocorrelación de BPM (rango 90-180), 5 dificultades calibradas, presets Suave/Normal/Intenso/Personalizado, cap de duración (90s/120s/180s/completa). |
| **Crear GH** — `gh-autostepper.html` | Generador de charts `.chart` para Clone Hero con 4 dificultades calibradas a YARG / `scan-chart` / `diff_guitar` guidelines. Salida ZIP listo para extraer en `Clone Hero/Songs/`. |
| **Test de hardware** — `test-pad.html` | Diagnóstico Gamepad API en 9 (mat) / 11 (guitar) pestañas: calibrar roles físicos, estadísticas, latencia por panel/traste, stress test, ghost inputs, sync de audio (con metrónomo), bouncing. |
| **Rankings** — `rankings.html` | Página dedicada de ranking arcade: top jugadores por canción, histórico de progresión personal, export/import JSON, filtros por juego y dificultad. |
| **Tutorial** — `tutorial.html` | 8 pestañas con guía completa (cómo empezar, jugar, crear coreografías, probar alfombra, calibración, biblioteca, ajustes, otras herramientas). |
| **Landing pública** — `index.html` | Marketing + 8 referencias DOI verificadas (BJSM 2025, meta-meta-análisis exergaming) + FAQ accordion + modal de requisitos que bloquea el motor en dispositivos no compatibles. |
| **Shell SPA / PWA** — `app.html` | Shell instalable que envuelve los 9 HTMLs vía iframe + hash routing. Permite topbar persistente, instalación "Add to home screen", y nav fluida sin recargas. |

---

## Sistema arcade de puntuaciones

- **Nombre del jugador por partida**: al terminar, formulario coherente con el resto del diseño (modal sobrio, sin clichés gamer). El nombre se persiste en `localStorage` como `sincro-last-player` y se pre-rellena automáticamente la siguiente partida.
- **Top de la canción + Mi progresión**: dos tabs en la pantalla de resultados. El "Top" muestra el mejor run de cada jugador por chart (case-insensitive). "Mi progresión" muestra el histórico personal — útil para ver mejora a lo largo del tiempo.
- **Almacenamiento**: store `runs` en IndexedDB (DB `StepManiaWebDB` v4, índices `songId` / `chartId` / `playerLower`). Cada partida acabada inserta una fila independiente — ranking arcade real, no key-value de "mejor por chart".
- **Export / Import JSON**: los rankings se pueden exportar a un `.json` desde `rankings.html` y restaurar en otro dispositivo o sesión. Útil para hacer torneos caseros o backup manual.
- **Compartido SM + GH**: la suite usa el mismo schema de puntuaciones para los dos juegos.

---

## Biblioteca y gestión de canciones

- **Bibliotecas unificadas SM + GH** accesibles desde el dashboard ("Mis canciones" y "Mis canciones GH").
- **Import** individual (`.ssc/.sm` + audio) o paquetes (carpetas SM, ZIPs del autostepper).
- **Restaurar desde ZIP** acepta exports del autostepper tanto SM como GH automáticamente.
- **Backup completo a ZIP**: canciones + scores + ajustes, comprimido sin dependencias externas (encoder "store").
- **Auto-fix silencioso de tags rotos** al abrir cualquier biblioteca — si una entrada tiene metadata vacía o corrupta, se rellena desde los tags del audio en background.
- **Preview auditivo al hover** sobre las filas de la biblioteca: reproduce 5-10s del audio para identificar la canción sin tener que jugarla.
- **Filtros** por título y artista en ambos juegos (case-insensitive, `.includes()`).
- **Lectura de tags ID3v2/v1, Vorbis Comments (FLAC) y MP4 atoms (M4A/iTunes/Apple Music)** al soltar archivos en los autosteppers — replica lo que hace Windows Explorer.
- **Gestión robusta de quota IndexedDB**: cuando Safari iOS o Android quedan sin storage, el import se detiene con mensaje accionable que indica los MB usados y sugiere backup ZIP antes de seguir.

---

## Recalibración de curva de dificultad (2026-05-12, dos pasadas)

La curva Easy → Medium → Hard se rebalanceó tras feedback de sesión real. Los caps originales estaban por encima del techo de los rangos oficiales (DDR Stream formula, GH `diff_guitar` guidelines) y el salto Easy → Medium se sentía como entrar a otro juego.

**Pasada 1** (commit `52cb36f`): alineación inicial con rangos oficiales. Ratio Easy → Medium SM 1.75x → 1.30x. SM Medium subió `minRhythmPriority` de 2 a 3 (igual que Easy), eliminando el escalón cualitativo "Easy solo beats / Medium ya corcheas offbeat".

**Pasada 2** (commit posterior, solo SM): tras jugar partidas reales, Medium SM aún se sentía denso. Bajada adicional.

Valores actuales:

| Tier | SM | GH |
|---|---|---|
| Beginner / — | 1.00s · 1.0 NPS · prio 4 | — |
| Easy / Easy | 0.50s · 2.0 NPS · prio 3 | 0.70s · 1.4 NPS · prio 4 |
| Medium | **0.45s · 2.2 NPS · prio 3** | 0.55s · 1.9 NPS · prio 3 |
| Hard | **0.28s · 3.5 NPS · prio 2** | 0.30s · 3.5 NPS · prio 2 |
| Challenge / Expert | **0.12s · 7.0 NPS · prio 0** | 0.17s · 6.0 NPS · prio 0 |

**Ratio Easy → Medium final:** SM 1.10x, GH 1.36x (este último alineado con la progresión geométrica 1.33x que YARG usa en `NoteSpeedScale`, `DifficultyExtensions.cs:55-72`). La calibración previa sigue accesible vía preset Intenso (×1.30). Los charts ya generados conservan su dificultad — el filtro se aplica solo en generación.

---

## Compatibilidad de dispositivo

- **Bloqueo en móvil y tablet**: el motor requiere viewport ≥ 1024×600 + `pointer: fine`. Si no se cumple, los enlaces al motor muestran un modal explicando los requisitos y redirigen a la FAQ. La landing es accesible siempre (contenido informativo legítimo). Sin bypass "continuar de todos modos" — la decisión consciente es bloquear el motor porque el coste de frustración con cables OTG que no van supera al de prohibir entrar.
- **Sección FAQ** en la landing con 7 items accordion (`<details>`) sobre dispositivos soportados, equipo necesario, almacenamiento, etc.
- **Detección estricta de gamepads**: filtro en 3 capas (blacklist por nombre + heurística numérica + fallback) evita que Chrome confunda un casco `USB Audio` con la alfombra. La misma regex vive en 3 archivos sincronizados (`core.js`, `test-pad.html`, `gh-play.html`).

---

## Stack técnico

- **Vanilla JS** sin bundler, sin TypeScript, sin frameworks. Cada HTML es autocontenido o carga módulos classic-script desde `stepmania-web/js/`.
- **PWA completa**: `manifest.webmanifest`, service worker (`sw.js`) con cache versionado (`sincro-vXX`), network-first para HTML navegacional, cache-first para CSS/JS/iconos, stale-while-revalidate para Google Fonts. Range requests passthrough (audio del motor).
- **IndexedDB** (`StepManiaWebDB` v4): stores `songs`, `runs`, `gh-songs`. Migración v3→v4 automática (sustituye legacy `scores` key-value por `runs` con nombre + autoincrement).
- **Web Audio API** centralizada: `ensureAudioCtx()` síncrono para `decodeAudioData`, `ensureAudioCtxRunning()` async para reproducción (gestiona el quirk de iOS Safari + autoplay policy).
- **Gamepad API** con polling pausado en `visibilitychange === 'hidden'` para no quemar batería en background.
- **Pointer Events + `touch-action:none`** para overlay táctil en móvil (DDR 4-lane).
- **Vitest** para tests de algoritmos puros (parser, difficulty tiers, scores, audio-metadata).

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
- **Touch overlay de 4 zonas** se activa automáticamente en dispositivos con `'ontouchstart' in window`. Modo Solo/Full (6/8 carriles) requiere teclado o alfombra. El motor solo es accesible si el viewport llega a 1024×600 + `pointer: fine` (ver "Compatibilidad de dispositivo" arriba).

---

## Desarrollo

### Requisitos
- **Node.js 18+** (probado en 24.5.0).
- **pnpm 10+** (CLAUDE.md global del proyecto exige `pnpm`, no `npm`).
- **Python 3.x** (solo para los scripts `test_pad*.py` de diagnóstico vía WinMM).

### Setup
```bash
git clone https://github.com/wellfitness/stepmania-web
cd stepmania-web
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
pnpm test           # run-once (~560ms, 96 tests)
pnpm test:watch     # watch mode mientras desarrollas
pnpm test:ui        # UI visual de Vitest
```

Cobertura actual:
- **parser.test.mjs** — 23 tests: parseo `.ssc/.sm` (incluye legacy 6-partes), comentarios `//`, `parseSscPairs`, `buildTimingEngine` (BPMs/STOPS/WARPS), `parseAttacks`, `quantColorFor`.
- **difficulty-tiers.test.mjs** — 23 tests: monotonía de NPS y minGap, `rhythmPriority`, `filterByDifficulty` con invariantes (NPS cap, gap mínimo, retención por tier), `filterPositions48` round-trip, `filterTicks` GH, `PRESET_MULTIPLIER`.
- **scores.test.mjs** — 23 tests: sanitización de nombre, `chartIdOf`, `rankRuns` (sort por score desc, ties por antigüedad), `bestRunPerPlayer` case-insensitive.
- **audio-metadata.test.mjs** — 27 tests: ID3v2.3/v2.4 (UTF-8/UTF-16/LATIN1 con tildes y emoji, multi-valor `\0`, "5/12"→"5"), ID3v1/v1.1, FLAC Vorbis Comments, M4A iTunes atoms, `parseFromFilename` con prefijos de track#.

Los tests cubren **algoritmos puros**. **No** se testean Web Audio, render de canvas, IndexedDB wrappers, Gamepad API ni DOM — esos se validan jugando.

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

El script sube **todos los archivos versionados en git** (`git ls-files`) excepto los que matchean el regex de exclusión (docs `.md`, `package.json`, `tests/`, `scripts/`, `.env.*`, `design-system/`, `stepmania-5_1-new/`, `YARG-master/`, etc.). Al cierre de este README son **38 archivos productivos**. Ventaja clave: añadir un asset nuevo (HTML, imagen, módulo JS) solo requiere `git add` + commit — el deploy lo recoge automáticamente. Cero dependencias (solo `bash` + `curl` con `--ssl-allow-beast -k` para sortear el SChannel-strict OCSP de Windows).

**Importante:** después de cualquier cambio en archivos del precache, bumpear `CACHE_VERSION` en `sw.js` (p.ej. `sincro-v33` → `sincro-v34`) para que los clientes con SW antiguo detecten la nueva versión.

Headers HTTP recomendados:
- `sw.js` → `Cache-Control: no-cache`
- `manifest.webmanifest` → `Content-Type: application/manifest+json`
- `*.html` → `Cache-Control: no-cache` o ETags
- `*.svg`, `*.css`, `*.js` → cache largo (1 año), invalidación vía `CACHE_VERSION`

Detalles completos: ver sección "Despliegue" de [`CLAUDE.md`](CLAUDE.md).

---

## Estructura del repo

```
stepmania-web/
├── index.html                    Landing pública (copy + ciencia + FAQ + modal requisitos)
├── app.html                      Shell SPA con iframe + hash routing
├── play.html                     Dashboard con 8 cards (entrada de la PWA)
├── stepmania-play.html           Motor DDR (StepMania)
├── gh-play.html                  Motor Guitar Hero (Clone Hero)
├── autostepper.html              Generador de charts DDR
├── gh-autostepper.html           Generador de charts GH
├── test-pad.html                 Diagnóstico de hardware (mat + guitar)
├── tutorial.html                 Tutorial completo (8 pestañas)
├── calibration.html              Redirect a test-pad#alfombra-sync (deep-link compat)
├── rankings.html                 Página dedicada de ranking arcade
├── manifest.webmanifest          PWA manifest
├── sw.js                         Service worker
├── icons/                        Iconos SVG (regular + maskable)
├── stepmania-web/
│   ├── css/styles.css            Estilos globales del motor
│   └── js/                       Módulos classic-script
│       ├── core.js               Globals, utils, gamepad polling, IndexedDB v4, navToken
│       ├── parser.js             Parser .ssc/.sm + timing engine
│       ├── audio-pipeline.js     Análisis de audio compartido (BPM, ODF, peaks)
│       ├── audio-metadata.js     Parser ID3v2/v1 + Vorbis (FLAC) + iTunes (M4A)
│       ├── difficulty-tiers.js   Filtrado por dificultad calibrado a SM5/CH/YARG
│       ├── library.js            UI biblioteca SM (import/delete/preview/filtros)
│       ├── backup.js             Backup/restore ZIP completo SM
│       ├── gh-db.js              Wrapper IndexedDB para charts GH
│       ├── gh-backup.js          Backup/restore ZIP GH
│       ├── scores.js             Sistema arcade: nombre, runs, ranking, histórico
│       ├── song-select.js        Pantalla de selección de canción
│       ├── pad-test.js           Lógica del test de hardware
│       ├── game.js               Motor de juego (loop, render, scoring)
│       ├── app.js                Router top-level + bindings de settings
│       └── pwa-bootstrap.js      Registro del SW + detección de shell
├── tests/                        Tests Vitest (96 tests, ~560ms)
│   ├── parser.test.mjs
│   ├── difficulty-tiers.test.mjs
│   ├── scores.test.mjs
│   └── audio-metadata.test.mjs
├── scripts/
│   └── deploy.sh                 Deploy FTP (bash + curl, lee git ls-files)
├── package.json                  Scripts pnpm + Vitest
├── vitest.config.mjs             Config de tests
├── CLAUDE.md                     Documentación técnica profunda (interno)
└── README.md                     Este archivo
```

---

## Historial destacado (changelog resumido)

Cambios significativos desde la creación del README:

- **2026-05-12** — Segunda pasada de afinado en tiers SM (Medium 2.2 NPS, Hard 3.5, Challenge 7.0). Ratio Easy→Medium SM 1.30x → 1.10x.
- **2026-05-12** — Curva de dificultad suavizada en autosteppers SM + GH (commit `52cb36f`).
- **2026-05-12** — Restaurar desde ZIP acepta exports del autostepper (`bef865b`).
- **2026-05-11** — Form de guardar puntuación coherente con el resto del diseño (`2b32a28`).
- **2026-05-11** — Auto-fix silencioso de tags rotos al abrir biblioteca (`4fe39c3`).
- **2026-05-10** — Parser M4A (MPEG-4 / iTunes / Apple Music) (`3360920`).
- **2026-05-09** — SW precache con `cache:'reload'` para no servir assets viejos (`9c982ec`).
- **2026-05-09** — Botón "Refrescar metadatos" en bibliotecas SM y GH (`257bb1a`).
- **2026-05-09** — UI ranking pulida en results + ocultar champion vacío (`aaed4b3`).
- **2026-05-08** — Fix tags UTF-16: strip de NUL post-decode (`803dfb3`).
- **2026-05-08** — Lectura de tags ID3 en autosteppers (`273ea33`).
- **2026-05-07** — Filtros título/artista en bibliotecas + selector "Colores activos" en GH (`bd19415`).
- **2026-05-06** — Preview auditivo en bibliotecas de gestión (`677db39`).
- **2026-05-06** — Fix navegación del topbar del shell + página dedicada `/rankings` (`a7e17d0`).
- **2026-05-05** — `downloadAllZip` síncrona en SM y GH (`84a0b85`).
- **2026-05-04** — Modal de requisitos sin auto-popup en la landing (`562a43f`).
- **2026-05-04** — Bloqueo en móvil y tablet + sección FAQ en la landing (`794c697`).
- **2026-05-03** — Logo de marca Sincro en topbars + OG/SEO al día (`03376e1`).
- **2026-05-02** — Puntuaciones arcade en Guitar Hero + página dedicada de rankings + export/import JSON (`2d29d46`).
- **2026-05-02** — Deploy robusto: `git ls-files` + `.htaccess` (`57820f0`).
- **2026-05-01** — Sistema arcade de puntuaciones: nombre + ranking + histórico (`e9ad2f5`).
- **2026-04-30** — Hero con imagen full-bleed + acentos rosa neón + OG image (`67dc578`).
- **2026-04-29** — Bibliotecas SM y GH unificadas + backup GH (`0394b51`).
- **2026-04-28** — Separar `play.html` monolítico en dashboard + archivos dedicados (`956d98e`).

---

## Documentación más profunda

[`CLAUDE.md`](CLAUDE.md) cubre con detalle exhaustivo:
- Arquitectura interna de cada `.html` y módulo JS.
- Algoritmos: detección de BPM, calibración de dificultades, hit-detection HOPO/tap, redistribución 8→4 lanes.
- Constantes canónicas validadas contra código fuente de StepMania 5.1 (PredictMeter, Stream/Voltage) y referentes GH (`scan-chart` de Geomitron, YARG / YARG.Core, `diff_guitar` guidelines de customsongscentral).
- Quirks de hardware (receptores PS2→USB chinos, discriminación strum/whammy en `axes[1]` compartido).
- Workflow de tests, doble export CJS, decisiones de no testear.

Si vas a contribuir o mantener, **lee `CLAUDE.md` primero**. Está pensado para que un agente de IA (o un humano nuevo) pueda construir el modelo mental completo del proyecto sin sesiones de pair-programming.

---

## Roadmap

- Detección de tempo variable (BPM changes) en autosteppers.
- Generación automática de banner/background art (bloqueado por CORS desde navegador — necesitaría proxy o backend).
- Update mode: re-generar charts conservando BPM/offset que el usuario afinó a mano.
- Botón "Regenerar chart" en biblioteca usando el `audioBlob` ya guardado (evita re-arrastrar audios tras cambios de calibración).
- Star Power + whammy modulation en `gh-play.html`.
- Open notes / drums tracks en GH.
- Ampliar cobertura de tests a `audio-pipeline.js` (mockear `AudioBuffer`).

---

## Disclaimer médico

Sincro NO es un dispositivo médico ni un sustituto de prescripción profesional. Las referencias científicas en `index.html` (Singh 2025 BJSM, Yoong 2024, Chen 2021…) respaldan beneficios de exergaming para población general. Si tienes patologías cardiovasculares, articulares o neurológicas, consulta con tu médico antes de empezar cualquier programa de ejercicio.

## Licencia

Proyecto privado de Movimiento Funcional. Todos los derechos reservados. Si quieres usarlo o adaptarlo, escribe a [movimientofuncional.net@gmail.com](mailto:movimientofuncional.net@gmail.com).

---

*Hecho con cuidado en castellano por [Elena Cruces](https://movimientofuncional.com) y agentes de IA varios.*
