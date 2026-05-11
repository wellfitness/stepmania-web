# Sincro — Suite rítmica de Movimiento Funcional

Suite de juego rítmico en navegador para alfombra de baile (RedOctane USB Pad VID 1430 / PID 8888 + cualquier mat genérico calibrable) y guitarra Guitar Hero (PS2 vía receptor USB Sony-emulado VID 054C/PID 0268, recalibrable). Marca paraguas: **Sincro** (la suite completa). Compatible con el formato de charts `.ssc/.sm` de StepMania 5 (instalado opcionalmente en `C:\Games\StepMania 5` para desarrollo).

## Archivos

### `index.html`
Landing pública del producto **Sincro**. HTML semántico autocontenido (CSS embedded, sin dependencias del motor de juego). Incluye:
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

### `play.html`
Motor de juego **StepMania (DDR)** — SPA con pantallas: Menú, Jugar, Crear, Probar hardware, Mis canciones, Calibración, Tutorial, Resultados. Carga módulos clásicos desde `stepmania-web/js/`: `core` → `parser` → `autostepper` → `library` → `backup` → `song-select` → `pad-test` → `calibration` → `game` → `app`. Estilos en `stepmania-web/css/styles.css`.

Funcionalidad end-to-end:
- Parser `.ssc/.sm` con BPMs/STOPS/DELAYS/WARPS, OFFSET, NOTES.
- Motor de timing real (J4–J7) con quantización a 192nds, mines, holds/rolls (HOLD_LIFE 300ms), lifts, fakes, hands.
- 6 modifiers: mirror, left, right, shuffle, hidden, sudden + chartSpeed local (0.5–4x) y scrollSpeed global (0.5–3x).
- Librería en IndexedDB con import individual (.ssc/.sm + audio), import packs SM (carpetas), backup ZIP completo (canciones + scores + ajustes), restore. Los handlers de import en `library.js:90-220` distinguen `QuotaExceededError` del resto: cuando IndexedDB se queda sin cuota (Safari iOS ~50MB hard cap, Android con storage bajo), se PARA el bucle de import (los siguientes también fallarán), se consulta `navigator.storage.estimate()` y se muestra mensaje accionable con el `usedMB` real ("Almacenamiento lleno tras importar X canciones. Tu navegador limita la librería a Y MB. Elimina canciones antiguas o haz un backup ZIP antes de seguir.").
- **Política unificada de carriles:** todos los charts nuevos generados por el autostepper (tanto el integrado como el standalone) son `dance-double` (8 carriles, master único). El motor decide en runtime cómo jugarlos vía `getActiveLaneConfig` en `game.js`: **default = 4 carriles (clásico)**, mod Solo = 6, mod Full = 8. El bloque de redistribución (`game.js:279-303`) hace el remap simétrico (8→4, 8→6, o el caso legacy 4→6/4→8 sobre charts antiguos). Los charts antiguos en biblioteca con `dance-single` o `dance-solo` siguen funcionando — su `nativeLanes` original se respeta como punto de partida del remap. Mods Solo y Full mutuamente excluyentes (`song-select.js:237-238`).
- Input: alfombra USB (con calibración por roles vía `mat-mapping` en localStorage), teclado (← ↓ ↑ →) y **overlay táctil de 4 zonas en móvil** (`game.js:459-558`). El overlay aparece solo cuando el dispositivo expone touch (`'ontouchstart' in window || maxTouchPoints > 0`) y el chart se juega en modo default 4-lane. Mods Solo/Full no tienen mapeo táctil natural; en esos casos se loggea aviso en consola y el usuario debe usar teclado/alfombra. Implementado con Pointer Events (`pointerdown`/`pointerup`/`pointercancel`/`pointerleave`) + `touch-action:none` para evitar que el navegador robe gestos como scroll/zoom. El soporte de guitarra Guitar Hero vive en `gh-play.html` aparte (no se mezcla aquí — game style fundamentalmente distinto, requiere strum + chord + HOPO).
- Settings persistentes (localStorage): globalOffset, scrollSpeed, timingWindow, NoteSkin PNG personalizado, fondo procedural por título.
- Calibración: pantalla con metrónomo + tap para medir offset real con sugerencia automática.
- **Robustez de ciclo de vida (`game.js:269-417`):** `startGame()` captura `currentNavToken()` al inicio y verifica `isCurrentNav(myToken)` después de cada `await` (resume audio, arrayBuffer, decodeAudioData, runCountdown). Si el usuario navega fuera durante esos ~3s, la promesa se aborta limpiamente sin crear `gameState` huérfano. Toda la cadena async va envuelta en `try/catch` que muestra `alert()` específico para `EncodingError` (audio no decodificable — típico de OGG en iOS Safari) y devuelve a la pantalla `diff`. `stopGame()` anula `src.onended = null` antes de `src.stop()` para evitar que el `setTimeout(endGame)` huérfano se dispare 500ms después con `gameState` ya nulo.

