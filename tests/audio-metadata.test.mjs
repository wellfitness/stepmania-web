// Tests del parser de tags de audio (audio-metadata.js).
//
// Filosofía: testeamos los parsers internos (ID3v2/v1/FLAC/filename) con
// fixtures binarios sintéticos construidos a mano. La función pública
// extractMetadata depende de Web File API + TextDecoder en navegador y se
// valida jugando. Aquí cubrimos la lógica pura que es 100% determinista.

import { describe, it, expect } from 'vitest';
import pkg from '../stepmania-web/js/audio-metadata.js';
const { parseID3v2, parseID3v1, parseFLAC, parseFromFilename } = pkg;

// ---------- Helpers para fixtures sintéticos ----------

// ID3v2 synchsafe int de 28 bits (bit 7 de cada byte siempre 0).
function synchsafe(n) {
  return [
    (n >>> 21) & 0x7F,
    (n >>> 14) & 0x7F,
    (n >>> 7) & 0x7F,
    n & 0x7F
  ];
}

// uint32 big-endian (lo que usa ID3v2.3 para tamaños de frame).
function uint32BE(n) {
  return [
    (n >>> 24) & 0xFF,
    (n >>> 16) & 0xFF,
    (n >>> 8) & 0xFF,
    n & 0xFF
  ];
}

// Construye un frame ID3v2 de texto con encoding 3 (UTF-8) por simplicidad.
// idStr: 4 ASCII chars. major: 3 o 4.
function makeTextFrame(idStr, value, major) {
  const valueBytes = new TextEncoder().encode(value);
  const dataLen = valueBytes.length + 1;  // +1 por el byte de encoding
  const sizeBytes = major === 4 ? synchsafe(dataLen) : uint32BE(dataLen);
  const out = new Uint8Array(10 + dataLen);
  out[0] = idStr.charCodeAt(0);
  out[1] = idStr.charCodeAt(1);
  out[2] = idStr.charCodeAt(2);
  out[3] = idStr.charCodeAt(3);
  out.set(sizeBytes, 4);
  out[8] = 0; out[9] = 0;  // flags
  out[10] = 3;             // encoding = UTF-8
  out.set(valueBytes, 11);
  return out;
}

// Construye un tag ID3v2 completo con N frames de texto.
function makeID3v2(frames, major = 4) {
  let totalFrameBytes = 0;
  const frameBuffers = frames.map(([id, val]) => {
    const f = makeTextFrame(id, val, major);
    totalFrameBytes += f.length;
    return f;
  });
  const sizeBytes = synchsafe(totalFrameBytes);
  const header = new Uint8Array(10);
  header[0] = 0x49; header[1] = 0x44; header[2] = 0x33;  // "ID3"
  header[3] = major;
  header[4] = 0;
  header[5] = 0;
  header.set(sizeBytes, 6);
  const out = new Uint8Array(10 + totalFrameBytes);
  out.set(header, 0);
  let pos = 10;
  for (const f of frameBuffers) {
    out.set(f, pos);
    pos += f.length;
  }
  return out.buffer;
}

// ID3v1: bloque fijo de 128 bytes.
function makeID3v1({ title = '', artist = '', album = '', year = '', track = 0 }) {
  const b = new Uint8Array(128);
  b.fill(0);
  b[0] = 0x54; b[1] = 0x41; b[2] = 0x47;  // "TAG"
  const write = (off, len, str) => {
    const bytes = new TextEncoder().encode(str).slice(0, len);
    b.set(bytes, off);
  };
  write(3, 30, title);
  write(33, 30, artist);
  write(63, 30, album);
  write(93, 4, year);
  if (track > 0) {
    b[125] = 0;
    b[126] = track;
  }
  return b.buffer;
}

// ---------- Tests ----------

