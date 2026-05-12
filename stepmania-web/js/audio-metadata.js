// =============================================================================
//  AUDIO METADATA  —  parser binario de tags de audio (sin dependencias).
//
//  Lo usan los dos autosteppers (autostepper.html y gh-autostepper.html) para
//  poblar title/artist/album de cada canción que la usuaria suelta. Hasta su
//  introducción ambos archivos hacían un split trivial del filename por " - ",
//  lo que producía resultados absurdos con nombres tipo "12 Toxicity.mp3"
//  ("Unknown" como artista) o "11 Rockstar - 2020 Remaster.mp3" (track# como
//  artista). Windows ya lee bien estos archivos porque mira los tags ID3
//  embebidos — aquí replicamos esa lectura.
//
//  Cobertura por formato:
//    - MP3:  ID3v2.3 y v2.4 (95% de casos reales) + fallback ID3v1 (legacy).
//    - FLAC: Vorbis Comments en el bloque VORBIS_COMMENT (type 4).
//    - WAV/OGG/M4A: fallback a filename (no implementado por baja prioridad
//      — la mayoría de música rippeada/comprada es MP3).
//
//  Cuando no hay tags válidos, parseFromFilename hace un fallback inteligente
//  que strippea prefijos de track# ("02 ", "12. ", "03 - ") antes de aplicar
//  la heurística "Artist - Album - Title". Esto cubre el caso de packs viejos
//  sin tags y archivos rippeados con plantilla "TrackNum Title".
//
//  Sin dependencias externas. Encaja con la filosofía del repo (encoder ZIP
//  propio, IndexedDB wrappers propios). El módulo expone window.AudioMetadata
//  en navegador y module.exports en Node — doble export idéntico al de
//  parser.js y difficulty-tiers.js para que el test pueda hacer import.
// =============================================================================