### `stepmania-web/js/core.js`
Módulo base compartido entre todas las pantallas SPA del motor SM. Carga primero (orden de scripts en `play.html`). Expone en scope global:

- **`escapeHtml`, `formatTime`, `safeFn`, `getExt`, `yieldUI`** — helpers triviales.
- **`ensureAudioCtx()`** — crea/devuelve un `AudioContext` singleton. Síncrono, NO hace `resume()`. Para callers que solo necesitan `decodeAudioData` (funciona en estado `'suspended'`).
- **`ensureAudioCtxRunning()` async** — variante que SÍ hace `resume()` y se debe usar en cualquier call-site que vaya a reproducir audio audible. Centralizar el resume aquí evita el pitfall de iOS Safari + Chrome Android (autoplay policy crea el contexto en `'suspended'` hasta el primer gesto, y `start()` en suspended falla en silencio).
- **`pollGamepad()` (loop rAF eterno)** — polling de `navigator.getGamepads()` a 60 fps, ACTUALIZA `gamepadButtonState[20]` y `gamepadJustPressed[20]` (consumidos por `game.js`, `pad-test.js`, `gh-play.html`). Mejoras críticas (`core.js:25-90`):
  - **Pausa automática en `visibilitychange === 'hidden'`** para no quemar batería en background. Se rearranca solo al volver a `visible`.
  - **Cachéo lazy de `#padPill`** con sentinel `false` (vs `null` que ya significa "no inicializado"). Si la página no tiene `#padPill` (futuras páginas satellite), el polling sigue funcionando con optional chaining.
  - **`try/catch` envolviendo todo el cuerpo** para que una excepción transitoria (DOM no listo, gamepad desconectado mid-frame) NO mate el loop entero — antes una sola excepción dejaba al usuario sin input para el resto de la sesión.
- **`openDB`, `dbAdd`, `dbAll`, `dbGet`, `dbDelete`, `dbPut`, `dbScore*`** — wrappers Promise sobre IndexedDB (DB `StepManiaWebDB` v3 con stores `songs`, `scores`, `gh-songs`).
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

**Política unificada 8-lane:** todos los charts se generan como `dance-double` (8 carriles: cardinales + 4 diagonales) — master único por canción. La elección de modo (4/6/8) es decisión de runtime en Sincro Play, no de autoría. En StepMania nativo, los charts aparecen bajo el modo *Doubles* (requiere dos alfombras o remapeo). El integrado en `play.html` (vía `stepmania-web/js/autostepper.js`) y el standalone `autostepper.html` comparten esta política — cero divergencia entre ambos.

**Pipeline de detección compartida** — vive en `stepmania-web/js/audio-pipeline.js`, expuesta como `window.AudioPipeline.{decodeFile, toMono, bassEmphasize, computeEnergyEnvelope, computeODF, pickPeaks, detectBPM, detectOffset, ensureAudioContext, audioBufferToWav}`. La usan tanto `autostepper.html` (output `.ssc/.sm`) como `gh-autostepper.html` (output `.chart`). El análisis es agnóstico al juego — solo cambia cómo se traduce el resultado a notas.