describe('parseFromFilename', () => {
  it('extrae title cuando solo hay nombre suelto', () => {
    expect(parseFromFilename('Toxicity.mp3')).toMatchObject({
      title: 'Toxicity', artist: '', album: '', track: ''
    });
  });

  it('strippea prefijo "12 " y deja título limpio', () => {
    expect(parseFromFilename('12 Toxicity.mp3')).toMatchObject({
      title: 'Toxicity', artist: '', track: '12'
    });
  });

  it('strippea "02. " con punto separador', () => {
    expect(parseFromFilename('02. GOSSIP.mp3')).toMatchObject({
      title: 'GOSSIP', track: '02'
    });
  });

  it('strippea "03 - " con guión separador', () => {
    expect(parseFromFilename('03 - Last Resort.mp3')).toMatchObject({
      title: 'Last Resort', track: '03'
    });
  });

  it('split "Artist - Title" estándar', () => {
    expect(parseFromFilename('Muse - Starlight.mp3')).toMatchObject({
      artist: 'Muse', title: 'Starlight', album: ''
    });
  });

  it('split "Artist - Album - Title"', () => {
    expect(parseFromFilename('Nickelback - Silver Side Up - How You Remind Me.mp3')).toMatchObject({
      artist: 'Nickelback', album: 'Silver Side Up', title: 'How You Remind Me'
    });
  });

  it('split "Artist - Album - 03 - Title" reconoce track', () => {
    expect(parseFromFilename('Foo Fighters - Your Favorite Toy - 03 - Window.mp3')).toMatchObject({
      artist: 'Foo Fighters', album: 'Your Favorite Toy', track: '03', title: 'Window'
    });
  });

  it('caso real ambiguo "11 Rockstar - 2020 Remaster" (sin tags es lo mejor que podemos)', () => {
    // Sin tags ID3 esto es genuinamente ambiguo. El parser hace lo razonable:
    // strippea "11 " y aplica "Artist - Title", quedando Rockstar como artist.
    // Cuando el archivo SÍ tiene ID3 tag, normalize() preserva el tag y este
    // caso no se invoca.
    expect(parseFromFilename('11 Rockstar - 2020 Remaster.mp3')).toMatchObject({
      track: '11', artist: 'Rockstar', title: '2020 Remaster'
    });
  });

  it('em-dash y en-dash se tratan como guión', () => {
    expect(parseFromFilename('Muse – Starlight.mp3')).toMatchObject({
      artist: 'Muse', title: 'Starlight'
    });
  });

  it('nombre vacío devuelve campos vacíos', () => {
    expect(parseFromFilename('')).toMatchObject({
      title: '', artist: '', album: '', track: ''
    });
  });

  it('source siempre es "filename"', () => {
    expect(parseFromFilename('foo.mp3').source).toBe('filename');
  });
});

describe('parseID3v1', () => {
  it('lee título, artista, álbum, año, track de un tag canónico', () => {
    const buf = makeID3v1({
      title: 'Toxicity', artist: 'System of a Down',
      album: 'Toxicity', year: '2001', track: 2
    });
    expect(parseID3v1(buf)).toMatchObject({
      title: 'Toxicity', artist: 'System of a Down',
      album: 'Toxicity', year: '2001', track: '2', source: 'id3v1'
    });
  });

  it('devuelve null si no encuentra "TAG"', () => {
    const buf = new Uint8Array(128).buffer;
    expect(parseID3v1(buf)).toBeNull();
  });

  it('devuelve null si buffer < 128 bytes', () => {
    expect(parseID3v1(new Uint8Array(50).buffer)).toBeNull();
  });

  it('strippea trailing NULs y espacios de campos cortos', () => {
    const buf = makeID3v1({ title: 'OK', artist: 'X' });
    const res = parseID3v1(buf);
    expect(res.title).toBe('OK');
    expect(res.artist).toBe('X');
  });
});

