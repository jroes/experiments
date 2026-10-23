'use strict';
// Riff Night: songs, charts, scoring for taps, singing and a real guitar, listening (pitch, chords, strums), and what other phones send.
const test = require('node:test');
const assert = require('node:assert/strict');
const RN = require('../riffnight/game.js');
const D = require('../riffnight/dsp.js');

const ARR = RN.SONGS.map(s => RN.arrange(s));
const every = fn => { for (const a of ARR) for (const p of RN.PARTS) for (const d of RN.DIFFS) for (const i of RN.INPUTS[p]) fn(a, p, d, i); };

test('every song adds up: parts fit their sections, every sung note has a syllable', () => {
  for (const s of RN.SONGS) assert.doesNotThrow(() => RN.arrange(s), s.id);
  for (const a of ARR) {
    const end = a.beats;
    for (const part of ['guitar', 'bass', 'keys', 'vocals']) {
      for (const e of a.parts[part]) {
        assert.ok(e.t >= 0 && e.t + e.d <= end + 1e-9, a.id + ' ' + part + ' note past the end');
        const sec = a.sections.find(x => e.t >= x.t && e.t < x.t + x.len);
        assert.ok(e.t + e.d <= sec.t + sec.len + 1e-9, a.id + ' ' + part + ' note spills out of ' + sec.name);
      }
    }
    for (const e of a.parts.drums) assert.ok(e.t >= 0 && e.t < end, a.id + ' drum past the end');
    const secs = a.beats * a.spb;
    assert.ok(secs > 60 && secs < 180, a.id + ' is ' + secs + ' s long');
    assert.ok(a.phrases.length >= 10, a.id + ' has words');
    for (const ph of a.phrases) assert.ok(ph.text.length > 3 && !/ -|- /.test(ph.text), a.id + ' lyric ' + ph.text);
  }
});

test('notes sit where the instruments can play them', () => {
  for (const a of ARR) {
    for (const e of a.parts.guitar) for (const p of e.p) assert.ok(p >= 40 && p <= 88, a.id + ' guitar ' + p);
    for (const e of a.parts.bass) for (const p of e.p) assert.ok(p >= 28 && p <= 55, a.id + ' bass ' + p);
    for (const e of a.parts.vocals) assert.ok(e.p >= 45 && e.p <= 81, a.id + ' sung ' + e.p);
    const v = a.parts.vocals.map(n => n.p);
    assert.ok(Math.max(...v) - Math.min(...v) <= 20, a.id + ' vocal range is singable');
  }
});

test('a song that does not add up is refused', () => {
  const base = RN.SONGS[0];
  const bad = sec => ({ ...base, sections: [{ ...base.sections[2], ...sec }] });
  assert.throws(() => RN.arrange(bad({ vox: ['verse', 'too few words'] })), /syllables/);
  assert.throws(() => RN.arrange(bad({ vox: ['nope', 'x'] })), /no tune/);
  assert.throws(() => RN.arrange(bad({ gtr: 'riff:nope' })), /no riff/);
  assert.throws(() => RN.arrange(bad({ drums: 'polka' })), /bad drums/);
  assert.throws(() => RN.arrange(bad({ chords: 'H7' })), /bad chord/);
  assert.throws(() => RN.parseTokens('E2/0'), /bad length/);
  assert.throws(() => RN.parseTokens('X9/1'), /bad pitch/);
  assert.equal(RN.lyricText(['ra-', 'di-', 'o', 'on,']), 'radio on,');
});

