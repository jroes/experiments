// Elf Castle Wood Puncher 5000: all sound is synthesized at runtime with WebAudio. No asset files.
// Music: a generative fingerpicked folk loop (A minor), warm by day, sparse and bell-like at night, with drums that
// fade in as goblins close in. Ambience: wind, birds, crickets, owls, fire crackle. SFX: layered synth recipes.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const DAY_PROG = [[57, 60, 64, 69], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]]; // Am, Fmaj7, C, G
const NIGHT_PROG = [[57, 60, 64, 71], [53, 57, 60, 64], [50, 57, 60, 64], [52, 56, 59, 64]]; // Am(add9), Fmaj7, Dm7, E
const PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79];
const ARP = [0, 2, 1, 3, 2, 1, 3, 2];
const BPM = 76, EIGHTH = 60 / BPM / 2;

export const A = {
  ctx: null, enabled: true, musicOn: true, listener: { x: 30, y: 30 }, mood: { night: 0, danger: 0, fire: 0 },
  _last: {}, _next: 0, _step: 0, _bar: 0, _timer: 0, _night: false, _amb: null,

  init(ctx) {
    if (this.ctx) return this;
    const c = (this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" }));
    this.master = c.createGain(); this.master.gain.value = this.enabled ? 0.85 : 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.8; this.musicBus.connect(this.master);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.95; this.sfxBus.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.gain.value = 0.7; this.ambBus.connect(this.master);
    // reverb: generated impulse response, dark tail
    const len = Math.floor(c.sampleRate * 2.8), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { const t = i / len; lp += (Math.random() * 2 - 1 - lp) * 0.45; d[i] = lp * Math.pow(1 - t, 2.4) * (i < 400 ? i / 400 : 1); } }
    this.verb = c.createConvolver(); this.verb.buffer = ir; this.verbIn = c.createGain(); this.verbOut = c.createGain(); this.verbOut.gain.value = 0.55;
    this.verbIn.connect(this.verb); this.verb.connect(this.verbOut); this.verbOut.connect(this.master);
    const nl = c.sampleRate * 2, nb = c.createBuffer(1, nl, c.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    return this;
  },
  resume() {
    // iOS Safari: the ringer switch mutes WebAudio unless the page is in the "playback" audio session,
    // and the context only unlocks from a real gesture (touchend/click), so retry on each one.
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    if (!this._kick) {
      this._kick = true;
      try {
        const n = 4410, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
        w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
        const el = this._el = new Audio(URL.createObjectURL(new Blob([b], { type: "audio/wav" })));
        el.loop = true; el.setAttribute("playsinline", ""); el.play().catch(() => { this._kick = false; });
      } catch (e) { this._kick = false; }
    }
    const c = this.ctx; if (!c) return;
    if (c.state !== "running") c.resume().catch(() => {});
    try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0); } catch (e) {}
  },
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05); },

  // ---------- primitives ----------
  _out(pan, bus, verb, t) {
    const c = this.ctx, g = c.createGain(); let tail = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); tail = p; }
    tail.connect(bus || this.sfxBus);
    if (verb) { const s = c.createGain(); s.gain.value = verb; tail.connect(s); s.connect(this.verbIn); }
    return g;
  },
  tone(type, f0, f1, dur, vol, o = {}) {
    const c = this.ctx, t = (o.t ?? c.currentTime) + (o.delay || 0), osc = c.createOscillator();
    osc.type = type; osc.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = this._out(o.pan, o.bus, o.verb, t), a = o.a ?? 0.004;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src = osc;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(o.lp, t); if (o.lp1) f.frequency.exponentialRampToValueAtTime(o.lp1, t + dur); osc.connect(f); src = f; }
    src.connect(g); osc.start(t); osc.stop(t + dur + 0.05);
  },
  noise(type, f0, f1, q, dur, vol, o = {}) {
    const c = this.ctx, t = (o.t ?? c.currentTime) + (o.delay || 0), s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this._out(o.pan, o.bus, o.verb, t), a = o.a ?? 0.004; vol *= type === "bandpass" ? 2 + q * 0.5 : type === "highpass" ? 1.5 : 1.2; // filtered noise is quiet, compensate
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  },

  // ---------- sfx ----------
  play(name, x, y, gain = 1) {
    if (!this.ctx || !this.enabled || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime, last = this._last[name] || 0;
    if (now - last < 0.035) return; this._last[name] = now;
    let v = gain, pan = 0;
    if (x !== undefined) { const d = Math.hypot(x - this.listener.x, y - this.listener.y); v *= Math.pow(clamp(1 - d / 20, 0, 1), 1.4); pan = clamp((x - this.listener.x) / 10, -1, 1) * 0.85; if (v < 0.02) return; }
    const fn = S[name]; if (fn) fn(this, v, pan, rnd(0.93, 1.07));
  },

  // ---------- ambience + music ----------
  start() {
    if (this._timer || !this.ctx) return;
    const c = this.ctx;
    this._next = c.currentTime + 0.15;
    if (c.constructor.name !== "OfflineAudioContext") this._timer = setInterval(() => this.tick(c.currentTime + 0.6), 120);
    // continuous beds
    const bed = (type, f, q, gain) => { const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.ambBus); s.start(); return { g, fl }; };
    const cr = c.createGain(); cr.gain.value = 0; cr.connect(this.ambBus);
    const am = c.createGain(); am.gain.value = 0.5; const lfo = c.createOscillator(); lfo.frequency.value = 27; const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.frequency.value = 4350; o2.frequency.value = 5020; const og = c.createGain(); og.gain.value = 0.5;
    o1.connect(og); o2.connect(og); og.connect(am); am.connect(cr); [lfo, o1, o2].forEach((o) => o.start());
    this._amb = { wind: bed("bandpass", 420, 0.6), rumble: bed("lowpass", 240, 0.5), crickets: cr };
    document.addEventListener?.("visibilitychange", () => { if (document.hidden) c.suspend?.(); else if (this.enabled) c.resume?.(); });
  },
  update(dt, m) {
    if (!this.ctx || !this._amb) return;
    const M = this.mood, k = 1 - Math.exp(-dt * 1.5);
    for (const key of ["night", "danger", "fire"]) M[key] += (m[key] - M[key]) * k;
    const t = this.ctx.currentTime, a = this._amb, gust = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.61 + 1);
    a.wind.g.gain.setTargetAtTime((0.03 + gust * 0.07) * (1 - M.night * 0.35), t, 0.4); a.wind.fl.frequency.setTargetAtTime(300 + gust * 500, t, 0.4);
    a.rumble.g.gain.setTargetAtTime(M.fire * 0.05, t, 0.3);
    a.crickets.gain.setTargetAtTime(M.night * 0.012, t, 1.0);
    if (this.enabled && this.ctx.state === "running") {
      if (Math.random() < M.fire * dt * 14) this.noise("bandpass", rnd(1800, 5200), 0, 2, rnd(0.015, 0.05), 0.1 * M.fire, { bus: this.ambBus, pan: rnd(-0.5, 0.5) });
      if (Math.random() < (1 - M.night) * dt * 0.35) this.bird();
      if (Math.random() < M.night * dt * 0.07) this.owl();
    }
  },
  bird() {
    const f = rnd(2400, 4200), p = rnd(-0.8, 0.8), n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone("sine", f * rnd(0.9, 1.1), f * rnd(1.2, 1.5), 0.07, 0.05, { delay: i * 0.1, pan: p, bus: this.ambBus, verb: 0.2, a: 0.01 });
  },
  owl() { const p = rnd(-0.8, 0.8); this.tone("sine", 430, 400, 0.45, 0.07, { pan: p, bus: this.ambBus, verb: 0.5, a: 0.08 }); this.tone("sine", 360, 320, 0.7, 0.07, { delay: 0.6, pan: p, bus: this.ambBus, verb: 0.5, a: 0.08 }); },

  tick(until) {
    while (this._next < until) { this._playStep(this._next, this._step); this._next += EIGHTH; if (++this._step >= 8) { this._step = 0; this._bar++; } }
  },
  pluck(m, t, vol, pan, verb = 0.3) {
    const f = mtof(m);
    this.tone("triangle", f, f * 0.995, 0.7, vol, { t, pan, verb, lp: 2600, lp1: 500 }); this.tone("sine", f * 2, f * 2, 0.35, vol * 0.4, { t, pan, verb });
  },
  bell(m, t, vol, pan) {
    const f = mtof(m); this.tone("sine", f, f, 1.6, vol, { t, pan, verb: 0.7, a: 0.006 }); this.tone("sine", f * 2.76, f * 2.76, 0.9, vol * 0.35, { t, pan, verb: 0.7 }); this.tone("sine", f * 5.4, f * 5.4, 0.4, vol * 0.15, { t, pan, verb: 0.7 });
  },
  _playStep(t, s) {
    if (!this.musicOn || !this.enabled) return;
    const M = this.mood, bar = this._bar;
    if (s === 0) this._night = M.night > 0.5;
    const night = this._night, chord = (night ? NIGHT_PROG : DAY_PROG)[bar % 4], bus = this.musicBus;
    if (s === 0) { // pad + bass + melody
      for (const [i, n] of chord.entries()) {
        const f = mtof(n - (i === 0 ? 12 : 0)), dur = EIGHTH * 8 + 0.8;
        this.tone("sawtooth", f, f, dur, night ? 0.022 : 0.03, { t, bus, verb: 0.6, a: 1.0, lp: night ? 500 : 900, detune: -7 });
        this.tone("sawtooth", f, f, dur, night ? 0.022 : 0.03, { t, bus, verb: 0.6, a: 1.0, lp: night ? 500 : 900, detune: 7 });
      }
      if (night) this.tone("sine", mtof(chord[0] - 24), mtof(chord[0] - 24), EIGHTH * 8, 0.12, { t, bus, a: 0.6 });
      if (Math.random() < (night ? 0.4 : 0.6)) { let i = Math.floor(rnd(2, 8)); const n = 2 + Math.floor(Math.random() * 2); for (let k = 0; k < n; k++) { const at = t + [0, 3, 5][k] * EIGHTH; const m = PENTA[clamp(i, 0, 9)] + (night ? 12 : 0); if (night) this.bell(m, at, 0.055, rnd(-0.4, 0.4)); else { this.tone("triangle", mtof(m), mtof(m), 1.0, 0.07, { t: at, bus, verb: 0.5, a: 0.03, lp: 2000 }); } i += Math.random() < 0.5 ? 1 : -1; } }
    }
    if (!night && (s === 0 || s === 4)) this.tone("sine", mtof(chord[0] - 12), mtof(chord[0] - 12), 0.9, 0.16, { t, bus, a: 0.01 });
    if (night ? s % 2 === 0 && Math.random() < 0.55 : Math.random() < 0.82) { const n = chord[ARP[s] % chord.length] + (night ? 12 : 0); night ? this.bell(n + 12, t, 0.04, rnd(-0.5, 0.5)) : this.pluck(n + 12, t, 0.065, rnd(-0.35, 0.35)); }
    const d = M.danger;
    if (d > 0.12) { // goblin drums
      if (s === 0 || s === 4 || (d > 0.6 && (s === 2 || s === 6))) { this.tone("sine", 130, 42, 0.22, 0.42 * d, { t, bus, a: 0.002 }); this.noise("lowpass", 500, 120, 0.7, 0.1, 0.12 * d, { t, bus }); }
      if (s % 2 === 1) this.noise("highpass", 6500, 0, 0.7, 0.035, 0.05 * d, { t, bus, pan: s % 4 === 1 ? -0.3 : 0.3 });
      if (d > 0.45 && s % 2 === 0) this.tone("sawtooth", mtof(chord[0] - 24), mtof(chord[0] - 24), 0.2, 0.09 * d, { t, bus, lp: 320, a: 0.01 });
    }
  },
};

