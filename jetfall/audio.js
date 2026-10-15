/*
 * Jetfall sounds, all made in the browser with Web Audio (oscillators and filtered noise): no files.
 * Sounds in the world are panned, fade with distance, get duller far away (air eats the highs) and wetter
 * (a generated reverb, so blasts ring across the valley). Your own jets and the wind of skiing are loops whose
 * level follows what you are doing. Every shot is pitched a little differently so repeats do not sound pasted.
 * Uses the site-wide sound settings key, so muting here mutes the other games too.
 */
(function (root) {
  'use strict';
  const KEY = 'experiments-sound-v1';
  const GAIN = 1.5; // measured: a near explosion peaks around 0.5 at the default volume

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
      this.init(new C(), null);
    },
    // ctx can be an OfflineAudioContext (for the level check); dest defaults to ctx.destination
    init(ctx, dest) {
      this.ctx = ctx;
      // a soft clipper instead of a compressor: quiet sounds pass untouched, a pile of explosions rounds off instead of clipping
      const clip = ctx.createWaveShaper(), curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 1.5) / Math.tanh(1.5); }
      clip.curve = curve;
      this.out = ctx.createGain(); this.out.gain.value = this.settings.sfx ? this.settings.volume * GAIN : 0;
      this.out.connect(clip); clip.connect(dest || ctx.destination);
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // the reverb: decaying stereo noise as an impulse, about two seconds
      const rl = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, rl, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < rl; i++) { const t = i / rl; ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 200 ? i / 200 : 1); } }
      this.verb = ctx.createConvolver(); this.verb.buffer = ir;
      const verbGain = ctx.createGain(); verbGain.gain.value = 0.55;
      const verbLp = ctx.createBiquadFilter(); verbLp.type = 'lowpass'; verbLp.frequency.value = 3500;
      this.verb.connect(verbLp); verbLp.connect(verbGain); verbGain.connect(this.out);
      // loops: own jets (hiss plus a low rumble), wind
      this.jet = this.loop(700, 0.9, 'bandpass');
      this.rumble = this.loop(180, 0.7, 'lowpass'); // low noise, no pitch: a tone here buzzes
      this.wind = this.loop(500, 0.5, 'lowpass');
    },
    set(s) { Object.assign(this.settings, s); save(this.settings); if (this.out) this.out.gain.value = this.settings.sfx ? this.settings.volume * GAIN : 0; },
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
      this.rumble.g.gain.setTargetAtTime(jetting ? 0.3 : 0, t, jetting ? 0.05 : 0.1);
      const w = Math.min(1, Math.max(0, (speed - 12) / 80));
      this.wind.g.gain.setTargetAtTime(w * w * 0.35, t, 0.2);
      this.wind.f.frequency.setTargetAtTime(300 + w * 1500, t, 0.2);
    },
    // distance fade, pan, how dull and how wet, for a sound at pos (null = right here)
    place(pos, range) {
      if (!pos) return { g: 1, pan: 0, d: 0, far: 0 };
      const L = this.listener;
      const dx = pos[0] - L.pos[0], dy = pos[1] - L.pos[1], dz = pos[2] - L.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const r = range || 300;
      if (d > r) return null;
      const g = 1 / (1 + d * d / (r * r / 25)) * (1 - d / r);
      const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
      const pan = d > 1 ? Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / d)) : 0;
      return { g, pan, d, far: Math.min(1, d / r) };
    },
    // the chain one sound plays into: gain -> air (lowpass by distance) -> pan -> out, plus a send to the reverb
    chain(pl, wet) {
      const ctx = this.ctx, gn = ctx.createGain(); gn.gain.value = pl.g;
      const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 18000 * Math.pow(1 - pl.far, 2.2) + 700;
      gn.connect(air);
      let node = air;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pl.pan; air.connect(p); node = p; }
      node.connect(this.out);
      const send = ctx.createGain(); send.gain.value = Math.min(1, (wet || 0.15) + pl.far * 0.6) * Math.max(0.25, Math.sqrt(pl.g));
      air.connect(send); send.connect(this.verb);
      return gn;
    },
    tone(dest, o) {
      const ctx = this.ctx, t = ctx.currentTime + (o.at || 0), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || o.dur));
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.a || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      osc.connect(g); g.connect(dest); osc.start(t); osc.stop(t + o.dur + 0.05);
    },
    hiss(dest, o) {
      const ctx = this.ctx, t = ctx.currentTime + (o.at || 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.noise; f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(o.from, t); f.frequency.exponentialRampToValueAtTime(o.to || o.from, t + o.dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.a || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random() * 1.5); src.stop(t + o.dur + 0.05);
    },
    // a robot voice: a buzz and a hiss through three formant filters, moved through the sounds of a word.
    // segs: [time, F1, F2, F3, buzz level, hiss level, hiss centre, pitch]; values ramp from one row to the next
    voice(dest, segs, o) {
      const ctx = this.ctx, t0 = ctx.currentTime + 0.01, k = o.pitch || 1, end = segs[segs.length - 1][0];
      const buzz = ctx.createOscillator(); buzz.type = 'sawtooth';
      const vg = ctx.createGain(); vg.gain.value = 0;
      const nz = ctx.createBufferSource(); nz.buffer = this.noise; nz.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 2.2;
      const ng = ctx.createGain(); ng.gain.value = 0;
      const sum = ctx.createGain(); sum.gain.value = o.gain || 1;
      const fq = [], Q = [7, 11, 14], lv = [3.2, 2.4, 1.4];
      for (let i = 0; i < 3; i++) {
        const f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'bandpass'; f.Q.value = Q[i]; g.gain.value = lv[i];
        vg.connect(f); f.connect(g); g.connect(sum); fq.push(f.frequency);
      }
      buzz.connect(vg); nz.connect(nf); nf.connect(ng); ng.connect(sum); sum.connect(dest);
      segs.forEach((sg, i) => {
        const t = t0 + sg[0], set = (prm, v) => i ? prm.linearRampToValueAtTime(v, t) : prm.setValueAtTime(v, t);
        for (let j = 0; j < 3; j++) set(fq[j], sg[1 + j]);
        set(vg.gain, sg[4]); set(ng.gain, sg[5]); set(nf.frequency, sg[6]); set(buzz.frequency, sg[7] * k);
      });
      buzz.start(t0); nz.start(t0, Math.random()); buzz.stop(t0 + end + 0.05); nz.stop(t0 + end + 0.05);
    },
    // amt: how big (damage for hits, used by some sounds)
    play(name, pos, range, amt) {
      if (!this.ctx || !this.settings.sfx) return;
      const now = this.ctx.currentTime;
      const key = name + (pos ? Math.round(pos[0] / 4) + ',' + Math.round(pos[2] / 4) : '');
      if (this.last[key] && now - this.last[key] < 0.04) return;
      this.last[key] = now;
      const pl = this.place(pos, range || RANGE[name]);
      if (!pl || pl.g < 0.005) return;
      const fn = SOUNDS[name];
      if (fn) fn(this, this.chain(pl, WET[name]), pl.d || 0, amt, 0.94 + Math.random() * 0.12);
    },
  };
  const RANGE = { boom: 1000, mortar: 1100, chain: 280, disc: 320, blaster: 260, plasma: 320, gl: 280, laser: 650, tfire: 320, bounce: 100, small: 500, spark: 120, land: 120, splash: 200 };
  const WET = { shazbot: 0.12, boom: 0.45, mortar: 0.3, disc: 0.2, plasma: 0.2, laser: 0.3, tfire: 0.25, small: 0.3, cap: 0.25, capLost: 0.25, win: 0.3, lose: 0.3, flagTake: 0.15, gendown: 0.4 };

  // "Shazbot!" for quick chat, said by the voice above (browsers' own speech voices are too often silent)
  const SHAZBOT = [
    [0.00, 400, 1800, 2600, 0, 0, 2600, 150],
    [0.02, 400, 1800, 2600, 0, 0.9, 2700, 150],     // sh
    [0.13, 400, 1800, 2600, 0, 0.9, 2400, 150],
    [0.15, 700, 1650, 2500, 1, 0.05, 2400, 165],     // a
    [0.30, 720, 1600, 2500, 1, 0, 2400, 190],
    [0.33, 350, 1600, 2500, 0.4, 0.45, 5200, 178],   // z
    [0.40, 300, 1500, 2400, 0.35, 0.45, 5200, 168],
    [0.42, 250, 900, 2300, 0.06, 0, 5200, 160],      // b: closed
    [0.47, 250, 900, 2300, 0.06, 0, 1200, 160],
    [0.49, 600, 1000, 2500, 1, 0.15, 1200, 178],     // b: open into o
    [0.53, 730, 1100, 2500, 1, 0, 1200, 172],        // o
    [0.66, 650, 1050, 2500, 0.85, 0, 1200, 128],
    [0.69, 500, 1600, 2600, 0, 0, 4200, 120],        // t: closed
    [0.73, 500, 1600, 2600, 0, 0, 4200, 120],
    [0.74, 500, 1600, 2600, 0, 0.7, 4200, 120],      // t: burst
    [0.80, 500, 1600, 2600, 0, 0, 4200, 120],
  ];

  // r = a small random pitch factor for each play
  const SOUNDS = {
    shazbot: (a, d, dist, amt) => a.voice(d, SHAZBOT, { pitch: amt || 1, gain: 0.3 }),
    disc: (a, d, dist, amt, r) => {
      a.tone(d, { f: 240 * r, to: 70, dur: 0.16, gain: 0.5, type: 'sine', glide: 0.12 });            // the thump
      a.hiss(d, { from: 3200 * r, to: 700, dur: 0.32, q: 1.6, gain: 0.22 });                       // the whoosh
      a.tone(d, { f: 940 * r, to: 880 * r, dur: 0.28, gain: 0.06, type: 'triangle' });              // a metal ring
      a.tone(d, { f: 1410 * r, to: 1320 * r, dur: 0.22, gain: 0.04, type: 'triangle' });
    },
    chain: (a, d, dist, amt, r) => {
      a.hiss(d, { from: 2600 * r, to: 1400, dur: 0.045, q: 1.2, gain: 0.32 });
      a.tone(d, { f: 160 * r, to: 70, dur: 0.05, gain: 0.25, type: 'square' });
    },
    blaster: (a, d, dist, amt, r) => { a.tone(d, { f: 1600 * r, to: 260, dur: 0.17, gain: 0.24, type: 'sawtooth' }); a.tone(d, { f: 800 * r, to: 200, dur: 0.12, gain: 0.12, type: 'square' }); },
    plasma: (a, d, dist, amt, r) => { a.hiss(d, { from: 500 * r, to: 2600, dur: 0.3, q: 1.5, gain: 0.45 }); a.tone(d, { f: 180 * r, to: 420, dur: 0.25, gain: 0.22, type: 'sawtooth' }); a.tone(d, { f: 90 * r, to: 60, dur: 0.15, gain: 0.3 }); },
    gl: (a, d, dist, amt, r) => { a.tone(d, { f: 150 * r, to: 60, dur: 0.18, gain: 0.5 }); a.hiss(d, { from: 900, to: 260, dur: 0.15, type: 'lowpass', gain: 0.25 }); a.tone(d, { f: 600 * r, dur: 0.04, gain: 0.08, type: 'square' }); },
    mortar: (a, d, dist, amt, r) => { a.tone(d, { f: 85 * r, to: 34, dur: 0.5, gain: 0.6 }); a.hiss(d, { from: 600, to: 90, dur: 0.45, type: 'lowpass', gain: 0.35 }); a.tone(d, { f: 300 * r, to: 120, dur: 0.12, gain: 0.15, type: 'square' }); },
    hgren: (a, d) => { a.hiss(d, { from: 900, to: 300, dur: 0.15, type: 'lowpass', gain: 0.18 }); a.tone(d, { f: 700, dur: 0.03, gain: 0.08, type: 'square' }); },
    laser: (a, d, dist, amt, r) => { a.tone(d, { f: 2800 * r, to: 900, dur: 0.35, gain: 0.18, type: 'sawtooth' }); a.tone(d, { f: 4100 * r, to: 1300, dur: 0.25, gain: 0.09 }); a.hiss(d, { from: 6000, to: 2000, dur: 0.2, type: 'highpass', gain: 0.1 }); },
    tfire: (a, d, dist, amt, r) => { a.tone(d, { f: 520 * r, to: 150, dur: 0.3, gain: 0.2, type: 'square' }); a.hiss(d, { from: 1600, to: 380, dur: 0.25, gain: 0.15 }); },
    // explosions: a deep thump you feel, a crack on top, a rolling body, then bits falling
    boom: (a, d, dist, amt, r) => {
      const far = Math.min(1, dist / 450);
      a.tone(d, { f: 75 * r, to: 28, dur: 0.75, gain: 0.55, a: 0.003 });
      a.hiss(d, { from: 2400 - far * 1600, to: 70, dur: 1.1 + far * 0.6, type: 'lowpass', q: 0.7, gain: 0.5 });
      a.hiss(d, { from: 5000, to: 1500, dur: 0.06, type: 'highpass', gain: 0.35 * (1 - far) });
      for (let i = 0; i < 6; i++) a.hiss(d, { at: 0.12 + Math.random() * 0.6, from: 3000 + Math.random() * 2000, to: 1500, dur: 0.03, type: 'bandpass', q: 3, gain: 0.05 * (1 - far) });
    },
    small: (a, d, dist, amt, r) => { a.tone(d, { f: 130 * r, to: 48, dur: 0.25, gain: 0.35 }); a.hiss(d, { from: 1800, to: 200, dur: 0.35, type: 'lowpass', gain: 0.3 }); a.hiss(d, { from: 4500, to: 2000, dur: 0.04, type: 'highpass', gain: 0.12 }); },
    spark: (a, d, dist, amt, r) => a.hiss(d, { from: 4200 * r, to: 2200, dur: 0.05, type: 'highpass', gain: 0.1 }),
    bounce: (a, d, dist, amt, r) => { a.tone(d, { f: 320 * r, to: 220, dur: 0.06, gain: 0.15, type: 'square' }); a.tone(d, { f: 90, dur: 0.05, gain: 0.12 }); },
    // a crisp tick when your shot lands: higher and fuller for a bigger hit
    hit: (a, d, dist, amt) => {
      const k = Math.min(1, (amt || 10) / 45);
      a.tone(d, { f: 2400 + k * 900, dur: 0.06, gain: 0.09 + k * 0.06 });
      a.tone(d, { f: 3700 + k * 1200, dur: 0.04, gain: 0.06 + k * 0.05 });
      a.hiss(d, { from: 6000, to: 4000, dur: 0.02, type: 'highpass', gain: 0.08 });
      if (k > 0.5) a.tone(d, { f: 180, to: 90, dur: 0.08, gain: 0.15 });
    },
    hurt: (a, d) => { a.hiss(d, { from: 450, to: 120, dur: 0.2, type: 'lowpass', gain: 0.45 }); a.tone(d, { f: 140, to: 70, dur: 0.16, gain: 0.35, type: 'triangle' }); a.hiss(d, { from: 2500, to: 1200, dur: 0.05, gain: 0.1 }); },
    kill: (a, d) => {
      a.tone(d, { f: 160, to: 60, dur: 0.18, gain: 0.3 });
      a.tone(d, { f: 1175, dur: 0.18, gain: 0.16, type: 'triangle' }); a.tone(d, { f: 2350, dur: 0.12, gain: 0.05 });
      a.tone(d, { f: 1568, at: 0.09, dur: 0.35, gain: 0.16, type: 'triangle' }); a.tone(d, { f: 3136, at: 0.09, dur: 0.2, gain: 0.05 });
    },
    die: (a, d) => { a.tone(d, { f: 280, to: 55, dur: 0.9, gain: 0.25, type: 'sawtooth' }); a.hiss(d, { from: 800, to: 90, dur: 0.9, type: 'lowpass', gain: 0.35 }); a.tone(d, { f: 70, to: 35, dur: 0.6, gain: 0.4 }); },
    dry: (a, d) => { a.tone(d, { f: 900, dur: 0.025, gain: 0.12, type: 'square' }); a.tone(d, { f: 600, at: 0.03, dur: 0.02, gain: 0.08, type: 'square' }); },
    station: (a, d) => { a.tone(d, { f: 220, to: 880, dur: 0.6, gain: 0.15, type: 'triangle' }); a.hiss(d, { from: 300, to: 4000, dur: 0.6, q: 4, gain: 0.08 }); a.tone(d, { f: 1320, at: 0.5, dur: 0.3, gain: 0.12 }); a.tone(d, { f: 1760, at: 0.58, dur: 0.35, gain: 0.1 }); },
    switch: (a, d) => { a.tone(d, { f: 700, dur: 0.04, gain: 0.1, type: 'square' }); a.hiss(d, { at: 0.03, from: 3000, to: 1200, dur: 0.05, gain: 0.08 }); a.tone(d, { f: 480, at: 0.07, dur: 0.05, gain: 0.1, type: 'square' }); },
    land: (a, d) => { a.hiss(d, { from: 400, to: 90, dur: 0.2, type: 'lowpass', gain: 0.4 }); a.tone(d, { f: 90, to: 50, dur: 0.12, gain: 0.3 }); },
    splash: (a, d) => { a.hiss(d, { from: 1200, to: 300, dur: 0.6, type: 'lowpass', gain: 0.45 }); a.hiss(d, { at: 0.05, from: 5000, to: 1500, dur: 0.4, type: 'bandpass', q: 0.7, gain: 0.15 }); },
    spawn: (a, d) => { a.hiss(d, { from: 200, to: 3000, dur: 0.6, q: 2, gain: 0.15 }); a.tone(d, { f: 440, to: 880, dur: 0.5, gain: 0.08 }); },
    flagTake: (a, d) => { for (let i = 0; i < 6; i++) a.tone(d, { f: i % 2 ? 660 : 880, at: i * 0.11, dur: 0.1, gain: 0.12, type: 'square' }); },
    flagOurs: (a, d) => { for (let i = 0; i < 6; i++) a.tone(d, { f: i % 2 ? 330 : 247, at: i * 0.14, dur: 0.13, gain: 0.14, type: 'sawtooth' }); },
    cap: (a, d) => { [523, 659, 784, 1047, 1319].forEach((f, i) => a.tone(d, { f, at: i * 0.1, dur: 0.6, gain: 0.14, type: 'triangle' })); a.tone(d, { f: 65, to: 40, dur: 0.6, gain: 0.3 }); },
    capLost: (a, d) => [440, 392, 330, 262].forEach((f, i) => a.tone(d, { f, at: i * 0.16, dur: 0.5, gain: 0.14, type: 'triangle' })),
    ret: (a, d) => { a.tone(d, { f: 784, dur: 0.2, gain: 0.12 }); a.tone(d, { f: 1047, at: 0.12, dur: 0.35, gain: 0.12 }); },
    drop: (a, d) => { a.tone(d, { f: 400, to: 250, dur: 0.3, gain: 0.12, type: 'triangle' }); },
    gendown: (a, d) => { a.tone(d, { f: 220, to: 40, dur: 1.4, gain: 0.25, type: 'sawtooth' }); a.tone(d, { f: 60, to: 25, dur: 1.2, gain: 0.3 }); },
    genup: (a, d) => { a.tone(d, { f: 60, to: 240, dur: 1.0, gain: 0.2, type: 'sawtooth' }); },
    chat: (a, d) => a.tone(d, { f: 1200, dur: 0.06, gain: 0.08 }),
    win: (a, d) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => a.tone(d, { f, at: i * 0.15, dur: 0.6, gain: 0.15, type: 'triangle' })),
    lose: (a, d) => [392, 349, 311, 262].forEach((f, i) => a.tone(d, { f, at: i * 0.22, dur: 0.6, gain: 0.15, type: 'triangle' })),
    shield: (a, d) => { a.tone(d, { f: 600, to: 1300, dur: 0.1, gain: 0.1 }); a.hiss(d, { from: 3000, to: 6000, dur: 0.1, q: 3, gain: 0.05 }); },
  };
  A.SOUNDS = SOUNDS;
  root.JFAudio = A;
})(window);
