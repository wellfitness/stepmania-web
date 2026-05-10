// ============================================================================
//  PARSER — SSC/SM tag parser, timing engine (BPMS+STOPS+DELAYS+WARPS),
//  notes-to-events with quant colors. Mirrors StepMania TimingData.cpp.
// ============================================================================

// Handles BOTH formats:
//   .ssc — `#NOTEDATA;` opens a chart block, then per-chart tags (DIFFICULTY,
//          METER, RADARVALUES, OFFSET, BPMS, etc.), then `#NOTES:body;`.
//   .sm  — no #NOTEDATA; instead `#NOTES:type:desc:diff:meter:radar:body;`
//          (legacy 3.9 format, common in old packs).
// Per-chart values override header values in buildTimingEngine via the
// `chartHeader[k] || header[k]` lookup.
function parseSscOrSm(text) {
  text = text.replace(/\/\/[^\n]*/g, '');
  const tags = [];
  let i = 0;
  while (i < text.length) {
    const h = text.indexOf('#', i);
    if (h === -1) break;
    const colon = text.indexOf(':', h);
    if (colon === -1) break;
    const semi = text.indexOf(';', colon);
    if (semi === -1) break;
    tags.push({ key: text.slice(h+1, colon).trim().toUpperCase(), val: text.slice(colon+1, semi) });
    i = semi+1;
  }
  const header = {};
  const charts = [];
  let cur = null;
  for (const { key, val } of tags) {
    if (key === 'NOTEDATA') {
      if (cur) charts.push(cur);
      cur = {};
    } else if (key === 'NOTES') {
      if (cur === null) {
        // Legacy .sm: 6 colon-separated parts (type, desc, diff, meter, radar, body)
        const parts = val.split(':');
        if (parts.length >= 6) charts.push({
          STEPSTYPE: parts[0].trim(), DESCRIPTION: parts[1].trim(),
          DIFFICULTY: parts[2].trim(), METER: parts[3].trim(),
          RADARVALUES: parts[4].trim(), NOTES: parts.slice(5).join(':').trim()
        });
      } else {
        cur.NOTES = val.trim(); charts.push(cur); cur = null;
      }
    } else if (cur !== null) {
      cur[key] = val.trim();
    } else {
      header[key] = val.trim();
    }
  }
  if (cur) charts.push(cur);
  return { header, charts };
}

// ----------------------------------------------------------------------------
//  Timing engine — beat→time conversion with full SSC features.
// ----------------------------------------------------------------------------
function parseSscPairs(s) {
  if (!s) return [];
  return s.replace(/\s+/g, '').split(',').filter(Boolean).map(p => {
    const [b, v] = p.split('=').map(parseFloat);
    return { beat: b, val: v };
  }).filter(x => !isNaN(x.beat) && !isNaN(x.val)).sort((a,b) => a.beat - b.beat);
}

