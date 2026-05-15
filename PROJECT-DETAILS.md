# PROJECT-DETAILS — Sincro

> 📌 Volver al resumen: [CLAUDE.md](./CLAUDE.md)

Detalle técnico profundo del proyecto. El `CLAUDE.md` raíz contiene el resumen operativo (~250 líneas) con las reglas que no se pueden romper; aquí vive todo lo que necesita contexto extenso: lifecycle async, algoritmos paso a paso, mapeos físicos de hardware, historial de decisiones y constantes canónicas con extractos.

## Índice

- [Detalles por archivo HTML](#detalles-por-archivo-html)
- [Detalles por módulo JS](#detalles-por-módulo-js)
- [Hardware: mapeos físicos](#hardware-mapeos-físicos)
- [Algoritmos](#algoritmos)
- [IndexedDB schema y helpers](#indexeddb-schema-y-helpers)
- [Constantes canónicas (extractos)](#constantes-canónicas-extractos)
- [Historial de decisiones y reverts](#historial-de-decisiones-y-reverts)
- [Shell SPA y PWA detallado](#shell-spa-y-pwa-detallado)
- [Tests por archivo](#tests-por-archivo)

---

## Detalles por archivo HTML

### `index.html` — landing pública

HTML semántico autocontenido (CSS embedded, sin dependencias del motor). Estructura completa:

- **Modal de requisitos + bloqueo en dispositivos no compatibles (2026-05-12):** un IIFE inline al final del `<body>` evalúa `isCompatibleDevice()` = viewport mínimo 1024×600 + `pointer: fine`. Si NO compatible: intercepta clicks en TODOS los enlaces `a[href^="app.html"]` y a archivos del motor (`play.html`, `stepmania-play.html`, `gh-play.html`, `autostepper.html`, `gh-autostepper.html`, `test-pad.html`, `tutorial.html`, `calibration.html`) con `preventDefault()` + muestra modal `#req-modal`. **NO se hace auto-popup al entrar** — la landing es contenido informativo legítimo y la usuaria móvil debe poder leerlo; el modal aparece solo cuando intenta entrar al juego. No hay bypass para "continuar de todos modos" — la decisión consciente es bloquear el motor porque el coste de frustración (1 hora con cables OTG que no van) supera con creces el de prohibir entrar. El link "Jugar" del header se retiró en el mismo cambio; el último item del nav apunta a `#faq`.
- **Sección FAQ `#faq`:** 7 `<details>` accordion-style con preguntas frecuentes (dispositivos soportados, equipo necesario, móvil/tablet, almacenamiento). Cada item con `summary` clickable + `faq-body` que incluye listas con códigos de color (`.ok` verde, `.warn` amarillo, `.ko` rojo). El primer item está `open` por defecto. Usa `<details>` nativo sin JS.
- **Hero** con copy "Pisa el ritmo, entrena 3 cerebros a la vez" + lluvia animada de flechas DDR + 3 CTAs (Jugar / Crear chart / Probar hardware).
- **3 pilares de beneficios**: Físico (cita BJSM 2025), Mental (música activa redes globales), Cognitivo (sincronización auditivo-motora).
- **"Cómo funciona en tu cerebro"**: SVG inline de 5 redes neurales animadas.
- **"Y también con guitarra"**: bonus track con disclaimer ("la guitarra no es cardio") y 4 mini-pilares.
- Tabla comparativa exergaming vs ejercicio tradicional con SMDs reales del meta-meta-análisis.
- Cards de las 3 herramientas + final CTA + footer con disclaimer médico.
- **SEO/PWA**: Open Graph + Twitter Card + JSON-LD `WebApplication` con `name: "Sincro"` apuntando a `play.movimientofuncional.app`. Favicon SVG inline, skip-link, `prefers-reduced-motion`, ARIA labels, contraste WCAG AA.
- Branding: `⚡ Sincro` con gradiente turquesa→dorado (Righteous + ABeeZee).
- 8 referencias DOI verificadas: Singh 2025 BJSM, Yoong 2024, Chen 2021, Lavigne 2025, Benzing 2019, Gong 2016, Särkämö 2013, Bentley 2022, Pasinski 2016, Zaatar 2023.

### `play.html` — dashboard

Dashboard puro con 8 cards en 3 secciones: **StepMania** (Bailar / Crear coreografías / Mis canciones), **Guitar Hero** (Tocar / Crear partituras / Mis canciones GH), **Comunes** (Comprobar el equipo / Tutorial). Cada card es enlace directo al archivo correspondiente — NO usa SPA `goto()`.

Hasta 2026-05-11 era SPA monolítico de 1021 líneas con 10 screens. La separación a archivos dedicados deja `play.html` en ~280 líneas (head + topbar + settings modal + menu-screen + bindings).

Carga solo `pwa-bootstrap.js` + `core.js` (para `pollGamepad()` del padPill y settings persistente). NO carga parser/game/song-select.

**Settings modal**: globalOffset, speedMode + (scrollSpeed | cmodBPM | mmodBPM), timingWindow, NoteSkin PNG, fondo. Persiste a `localStorage` vía `saveSettings()`. El render real ocurre en `stepmania-play.html` que lee los mismos keys.

**Sistema de speed mods (3 modos, 2026-05-12):** réplica de `m_fScrollSpeed` / `m_fScrollBPM` / `m_fMaxScrollBPM` de SM5 oficial (`stepmania-5_1-new/src/PlayerOptions.cpp:53-70, 625-660`):

- **xMod** (`scrollSpeed`, 0.5–3.0): multiplicador clásico relativo al base 600 px/s. Default, sin breaking change.
- **CMod** (`cmodBPM`, 100–700, default 300): velocidad CONSTANTE en BPM equivalente. Independiente del BPM real.
- **MMod** (`mmodBPM`, 100–700, default 450): xMod con techo. `min(scrollSpeed × 600, mmodBPM × 3)`.

**Equivalencia:** xMod 1.0 ≡ CMod 200, alineado con `CMOD_DEFAULT = 200.0f` del repo oficial. Constante derivada: `SCROLL_PPS_PER_BPM = 600/200 = 3` (`core.js`). El cálculo vive en `computePixelsPerSec(songBPM, chartSpeedMul)` exportado a window — lo consumen `game.js:419` y `song-select.js`. UI de los 3 sliders contextuales vía `refreshSpeedModeUi()`. Bindings replicados en `play.html` y `app.js`.

Nuestro **xMod NO escala con songBPM** (a diferencia de SM oficial). Decisión heredada — nuestro motor siempre fue "tiempo absoluto" en su núcleo. CMod no requirió cambios estructurales en `game.js`: solo redefine la fórmula de `pixelsPerSec`.

### `stepmania-play.html` — motor DDR

SPA con pantallas: Jugar (songs-screen + previews), Dificultad (ajustes per-song), Play (canvas), Resultados, Mis canciones (library). Carga módulos desde `stepmania-web/js/`: `core` → `parser` → `difficulty-tiers` → `library` → `backup` → `song-select` → `game` → `app`. Estilos en `stepmania-web/css/styles.css`.

Hash routing: `stepmania-play.html#library` aterriza directo en la biblioteca (lo usa el dashboard). Sin hash, abre en `songs`. El patrón vive en `app.js` — `applyHash()` equivalente al de `gh-play.html`.

**Funcionalidad end-to-end**:

- Parser `.ssc/.sm` con BPMs/STOPS/DELAYS/WARPS, OFFSET, NOTES.
- Motor de timing real (J4–J7) con quantización a 192nds, mines, holds/rolls (HOLD_LIFE 300ms), lifts, fakes, hands.
- 6 modifiers: mirror, left, right, shuffle, hidden, sudden + chartSpeed local (0.5–4x) y scrollSpeed global (0.5–3x).
- Librería en IndexedDB con import individual (.ssc/.sm + audio), import packs SM, backup ZIP completo, restore. Los handlers en `library.js:90-220` distinguen `QuotaExceededError`: cuando IndexedDB se queda sin cuota (Safari iOS ~50MB hard cap), PARA el bucle de import, consulta `navigator.storage.estimate()` y muestra mensaje accionable con `usedMB` real.

**Política unificada de carriles**: charts del autostepper son `dance-double` (8 carriles, master único). El motor decide en runtime cómo jugarlos vía `getActiveLaneConfig` en `game.js`: **default = 4 carriles**, mod Solo = 6, mod Full = 8. El bloque de redistribución (`game.js:279-303`) hace el remap simétrico (8→4, 8→6, o el caso legacy 4→6/4→8 sobre charts antiguos). Charts antiguos con `dance-single` o `dance-solo` siguen funcionando — su `nativeLanes` original se respeta como punto de partida. Mods Solo y Full mutuamente excluyentes (`song-select.js:237-238`).

**Adaptación automática de diagonales al hardware (2026-05-12)**: el modo Solo tiene DOS variantes en `LANE_CONFIGS`: `[6]` con diagonales superiores ↖↗ (cabinet DDR canónica) y `['6-down']` con diagonales inferiores ↙↘ (rotaciones -135°/135°). `getActiveLaneConfig` consulta `window.MatLayout.detectMatDiagonalLayout()` (módulo `stepmania-web/js/mat-layout.js`) cuando Solo está activo y devuelve la variante apropiada según `localStorage['mat-mapping']`. Si la usuaria tiene `downLeft+downRight` asignados pero no `upLeft+upRight`, layout es `'down'`. Caso real: alfombras baratas Amazon 10-25€ con cardinales + 2 diagonales inferiores; antes la usuaria tenía que poner la alfombra del revés (rompiendo cardinales) para jugar Solo. La capa `applyMatCalibrationToConfig` invoca `getMatRolesForConfig(cfg)` que devuelve roles distintos por variante (col 1 = `downLeft` en `'6-down'` vs `upLeft` en `[6]`). **Cuando hay las 4 diagonales** el layout es `'up'` (convención DDR/ITG/Etterna prevalece). Sin setting de UI — automático y silencioso.

**Input**: alfombra USB (con calibración por roles vía `mat-mapping` en localStorage) y teclado físico (← ↓ ↑ →) como fallback de desarrollo. **NO hay overlay táctil**: Sincro requiere alfombra o guitarra. El overlay existió hasta 2026-05-15 y se eliminó porque la heurística rota (`'ontouchstart' in window || maxTouchPoints > 0`) lo sacaba en monitores Windows con pantalla táctil aunque la usuaria estuviera jugando con alfombra. Decisión consciente: el producto **no soporta móvil/táctil** y la landing ya guarda esa frontera.

**Settings persistentes (localStorage)**: globalOffset, scrollSpeed, timingWindow, NoteSkin PNG personalizado, fondo procedural por título. Compartidos con el dashboard (`play.html`).

**Robustez de ciclo de vida (`game.js:269-417`)**: `startGame()` captura `currentNavToken()` al inicio y verifica `isCurrentNav(myToken)` después de cada `await` (resume audio, arrayBuffer, decodeAudioData, runCountdown). Si el usuario navega fuera durante esos ~3s, la promesa se aborta limpiamente sin crear `gameState` huérfano. Toda la cadena async va en `try/catch` que muestra `alert()` específico para `EncodingError` (OGG en iOS Safari) y devuelve a la pantalla `diff`. `stopGame()` anula `src.onended = null` antes de `src.stop()` para evitar que el `setTimeout(endGame)` huérfano se dispare 500ms después con `gameState` ya nulo.

**Menú de pausa canónico SM5/ITG arcade (2026-05-14)**: `ESC` durante la partida abre `#pauseOverlay` con tres opciones — **▶ Reanudar** (default, también con `ESC` o `ENTER`), **↻ Reiniciar canción**, **✕ Salir al menú**. Antes ESC destruía la partida; ahora la jugadora puede beber agua, abrir la puerta o pedir un reinicio sin perder el progreso.

Implementación: variables `isPaused` + `pausedAtCtxTime` + `LEAD_IN_SEC` a nivel de módulo en `game.js`. `togglePause()` para el audio, anula `src.onended` (mismo cuidado que `stopGame`) y memoriza `audioCtx.currentTime`; al reanudar shiftea `gameState.startTime += pauseDuration` para que `audioTime = audioCtx.currentTime - startTime` quede congelado durante la pausa. Recrea un `AudioBufferSourceNode` nuevo (los buffer sources son one-shot) con un `onended` que verifica `gameState.src === newSrc` para no disparar `endGame` si la usuaria pausa de nuevo antes de que termine el audio.

El offset del start distingue dos casos:
- (a) `audioElapsed >= 0` → `newSrc.start(0, audioElapsed)` (la canción ya estaba sonando, seekear al offset).
- (b) `audioElapsed < 0` → `newSrc.start(audioCtx.currentTime + (-audioElapsed))` (pausa durante el lead-in de 5s — programar el arranque en el futuro).

Guards `if (isPaused) return` en `onKeyDown`, `onKeyUp`, `handleLanePress`, `handleLaneRelease`; en `gameLoop` el guard es `if (isPaused) { requestAnimationFrame(gameLoop); return; }` (sigue pidiendo frames para reanudar limpio, no renderiza). `restartSong()` = `stopGame()` + `startGame()` directo (NO `goto('play')` — eso bumpea `navToken` y abortaría el `startGame` que acabamos de lanzar). `quitToMenu()` = `stopGame()` + `goto('diff')`. Las tres funciones expuestas a `window.*` para que el HTML las invoque vía `onclick`. El focus en el botón Reanudar se fuerza desde JS (HTML `autofocus` no funciona en elementos revelados vía toggle de clase). Tanto `startGame()` como `stopGame()` resetean `isPaused = false` y ocultan el overlay como defensa.

**Cuenta atrás solapada con audio (2026-05-15)**: antes el flujo era `runCountdown` (5s silenciosos con "¡PREPÁRATE! / 3 / 2 / 1 / ¡VAMOS!") → `src.start()` → `LEAD_IN_SEC=3s` de música sin notas → primera flecha en t=8s. Eran 8s perceptuales hasta jugar y la jugadora reportó que "queda raro como cuenta atrás". Ahora: `src.start()` se llama ANTES del `await runCountdown`, así la música suena durante todo el countdown. `LEAD_IN_SEC` se sube a 5.0 (= duración del countdown), así la primera nota llega al receptor justo cuando el countdown se oculta. `COUNTDOWN_STEPS_SM` pasa a 5 pasos numéricos `5 → 4 → 3 → 2 → 1` (sin palabras), con beep en frecuencia ascendente 660→740→820→900→1320 Hz y duración doble en el último.

Se elimina el `setTimeout(COUNTDOWN_STEP_MS)` extra al final que extendía la visibilidad del "¡VAMOS!" (ahora el "1" se ve 1s y se oculta sin delay, total `STEPS.length × STEP_MS = 5s` exactos). Si `isAborted()` dispara durante el countdown, el `src.stop()` se llama explícitamente sobre el source ya arrancado para no dejar audio huérfano sonando 5s en background.

CSS nuevo: `#countdown.cd-5` (índigo #818cf8) y `.cd-4` (cyan #38bdf8) extienden el degradado frío→cálido. Las clases huérfanas `cd-prep` y `cd-go` se conservan en el CSS por inercia. El cambio simétrico vive en `gh-play.html`: `NOTE_DELAY_SEC` 3 → 5, `audioRealStartAt = ctx.currentTime` (sin `+ COUNTDOWN_SEC`), `GH_COUNTDOWN_STEPS` solo números, mismo cleanup del setTimeout final.

**Pausa preserva la regla**: la rama (b) de `togglePause()` (`audioElapsed < 0`) ahora cubre los primeros 5s en vez de 3s — la fórmula `newSrc.start(audioCtx.currentTime + (-audioElapsed))` sigue siendo correcta porque `audioElapsed` se calcula contra `gameState.startTime` que ya incluye el LEAD_IN_SEC nuevo.

**SPA navigation (`app.js`)**: `goto(name)` con SCREENS dinámicas (filtradas por `document.getElementById('X-screen')` presentes en el DOM). Si se pide una screen ausente, `SCREEN_EXTERNAL[name]` la mapea a un archivo dedicado y redirige con `window.location.href`. Esto permite que código legado de `song-select.js` con `goto('create')` siga funcionando: en `stepmania-play.html` (sin `create-screen`) salta automáticamente a `autostepper.html`. El mismo `app.js` funciona en cualquier archivo que cargue el motor — la nav es agnóstica al archivo.

**Modo sesión multijugador (`song-select.js:982-1018` + `game.js:1498-1523`)**: al marcar ≥1 canción y pulsar "🎮 Crear partida", se pide el nombre del jugador UNA vez vía `prompt()` (no se puede pedir per-canción: el countdown de 5s entre canciones no daría tiempo a escribirlo y el run se perdería al cargar la siguiente). El nombre se guarda en `playSession.playerName` y `endGame()` lo lee vía `getActiveSessionPlayer()` para auto-persistir cada run a IndexedDB sin formulario (`dbRunAdd(autoRun)`). En el banner de transición entre canciones aparece el chip "Próxima jugada: **X** [✎ cambiar]" — al pulsar Cambiar el chip se transforma en input editable + botón OK, el countdown se pausa, y al confirmar (Enter / OK) se actualiza `playSession.playerName` y reanuda countdown desde 5s. Cancelar (ESC / ×) restaura el chip sin cambios.

**Razón del diseño**: caso real de uso en casa (madre + peque alternando turnos en la misma partida); antes solo se guardaba la puntuación si la usuaria pulsaba Guardar en menos de 5s, así que las canciones intermedias se perdían. El resumen final muestra desglose por jugador (`playerCounts` Map): si todos los runs son de la misma persona aparece "💾 Guardado como X (n/m)"; si hay alternancia, "💾 Elena · 3 · Lucía · 2". Cada fila del resumen lleva tag `.player-tag` con el nombre. El nombre individual de cada run se persiste en el campo `playerName` del store `runs` igual que en single. Si `dbRunAdd` falla, se loggea + se muestra warning rojo en el `.score-saved-notice` pero la sesión continúa.

### `tutorial.html`

Página estática con tutorial completo (8 pestañas: Para empezar, Cómo jugar, Crear coreografías, Probar la alfombra, Calibración, Biblioteca, Ajustes, Otras herramientas). Carga solo `pwa-bootstrap.js` + `styles.css` — sin módulos del motor. El switcher de pestañas vive en un `<script>` inline de 10 líneas.

### `calibration.html`

Redirect HTML (2026-05-12) a `test-pad.html#alfombra-sync`. Hasta esa fecha era una página standalone con metrónomo + tap que **duplicaba** funcionalidad ya presente en el tab "Sync de audio" del `test-pad.html`. La consolidación elimina la duplicidad: un único punto de calibración bajo *Comprobar el equipo → Sync de audio*. La URL se conserva por compatibilidad con deep-links (manifest shortcuts, bookmarks). Implementado con `<meta http-equiv="refresh">` + `window.location.replace()` JS fallback. El JS original (`stepmania-web/js/calibration.js`) se eliminó en el mismo commit — su lógica de aplicar offset a `settings.globalOffset` vive ahora en `test-pad.html` como `applySyncOffsetToSettings(ms)` (mismo key `'stepmania-web-settings'` de `core.js`).

El test-pad acepta los hashes `#alfombra-sync` / `#mat-sync` / `#sync` (modo mat) y `#guitarra-sync` / `#guitar-sync` (modo guitar) — activan automáticamente el modo y el tab correspondiente vía `deepLinkSyncTab()` al final del script.

### `test-pad.html`

Diagnóstico de hardware en el navegador (Gamepad API). Selector inicial **Alfombra | Guitarra**.

**Modo Alfombra (9 pestañas)**:
- **Calibrar**: asistente paso a paso para mapear 10 roles físicos (4 cardinales + 4 diagonales + start/back). Persiste en `localStorage` con key `mat-mapping`. Filas clickables para reasignar un rol individualmente. Tests auto-skippean roles `null`.
- **Estadísticas**: pisadas por panel, duración media, polling rate.
- **Latencia**: test de reflejos por panel calibrado (panel aleatorio → mide ms hasta pisar). Solo prueba paneles asignados.
- **Saltos**: combos simultáneos por roles (Izq+Der, Arriba+Abajo, UP-LEFT+UP-RIGHT, DOWN-LEFT+DOWN-RIGHT, 4 cardinales). Auto-skip a los 5s si algún rol no está calibrado.
- **Sync de audio**: metrónomo BPM 60-180. Mide offset y sugiere `Global Offset`.
- **Stress test**: 10s de pisadas rápidas. Detecta bouncing si intervalo mínimo < 15ms.
- **Ghost inputs**: monitorea 60s sin pisar — si aparece input, hay sensor pegado.
- **Secuencia**: histórico últimas 50 pisadas con timestamp.
- **Ejes**: lectura cruda de los axes.

**Modo Guitarra (11 pestañas)**:
- **Calibrar**: 11 roles (5 trastes, strum ↑/↓, tilt, Star Power, Select, Start). Persiste en key `guitar-mapping`. Filas clickables para reasignar.
- **Estadísticas**: pulsos por traste/strum + duración + polling rate.
- **Trastes (latencia)**: 10 rondas por traste. Detecta trastes lentos. Solo prueba trastes asignados.
- **Strum**: 15s alternando ↑↓. Mide ratio up:down (~1.0) e intervalo mínimo.
- **Whammy**: 15s moviendo la palanca. **Auto-detecta el eje correcto** muestreando todos los ejes y eligiendo el de mayor rango — evita hardcoding de eje Z. Guarda eje detectado en `guitarMapping.whammyAxis`. **Reposo y palanca al fondo (2026-05-14)**: además de `whammyAxis`, persiste `whammyRest` (valor del eje en reposo) y `whammyActive` (valor al hundir la palanca al fondo). Asume que la usuaria pulsa Iniciar SIN tocar la palanca: el primer sample del eje pickeado se usa como reposo, y el extremo (min/max) más alejado se etiqueta como activo. Verdict muestra ambos valores ("Reposo X → fondo Y") para detectar dirección invertida. Los consume `normalizeWhammy` en `gh-play.html` para mapear [reposo, fondo] → [0, 1] sin depender de la asunción ingenua "reposo = -1".
- **Chords**: combinaciones simultáneas (G+R, R+Y, power chord G+R+Y+B, fret+strum). Detecta ghosting de matriz.
- **Sync, Stress, Ghost, Secuencia, Ejes**: compartidas con modo alfombra.

**Sistema de calibración común**:
- Toast verde "✓ btn[X] → rol" tras cada captura.
- Auto-skip de pasos no aplicables ("Saltar paso").
- Botón "Borrar mapping" vuelve a defaults solo del modo activo.
- Cambiar de modo cancela cualquier calibración en curso.

### `autostepper.html` — generador SM standalone

Generador automático de charts **StepMania (.ssc/.sm)** desde MP3/WAV. Equivalente al `phr00t/AutoStepper` (Java) pero en navegador.

**Política unificada 8-lane**: todos los charts se generan como `dance-double` (8 carriles: cardinales + 4 diagonales) — master único por canción. La elección de modo (4/6/8) es decisión de runtime en Sincro Play, no de autoría. En StepMania nativo, los charts aparecen bajo el modo *Doubles* (requiere dos alfombras o remapeo).

**Pipeline de detección compartida** — vive en `stepmania-web/js/audio-pipeline.js`, expuesta como `window.AudioPipeline.{decodeFile, toMono, bassEmphasize, computeEnergyEnvelope, computeODF, pickPeaks, detectBPM, detectOffset, ensureAudioContext, audioBufferToWav}`. La usan tanto `autostepper.html` (output `.ssc/.sm`) como `gh-autostepper.html` (output `.chart`). El `bassEmphasize` cubre bass + mid en una sola pasada con blend 0.4/0.6 — el band-pass del mid vive en estado escalar para no doblar la RAM (ver sección "Algoritmo" más abajo y el historial de decisiones).

**Cap de duración (Completa / 90s / 120s / 180s)** — selector en el paso "Estilo" de los **tres** autosteppers. Cuando se elige un cap menor que la duración:
- **SM**: filtra los onsets a `t < effectiveDuration`; recalcula `totalUnits`, `sampleStart`, `estimateMeter`, `calculateRadarValues` con `effectiveDuration`.
- **GH**: filtra los `peakFrames` a `f/framesPerSec < effectiveDuration` ANTES de la conversión a ticks, así `DifficultyTiers.filterTicks` ve un universo ya recortado y el NPS por ventana sigue siendo correcto. `meta.duration = effectiveDuration` se propaga a `song.ini` (`song_length`) y al `#MusicStream` del `.chart`.
- Todos llaman a `AudioPipeline.audioBufferToWav(buffer, effectiveDuration, 1.5)` para producir un WAV PCM 16-bit recortado con fade-out lineal de 1.5s (evita clicks de truncación).
- SM guarda blob en `q.result.croppedAudio` + nombre en `q.result.croppedAudioName`. GH guarda blob en `q.result.croppedAudio` + extensión final en `q.result.audioExt` — fuente única de verdad consumida por `processOne`, `downloadAllZip` y `saveOneToLibrary`.
- En GH el `Blob` que entra a IndexedDB lleva MIME `audio/wav` cuando viene del WAV cropeado (importante para Safari).
- Si se elige "Completa", el archivo original se conserva sin re-codificar.

**Algoritmo** (optimizado para música bailable: techno, dance, pop, rock, latina):
1. `decodeAudioData` → mono Float32Array.
2. **`bassEmphasize`** — Pre-filtro combinado bass + mid en una única pasada sobre el buffer. El bass (<200 Hz, kick + bajo) usa la cascada IIR 2-polo de toda la vida escrita en `out` con peso `BLEND_BASS=0.4`. El mid (200–2500 Hz, snare, voz, guitarra rítmica, percusión latina) se construye inline como diferencia de dos cascadas IIR 2-polo (LP @ 2500 Hz - LP @ 200 Hz) cuyas variables `y` viven en 4 escalares — sin materializar buffer paralelo. La contribución se suma al `out` con peso `BLEND_MID=0.6`. RAM pico = `samples + out` (idéntico al bass-only original); CPU ~3x bass-only pero lineal O(N), irrelevante frente a decodeAudioData y pickPeaks. La ODF resultante alimenta `pickPeaks`, `detectBPMSegments` y `detectOffset` (todos comparten la misma fase, sin drift). BPM detection sigue estable en 90-180 BPM porque el kick continúa siendo el componente más energético del envelope.
3. **`computeEnergyEnvelope`** — RMS con ventanas de 23 ms y hop de 5 ms.
4. **`computeODF`** — log-derivada rectificada y renormalizada a [0,1].
5. **`normalizeODFLocally`** — segundo pase con umbral adaptativo en ventana local (~3s). Captura onsets en tramos quiet (intro, break).
6. Pico-detección sobre la ODF local (75 ms window).
7. BPM via autocorrelación, **rango 90–180 BPM**, corrección de octava. `detectBPMSegments` segmenta tempo variable (default: 1 segmento).
8. Offset via correlación de fase.
9. **Tap sync manual**: botón "Tap" por canción abre modal; usuario pulsa SPACE/botón al ritmo, mediana de intervalos → BPM. Sobrescribe vía `q.bpmOverride`.

**Generación de charts (rejilla interna 192nds para compat SM5)**:
- Quantización a 192nds (1 measure = 192 unidades, 1 beat = 48).
- Filtro por resolución elegida (negras=48, corcheas=24, semicorcheas=12).
- Asignación de flechas vía `stepmania-web/js/sm-flow.js` (motor de flow biomecánico) + anti-repeat de las últimas 2 flechas dentro del subconjunto del pie objetivo.
- Holds/rolls cuando hay gap ≥ 1/2 beat al siguiente paso (probabilidad ajustable).
- Hands (3 paneles simultáneos) solo en Challenge.
- Resolución variable por compás (cada compás escoge subdivision válida más pequeña: 4/8/12/16/24/32/48/64/96/192).

**Salida (en ZIP, una carpeta por canción)**:
- `<song>.ssc` (formato SM5 nativo, con `#NOTEDATA`, RADARVALUES de 12 valores, CHARTNAME, CHARTSTYLE=Pad, METER).
- `<song>.sm` (legacy, compatibilidad universal con ITG2/Etterna/3.9).
- `<song>.<ext>` (audio renombrado).

**Presets**:
- 🌿 Suave: sens 2.4, negras, 10% holds, 0% jumps.
- ⚡ Normal: sens 1.7, corcheas, 25% holds, 7% jumps (recomendado).
- 🔥 Intenso: sens 1.3, semicorcheas, 50% holds, 18% jumps.
- ⚙️ Personalizado: sliders independientes.

**5 dificultades generadas por canción**: Beginner, Easy, Medium, Hard, Challenge.

**Filtrado por dificultad** — delegado en `stepmania-web/js/difficulty-tiers.js`. La densidad NO se controla por stride relativo sino por:
- **NPS objetivo absoluto** (notas/segundo) — calibrado a estándares oficiales.
- **`minGapSec` absoluto** — desacopla la dificultad del BPM, así Beginner se siente igual de "espaciado" a 90 que a 180 BPM.
- **Prioridad rítmica** — cada onset recibe priority por dónde cae en el compás 4/4 (5=downbeat, 4=mid-measure, 3=beat, 2=corchea offbeat, 1=semicorchea, 0=otro). Cada dificultad rechaza onsets con priority < umbral. Cuando un onset queda demasiado cerca del último aceptado pero tiene MAYOR priority rítmica, sustituye al anterior.
- **Cap por ventana deslizante de 3s** — si en algún tramo se supera el NPS objetivo, se descartan los onsets de menor priority rítmica.

**Tabla calibrada** (tier → minGap / NPS max / minRhythmPriority):

| Tier         | minGap | NPS max | minPriority |
|--------------|--------|---------|-------------|
| SM Beginner  | 1.00s  | 1.0     | 4 (solo downbeats y mitades de compás) |
| SM Easy      | 0.50s  | 2.0     | 3 (hasta beat completo) |
| SM Medium    | 0.45s  | 2.2     | 3 (Easy con un pelín más de densidad) |
| SM Hard      | 0.28s  | 3.5     | 2 (entra a corcheas offbeat) |
| SM Challenge | 0.12s  | 7.0     | 0 (todo) |
| GH Easy      | 0.70s  | 1.4     | 4 |
| GH Medium    | 0.55s  | 1.9     | 3 |
| GH Hard      | 0.30s  | 3.5     | 2 |
| GH Expert    | 0.17s  | 6.0     | 0 |

Los presets (suave/normal/intenso) se traducen a multiplicadores globales (×0.7/×1.0/×1.3) que escalan minGap y NPS target uniformemente.

API expuesta: `window.DifficultyTiers.{filterByDifficulty(onsetsSec, bpm, offsetSec, gameType, difficultyKey, presetMul), filterPositions48(...), filterTicks(...)}`. El autostepper SM usa `filterPositions48`; el GH usa `filterTicks` con `CHART_RESOLUTION=192`.

Implementa encoder ZIP propio (modo "store", sin compresión) — sin dependencias externas.

**Lectura de metadatos de audio**: ambos autosteppers cargan `stepmania-web/js/audio-metadata.js` y lo invocan en `addFiles()` para poblar `title` y `artist` desde tags ID3v2/v1 (MP3) o Vorbis Comments (FLAC). Hasta el 2026-05-12 ambos hacían un split trivial del filename por `" - "`, lo que producía resultados absurdos con nombres como `12 Toxicity.mp3` o `11 Rockstar - 2020 Remaster.mp3`. **Solo se persisten title y artist** — los autosteppers ignoran album/track/year porque la UI de biblioteca y los filtros de búsqueda (`library.js:84-89`, `song-select.js:77-88`, `gh-play.html:1248-1253`) solo operan sobre esos dos campos.

### `gh-play.html` — simulador Guitar Hero

Carga charts `.chart` (formato Feedback / Clone Hero) bien sea como ZIP del autostepper o como `notes.chart` + audio sueltos. Lee el `guitarMapping` calibrado desde `localStorage` (key `guitar-mapping`, generado por `test-pad.html`) — cero re-calibración. También soporta teclado fallback (1-5 frets, Espacio strum).

**Motor de hit detection (regla Clone Hero estándar)**:
- **Single notes**: anchor — el target debe estar pulsado, ningún fret más alto puede estarlo, frets más bajos pueden estar pulsados o no. Ejemplo: nota Yellow puede hitearse con (Green+Yellow), no con (Yellow+Blue).
- **Chord notes**: match estricto.
- **Strum-required (default)**: hit dispara solo en flanco DOWN o UP del strum bar Y match de frets. Strum sin frets correctos = combo break (overstrum).
- **HOPOs (auto-detectados en runtime)**: si la nota tiene gap < hopoThreshold (default canónico CH **65 ticks** = `floor((65/192)·resolution)` ≈ 1/3 de un beat ≈ tresillo de corcheas) Y es single Y distinto fret al anterior Y combo > 0, basta con cambiar a los frets correctos sin strum.
- **Taps (fret 6 en .chart)**: se hitean sin strum desde combo 0; típicos de Expert+ marcados explícitamente.

**Timing windows**: Perfect 45ms · Good 90ms · Bad 135ms. Multiplicador clásico: x1 / x2 (10 combo) / x3 (20) / x4 (30).

**Sustains**: si la nota tiene `sustain > 0`, mientras los frets se mantengan pulsados se acumulan puntos (`SUSTAIN_POINTS_PER_SEC` × multiplicador). Soltar los frets antes del final = sustainBroken (no más puntos pero el combo sobrevive). Frets distintos durante el sustain también lo rompen.

**Detección de strum compartida con `test-pad.html`**: para guitarras donde el strum vive en eje (axes[1] en GH PS2 vía receptor Sony-emulado) usa el mismo algoritmo de transición desde neutro (`AXIS_STRUM_FIRE = 0.85`, `AXIS_NEUTRAL_ZONE = 0.30`). Evita falsos positivos del whammy que comparte el mismo eje.

**Render**: canvas 2D con highway de 5 carriles. Notas caen desde arriba; receptors en hit zone (85% canvas height). HOPOs con borde blanco; Taps con relleno blanco; sustains con cola colorida. Frets pulsados encienden el receptor con glow del color correspondiente.

**Audio**: reproducción vía `AudioBufferSourceNode` del `AudioPipeline.ensureAudioContext()` compartido. Countdown de 2s antes del primer beat. Pause con ESC re-crea el source en la posición exacta.

**Menú de pausa canónico SM5/ITG arcade (2026-05-15)**: réplica del menú del motor DDR — ESC durante la partida abre `#pauseOverlay` con tres opciones: **▶ Reanudar** (default, focus forzado al pausar para que ENTER lo dispare), **↻ Reiniciar canción** (`restartSong()` hace teardown del audio/rAF + relanza `startGame(game.diff)` sin tocar `playSession`), **✕ Salir al menú** (`quitGame()` ya existente). HTML con `role="dialog"`, `aria-modal`, `aria-labelledby="ghPauseTitle"`. CSS local con paleta GH (dorado en lugar del turquesa del SM) y backdrop-blur 8px. Antes el overlay tenía solo 2 botones (Continuar / Volver al menú) sin reinicio — la usuaria debía salir al setup y volver a entrar para reiniciar, lo cual rompía la sesión multijugador.

**Pause guard en `tick()`** (mismo patrón que `gameLoop` del SM): `if (isPaused) { rafId = requestAnimationFrame(tick); return; }` justo después de `if (!game) return;`. Sin este guard, `render(t)` se seguía ejecutando durante la pausa porque `t = ctx.currentTime - game.audioStartTime` seguía creciendo. El reset del reloj se hace al REANUDAR vía `game.audioStartTime += pauseDuration`.

**Ajustes en setup**:
- Dificultad: dropdown auto-poblado.
- Velocidad de scroll (200-900 px/s).
- Offset global ms (positivo = retrasar notas, negativo = adelantarlas).
- HOPO threshold ticks (default canónico CH = 65).

**Resultados**: grade S/A/B/C/D/F basado en accuracy. Muestra score, accuracy, hits, misses, max combo.

**Modo sesión multijugador** (paralelo al de SM): `startPlaylistSession` (`gh-play.html:1901-1935`) pide el nombre con `prompt()` antes de arrancar. `finishGame` lee `playSession.playerName` y, si hay sesión, auto-persiste el run. El banner de transición muestra chip "Próxima jugada: **X** [✎ cambiar]". Resumen final calcula `playerCounts` igual que SM. Helpers `startSessionCountdown` / `pauseSessionCountdown` / `openSessionPlayerEdit` / `restoreSessionPlayerChip` espejan los de SM (no se comparten porque viven en archivos distintos: `gh-play.html` es self-contained y `song-select.js` es módulo SM).

**Implementado (v50)**:
- **Star Power**: `parseChart()` parsea frases `S 2 startTick durationTicks` por cada sección. `arr.spPhrases = [{startTick, endTick, noteCount}]` se precomputa. En `startGame`, `runtimeNotes` incluye `tick` para lookup. `judgeHit` acumula `game.starPower += 0.5/p.noteCount` (max 2 = 4 activaciones). `inputState.tiltEdge` + `game.starPowerActive` gestionado en `tick()`. SP drena a ritmo `bpm/60/32` unidades/s (agota en 32 beats). `getMultiplier()` dobla el multiplicador base durante SP (cap 8). Render: glow dorado pulsante; barra `#hudSP` en HUD.
- **Whammy → detune (revisado 2026-05-14)**: en `tick()`, cuando hay sustain activo se programa `game.audioSource.detune.setTargetAtTime(target, ctx.currentTime, 0.05)` hacia `-inputState.whammy * 200` cents (rango 0..-200 = 0..-2 semitonos). Sin sustain, vuelve a 0. **IMPRESCINDIBLE usar `setTargetAtTime` y NO `detune.value = ...` directo**: la asignación por frame del `.value` genera microclics/aliasing audibles ("rasgado") porque el resampler interno del AudioBufferSourceNode reacciona a cada salto. `togglePause()` aplica `setValueAtTime` (sin rampa) al nuevo source recreado. **Normalización del whammy** (`normalizeWhammy(raw, rest, active)`): usa `guitarMapping.whammyRest` y `guitarMapping.whammyActive` calibrados para mapear el valor crudo a [0,1] sin asumir reposo en -1 (la fórmula ingenua `(axes+1)/2` fallaba en guitarras GH PS2 vía receptor Sony porque reposan cerca de 0 e ir a -1 al hundir — generaba detune permanente de medio tono). Deadzone de 5% al inicio absorbe el jitter analógico. Mapping legacy sin esos campos cae al normalizador antiguo.
- **Open notes** (fret 7): strum sin fret pulsado; barra negra horizontal en render; `fretsMatchNote` maneja fret 7.

**Pendiente / mejoras futuras**:
- Variable BPM en el player (el parser ya soporta múltiples `B` en SyncTrack pero `tickToTime` solo usa el primero).
- Timing windows más amplias durante Star Power activo.
- Notas de bombo / drums tracks.
- Whammy pitch shift en sustains de open notes.

### `gh-autostepper.html` — generador GH standalone

Generador automático de charts **Guitar Hero (.chart Clone Hero / Feedback)** desde MP3/WAV. Reusa `audio-pipeline.js` (mismo análisis: bass-emphasis, ODF, BPM, offset). Output diverge: produce `notes.chart` + `song.ini` + audio en ZIP, listo para extraer en `Clone Hero/Songs/`.

**Note generation (5 trastes, 4 dificultades)**:
- **Roles**: 0=Verde, 1=Rojo, 2=Amarillo, 3=Azul, 4=Naranja (índices del `.chart`).
- **Walk de trastes**: caminata aleatoria con bias 65% adyacente, 25% jump de 2, 10% random. Prohíbe repetir traste consecutivo. La primera nota va a Verde/Rojo.
- **Filtrado por dificultad**: delegado a `DifficultyTiers.filterTicks`. Easy: rango G-Y, gap ≥ 0.70s, ≤1.4 NPS. Medium: G-Az, gap ≥ 0.55s, ≤1.9 NPS. Hard: G-N, gap ≥ 0.30s, ≤3.5 NPS. Expert: G-N, gap ≥ 0.17s, ≤6.0 NPS. Calibrado a estándares `diff_guitar` de la comunidad Clone Hero y a la progresión geométrica ~1.33x entre tiers que YARG asume oficialmente.
- **Chords (Medium+)**: pares de trastes adyacentes (siempre dobles, nunca triples) con probabilidad `chordProb` modulada por `diff.chordMul` — Medium = 0.5, Hard/Expert = 1.0, Easy = 0. Slider 0-60%, default 18% (que en Medium se traduce en ~9%). Easy nunca lleva chords.
- **Sustains**: si hay gap ≥ 1/2 beat al siguiente onset, con prob. `sustainProb` se convierte en sustain del 80% del gap.
- **HOPOs**: NO se marcan explícitamente. Clone Hero auto-detecta HOPOs por proximidad usando la regla canónica de `scan-chart` (gap < 65 ticks a res 192, single, fret distinto al previo, no chord, no override por flag).

**Formato `.chart`**: `Resolution = 192` ticks/quarter. Notas: `<tick> = N <fret> <sustain>`. Chord = múltiples líneas en mismo tick. BPM en SyncTrack como `0 = B <bpm*1000>` (milibeats). Solo 1 BPM constante en MVP.

**Output ZIP por canción**:
- `<slug>/notes.chart` — todas las dificultades.
- `<slug>/song.ini` — metadata.
- `<slug>/song.<ext>` — audio.

**Presets**:
- 🌿 Suave: sens 2.4, 1/4 max, 5% chords, 30% sustains.
- ⚡ Normal: sens 1.7, 1/8 max, 18% chords, 20% sustains.
- 🔥 Intenso: sens 1.3, 1/16 max, 40% chords, 10% sustains.

**Metadatos**: `addFiles()` invoca `AudioMetadata.extractMetadata(file)` en paralelo para todos los archivos soltados (`Promise.all` con `++queueIdCounter` ANTES del `await` para mantener IDs correlativos). Solo se persisten `title` y `artist` al store `gh-songs` — el `song.ini` y el `.chart` siguen con `album =` vacío.

**Pendiente**:
- Pitch-aware fret assignment (FFT + mapping low→Verde, high→Naranja).
- Tap notes (fret 6) explícitos para Expert.
- Open notes (fret 7) ocasionales.
- Variable BPM.

### Scripts Python (`test_pad*.py`, `detectar-guitarra.py`)

Tests vía WinMM `joyGetPosEx` (DirectInput equivalent). Útiles si la Gamepad API del navegador no detecta el dispositivo. Solo `ctypes`, sin pygame.

- `test_pad.py`: detección + 20s de input por consola.
- `test_pad_raw.py`: 20s mostrando estado crudo (botones, ejes X/Y/Z, POV).
- `test_pad_all.py`: secuencia 30s para verificar los 6 paneles principales.
- `detectar-guitarra.py`: enumera 16 slots de joystick de Windows con VID/PID/nombre/nº botones, identifica heurísticamente cuál es guitarra (8-13 botones + eje Z) y monitoriza 30s.

Mapping físico alfombra via WinMM (distinto al del navegador):
- B1=ARRIBA, B2=ABAJO, B3=IZQUIERDA, B4=DERECHA, B7=UP-LEFT, B8=UP-RIGHT, B9=START, B10=BACK.

---

## Detalles por módulo JS

### `stepmania-web/js/core.js`

Módulo base compartido por **todos los archivos del motor**. Carga primero. Expone en scope global:

- **Helpers triviales**: `escapeHtml`, `formatTime`, `safeFn`, `getExt`, `yieldUI`.
- **`ensureAudioCtx()`**: crea/devuelve un `AudioContext` singleton. Síncrono, NO hace `resume()`. Para callers que solo necesitan `decodeAudioData`.
- **`ensureAudioCtxRunning()` async**: variante que SÍ hace `resume()`. Centralizar el resume aquí evita el pitfall de iOS Safari + Chrome Android (autoplay policy crea el contexto en `'suspended'` hasta el primer gesto).
- **`pollGamepad()` (loop rAF eterno)**: polling de `navigator.getGamepads()` a 60 fps. Actualiza `gamepadButtonState[20]` y `gamepadJustPressed[20]`. Mejoras críticas (`core.js:25-90`):
  - **Pausa automática en `visibilitychange === 'hidden'`** — no quemar batería en background.
  - **Cachéo lazy de `#padPill`** con sentinel `false`. Si la página no tiene `#padPill`, el polling sigue funcionando.
  - **`try/catch` envolviendo todo el cuerpo** — una excepción transitoria NO mata el loop.
  - **Filtro `pickMatGamepad()` en 3 capas** (`core.js:59-78`) — ver sección "Hardware: mapeos físicos".
- **Wrappers IndexedDB** (`openDB`, `dbAdd`, `dbAll`, `dbGet`, `dbDelete`, `dbPut`, `dbRun*`): ver sección "IndexedDB schema y helpers".
- **`settings` + `saveSettings` + `openSettings`**: config persistente en localStorage.
- **`bumpNavToken`, `isCurrentNav`, `currentNavToken`**: token de navegación incremental para cancelación de promesas en vuelo. Cada `goto()` en `app.js` bumpea; las funciones async largas capturan el token al inicio y verifican que sigue siendo el actual después de cada `await`. Patrón equivalente a `AbortController` sin la ceremonia de pasar señales. Sin esto, `goto('diff')` durante un `decodeAudioData` de 3s dejaba el motor creando `gameState` sobre la pantalla equivocada.

### `stepmania-web/js/audio-metadata.js`

Parser binario de tags de audio (sin dependencias). Lo cargan los dos autosteppers.

**Cobertura por formato**:
- **MP3**: ID3v2.3 y v2.4 (frames TIT2/TPE1/TALB/TRCK/TYER/TDRC en encodings ISO-8859-1, UTF-16 con BOM, UTF-16BE y UTF-8). v2.2 (frame IDs de 3 chars) no soportado. Fallback a ID3v1 (últimos 128 bytes, latin1 estricto).
- **FLAC**: Vorbis Comments en el bloque `VORBIS_COMMENT` (type 4). Keys: TITLE, ARTIST, ALBUM, TRACKNUMBER, DATE/YEAR. Case-insensitive.
- **WAV/OGG/M4A**: fallback a filename. M4A queda como TODO.

**Estrategia de lectura**: `extractMetadata(file)` lee solo los **primeros ~1MB** del File vía `file.slice(0, 1<<20).arrayBuffer()` — cubre ID3v2 con artwork embebido y FLAC headers, ahorrando memoria. Para ID3v1 lee adicionalmente los últimos 128 bytes. Si todo falla, cae a `parseFromFilename(name)` que strippea prefijos de track# (`02 `, `12. `, `03 - `, `03_`) antes de aplicar la heurística "Artist - Album - Title".

Devuelve `{ title, artist, album, track, year, source }` aunque los autosteppers solo consumen `title` y `artist`.

**Detalles de implementación críticos** (cualquier toque debe respetarlos):

- **Synchsafe ints (28 bits)**: tamaños en ID3v2 se codifican con bit 7 de cada byte siempre a 0 para no chocar con sync MPEG. Decoder canónico en `synchsafe(b, off)`. **v2.3 usa uint32BE normal, v2.4 usa synchsafe** — un error clásico es usar el mismo decoder para ambos y leer tamaños 8× inflados.
- **Multi-valor v2.4 separado por NUL**: dentro de un mismo frame TPE1 puede haber `"Artist1\0Artist2\0Artist3"`. Nos quedamos con el primero vía `text.split(/\x00/)[0]`. Usamos la forma regex (no literal `'\0'`) para evitar que algunos editores guarden el byte NUL real en el .js source.
- **Strip de trailing NUL POST-decode, NO pre-decode** (regla crítica): los frames UTF-16 traen null terminator de 2 bytes (`00 00`) al final. Si haces strip byte-a-byte ANTES del decode, te comes el byte alto (`00`) del último char ASCII (ej: `'o'` es `6F 00` en LE), dejando un byte huérfano que `TextDecoder('utf-16le')` emite como U+FFFD `'�'`. Resultado real: `"DJ Miko"` → `"DJ Mik�"`. La solución es decodear toda la cadena (incluyendo bytes NUL internos como caracteres NUL legítimos) y limpiar el sufijo con `.replace(/\x00+$/, '')`. Esto se descubrió tras desplegar v24 y observar que TODOS los MP3s con tags UTF-16 (lo más común — Mp3tag, Picard, WMP escriben así por defecto) salían con `�` al final. Fixed en v25 con tests de regresión específicos.
- **Guard de null**: si tras parsear todos los frames no hay title NI artist NI album, devuelve `null`. Un tag con solo TRCK ("track 5") es basura para nuestra UI.
- **Doble export CJS** al final del módulo siguiendo el patrón de `parser.js:275-289` y `difficulty-tiers.js:259-274`.

API: `window.AudioMetadata.{extractMetadata(file), parseID3v2(buf), parseID3v1(buf), parseFLAC(buf), parseFromFilename(name)}`.

### `stepmania-web/js/sm-flow.js`

Motor de flow biomecánico que asigna flechas en el autostepper SM. Sustituye al `Math.random()` puro del generador antiguo por reglas que imitan cómo un charter humano coloca pies.

**Mapeo L/P/R en los 8 carriles** (dance-double, master único): `['L','P','P','R','L','R','L','R']`. Es decir ←=L · ↓=P · ↑=P · →=R · ↖=L · ↗=R · ↙=L · ↘=R. Los carriles `P` (pivots, ↓↑) son de "pie heredable" — `footOfLane(lane, lastFoot)` devuelve el pie contrario al último uso. Sin la regla, una secuencia ↓↓ obligaría a romper el patrón o a hacer cross-over; marcándolos como heredables, una corchea ↓↑↓↑ se baila L→R→L→R sin esfuerzo.

**Reglas principales**:
- **Alternancia con tolerancia** (`alternationProb = 0.85`). El 15% restante deja repetir el mismo pie, evitando que el chart se sienta robótico.
- **Anti-crossover**: cuando el pie deseado es L, candidatos = `LEFT_LANES ∪ pivots` (los pivots solo si su pie efectivo coincide con el deseado). Imposible cruzar.
- **Anti-repeat de las últimas 2** (preservado del motor antiguo, ahora dentro del subconjunto del pie objetivo). Si filtrar deja vacío, relaja primero a "no repetir lastLane".
- **Drills L-R automáticos** vía `computeRunInfo(positions, opts)`: detecta runs ≥4 onsets con gap uniforme ≤ `maxGapForDrill` (default 24 = 1/8 beat = corchea) y les asigna un par cardinal del array `DRILL_PAIRS` (peso 3 a ←→, peso 2 a ↓↑, peso 1 a las 4 diagonales cruzadas). Dentro de la run, los onsets alternan estrictamente los dos lanes del par.

**Por qué el threshold 24**: a 120 BPM equivale a ~250 ms entre onsets — el límite inferior cómodo para alternar pies sin pivotar tronco. Subir a 12 (semicorcheas, 125 ms a 120 BPM) generaría "rachas técnicas" en vez de caminatas bailables.

**Compatibilidad con el remap del motor**: el chart se genera siempre con 8 carriles asumiendo flow biomecánico completo. El motor (`game.js:279-303`) remapea simétricamente a 4 o 6 en runtime. Como `LANE_FOOT` respeta la simetría L/R, el flow sobrevive al remap sin recalcular.

API: `window.SMFlow.{LANE_FOOT, LEFT_LANES, RIGHT_LANES, PIVOT_LANES, DRILL_PAIRS, footOfLane(lane, lastFoot), computeRunInfo(positions, opts), pickArrowFlow(state, opts), pickJumpLane(primaryLane, primaryFoot, rng)}`. `state = { lastFoot, lastLane, beforeLastLane }`. `opts.rng` inyectable (default `Math.random`) — los tests usan Mulberry32 con seed fija.

### `stepmania-web/js/gh-db.js`

Módulo IndexedDB para la **biblioteca de charts Guitar Hero**. Comparte la misma DB `StepManiaWebDB` que la suite SM (DB_VERSION 3, upgrade-safe). Expone `window.GHLibrary` con: `open()`, `add(entry)`, `all()`, `get(id)`, `delete(id)`, `extractMeta(chartText)`.

Schema de un entry en `gh-songs`:
```
{ id, title, artist, bpm, duration, chartText, audioBlob, audioName, diffs:[], totalNotes, addedAt, genre, charter }
```

Lo cargan `gh-autostepper.html` (botón "Guardar en biblioteca") y `gh-play.html` (sección "Tu biblioteca" en setup). `core.js` sincronizado a DB_VERSION 3 con creación del store `gh-songs` en `onupgradeneeded`.

---

## Hardware: mapeos físicos

### Mapping físico alfombra via Gamepad API (defaults; calibrables)

Alineados con `padMap` de `game.js`:
- `button[0]` = IZQUIERDA · `button[1]` = ABAJO · `button[2]` = ARRIBA · `button[3]` = DERECHA
- `button[4]` = UP-LEFT · `button[5]` = UP-RIGHT · `button[6]` = DOWN-LEFT · `button[7]` = DOWN-RIGHT
- `button[8]` = START · `button[9]` = BACK

Cualquier pad con mapping distinto (ImpactDX, Cobalt Flux, mats genéricos chinos, X-Pad) recalibra los 10 roles desde la pestaña "Calibrar" del test-pad.

### Mapping físico guitarra GH PS2 via receptor Sony-emulado (VID 054C/PID 0268)

Defaults; calibrables. Mapping observado en una GH original:
- Trastes: btn[7]=Verde · btn[1]=Rojo · btn[0]=Amarillo · btn[2]=Azul · btn[3]=Naranja (orden no consecutivo).
- **Strum bar y palanca de whammy COMPARTEN el mismo eje `axes[1]`** (10 ejes en total). Rareza crítica:
  - Strum ↓ = `{axis:1, dir:+1}` → axes[1] salta a +1 instantáneo (microswitch digital).
  - Strum ↑ = `{axis:1, dir:-1}` → axes[1] salta a -1 instantáneo.
  - Whammy = `axes[1]` con valores intermedios `0.004 → -0.169 → -0.365 → -0.741 → -1` (potenciómetro analógico).
- Tilt y Star Power: btn[6] y btn[9] (varía por modelo).
- Select = btn[8]. Start: variable.

**Discriminación strum vs. whammy en `axes[1]` (algoritmo en `detectAxisStrum`)**:

Dispara strum SOLO cuando se cumplen las dos condiciones simultáneamente:
1. **Frame anterior** del eje estaba en zona neutra (`|lastV| < 0.3`).
2. **Frame actual** del eje pasa la zona extrema (`|v| > 0.85`).

El strum es un microswitch digital que salta de 0 → ±1 en un solo frame, así cumple ambas. La whammy es un potenciómetro que SIEMPRE pasa por valores intermedios antes de llegar al extremo, así nunca cumple la primera condición — no genera falsos positivos.

Constantes en `test-pad.html`:
- `AXIS_STRUM_FIRE = 0.85` (threshold del extremo).
- `AXIS_NEUTRAL_ZONE = 0.3`.
- `lastAxisValue[i]` se actualiza al final de cada llamada a `detectAxisStrum`.

**Notas para receptores diferentes**:
- En **receptores PS3 nativos / GH3 USB**, el strum bar puede estar en buttons (12/13 = D-pad como botones cuando `mapping="standard"`). `strumDown`/`strumUp` se guardan como `number` y `detectAxisStrum` los ignora. Soporta ambos formatos transparentemente vía `isAxisSpec()`.
- La calibración multi-step (`detectCalibAxisCapture` + `captureCalib`) discrimina automáticamente: si pulsa un botón, lo guarda como `number`; si mueve un eje > 0.6 desde baseline, lo guarda como `{axis, dir}`.

### Selección de gamepad en 3 capas — `findGamepad(modeOverride)` (`test-pad.html:1645-1693`)

La Gamepad API de Chrome asigna `gamepad.index` por orden de "primer despertar dentro de la pestaña" — el slot 0 puede ser la guitarra en una sesión y un dispositivo `USB Audio` (cascos HP, micrófonos con teclas) en otra. Cuando el slot 0 era un USB Audio, la usuaria no podía calibrar nada. Solución:

1. **Estricta** — `isViableGamepadForMode(gp, mode)`: para `guitar` exige `axes.length >= 2 && buttons.length >= 5` (GH PS2 tiene 10 y 13); para `mat` exige `buttons.length >= 4 && axes.length < 6` (rechaza guitarra para no confundirla con alfombra). Ambos modos pasan por blacklist `/USB Audio|Audio Device|Headset|Headphone|Microphone|Speaker|Webcam|Camera/i`.
2. **No-audio** — si la 1ª pasada no encuentra nada, devolver cualquier connected que no esté en la blacklist. Cubre "solo guitarra enchufada y usuaria en modo mat".
3. **Fallback** — último recurso, primer connected sin filtro. Preserva el comportamiento previo para hardware exótico.

El mismo patrón con la misma regex vive en:
- `gh-play.html` → `pickGuitarGamepad(pads)` (`gh-play.html:1869-1888`)
- `stepmania-web/js/core.js` → `pickMatGamepad()` (`core.js:59-78`)

**Si descubres un nuevo dispositivo que Chrome enumere como gamepad sin ser controlador real, añade el patrón a las TRES regex simultáneamente** o el bug volverá solo en ese flujo.

---

## Algoritmos

### Audio pipeline (`audio-pipeline.js`)

Ver descripción detallada en sección de `autostepper.html`. Resumen:

1. `decodeAudioData` → mono Float32Array.
2. `bassEmphasize` → pre-filtro combinado bass (<200 Hz) + mid (200–2500 Hz) en una pasada, blend 0.4/0.6, band-pass del mid en estado escalar (sin buffer paralelo).
3. `computeEnergyEnvelope` → RMS ventanas 23 ms, hop 5 ms.
4. `computeODF` → log-derivada rectificada [0,1].
5. `normalizeODFLocally` → umbral adaptativo ventana ~3s.
6. `pickPeaks` → ventana 75 ms.
7. `detectBPM` → autocorrelación, rango 90-180 BPM, corrección de octava.
8. `detectOffset` → correlación de fase.

### Filtrado por dificultad (`difficulty-tiers.js`)

Ver tabla en sección "autostepper.html". El algoritmo central:

```
para cada onset en orden temporal:
  si priority(onset) < tier.minPriority → descarta
  si (onset.t - lastAccepted.t) < tier.minGapSec:
    si priority(onset) > priority(lastAccepted):
      sustituye lastAccepted por onset
    sino:
      descarta
  sino:
    acepta onset
  si NPS en ventana de 3s > tier.maxNps:
    descarta los onsets de menor priority dentro de la ventana
```

`priority` se calcula por posición en el compás 4/4 (5=downbeat, 4=mid-measure, 3=beat, 2=corchea offbeat, 1=semicorchea, 0=otro).

Presets globales: ×0.7 (suave), ×1.0 (normal), ×1.3 (intenso). Multiplican `maxNps` y dividen `minGapSec`.

---

## IndexedDB schema y helpers

**DB**: `StepManiaWebDB` v4. Stores:
- `songs` — biblioteca SM.
- `runs` — partidas guardadas (autoincrement, índices `songId` / `chartId` / `playerLower`). Sustituye al antiguo `scores` (keyed por `songId:chartKey`, sin nombre de jugador).
- `gh-songs` — biblioteca GH.

Cada partida acabada inserta una fila en `runs`, lo que habilita ranking arcade con nombre + histórico de progresión. La migración v3→v4 borra `scores` limpiamente (decisión consciente: wipe en vez de mantener entries legacy sin nombre).

**Funciones**:
- `dbRunAdd(run)`, `dbRunsForChart(songId, chartKey)`, `dbRunsForSong(songId)`, `dbRunsAll()`, `dbRunDelete(id)`, `dbRunsClearForChart`, `dbRunsClearForSong`.

**Helpers puros testeables**:
- `chartIdOf(songId, chartKey)` — key compuesta del índice `chartId`.
- `sanitizePlayerName(s)` — trim + strip control chars + cap 12 chars + fallback `'Anónimo'`.
- `rankRuns(runs)` — sort score desc, ties por `playedAt` ascendente — gana la más antigua, convención arcade.
- `bestRunPerPlayer(runs)` — case-insensitive vía `playerLower`, devuelve un run por jugador con el del run ganador como representante.

`localStorage['sincro-last-player']` prefilla el input "tu nombre" entre sesiones (módulo helpers `getLastPlayerName` / `setLastPlayerName`).

---

## Constantes canónicas (extractos)

Toda decisión de timing/densidad/dificultad citada en `CLAUDE.md` está validada contra código fuente abierto. Si vas a tocarla, replica primero el archivo origen.

### StepMania 5.1 — DDR (`D:\SOFTWARE\stepmania-web\stepmania-5_1-new\`)

Repositorio local del motor oficial open-source:

- **Stream value** (`src/NoteDataUtil.cpp:1142`): `Stream = (total_taps / fSongSeconds) / 7.0f`. NPS/7. Stream=1.0 ↔ 7 NPS sostenido. Nuestros caps por tier están alineados — Beginner cap 1.0 NPS → Stream 0.14, Challenge cap 9.0 NPS → Stream 1.29.
- **Voltage window** (`src/NoteDataUtil.cpp:1023`): `voltage_window_beats = 8.0f`. Por eso nuestro cap de densidad usa ventana de 8 beats BPM-aware.
- **PredictMeter formula** (`src/Steps.cpp:235`):

```
pMeter = 0.775 + 10.1·Stream + 5.27·Voltage − 0.905·Air − 1.10·Freeze
       + 2.86·Chaos + DifficultyCoeff − 6.35·(Stream·Voltage) − 2.58·Chaos²
DifficultyCoeff = {-0.877, -0.877, 0, 0.722, 0.722, 0}  // Beg, Easy, Med, Hard, Ch, Edit
```

Validación de nuestros caps: Beginner ≈ meter 2, Easy ≈ 3-4, Medium ≈ 5-6, Hard ≈ 9, Challenge ≈ 13-14.

### Clone Hero — Guitar Hero

Clone Hero es propietario; el repo `clonehero-game/releases` es solo readme administrativo. Constantes canónicas extraídas de proyectos comunitarios CH:

**`scan-chart` de Geomitron** (https://github.com/Geomitron/scan-chart) — herramienta oficial.

- **HOPO threshold default `.chart`** (`src/chart/natural-hopo.ts`):

```ts
return Math.floor(format === 'mid' ? 1 + resolution / 3 : (65 / 192) * resolution)
```

Para `.chart` con resolución 192 → **65 ticks** (≈ 1/3 de un beat ≈ tresillo de corcheas). El input de `gh-play.html` usa este default. Si el `song.ini` define `hopo_frequency` o `eighthnote_hopo`, esos sobrescriben.

- **Reglas canónicas de natural HOPO** (`isNaturalHopo`):
  1. Sin nota previa → no HOPO.
  2. Gap > threshold → strum.
  3. Es chord → strum.
  4. Anterior single + current = mismo fret single → strum.
  5. Solo `.mid`: anterior chord, current ⊆ chord → strum.
  6. Resto → natural HOPO.

`gh-play.html:annotateHopos()` implementa todas las reglas relevantes para `.chart` (1, 2, 3, 4 — la 5 no aplica).

**YARG.Core** (https://github.com/YARC-Official/YARG.Core) — engine open-source compatible con charts CH. Valores del preset oficial guitar (`YARG.Core/Game/Presets/EnginePreset.Instruments.cs`, `FiveFretGuitarPreset`):

- `HopoLeniency = 0.08s` (80 ms).
- `StrumLeniency = 0.05s` (50 ms).
- `StrumLeniencySmall = 0.025s` (25 ms).
- `MaxWindow = MinWindow = 0.14s` (140 ms, ratio simétrico 1.0 → ±70 ms).
- `AntiGhosting = true`.

Nuestras timing windows (`Perfect 45ms · Good 90ms · Bad 135ms`) son más estrictas que YARG (CH no usa Perfect/Good/Bad; una sola hitbox). Nuestro 135 ms cae dentro del 140 ms de YARG. **Pendiente futuro**: considerar simplificar a hitbox único de ±70 ms para ser más fiel a CH/YARG.

### Sobre cadencias automáticas por dificultad

**Importante**: ni Clone Hero, ni YARG, ni Moonscraper auto-generan charts por dificultad — todas las dificultades en CH/YARG son creadas a mano por charters humanos. **No existe "cadencia oficial CH" para Easy/Medium/Hard/Expert** porque la decisión es 100% humana.

La calibración de `difficulty-tiers.js` para GH se basa en:
1. **Análisis estadístico** de charts oficiales de GH 1/2/3 (NPS típicos por tier reportados por la comunidad).
2. **Guías comunitarias `diff_guitar` 0-6** (charters).
3. **Validación cruzada** con StepMania 5 PredictMeter.

---

## Historial de decisiones y reverts

### Multi-banda 40/60 revertida (2026-05-15) y resurrected con estado escalar (2026-05-15 PM)

**Implementación original revertida**: el 2026-05-14 (commits `13905cb` GH, `e243d93` SM) se introdujo un pipeline multi-banda que sumaba `midEmphasize` (bandpass 200-2500 Hz) al `bassEmphasize` y blendeaba 40/60 a nivel de ODF para captar voz, caja, guitarra y percusión latina. Mejoraba la detección musical en rock/pop/latina pero el coste en RAM era prohibitivo: cada `midEmphasize` retenía 3 buffers Float32 del tamaño de mono (~42 MB cada uno a 4 min/44.1 kHz), y en GH además se computaban 5 band envelopes para frets pitch-aware. Pico real medido: **~300 MB por canción**.

Las mitigaciones (cierre de `AudioContext` entre canciones en v60, tope de 20 canciones en v63, ZIP lazy en v58) no fueron suficientes para tandas reales (14+ canciones del Megamix 90s) y el navegador colgaba. Se revirtió en commit `db03ef7` a bass-only para devolver el pico a ~120 MB por canción.

**Re-introducción con estado escalar (v74)**: el mismo día por la tarde se reintrodujo el blend bass+mid 40/60 pero **dentro de la misma función `bassEmphasize`** y en una **única pasada sobre el buffer**. El componente bass se calcula con la cascada IIR 2-polo de siempre y se escribe en `out` escalado por `BLEND_BASS=0.4`. El componente mid se construye inline como diferencia de dos cascadas IIR 2-polo (LP @ 2500 Hz - LP @ 200 Hz) cuyas variables de estado (`yH1, yH2, yL1, yL2`) son 4 escalares — **sin materializar el band-pass como buffer paralelo**. Resultado: pico de RAM idéntico al bass-only (~120 MB), CPU ~3x el bass-only pero lineal O(N), comportamiento musical equivalente al multi-banda revertido en rock/pop/latina/trance. Constantes en `audio-pipeline.js`: `BASS_FC=200`, `MID_LP_FC=2500`, `BLEND_BASS=0.4`, `BLEND_MID=0.6`. Tests sintéticos en `tests/audio-pipeline.test.mjs` verifican la respuesta en frecuencia (bass pasa, mid pasa, alto se atenúa).

**Pitch-aware fret y open notes en GH siguen revertidos** — el `computeBandEnvelopes` (5 bandas) sigue siendo demasiado caro y el beneficio sobre el walk determinista no compensaba.

### Recalibración difficulty-tiers (2026-05-12, dos pasadas)

**Pasada 1** (commit 52cb36f): los valores anteriores (SM Medium 0.30/3.5/2, Hard 0.18/5.5/1, Challenge 0.10/9.0/0; GH Medium 0.40/2.5/3, Hard 0.22/4.5/1, Expert 0.13/7.5/0) estaban por encima del techo de los rangos oficiales DDR (Medium oficial cap 3.15 NPS, Hard 4.9, GH Hard 4.0). Bajados a SM Medium 0.42/2.6/3, Hard 0.24/4.2/2, Challenge 0.10/7.5/0 (y GH análogo) para alinear con `diff_guitar` 0-6 y la progresión geométrica ~1.33x que YARG asume. Ratio Easy→Medium: 1.75x → 1.30x. Además, SM Medium subió `minRhythmPriority` de 2 a 3 (igual que Easy), eliminando el cambio cualitativo "Easy solo beats / Medium ya corcheas offbeat" — la entrada a corcheas offbeat ocurre ahora en Hard.

**Pasada 2** (commit posterior, solo SM): tras jugar partidas reales, Medium SM aún se sentía denso. Bajada adicional a SM Medium 0.45/2.2/3, Hard 0.28/3.5/2, Challenge 0.12/7.0/0. Ratio Easy→Medium queda en 1.10x — Medium se vive como "Easy con un pelín más de densidad". GH NO se tocó. La calibración previa sigue accesible vía preset "Intenso" (×1.30 caps, /1.30 minGap).

### Eliminación overlay táctil (2026-05-15)

El overlay táctil existió hasta 2026-05-15. Se eliminó porque la heurística rota (`'ontouchstart' in window || maxTouchPoints > 0`) lo sacaba en monitores Windows con pantalla táctil aunque la usuaria estuviera jugando con alfombra — falso positivo que rompía la pantalla. Decisión consciente: el producto **no soporta móvil/táctil** y la landing ya guarda esa frontera. Si en el futuro alguien plantea reintroducirlo, recordar que la frontera ya se decide en la landing (modal de requisitos), no en runtime.

### Fix UTF-16 NUL post-decode (v25, 2026-05-12)

Tras desplegar v24, todos los MP3s con tags UTF-16 (lo más común — Mp3tag, Picard, WMP) salían con `�` al final de title/artist/album. La causa: strip de bytes NUL ANTES del decode se comía el byte alto del último char ASCII en LE. Fix en v25: strip POST-decode con `.replace(/\x00+$/, '')`. Tests de regresión específicos en `tests/audio-metadata.test.mjs`.

### Migración v3→v4 IndexedDB (introducción de `runs`)

El store `scores` (keyed por `songId:chartKey`, sin nombre de jugador) fue sustituido por `runs` (autoincrement, índices `songId` / `chartId` / `playerLower`). La migración borra `scores` limpiamente — decisión consciente: wipe en vez de mantener entries legacy sin nombre. Habilita ranking arcade y histórico de progresión.

---

## Shell SPA y PWA detallado

### `app.html` — shell SPA

Topbar persistente con marca Sincro + nav de 7 rutas visibles (**Inicio** dashboard, **🦶 Bailar** motor DDR, **🎸 Tocar** motor GH, **🪄 Crear DDR**, **🎼 Crear GH**, **🛠️ Equipo**, **ℹ️ Sincro** landing). Dos rutas adicionales NO promocionadas en el topbar (entran solo desde las cards del dashboard): `/tutorial`, `/calibration`.

El router resuelve **9 rutas totales**: `/play` (dashboard) · `/stepmania-play` · `/gh-play` · `/autostepper` · `/gh-autostepper` · `/test-pad` · `/tutorial` · `/calibration` · `/about`. Un único `<iframe name="sincro-shell-frame">` carga la vista activa. El router escucha `hashchange` y solo cambia `iframe.src` cuando cambia la ruta — no recarga la página activa al hacer click sobre la ruta ya activa.

`allow="gamepad fullscreen autoplay midi microphone clipboard-write"` desbloquea las features delegadas al iframe. La Gamepad API funciona en iframe same-origin sin permisos extra. Web Audio + fullscreen requieren gesto de usuario originado en el iframe.

Los HTMLs internos detectan `window.name === 'sincro-shell-frame'` (vía `pwa-bootstrap.js`) y aplican `<html class="in-shell">`. El bootstrap inyecta CSS que oculta los topbars internos (`#topbar` de play.html, `#sat-topbar` de gh-play/autostepper/gh-autostepper/test-pad, `header.topbar` de la landing).

Botón "Instalar app" en el shell: aparece cuando el navegador captura `beforeinstallprompt` (Chrome/Edge desktop+Android). En iOS se instala vía "Añadir a pantalla de inicio" del menú compartir.

**Bloqueo en dispositivos no compatibles (2026-05-12)**: dos `<script>` inline al final del body. El primero ejecuta inmediatamente y evalúa `isCompatibleDevice()`. Si NO compatible: (1) añade clase `shell-blocked` al body que oculta `.shell-main` y atenúa `.shell-nav` / `.shell-actions` con `visibility:hidden`; (2) muestra el modal `#reqModal` con la misma copia que `index.html`; (3) setea `window.__sincroShellBlocked = true`. El IIFE del router consulta ese flag al inicio y aborta con `return` antes de tocar el iframe. **Sin bypass**: el usuario solo puede volver a la landing. Cubre el caso de entrar directo a `app.html#/play` desde un bookmark, shortcut PWA o URL escrita a mano.

### PWA — manifest, service worker, iconos

- **`manifest.webmanifest`**: `start_url: /app.html#/play`, `id: /app.html`, `display: standalone` con `display_override: window-controls-overlay`, `theme_color: #00bec8`, `background_color: #0f172a`, 4 shortcuts (Jugar / GH / AutoStepper / Test pad).
- **`sw.js`** (raíz, scope `/`) — estrategia mixta:
  - **`install`**: precache del shell estático (HTMLs + CSS + JS modules + iconos + manifest). El listado vive en `PRECACHE_URLS` al inicio del fichero.
  - **`fetch HTML navigation`**: network-first con fallback a precache. Un deploy nuevo se nota sin "vaciar caché". Si offline y nada cacheado, fallback **inteligente por ruta** (`sw.js:106-130`): rutas del shell SPA (`/`, `/app*`, `/play*`, `/stepmania-play*`, `/gh-*`, `/autostepper*`, `/test-pad*`, `/tutorial*`, `/calibration*`) caen a `/app.html`; cualquier otra URL navegacional cae a `/index.html`.
  - **`fetch CSS/JS/iconos same-origin`**: cache-first con runtime fallback.
  - **`fetch Google Fonts`**: stale-while-revalidate.
  - **Range requests passthrough** (`req.headers.has('range')`): el motor de audio carga segmentos, cachear esto los rompería.
  - **Cross-origin no same-origin passthrough**: no cacheamos blobs de audio ad-hoc; viven en IndexedDB.
  - **`CACHE_VERSION = 'sincro-v25'`** (al 2026-05-12). **Bumpear cada vez que cambien archivos del precache** para que los clientes detecten la nueva versión y purguen la antigua en `activate`. Sin bump, los clientes con SW antiguo siguen sirviendo desde caché y los fixes nunca llegan.
- **`pwa-bootstrap.js`**: registra el SW (solo https/localhost), expone `window.SincroPWA.{inShell, isInstalled, canInstall, promptInstall}`, captura `beforeinstallprompt` y dispara eventos custom `sincro-pwa-installable` / `sincro-pwa-installed` / `sincro-pwa-update-available`.
- **`icons/icon.svg` + `icons/icon-maskable.svg`**: flechas DDR sobre gradiente turquesa→dorado. Maskable lleva 10% de padding interno (safe-zone). Chrome moderno y iOS 16+ aceptan SVG en manifest.

Cada HTML clásico inyecta en su `<head>`: `<link rel="manifest">`, `<meta name="theme-color">`, `<link rel="icon" type="image/svg+xml">`, `<link rel="apple-touch-icon">`, `<script src="/stepmania-web/js/pwa-bootstrap.js" defer>`. Esto asegura que cualquier ruta directa siga siendo instalable como PWA.

### Headers HTTP recomendados (configurar en host)

- `sw.js`: `Cache-Control: no-cache`.
- `manifest.webmanifest`: `Content-Type: application/manifest+json`.
- `*.html`: `Cache-Control: no-cache` o ETags.
- `*.svg`, `*.css`, `*.js`: cache largo (1 año) — el `CACHE_VERSION` interno controla la invalidación de clientes ya conectados.

---

## Tests por archivo

Filosofía pragmática: testeamos lo que es matemáticamente verificable sin navegador, y validamos lo demás (render, Web Audio, Gamepad, IndexedDB, DOM) jugando manualmente. Pretender 100% de cobertura en este tipo de proyecto es trampa — la confianza real viene de jugar, no del coverage report.

### Setup

- **`package.json`**: scripts `pnpm test` (run-once), `pnpm test:watch`, `pnpm test:ui`. Stub de `typecheck`/`lint` (no-op). Una sola devDependency: `vitest`.
- **`vitest.config.mjs`**: environment `node` (no jsdom), busca `tests/**/*.test.mjs` y `tests/**/*.test.js`. Si en el futuro necesitas tests con DOM, cambia environment a `'jsdom'` e instala `vitest-environment-jsdom`.
- **`tests/`**: un archivo por módulo. Tests son `.mjs` con `import` (Vitest 2.x es ESM-only).

### Doble export CJS en archivos source

Para que Vitest pueda `import` los módulos del navegador sin migrar todo a ESM, los archivos puros tienen un **guard CJS al final**:

- **`stepmania-web/js/parser.js:275-289`**: `if (typeof module !== 'undefined' && module.exports) module.exports = { parseSscOrSm, parseSscPairs, buildTimingEngine, parseAttacks, lanesFromStepType, parseNotesToEvents, quantColorFor };`. Cero impacto en navegador.
- **`stepmania-web/js/difficulty-tiers.js:259-274`**: el IIFE termina con `if (typeof window !== 'undefined') window.DifficultyTiers = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;`.

Desde un test: `import pkg from '../stepmania-web/js/parser.js'; const { parseSscOrSm } = pkg;` (ESM importa CJS exclusivamente como default).

### Cobertura actual (al 2026-05-10)

- **`tests/parser.test.mjs`** — 23 tests: parseo .ssc/.sm (incluye formato legacy 6-partes), múltiples charts, comentarios //, parseSscPairs, buildTimingEngine (BPMs constantes/cambiantes/STOPS — verifica `parser.js:112` "el stop solo se aplica a beats POSTERIORES con `s.beat < beat` estricto"), lanesFromStepType, parseAttacks, quantColorFor.
- **`tests/difficulty-tiers.test.mjs`** — 23 tests: TIER_CONFIG, rhythmPriority, filterByDifficulty con invariantes, filterPositions48 round-trip, filterTicks GH, PRESET_MULTIPLIER.
- **`tests/audio-metadata.test.mjs`** — 27 tests: parser ID3v2.3/v2.4 (UTF-8 con tildes y emoji, multi-valor v2.4 separado por NUL, "5/12"→"5" en TRCK, guard de null), ID3v1 canónico y v1.1, FLAC Vorbis Comments (case-insensitive), `parseFromFilename` con prefijos de track# en 4 formatos. Fixtures binarios generados en runtime (sin .mp3 commiteados).
- **`tests/mat-layout.test.mjs`** — 11 tests: `getMatDiagonalLayout(mapping)` devuelve `'up' | 'down' | 'none'`. Cubre los 4 casos canónicos, guards contra valores no numéricos, edge case "botón 0 es asignación válida", media-diagonal asimétrica, alfombra de 4 botones, input no-objeto → `'up'`. Verifica que `detectMatDiagonalLayout()` NUNCA expone `'none'` (colapsa a `'up'`).
- **`tests/sm-flow.test.mjs`** — 24 tests: estructura de `LANE_FOOT`/`LEFT_LANES`/`RIGHT_LANES`/`PIVOT_LANES`/`DRILL_PAIRS`; `footOfLane` con pivots heredables; `computeRunInfo` con runs ≥4 a gap uniforme, gap > maxGap, rupturas; `pickArrowFlow` en drill (ignora rng, sigue `drillLanes[idx % 2]`) y libre (alternationProb=1 fuerza pie contrario, =0 fuerza mismo pie, anti-repeat, pivots como puente, anti-cross verificado con 100 picks); `pickJumpLane`. Aleatoriedad inyectada vía Mulberry32 con seed fija.

**Total: 131 tests (parser 23 + difficulty-tiers 23 + scores 23 + audio-metadata 27 + mat-layout 11 + sm-flow 24), ~440ms en CI.**

### Lo que NO se testea (decisión consciente)

- Render del canvas en `game.js` (visual regression manual).
- Service Worker `sw.js` (lógica son 30 líneas de routing).
- Wrappers de IndexedDB en `core.js` (testearlos = testear IndexedDB del navegador).
- Gamepad polling, Web Audio playback, touch overlay, DOM transitions.

### Cómo extender

Cuando arregles un bug en algoritmo puro, primero añade el test que lo reproduce. Sin disciplina TDD — solo "el bug existió una vez, no debe volver". Para `audio-pipeline.js` necesitarás mockear `AudioBuffer` (Vitest soporta `vi.fn` y stubbing global). El siguiente candidato natural es la generación de notas en los autosteppers — algoritmo determinista con seed fija, ideal para tests de snapshot del output `.ssc`/`.chart`.