**Cap de duración (Completa / 90s / 120s / 180s)** — selector en el paso "Estilo" de ambos autosteppers SM (integrado en `play.html` y standalone `autostepper.html`). Cuando se elige un cap menor que la duración de la canción:
- Filtra los onsets a `t < effectiveDuration` (no se generan pasos en sección recortada).
- Recalcula `totalUnits`, `sampleStart`, `estimateMeter`, `calculateRadarValues` con `effectiveDuration` en lugar de `buffer.duration`.
- Llama a `AudioPipeline.audioBufferToWav(buffer, effectiveDuration, 1.5)` para producir un WAV PCM 16-bit recortado con fade-out lineal de 1.5s (evita clicks de truncación).
- Guarda el blob en `q.result.croppedAudio` y nombre en `q.result.croppedAudioName` (extensión `.wav`).
- `saveAllToLibrary`, `downloadAllZip`, `buildSscForSong` y `buildSmForSong` consumen `croppedAudio || q.file` y `croppedAudioName || q.file.name` con la misma lógica — coherencia del `#MUSIC` field con el archivo realmente empaquetado.
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

API expuesta: `window.DifficultyTiers.{filterByDifficulty(onsetsSec, bpm, offsetSec, gameType, difficultyKey, presetMul), filterPositions48(...), filterTicks(...)}`. Los autosteppers SM (HTML + integrado en `stepmania-web/js/autostepper.js` para play.html) usan `filterPositions48`; el GH usa `filterTicks` con `CHART_RESOLUTION=192`.

Implementa encoder ZIP propio (modo "store", sin compresión) — sin dependencias externas.

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

- **Web pública / SEO:** `index.html` (landing) → CTAs apuntan al shell SPA (`app.html#/play`, `#/autostepper`, `#/test-pad`). Es lo que ven crawlers y compartidores; el subdominio raíz `play.movimientofuncional.app/` sirve esto.
- **App instalada (PWA):** el manifest abre `app.html#/play` (DDR directo). El shell SPA envuelve los 6 HTMLs clásicos vía iframe + hash routing — cero refactor del motor de juego.

Punto de entrada para jugar sin shell (debug, link directo, lo que la PWA no usa por defecto): `play.html`.

Para los Python: `python test_pad.py` desde PowerShell. Requiere Python 3.x estándar (sin paquetes adicionales).

Para tests automatizados: `pnpm install` (instala Vitest, una sola dep) → `pnpm test` (corre suite, ~430ms). Ver sección "Tests" más abajo.

### `app.html` — shell SPA

Topbar persistente con marca Sincro + nav de 6 rutas (DDR · GH · Crear DDR · Crear GH · Equipo · Sincro/landing). Un único `<iframe name="sincro-shell-frame">` carga la vista activa. El router escucha `hashchange` y solo cambia `iframe.src` cuando cambia la ruta — no recarga la página activa al hacer click sobre la ruta ya activa.

`allow="gamepad fullscreen autoplay midi microphone clipboard-write"` desbloquea las features delegadas al iframe. La Gamepad API funciona en iframe same-origin sin permisos extra. Web Audio + fullscreen requieren gesto de usuario originado en el iframe — los handlers de cada juego ya cumplen esto (botón "Iniciar" antes de empezar).

Los HTMLs internos detectan `window.name === 'sincro-shell-frame'` (vía `pwa-bootstrap.js`) y aplican `<html class="in-shell">`. El bootstrap inyecta CSS que oculta los topbars internos (`#topbar` de play.html, `#sat-topbar` de gh-play/autostepper/gh-autostepper/test-pad, `header.topbar` de la landing) — sin tocar los HTMLs.

Botón "Instalar app" en el shell: aparece cuando el navegador captura `beforeinstallprompt` (Chrome/Edge desktop+Android). En iOS se instala vía "Añadir a pantalla de inicio" del menú compartir (no usa el mismo evento).

### PWA — manifest, service worker, iconos

