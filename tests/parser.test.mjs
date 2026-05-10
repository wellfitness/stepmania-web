// Tests del parser SSC/SM — el parser es el corazón del motor: si lee mal
// un chart, todo lo demás truena. Cubrimos los formatos .ssc (moderno con
// #NOTEDATA;) y .sm (legacy con NOTES de 6-partes), más el timing engine
// (BPMs, STOPS, beat→time).
//
// Fixtures inline para no depender de archivos externos. Si necesitas un
// chart "real", añade tests/fixtures/<nombre>.ssc y léelo con readFileSync.

// ESM importa CJS via default-export. parser.js usa module.exports = {...}
// (guard al final del archivo); en ESM eso aparece como `default`.
import { describe, it, expect } from 'vitest';
import parser from '../stepmania-web/js/parser.js';
const {
  parseSscOrSm,
  parseSscPairs,
  buildTimingEngine,
  lanesFromStepType,
  parseAttacks,
  quantColorFor,
} = parser;

describe('parseSscOrSm', () => {
  it('parsea header básico .ssc con tags clave', () => {
    const ssc = `
#TITLE:Demo Song;
#ARTIST:Test Artist;
#OFFSET:-0.123;
#BPMS:0=120;
#NOTEDATA:;
#STEPSTYPE:dance-single;
#DIFFICULTY:Easy;
#METER:3;
#NOTES:
0000
0000
0000
1000
;
`;
    const { header, charts } = parseSscOrSm(ssc);
    expect(header.TITLE).toBe('Demo Song');
    expect(header.ARTIST).toBe('Test Artist');
    expect(header.OFFSET).toBe('-0.123');
    expect(header.BPMS).toBe('0=120');
    expect(charts).toHaveLength(1);
    expect(charts[0].DIFFICULTY).toBe('Easy');
    expect(charts[0].METER).toBe('3');
    expect(charts[0].STEPSTYPE).toBe('dance-single');
    // El cuerpo de NOTES retiene las filas — verifica que llega entera la última nota.
    expect(charts[0].NOTES).toContain('1000');
  });

  it('parsea formato legacy .sm con NOTES de 6 partes', () => {
    const sm = `
#TITLE:Legacy Song;
#BPMS:0=140;
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     0.0,0.0,0.0,0.0,0.0:
0000
0000
0000
0001
;
`;
    const { header, charts } = parseSscOrSm(sm);
    expect(header.TITLE).toBe('Legacy Song');
    expect(charts).toHaveLength(1);
    expect(charts[0].STEPSTYPE).toBe('dance-single');
    expect(charts[0].DIFFICULTY).toBe('Beginner');
    expect(charts[0].METER).toBe('1');
    expect(charts[0].NOTES).toContain('0001');
  });

  it('soporta múltiples charts en un solo .ssc', () => {
    const ssc = `
#TITLE:Multi;
#BPMS:0=120;
#NOTEDATA:;
#STEPSTYPE:dance-single;
#DIFFICULTY:Easy;
#METER:2;
#NOTES:
0000
;
#NOTEDATA:;
#STEPSTYPE:dance-single;
#DIFFICULTY:Hard;
#METER:8;
#NOTES:
1111
;
`;
    const { charts } = parseSscOrSm(ssc);
    expect(charts).toHaveLength(2);
    expect(charts[0].DIFFICULTY).toBe('Easy');
    expect(charts[1].DIFFICULTY).toBe('Hard');
    expect(charts[1].METER).toBe('8');
  });

  it('ignora comentarios //', () => {
    const ssc = `
#TITLE:Commented; // este comentario debe desaparecer
#BPMS:0=120;
`;
    const { header } = parseSscOrSm(ssc);
    expect(header.TITLE).toBe('Commented');
    // No debería haber rastro del comentario en ningún tag.
    expect(JSON.stringify(header)).not.toContain('comentario');
  });
});

describe('parseSscPairs', () => {
  it('parsea pares beat=valor separados por comas', () => {
    const pairs = parseSscPairs('0=120,16=140,32=180');
    expect(pairs).toEqual([
      { beat: 0, val: 120 },
      { beat: 16, val: 140 },
      { beat: 32, val: 180 },
    ]);
  });

  it('ordena por beat asc aunque vengan desordenados', () => {
    const pairs = parseSscPairs('32=180,0=120,16=140');
    expect(pairs.map(p => p.beat)).toEqual([0, 16, 32]);
  });

  it('devuelve array vacío para input vacío o nulo', () => {
    expect(parseSscPairs('')).toEqual([]);
    expect(parseSscPairs(null)).toEqual([]);
    expect(parseSscPairs(undefined)).toEqual([]);
  });

  it('descarta entradas con NaN', () => {
    const pairs = parseSscPairs('0=120,abc=def,16=140');
    expect(pairs).toEqual([
      { beat: 0, val: 120 },
      { beat: 16, val: 140 },
    ]);
  });

  it('tolera espacios en blanco', () => {
    const pairs = parseSscPairs(' 0 = 120 , 16=140 ');
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ beat: 0, val: 120 });
  });
});