test('charts are in order, in their lanes, spaced for their level, and the same every time', () => {
  every((a, part, diff, input) => {
    const c = RN.chart(a, part, diff, input), tag = [a.id, part, diff, input].join(' ');
    assert.equal(JSON.stringify(c), JSON.stringify(RN.chart(a, part, diff, input)), tag + ' is deterministic');
    assert.ok(c.notes.length > 20, tag + ' has notes');
    for (let i = 1; i < c.notes.length; i++) assert.ok(c.notes[i].t >= c.notes[i - 1].t, tag + ' sorted');
    if (part === 'vocals') return;
    const gap = (input === 'real' ? RN.REAL : part === 'drums' ? RN.DRUM : RN.TAP)[diff].gapS;
    const times = [...new Set(c.notes.map(n => n.t))];
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= gap - 1e-9, tag + ' notes too close at ' + times[i]);
    for (const n of c.notes) {
      assert.ok(Number.isInteger(n.lane) && n.lane >= 0 && n.lane < c.lanes, tag + ' lane ' + n.lane);
      assert.ok(n.d >= 0 && Number.isFinite(n.d));
    }
    // a hold ends before the next note in that lane
    const byLane = {};
    for (const n of c.notes) (byLane[n.lane] = byLane[n.lane] || []).push(n);
    for (const ns of Object.values(byLane)) for (let i = 1; i < ns.length; i++) assert.ok(ns[i - 1].t + ns[i - 1].d < ns[i].t, tag + ' hold runs into a note');
  });
});

test('harder levels have more to play', () => {
  for (const a of ARR) for (const p of RN.PARTS) for (const i of RN.INPUTS[p]) {
    const n = RN.DIFFS.map(d => RN.chart(a, p, d, i).notes.length);
    for (let k = 1; k < n.length; k++) assert.ok(n[k] >= n[k - 1], a.id + ' ' + p + ' ' + i + ' ' + n.join(','));
    if (p !== 'vocals') assert.ok(n[3] > n[0] * 1.5, a.id + ' ' + p + ' ' + i + ' expert is busier than easy');
  }
});

test('a real instrument\'s tab plays the right notes on frets you can reach', () => {
  for (const a of ARR) for (const part of ['guitar', 'bass']) for (const d of RN.DIFFS) {
    const c = RN.chart(a, part, d, 'real'), tune = RN.TUNING[part];
    for (const n of c.notes) {
      assert.equal(n.tab.length, n.p.length);
      const strings = n.tab.map(x => x.s);
      assert.equal(new Set(strings).size, strings.length, 'one note per string');
      const sorted = [...n.p].sort((x, y) => x - y);
      n.tab.forEach((x, i) => {
        assert.ok(x.s >= 0 && x.s < tune.length && x.f >= 0 && x.f <= 15, a.id + ' fret ' + JSON.stringify(x));
        assert.equal(((tune[x.s] + x.f - sorted[i]) % 12 + 12) % 12, 0, 'the fret sounds the note (or its octave)');
      });
      const frets = n.tab.map(x => x.f);
      assert.ok(Math.max(...frets) - Math.min(...frets) <= 4, 'a chord fits under one hand');
    }
  }
  // an E power chord on the low strings
  assert.deepEqual(RN.finger([40, 47], 'guitar', 0), [{ s: 0, f: 0 }, { s: 1, f: 2 }]);
});

// plays a tap chart perfectly: every note pressed on time, every hold kept to its end
function perfectTaps(c, opts) {
  const p = new RN.TapPlay(c, opts);
  const ends = [];
  for (const n of c.notes) {
    for (const e of ends.filter(e => e.t <= n.t)) { p.update(e.t); p.release(e.lane, e.t); }
    ends.splice(0, ends.length, ...ends.filter(e => e.t > n.t));
    p.update(n.t);
    p.press(n.lane, n.t + 0.01);
    if (n.d > 0) ends.push({ t: n.t + n.d + 0.01, lane: n.lane });
    if (p.canBoost()) p.boost(n.t);
  }
  for (const e of ends) { p.update(e.t); p.release(e.lane, e.t); }
  p.update(c.len + 1);
  return p;
}

test('perfect tapping hits every note, never fails, and earns five stars', () => {
  for (const a of ARR) for (const part of ['guitar', 'bass', 'drums']) for (const d of RN.DIFFS) {
    const c = RN.chart(a, part, d, 'tap'), p = perfectTaps(c);
    const tag = a.id + ' ' + part + ' ' + d;
    assert.equal(p.hits, c.notes.length, tag);
    assert.equal(p.best, c.notes.length, tag + ' streak');
    assert.equal(p.failed, false);
    assert.equal(p.status().stars, 5, tag + ' stars, score ' + Math.round(p.score) + ' of base ' + c.base);
    assert.ok(p.glows.length > 0, tag + ' has glowing phrases');
  }
});