- **`manifest.webmanifest`** — `start_url: /app.html#/play`, `id: /app.html`, `display: standalone` con `display_override: window-controls-overlay`, `theme_color: #00bec8`, `background_color: #0f172a`, 4 shortcuts (Jugar / GH / AutoStepper / Test pad) cada uno apuntando a su ruta del shell.
- **`sw.js`** (raíz, scope `/`) — estrategia mixta:
  - `install`: precache del shell estático (HTMLs + CSS + JS modules + iconos + manifest). El listado vive en `PRECACHE_URLS` al inicio del fichero.
  - `fetch HTML navigation`: network-first con fallback a precache. Un deploy nuevo se nota sin "vaciar caché". Si offline y nada cacheado, el fallback es **inteligente por ruta** (`sw.js:106-128`): rutas del shell SPA (`/`, `/app*`, `/play*`, `/gh-*`, `/autostepper*`, `/test-pad*`) caen a `/app.html` para no perder el contexto de la PWA; cualquier otra URL navegacional cae a `/index.html` (la landing pública).
  - `fetch CSS/JS/iconos same-origin`: cache-first con runtime fallback. Shell offline-ready.
  - `fetch Google Fonts`: stale-while-revalidate.
  - **Range requests passthrough** (`req.headers.has('range')`): el motor de audio carga segmentos, cachear esto los rompería.
  - **Cross-origin no same-origin passthrough**: no cacheamos blobs de audio ad-hoc; viven en IndexedDB de todas formas.
  - `CACHE_VERSION = 'sincro-v3'` (al 2026-05-10). **Bumpear cada vez que cambien archivos del precache** para que los clientes detecten la nueva versión y purguen la antigua en `activate`. Sin bump, los clientes con SW antiguo siguen sirviendo desde caché y los fixes nunca llegan al usuario.
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
- **Estructura desplegada:** subir todos los `.html` de la raíz (incluido `app.html`), `manifest.webmanifest`, `sw.js`, `icons/`, carpeta `stepmania-web/` (CSS + JS). Los `.py` no se despliegan (solo herramientas locales).
- **Script de deploy:** `scripts/deploy.sh` (bash + curl, cero deps). Lee credenciales de `.env.local`, sube **26 archivos** con lista de inclusión EXPLÍCITA (intencional — evita filtrar README/CLAUDE/tests/package.json a producción si mañana añades algo a la raíz). Uso: `bash scripts/deploy.sh` desde la raíz del repo. El script hace `cd "$(dirname "$0")/.."` al inicio, así también funciona invocado desde otro cwd. Usa `--ssl-allow-beast -k` en curl para sortear el SChannel-strict OCSP de Windows. Falla con SKIP claro si un archivo de la lista no existe en local (cazaría typos como "indez.html").
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

**Total: 46 tests, ~430ms en CI.**

### Lo que NO se testea (decisión consciente)
- Render del canvas en `game.js` (visual regression manual).
- Service Worker `sw.js` (Workbox tiene su propia suite; nuestra lógica son 30 líneas de routing).
- Wrappers de IndexedDB en `core.js` (testearlos = testear IndexedDB del navegador).
- Gamepad polling, Web Audio playback, touch overlay, DOM transitions.

### Cómo extender
Cuando arregles un bug en algoritmo puro, primero añade el test que lo reproduce. Sin disciplina TDD — solo "el bug existió una vez, no debe volver". Para añadir cobertura a `audio-pipeline.js` o `autostepper.js` necesitarás mockear `AudioBuffer` (Vitest soporta `vi.fn` y stubbing global). El siguiente candidato natural es `autostepper.js` — algoritmo determinista con seed fija, ideal para tests de snapshot del output `.ssc`.

## Pendiente / ideas futuras

- Detección de tempo variable (BPM changes) en autostepper.
- Generación de banner/background art automática en autostepper. Bloqueado por CORS desde navegador — necesitaría proxy local o backend.
- Update mode: re-generar charts conservando BPM/offset que el usuario afinó a mano (leer .ssc existente, reusar `#BPMS`/`#OFFSET`).
- Modo couple/double y edit mode (no replicados desde StepMania nativo).
