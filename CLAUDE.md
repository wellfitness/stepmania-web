# C:\software — Herramientas StepMania

Suite de utilidades para una alfombra de baile (RedOctane USB Pad, VID 1430 / PID 8888) usada con StepMania 5 instalado en `C:\Games\StepMania 5`.

## Archivos

### `test-pad.html`
Diagnóstico de hardware en el navegador (Gamepad API). Selector inicial **Alfombra | Guitarra**.

**Modo Alfombra (8 pestañas):**
- **Estadísticas**: pisadas por panel, duración media de cada press, polling rate.
- **Latencia**: test de reflejos por panel (panel aleatorio → mide ms hasta pisar). Cubre las 4 cardinales + 4 diagonales (modos solo/full).
- **Saltos**: combos simultáneos (Izq+Der, Arriba+Abajo, UP-LEFT+UP-RIGHT, DOWN-LEFT+DOWN-RIGHT, etc.). Auto-skip a los 5s si tu pad no tiene esos paneles.
- **Sync de audio**: metrónomo configurable BPM 60-180. Mide offset del usuario y sugiere `Global Offset` para `Preferences.ini`.
- **Stress test**: 10s de pisadas rápidas. Detecta bouncing si intervalo mínimo &lt; 15ms.
- **Ghost inputs**: monitorea 60s sin pisar — si aparece input, hay sensor pegado.
- **Secuencia**: histórico de últimas 50 pisadas con timestamp.
- **Ejes**: lectura cruda de los axes del gamepad.

**Modo Guitarra (11 pestañas):**
- **Calibrar**: asistente paso a paso para mapear los botones físicos (5 trastes, strum ↑/↓, tilt, Star Power, Select, Start). El mapping se persiste en `localStorage` con key `guitar-mapping`.
- **Estadísticas**: pulsos por traste/strum + duración + polling rate.
- **Trastes (latencia)**: 10 rondas de reflejos por traste. Detecta trastes lentos.
- **Strum**: 15s alternando ↑↓. Mide ratio up:down (debería ser ~1.0) e intervalo mínimo (bouncing).
- **Whammy**: 15s moviendo la palanca. Mide rango analógico, deadzone y resolución del potenciómetro.
- **Chords**: combinaciones simultáneas de trastes (G+R, R+Y, power chord G+R+Y+B, fret+strum…). Detecta ghosting de matriz.
- **Sync, Stress, Ghost, Secuencia, Ejes**: compartidas con modo alfombra.

**Mapping físico alfombra via Gamepad API** (alineado con `padMap` de `game.js`):
- `button[0]` = IZQUIERDA · `button[1]` = ABAJO · `button[2]` = ARRIBA · `button[3]` = DERECHA
- `button[4]` = UP-LEFT · `button[5]` = UP-RIGHT · `button[6]` = DOWN-LEFT · `button[7]` = DOWN-RIGHT
- `button[8]` = START · `button[9]` = BACK

**Mapping físico guitarra Guitar Hero PS2 via receptor Sony-emulado (VID 054C/PID 0268)** — default; recalibrable:
- `button[0..4]` = trastes Verde/Rojo/Amarillo/Azul/Naranja
- `button[6]` = strum ↓ · `button[7]` = strum ↑
- `button[8]` = Select · `button[9]` = Start
- `axes[2]` (eje Z) = palanca de whammy
- Tilt y Star Power dependen del modelo — calibrar.

### `autostepper.html`
Generador automático de charts StepMania desde MP3/WAV. Equivalente al `phr00t/AutoStepper` (Java) pero en navegador.

**Pipeline de detección (optimizado para música bailable: techno, dance, pop, rock):**
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

Implementa encoder ZIP propio (modo "store", sin compresión) — sin dependencias externas.

### Scripts Python (`test_pad*.py`, `detectar-guitarra.py`)
Tests vía WinMM `joyGetPosEx` (DirectInput equivalent). Útiles si la Gamepad API del navegador no detecta el dispositivo. Usan solo `ctypes`, sin pygame.

- `test_pad.py`: detección + 20s de input por consola (con nombres de paneles).
- `test_pad_raw.py`: 20s mostrando estado crudo (botones, ejes X/Y/Z, POV).
- `test_pad_all.py`: secuencia 30s para verificar los 6 paneles principales.
- `detectar-guitarra.py`: enumera los 16 slots de joystick de Windows con VID/PID/nombre/nº de botones, identifica heurísticamente cuál es guitarra (8-13 botones + eje Z) y monitoriza inputs durante 30s. Útil para confirmar que el receptor PS2→USB está visible al sistema antes de calibrar en el navegador.

Mapping físico alfombra via WinMM (distinto al del navegador):
- B1=ARRIBA, B2=ABAJO, B3=IZQUIERDA, B4=DERECHA, B7=UP-LEFT, B8=UP-RIGHT, B9=START, B10=BACK

## Cómo usar

Doble click sobre los `.html` los abre en el navegador por defecto.

Para los Python: `python test_pad.py` desde PowerShell. Requiere Python 3.x estándar (sin paquetes adicionales).

## Estado de StepMania 5

- **Instalado en:** `C:\Games\StepMania 5`
- **Configuración:** `C:\Users\HP\AppData\Roaming\StepMania 5\Save\`
  - `Keymaps.ini`: alfombra mapeada a Joy1 (Up=B1, Down=B2, Left=B3, Right=B4)
  - `Preferences.ini`: `LastSeenInputDevices=...|RedOctane USB Pad|...`, `AutoMapOnJoyChange=1`
- **Carpeta de canciones:** `C:\Games\StepMania 5\Songs\` (los ZIPs del autostepper se descomprimen aquí)

## Despliegue

- **Dominio destino:** `stepmania.movimientofuncional.app` (subdominio del sitio principal de Movimiento Funcional).
- **Credenciales del host:** en `.env.local` (raíz del proyecto). **Nunca commitear** — el archivo está ignorado por `.gitignore` (regla `.env.*`).
- Para futuros agentes: si necesitas las claves de despliegue, léelas de `.env.local`. No las muevas a archivos versionados.

## Pendiente / ideas futuras

- **StepMania Web**: clon del juego en navegador (HTML/JS puro). Factible: la licencia de StepMania es MIT, las APIs necesarias (Gamepad, Web Audio, Canvas) están todas disponibles. MVP = parser .ssc + render de flechas + timing windows + pad input. Lo que NO replicaríamos: motor Lua de temas, mods visuales avanzados, modo couple/double, edit mode.
- Detección de tempo variable (BPM changes) en autostepper.
- Generación de banner/background art automática en autostepper. Bloqueado por CORS desde navegador — necesitaría proxy local o backend.
- Update mode: re-generar charts conservando BPM/offset que el usuario afinó a mano (leer .ssc existente, reusar `#BPMS`/`#OFFSET`).
