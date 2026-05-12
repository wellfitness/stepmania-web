# Sincro — Suite rítmica de Movimiento Funcional

Suite de juego rítmico en navegador para alfombra de baile (RedOctane USB Pad VID 1430 / PID 8888 + cualquier mat genérico calibrable) y guitarra Guitar Hero (PS2 vía receptor USB Sony-emulado VID 054C/PID 0268, recalibrable). Marca paraguas: **Sincro** (la suite completa). Compatible con el formato de charts `.ssc/.sm` de StepMania 5 (instalado opcionalmente en `C:\Games\StepMania 5` para desarrollo).

## Archivos

### `index.html`
Landing pública del producto **Sincro**. HTML semántico autocontenido (CSS embedded, sin dependencias del motor de juego). Incluye:
- **Modal de requisitos + bloqueo en dispositivos no compatibles (2026-05-12):** al cargar la landing, un IIFE inline al final del `<body>` evalúa `isCompatibleDevice()` = viewport mínimo 1024×600 + `pointer: fine`. Si NO compatible: intercepta clicks en TODOS los enlaces `a[href^="app.html"]` y a archivos del motor (`play.html`, `stepmania-play.html`, `gh-play.html`, `autostepper.html`, `gh-autostepper.html`, `test-pad.html`, `tutorial.html`, `calibration.html`) con `preventDefault()` + mostrar modal `#req-modal` explicando requisitos. **NO se hace auto-popup al entrar** — la landing es contenido informativo legítimo (beneficios, ciencia, FAQ, tabla comparativa) y la usuaria móvil debe poder leerlo; el modal aparece solo cuando intenta entrar al juego. No hay bypass para "continuar de todos modos" — la decisión consciente es bloquear el motor porque el coste de frustración (1 hora con cables OTG que no van) supera con creces el de prohibir entrar. El link "Jugar" del header se retiró en el mismo cambio; el último item del nav apunta a `#faq` (la nueva sección, accesible en compatible o no — es el destino natural de quien busca info de requisitos).
- **Sección FAQ `#faq`:** 7 `<details>` accordion-style con preguntas frecuentes (dispositivos soportados, equipo necesario, móvil/tablet, almacenamiento, etc.). Cada item con `summary` clickable + `faq-body` que incluye listas de ok/warn/ko con códigos de color (`.ok` verde, `.warn` amarillo, `.ko` rojo). El primer item está `open` por defecto para que el contenido más importante (dispositivos compatibles) se vea sin click extra. Usa `<details>` nativo sin JS — accesible, sin dependencias.
- Hero con copy "Pisa el ritmo, entrena 3 cerebros a la vez" + lluvia animada de flechas DDR + 3 CTAs (Jugar / Crear chart / Probar hardware).
- 3 pilares de beneficios — **Físico** (cardio, equilibrio, prevención caídas, cita BJSM 2025), **Mental** (música activa redes globales), **Cognitivo** (sincronización auditivo-motora, función ejecutiva).
- Sección "Cómo funciona en tu cerebro" con SVG inline de 5 redes neurales animadas (corteza auditiva, ganglios basales, SMA, cerebelo, prefrontal).
- Sección "Y también con guitarra" — bonus track con disclaimer honesto ("la guitarra no es cardio") y 4 mini-pilares específicos (percepción musical, coordinación bimanual, AMS, función ejecutiva).
- Tabla comparativa exergaming vs ejercicio tradicional con SMDs reales del meta-meta-análisis.
- Cards de las 3 herramientas, final CTA y footer con disclaimer médico.
- Open Graph + Twitter Card + JSON-LD `WebApplication` con `name: "Sincro"` apuntando a `play.movimientofuncional.app`.
- Favicon SVG inline (emoji 🎮), skip-link, `prefers-reduced-motion`, ARIA labels en cada section, contraste WCAG AA.
- Branding: `⚡ Sincro` con gradiente turquesa→dorado (Righteous + ABeeZee, paleta MF).
- 8 referencias DOI verificadas (PubMed/Scholar Gateway): Singh 2025 BJSM, Yoong 2024, Chen 2021, Lavigne 2025, Benzing 2019, Gong 2016, Särkämö 2013, Bentley 2022, Pasinski 2016, Zaatar 2023.

### `play.html` (dashboard)
**Dashboard puro** — la pantalla principal con 8 cards organizadas en 3 secciones: **StepMania** (Bailar / Crear coreografías / Mis canciones), **Guitar Hero** (Tocar / Crear partituras / Mis canciones GH), **Comunes** (Comprobar el equipo / Tutorial). Cada card es un enlace directo al archivo correspondiente — NO usa SPA goto() porque ya no hay screens internas que mostrar. Hasta 2026-05-12 había 9 cards (con una dedicada a "Calibración audio"), pero esa funcionalidad se fusionó en el tab "Sync de audio" del test-pad para eliminar el duplicado.

Hasta 2026-05-11 `play.html` era un SPA monolítico de 1021 líneas con 10 screens (menu, pad, create, library, songs, diff, play, results, calib, tutorial). La separación a archivos dedicados deja `play.html` en ~280 líneas y es solo head + topbar + settings modal + menu-screen + bindings minimales del modal. El motor DDR vive ahora en `stepmania-play.html`. Las pantallas Calibración y Tutorial son archivos propios. AutoStepper y Test pad ya vivían fuera.

Carga lo mínimo: `pwa-bootstrap.js` + `core.js` (para `pollGamepad()` del padPill y el `settings` persistente del modal). NO carga parser/game/song-select/etc.

Settings modal: globalOffset, scrollSpeed, timingWindow, NoteSkin PNG, fondo. El usuario abre Ajustes desde aquí y los valores se persisten a `localStorage` vía `saveSettings()`. El render real (NoteSkin aplicado a las flechas, fondo de la canción) ocurre dentro de `stepmania-play.html` que lee los mismos `localStorage` keys.

### `stepmania-play.html`
**Motor StepMania (DDR)** — SPA con pantallas: Jugar (songs-screen, selector + config + previews), Dificultad (ajustes per-song), Play (canvas), Resultados, Mis canciones (library). Carga módulos clásicos desde `stepmania-web/js/`: `core` → `parser` → `difficulty-tiers` → `library` → `backup` → `song-select` → `game` → `app`. Estilos en `stepmania-web/css/styles.css`.

Hash routing: `stepmania-play.html#library` aterriza directo en la biblioteca (lo usa el dashboard desde la card "Mis canciones"). Sin hash, abre en `songs` (selector de canción). El patrón vive en `app.js` — `applyHash()` equivalente al de `gh-play.html`.

Funcionalidad end-to-end:
- Parser `.ssc/.sm` con BPMs/STOPS/DELAYS/WARPS, OFFSET, NOTES.
- Motor de timing real (J4–J7) con quantización a 192nds, mines, holds/rolls (HOLD_LIFE 300ms), lifts, fakes, hands.
- 6 modifiers: mirror, left, right, shuffle, hidden, sudden + chartSpeed local (0.5–4x) y scrollSpeed global (0.5–3x).
- Librería en IndexedDB con import individual (.ssc/.sm + audio), import packs SM (carpetas), backup ZIP completo (canciones + scores + ajustes), restore. Los handlers de import en `library.js:90-220` distinguen `QuotaExceededError` del resto: cuando IndexedDB se queda sin cuota (Safari iOS ~50MB hard cap, Android con storage bajo), se PARA el bucle de import (los siguientes también fallarán), se consulta `navigator.storage.estimate()` y se muestra mensaje accionable con el `usedMB` real ("Almacenamiento lleno tras importar X canciones. Tu navegador limita la librería a Y MB. Elimina canciones antiguas o haz un backup ZIP antes de seguir.").
- **Política unificada de carriles:** todos los charts nuevos generados por el autostepper (tanto el integrado como el standalone) son `dance-double` (8 carriles, master único). El motor decide en runtime cómo jugarlos vía `getActiveLaneConfig` en `game.js`: **default = 4 carriles (clásico)**, mod Solo = 6, mod Full = 8. El bloque de redistribución (`game.js:279-303`) hace el remap simétrico (8→4, 8→6, o el caso legacy 4→6/4→8 sobre charts antiguos). Los charts antiguos en biblioteca con `dance-single` o `dance-solo` siguen funcionando — su `nativeLanes` original se respeta como punto de partida del remap. Mods Solo y Full mutuamente excluyentes (`song-select.js:237-238`).
- Input: alfombra USB (con calibración por roles vía `mat-mapping` en localStorage), teclado (← ↓ ↑ →) y **overlay táctil de 4 zonas en móvil** (`game.js:459-558`). El overlay aparece solo cuando el dispositivo expone touch (`'ontouchstart' in window || maxTouchPoints > 0`) y el chart se juega en modo default 4-lane. Mods Solo/Full no tienen mapeo táctil natural; en esos casos se loggea aviso en consola y el usuario debe usar teclado/alfombra. Implementado con Pointer Events (`pointerdown`/`pointerup`/`pointercancel`/`pointerleave`) + `touch-action:none` para evitar que el navegador robe gestos como scroll/zoom. El soporte de guitarra Guitar Hero vive en `gh-play.html` aparte (no se mezcla aquí — game style fundamentalmente distinto, requiere strum + chord + HOPO).
- Settings persistentes (localStorage): globalOffset, scrollSpeed, timingWindow, NoteSkin PNG personalizado, fondo procedural por título. Compartidos con el dashboard (`play.html`).
- **Robustez de ciclo de vida (`game.js:269-417`):** `startGame()` captura `currentNavToken()` al inicio y verifica `isCurrentNav(myToken)` después de cada `await` (resume audio, arrayBuffer, decodeAudioData, runCountdown). Si el usuario navega fuera durante esos ~3s, la promesa se aborta limpiamente sin crear `gameState` huérfano. Toda la cadena async va envuelta en `try/catch` que muestra `alert()` específico para `EncodingError` (audio no decodificable — típico de OGG en iOS Safari) y devuelve a la pantalla `diff`. `stopGame()` anula `src.onended = null` antes de `src.stop()` para evitar que el `setTimeout(endGame)` huérfano se dispare 500ms después con `gameState` ya nulo.
- **SPA navigation (`app.js`):** `goto(name)` con SCREENS dinámicas (filtradas por `document.getElementById('X-screen')` presentes en el DOM). Si se pide una screen ausente, `SCREEN_EXTERNAL[name]` la mapea a un archivo dedicado y redirige con `window.location.href`. Esto permite que código legado de `song-select.js` con `goto('create')` siga funcionando: en `stepmania-play.html` (sin `create-screen`) salta automáticamente a `autostepper.html`. El mismo `app.js` funciona en cualquier archivo que cargue el motor — la nav es agnóstica al archivo.