function buildTimingEngine(header, chartHeader) {
  const get = k => (chartHeader && chartHeader[k]) || header[k] || '';
  const bpms   = parseSscPairs(get('BPMS'));
  const stops  = parseSscPairs(get('STOPS'));
  const delays = parseSscPairs(get('DELAYS'));
  const warps  = parseSscPairs(get('WARPS'));
  const fakes  = parseSscPairs(get('FAKES'));    // beat=length pairs, range [beat, beat+length)
  const ticks  = parseSscPairs(get('TICKCOUNTS')); // beat=ticks-per-beat
  // SCROLLS — beat=multiplier (negative = reverse direction). Pure pair format.
  const scrolls = parseSscPairs(get('SCROLLS'));
  // SPEEDS — 4-tuple per entry: beat=ratio=delay=unit. We read just (beat, ratio).
  const speedsRaw = (get('SPEEDS') || '').replace(/\s+/g, '').split(',').filter(Boolean);
  const speeds = speedsRaw.map(p => {
    const parts = p.split('=').map(parseFloat);
    return { beat: parts[0], val: parts[1] };
  }).filter(x => isFinite(x.beat) && isFinite(x.val)).sort((a,b)=>a.beat-b.beat);
  // COMBOS — beat=mul (or beat=hit=miss; we use hit if both present)
  const combosRaw = (get('COMBOS') || '').replace(/\s+/g, '').split(',').filter(Boolean);
  const combos = combosRaw.map(p => {
    const parts = p.split('=').map(parseFloat);
    return { beat: parts[0], val: parts[1] };
  }).filter(x => isFinite(x.beat) && isFinite(x.val)).sort((a,b)=>a.beat-b.beat);
  const offset = parseFloat(get('OFFSET') || '0') || 0;
  if (!bpms.length) bpms.push({ beat: 0, val: 120 });
  if (bpms[0].beat > 0) bpms.unshift({ beat: 0, val: bpms[0].val });

  // StepMania convention: audioTime(0) = -OFFSET. Stops add at their beat
  // (after passing). Delays add BEFORE their beat (notes pushed back).
  // Warps skip [w.beat, w.beat+w.val) instantly.
  function beatToTime(beat) {
    for (const w of warps) if (beat > w.beat && beat < w.beat + w.val) return null;
    let t = -offset;
    let cur = 0;
    let warpedRemoved = 0;
    for (const w of warps) if (w.beat < beat) warpedRemoved += Math.min(w.val, beat - w.beat);
    const effBeat = beat - warpedRemoved;

    for (let i = 0; i < bpms.length; i++) {
      const segEnd = (i+1 < bpms.length) ? bpms[i+1].beat : Infinity;
      if (segEnd <= cur) continue;
      const segBpm = bpms[i].val || 120;
      const useEnd = Math.min(segEnd, effBeat);
      if (useEnd > cur) { t += (useEnd - cur) * 60 / segBpm; cur = useEnd; }
      if (cur >= effBeat) break;
    }
    for (const s of stops)  if (s.beat <  beat) t += s.val;
    for (const d of delays) if (d.beat <= beat) t += d.val;
    return t;
  }
  function bpmAtBeat(beat) {
    let v = bpms[0].val;
    for (const b of bpms) if (b.beat <= beat) v = b.val;
    return v;
  }
  let minBpm = Infinity, maxBpm = -Infinity;
  for (const b of bpms) { if (b.val < minBpm) minBpm = b.val; if (b.val > maxBpm) maxBpm = b.val; }
  function isInFake(beat) {
    for (const f of fakes) if (beat >= f.beat && beat < f.beat + f.val) return true;
    return false;
  }
  function ticksPerBeatAt(beat) {
    let v = 4; // StepMania default
    for (const t of ticks) if (t.beat <= beat) v = t.val;
    return v;
  }
  function scrollAtBeat(beat) {
    let v = 1;
    for (const s of scrolls) if (s.beat <= beat) v = s.val;
    return v;
  }
  function speedAtBeat(beat) {
    if (!speeds.length) return 1;
    let v = speeds[0].val;
    for (const s of speeds) if (s.beat <= beat) v = s.val;
    return v;
  }
  function comboMulAt(beat) {
    let v = 1;
    for (const c of combos) if (c.beat <= beat) v = c.val;
    return v;
  }
  // Inverse of beatToTime — segment-walk through bpms, ignoring stops/delays/warps
  // for sub-frame approximation. Good enough for render-time speed/scroll lookup.
  function timeToBeat(audioTime) {
    let t = -offset;
    let cur = 0;
    for (let i = 0; i < bpms.length; i++) {
      const segEnd = (i+1 < bpms.length) ? bpms[i+1].beat : Infinity;
      const segBpm = bpms[i].val || 120;
      const segDur = (segEnd - cur) * 60 / segBpm;
      if (t + segDur >= audioTime) {
        const frac = (audioTime - t) / (60 / segBpm);
        return cur + Math.max(0, frac);
      }
      t += segDur;
      cur = segEnd;
    }
    return cur;
  }
  return { beatToTime, timeToBeat, bpmAtBeat, isInFake, ticksPerBeatAt, scrollAtBeat, speedAtBeat, comboMulAt, minBpm, maxBpm, offset, hasChanges: bpms.length > 1 || stops.length > 0 || delays.length > 0 || warps.length > 0 };
}

// Parse #ATTACKS field. Format example:
//   TIME=10.5:LEN=4.5:MODS=*1.5 +500% confusion mirror,TIME=...
// We only extract (time, len, mods string). The game applies the subset of mods
// it understands (mirror/left/right/shuffle/hidden/sudden) and ignores rest.
function parseAttacks(text) {
  if (!text) return [];
  const out = [];
  for (const block of text.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = block.match(/TIME=([\d.\-]+):LEN=([\d.\-]+):MODS=(.+)/i);
    if (!m) continue;
    const time = parseFloat(m[1]);
    const len  = parseFloat(m[2]);
    const modsRaw = m[3].trim();
    if (!isFinite(time) || !isFinite(len)) continue;
    const known = ['mirror','left','right','shuffle','hidden','sudden'];
    const found = new Set();
    for (const k of known) {
      if (new RegExp(`\\b${k}\\b`, 'i').test(modsRaw)) found.add(k);
    }
    out.push({ time, len, mods: found, raw: modsRaw });
  }
  return out;
}

// Map STEPSTYPE → number of lanes. Anything we don't recognize falls back to 4.
// `dance-solo` is the standard 6-lane mode (L ↖ U D ↗ R) used by DDR Solo.
// `dance-double` is officially 8 lanes (two single pads side by side); we reuse
// it for our custom 9-panel "Full" layout (L ↖ ↙ U D ↗ ↘ R).
function lanesFromStepType(stepType) {
  const s = (stepType || '').toLowerCase();
  if (s === 'dance-solo') return 6;
  if (s === 'dance-double' || s === 'dance-couple' || s === 'dance-routine') return 8;
  return 4;
}