test('not playing at all fails you, unless no-fail is on', () => {
  for (const a of ARR) {
    const c = RN.chart(a, 'guitar', 'medium', 'tap');
    const p = new RN.TapPlay(c);
    for (let t = 0; t < c.len + 1; t += 0.05) p.update(t);
    assert.equal(p.failed, true, a.id);
    assert.equal(p.score, 0);
    const q = new RN.TapPlay(c, { noFail: true });
    for (let t = 0; t < c.len + 1; t += 0.05) q.update(t);
    assert.equal(q.failed, false);
    assert.equal(q.hits, 0);
    assert.equal(q.judged, c.notes.length, 'every note was judged once');
  }
});

test('taps: timing windows, one hit per note, strays, holds', () => {
  const c = RN.chart(ARR[0], 'guitar', 'hard', 'tap'), win = c.cfg.win;
  const n = c.notes.find(x => x.d === 0 && x.t > 5);
  let p = new RN.TapPlay(c, { noFail: true });
  p.update(n.t - 1);
  assert.equal(p.press(n.lane, n.t - win - 0.02), null, 'too early');
  assert.equal(p.press(n.lane, n.t + win - 0.001), p.notes[c.notes.indexOf(n)], 'late but inside the window');
  assert.equal(p.press(n.lane, n.t + win - 0.001), null, 'a note is hit once');
  assert.equal(p.press((n.lane + 1) % c.lanes, n.t), null, 'wrong lane');
  // a stray tap on hard breaks the streak; on easy it does not
  p = new RN.TapPlay(c, { noFail: true }); p.streak = 7; p.press(0, -3);
  assert.equal(p.streak, 0);
  const e = new RN.TapPlay(RN.chart(ARR[0], 'guitar', 'easy', 'tap'), { noFail: true }); e.streak = 7; e.press(0, -3);
  assert.equal(e.streak, 7);
  // holding a long note to the end is worth more than letting go at once
  const hc = RN.chart(ARR[0], 'guitar', 'easy', 'tap'), h = hc.notes.find(x => x.d > 0.5);
  assert.ok(h, 'easy has holds');
  const held = new RN.TapPlay(hc, { noFail: true }), let_go = new RN.TapPlay(hc, { noFail: true });
  for (const q of [held, let_go]) { q.update(h.t - 0.5); q.press(h.lane, h.t); }
  let_go.release(h.lane, h.t + 0.05);
  for (const q of [held, let_go]) q.update(h.t + h.d + 0.2);
  held.release(h.lane, h.t + h.d + 0.2);
  assert.ok(held.score > let_go.score + 20, held.score + ' vs ' + let_go.score);
  const beats = h.d / hc.spb;
  assert.ok(Math.abs(held.score - let_go.score - 25 * (beats - 0.05 / hc.spb)) < 1, 'holds pay 25 a beat');
});

test('energy, boost and coming back', () => {
  const c = RN.chart(ARR[2], 'guitar', 'medium', 'tap');
  const p = new RN.TapPlay(c, { noFail: true });
  assert.equal(p.canBoost(), false);
  let t = 0;
  for (const n of c.notes) { p.update(n.t); p.press(n.lane, n.t); t = n.t; if (p.energy >= 0.5) break; }
  assert.ok(p.canBoost(), 'two glowing phrases fill half the bar');
  const before = p.score, n = p.notes.find(x => !x.done && x.t > t + 1);
  p.boost(t);
  assert.equal(p.boosting, true);
  p.update(n.t); p.press(n.lane, n.t);
  assert.equal(p.score - before, 50 * p.mult * 2, 'boost doubles points');
  p.update(n.t + RN.BOOST_BEATS * c.spb);
  assert.equal(p.boosting, false, 'boost runs out');
  assert.equal(p.energy, 0);
  // out of the song, then a bandmate's boost
  const q = new RN.TapPlay(c);
  for (let x = 0; x < 30 && !q.failed; x += 0.05) q.update(x);
  assert.equal(q.failed, true);
  const at = q.lastT;
  assert.equal(q.press(0, at), null, 'no playing while out');
  assert.equal(q.revive(at), true);
  assert.equal(q.failed, false);
  assert.ok(q.meter > 0.3);
  const misses = q.judged;
  q.update(at + 0.2);
  assert.equal(q.judged, misses, 'notes that went by while out do not count against you');
  assert.equal(q.revive(at), false, 'only the fallen come back');
});