### `tutorial.html`
**Página estática** con el tutorial completo de la app (8 pestañas: Para empezar, Cómo jugar, Crear coreografías, Probar la alfombra, Calibración, Biblioteca, Ajustes, Otras herramientas). Carga solo `pwa-bootstrap.js` + `styles.css` — sin ningún módulo del motor. El switcher de pestañas vive en un `<script>` inline de 10 líneas. Es un archivo de un solo screen sin lógica SPA.

### `calibration.html`
**Redirect HTML** (2026-05-12) a `test-pad.html#alfombra-sync`. Hasta esa fecha era una página standalone con metrónomo + tap que **duplicaba** funcionalidad ya presente en el tab "Sync de audio" del `test-pad.html`. La consolidación elimina la duplicidad: un único punto de calibración bajo *Comprobar el equipo → Sync de audio*. La URL se conserva por compatibilidad con deep-links externos (manifest shortcuts, posibles bookmarks). Implementado con `<meta http-equiv="refresh">` + `window.location.replace()` JS fallback. El JS original (`stepmania-web/js/calibration.js`) se eliminó en el mismo commit — su lógica de aplicar offset a `settings.globalOffset` vive ahora en `test-pad.html` como `applySyncOffsetToSettings(ms)` (mismo key `'stepmania-web-settings'` de `core.js`, sin necesidad de cargar `core.js` entero).

El test-pad acepta los hashes `#alfombra-sync` / `#mat-sync` / `#sync` (modo mat) y `#guitarra-sync` / `#guitar-sync` (modo guitar) al cargar — activan automáticamente el modo y el tab correspondiente vía `deepLinkSyncTab()` al final del script.

### `stepmania-web/js/core.js`
Módulo base compartido por **todos los archivos del motor**: `play.html` (dashboard), `stepmania-play.html` (motor), y referenciado indirectamente por `gh-play.html`. Carga primero en cada archivo. Expone en scope global:

- **`escapeHtml`, `formatTime`, `safeFn`, `getExt`, `yieldUI`** — helpers triviales.
- **`ensureAudioCtx()`** — crea/devuelve un `AudioContext` singleton. Síncrono, NO hace `resume()`. Para callers que solo necesitan `decodeAudioData` (funciona en estado `'suspended'`).
- **`ensureAudioCtxRunning()` async** — variante que SÍ hace `resume()` y se debe usar en cualquier call-site que vaya a reproducir audio audible. Centralizar el resume aquí evita el pitfall de iOS Safari + Chrome Android (autoplay policy crea el contexto en `'suspended'` hasta el primer gesto, y `start()` en suspended falla en silencio).
- **`pollGamepad()` (loop rAF eterno)** — polling de `navigator.getGamepads()` a 60 fps, ACTUALIZA `gamepadButtonState[20]` y `gamepadJustPressed[20]` (consumidos por `game.js`, `pad-test.js`, `gh-play.html`). Mejoras críticas (`core.js:25-90`):
  - **Pausa automática en `visibilitychange === 'hidden'`** para no quemar batería en background. Se rearranca solo al volver a `visible`.
  - **Cachéo lazy de `#padPill`** con sentinel `false` (vs `null` que ya significa "no inicializado"). Si la página no tiene `#padPill` (futuras páginas satellite), el polling sigue funcionando con optional chaining.
  - **`try/catch` envolviendo todo el cuerpo** para que una excepción transitoria (DOM no listo, gamepad desconectado mid-frame) NO mate el loop entero — antes una sola excepción dejaba al usuario sin input para el resto de la sesión.
  - **Filtro `pickMatGamepad()` en 3 capas** (`core.js:59-78`) para que `play.html` no agarre dispositivos HID que no son alfombra. La Gamepad API de Chrome asigna `gamepad.index` por orden de "primer despertar dentro de la pestaña" — NO determinista entre sesiones. Sin filtro, un casco USB Audio (que Windows expone como gamepad con 0 ejes y 3-7 botones de control de volumen) podía ocupar el slot 0 antes que la alfombra y romper toda la detección. Capas: (1) **blacklist por nombre** con regex `/USB Audio|Audio Device|Headset|Headphone|Microphone|Speaker|Webcam|Camera/i`; (2) **heurística numérica** alfombra-shaped: `buttons.length >= 4 && axes.length < 6` (rechaza guitarra GH 10 ejes para no confundirla con alfombra); (3) **fallback** al primer connected no-audio, y último recurso primer connected sin filtro. El mismo patrón vive en `test-pad.html` (`findGamepad(mode)` con `isViableGamepadForMode`) y en `gh-play.html` (`pickGuitarGamepad`) — ver descripciones de esos archivos.
- **`openDB`, `dbAdd`, `dbAll`, `dbGet`, `dbDelete`, `dbPut`, `dbRun*`** — wrappers Promise sobre IndexedDB (DB `StepManiaWebDB` v4 con stores `songs`, `runs`, `gh-songs`). El store `runs` (autoincrement, índices `songId` / `chartId` / `playerLower`) sustituye al antiguo `scores` (keyed por `songId:chartKey`, sin nombre de jugador): cada partida acabada inserta una fila independiente, lo que habilita ranking arcade con nombre + histórico de progresión. La migración v3→v4 borra `scores` limpiamente (decisión consciente: wipe en vez de mantener entries legacy sin nombre). Funciones: `dbRunAdd`, `dbRunsForChart(songId, chartKey)`, `dbRunsForSong(songId)`, `dbRunsAll()`, `dbRunDelete(id)`, `dbRunsClearForChart`, `dbRunsClearForSong`. Helpers puros testeables: `chartIdOf(songId, chartKey)` (key compuesta del índice `chartId`), `sanitizePlayerName(s)` (trim + strip control chars + cap 12 chars + fallback `'Anónimo'`), `rankRuns(runs)` (sort score desc, ties por `playedAt` ascendente — gana la más antigua, convención arcade), `bestRunPerPlayer(runs)` (case-insensitive vía `playerLower`, devuelve un run por jugador con el del run ganador como representante). `localStorage['sincro-last-player']` prefilla el input "tu nombre" entre sesiones (módulo helpers `getLastPlayerName` / `setLastPlayerName`).
- **`settings` + `saveSettings` + `openSettings`** — config persistente en localStorage (`globalOffset`, `scrollSpeed`, `timingWindow`).
- **`bumpNavToken`, `isCurrentNav`, `currentNavToken`** — token de navegación incremental para cancelación de promesas en vuelo. Cada `goto()` en `app.js` bumpea; las funciones async largas (`startGame`, futuras `loadSongPreview`…) capturan el token al inicio en una const local y verifican que sigue siendo el actual después de cada `await`. Si no, abortan limpiamente. Patrón equivalente a `AbortController` pero sin la ceremonia de pasar señales por toda la cadena de funciones — basta con que cada función larga consulte el global. Sin esto, `goto('diff')` durante un `decodeAudioData` de 3s dejaba el motor creando `gameState` sobre la pantalla equivocada.

### `test-pad.html`
Diagnóstico de hardware en el navegador (Gamepad API). Selector inicial **Alfombra | Guitarra**.

**Modo Alfombra (9 pestañas):**
- **Calibrar**: asistente paso a paso para mapear los 10 roles físicos (4 cardinales + 4 diagonales + start/back). El mapping se persiste en `localStorage` con key `mat-mapping`. **Filas clickables** para reasignar un rol individualmente sin rehacer toda la calibración (útil si solo unos paneles están mal). El test usa esta calibración: si un rol no está asignado (`null`), los tests lo auto-skippean.
- **Estadísticas**: pisadas por panel, duración media de cada press, polling rate.
- **Latencia**: test de reflejos por panel calibrado (panel aleatorio → mide ms hasta pisar). Solo prueba paneles asignados; ignora roles `null` (ej: si tu pad no tiene DOWN-LEFT, no se prueba).
- **Saltos**: combos simultáneos definidos por roles (Izq+Der, Arriba+Abajo, UP-LEFT+UP-RIGHT, DOWN-LEFT+DOWN-RIGHT, 4 cardinales). Auto-skip a los 5s si algún rol del combo no está calibrado.
- **Sync de audio**: metrónomo configurable BPM 60-180. Mide offset del usuario y sugiere `Global Offset` para `Preferences.ini`.
- **Stress test**: 10s de pisadas rápidas. Detecta bouncing si intervalo mínimo &lt; 15ms.
- **Ghost inputs**: monitorea 60s sin pisar — si aparece input, hay sensor pegado.
- **Secuencia**: histórico de últimas 50 pisadas con timestamp.
- **Ejes**: lectura cruda de los axes del gamepad.