// Per-row beat = measure*4 + r/total*4. Each measure is exactly 4 beats.
// chartHeader is optional (back-compat). Returns { notes, numLanes }.
function parseNotesToEvents(notesText, timingEngine, chartHeader) {
  const numLanes = lanesFromStepType(chartHeader && chartHeader.STEPSTYPE);
  const measures = notesText.split(',').map(m => m.trim());
  const events = [];
  for (let m = 0; m < measures.length; m++) {
    const rows = measures[m].split('\n').map(r => r.trim()).filter(r => r.length > 0);
    const total = rows.length;
    if (!total) continue;
    for (let r = 0; r < total; r++) {
      const row = rows[r];
      if (row.length < numLanes) continue;
      const beat = m*4 + (r/total)*4;
      for (let lane = 0; lane < numLanes; lane++) {
        const ch = row[lane];
        if (ch === '0' || ch === undefined) continue;
        let type;
        if (ch === '1') type = 'tap';
        else if (ch === '2') type = 'hold-head';
        else if (ch === '3') type = 'hold-tail';
        else if (ch === '4') type = 'roll-head';
        else if (ch === 'M' || ch === 'm') type = 'mine';
        else if (ch === 'L' || ch === 'l') type = 'lift';   // judged on RELEASE
        else if (ch === 'F' || ch === 'f') type = 'fake';   // rendered, no score
        else continue;
        events.push({ beat, lane, type, row: r, total });
      }
    }
  }
  const finalNotes = [];
  const openHolds = new Array(numLanes).fill(null);
  for (const e of events) {
    const t = timingEngine.beatToTime(e.beat);
    if (t === null) continue;
    // Notes inside a #FAKES range become fake regardless of original char
    const inFake = timingEngine.isInFake && timingEngine.isInFake(e.beat);
    if (e.type === 'tap' || e.type === 'mine' || e.type === 'lift' || e.type === 'fake') {
      const finalType = inFake && e.type !== 'mine' ? 'fake' : e.type;
      finalNotes.push({ beat: e.beat, lane: e.lane, type: finalType, time: t, row: e.row, total: e.total });
    } else if (e.type === 'hold-head' || e.type === 'roll-head') {
      // Hold tick rate: combine TICKCOUNTS section with BPM at the head.
      // Used by game.js to award +5 per tick held correctly. Falls back to
      // 4 ticks/beat if the engine doesn't expose ticksPerBeatAt.
      const tpb = (timingEngine.ticksPerBeatAt ? timingEngine.ticksPerBeatAt(e.beat) : 4);
      const bpm = timingEngine.bpmAtBeat(e.beat);
      const tickInterval = 60 / (bpm * Math.max(1, tpb));
      const note = { beat: e.beat, lane: e.lane, type: e.type === 'roll-head' ? 'roll' : 'hold', time: t, endBeat: null, endTime: null, row: e.row, total: e.total, tickInterval };
      finalNotes.push(note);
      openHolds[e.lane] = note;
    } else if (e.type === 'hold-tail') {
      const h = openHolds[e.lane];
      if (h) { h.endBeat = e.beat; h.endTime = t; openHolds[e.lane] = null; }
    }
  }
  return { notes: finalNotes, numLanes };
}

// Beat denominator → ITG/SM color.
function quantColorFor(row, total) {
  const idx = Math.round(row * 192 / total);
  if (idx % 48 === 0) return '#ff3a3a';   // 4ths
  if (idx % 24 === 0) return '#3a86ff';   // 8ths
  if (idx % 16 === 0) return '#a259ff';   // 12ths
  if (idx % 12 === 0) return '#ffd400';   // 16ths
  if (idx %  8 === 0) return '#ff66c4';   // 24ths
  if (idx %  6 === 0) return '#00f5d4';   // 32nds
  if (idx %  4 === 0) return '#88ff88';   // 48ths
  if (idx %  3 === 0) return '#ff8800';   // 64ths
  return '#cccccc';
}

// ----- Doble export: classic-script (window) + CommonJS (Node/Vitest) -------
// El navegador ya tiene estas funciones en scope global porque se cargan vía
// <script>. Para que los tests de Vitest puedan importarlas con require(),
// las re-exponemos aquí. Cero impacto en runtime de navegador (module está
// undefined ahí). Si añades una función pública nueva, agrégala a este map.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseSscOrSm,
    parseSscPairs,
    buildTimingEngine,
    parseAttacks,
    lanesFromStepType,
    parseNotesToEvents,
    quantColorFor,
  };
}