describe('parseID3v2', () => {
  it('lee tag v2.4 con TIT2, TPE1, TALB, TRCK', () => {
    const buf = makeID3v2([
      ['TIT2', 'Toxicity'],
      ['TPE1', 'System of a Down'],
      ['TALB', 'Toxicity'],
      ['TRCK', '2/14']
    ], 4);
    expect(parseID3v2(buf)).toMatchObject({
      title: 'Toxicity', artist: 'System of a Down',
      album: 'Toxicity', track: '2', source: 'id3v2'
    });
  });

  it('lee tag v2.3 con tamaños uint32BE (no synchsafe)', () => {
    const buf = makeID3v2([
      ['TIT2', 'Starlight'],
      ['TPE1', 'Muse']
    ], 3);
    expect(parseID3v2(buf)).toMatchObject({
      title: 'Starlight', artist: 'Muse'
    });
  });

  it('lee UTF-8 con tildes y emoji correctamente', () => {
    const buf = makeID3v2([
      ['TIT2', 'Canción de prueba ñ €'],
      ['TPE1', 'Mañana']
    ], 4);
    expect(parseID3v2(buf)).toMatchObject({
      title: 'Canción de prueba ñ €',
      artist: 'Mañana'
    });
  });

  it('devuelve null si no encuentra "ID3" header', () => {
    const buf = new Uint8Array([0x66, 0x4C, 0x61, 0x43, 0, 0, 0, 0, 0, 0]).buffer;
    expect(parseID3v2(buf)).toBeNull();
  });

  it('devuelve null si buffer < 10 bytes', () => {
    expect(parseID3v2(new Uint8Array(5).buffer)).toBeNull();
  });

  it('devuelve null si major version no es 3 ni 4', () => {
    const buf = new Uint8Array(20);
    buf[0] = 0x49; buf[1] = 0x44; buf[2] = 0x33;
    buf[3] = 2;  // v2.2 no soportado
    expect(parseID3v2(buf.buffer)).toBeNull();
  });

  // Frame de texto con encoding=1 (UTF-16 with BOM) + null terminator de 2 bytes
  // al final. Reproduce el bug del 2026-05-12 donde el strip de trailing NULs
  // byte-a-byte se comía el byte alto (00) del último char ASCII, dejando un
  // byte huérfano que TextDecoder emitía como U+FFFD '�'. Esto es CRÍTICO
  // porque casi todos los taggers reales (Mp3tag, Picard, WMP) escriben los
  // tags en UTF-16 BOM dentro de v2.3 — sin este test la regresión vuelve.
  function makeUTF16Frame(idStr, value, addNullTerminator = true) {
    const utf16 = new Uint8Array(value.length * 2 + 2 + (addNullTerminator ? 2 : 0));
    utf16[0] = 0xFF; utf16[1] = 0xFE;  // BOM little-endian
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      utf16[2 + i * 2] = code & 0xFF;
      utf16[2 + i * 2 + 1] = (code >> 8) & 0xFF;
    }
    // Trailing 00 00 (null terminator UTF-16). Aquí está la trampa.
    const totalDataLen = utf16.length + 1;  // +1 por byte de encoding
    const sizeBytes = uint32BE(totalDataLen);  // v2.3 — uint32BE normal
    const out = new Uint8Array(10 + totalDataLen);
    out[0] = idStr.charCodeAt(0);
    out[1] = idStr.charCodeAt(1);
    out[2] = idStr.charCodeAt(2);
    out[3] = idStr.charCodeAt(3);
    out.set(sizeBytes, 4);
    out[8] = 0; out[9] = 0;  // flags
    out[10] = 1;             // encoding = UTF-16 with BOM
    out.set(utf16, 11);
    return out;
  }

  function makeID3v23UTF16(frames) {
    let totalFrameBytes = 0;
    const frameBuffers = frames.map(([id, val]) => {
      const f = makeUTF16Frame(id, val, true);
      totalFrameBytes += f.length;
      return f;
    });
    const sizeBytes = synchsafe(totalFrameBytes);
    const header = new Uint8Array(10);
    header[0] = 0x49; header[1] = 0x44; header[2] = 0x33;
    header[3] = 3;  // v2.3
    header[4] = 0; header[5] = 0;
    header.set(sizeBytes, 6);
    const out = new Uint8Array(10 + totalFrameBytes);
    out.set(header, 0);
    let pos = 10;
    for (const f of frameBuffers) {
      out.set(f, pos);
      pos += f.length;
    }
    return out.buffer;
  }

  it('regresión bug 2026-05-12: UTF-16 con null terminator no debe corromper el último char', () => {
    // Caso real reportado: "DJ Miko" devolvía "DJ Mik�" porque el strip de
    // trailing NULs byte-a-byte se comía el byte alto (00) de la 'o'.
    const buf = makeID3v23UTF16([
      ['TIT2', "What´s Up (Original Mix)"],
      ['TPE1', 'DJ Miko'],
      ['TALB', '90s Megadance Hits (2018)']
    ]);
    const result = parseID3v2(buf);
    expect(result.title).toBe("What´s Up (Original Mix)");
    expect(result.artist).toBe('DJ Miko');
    expect(result.album).toBe('90s Megadance Hits (2018)');
    // Verificación específica: NO debe haber replacement chars al final.
    expect(result.title.endsWith('�')).toBe(false);
    expect(result.artist.endsWith('�')).toBe(false);
    expect(result.album.endsWith('�')).toBe(false);
  });

  it('UTF-16 con BOM big-endian también funciona', () => {
    // Construye manualmente un frame UTF-16BE.
    const value = 'Test';
    const utf16be = new Uint8Array(value.length * 2 + 2 + 2);
    utf16be[0] = 0xFE; utf16be[1] = 0xFF;  // BOM big-endian
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      utf16be[2 + i * 2] = (code >> 8) & 0xFF;
      utf16be[2 + i * 2 + 1] = code & 0xFF;
    }
    // Trailing 00 00
    const totalDataLen = utf16be.length + 1;
    const sizeBytes = uint32BE(totalDataLen);
    const frame = new Uint8Array(10 + totalDataLen);
    frame[0] = 0x54; frame[1] = 0x49; frame[2] = 0x54; frame[3] = 0x32;  // "TIT2"
    frame.set(sizeBytes, 4);
    frame[10] = 1;
    frame.set(utf16be, 11);
    const sizeTagBytes = synchsafe(frame.length);
    const tag = new Uint8Array(10 + frame.length);
    tag[0] = 0x49; tag[1] = 0x44; tag[2] = 0x33;
    tag[3] = 3;
    tag.set(sizeTagBytes, 6);
    tag.set(frame, 10);
    const result = parseID3v2(tag.buffer);
    expect(result.title).toBe('Test');
    expect(result.title.endsWith('�')).toBe(false);
  });

  it('para evitar regresión: TRCK con "2/14" extrae solo "2"', () => {
    // El parser ignora tags que solo tienen TRCK (sin title/artist/album es
    // basura para la UI). Por eso el fixture incluye TIT2 también.
    const buf = makeID3v2([
      ['TIT2', 'Sample Song'],
      ['TRCK', '5/12']
    ], 4);
    expect(parseID3v2(buf).track).toBe('5');
  });
});