**Modo Guitarra (11 pestañas):**
- **Calibrar**: asistente paso a paso para mapear los 11 roles físicos (5 trastes, strum ↑/↓, tilt, Star Power, Select, Start). El mapping se persiste en `localStorage` con key `guitar-mapping`. **Filas clickables** para reasignar un rol individualmente. Especialmente útil cuando hay conflictos (ej: receptor PS2→USB chino que mapea Verde a btn[7], que casualmente es el default de strumUp).
- **Estadísticas**: pulsos por traste/strum + duración + polling rate.
- **Trastes (latencia)**: 10 rondas de reflejos por traste. Detecta trastes lentos. Solo prueba trastes asignados.
- **Strum**: 15s alternando ↑↓. Mide ratio up:down (debería ser ~1.0) e intervalo mínimo (bouncing).
- **Whammy**: 15s moviendo la palanca. **Auto-detecta el eje correcto** muestreando todos los ejes del gamepad y eligiendo el de mayor rango de movimiento — evita hardcoding de eje Z (algunos receptores usan Y o R). Guarda el eje detectado en `guitarMapping.whammyAxis`.
- **Chords**: combinaciones simultáneas de trastes (G+R, R+Y, power chord G+R+Y+B, fret+strum…). Detecta ghosting de matriz.
- **Sync, Stress, Ghost, Secuencia, Ejes**: compartidas con modo alfombra.

**Sistema de calibración común a ambos modos:**
- Toast verde "✓ btn[X] → rol" tras cada captura.
- Auto-skip de pasos no aplicables ("Saltar paso").
- Botón "Borrar mapping" vuelve a defaults solo del modo activo.
- Cambiar de modo cancela cualquier calibración en curso y restaura el botón Iniciar.

**Selección de gamepad en 3 capas — `findGamepad(modeOverride)` (`test-pad.html:1645-1693`):** la Gamepad API de Chrome asigna `gamepad.index` por orden de "primer despertar dentro de la pestaña" — el slot 0 puede ser la guitarra en una sesión y un dispositivo `USB Audio` (cascos HP, micrófonos con teclas) en otra. Cuando el slot 0 era un USB Audio, la usuaria no podía calibrar nada porque el polling leía botones de un dispositivo sin ejes ni botones útiles. Solución:
1. **Estricta** — `isViableGamepadForMode(gp, mode)`: para `guitar` exige `axes.length >= 2 && buttons.length >= 5` (GH PS2 tiene 10 y 13); para `mat` exige `buttons.length >= 4 && axes.length < 6` (rechaza guitarra para no confundirla con alfombra). Ambos modos pasan por blacklist `/USB Audio|Audio Device|Headset|Headphone|Microphone|Speaker|Webcam|Camera/i` que rechaza dispositivos audio antes de mirar perfil numérico.
2. **No-audio** — si la 1ª pasada no encuentra nada que encaje en el modo, devolver cualquier connected que no esté en la blacklist. Cubre "solo guitarra enchufada y usuaria en modo mat": preferible darle la guitarra (botones reales) que un casco audio (cero ejes).
3. **Fallback** — último recurso, primer connected sin filtro. Preserva el comportamiento previo para hardware exótico (alfombras chinas con pocos botones, drivers raros). Imposible empeorar la selección de ningún usuario.

El mismo patrón con la misma regex y la misma lógica vive en `gh-play.html` (función `pickGuitarGamepad` para el motor de juego) y en `stepmania-web/js/core.js` (función `pickMatGamepad` para `play.html` DDR). Si descubres un nuevo dispositivo que Chrome enumere como gamepad sin ser controlador real, **añade el patrón a las TRES regex simultáneamente** o el bug volverá solo en ese flujo.

**Mapping físico alfombra via Gamepad API** — defaults; calibrables (alineados con `padMap` de `game.js`):
- `button[0]` = IZQUIERDA · `button[1]` = ABAJO · `button[2]` = ARRIBA · `button[3]` = DERECHA
- `button[4]` = UP-LEFT · `button[5]` = UP-RIGHT · `button[6]` = DOWN-LEFT · `button[7]` = DOWN-RIGHT
- `button[8]` = START · `button[9]` = BACK
- Cualquier pad con mapping distinto (ImpactDX, Cobalt Flux, mats genéricos chinos, X-Pad…) recalibra los 10 roles desde la pestaña "Calibrar".

**Mapping físico guitarra Guitar Hero PS2 via receptor Sony-emulado (VID 054C/PID 0268)** — defaults; calibrables. Mapping observado en una GH original (validado por inspección de `navigator.getGamepads()` con DevTools):
- Trastes: btn[7]=Verde · btn[1]=Rojo · btn[0]=Amarillo · btn[2]=Azul · btn[3]=Naranja (orden no consecutivo — el receptor genérico no respeta el orden GH oficial).
- **Strum bar y palanca de whammy COMPARTEN el mismo eje `axes[1]`** (10 ejes en total). Esta es la rareza crítica de este receptor:
  - Strum ↓ = `{axis:1, dir:+1}` → axes[1] salta a +1 instantáneo (microswitch digital).
  - Strum ↑ = `{axis:1, dir:-1}` → axes[1] salta a -1 instantáneo.
  - Whammy = `axes[1]` con valores intermedios `0.004 → -0.169 → -0.365 → -0.741 → -1` (potenciómetro analógico, gradual).
- Tilt y Star Power: btn[6] y btn[9] respectivamente (varía por modelo).
- Select = btn[8]. Start: variable, calibrar.

**Discriminación strum vs. whammy en `axes[1]` (algoritmo en `detectAxisStrum`):**
La función dispara strum SOLO cuando se cumplen las dos condiciones simultáneamente:
1. **Frame anterior** del eje estaba en zona neutra (`|lastV| < 0.3`).
2. **Frame actual** del eje pasa la zona extrema (`|v| > 0.85`).

El strum es un microswitch digital que salta de 0 → ±1 en un solo frame, así cumple ambas. La whammy es un potenciómetro físico que SIEMPRE pasa por valores intermedios antes de llegar al extremo, así nunca cumple la primera condición — no genera falsos positivos. Sin esta lógica, la whammy a fondo (que sí llega a ±1 ocasionalmente) dispararía strum erróneamente.

Constantes en `test-pad.html`:
- `AXIS_STRUM_FIRE = 0.85` (threshold del extremo).
- `AXIS_NEUTRAL_ZONE = 0.3` (cuán cerca de 0 debe estar el frame anterior).
- `lastAxisValue[i]` se actualiza al final de cada llamada a `detectAxisStrum` para tener disponible "v del frame previo" en la siguiente iteración.

**Notas para receptores diferentes:**
- En **receptores PS3 nativos / GH3 USB**, el strum bar puede estar en buttons (12/13 = D-pad como botones cuando `mapping="standard"`). En ese caso `strumDown`/`strumUp` se guardan como `number` (índice de button) y `detectAxisStrum` los ignora (pasan por el polling de botones convencional). El sistema soporta ambos formatos transparentemente vía `isAxisSpec()`.
- La calibración multi-step (`detectCalibAxisCapture` + `captureCalib`) discrimina automáticamente: si durante el step de strum el usuario pulsa un botón, lo guarda como `number`; si en su lugar mueve un eje > 0.6 desde baseline, lo guarda como `{axis, dir}`.

### `autostepper.html`
Generador automático de charts **StepMania (.ssc/.sm)** desde MP3/WAV. Equivalente al `phr00t/AutoStepper` (Java) pero en navegador.

**Política unificada 8-lane:** todos los charts se generan como `dance-double` (8 carriles: cardinales + 4 diagonales) — master único por canción. La elección de modo (4/6/8) es decisión de runtime en Sincro Play, no de autoría. En StepMania nativo, los charts aparecen bajo el modo *Doubles* (requiere dos alfombras o remapeo). El standalone `autostepper.html` aplica esta política. (Hubo un módulo `stepmania-web/js/autostepper.js` integrado en `play.html` hasta el 2026-05-11 que compartía la lógica; al separarse la pantalla "Crear" a archivo dedicado, ese módulo quedó huérfano y fue borrado el 2026-05-12.)

**Pipeline de detección compartida** — vive en `stepmania-web/js/audio-pipeline.js`, expuesta como `window.AudioPipeline.{decodeFile, toMono, bassEmphasize, computeEnergyEnvelope, computeODF, pickPeaks, detectBPM, detectOffset, ensureAudioContext, audioBufferToWav}`. La usan tanto `autostepper.html` (output `.ssc/.sm`) como `gh-autostepper.html` (output `.chart`). El análisis es agnóstico al juego — solo cambia cómo se traduce el resultado a notas.