// pretend to sing: one frame every 1/60 s at the note's pitch moved by `shift` semitones (or silence when null)
function sing(c, shift, opts) {
  const p = new RN.VoxPlay(c, opts);
  for (let t = -1; t < c.len + 1; t += 1 / 60) {
    const n = c.notes.find(x => t >= x.t && t < x.t + x.d);
    p.frame(n && shift !== null ? { t, f: RN.hz(n.p + shift), conf: 0.9 } : { t, f: 0, conf: 0 });
    p.update(t);
  }
  return p;
}

test('singing on pitch in any octave is Awesome, off pitch is Messy, silence fails', () => {
  for (const a of ARR) {
    const c = RN.chart(a, 'vocals', 'expert', 'mic');
    for (const shift of [0, -12, 12, 0.4]) {
      const p = sing(c, shift);
      assert.equal(p.hits, c.phrases.length, a.id + ' shift ' + shift);
      assert.ok(p.phrases.every(ph => ph.rating === 'Awesome'), a.id + ' shift ' + shift);
      assert.equal(p.status().stars, 5, a.id + ' ' + Math.round(p.score) + ' of ' + c.base);
    }
    const off = sing(c, 3, { noFail: true });
    assert.ok(off.phrases.every(ph => ph.rating === 'Messy'), a.id + ' three semitones off');
    assert.equal(sing(c, null).failed, true, 'silence fails');
    // easy forgives more
    const easy = sing(RN.chart(a, 'vocals', 'easy', 'mic'), 1.8);
    assert.equal(easy.hits, c.phrases.length, 'easy takes nearly two semitones off');
  }
});

// pretend to play a real guitar: frames heard at each note, with or without fresh strums
function strum(c, strums) {
  const p = new RN.RealPlay(c, { noFail: true });
  for (let t = -1; t < c.len + 1; t += 1 / 60) {
    const n = c.notes.find(x => t >= x.t && t < x.t + Math.max(0.12, Math.min(x.d, 0.3)));
    let fr = { t, f: 0, conf: 0, chroma: null, onset: false };
    if (n) {
      const chroma = new Float32Array(12);
      for (const pc of n.pcs) chroma[pc] = 1 / n.pcs.length;
      // a power chord is often heard an octave below its root
      fr = { t, f: RN.hz(n.p.length > 1 ? n.p[0] - 12 : n.p[0]), conf: 0.9, chroma, onset: strums && t - n.t < 1 / 60 };
    }
    p.frame(fr); p.update(t);
  }
  return p;
}

test('a real guitar or bass: playing each note counts, and a repeated chord needs a fresh strum', () => {
  for (const a of ARR) for (const part of ['guitar', 'bass']) for (const d of RN.DIFFS) {
    const c = RN.chart(a, part, d, 'real');
    const p = strum(c, true);
    assert.equal(p.hits, c.notes.length, a.id + ' ' + part + ' ' + d);
    const restrikes = c.notes.filter(n => n.restrike).length;
    if (restrikes) assert.ok(strum(c, false).hits <= c.notes.length - restrikes, a.id + ' let ring, repeats do not count');
  }
  // the wrong chord does not count
  const c = RN.chart(ARR[2], 'guitar', 'medium', 'real'), n = c.notes[3];
  const p = new RN.RealPlay(c, { noFail: true });
  const wrong = new Float32Array(12); wrong[(n.pcs[0] + 1) % 12] = 0.5; wrong[(n.pcs[0] + 6) % 12] = 0.5;
  p.frame({ t: n.t, f: RN.hz(n.p[0] + 1), conf: 0.9, chroma: wrong, onset: true });
  assert.equal(p.hits, 0);
});

// ---------- listening ----------

const SR = 48000;
function tone(f, n, opts) {
  opts = opts || {};
  const x = new Float32Array(n), h = opts.harm || 6;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const ff of [].concat(f)) for (let k = 1; k <= h; k++) v += Math.sin(2 * Math.PI * ff * k * i / SR + k) / k;
    x[i] = (opts.amp || 0.2) * v * (opts.decay ? Math.exp(-i / SR / opts.decay) : 1);
  }
  return x;
}

