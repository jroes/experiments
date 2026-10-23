/*
 * Riff Night rules: songs into notes, notes into charts, and judging what the player does. No DOM, runs under node.
 *
 * arrange(song)              every note each part plays, in beats (the audio plays this, so charts and sound agree)
 * chart(arr, part, diff, in) what the player sees for one part, in seconds
 * TapPlay / RealPlay / VoxPlay  scoring for taps on the screen, a real guitar or bass through the mic, and singing
 *
 * Nothing here is shared through lockstep, so no seeded randomness is needed: the same song always makes the same chart.
 */
(function (root) {
  'use strict';

  const SONGS = (typeof module !== 'undefined' && module.exports) ? require('./songs.js') : root.RN_SONGS;

  const PARTS = ['guitar', 'bass', 'drums', 'vocals'];
  const DIFFS = ['easy', 'medium', 'hard', 'expert'];
  const INPUTS = { guitar: ['tap', 'real'], bass: ['tap', 'real'], drums: ['tap'], vocals: ['mic'] };
  const PART_NAME = { guitar: 'Guitar', bass: 'Bass', drums: 'Drums', vocals: 'Vocals' };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // ---------- notation ----------

  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function parsePitch(s) {
    const m = /^([A-G])(#|b)?(\d)$/.exec(s);
    if (!m) throw new Error('bad pitch ' + s);
    return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  const noteName = midi => NAMES[((Math.round(midi) % 12) + 12) % 12];
  const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);
  const midiOf = f => 69 + 12 * Math.log2(f / 440);

  // `E2/.5 r/1 E2+B2/1 |` -> notes with beats; `|` marks where a sung line ends
  function parseTokens(str) {
    const notes = [], ends = [];
    let t = 0;
    for (const tok of String(str).trim().split(/\s+/)) {
      if (!tok) continue;
      if (tok === '|') { ends.push(t); continue; }
      const m = /^([^/]+)\/(\d*\.?\d+)$/.exec(tok);
      if (!m) throw new Error('bad token ' + tok);
      const d = Number(m[2]);
      if (!(d > 0)) throw new Error('bad length ' + tok);
      if (m[1] !== 'r') notes.push({ t, d, p: m[1].split('+').map(parsePitch) });
      t += d;
    }
    return { notes, ends, len: t };
  }

  function parseChord(s) {
    const m = /^([A-G])(#|b)?(m|5)?$/.exec(s);
    if (!m) throw new Error('bad chord ' + s);
    const pc = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
    return { pc, q: m[3] || '', name: m[1] + (m[2] || '') + (m[3] || '') };
  }

  // the lowest pitch class at or above `lo`
  const inRange = (pc, lo) => lo + ((pc - lo) % 12 + 12) % 12;
  const GTR_LO = 40, BASS_LO = 28, KEYS_LO = 55;

  // ---------- drums ----------

  const GROOVES = {
    rock: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    punk: { kick: 'x...x...x...x...', snare: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.' },
    half: { kick: 'x.....x...x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.' },
    four: { kick: 'x...x...x...x...', snare: '....x.......x...', ohat: '..x...x...x...x.' },
    build: { kick: 'x...x...x...x...', snare: 'x.x.x.x.x.x.xxxx' },
    hits: { kick: 'x...............' },
    rest: {},
  };
  const FILL = { snare: '........x.xx....', tom1: '............xx..', tom2: '..............x.', tom3: '...............x', kick: '........x.......' };
  const DRUM_KINDS = ['kick', 'snare', 'hat', 'ohat', 'ride', 'crash', 'tom1', 'tom2', 'tom3'];

  // ---------- arrangement ----------

  function syllables(words) {
    return String(words).trim().split(/\s+/).filter(Boolean);
  }

  // A song into notes, all in beats. Throws on a song that does not add up, which the tests use to check every song.
  function arrange(song) {
    const parts = { guitar: [], bass: [], drums: [], keys: [], vocals: [] };
    const phrases = [], sections = [], glow = [];
    const riffs = song.riffs || {}, tunes = song.tunes || {};
    const parsedRiff = name => {
      if (!has(riffs, name)) throw new Error(song.id + ': no riff ' + name);
      return parseTokens(riffs[name]);
    };
    let beat = 0;
    song.sections.forEach((sec, si) => {
      const start = beat, len = sec.bars * 4, end = start + len;
      sections.push({ name: sec.name, t: start, len });
      if (/^(Chorus|Solo)/.test(sec.name)) glow.push([start, start + Math.min(16, len)]);

      // chords: one per bar, `X.Y` is two in a bar; then runs of the same chord are merged for long notes
      const bars = sec.chords.trim().split(/\s+/);
      const segs = [];
      for (let b = 0; b < sec.bars; b++) {
        const halves = bars[b % bars.length].split('.');
        halves.forEach((c, i) => segs.push({ t: start + b * 4 + i * 4 / halves.length, d: 4 / halves.length, ch: parseChord(c) }));
      }
      const runs = [];
      for (const s of segs) {
        const last = runs[runs.length - 1];
        if (last && last.ch.name === s.ch.name) last.d += s.d; else runs.push({ ...s });
      }
      const chordAt = t => { let c = segs[0]; for (const s of segs) if (s.t <= t + 1e-9) c = s; return c.ch; };
      const gRoot = ch => inRange(ch.pc, GTR_LO), bRoot = ch => inRange(ch.pc, BASS_LO);
      const pow = ch => ch.name.replace(/m$/, '') + '5';

      // keys: a quiet pad, never a playable part
      for (const r of runs) {
        const k = inRange(r.ch.pc, KEYS_LO);
        parts.keys.push({ t: r.t, d: r.d, p: r.ch.q === '5' ? [k, k + 7] : [k, k + (r.ch.q === 'm' ? 3 : 4), k + 7] });
      }

      // guitar
      const [gStyle, gArg] = String(sec.gtr || 'rest').split(':');
      const eighths = (fn) => { for (let t = start; t < end - 1e-9; t += 0.5) fn(t, chordAt(t)); };
      const loopRiff = (name, shift, extra) => {
        const r = parsedRiff(name);
        if (!(r.len > 0)) throw new Error(song.id + ': empty riff ' + name);
        for (let o = 0; o < len - 1e-9; o += r.len) {
          for (const n of r.notes) {
            if (o + n.t >= len - 1e-9) break;
            const d = Math.min(n.d, len - o - n.t);
            const ps = n.p.map(p => p + shift);
            out(start + o + n.t, d, ps, extra, n.p.length > 1 ? noteName(ps[0]) + '5' : noteName(ps[0]));
          }
        }
      };
      let out = (t, d, p, extra, name) => parts.guitar.push({ t, d, p, name, ...extra });
      if (gStyle === 'chug') eighths((t, ch) => out(t, 0.5, [gRoot(ch), gRoot(ch) + 7], { pm: true }, pow(ch)));
      else if (gStyle === 'drive') eighths((t, ch) => out(t, 0.5, [gRoot(ch), gRoot(ch) + 7], {}, pow(ch)));
      else if (gStyle === 'ring') for (const r of runs) out(r.t, r.d, [gRoot(r.ch), gRoot(r.ch) + 7, gRoot(r.ch) + 12], {}, pow(r.ch));
      else if (gStyle === 'stab') {
        for (let b = start; b < end - 1e-9; b += 4) for (const [o, d] of [[0, 1], [1.5, 1], [3, 1]]) {
          const ch = chordAt(b + o);
          out(b + o, d, [gRoot(ch), gRoot(ch) + 7], {}, pow(ch));
        }
      } else if (gStyle === 'riff') loopRiff(gArg, 0, {});
      else if (gStyle === 'lead') loopRiff(gArg, 0, { lead: true });
      else if (gStyle !== 'rest') throw new Error(song.id + ': bad gtr ' + sec.gtr);

      // bass
      const [bStyle, bArg] = String(sec.bass || 'rest').split(':');
      out = (t, d, p, extra, name) => parts.bass.push({ t, d, p, name, ...extra });
      if (bStyle === 'eighths') eighths((t, ch) => out(t, 0.5, [bRoot(ch)], {}, noteName(ch.pc)));
      else if (bStyle === 'pulse') for (let t = start; t < end - 1e-9; t += 1) { const ch = chordAt(t); out(t, 1, [bRoot(ch)], {}, noteName(ch.pc)); }
      else if (bStyle === 'walk') for (let t = start; t < end - 1e-9; t += 1) {
        const ch = chordAt(t), step = [0, 7, 12, 7][Math.round(t - start) % 4];
        out(t, 1, [bRoot(ch) + step], {}, noteName(ch.pc + step));
      } else if (bStyle === 'long') for (const r of runs) out(r.t, r.d, [bRoot(r.ch)], {}, noteName(r.ch.pc));
      else if (bStyle === 'riff') loopRiff(bArg, -12, {});
      else if (bStyle !== 'rest') throw new Error(song.id + ': bad bass ' + sec.bass);

      // drums: 16 steps a bar, a crash on the first beat, a fill at the end
      const style = sec.drums || 'rest';
      if (!has(GROOVES, style)) throw new Error(song.id + ': bad drums ' + style);
      if (style !== 'rest') {
        const fill = sec.fill !== false && si < song.sections.length - 1;
        for (let b = 0; b < sec.bars; b++) {
          const lastBar = b === sec.bars - 1;
          const pat = (style === 'hits' && b > 0) ? {} : GROOVES[style];
          for (let s = 0; s < 16; s++) {
            const t = start + b * 4 + s / 4;
            const inFill = fill && lastBar && s >= 8;
            const src = inFill ? FILL : pat;
            for (const k of DRUM_KINDS) {
              if (!has(src, k) || src[k][s] !== 'x') continue;
              if (b === 0 && s === 0 && (k === 'hat' || k === 'ohat')) continue; // the crash takes the first hat
              parts.drums.push({ t, k });
            }
            if (b === 0 && s === 0) parts.drums.push({ t, k: 'crash' });
          }
        }
      }

      // vocals
      if (sec.vox) {
        const [tuneName, words] = sec.vox;
        if (!has(tunes, tuneName)) throw new Error(song.id + ': no tune ' + tuneName);
        const tune = parseTokens(tunes[tuneName]);
        if (tune.len > len + 1e-9) throw new Error(song.id + ': tune ' + tuneName + ' is longer than ' + sec.name);
        const syl = syllables(words);
        if (syl.length !== tune.notes.length) throw new Error(song.id + ' ' + sec.name + ': ' + syl.length + ' syllables for ' + tune.notes.length + ' notes');
        const ends = tune.ends.length ? tune.ends : [tune.len];
        let ph = { notes: [] }, e = 0;
        tune.notes.forEach((n, i) => {
          while (e < ends.length && n.t >= ends[e] - 1e-9) { if (ph.notes.length) phrases.push(ph); ph = { notes: [] }; e++; }
          if (n.p.length !== 1) throw new Error(song.id + ': a sung note is one pitch');
          ph.notes.push(parts.vocals.length);
          parts.vocals.push({ t: start + n.t, d: n.d, p: n.p[0], syl: syl[i] });
        });
        if (ph.notes.length) phrases.push(ph);
      }
      beat = end;
    });
    for (const k of ['guitar', 'bass', 'keys', 'vocals']) parts[k].sort((a, b) => a.t - b.t);
    parts.drums.sort((a, b) => a.t - b.t || DRUM_KINDS.indexOf(a.k) - DRUM_KINDS.indexOf(b.k));
    for (const ph of phrases) {
      const ns = ph.notes.map(i => parts.vocals[i]);
      ph.t = ns[0].t; ph.end = ns[ns.length - 1].t + ns[ns.length - 1].d;
      ph.text = lyricText(ns.map(n => n.syl));
    }
    return { id: song.id, title: song.title, bpm: song.bpm, spb: 60 / song.bpm, beats: beat, parts, phrases, sections, glow };
  }

  // syllables back into words: `ra- di- o` is "radio"
  function lyricText(syls) {
    let s = '';
    syls.forEach((x, i) => { s += /-$/.test(x) ? x.slice(0, -1) : x + (i < syls.length - 1 ? ' ' : ''); });
    return s;
  }

  // ---------- charts ----------

  // What each difficulty asks of tapping: lanes, the finest grid a note can sit on, the shortest gap between notes
  // (beats and seconds), the timing window either side, and how long a note must be to become a hold.
  const TAP = {
    easy: { lanes: 3, grid: 1, gapB: 1, gapS: 0.45, win: 0.13, holdB: 2, chords: false, gain: 0.03, loss: 0.035 },
    medium: { lanes: 4, grid: 0.5, gapB: 0.5, gapS: 0.25, win: 0.115, holdB: 1.5, chords: false, gain: 0.025, loss: 0.045 },
    hard: { lanes: 5, grid: 0.25, gapB: 0.25, gapS: 0.14, win: 0.1, holdB: 1, chords: false, gain: 0.02, loss: 0.055 },
    expert: { lanes: 5, grid: 0, gapB: 0, gapS: 0.075, win: 0.09, holdB: 1, chords: true, gain: 0.02, loss: 0.065 },
  };
  // a real instrument through the mic: fewer notes and wider windows, because hearing a note takes a moment
  const REAL = {
    easy: { grid: 2, gapB: 2, gapS: 0.8, win: 0.2, gain: 0.03, loss: 0.03 },
    medium: { grid: 1, gapB: 1, gapS: 0.4, win: 0.18, gain: 0.025, loss: 0.04 },
    hard: { grid: 0.5, gapB: 0.5, gapS: 0.24, win: 0.16, gain: 0.02, loss: 0.05 },
    expert: { grid: 0, gapB: 0, gapS: 0.14, win: 0.15, gain: 0.02, loss: 0.06 },
  };
  // drums: which pieces, the grid, the shortest gap, how many at once
  const DRUM = {
    easy: { kinds: ['kick', 'snare'], grid: 1, gapB: 1, gapS: 0.45, max: 1, win: 0.13, gain: 0.03, loss: 0.035 },
    medium: { kinds: ['kick', 'snare', 'hat', 'ohat', 'crash'], grid: 0.5, gapB: 0.5, gapS: 0.25, max: 2, win: 0.115, gain: 0.025, loss: 0.045 },
    hard: { kinds: DRUM_KINDS, grid: 0.5, gapB: 0.5, gapS: 0.14, max: 2, win: 0.1, gain: 0.02, loss: 0.055 },
    expert: { kinds: DRUM_KINDS, grid: 0, gapB: 0, gapS: 0.07, max: 2, win: 0.09, gain: 0.02, loss: 0.065 },
  };
  const DRUM_LANE = { kick: 0, snare: 1, tom1: 2, tom2: 2, tom3: 2, hat: 3, ohat: 3, ride: 3, crash: 3 };
  const DRUM_RANK = { snare: 0, kick: 1, crash: 2, tom1: 3, tom2: 3, tom3: 3, hat: 4, ohat: 4, ride: 4 };
  // singing: how far off pitch still counts (semitones, any octave), and a boost to the in-tune share on easier levels
  const VOX = {
    easy: { tol: 2, ease: 1.35, gain: 0.12, loss: 0.08 },
    medium: { tol: 1.5, ease: 1.2, gain: 0.1, loss: 0.1 },
    hard: { tol: 1, ease: 1.1, gain: 0.08, loss: 0.12 },
    expert: { tol: 0.7, ease: 1, gain: 0.07, loss: 0.14 },
  };
  const TUNING = { guitar: [40, 45, 50, 55, 59, 64], bass: [28, 33, 38, 43] };
  const STRING_NAMES = { guitar: ['E', 'A', 'D', 'G', 'B', 'e'], bass: ['E', 'A', 'D', 'G'] };

  const onGrid = (t, g) => !g || Math.abs(t / g - Math.round(t / g)) < 1e-6;
  const inGlow = (arr, t) => arr.glow.some(([a, b]) => t >= a - 1e-9 && t < b - 1e-9);

  // keep notes on the grid with enough room between them; the first note of each section is always tried first
  function thin(events, cfg, spb) {
    const kept = [];
    let last = -Infinity;
    for (const e of events) {
      if (!onGrid(e.t, cfg.grid)) continue;
      if (e.t - last < cfg.gapB - 1e-9 || (e.t - last) * spb < cfg.gapS - 1e-9) continue;
      kept.push(e); last = e.t;
    }
    return kept;
  }

  // pitch order within a section decides the lane, so a riff that climbs climbs across the screen
  function laneMap(arr, events, lanes) {
    const bySec = new Map();
    for (const e of events) {
      const si = sectionAt(arr, e.t);
      if (!bySec.has(si)) bySec.set(si, new Set());
      bySec.get(si).add(Math.min(...e.p));
    }
    const maps = new Map();
    for (const [si, set] of bySec) {
      const sorted = [...set].sort((a, b) => a - b), n = sorted.length, m = new Map();
      sorted.forEach((p, r) => m.set(p, n <= lanes ? r : Math.floor(r * lanes / n)));
      maps.set(si, m);
    }
    return e => maps.get(sectionAt(arr, e.t)).get(Math.min(...e.p));
  }

  function sectionAt(arr, t) {
    let i = 0;
    for (let k = 0; k < arr.sections.length; k++) if (arr.sections[k].t <= t + 1e-9) i = k;
    return i;
  }

  // Guitar or bass fingering: the lowest pitch on some string, then each next pitch one string up. Prefers frets near the last one.
  function finger(pitches, inst, prev) {
    const tune = TUNING[inst], ps = [...pitches].sort((a, b) => a - b);
    let best = null;
    for (let s = 0; s + ps.length <= tune.length; s++) {
      const frets = ps.map((p, i) => p - tune[s + i]);
      if (frets.some(f => f < 0 || f > 15)) continue;
      const cost = Math.abs(frets[0] - (prev === undefined ? 3 : prev)) + Math.max(...frets) * 0.1 + (Math.max(...frets) - Math.min(...frets)) * 2;
      if (!best || cost < best.cost) best = { cost, tab: ps.map((p, i) => ({ s: s + i, f: frets[i] })) };
    }
    if (best) return best.tab;
    // out of reach: move it an octave and try again
    const lo = ps[0];
    if (lo < tune[0]) return finger(ps.map(p => p + 12), inst, prev);
    return finger(ps.map(p => p - 12), inst, prev);
  }

  function chart(arr, part, diff, input) {
    if (!PARTS.includes(part) || !DIFFS.includes(diff)) throw new Error('bad part or difficulty');
    if (!INPUTS[part].includes(input)) input = INPUTS[part][0];
    const spb = arr.spb, notes = [];
    const base = { part, diff, input, spb, bpm: arr.bpm, sections: arr.sections.map(s => ({ name: s.name, t: s.t * spb })) };
    const lastBeat = arr.beats;
    if (part === 'vocals') {
      const v = arr.parts.vocals;
      const phrases = arr.phrases.map(ph => ({
        t: ph.t * spb, end: ph.end * spb, text: ph.text, notes: ph.notes.slice(), glow: inGlow(arr, ph.t),
      }));
      for (const n of v) notes.push({ t: n.t * spb, d: n.d * spb, p: n.p, syl: n.syl });
      const lo = Math.min(...v.map(n => n.p)), hi = Math.max(...v.map(n => n.p));
      return { ...base, lanes: 0, notes, phrases, range: [lo, hi], len: lastBeat * spb, cfg: VOX[diff], total: phrases.length,
        base: phrases.reduce((s, ph) => s + 50 * ph.notes.length, 0) };
    }
    if (part === 'drums') {
      const cfg = DRUM[diff];
      const groups = new Map();
      for (const e of arr.parts.drums) {
        if (!cfg.kinds.includes(e.k) || !onGrid(e.t, cfg.grid)) continue;
        const key = Math.round(e.t * 1e6);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
      let last = -Infinity;
      for (const key of [...groups.keys()].sort((a, b) => a - b)) {
        const g = groups.get(key), t = g[0].t;
        if (t - last < cfg.gapB - 1e-9 || (t - last) * spb < cfg.gapS - 1e-9) continue;
        last = t;
        const lanes = new Map();
        for (const e of g.sort((a, b) => DRUM_RANK[a.k] - DRUM_RANK[b.k])) {
          const l = DRUM_LANE[e.k];
          if (!lanes.has(l) && lanes.size < cfg.max) lanes.set(l, e.k);
        }
        for (const [lane, k] of lanes) notes.push({ t: t * spb, d: 0, lane, k, glow: inGlow(arr, t) });
      }
      notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
      return { ...base, lanes: 4, notes, len: lastBeat * spb, cfg, total: notes.length, base: notes.length * 50 };
    }
    const events = arr.parts[part];
    if (input === 'real') {
      const cfg = REAL[diff];
      const kept = thin(events, cfg, spb);
      let prev;
      kept.forEach((e, i) => {
        const tab = finger(e.p, part, prev);
        prev = tab[0].f;
        const nextT = i + 1 < kept.length ? kept[i + 1].t : e.t + e.d;
        const pcs = [...new Set(e.p.map(p => ((p % 12) + 12) % 12))];
        notes.push({ t: e.t * spb, d: Math.max(0, Math.min(e.d, nextT - e.t) * spb * 0.9), p: e.p.slice(), pcs, name: e.name, tab, glow: inGlow(arr, e.t), lane: tab[0].s });
      });
      // a note that repeats what was just played needs a fresh strum to count
      notes.forEach((n, i) => {
        const pr = notes[i - 1];
        n.restrike = !!pr && n.t - pr.t < 0.7 && pr.pcs.join() === n.pcs.join();
      });
      return { ...base, lanes: TUNING[part].length, strings: STRING_NAMES[part], notes, len: lastBeat * spb, cfg, total: notes.length, base: notes.length * 50 };
    }
    const cfg = TAP[diff];
    const kept = thin(events, cfg, spb);
    const lane = laneMap(arr, kept, cfg.lanes);
    kept.forEach((e, i) => {
      const l = lane(e), glow = inGlow(arr, e.t);
      const nextT = i + 1 < kept.length ? kept[i + 1].t : Infinity;
      let d = 0;
      if (!e.pm && e.d >= cfg.holdB - 1e-9) {
        d = (Math.min(e.d - 0.25, nextT - e.t - 0.5)) * spb;
        if (d < 0.3) d = 0;
      }
      const ls = cfg.chords && e.p.length > 1 && !e.pm ? (l + 1 < cfg.lanes ? [l, l + 1] : [l - 1, l]) : [l];
      for (const x of ls) notes.push({ t: e.t * spb, d, lane: x, glow });
    });
    notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
    const holdBeats = notes.reduce((s, n) => s + n.d / spb, 0);
    return { ...base, lanes: cfg.lanes, notes, len: lastBeat * spb, cfg, total: notes.length, base: notes.length * 50 + Math.round(holdBeats * 25) };
  }

  // 1 to 5: how hard a part is, from the Hard chart: notes a second, plus how often the lane changes (moving is harder than repeating)
  function tier(arr, part) {
    const c = chart(arr, part, 'hard', INPUTS[part][0]);
    let moves = 0;
    for (let i = 1; i < c.notes.length; i++) if (c.notes[i].lane !== c.notes[i - 1].lane) moves++;
    const nps = c.notes.length / c.len, m = part === 'vocals' ? nps : nps * 0.4 + moves / c.len;
    const cut = { guitar: [1.9, 2.3, 2.5, 2.8], bass: [1.8, 2.1, 2.4, 2.6], drums: [5, 6.5, 9, 12], vocals: [0.8, 1.3, 1.65, 1.85] }[part];
    return 1 + cut.filter(x => m > x).length;
  }

  // ---------- scoring ----------

  const STAR_CUTS = [0.25, 0.6, 1.2, 2.0, 2.8];
  const stars = (score, base) => base > 0 ? STAR_CUTS.filter(c => score >= c * base).length : 0;
  const BOOST_BEATS = 32;   // a full energy bar lasts this long
  const PHRASE_RATINGS = [['Awesome', 0.7, 1], ['Strong', 0.5, 0.8], ['Good', 0.35, 0.6], ['OK', 0.2, 0.3], ['Messy', 0, 0]];

  // What every way of playing shares: points, streak, multiplier, the crowd meter, energy and boost, glowing phrases.
  class Play {
    constructor(chart, opts) {
      opts = opts || {};
      this.chart = chart; this.cfg = chart.cfg; this.noFail = !!opts.noFail;
      this.score = 0; this.streak = 0; this.best = 0; this.hits = 0; this.judged = 0;
      this.meter = 0.6; this.energy = 0; this.boosting = false; this.failed = false;
      this.maxMult = chart.part === 'bass' ? 6 : 4;
      this.fx = [];        // what just happened, for the screen to show and clear
      this.lastT = null;
      this.ok = true;      // playing well right now: decides whether this part is heard
      this.glows = [];     // per glowing phrase: notes left, spoiled
    }
    get mult() { return Math.min(this.maxMult, 1 + Math.floor(this.streak / 10)); }
    points(n) { return n * this.mult * (this.boosting ? 2 : 1); }
    good(t, extra) {
      this.streak++; this.best = Math.max(this.best, this.streak); this.hits++; this.judged++;
      this.meter = Math.min(1, this.meter + this.cfg.gain); this.ok = true;
      this.fx.push({ k: 'hit', t, ...extra });
    }
    bad(t, extra) {
      this.streak = 0; this.judged++; this.ok = false;
      this.meter = Math.max(0, this.meter - this.cfg.loss);
      this.fx.push({ k: 'miss', t, ...extra });
      if (this.meter <= 0 && !this.noFail) { this.failed = true; this.boosting = false; this.fx.push({ k: 'fail', t }); }
    }
    addEnergy(x, t) {
      this.energy = Math.min(1, this.energy + x);
      this.fx.push({ k: 'energy', t });
    }
    canBoost() { return !this.failed && !this.boosting && this.energy >= 0.5 - 1e-9; }
    boost(t) {
      if (!this.canBoost()) return false;
      this.boosting = true; this.fx.push({ k: 'boost', t });
      return true;
    }
    drain(t) {
      if (this.lastT !== null && this.boosting && t > this.lastT) {
        this.energy -= (t - this.lastT) / (BOOST_BEATS * this.chart.spb);
        if (this.energy <= 0) { this.energy = 0; this.boosting = false; }
      }
      this.lastT = t;
    }
    revive(t) {
      if (!this.failed) return false;
      this.failed = false; this.meter = 0.35; this.ok = true;
      this.skipTo(t + 0.25);
      this.fx.push({ k: 'revive', t });
      return true;
    }
    status() {
      return {
        score: Math.round(this.score), streak: this.streak, best: this.best, mult: this.mult, meter: this.meter, energy: this.energy,
        boost: this.boosting, ok: this.ok && !this.failed, failed: this.failed, hits: this.hits, total: this.chart.total,
        stars: stars(this.score, this.chart.base),
      };
    }
  }

  // notes (taps or real): glowing phrases are runs of glowing notes; hitting all of one fills a quarter of the energy bar
  function markGlows(notes) {
    const glows = [];
    let cur = null;
    notes.forEach((n, i) => {
      if (n.glow) {
        if (!cur || (i > 0 && !notes[i - 1].glow)) { cur = { left: 0, spoiled: false }; glows.push(cur); }
        cur.left++; n.g = glows.length - 1;
      } else cur = null;
    });
    return glows;
  }

  class NotePlay extends Play {
    constructor(chart, opts) {
      super(chart, opts);
      this.notes = chart.notes.map(n => ({ ...n, hit: false, done: false }));
      this.glows = markGlows(this.notes);
      this.next = 0;
    }
    // notes made while playing (music you play out loud): they arrive in time order, after everything already there
    add(list) {
      for (const n of list) {
        this.notes.push({ ...n, hit: false, done: false });
        this.chart.total++; this.chart.base += 50;
      }
    }
    settle(n, ok, t) {
      n.done = true;
      if (n.g === undefined) return;
      const g = this.glows[n.g];
      g.left--;
      if (!ok) g.spoiled = true;
      if (g.left === 0 && !g.spoiled) this.addEnergy(0.25, t);
    }
    hitNote(n, t) {
      n.hit = true;
      this.good(t, { lane: n.lane, off: t - n.t });
      this.score += this.points(50);
      this.settle(n, true, t);
    }
    missNote(n, t) {
      this.bad(t, { lane: n.lane });
      this.settle(n, false, t);
    }
    // notes whose window has passed are misses
    update(t) {
      const win = this.cfg.win;
      while (this.next < this.notes.length && this.notes[this.next].done) this.next++;
      for (let i = this.next; i < this.notes.length && this.notes[i].t + win < t; i++) {
        const n = this.notes[i];
        if (n.done) continue;
        if (this.failed) { n.done = true; continue; }
        this.missNote(n, n.t + win);
      }
      this.drain(t);
    }
    skipTo(t) {
      for (const n of this.notes) if (!n.done && n.t < t) { n.done = true; if (n.g !== undefined) this.glows[n.g].spoiled = true; }
    }
  }

  // Tapping lanes on the screen. press() when a finger lands, release() when it lifts, update() every frame.
  class TapPlay extends NotePlay {
    constructor(chart, opts) {
      super(chart, opts);
      this.holds = [];                     // notes being held: { n, from }
      this.strays = !['easy', 'medium'].includes(chart.diff); // a tap on nothing breaks the streak on the harder levels
    }
    press(lane, t) {
      if (this.failed) return null;
      const win = this.cfg.win;
      let best = null;
      for (let i = this.next; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.t - win > t) break;
        if (n.done || n.lane !== lane || Math.abs(n.t - t) > win) continue;
        if (!best || Math.abs(n.t - t) < Math.abs(best.t - t)) best = n;
      }
      if (best) {
        this.hitNote(best, t);
        if (best.d > 0) this.holds.push({ n: best, from: Math.max(t, best.t), lane });
        return best;
      }
      this.fx.push({ k: 'stray', t, lane });
      if (this.strays) { this.streak = 0; this.meter = Math.max(0, this.meter - 0.01); }
      return null;
    }
    release(lane, t) {
      for (const h of this.holds) if (h.lane === lane) { this.accrue(h, t); h.gone = true; }
      this.holds = this.holds.filter(h => !h.gone);
    }
    accrue(h, t) {
      const end = Math.min(t, h.n.t + h.n.d);
      if (end > h.from) { this.score += this.points(25 * (end - h.from) / this.chart.spb); h.from = end; }
    }
    update(t) {
      for (const h of this.holds) { this.accrue(h, t); if (t >= h.n.t + h.n.d) h.gone = true; }
      this.holds = this.holds.filter(h => !h.gone && !this.failed);
      super.update(t);
    }
  }

  // A real guitar or bass. frame() gets what the mic heard at song time t: { t, f (Hz or 0), conf, chroma (12 numbers or null), onset }.
  class RealPlay extends NotePlay {
    constructor(chart, opts) {
      super(chart, opts);
      this.lastOnset = -Infinity;
      this.heard = null;   // { name, cents } for the screen
    }
    matches(n, fr) {
      if (n.pcs.length > 1 && fr.chroma) {
        let sum = 0, min = 1;
        for (const pc of n.pcs) { sum += fr.chroma[pc]; min = Math.min(min, fr.chroma[pc]); }
        if (sum >= 0.4 && min >= 0.08) return true;
      }
      if (fr.f > 0 && fr.conf >= 0.6) {
        const m = midiOf(fr.f);
        // a power chord's lowest note is often heard an octave low, so a chord counts by its root's pitch class
        if (this.chart.diff === 'expert' && n.pcs.length === 1) return Math.abs(m - n.p[0]) <= 0.6;
        return pcDist(m, n.p[0]) <= 0.6;
      }
      if (n.pcs.length === 1 && fr.chroma) return fr.chroma[n.pcs[0]] >= 0.35;
      return false;
    }
    frame(fr) {
      if (fr.onset) this.lastOnset = fr.t;
      this.heard = fr.f > 0 && fr.conf >= 0.6 ? { name: noteName(midiOf(fr.f)), cents: Math.round((midiOf(fr.f) - Math.round(midiOf(fr.f))) * 100) } : null;
      if (this.failed) return;
      const win = this.cfg.win;
      for (let i = this.next; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.t - win > fr.t) break;
        if (n.done || Math.abs(n.t - fr.t) > win) continue;
        if (n.restrike && this.lastOnset < n.t - win) continue;
        if (this.matches(n, fr)) { this.hitNote(n, fr.t); return; }
      }
    }
  }

  const pcDist = (m, target) => { const d = ((m - target) % 12 + 12) % 12; return Math.min(d, 12 - d); };
  // the signed distance to the nearest octave of the target, -6 to 6
  const foldDist = (m, target) => { let d = ((m - target) % 12 + 12) % 12; if (d > 6) d -= 12; return d; };

  // Singing. frame() gets { t, f, conf } about 60 times a second; each line is rated when it ends.
  class VoxPlay extends Play {
    constructor(chart, opts) {
      super(chart, opts);
      this.notes = chart.notes.map(n => ({ ...n, good: 0 }));
      this.phrases = chart.phrases.map(p => ({ ...p, done: false, rating: null }));
      this.next = 0;           // first phrase not yet rated
      this.cursor = 0;         // note under the singer
      this.pitch = null;       // { m, off } what you sang, folded next to the note, for the screen
      this.lastGood = -Infinity;
      this.lastFrame = null;
    }
    get mult() { return Math.min(4, 1 + Math.floor(this.streak / 2)); }
    frame(fr) {
      const dt = this.lastFrame === null ? 0 : Math.max(0, Math.min(0.1, fr.t - this.lastFrame));
      this.lastFrame = fr.t;
      const ns = this.notes;
      while (this.cursor < ns.length - 1 && ns[this.cursor].t + ns[this.cursor].d <= fr.t) this.cursor++;
      const n = ns[this.cursor];
      if (!(fr.f > 0 && fr.conf >= 0.5)) { this.pitch = null; return; }
      const m = midiOf(fr.f);
      const near = n && fr.t >= n.t - 0.5 && fr.t <= n.t + n.d + 0.5 ? n : null;
      const ref = near ? near.p : (this.pitch ? this.pitch.m : m);
      const off = foldDist(m, ref);
      this.pitch = { m: ref + off, off: near ? off : null };
      if (this.failed || !n || fr.t < n.t || fr.t > n.t + n.d) return;
      if (Math.abs(off) <= this.cfg.tol) { n.good += dt; this.lastGood = fr.t; }
    }
    update(t) {
      // between lines nobody is singing, so the part is heard; during a line it is heard while you are on pitch
      const inLine = this.phrases.some(p => t >= p.t && t <= p.end);
      this.ok = !inLine || t - this.lastGood < 0.6;
      while (this.next < this.phrases.length && this.phrases[this.next].end + 0.15 < t) {
        const ph = this.phrases[this.next++];
        if (this.failed) { ph.done = true; continue; }
        this.rate(ph, ph.end + 0.15);
      }
      this.drain(t);
    }
    rate(ph, t) {
      let len = 0, good = 0;
      for (const i of ph.notes) { len += this.notes[i].d; good += Math.min(this.notes[i].good, this.notes[i].d); }
      const share = len > 0 ? Math.min(1, good / len * this.cfg.ease) : 0;
      const [name, , factor] = PHRASE_RATINGS.find(r => share >= r[1]);
      ph.done = true; ph.rating = name; ph.share = share;
      const base = 50 * ph.notes.length;
      if (factor >= 0.6) {
        this.streak++; this.best = Math.max(this.best, this.streak); this.hits++;
        this.score += base * factor * this.mult * (this.boosting ? 2 : 1);
      } else {
        this.streak = 0;
        this.score += base * factor;
      }
      this.judged++;
      const delta = { Awesome: this.cfg.gain, Strong: this.cfg.gain * 0.6, Good: this.cfg.gain * 0.25, OK: -this.cfg.loss * 0.4, Messy: -this.cfg.loss }[name];
      this.meter = Math.max(0, Math.min(1, this.meter + delta));
      this.fx.push({ k: 'phrase', t, rating: name, share });
      if (ph.glow && factor >= 0.8) this.addEnergy(0.25, t);
      if (this.meter <= 0 && !this.noFail) { this.failed = true; this.boosting = false; this.fx.push({ k: 'fail', t }); }
    }
    skipTo(t) { for (const p of this.phrases) if (!p.done && p.t < t) p.done = true; while (this.next < this.phrases.length && this.phrases[this.next].done) this.next++; }
  }

  // ---------- playing along to any music ----------

  // Music you play out loud (Spotify on a speaker, a record, a band): no chart exists, so notes are made a moment ahead
  // on the beat the BeatTracker hears, each one copying what the music did a bar or two earlier (songs repeat). Loud
  // spots get notes, the strongest pitch class picks the lane (higher notes further right), kick and snare and
  // cymbals pick the drum lanes.
  const LIVE = 'your-music';
  const JAM = {
    easy: { every: 2, eighths: 0, beat: 0.12 },
    medium: { every: 1, eighths: 0, beat: 0.12 },
    hard: { every: 1, eighths: 0.45, beat: 0.1 },
    expert: { every: 1, eighths: 0.3, beat: 0.08 },
  };
  class Jam {
    constructor(part, diff) {
      if (!['guitar', 'bass', 'drums'].includes(part)) part = 'guitar';
      if (!DIFFS.includes(diff)) diff = 'medium';
      this.part = part; this.diff = diff; this.cfg = JAM[diff];
      const cfg = part === 'drums' ? DRUM[diff] : TAP[diff];
      this.chart = { part, diff, input: 'tap', live: true, lanes: part === 'drums' ? 4 : cfg.lanes, notes: [], cfg, spb: 0.5, bpm: 120, total: 0, base: 0, len: Infinity, sections: [] };
      this.frames = [];        // what was heard: { t, flux, low, mid, high, chroma }
      this.planned = -Infinity;
      this.lastNote = -Infinity;
    }
    hear(fr) {
      this.frames.push(fr);
      while (this.frames.length && this.frames[0].t < fr.t - 16) this.frames.shift();
    }
    // what counts as loud: most of the loudest moment of the last few seconds (0 to 1 after dividing)
    scale(key, now) {
      let max = 0, n = 0;
      for (const f of this.frames) if (f.t > now - 8) { n++; if (f[key] > max) max = f[key]; }
      return n < 30 ? 0 : max * 0.8;
    }
    window(t0, t1) {
      const o = { flux: 0, low: 0, mid: 0, high: 0, chroma: new Float64Array(12), n: 0 };
      for (const f of this.frames) {
        if (f.t < t0 || f.t > t1) continue;
        o.n++;
        for (const k of ['flux', 'low', 'mid', 'high']) o[k] = Math.max(o[k], f[k]);
        if (f.chroma) for (let i = 0; i < 12; i++) o.chroma[i] += f.chroma[i];
      }
      return o;
    }
    // lanes for pitch classes: the strongest ones lately, in order up from the strongest (the key's home note)
    pcLanes(now) {
      const w = new Float64Array(12);
      for (const f of this.frames) if (f.t > now - 8 && f.chroma) for (let i = 0; i < 12; i++) w[i] += f.chroma[i];
      const order = [...w.keys()].sort((a, b) => w[b] - w[a]);
      const root = order[0], lanes = this.chart.lanes;
      const top = order.slice(0, Math.max(lanes, 5)).filter(pc => w[pc] > 0).sort((a, b) => ((a - root + 12) % 12) - ((b - root + 12) % 12));
      return pc => {
        const r = top.indexOf(pc);
        if (r < 0 || !top.length) return null;
        return top.length <= lanes ? r : Math.floor(r * lanes / top.length);
      };
    }
    // Notes from just after what is already planned up to `until`, on the beat `b` ({ beat, period }). `now`: the newest heard moment.
    plan(b, until, now) {
      const out = [], half = b.period / 2, cfg = this.cfg, gap = this.chart.cfg.gapS;
      if (!(b.period > 0.2 && b.period < 1.2)) return out;
      if (this.anchor === undefined) this.anchor = b.beat; // beats are counted from here, so "every other beat" stays the same beats
      const from = Math.max(this.planned, now + 0.25);
      const scales = { flux: this.scale('flux', now), low: this.scale('low', now), mid: this.scale('mid', now), high: this.scale('high', now) };
      if (!(scales.flux > 0)) return out;
      const laneOf = this.part === 'drums' ? null : this.pcLanes(now);
      for (let k = Math.ceil((from - b.beat) / half - 1e-9); ; k++) {
        const t = b.beat + k * half;
        if (t <= from + 1e-9) continue;
        if (t > until) break;
        this.planned = t;
        const onBeat = k % 2 === 0, beatNo = Math.round((t - this.anchor) / b.period);
        if (!onBeat && !cfg.eighths) continue;
        if (onBeat && cfg.every === 2 && beatNo % 2) continue;
        // the same spot a bar (or two, or three) ago, fully heard
        let ref = t, bars = 0;
        while (ref + half / 2 > now - 0.03 && bars < 4) { ref -= 4 * b.period; bars++; }
        if (ref + half / 2 > now - 0.03 || ref - half / 2 < (this.frames[0] ? this.frames[0].t : Infinity)) continue;
        const w = this.window(ref - half / 2, ref + half / 2);
        if (!w.n) continue;
        const v = key => Math.min(1, w[key] / (scales[key] || 1));
        if (t - this.lastNote < gap - 1e-9) continue;
        const lanes = [];
        if (this.part === 'drums') {
          const kick = v('low'), snare = v('mid'), cym = v('high'), max = this.chart.cfg.max;
          const want = onBeat ? 0.4 : 0.6;
          const cand = [];
          if (kick >= want && kick >= snare * 0.8) cand.push([kick, 0]);
          if (snare >= want && snare > kick * 0.8) cand.push([snare, 1]);
          if (!onBeat && snare >= 0.75 && kick < 0.4) cand.push([snare, 2]);
          if (this.diff !== 'easy' && cym >= (onBeat ? 0.35 : cfg.eighths)) cand.push([cym * 0.9, 3]);
          if (!cand.length && onBeat && v('flux') >= 0.3) cand.push([1, 1]);
          cand.sort((a, c) => c[0] - a[0]);
          for (const [, l] of cand.slice(0, max)) if (!lanes.includes(l)) lanes.push(l);
        } else {
          const strength = v('flux');
          if (strength < (onBeat ? cfg.beat : cfg.eighths)) continue;
          let best = -1;
          for (let i = 0; i < 12; i++) if (best < 0 || w.chroma[i] > w.chroma[best]) best = i;
          let lane = w.chroma[best] > 0 ? laneOf(best) : null;
          if (lane === null) lane = Math.min(this.chart.lanes - 1, Math.floor(v('mid') * this.chart.lanes));
          lanes.push(lane);
        }
        if (!lanes.length) continue;
        this.lastNote = t;
        for (const lane of lanes.sort((a, c) => a - c)) out.push({ t, d: 0, lane, glow: false });
      }
      return out;
    }
  }

  function makePlay(ch, opts) {
    if (ch.part === 'vocals') return new VoxPlay(ch, opts);
    if (ch.input === 'real') return new RealPlay(ch, opts);
    return new TapPlay(ch, opts);
  }

  // ---------- the band ----------

  // How loud each part is on one phone. members: [{ id, part, input, st: status }]. Your own mic part is silent (you are it).
  // Missing notes quiets that part, like a real band where you hear who is playing. In the same room each phone plays only
  // its own part, and the band leader's phone plays the parts nobody has.
  function partGains(members, me, opts) {
    opts = opts || {};
    const g = {};
    for (const part of PARTS) {
      const on = members.filter(m => m.part === part);
      const mine = on.find(m => m.id === me);
      let v;
      if (!on.length) v = opts.sameRoom && !opts.leader ? 0 : 1;
      else if (part === 'vocals') v = 0; // somebody sings: no guide voice
      else if (mine && mine.input !== 'tap') v = 0;
      else if (opts.sameRoom && !mine) v = 0;
      else v = on.some(m => !m.st || (m.st.ok && !m.st.failed)) ? 1 : 0.12;
      g[part] = v;
    }
    g.keys = opts.sameRoom && !opts.leader ? 0 : 1;
    return g;
  }

  // ---------- what comes from other phones is untrusted ----------

  const num = (x, lo, hi, dflt) => (typeof x === 'number' && Number.isFinite(x)) ? Math.min(hi, Math.max(lo, x)) : dflt;
  function cleanName(s) {
    const t = String(typeof s === 'string' ? s : '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    return t || 'Player';
  }
  function cleanPick(o) {
    o = o && typeof o === 'object' ? o : {};
    const part = PARTS.includes(o.part) ? o.part : 'guitar';
    const input = INPUTS[part].includes(o.input) ? o.input : INPUTS[part][0];
    const diff = DIFFS.includes(o.diff) ? o.diff : 'medium';
    return { part, input, diff };
  }
  function cleanStatus(o) {
    o = o && typeof o === 'object' ? o : {};
    return {
      score: Math.round(num(o.score, 0, 1e8, 0)), streak: Math.round(num(o.streak, 0, 1e5, 0)), best: Math.round(num(o.best, 0, 1e5, 0)),
      mult: Math.round(num(o.mult, 1, 6, 1)), meter: num(o.meter, 0, 1, 0.6), energy: num(o.energy, 0, 1, 0),
      boost: o.boost === true, ok: o.ok !== false, failed: o.failed === true, hits: Math.round(num(o.hits, 0, 1e5, 0)),
      total: Math.round(num(o.total, 0, 1e5, 0)), stars: Math.round(num(o.stars, 0, 5, 0)), done: o.done === true,
    };
  }
  const songById = id => SONGS.find(s => s.id === id) || null;
  const validSong = id => id === LIVE || !!songById(id);

  // ---------- saved on this device ----------

  const SAVE_KEY = 'riffnight-v1';
  function cleanSaved(raw) {
    let o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
    const best = Object.create(null);
    if (o.best && typeof o.best === 'object') {
      for (const k of Object.keys(o.best).slice(0, 400)) {
        const parts = k.split('|');
        if (parts.length !== 4 || !songById(parts[0])) continue;
        const pick = cleanPick({ part: parts[1], input: parts[2], diff: parts[3] });
        if (pick.part !== parts[1] || pick.input !== parts[2] || pick.diff !== parts[3]) continue;
        const b = o.best[k];
        if (!b || typeof b !== 'object') continue;
        best[k] = { score: Math.round(num(b.score, 0, 1e8, 0)), stars: Math.round(num(b.stars, 0, 5, 0)), acc: num(b.acc, 0, 1, 0) };
      }
    }
    return {
      v: 1,
      name: typeof o.name === 'string' ? cleanName(o.name) : '',
      pick: cleanPick(o.pick),
      song: validSong(o.song) ? o.song : SONGS[0].id,
      tapOffset: num(o.tapOffset, -0.4, 0.4, 0), micOffset: num(o.micOffset, -0.2, 0.6, 0.06),
      speed: num(o.speed, 0.6, 1.6, 1), volume: num(o.volume, 0, 1, 0.8), noFail: o.noFail === true, best,
    };
  }
  const bestKey = (songId, pick) => [songId, pick.part, pick.input, pick.diff].join('|');

  const api = {
    SONGS, PARTS, DIFFS, INPUTS, PART_NAME, TAP, REAL, DRUM, VOX, TUNING, STRING_NAMES, GROOVES, BOOST_BEATS, PHRASE_RATINGS, SAVE_KEY,
    parsePitch, parseTokens, parseChord, noteName, hz, midiOf, lyricText, arrange, chart, tier, finger, stars,
    Play, TapPlay, RealPlay, VoxPlay, makePlay, partGains, pcDist, foldDist, LIVE, JAM, Jam, validSong,
    cleanName, cleanPick, cleanStatus, cleanSaved, songById, bestKey,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RN = api;
})(typeof window !== 'undefined' ? window : globalThis);