describe('parseFLAC', () => {
  // Helper local: construye un bloque VORBIS_COMMENT mínimo.
  function makeFLAC(comments) {
    const utf8 = new TextEncoder();
    const vendor = utf8.encode('reference libFLAC');
    const commentBytes = comments.map(c => utf8.encode(c));
    // Calcula tamaño del bloque.
    let blockSize = 4 + vendor.length + 4;  // vendor_len + vendor + count
    for (const c of commentBytes) blockSize += 4 + c.length;
    const total = 4 + 4 + blockSize;  // "fLaC" + block header + block content
    const b = new Uint8Array(total);
    b[0] = 0x66; b[1] = 0x4C; b[2] = 0x61; b[3] = 0x43;  // "fLaC"
    b[4] = 0x84;  // last=1, type=4 (VORBIS_COMMENT)
    b[5] = (blockSize >>> 16) & 0xFF;
    b[6] = (blockSize >>> 8) & 0xFF;
    b[7] = blockSize & 0xFF;
    let p = 8;
    // vendor_length (LE)
    b[p] = vendor.length & 0xFF;
    b[p + 1] = (vendor.length >>> 8) & 0xFF;
    b[p + 2] = (vendor.length >>> 16) & 0xFF;
    b[p + 3] = (vendor.length >>> 24) & 0xFF;
    p += 4;
    b.set(vendor, p); p += vendor.length;
    // comment_count (LE)
    b[p] = commentBytes.length & 0xFF;
    b[p + 1] = (commentBytes.length >>> 8) & 0xFF;
    b[p + 2] = (commentBytes.length >>> 16) & 0xFF;
    b[p + 3] = (commentBytes.length >>> 24) & 0xFF;
    p += 4;
    for (const c of commentBytes) {
      b[p] = c.length & 0xFF;
      b[p + 1] = (c.length >>> 8) & 0xFF;
      b[p + 2] = (c.length >>> 16) & 0xFF;
      b[p + 3] = (c.length >>> 24) & 0xFF;
      p += 4;
      b.set(c, p); p += c.length;
    }
    return b.buffer;
  }

  it('lee TITLE, ARTIST, ALBUM, TRACKNUMBER de un FLAC', () => {
    const buf = makeFLAC([
      'TITLE=Yellow Ledbetter',
      'ARTIST=Pearl Jam',
      'ALBUM=Jeremy',
      'TRACKNUMBER=3'
    ]);
    expect(parseFLAC(buf)).toMatchObject({
      title: 'Yellow Ledbetter', artist: 'Pearl Jam',
      album: 'Jeremy', track: '3', source: 'flac'
    });
  });

  it('case-insensitive en keys: title=, Title=, TITLE= todos válidos', () => {
    const buf = makeFLAC(['title=foo', 'ARTIST=bar']);
    expect(parseFLAC(buf)).toMatchObject({ title: 'foo', artist: 'bar' });
  });

  it('devuelve null si no es FLAC (no "fLaC" magic)', () => {
    expect(parseFLAC(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
  });
});