test('YIN finds the pitch of voices, strings and low bass notes', () => {
  for (const [f, n, lo] of [[41.2, 4096, 36], [55, 4096, 36], [82.41, 2048, 70], [110, 2048, 70], [196, 2048, 70], [261.6, 2048, 70], [440, 2048, 70], [880, 2048, 70]]) {
    for (const opts of [{}, { harm: 12, decay: 0.3 }, { harm: 1 }]) {
      const r = D.yin(tone(f, n, opts), SR, { lo, hi: 1300 });
      const cents = 1200 * Math.log2(r.f / f);
      assert.ok(Math.abs(cents) < 10, f + ' Hz ' + JSON.stringify(opts) + ' heard ' + r.f + ' (' + cents.toFixed(1) + ' c)');
      assert.ok(r.conf > 0.8);
    }
  }
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const noise = Float32Array.from({ length: 2048 }, () => rnd() * 0.3);
  assert.equal(D.yin(noise, SR).f, 0, 'noise has no pitch');
  assert.equal(D.yin(new Float32Array(2048), SR).f, 0, 'silence has no pitch');
  assert.equal(D.yin(tone(220, 2048, { amp: 0.0005 }), SR).f, 0, 'too quiet to count');
});

// what an AnalyserNode reports: a Blackman-windowed spectrum in dB
function spectrumDb(x, fftSize, maxHz) {
  const bins = Math.ceil(maxHz / (SR / fftSize)) + 4, out = new Float32Array(fftSize / 2).fill(-140);
  const w = i => 0.42 - 0.5 * Math.cos(2 * Math.PI * i / fftSize) + 0.08 * Math.cos(4 * Math.PI * i / fftSize);
  for (let k = 1; k < bins; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < fftSize; i++) { const v = x[i] * w(i), a = 2 * Math.PI * k * i / fftSize; re += v * Math.cos(a); im -= v * Math.sin(a); }
    out[k] = 20 * Math.log10(Math.hypot(re, im) / fftSize + 1e-12);
  }
  return out;
}

test('chroma hears which notes a chord has', () => {
  const pc = m => ((Math.round(m) % 12) + 12) % 12;
  for (const chord of [[40, 47, 52], [45, 52], [50, 57, 62], [43, 50], [47, 54]]) {
    const x = tone(chord.map(RN.hz), 8192, { harm: 5 });
    const c = D.chroma(spectrumDb(x, 8192, 1500), SR, 8192);
    const want = [...new Set(chord.map(pc))];
    const top = [...c].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, want.length).map(x => x[1]).sort();
    assert.deepEqual(top, [...want].sort(), 'chord ' + chord + ' gave ' + Array.from(c, v => v.toFixed(2)));
    // and the scoring takes it
    const sum = want.reduce((s, k) => s + c[k], 0);
    assert.ok(sum >= 0.4 && Math.min(...want.map(k => c[k])) >= 0.08, 'counts as a hit');
  }
  assert.equal(D.chroma(new Float32Array(4096).fill(-120), SR, 8192), null, 'silence');
});

test('strums are found when the level jumps, not while a note rings', () => {
  const o = new D.Onsets();
  const seen = [];
  for (let i = 0; i < 120; i++) {
    const t = i / 60, ph = t % 0.5;
    const level = ph < 0.02 ? 0.002 : 0.1 * Math.exp(-(ph - 0.02) * 3);
    if (o.push(level, t)) seen.push(+t.toFixed(2));
  }
  assert.equal(seen.length, 4, 'one onset per strum: ' + seen);
});

// ---------- the band ----------