describe('buildTimingEngine', () => {
  it('beat 0 → tiempo 0 con offset 0 y BPM constante', () => {
    const header = { OFFSET: '0', BPMS: '0=120' };
    const eng = buildTimingEngine(header, null);
    // A 120 BPM, beat 0 = t=0 (sin contar offset).
    const t0 = eng.beatToTime(0);
    expect(t0).toBeCloseTo(0, 3);
  });

  it('beat 1 a 120 BPM = 0.5 segundos', () => {
    const header = { OFFSET: '0', BPMS: '0=120' };
    const eng = buildTimingEngine(header, null);
    expect(eng.beatToTime(1)).toBeCloseTo(0.5, 3);
    expect(eng.beatToTime(4)).toBeCloseTo(2.0, 3);
  });

  it('beat 1 a 60 BPM = 1.0 segundos', () => {
    const header = { OFFSET: '0', BPMS: '0=60' };
    const eng = buildTimingEngine(header, null);
    expect(eng.beatToTime(1)).toBeCloseTo(1.0, 3);
  });

  it('aplica OFFSET (negativo en SM = adelantar audio)', () => {
    // SM: #OFFSET es positivo cuando audio empieza ANTES del beat 0.
    // El motor lo interpreta como "audio.currentTime - offset = beat_time".
    const header = { OFFSET: '0.5', BPMS: '0=120' };
    const eng = buildTimingEngine(header, null);
    // Con offset 0.5, beat 0 cae en t = -0.5 (porque audio adelanta).
    expect(eng.beatToTime(0)).toBeCloseTo(-0.5, 3);
    expect(eng.beatToTime(1)).toBeCloseTo(0.0, 3);
  });

  it('chartHeader sobrescribe header (override por chart)', () => {
    const header     = { BPMS: '0=120' };
    const chartHead  = { BPMS: '0=180' };
    const eng = buildTimingEngine(header, chartHead);
    // Si chart override aplica, beat 1 = 60/180 ≈ 0.333s
    expect(eng.beatToTime(1)).toBeCloseTo(60 / 180, 3);
  });

  it('soporta cambio de BPM a mitad del chart', () => {
    // 0-4 beats a 120 BPM (4*0.5 = 2s), luego a 240 BPM (cada beat = 0.25s)
    const header = { OFFSET: '0', BPMS: '0=120,4=240' };
    const eng = buildTimingEngine(header, null);
    expect(eng.beatToTime(4)).toBeCloseTo(2.0, 3);
    expect(eng.beatToTime(5)).toBeCloseTo(2.0 + 0.25, 3);
    expect(eng.beatToTime(8)).toBeCloseTo(2.0 + 4 * 0.25, 3);
  });

  it('aplica STOPS añadiendo tiempo congelado a beats POSTERIORES', () => {
    // STOP de 1 segundo en beat 2. Convención SM (parser.js:112):
    // el stop se aplica solo a beats con `s.beat < beat` (estricto).
    // → en el beat exacto del stop, t = tiempo de llegada ANTES del stop
    // → en cualquier beat posterior, t = tiempo normal + s.val
    // Esto es congruente con el render: la nota del beat 2 llega justo cuando
    // empieza el stop; lo que viene después se desplaza +1s.
    const header = { OFFSET: '0', BPMS: '0=120', STOPS: '2=1.0' };
    const eng = buildTimingEngine(header, null);
    // Beat 1 normal = 0.5s, no afectado.
    expect(eng.beatToTime(1)).toBeCloseTo(0.5, 3);
    // Beat 2 = 1.0s normal — el stop NO se ha aplicado aún (s.beat < beat es false).
    expect(eng.beatToTime(2)).toBeCloseTo(1.0, 3);
    // Beat 3 = 1.5s normal + 1.0s de stop = 2.5s
    expect(eng.beatToTime(3)).toBeCloseTo(1.5 + 1.0, 3);
    // Beat 4 = 2.0s normal + 1.0s de stop = 3.0s
    expect(eng.beatToTime(4)).toBeCloseTo(2.0 + 1.0, 3);
  });
});

describe('lanesFromStepType', () => {
  it('mapea step types canónicos a número de carriles', () => {
    expect(lanesFromStepType('dance-single')).toBe(4);
    expect(lanesFromStepType('dance-solo')).toBe(6);
    expect(lanesFromStepType('dance-double')).toBe(8);
    expect(lanesFromStepType('dance-couple')).toBe(8);
  });

  it('devuelve default 4 para desconocido', () => {
    expect(lanesFromStepType('pump-single')).toBe(4);
    expect(lanesFromStepType('')).toBe(4);
    expect(lanesFromStepType(null)).toBe(4);
  });
});

describe('parseAttacks', () => {
  it('parsea TIME=...:LEN=...:MODS=... separados por comas', () => {
    const txt = 'TIME=10.0:LEN=2.5:MODS=mirror,TIME=20.0:LEN=3.0:MODS=hidden+sudden';
    const attacks = parseAttacks(txt);
    expect(attacks).toHaveLength(2);
    expect(attacks[0].time).toBeCloseTo(10.0);
    expect(attacks[0].len).toBeCloseTo(2.5);
    expect(attacks[0].mods).toContain('mirror');
    expect(attacks[1].mods).toContain('hidden');
    expect(attacks[1].mods).toContain('sudden');
  });

  it('devuelve array vacío para input vacío', () => {
    expect(parseAttacks('')).toEqual([]);
    expect(parseAttacks(null)).toEqual([]);
  });
});

describe('quantColorFor — colores por subdivisión', () => {
  it('beat 0 (4ths) = rojo', () => {
    expect(quantColorFor(0, 4)).toBe('#ff3a3a');
  });

  it('mismo color para subdivisiones equivalentes', () => {
    // row=0 sobre total=4 (4ths) y row=0 sobre total=8 (4ths también) → mismo color
    expect(quantColorFor(0, 4)).toBe(quantColorFor(0, 8));
  });

  it('row impar sobre total=8 → 8th note (azul)', () => {
    // En total=8: row=1 → idx = 1 * 192/8 = 24. Match en `idx % 24 === 0` → azul.
    expect(quantColorFor(1, 8)).toBe('#3a86ff');
  });
});