**Cap de duración (Completa / 90s / 120s / 180s)** — selector en el paso "Estilo" de los **tres** autosteppers: SM integrado en `play.html`, SM standalone `autostepper.html` y GH standalone `gh-autostepper.html`. Cuando se elige un cap menor que la duración de la canción:
- **SM:** filtra los onsets a `t < effectiveDuration`; recalcula `totalUnits`, `sampleStart`, `estimateMeter`, `calculateRadarValues` con `effectiveDuration`.
- **GH (`gh-autostepper.html`):** filtra los `peakFrames` a `f/framesPerSec < effectiveDuration` ANTES de la conversión a ticks, así `DifficultyTiers.filterTicks` ve un universo ya recortado y el NPS por ventana sigue siendo correcto en el segmento mantenido. `meta.duration = effectiveDuration` se propaga a `song.ini` (`song_length`) y al `#MusicStream` del `.chart`.
- Todos llaman a `AudioPipeline.audioBufferToWav(buffer, effectiveDuration, 1.5)` para producir un WAV PCM 16-bit recortado con fade-out lineal de 1.5s (evita clicks de truncación).
- SM guarda blob en `q.result.croppedAudio` + nombre en `q.result.croppedAudioName`. GH guarda blob en `q.result.croppedAudio` + extensión final en `q.result.audioExt` (`'wav'` si hubo recorte, original en caso contrario) — fuente única de verdad consumida por `processOne`, `downloadAllZip` y `saveOneToLibrary` para no recalcular la extensión 3 veces.
- En GH el `Blob` que entra a IndexedDB lleva MIME `audio/wav` cuando viene del WAV cropeado (importante para Safari, que es estricto con MIMEs en `<audio>`).
- `saveAllToLibrary`, `downloadAllZip`, `buildSscForSong` y `buildSmForSong` (SM) consumen `croppedAudio || q.file` con la misma lógica — coherencia del `#MUSIC` field con el archivo empaquetado.
- Si se elige "Completa", el archivo original (MP3/WAV/etc.) se conserva sin re-codificar.

Algoritmo (optimizado para música bailable: techno, dance, pop, rock):
1. `decodeAudioData` → mono Float32Array
2. **Bass-emphasis** — IIR low-pass 2-polo cascado a ~200 Hz. Aísla el kick + bajo, descarta voces, hi-hats, guitarras distorsionadas. El kick domina el envelope.
3. Energy envelope (ventanas 23ms, hop 5ms) sobre la señal bass-emphasized
4. ODF = log-derivada rectificada del envelope
5. Pico-detección con umbral adaptativo local (75ms window)
6. BPM via autocorrelación de la ODF, **rango 90-180 BPM** (cubre pop/rock 90-130, house 120-130, techno 125-145, DnB 165-180), corrección de octava al mismo rango
7. Offset via correlación de fase
8. **Tap sync manual:** botón "Tap" por canción abre modal; usuario pulsa SPACE/botón al ritmo, mediana de intervalos → BPM. Sobrescribe la detección automática vía `q.bpmOverride`.

**Generación de charts (rejilla interna 192nds para compat SM5):**
- Quantización a 192nds (1 measure = 192 unidades, 1 beat = 48)
- Filtro por resolución elegida (negras=48, corcheas=24, semicorcheas=12)
- Asignación de flechas evitando misma flecha 2 veces seguidas
- Holds/rolls cuando hay gap ≥ 1/2 beat al siguiente paso (probabilidad ajustable)
- Hands (3 paneles simultáneos) solo en Challenge
- Resolución variable por compás (cada compás escoge subdivision válida más pequeña: 4/8/12/16/24/32/48/64/96/192)

**Salida (en ZIP, una carpeta por canción):**
- `<song>.ssc` (formato SM5 nativo, con `#NOTEDATA`, RADARVALUES de 12 valores, CHARTNAME, CHARTSTYLE=Pad, METER, etc.)
- `<song>.sm` (legacy, compatibilidad universal con ITG2/Etterna/3.9)
- `<song>.<ext>` (audio renombrado)

**Presets:**
- 🌿 Suave: sens 2.4, negras, 10% holds, 0% jumps
- ⚡ Normal: sens 1.7, corcheas, 25% holds, 7% jumps (recomendado)
- 🔥 Intenso: sens 1.3, semicorcheas, 50% holds, 18% jumps
- ⚙️ Personalizado: sliders independientes

**5 dificultades generadas por canción:** Beginner, Easy, Medium, Hard, Challenge.

**Filtrado por dificultad** — todos los autosteppers (SM y GH) delegan en `stepmania-web/js/difficulty-tiers.js`. La densidad de notas por dificultad NO se controla por stride relativo a los onsets detectados, sino por:
- **NPS objetivo absoluto** (notas/segundo) — calibrado a estándares oficiales (DDR Groove Radar Stream/Voltage formulas, GH `diff_guitar` guidelines).
- **`minGapSec` absoluto** (spacing mínimo en segundos reales) — desacopla la dificultad del BPM, así Beginner se siente igual de "espaciado" a 90 que a 180 BPM.
- **Prioridad rítmica** — cada onset recibe priority por dónde cae en el compás 4/4 (5=downbeat compás, 4=mid-measure, 3=beat, 2=corchea offbeat, 1=semicorchea, 0=otro). Cada dificultad rechaza onsets con priority < umbral del tier. Cuando un onset queda demasiado cerca del último aceptado pero tiene MAYOR priority rítmica, sustituye al anterior — esto preserva los onsets musicalmente fuertes.
- **Cap por ventana deslizante de 3s** — si en algún tramo se supera el NPS objetivo, se descartan los onsets de menor priority rítmica (no aleatoriamente).

Tabla calibrada (tier → minGap / NPS max / minRhythmPriority):
- SM Beginner: 1.00s / 1.0 / 4 (solo downbeats y mitades de compás)
- SM Easy: 0.50s / 2.0 / 3 (hasta beat completo)
- SM Medium: 0.30s / 3.5 / 2 (hasta corchea)
- SM Hard: 0.18s / 5.5 / 1 (hasta semicorchea)
- SM Challenge: 0.10s / 9.0 / 0 (todo)
- GH Easy: 0.70s / 1.4 / 4
- GH Medium: 0.40s / 2.5 / 3
- GH Hard: 0.22s / 4.5 / 1
- GH Expert: 0.13s / 7.5 / 0

Los presets (suave/normal/intenso) se traducen a multiplicadores globales (×0.7/×1.0/×1.3) que escalan minGap y NPS target uniformemente.

API expuesta: `window.DifficultyTiers.{filterByDifficulty(onsetsSec, bpm, offsetSec, gameType, difficultyKey, presetMul), filterPositions48(...), filterTicks(...)}`. El autostepper SM (`autostepper.html` standalone) usa `filterPositions48`; el GH (`gh-autostepper.html`) usa `filterTicks` con `CHART_RESOLUTION=192`.

Implementa encoder ZIP propio (modo "store", sin compresión) — sin dependencias externas.