(function() {
  'use strict';

  // Decodifica un bloque de bytes según el encoding declarado en el primer
  // byte de cada frame ID3v2 de texto (cf. ID3v2.4 §4.2.1):
  //   0 = ISO-8859-1   1 = UTF-16 with BOM   2 = UTF-16BE   3 = UTF-8
  // Encodings 2 y 3 son legales solo en v2.4 pero los aceptamos en v2.3 porque
  // varios taggers (foobar2000, MusicBrainz Picard) los emiten en v2.3 y los
  // players reales (Windows, iTunes) los toleran sin protestar.
  function decodeText(bytes, encoding) {
    if (!bytes || !bytes.length) return '';
    // CRÍTICO: el strip de trailing NUL debe ocurrir DESPUÉS de decode, no
    // antes. En UTF-16 cada char ocupa 2 bytes. Un strip byte-a-byte puede
    // comerse el byte alto (00) de un char ASCII como 'o' (6F 00 en LE),
    // dejando el byte 6F huérfano. TextDecoder('utf-16le') con número impar
    // de bytes emite U+FFFD ('�') al final. El decoder maneja los NULs
    // internos como caracteres NUL del string sin problemas — basta con
    // limpiarlos del result final con un regex en string-land.
    try {
      let result;
      if (encoding === 0) {
        result = new TextDecoder('iso-8859-1').decode(bytes);
      } else if (encoding === 1) {
        if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
          result = new TextDecoder('utf-16le').decode(bytes.subarray(2));
        } else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
          result = new TextDecoder('utf-16be').decode(bytes.subarray(2));
        } else {
          result = new TextDecoder('utf-16le').decode(bytes);
        }
      } else if (encoding === 2) {
        result = new TextDecoder('utf-16be').decode(bytes);
      } else {
        result = new TextDecoder('utf-8').decode(bytes);
      }
      return result.replace(/\x00+$/, '');
    } catch (err) {
      return '';
    }
  }

  // Big-endian uint32. Lo usa ID3v2.3 para tamaños de frame (sin synchsafe).
  function uint32BE(b, off) {
    return (b[off] * 0x1000000) + ((b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]);
  }

  // Synchsafe int de 28 bits: bit 7 de cada byte siempre es 0 para no chocar
  // con la sincronización MPEG (que busca 11 bits "1" consecutivos). Decoder
  // canónico según ID3v2.4 §6.2. Bug clásico: leerlo como uint32 normal y
  // obtener tamaños 8× más grandes — pos saltaría fuera del tag y todos los
  // frames se ignorarían.
  function synchsafe(b, off) {
    return ((b[off] & 0x7F) << 21)
         | ((b[off + 1] & 0x7F) << 14)
         | ((b[off + 2] & 0x7F) << 7)
         | (b[off + 3] & 0x7F);
  }

  function parseID3v2(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 10) return null;
    const b = new Uint8Array(arrayBuffer);
    if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;  // "ID3"
    const major = b[3];
    if (major !== 3 && major !== 4) return null;  // v2.2 (3 chars/ID) no soportado.
    const flags = b[5];
    const tagSize = synchsafe(b, 6);
    if (tagSize <= 0 || tagSize + 10 > b.length) return null;

    let pos = 10;
    // Extended header opcional (flag bit 6). Tamaño codificado igual que el
    // tag (synchsafe en v2.4, uint32BE normal en v2.3). Lo saltamos entero.
    if (flags & 0x40) {
      if (pos + 4 > b.length) return null;
      const extSize = major >= 4 ? synchsafe(b, pos) : uint32BE(b, pos);
      pos += major >= 4 ? extSize : (extSize + 4);
    }

    const end = Math.min(b.length, 10 + tagSize);
    const result = { title: '', artist: '', album: '', track: '', year: '', source: 'id3v2' };

    while (pos + 10 < end) {
      // Padding: cuando los frames terminan, el resto del tag son ceros.
      if (b[pos] === 0) break;
      const id = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
      const frameSize = major === 4 ? synchsafe(b, pos + 4) : uint32BE(b, pos + 4);
      if (frameSize <= 0 || pos + 10 + frameSize > end) break;
      const frameStart = pos + 10;
      const frameEnd = frameStart + frameSize;

      if (id === 'TIT2' || id === 'TPE1' || id === 'TALB' ||
          id === 'TRCK' || id === 'TYER' || id === 'TDRC') {
        const enc = b[frameStart];
        const text = decodeText(b.subarray(frameStart + 1, frameEnd), enc);
        // v2.4 permite múltiples valores separados por NUL dentro de un frame
        // (típico en TPE1 con featurings). Nos quedamos con el primero.
        const cleaned = text.split(/\x00/)[0].trim();
        if (cleaned) {
          if (id === 'TIT2') result.title = cleaned;
          else if (id === 'TPE1') result.artist = cleaned;
          else if (id === 'TALB') result.album = cleaned;
          else if (id === 'TRCK') result.track = cleaned.split('/')[0];
          else result.year = cleaned;
        }
      }

      pos = frameEnd;
    }

    if (!result.title && !result.artist && !result.album) return null;
    return result;
  }

  function parseID3v1(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 128) return null;
    const totalLen = arrayBuffer.byteLength;
    const b = new Uint8Array(arrayBuffer, totalLen - 128, 128);
    if (b[0] !== 0x54 || b[1] !== 0x41 || b[2] !== 0x47) return null;  // "TAG"
    // ID3v1 es estrictamente ISO-8859-1 (spec original 1996, sin Unicode).
    const dec = new TextDecoder('iso-8859-1');
    const read = (off, len) => {
      const bytes = b.subarray(off, off + len);
      let cut = bytes.length;
      while (cut > 0 && (bytes[cut - 1] === 0 || bytes[cut - 1] === 32)) cut--;
      return dec.decode(bytes.subarray(0, cut));
    };
    const title = read(3, 30);
    const artist = read(33, 30);
    const album = read(63, 30);
    const year = read(93, 4);
    // ID3v1.1 (1997): si byte 125 es NUL y byte 126 no es NUL, byte 126 es el
    // track#. Convive con v1.0 truncando 1 byte el campo comment.
    let track = '';
    if (b[125] === 0 && b[126] !== 0) track = String(b[126]);
    if (!title && !artist && !album) return null;
    return { title, artist, album, track, year, source: 'id3v1' };
  }

  // FLAC: header "fLaC" (4 bytes) + secuencia de metadata blocks.
  // Block header: 4 bytes — bit 7 = last flag, bits 6-0 = block type,
  //   bytes 1-3 = block size big-endian (uint24).
  // Block type 4 = VORBIS_COMMENT. Contenido (little-endian, a diferencia del
  // header big-endian):
  //   uint32 vendor_length, vendor_string (UTF-8),
  //   uint32 comment_count, [uint32 length + "FIELD=value" UTF-8] × count
  function parseFLAC(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 8) return null;
    const b = new Uint8Array(arrayBuffer);
    if (b[0] !== 0x66 || b[1] !== 0x4C || b[2] !== 0x61 || b[3] !== 0x43) return null;
    let pos = 4;
    while (pos + 4 < b.length) {
      const header = b[pos];
      const isLast = (header & 0x80) !== 0;
      const blockType = header & 0x7F;
      const blockSize = (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
      pos += 4;
      if (pos + blockSize > b.length) break;
      if (blockType === 4) {
        const result = { title: '', artist: '', album: '', track: '', year: '', source: 'flac' };
        let p = pos;
        const u32LE = () => {
          const v = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] * 0x1000000);
          p += 4;
          return v;
        };
        try {
          const vendorLen = u32LE();
          p += vendorLen;
          const count = u32LE();
          const utf8 = new TextDecoder('utf-8');
          for (let i = 0; i < count && p < pos + blockSize; i++) {
            const len = u32LE();
            if (len <= 0 || p + len > pos + blockSize) break;
            const line = utf8.decode(b.subarray(p, p + len));
            p += len;
            const eq = line.indexOf('=');
            if (eq < 0) continue;
            const key = line.slice(0, eq).toUpperCase();
            const val = line.slice(eq + 1).trim();
            if (!val) continue;
            if (key === 'TITLE') result.title = val;
            else if (key === 'ARTIST') result.artist = val;
            else if (key === 'ALBUM') result.album = val;
            else if (key === 'TRACKNUMBER') result.track = val.split('/')[0];
            else if (key === 'DATE' || key === 'YEAR') result.year = val;
          }
        } catch (err) {
          return null;
        }
        if (result.title || result.artist || result.album) return result;
        return null;
      }
      pos += blockSize;
      if (isLast) break;
    }
    return null;
  }

  // Fallback inteligente cuando no hay tags. Sin tags el problema es ambiguo
  // por definición, pero al menos limpiamos prefijos de track# antes de
  // aplicar la heurística "Artist - Album - Title". Casos cubiertos:
  //   "02 GOSSIP (feat. Tom)"        → { title: "GOSSIP (feat. Tom)" }
  //   "11 Rockstar - 2020 Remaster"  → { artist: "Rockstar", title: "2020 Remaster" }
  //   "Artist - Album - Title"       → { artist, album, title }
  //   "Artist - Album - 03 - Title"  → { artist, album, track: "03", title }
  function parseFromFilename(name) {
    const empty = { title: '', artist: '', album: '', track: '', year: '', source: 'filename' };
    if (!name) return empty;
    let s = String(name).replace(/\.[^.]+$/, '').trim();
    if (!s) return empty;
    let track = '';
    // Strip prefijo "TrackNum<sep>". Ej: "02 ", "12. ", "03 - ", "03_".
    const trackPrefix = s.match(/^(\d+)[\s\.\-_]+(.+)$/);
    if (trackPrefix) {
      track = trackPrefix[1];
      s = trackPrefix[2].trim();
    }
    const parts = s.split(/\s+[-–—]\s+/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 4) {
      // 4 partes asumimos "Artist - Album - Track - Title". Si el 3º parece
      // un número, lo tratamos como track override.
      let artist = parts[0], album = parts[1], maybeTrack = parts[2], title = parts.slice(3).join(' - ');
      if (/^\d+$/.test(maybeTrack)) {
        if (!track) track = maybeTrack;
      } else {
        // No es track: fusionamos en el title para no perder info.
        title = parts.slice(2).join(' - ');
      }
      return { title, artist, album, track, year: '', source: 'filename' };
    }
    if (parts.length === 3) {
      return { artist: parts[0], album: parts[1], title: parts[2], track, year: '', source: 'filename' };
    }
    if (parts.length === 2) {
      return { artist: parts[0], album: '', title: parts[1], track, year: '', source: 'filename' };
    }
    return { title: s, artist: '', album: '', track, year: '', source: 'filename' };
  }

  // Completa huecos del tag con el filename. Si el tag dice cosas raras
  // (artist vacío pero title presente, ej), confiamos en lo que diga y solo
  // rellenamos los campos vacíos. Importante: NO sobrescribir valores del
  // tag con los del filename — los tags ganan siempre que existan.
  function normalize(meta, file) {
    const fb = parseFromFilename(file ? file.name : '');
    return {
      title: (meta.title || fb.title || '').trim(),
      artist: (meta.artist || fb.artist || '').trim(),
      album: (meta.album || fb.album || '').trim(),
      track: (meta.track || fb.track || '').trim(),
      year: (meta.year || '').trim(),
      source: meta.source
    };
  }

  // API pública: lee los tags relevantes de un File del usuario sin cargar
  // el archivo entero en memoria. Estrategia:
  //   1) Lee primeros ~1MB (cubre tags ID3v2 con artwork embebido y FLAC).
  //   2) Intenta ID3v2 → FLAC Vorbis Comments → ID3v1 (últimos 128 bytes) →
  //      fallback parseFromFilename.
  //   3) Cualquier campo no encontrado en el tag se rellena con filename.
  async function extractMetadata(file) {
    if (!file) return parseFromFilename('');
    const headSize = Math.min(file.size, 1 << 20);
    let headBuf;
    try {
      headBuf = await file.slice(0, headSize).arrayBuffer();
    } catch (err) {
      return parseFromFilename(file.name);
    }

    const v2 = parseID3v2(headBuf);
    if (v2) return normalize(v2, file);

    const flac = parseFLAC(headBuf);
    if (flac) return normalize(flac, file);

    if (file.size > 128) {
      try {
        const tailBuf = await file.slice(file.size - 128).arrayBuffer();
        const v1 = parseID3v1(tailBuf);
        if (v1) return normalize(v1, file);
      } catch (err) {
        // Lectura de cola falló (raro). Caer al filename.
      }
    }

    return parseFromFilename(file.name);
  }

  const api = {
    extractMetadata,
    parseID3v2,
    parseID3v1,
    parseFLAC,
    parseFromFilename
  };

  if (typeof window !== 'undefined') window.AudioMetadata = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
