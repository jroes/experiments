/*
 * Jetfall sounds, all made in the browser with Web Audio (oscillators and filtered noise): no files.
 * Sounds in the world are panned and fade with distance from the listener. Your own jets and the wind of
 * skiing are loops whose level follows what you are doing.
 * Uses the site-wide sound settings key, so muting here mutes the other games too.
 */
(function (root) {
  'use strict';
  const KEY = 'experiments-sound-v1';

  function load() {
    try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return { sfx: o.sfx !== false, volume: typeof o.volume === 'number' ? Math.min(1, Math.max(0, o.volume)) : 0.6 }; } catch (e) { return { sfx: true, volume: 0.6 }; }
  }
  function save(s) { try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); o.sfx = s.sfx; o.volume = s.volume; localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* private mode */ } }

  const A = {
    ctx: null, out: null, settings: load(), listener: { pos: [0, 0, 0], yaw: 0 }, last: {},
    start() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const C = root.AudioContext || root.webkitAudioContext;
      if (!C) return;
      const ctx = this.ctx = new C();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
      this.out = ctx.createGain(); this.out.gain.value = this.settings.sfx ? this.settings.volume : 0;
      this.out.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // loops: own jets, wind
      this.jet = this.loop(700, 0.9, 'bandpass');
      this.wind = this.loop(500, 0.5, 'lowpass');
    },
    set(s) { Object.assign(this.settings, s); save(this.settings); if (this.out) this.out.gain.value = this.settings.sfx ? this.settings.volume : 0; },
    loop(freq, q, type) {
      const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.noise; src.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.out); src.start();
      return { f, g };
    },
    // per frame: jets on/off, speed
    update(jetting, speed, energyF) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.jet.g.gain.setTargetAtTime(jetting ? 0.22 : 0, t, jetting ? 0.03 : 0.08);
      this.jet.f.frequency.setTargetAtTime(500 + 500 * (energyF || 0), t, 0.1);
      const w = Math.min(1, Math.max(0, (speed - 12) / 80));
      this.wind.g.gain.setTargetAtTime(w * w * 0.35, t, 0.2);
      this.wind.f.frequency.setTargetAtTime(300 + w * 1500, t, 0.2);
    },
    // distance fade and pan for a sound at pos (null = right here)
    place(pos, range) {
      if (!pos) return { g: 1, pan: 0 };
      const L = this.listener;
      const dx = pos[0] - L.pos[0], dy = pos[1] - L.pos[1], dz = pos[2] - L.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const r = range || 300;
      if (d > r) return null;
      const g = 1 / (1 + d * d / (r * r / 25)) * (1 - d / r);
      // listener right vector
      const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
      const pan = d > 1 ? Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / d)) : 0;
      return { g, pan, d };
    },
    chain(g, pan) {
      const ctx = this.ctx, gn = ctx.createGain(); gn.gain.value = g;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; gn.connect(p); p.connect(this.out); }
      else gn.connect(this.out);
      return gn;
    },
    tone(dest, o) {
      const ctx = this.ctx, t = ctx.currentTime + (o.at || 0), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.a || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      osc.connect(g); g.connect(dest); osc.start(t); osc.stop(t + o.dur + 0.05);
    },
    hiss(dest, o) {
      const ctx = this.ctx, t = ctx.currentTime + (o.at || 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.noise; f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(o.from, t); f.frequency.exponentialRampToValueAtTime(o.to || o.from, t + o.dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.a || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random() * 1.5); src.stop(t + o.dur + 0.05);
    },
    play(name, pos, range) {
      if (!this.ctx || !this.settings.sfx) return;
      const now = this.ctx.currentTime;
      const key = name + (pos ? Math.round(pos[0] / 4) + ',' + Math.round(pos[2] / 4) : '');
      if (this.last[key] && now - this.last[key] < 0.04) return;
      this.last[key] = now;
      const pl = this.place(pos, range || RANGE[name]);
      if (!pl || pl.g < 0.005) return;
      const fn = SOUNDS[name];
      if (fn) fn(this, this.chain(pl.g, pl.pan), pl.d || 0);
    },
  };
  const RANGE = { boom: 900, mortar: 1100, chain: 250, disc: 300, blaster: 250, plasma: 300, gl: 250, laser: 600, tfire: 300, bounce: 100, step: 60, land: 120 };

  const SOUNDS = {
    disc: (a, d) => { a.hiss(d, { from: 2400, to: 500, dur: 0.35, q: 2, gain: 0.22 }); a.tone(d, { f: 180, to: 90, dur: 0.25, gain: 0.3, type: 'triangle' }); },
    chain: (a, d) => { a.hiss(d, { from: 3000, to: 1200, dur: 0.05, q: 0.8, gain: 0.18, type: 'highpass' }); a.tone(d, { f: 140, to: 80, dur: 0.05, gain: 0.12, type: 'square' }); },
    blaster: (a, d) => a.tone(d, { f: 1400, to: 300, dur: 0.18, gain: 0.14, type: 'sawtooth' }),
    plasma: (a, d) => { a.hiss(d, { from: 600, to: 2400, dur: 0.3, q: 1.5, gain: 0.25 }); a.tone(d, { f: 220, to: 440, dur: 0.25, gain: 0.1, type: 'sawtooth' }); },
    gl: (a, d) => { a.tone(d, { f: 160, to: 70, dur: 0.18, gain: 0.35 }); a.hiss(d, { from: 900, to: 300, dur: 0.15, type: 'lowpass', gain: 0.2 }); },
    mortar: (a, d) => { a.tone(d, { f: 90, to: 40, dur: 0.45, gain: 0.45 }); a.hiss(d, { from: 600, to: 100, dur: 0.4, type: 'lowpass', gain: 0.3 }); },
    hgren: (a, d) => a.hiss(d, { from: 800, to: 300, dur: 0.15, type: 'lowpass', gain: 0.15 }),
    laser: (a, d) => { a.tone(d, { f: 2600, to: 900, dur: 0.35, gain: 0.16, type: 'sawtooth' }); a.tone(d, { f: 3900, to: 1300, dur: 0.25, gain: 0.08 }); },
    tfire: (a, d) => { a.tone(d, { f: 500, to: 160, dur: 0.3, gain: 0.18, type: 'square' }); a.hiss(d, { from: 1500, to: 400, dur: 0.25, gain: 0.12 }); },
    boom: (a, d, dist) => {
      const far = Math.min(1, dist / 400);
      a.hiss(d, { from: 2000 - far * 1500, to: 60, dur: 0.9 + far * 0.5, type: 'lowpass', q: 0.7, gain: 0.55 });
      a.tone(d, { f: 85, to: 30, dur: 0.6, gain: 0.5 });
      a.hiss(d, { from: 3000, to: 800, dur: 0.12, type: 'highpass', gain: 0.25 * (1 - far) });
    },
    small: (a, d) => { a.hiss(d, { from: 1600, to: 200, dur: 0.3, type: 'lowpass', gain: 0.3 }); a.tone(d, { f: 120, to: 50, dur: 0.2, gain: 0.25 }); },
    spark: (a, d) => a.hiss(d, { from: 4000, to: 2000, dur: 0.06, type: 'highpass', gain: 0.1 }),
    bounce: (a, d) => a.tone(d, { f: 300, to: 200, dur: 0.06, gain: 0.15, type: 'square' }),
    hit: (a, d) => { a.tone(d, { f: 1900, dur: 0.05, gain: 0.12, type: 'square' }); },
    hurt: (a, d) => { a.hiss(d, { from: 500, to: 150, dur: 0.18, type: 'lowpass', gain: 0.35 }); a.tone(d, { f: 160, to: 90, dur: 0.15, gain: 0.25, type: 'triangle' }); },
    kill: (a, d) => { a.tone(d, { f: 1320, dur: 0.12, gain: 0.15 }); a.tone(d, { f: 1760, at: 0.08, dur: 0.2, gain: 0.15 }); },
    die: (a, d) => { a.tone(d, { f: 300, to: 60, dur: 0.8, gain: 0.25, type: 'sawtooth' }); a.hiss(d, { from: 800, to: 100, dur: 0.8, type: 'lowpass', gain: 0.3 }); },
    dry: (a, d) => a.tone(d, { f: 900, dur: 0.03, gain: 0.1, type: 'square' }),
    station: (a, d) => { a.tone(d, { f: 300, to: 900, dur: 0.6, gain: 0.15, type: 'triangle' }); a.tone(d, { f: 1200, at: 0.5, dur: 0.3, gain: 0.12 }); },
    switch: (a, d) => { a.tone(d, { f: 700, dur: 0.04, gain: 0.08, type: 'square' }); a.tone(d, { f: 500, at: 0.06, dur: 0.05, gain: 0.08, type: 'square' }); },
    land: (a, d) => a.hiss(d, { from: 400, to: 100, dur: 0.2, type: 'lowpass', gain: 0.35 }),
    spawn: (a, d) => { a.hiss(d, { from: 200, to: 3000, dur: 0.6, q: 2, gain: 0.15 }); a.tone(d, { f: 440, to: 880, dur: 0.5, gain: 0.08 }); },
    flagTake: (a, d) => { for (let i = 0; i < 6; i++) a.tone(d, { f: i % 2 ? 660 : 880, at: i * 0.11, dur: 0.1, gain: 0.12, type: 'square' }); },
    flagOurs: (a, d) => { for (let i = 0; i < 6; i++) a.tone(d, { f: i % 2 ? 330 : 247, at: i * 0.14, dur: 0.13, gain: 0.14, type: 'sawtooth' }); },
    cap: (a, d) => [523, 659, 784, 1047, 1319].forEach((f, i) => a.tone(d, { f, at: i * 0.1, dur: 0.6, gain: 0.14, type: 'triangle' })),
    capLost: (a, d) => [440, 392, 330, 262].forEach((f, i) => a.tone(d, { f, at: i * 0.16, dur: 0.5, gain: 0.14, type: 'triangle' })),
    ret: (a, d) => { a.tone(d, { f: 784, dur: 0.2, gain: 0.12 }); a.tone(d, { f: 1047, at: 0.12, dur: 0.35, gain: 0.12 }); },
    drop: (a, d) => { a.tone(d, { f: 400, to: 250, dur: 0.3, gain: 0.12, type: 'triangle' }); },
    gendown: (a, d) => { a.tone(d, { f: 220, to: 40, dur: 1.4, gain: 0.25, type: 'sawtooth' }); },
    genup: (a, d) => { a.tone(d, { f: 60, to: 240, dur: 1.0, gain: 0.2, type: 'sawtooth' }); },
    chat: (a, d) => a.tone(d, { f: 1200, dur: 0.06, gain: 0.08 }),
    win: (a, d) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => a.tone(d, { f, at: i * 0.15, dur: 0.6, gain: 0.15, type: 'triangle' })),
    lose: (a, d) => [392, 349, 311, 262].forEach((f, i) => a.tone(d, { f, at: i * 0.22, dur: 0.6, gain: 0.15, type: 'triangle' })),
    shield: (a, d) => a.tone(d, { f: 600, to: 1200, dur: 0.08, gain: 0.08, type: 'sine' }),
  };
  A.SOUNDS = SOUNDS;
  root.JFAudio = A;
})(window);