test('what each phone plays: your mic part is silent, misses quiet a part, same room splits the band', () => {
  const ok = { ok: true, failed: false }, bad = { ok: false, failed: false };
  let g = RN.partGains([{ id: 0, part: 'guitar', input: 'tap', st: ok }], 0);
  assert.deepEqual([g.guitar, g.bass, g.drums, g.vocals, g.keys], [1, 1, 1, 1, 1], 'alone: the guide voice sings');
  g = RN.partGains([{ id: 0, part: 'guitar', input: 'tap', st: bad }], 0);
  assert.ok(g.guitar < 0.2, 'a miss quiets your part');
  g = RN.partGains([{ id: 0, part: 'guitar', input: 'real', st: ok }, { id: 1, part: 'vocals', input: 'mic', st: ok }], 0);
  assert.equal(g.guitar, 0, 'you are the guitar');
  assert.equal(g.vocals, 0, 'no guide voice when someone sings');
  const band = [{ id: 0, part: 'guitar', input: 'tap', st: ok }, { id: 1, part: 'drums', input: 'tap', st: ok }];
  g = RN.partGains(band, 1, { sameRoom: true, leader: false });
  assert.deepEqual([g.guitar, g.bass, g.drums, g.keys], [0, 0, 1, 0], 'same room: only my part');
  g = RN.partGains(band, 0, { sameRoom: true, leader: true });
  assert.deepEqual([g.guitar, g.bass, g.drums, g.keys], [1, 1, 0, 1], 'the leader plays the parts nobody has');
  g = RN.partGains([{ id: 0, part: 'bass', input: 'tap', st: null }], 0);
  assert.equal(g.bass, 1, 'no news yet: play it');
});

test('what other phones send is cleaned', () => {
  for (const junk of [null, undefined, 7, 'x', [], { __proto__: { part: 'drums' } }, { part: 'constructor', input: 'toString', diff: '__proto__' }]) {
    const p = RN.cleanPick(junk);
    assert.ok(RN.PARTS.includes(p.part) && RN.INPUTS[p.part].includes(p.input) && RN.DIFFS.includes(p.diff), JSON.stringify(junk));
  }
  assert.deepEqual(RN.cleanPick({ part: 'drums', input: 'real', diff: 'hard' }), { part: 'drums', input: 'tap', diff: 'hard' }, 'no real drums');
  assert.equal(RN.cleanName('  <b>Ann\u0000\n  Lee</b>  '), 'bAnn Lee/b');
  assert.equal(RN.cleanName('x'.repeat(500)).length, 16);
  assert.equal(RN.cleanName(''), 'Player');
  assert.equal(RN.cleanName({ toString() { return 'evil'; } }), 'Player');
  const st = RN.cleanStatus({ score: 1e99, streak: -4, meter: NaN, energy: '1', boost: 'yes', ok: 0, failed: 1, stars: 9, mult: Infinity, extra: { a: 1 } });
  assert.deepEqual(st, { score: 1e8, streak: 0, best: 0, mult: 1, meter: 0.6, energy: 0, boost: false, ok: true, failed: false, hits: 0, total: 0, stars: 5, done: false });
  assert.equal(RN.cleanStatus(null).score, 0);
  assert.equal(RN.songById('constructor'), null);
  assert.equal(RN.songById('__proto__'), null);
  assert.equal(RN.songById(RN.SONGS[1].id), RN.SONGS[1]);
});

test('saved settings: junk in storage is safe, old best scores stay readable', () => {
  for (const raw of [null, '', 'not json', '[]', '7', '{"best":"x"}', '{"best":{"__proto__":{"score":5}}}']) {
    const s = RN.cleanSaved(raw);
    assert.equal(s.v, 1);
    assert.equal(Object.keys(s.best).length, 0, raw);
    assert.ok(RN.songById(s.song));
  }
  const key = RN.bestKey('night-bus', { part: 'bass', input: 'real', diff: 'hard' });
  const s = RN.cleanSaved(JSON.stringify({
    name: 'Ann', tapOffset: 9, micOffset: 0.1, speed: 'fast', volume: 0.5, noFail: true,
    best: { [key]: { score: 1234.4, stars: 3, acc: 0.8 }, 'night-bus|drums|real|hard': { score: 1 }, 'nope|bass|tap|easy': { score: 1 }, constructor: { score: 1 } },
  }));
  assert.equal(s.name, 'Ann');
  assert.equal(s.tapOffset, 0.4, 'clamped');
  assert.equal(s.micOffset, 0.1);
  assert.equal(s.speed, 1);
  assert.equal(s.noFail, true);
  assert.deepEqual(Object.keys(s.best), [key]);
  assert.deepEqual(s.best[key], { score: 1234, stars: 3, acc: 0.8 });
  assert.equal(Object.getPrototypeOf(s.best), null);
});