**Lectura de metadatos de audio:** ambos autosteppers cargan `stepmania-web/js/audio-metadata.js` (ver descripción más abajo) y lo invocan en `addFiles()` para poblar `title` y `artist` desde tags ID3v2/v1 (MP3) o Vorbis Comments (FLAC). Hasta el 2026-05-12 ambos hacían un split trivial del filename por `" - "`, lo que producía resultados absurdos con nombres como `12 Toxicity.mp3` (artist quedaba vacío y al guardar en biblioteca se etiquetaba como "Unknown") o `11 Rockstar - 2020 Remaster.mp3` (track# parseado como artist). El módulo nuevo replica lo que ya hace Windows Explorer (lee los tags embebidos del MP3). **Solo se persisten title y artist** — el módulo expone también `album/track/year` pero los autosteppers los ignoran porque la UI de biblioteca y los filtros de búsqueda (`library.js:84-89`, `song-select.js:77-88`, `gh-play.html:1248-1253`) solo operan sobre esos dos campos. El bug que dispararon ID3 reales era que los filtros "Buscar artista" daban 0 resultados aunque la canción claramente era de ese artista — al rellenarse bien `s.artist`, el `.includes(qArtist)` funciona.

### `stepmania-web/js/audio-metadata.js`
Parser binario de tags de audio (sin dependencias). Lo cargan los dos autosteppers (`autostepper.html` y `gh-autostepper.html`) para poblar metadatos al soltar archivos.

Cobertura por formato:
- **MP3:** ID3v2.3 y v2.4 (frames TIT2/TPE1/TALB/TRCK/TYER/TDRC en encodings ISO-8859-1, UTF-16 con BOM, UTF-16BE y UTF-8). v2.2 (frame IDs de 3 chars) no soportado — los taggers modernos ya no lo emiten desde 2002. Fallback a ID3v1 (últimos 128 bytes del archivo, latin1 estricto) cuando no hay v2.
- **FLAC:** Vorbis Comments en el bloque `VORBIS_COMMENT` (type 4). Keys reconocidas: TITLE, ARTIST, ALBUM, TRACKNUMBER, DATE/YEAR. Case-insensitive en el parser (algunos taggers emiten `title=` minúscula).
- **WAV/OGG/M4A:** fallback a filename. M4A (atoms iTunes nested `moov/udta/meta/ilst/©nam`) queda como TODO si en el futuro hay demanda.

Estrategia de lectura: `extractMetadata(file)` lee solo los **primeros ~1MB** del File vía `file.slice(0, 1<<20).arrayBuffer()` — eso cubre ID3v2 con artwork embebido (típicamente 50-500KB) y FLAC headers, ahorrando memoria comparado con cargar el archivo entero (5-15MB por MP3). Para ID3v1 lee adicionalmente los últimos 128 bytes con un segundo slice. Si todo falla, cae a `parseFromFilename(name)` que strippea prefijos de track# (`02 `, `12. `, `03 - `, `03_`) antes de aplicar la heurística "Artist - Album - Title" por splits de `" - "`.

El módulo devuelve `{ title, artist, album, track, year, source }` aunque los call-sites actuales (autosteppers SM y GH) solo consumen `title` y `artist` — la biblioteca y los filtros de búsqueda viven sobre esos dos campos. Los campos extra están disponibles para futuras features (sort por album, agrupación por año) sin necesidad de tocar el parser.

**Detalles de implementación críticos** (cualquier toque debe respetarlos):
- **Synchsafe ints (28 bits)**: tamaños en ID3v2 se codifican con bit 7 de cada byte siempre a 0 para no chocar con sync MPEG (que busca 11 bits "1" consecutivos). Decoder canónico en `synchsafe(b, off)`. **v2.3 usa uint32BE normal, v2.4 usa synchsafe** — un error clásico es usar el mismo decoder para ambos y leer tamaños 8× inflados.
- **Multi-valor v2.4 separado por NUL**: dentro de un mismo frame TPE1 puede haber `"Artist1\0Artist2\0Artist3"`. Nos quedamos con el primero vía `text.split(/\x00/)[0]`. Usamos la forma regex (no literal `'\0'`) para evitar que algunos editores guarden el byte NUL real en el .js source.
- **Strip de trailing NUL POST-decode, NO pre-decode** (regla crítica): los frames UTF-16 traen null terminator de 2 bytes (`00 00`) al final. Si haces strip byte-a-byte ANTES del decode, te comes el byte alto (`00`) del último char ASCII (ej: `'o'` es `6F 00` en LE), dejando un byte huérfano que `TextDecoder('utf-16le')` emite como U+FFFD `'�'`. Resultado real: `"DJ Miko"` → `"DJ Mik�"`. La solución es decodear toda la cadena (incluyendo bytes NUL internos como caracteres NUL legítimos del string) y limpiar el sufijo con `.replace(/\x00+$/, '')`. Esto se descubrió tras desplegar v24 y observar que TODOS los MP3s con tags UTF-16 (lo más común — Mp3tag, Picard, WMP escriben así por defecto) salían con `�` al final de title/artist/album. Fixed en v25 con dos tests de regresión específicos (`tests/audio-metadata.test.mjs`: "UTF-16 con null terminator no debe corromper el último char" y "UTF-16 con BOM big-endian también funciona").
- **Guard de null**: si tras parsear todos los frames no hay title NI artist NI album, devolvemos `null` para que `extractMetadata` caiga al siguiente parser. Un tag con solo TRCK ("track 5") es basura para nuestra UI.
- **Doble export CJS** al final del módulo siguiendo el patrón de `parser.js:275-289` y `difficulty-tiers.js:259-274`. Esto permite que el test `tests/audio-metadata.test.mjs` haga `import pkg from '...js'` aunque el módulo esté escrito como classic script.

API expuesta: `window.AudioMetadata.{extractMetadata(file), parseID3v2(buf), parseID3v1(buf), parseFLAC(buf), parseFromFilename(name)}`. Los 4 parsers internos son exportados públicamente para testing — los autosteppers solo invocan `extractMetadata`.

### `stepmania-web/js/gh-db.js`
Módulo de IndexedDB para la **biblioteca de charts Guitar Hero**. Comparte la misma DB `StepManiaWebDB` que la suite SM (DB_VERSION 3, upgrade-safe — añade el store `gh-songs` sin tocar `songs`/`scores` existentes). Expone `window.GHLibrary` con: `open()`, `add(entry)`, `all()`, `get(id)`, `delete(id)`, `extractMeta(chartText)`.

Schema de un entry en `gh-songs`:
```
{ id, title, artist, bpm, duration, chartText, audioBlob, audioName, diffs:[], totalNotes, addedAt, genre, charter }
```

Lo cargan tanto `gh-autostepper.html` (para el botón "Guardar en biblioteca") como `gh-play.html` (para la sección "Tu biblioteca" en setup screen). `core.js` también está sincronizado a DB_VERSION 3 con creación del store `gh-songs` en `onupgradeneeded` para que play.html y los archivos GH coexistan sin conflictos de versión.

### `gh-play.html`
**Simulador Guitar Hero** en el navegador. Carga charts `.chart` (formato Feedback / Clone Hero) bien sea como ZIP del autostepper o como `notes.chart` + audio sueltos. Lee el `guitarMapping` calibrado desde `localStorage` (key `guitar-mapping`, generado por `test-pad.html`) — cero re-calibración. También soporta teclado fallback (1-5 frets, Espacio strum) para testing sin guitarra.

**Motor de hit detection (regla Clone Hero estándar):**
- **Single notes**: anchor — el target debe estar pulsado, ningún fret más alto puede estarlo, frets más bajos pueden estar pulsados o no (anchor). Ejemplo: nota Yellow puede hitearse con (Green+Yellow), no con (Yellow+Blue).
- **Chord notes**: match estricto — exactamente esos frets, ni más ni menos.
- **Strum-required (default)**: hit dispara solo en flanco DOWN o UP del strum bar Y match de frets. Strum sin frets correctos = combo break (overstrum).
- **HOPOs (auto-detectados en runtime)**: si la nota tiene gap < hopoThreshold (default canónico CH **65 ticks** = `floor((65/192)·resolution)` ≈ 1/3 de un beat ≈ tresillo de corcheas, validado contra `natural-hopo.ts` de scan-chart) Y es single Y distinto fret al anterior Y combo > 0, basta con cambiar a los frets correctos sin strum. Threshold ajustable en setup.
- **Taps (fret 6 en .chart)**: se hitean sin strum desde combo 0; típicos de Expert+ marcados explícitamente.

**Timing windows**: Perfect 45ms · Good 90ms · Bad 135ms (referencia: Clone Hero usa valores similares). Multiplicador clásico: x1 / x2 (10 combo) / x3 (20) / x4 (30).

**Sustains**: si la nota tiene `sustain > 0`, mientras los frets se mantengan pulsados se acumulan puntos (`SUSTAIN_POINTS_PER_SEC` × multiplicador). Soltar los frets antes del final = sustainBroken (no más puntos pero el combo sobrevive). Frets distintos durante el sustain también lo rompen.

**Detección de strum compartida con `test-pad.html`**: para guitarras donde el strum vive en eje (axes[1] en GH PS2 vía receptor Sony-emulado) usa el mismo algoritmo de transición desde neutro (`AXIS_STRUM_FIRE = 0.85`, `AXIS_NEUTRAL_ZONE = 0.30`). Esto evita falsos positivos del whammy que comparte el mismo eje.

**Selección de gamepad — `pickGuitarGamepad(pads)` (`gh-play.html:1869-1888`):** mismo patrón en 3 capas que `test-pad.html` (ver descripción detallada allí). 1ª pasada exige `axes.length >= 2 && buttons.length >= 5` y rechaza la blacklist de dispositivos audio. 2ª pasada acepta cualquier no-audio. 3ª pasada (último recurso) el primer connected. Necesario porque sin filtro, un casco `USB Audio` enumerado por Chrome como gamepad antes que la guitarra rompía la lectura de frets/strum.

**Render**: canvas 2D con highway de 5 carriles centrados en pantalla. Notas caen desde arriba; receptors en hit zone (85% canvas height). HOPOs con borde blanco; Taps con relleno blanco; sustains con cola colorida del fret. Frets pulsados encienden el receptor con glow del color correspondiente.

**Audio**: reproducción vía `AudioBufferSourceNode` del `AudioPipeline.ensureAudioContext()` compartido. Countdown de 2s antes del primer beat para que las primeras notas tengan tiempo de bajar. Pause con ESC re-crea el source en la posición exacta para reanudar bien.

**Ajustes en setup**:
- Dificultad: dropdown auto-poblado con las que existen en el chart cargado.
- Velocidad de scroll (200-900 px/s).
- Offset global ms (positivo = retrasar notas, negativo = adelantarlas).
- HOPO threshold ticks (default canónico CH = 65, ver sección "Constantes canónicas").

**Resultados**: grade S/A/B/C/D/F basado en accuracy (hits/total). Muestra score, accuracy, hits, misses, max combo.

**Pendiente / mejoras futuras (v2):**
- Star Power (acumulación + activación con tilt, timing windows ampliadas durante SP).
- Whammy → modulación de pitch del sustain (Web Audio detune mientras axes[1] varía y hay sustain activo).
- Open notes (fret 7 en .chart) — strum sin fret pulsado.
- Variable BPM (parser ya soporta múltiples markers `B` en SyncTrack pero el motor solo usa el primero).
- Notas de bombo / drums tracks.
- Persistencia de scores en IndexedDB (compartida con play.html SM).

### `gh-autostepper.html`
Generador automático de charts **Guitar Hero (.chart Clone Hero / Feedback format)** desde MP3/WAV. Reusa `stepmania-web/js/audio-pipeline.js` (mismo análisis: bass-emphasis, ODF, BPM, offset). El output diverge: en vez de `.ssc/.sm` produce `notes.chart` + `song.ini` + audio en ZIP, listo para extraer en `Clone Hero/Songs/`.

**Note generation (5 trastes, 4 dificultades):**
- **Roles**: 0=Verde, 1=Rojo, 2=Amarillo, 3=Azul, 4=Naranja (índices del `.chart` format).
- **Walk de trastes**: caminata aleatoria con bias 65% adyacente, 25% jump de 2, 10% random. Prohíbe repetir traste consecutivo. La primera nota de cada chart va a Verde/Rojo (más fácil empezar bajo).
- **Filtrado por dificultad**: delegado a `DifficultyTiers.filterTicks` — cada tier tiene NPS objetivo absoluto y `minGapSec` real (no stride relativo). Easy: rango G-Y, gap ≥ 0.7s, ≤1.4 NPS. Medium: G-Az, gap ≥ 0.4s, ≤2.5 NPS. Hard: G-N, gap ≥ 0.22s, ≤4.5 NPS. Expert: G-N, gap ≥ 0.13s, ≤7.5 NPS. Calibrado a estándares de `diff_guitar` de la comunidad Clone Hero (Easy = "incredibly easy and simple, almost no alt-strumming").
- **Chords (Hard+)**: con probabilidad `chordProb` (slider 0-60%, default 18%) se añade un fret adyacente al actual. Easy/Medium nunca llevan chords.
- **Sustains**: si hay gap ≥ 1/2 beat al siguiente onset, con prob. `sustainProb` se convierte en sustain del 80% del gap.
- **HOPOs**: NO se marcan explícitamente. Clone Hero auto-detecta HOPOs por proximidad usando la regla canónica de `scan-chart` (gap < 65 ticks a res 192, single, fret distinto al previo, no chord, no override por flag forceHopo/forceTap). Ver "Constantes canónicas" para el detalle del algoritmo.

**Formato `.chart` (Feedback / Clone Hero):** `Resolution = 192` ticks/quarter. Notas: `<tick> = N <fret> <sustain>`. Chord = múltiples líneas en mismo tick. BPM en SyncTrack como `0 = B <bpm*1000>` (milibeats). Solo 1 BPM constante en MVP — variable BPM queda como ampliación futura.

**Output ZIP por canción:**
- `<slug>/notes.chart` — todas las dificultades
- `<slug>/song.ini` — metadata (name, artist, charter, diff_guitar, song_length, etc.)
- `<slug>/song.<ext>` — audio sin tocar

**Presets:**
- 🌿 Suave: sens 2.4, 1/4 max, 5% chords, 30% sustains
- ⚡ Normal: sens 1.7, 1/8 max, 18% chords, 20% sustains (recomendado)
- 🔥 Intenso: sens 1.3, 1/16 max, 40% chords, 10% sustains

**Lectura de metadatos de audio:** ver `stepmania-web/js/audio-metadata.js`. Desde el 2026-05-12 `addFiles()` invoca `AudioMetadata.extractMetadata(file)` en paralelo para todos los archivos soltados (`Promise.all` con `++queueIdCounter` ANTES del `await` para mantener IDs correlativos). Solo se persisten `title` y `artist` al store `gh-songs` — el `song.ini` y el `.chart` del ZIP siguen con `album =` vacío para no introducir asunciones sobre el corpus de Clone Hero del usuario.

**Pendiente / mejoras futuras:**
- Pitch-aware fret assignment (FFT + mapping low→Verde, high→Naranja). Ahora es aleatorio con bias.
- Tap notes (fret 6 en .chart) explícitos para Expert.
- Open notes (fret 7) ocasionales para simular bombos.
- Variable BPM si la canción cambia de tempo.

### Scripts Python (`test_pad*.py`, `detectar-guitarra.py`)
Tests vía WinMM `joyGetPosEx` (DirectInput equivalent). Útiles si la Gamepad API del navegador no detecta el dispositivo. Usan solo `ctypes`, sin pygame.

- `test_pad.py`: detección + 20s de input por consola (con nombres de paneles).
- `test_pad_raw.py`: 20s mostrando estado crudo (botones, ejes X/Y/Z, POV).
- `test_pad_all.py`: secuencia 30s para verificar los 6 paneles principales.
- `detectar-guitarra.py`: enumera los 16 slots de joystick de Windows con VID/PID/nombre/nº de botones, identifica heurísticamente cuál es guitarra (8-13 botones + eje Z) y monitoriza inputs durante 30s. Útil para confirmar que el receptor PS2→USB está visible al sistema antes de calibrar en el navegador.

Mapping físico alfombra via WinMM (distinto al del navegador):
- B1=ARRIBA, B2=ABAJO, B3=IZQUIERDA, B4=DERECHA, B7=UP-LEFT, B8=UP-RIGHT, B9=START, B10=BACK

## Constantes canónicas — origen, valor y verificación

Toda decisión de timing/densidad/dificultad citada abajo está validada contra código fuente abierto. Si vas a tocarla, replica primero el archivo origen.

### StepMania 5.1 — DDR (`D:\SOFTWARE\stepmania-web\stepmania-5_1-new\`)
Repositorio local del motor oficial open-source. Útil para validar nuestras métricas:
- **Stream value** (`src/NoteDataUtil.cpp:1142`): `Stream = (total_taps / fSongSeconds) / 7.0f`. Es decir: NPS/7. Stream=1.0 ↔ 7 NPS sostenido. Nuestros caps por tier (`difficulty-tiers.js`) están alineados con esta escala — Beginner cap 1.0 NPS → Stream 0.14, Challenge cap 9.0 NPS → Stream 1.29.
- **Voltage window** (`src/NoteDataUtil.cpp:1023`): `voltage_window_beats = 8.0f`. Por eso nuestro cap de densidad usa ventana de 8 beats BPM-aware (no segundos fijos).
- **PredictMeter formula** (`src/Steps.cpp:235`):
  ```
  pMeter = 0.775 + 10.1·Stream + 5.27·Voltage − 0.905·Air − 1.10·Freeze
         + 2.86·Chaos + DifficultyCoeff − 6.35·(Stream·Voltage) − 2.58·Chaos²
  DifficultyCoeff = {-0.877, -0.877, 0, 0.722, 0.722, 0}  // Beg, Easy, Med, Hard, Ch, Edit
  ```
  Validación de nuestros caps: Beginner ≈ meter 2 ✓, Easy ≈ 3-4 ✓, Medium ≈ 5-6 ✓, Hard ≈ 9 ✓, Challenge ≈ 13-14 ✓.

### Clone Hero — Guitar Hero
Clone Hero es propietario; el repo `clonehero-game/releases` es solo un readme administrativo (sin código). Las constantes canónicas se extraen de proyectos de la comunidad CH:

**`scan-chart` de Geomitron** (https://github.com/Geomitron/scan-chart) — herramienta oficial de la comunidad CH para validar charts.
- **HOPO threshold default `.chart`** (`src/chart/natural-hopo.ts`):
  ```ts
  return Math.floor(format === 'mid' ? 1 + resolution / 3 : (65 / 192) * resolution)
  ```
  Para `.chart` con resolución 192 → **65 ticks** (≈ 1/3 de un beat ≈ tresillo de corcheas). El input de `gh-play.html` ahora usa este default. Para `.mid` el default sería `floor(1 + 192/3) = 65` también.
  Si el `song.ini` define `hopo_frequency` o `eighthnote_hopo`, esos sobrescriben.
- **Reglas canónicas de natural HOPO** (`isNaturalHopo` en `natural-hopo.ts`):
  1. Sin nota previa → no HOPO.
  2. Gap > threshold → strum.
  3. Es chord → strum.
  4. Anterior single + current = mismo fret single → strum.
  5. Solo `.mid`: anterior chord, current ⊆ chord → strum (back-compat con juegos viejos).
  6. Resto → natural HOPO.
  Mi `gh-play.html:annotateHopos()` implementa todas las reglas relevantes para `.chart` (1, 2, 3, 4 — la 5 no aplica a `.chart`).

**YARG.Core** (https://github.com/YARC-Official/YARG.Core) — engine open-source compatible con charts CH. Valores del preset oficial guitar (`YARG.Core/Game/Presets/EnginePreset.Instruments.cs`, `FiveFretGuitarPreset`):
- `HopoLeniency = 0.08s` (80 ms — gracia temporal para HOPOs).
- `StrumLeniency = 0.05s` (50 ms — gracia para strums).
- `StrumLeniencySmall = 0.025s` (25 ms).
- `MaxWindow = MinWindow = 0.14s` (140 ms — hit window total, ratio simétrico 1.0 → ±70 ms).
- `AntiGhosting = true`.

Mis timing windows en `gh-play.html` (`Perfect 45ms · Good 90ms · Bad 135ms`) son más estrictas que YARG (CH no usa Perfect/Good/Bad; usa una sola hitbox). Mi 135 ms cae dentro del 140 ms de YARG, así que sigue siendo razonable. **Pendiente futuro:** considerar simplificar a hitbox único de ±70 ms para ser más fiel a CH/YARG, sacrificando los grades intermedios.

**YARG (cliente Unity, https://github.com/YARC-Official/YARG)** — solo UI/Unity. Toda la lógica de timing/dificultad vive en YARG.Core. Para nuestros propósitos no aporta más que los valores ya extraídos de Core.

### Sobre cadencias automáticas por dificultad
**Importante:** ni Clone Hero, ni YARG, ni Moonscraper auto-generan charts por dificultad — todas las dificultades en CH/YARG son creadas a mano por charters humanos. **No existe "cadencia oficial CH" para Easy/Medium/Hard/Expert** porque la decisión es 100% humana.

Por tanto la calibración de `difficulty-tiers.js` para GH se basa en:
1. **Análisis estadístico** de charts oficiales de GH 1/2/3 (NPS típicos por tier reportados por la comunidad).
2. **Guías comunitarias `diff_guitar` 0-6** (charters: Easy = "incredibly easy and simple, almost no alt-strumming, very simple chord usage").
3. **Validación cruzada** con StepMania 5 PredictMeter (que sí es oficial y comparte el modelo conceptual de "Stream densidad").

Esto es lo más fiel posible sin código fuente del original. Si en el futuro Geomitron publica métricas estadísticas de su scan-chart sobre el corpus CH, valdría la pena re-calibrar.

## Cómo usar

Doble click sobre los `.html` los abre en el navegador por defecto. Hay dos modos de entrada:

- **Web pública / SEO:** `index.html` (landing) → CTAs apuntan al shell SPA (`app.html#/stepmania-play`, `#/autostepper`, `#/test-pad`). Es lo que ven crawlers y compartidores; el subdominio raíz `play.movimientofuncional.app/` sirve esto.
- **App instalada (PWA):** el manifest abre `app.html#/play` (dashboard). Desde ahí el usuario navega al motor o cualquier herramienta vía las cards. El shell SPA envuelve los 9 HTMLs clásicos vía iframe + hash routing — cero refactor del motor de juego.

Puntos de entrada sin shell (debug, link directo, lo que la PWA no usa por defecto):
- `play.html` → dashboard con 8 cards (StepMania / Guitar Hero / Comunes).
- `stepmania-play.html` → motor DDR directo (con hash `#library` para abrir biblioteca).
- `gh-play.html` → simulador Guitar Hero (con hash `#library`).
- `autostepper.html` / `gh-autostepper.html` → generadores standalone.
- `test-pad.html` → diagnóstico hardware (alfombra y guitarra).
- `tutorial.html` → tutorial completo.
- `calibration.html` → redirect a `test-pad.html#alfombra-sync` (calibración de audio fusionada como tab del test-pad).

Para los Python: `python test_pad.py` desde PowerShell. Requiere Python 3.x estándar (sin paquetes adicionales).

Para tests automatizados: `pnpm install` (instala Vitest, una sola dep) → `pnpm test` (corre suite, ~430ms). Ver sección "Tests" más abajo.

### `app.html` — shell SPA

Topbar persistente con marca Sincro + nav de 7 rutas visibles (**Inicio** dashboard, **🦶 Bailar** motor DDR, **🎸 Tocar** motor GH, **🪄 Crear DDR**, **🎼 Crear GH**, **🛠️ Equipo**, **ℹ️ Sincro** landing). Hay dos rutas adicionales NO promocionadas en el topbar (entran solo desde las cards del dashboard): `/tutorial`, `/calibration`. El router resuelve **9 rutas totales**: `/play` (dashboard) · `/stepmania-play` · `/gh-play` · `/autostepper` · `/gh-autostepper` · `/test-pad` · `/tutorial` · `/calibration` · `/about`. Un único `<iframe name="sincro-shell-frame">` carga la vista activa. El router escucha `hashchange` y solo cambia `iframe.src` cuando cambia la ruta — no recarga la página activa al hacer click sobre la ruta ya activa.

`allow="gamepad fullscreen autoplay midi microphone clipboard-write"` desbloquea las features delegadas al iframe. La Gamepad API funciona en iframe same-origin sin permisos extra. Web Audio + fullscreen requieren gesto de usuario originado en el iframe — los handlers de cada juego ya cumplen esto (botón "Iniciar" antes de empezar).

Los HTMLs internos detectan `window.name === 'sincro-shell-frame'` (vía `pwa-bootstrap.js`) y aplican `<html class="in-shell">`. El bootstrap inyecta CSS que oculta los topbars internos (`#topbar` de play.html, `#sat-topbar` de gh-play/autostepper/gh-autostepper/test-pad, `header.topbar` de la landing) — sin tocar los HTMLs.

Botón "Instalar app" en el shell: aparece cuando el navegador captura `beforeinstallprompt` (Chrome/Edge desktop+Android). En iOS se instala vía "Añadir a pantalla de inicio" del menú compartir (no usa el mismo evento).

**Bloqueo en dispositivos no compatibles (2026-05-12):** dos `<script>` inline al final del body. El primero ejecuta inmediatamente (antes del IIFE del router) y evalúa `isCompatibleDevice()` = viewport ≥ 1024×600 + `pointer: fine`. Si NO compatible: (1) añade clase `shell-blocked` al body que oculta `.shell-main` y atenúa `.shell-nav` / `.shell-actions` con `visibility:hidden`; (2) muestra el modal `#reqModal` con la misma copia que `index.html` (link "Ver detalles en FAQ" → `index.html#faq`, link "Ir a la web" → `index.html`); (3) setea `window.__sincroShellBlocked = true`. El IIFE del router consulta ese flag al inicio y aborta con `return` antes de tocar el iframe, evitando carga innecesaria del motor. **Sin bypass**: el usuario solo puede volver a la landing — no hay forma de "continuar de todos modos" porque el shell entero está oculto. Esto cubre el caso de entrar directo a `app.html#/play` desde un bookmark, un shortcut PWA o la URL escrita a mano, sin pasar por la landing.

### PWA — manifest, service worker, iconos

- **`manifest.webmanifest`** — `start_url: /app.html#/play`, `id: /app.html`, `display: standalone` con `display_override: window-controls-overlay`, `theme_color: #00bec8`, `background_color: #0f172a`, 4 shortcuts (Jugar / GH / AutoStepper / Test pad) cada uno apuntando a su ruta del shell.
- **`sw.js`** (raíz, scope `/`) — estrategia mixta:
  - `install`: precache del shell estático (HTMLs + CSS + JS modules + iconos + manifest). El listado vive en `PRECACHE_URLS` al inicio del fichero. Tras la separación de archivos (2026-05-11) y la consolidación de la calibración (2026-05-12), precache cubre `play.html` + `stepmania-play.html` + `tutorial.html` + `calibration.html` (redirect) + los demás HTMLs, pero **NO** incluye `calibration.js` (eliminado).
  - `fetch HTML navigation`: network-first con fallback a precache. Un deploy nuevo se nota sin "vaciar caché". Si offline y nada cacheado, el fallback es **inteligente por ruta** (`sw.js:106-130`): rutas del shell SPA (`/`, `/app*`, `/play*`, `/stepmania-play*`, `/gh-*`, `/autostepper*`, `/test-pad*`, `/tutorial*`, `/calibration*`) caen a `/app.html` para no perder el contexto de la PWA; cualquier otra URL navegacional cae a `/index.html` (la landing pública).
  - `fetch CSS/JS/iconos same-origin`: cache-first con runtime fallback. Shell offline-ready.
  - `fetch Google Fonts`: stale-while-revalidate.
  - **Range requests passthrough** (`req.headers.has('range')`): el motor de audio carga segmentos, cachear esto los rompería.
  - **Cross-origin no same-origin passthrough**: no cacheamos blobs de audio ad-hoc; viven en IndexedDB de todas formas.
  - `CACHE_VERSION = 'sincro-v25'` (al 2026-05-12; bumpeado tras un primer deploy en v24 que rompía todos los tags UTF-16 con replacement char `�` al final por strip pre-decode incorrecto — ver detalle en la sección de `audio-metadata.js`). **Bumpear cada vez que cambien archivos del precache** para que los clientes detecten la nueva versión y purguen la antigua en `activate`. Sin bump, los clientes con SW antiguo siguen sirviendo desde caché y los fixes nunca llegan al usuario.
- **`stepmania-web/js/pwa-bootstrap.js`** — registra el SW (solo https/localhost; file:// no soporta SW), expone `window.SincroPWA.{inShell, isInstalled, canInstall, promptInstall}`, captura `beforeinstallprompt` y dispara eventos custom `sincro-pwa-installable` / `sincro-pwa-installed` / `sincro-pwa-update-available`.
- **`icons/icon.svg` + `icons/icon-maskable.svg`** — flechas DDR sobre gradiente turquesa→dorado de la marca. Maskable lleva 10% de padding interno (safe-zone) para que Android no recorte al aplicar el shape. Chrome moderno y iOS 16+ aceptan SVG en manifest.

Cada HTML clásico (`index.html`, `play.html`, `gh-play.html`, `autostepper.html`, `gh-autostepper.html`, `test-pad.html`) inyecta en su `<head>`: `<link rel="manifest">`, `<meta name="theme-color">`, `<link rel="icon" type="image/svg+xml">`, `<link rel="apple-touch-icon">`, `<script src="/stepmania-web/js/pwa-bootstrap.js" defer>`. Esto asegura que cualquier ruta directa siga siendo instalable como PWA, no solo el shell.

## Estado de StepMania 5

- **Instalado en:** `C:\Games\StepMania 5`
- **Configuración:** `C:\Users\HP\AppData\Roaming\StepMania 5\Save\`
  - `Keymaps.ini`: alfombra mapeada a Joy1 (Up=B1, Down=B2, Left=B3, Right=B4)
  - `Preferences.ini`: `LastSeenInputDevices=...|RedOctane USB Pad|...`, `AutoMapOnJoyChange=1`
- **Carpeta de canciones:** `C:\Games\StepMania 5\Songs\` (los ZIPs del autostepper se descomprimen aquí)

## Despliegue

- **Dominio destino:** `play.movimientofuncional.app` (subdominio del sitio principal de Movimiento Funcional). El antiguo subdominio `stepmania.movimientofuncional.app` fue retirado tras el rebrand a Sincro.
- **Credenciales FTP del host:** en `.env.local` (raíz del proyecto). **Nunca commitear** — el archivo está ignorado por `.gitignore` (regla `.env.*`).
- Para futuros agentes: si necesitas las claves de despliegue, léelas de `.env.local`. No las muevas a archivos versionados.
- **Estructura desplegada:** todos los `.html` de la raíz (`index.html`, `app.html`, `play.html`, `stepmania-play.html`, `gh-play.html`, `autostepper.html`, `gh-autostepper.html`, `test-pad.html`, `tutorial.html`, `calibration.html`), `manifest.webmanifest`, `sw.js`, las 5 imágenes `.webp` de raíz (`hero-clean.webp`, `hero-clean-movil.webp`, `play-hero.webp`, `play-hero-movil.webp`, `elena-cruces.webp`), `icons/` (2 SVG) y la carpeta `stepmania-web/` (CSS + 15 JS, contando el nuevo `audio-metadata.js` y sin el difunto `autostepper.js` borrado el 2026-05-12). Los `.py`, los `.png` de 7 MB (fuentes originales antes de la conversión a `.webp`), docs `.md` y configs locales NO se despliegan.
- **Script de deploy:** `scripts/deploy.sh` (bash + curl, cero deps). Lee credenciales de `.env.local` y sube **todos los archivos versionados en git** excepto los que matchean `EXCLUDE_REGEX` (docs `.md`, `LICENSE`, configs de dev como `package.json` / `pnpm-lock.yaml` / `vitest.config.mjs`, `.gitignore`, scripts `*.py`, fuentes `*.png`, y dirs no-prod: `scripts/`, `tests/`, `design-system/`, `stepmania-5_1-new/`, `.claude/`, `.husky/`, `node_modules/`). Al 2026-05-11 son 35 archivos. **Ventaja clave:** añadir un nuevo asset (HTML, imagen, módulo JS) sólo requiere `git add` + commit — el deploy lo recoge automáticamente. La fricción anti-leak ahora vive en el regex de exclusión: si añades un archivo nuevo cuyo path matchea un prefijo excluido (p.ej. dejas un `notas.md` en raíz, o `.py` en raíz), NO se sube. Uso: `bash scripts/deploy.sh` desde cualquier cwd (el script hace `cd "$(dirname "$0")/.."`). Usa `--ssl-allow-beast -k` en curl para sortear el SChannel-strict OCSP de Windows. Reporta `OK / FAIL / SKIP` por archivo y `X / Y subidos` al final. **Historial:** la versión anterior usaba lista de inclusión explícita con 29 archivos hardcodeados; rompía cada vez que se añadía un asset nuevo y no se actualizaba el script en el mismo commit — el rebrand al hero con imágenes `.webp` quedó incompleto en producción durante un deploy porque las imágenes no estaban en la lista.
- **Headers HTTP recomendados** (configurar en host):
  - `sw.js`: `Cache-Control: no-cache` (para que el navegador siempre revise si hay versión nueva del SW; el SW controla su propio cache versionado).
  - `manifest.webmanifest`: `Content-Type: application/manifest+json`.
  - `*.html`: `Cache-Control: no-cache` o ETags (la estrategia network-first del SW se encarga de servir actualizaciones, pero el primer request previo al SW también debe ser fresco).
  - `*.svg`, `*.css`, `*.js`: cache largo (1 año) si los versiona el SW; el `CACHE_VERSION` interno del SW controla la invalidación de clientes ya conectados.

## Tests

Suite de tests con **Vitest** que cubre los algoritmos puros del proyecto. Filosofía pragmática: testeamos lo que es matemáticamente verificable sin navegador, y validamos lo demás (render, Web Audio, Gamepad, IndexedDB, DOM) jugando manualmente. Pretender 100% de cobertura en este tipo de proyecto es trampa — la confianza real viene de jugar, no del coverage report.

### Setup
- **`package.json`** — scripts `pnpm test` (run-once), `pnpm test:watch`, `pnpm test:ui`. Stub de `typecheck`/`lint` (no-op) para que el husky pre-commit, si existe localmente, no falle. Una sola devDependency: `vitest`.
- **`vitest.config.mjs`** — environment `node` (no jsdom), busca `tests/**/*.test.mjs` y `tests/**/*.test.js`. Si en el futuro necesitas tests con DOM (overlay táctil, settings modal, IndexedDB), cambia environment a `'jsdom'` e instala `vitest-environment-jsdom`.
- **`tests/`** — un archivo por módulo. Tests son `.mjs` con `import` (Vitest 2.x es ESM-only y rechaza `require`).

### Doble export CJS en archivos source
Para que Vitest pueda `import` los módulos del navegador sin migrar todo a ESM, los archivos puros tienen un **guard CJS al final**:

- **`stepmania-web/js/parser.js:275-289`** — `if (typeof module !== 'undefined' && module.exports) module.exports = { parseSscOrSm, parseSscPairs, buildTimingEngine, parseAttacks, lanesFromStepType, parseNotesToEvents, quantColorFor };`. Cero impacto en navegador (donde `module` es undefined). Si añades una función pública nueva al parser, agrégala a este map.
- **`stepmania-web/js/difficulty-tiers.js:259-274`** — el IIFE termina con `if (typeof window !== 'undefined') window.DifficultyTiers = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;`. Soporta ambos entornos sin condicionales repetidos.

Desde un test, el patrón de import es: `import pkg from '../stepmania-web/js/parser.js'; const { parseSscOrSm } = pkg;` (ESM importa CJS exclusivamente como default).

### Cobertura actual (al 2026-05-10)
- **`tests/parser.test.mjs`** — 23 tests: parseo .ssc/.sm (incluye formato legacy 6-partes), múltiples charts, comentarios //, parseSscPairs (orden, NaN, espacios), buildTimingEngine (BPMs constantes/cambiantes/STOPS — verifica la convención clave de `parser.js:112` "el stop solo se aplica a beats POSTERIORES con `s.beat < beat` estricto"), lanesFromStepType, parseAttacks (TIME=...:LEN=...:MODS=...), quantColorFor.
- **`tests/difficulty-tiers.test.mjs`** — 23 tests: TIER_CONFIG (5 tiers SM, 4 tiers GH, monotonía de NPS y minGap), rhythmPriority (downbeat=5, mid-measure=4, beat=3, offbeat=2, semicorchea=1), filterByDifficulty con invariantes (NPS cap, gap mínimo, retención esperada por tier), filterPositions48 round-trip, filterTicks GH, PRESET_MULTIPLIER.
- **`tests/audio-metadata.test.mjs`** — 27 tests: parser ID3v2.3/v2.4 (TIT2/TPE1/TALB/TRCK/TYER en UTF-8 con tildes y emoji, multi-valor v2.4 separado por NUL, "5/12"→"5" en TRCK, guard de null sin title/artist/album), ID3v1 canónico y v1.1 con byte de track, FLAC Vorbis Comments (case-insensitive en keys), `parseFromFilename` con prefijos de track# en 4 formatos (`02 `, `12. `, `03 - `, `03_`) y splits "Artist - Title" / "Artist - Album - Title" / "Artist - Album - 03 - Title". Los fixtures binarios se generan en runtime con helpers locales (`makeID3v2`, `makeID3v1`, `makeFLAC`) — no se commitean .mp3 reales.

**Total: 96 tests (parser 23 + difficulty-tiers 23 + scores 23 + audio-metadata 27), ~420ms en CI.**

### Lo que NO se testea (decisión consciente)
- Render del canvas en `game.js` (visual regression manual).
- Service Worker `sw.js` (Workbox tiene su propia suite; nuestra lógica son 30 líneas de routing).
- Wrappers de IndexedDB en `core.js` (testearlos = testear IndexedDB del navegador).
- Gamepad polling, Web Audio playback, touch overlay, DOM transitions.

### Cómo extender
Cuando arregles un bug en algoritmo puro, primero añade el test que lo reproduce. Sin disciplina TDD — solo "el bug existió una vez, no debe volver". Para añadir cobertura a `audio-pipeline.js` necesitarás mockear `AudioBuffer` (Vitest soporta `vi.fn` y stubbing global). El siguiente candidato natural es la generación de notas en los autosteppers — algoritmo determinista con seed fija, ideal para tests de snapshot del output `.ssc`/`.chart`.

## Pendiente / ideas futuras

- Detección de tempo variable (BPM changes) en autostepper.
- Generación de banner/background art automática en autostepper. Bloqueado por CORS desde navegador — necesitaría proxy local o backend.
- Update mode: re-generar charts conservando BPM/offset que el usuario afinó a mano (leer .ssc existente, reusar `#BPMS`/`#OFFSET`).
- Modo couple/double y edit mode (no replicados desde StepMania nativo).