// ---------- sfx recipes: (A, vol, pan, pitch variation) ----------
const S = {
  swing: (a, v, p, r) => { a.noise("bandpass", 400 * r, 2600 * r, 1.4, 0.11, 0.55 * v, { pan: p, a: 0.05 }); a.noise("bandpass", 2600 * r, 700 * r, 1.2, 0.09, 0.4 * v, { pan: p, delay: 0.09, a: 0.01 }); },
  swing_big: (a, v, p, r) => { a.noise("bandpass", 300 * r, 1500 * r, 0.9, 0.26, 0.8 * v, { pan: p }); a.tone("sine", 140, 70, 0.26, 0.2 * v, { pan: p }); },
  hit: (a, v, p, r) => {
    a.tone("sine", 170 * r, 38, 0.22, 0.95 * v, { pan: p, a: 0.002 }); // sub thump
    a.tone("triangle", 420 * r, 110, 0.12, 0.6 * v, { pan: p, a: 0.001 }); // body
    a.noise("highpass", 3200, 0, 0.7, 0.03, 0.55 * v, { pan: p, a: 0.001 }); // snap
    a.noise("bandpass", 1100 * r, 260, 1.6, 0.11, 0.6 * v, { pan: p, a: 0.001, verb: 0.12 }); // crunch
    a.noise("lowpass", 500, 120, 0.7, 0.16, 0.5 * v, { pan: p, a: 0.002 }); // thud tail
  },
  fell: (a, v, p, r) => {
    a.noise("lowpass", 900, 150, 0.7, 0.9, 0.5 * v, { pan: p, verb: 0.15 }); a.tone("sawtooth", 120 * r, 55, 0.6, 0.16 * v, { pan: p, lp: 420, a: 0.05 });
    a.tone("sine", 75, 34, 0.5, 0.7 * v, { delay: 0.35, pan: p }); a.noise("highpass", 3200, 0, 0.7, 0.5, 0.12 * v, { delay: 0.08, pan: p });
    a.tone("sine", 1319, 1319, 0.25, 0.06 * v, { delay: 0.45, pan: p, verb: 0.4 }); a.tone("sine", 1760, 1760, 0.3, 0.05 * v, { delay: 0.52, pan: p, verb: 0.4 });
  },
  chip: (a, v, p, r) => { a.noise("bandpass", 3200 * r, 0, 8, 0.04, 0.4 * v, { pan: p }); a.tone("sine", 900 * r, 600, 0.08, 0.2 * v, { pan: p }); a.noise("lowpass", 600, 300, 0.7, 0.07, 0.25 * v, { pan: p }); },
  shatter: (a, v, p, r) => { a.noise("bandpass", 1800, 400, 0.8, 0.5, 0.42 * v, { pan: p, verb: 0.2 }); for (let i = 0; i < 4; i++) a.noise("bandpass", rnd(2500, 4200), 0, 8, 0.04, 0.25 * v, { delay: 0.04 + i * 0.07, pan: p }); a.tone("sine", 95, 38, 0.35, 0.6 * v, { pan: p }); a.tone("sine", 1046, 1046, 0.3, 0.05 * v, { delay: 0.2, pan: p, verb: 0.4 }); },
  build: (a, v, p, r) => { for (const d of [0, 0.09]) { a.tone("sine", 240 * r, 100, 0.09, 0.45 * v, { delay: d, pan: p }); a.noise("bandpass", 900, 0, 1.6, 0.05, 0.28 * v, { delay: d, pan: p }); } a.noise("lowpass", 300, 120, 0.7, 0.22, 0.25 * v, { delay: 0.1, pan: p }); a.tone("sine", 880, 1320, 0.22, 0.05 * v, { delay: 0.12, pan: p, verb: 0.5 }); },
  demolish: (a, v, p) => { a.noise("lowpass", 1200, 200, 0.7, 0.4, 0.4 * v, { pan: p }); for (let i = 0; i < 3; i++) a.tone("sine", rnd(150, 260), 70, 0.08, 0.3 * v, { delay: i * rnd(0.05, 0.1), pan: p }); },
  hurt: (a, v, p) => { a.tone("sine", 220, 90, 0.26, 0.55 * v, { pan: p }); a.noise("lowpass", 500, 200, 0.7, 0.16, 0.32 * v, { pan: p }); a.tone("sawtooth", 180, 110, 0.18, 0.08 * v, { pan: p, lp: 600 }); },
  parry: (a, v, p) => { for (const [i, f] of [1180, 1770, 2560, 3410].entries()) a.tone("sine", f, f, 0.8 - i * 0.12, 0.13 * v, { pan: p, verb: 0.4 }); a.noise("highpass", 4000, 0, 0.7, 0.06, 0.3 * v, { pan: p }); a.noise("bandpass", 800, 2400, 1, 0.2, 0.2 * v, { pan: p }); a.tone("sine", 110, 55, 0.2, 0.35 * v, { pan: p }); },
  block: (a, v, p) => { a.noise("lowpass", 700, 250, 0.7, 0.12, 0.4 * v, { pan: p }); a.tone("sine", 140, 85, 0.16, 0.42 * v, { pan: p }); a.tone("sine", 620, 600, 0.14, 0.08 * v, { pan: p, verb: 0.2 }); },
  dodge: (a, v, p) => { a.noise("bandpass", 900, 300, 0.8, 0.26, 0.6 * v, { pan: p }); a.noise("highpass", 2600, 0, 0.7, 0.12, 0.12 * v, { pan: p }); },
  crit: (a, v, p) => { for (const f of [660, 990, 1480]) a.tone("sine", f, f, 0.55, 0.11 * v, { pan: p, verb: 0.3 }); a.tone("sine", 120, 48, 0.32, 0.75 * v, { pan: p }); a.noise("bandpass", 2500, 600, 0.9, 0.12, 0.35 * v, { pan: p }); },
  kill: (a, v, p) => { a.tone("sine", 500, 150, 0.16, 0.4 * v, { pan: p }); a.noise("bandpass", 2000, 600, 1, 0.1, 0.25 * v, { pan: p }); a.tone("sine", 1200, 1800, 0.14, 0.12 * v, { delay: 0.05, pan: p, verb: 0.3 }); },
  gob_wind: (a, v, p, r) => { a.tone("sawtooth", 88 * r, 150, 0.6, 0.18 * v, { pan: p, lp: 520, a: 0.08 }); a.tone("sawtooth", 93 * r, 160, 0.6, 0.12 * v, { pan: p, lp: 480, a: 0.08 }); a.tone("sine", 660, 720, 0.09, 0.1 * v, { pan: p, verb: 0.2 }); },
  gob_swing: (a, v, p) => { a.noise("bandpass", 320, 120, 0.9, 0.22, 0.3 * v, { pan: p }); a.tone("sine", 100, 50, 0.2, 0.2 * v, { delay: 0.12, pan: p }); },
  gob_stun: (a, v, p) => { a.tone("triangle", 420, 200, 0.16, 0.32 * v, { pan: p }); for (const [i, f] of [1500, 1900, 2350].entries()) a.tone("sine", f, f, 0.25, 0.06 * v, { delay: 0.08 + i * 0.07, pan: p, verb: 0.4 }); },
  pickup: (a, v) => { for (const [i, f] of [660, 880, 1320].entries()) a.tone("sine", f, f, 0.22, 0.17 * v, { delay: i * 0.06, verb: 0.4 }); },
  loot: (a, v) => { a.tone("triangle", 1046, 1046, 0.12, 0.12 * v, { verb: 0.3 }); a.tone("triangle", 1568, 1568, 0.18, 0.1 * v, { delay: 0.07, verb: 0.3 }); },
  craft: (a, v) => { for (const [i, f] of [523, 659, 784, 1046].entries()) a.tone("triangle", f, f, 0.6, 0.11 * v, { delay: i * 0.08, verb: 0.5 }); a.noise("bandpass", 3000, 0, 4, 0.08, 0.15 * v, { delay: 0.3 }); a.tone("sine", 100, 60, 0.3, 0.3 * v); },
  equip: (a, v) => { a.noise("bandpass", 2500, 0, 3, 0.05, 0.25 * v); a.tone("sine", 300, 180, 0.09, 0.25 * v); a.tone("sine", 1400, 1400, 0.18, 0.05 * v, { delay: 0.04, verb: 0.3 }); },
  click: (a, v) => a.tone("sine", 700, 480, 0.05, 0.3 * v),
  select: (a, v) => { a.tone("triangle", 520, 520, 0.06, 0.22 * v); a.tone("triangle", 780, 780, 0.08, 0.18 * v, { delay: 0.04 }); },
  step: (a, v, p, r) => { a.noise("lowpass", 520 * r, 280, 0.7, 0.07, 0.4 * v, { pan: p }); a.noise("bandpass", 1800, 0, 1, 0.03, 0.1 * v, { pan: p }); },
  step_wood: (a, v, p, r) => { a.tone("sine", 190 * r, 120, 0.06, 0.12 * v, { pan: p }); a.noise("bandpass", 1100, 0, 1.4, 0.04, 0.08 * v, { pan: p }); },
  dusk: (a) => { for (const [i, f] of [440, 523, 659, 587].entries()) a.tone("sine", f, f, 2.2, 0.08, { delay: i * 0.45, verb: 0.8, a: 0.01 }); a.tone("sine", 220, 220, 3, 0.07, { verb: 0.6, a: 0.3 }); },
  dawn: (a) => { for (const [i, f] of [523, 659, 784, 1046].entries()) a.tone("sine", f, f, 2.0, 0.09, { delay: i * 0.3, verb: 0.8, a: 0.01 }); a.tone("triangle", 262, 262, 3, 0.06, { verb: 0.6, a: 0.4 }); },
  death: (a) => { a.tone("sine", 330, 70, 1.5, 0.45, { lp: 900, verb: 0.4 }); a.noise("lowpass", 400, 80, 0.7, 1.1, 0.35, { verb: 0.3 }); for (const [i, f] of [415, 466, 622].entries()) a.tone("sine", f, f * 0.9, 1.6, 0.06, { delay: 0.2 + i * 0.15, verb: 0.9 }); },
};
A.sfx = S;
