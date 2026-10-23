/*
 * The band's sound, made in the browser with Web Audio (no samples, no files), the clock everything is timed by, and the mic.
 * Browser only. The notes come from RN.arrange, so the sound always matches the charts.
 */
(function (root) {
  'use strict';

  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  function shaperCurve(k) {
    const n = 2048, c = new Float32Array(n), norm = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i * 2 / (n - 1) - 1; c[i] = Math.tanh(k * x) / norm; }
    return c;
  }

  // How loud each part sits in the mix before anyone misses.
  const LEVEL = { drums: 0.55, bass: 0.1, guitar: 0.13, vocals: 0.3, keys: 0.22, click: 0.35 };

  // One song's sound. Made fresh for each song and thrown away after, so stopping never leaves notes behind.
  class Mixer {
    constructor(ctx, dest) {
      this.ctx = ctx;
      const out = this.out = ctx.createGain();
      out.connect(dest || ctx.destination);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.25;
      comp.connect(out);
      this.bus = {}; this.gain = {};
      for (const p of Object.keys(LEVEL)) {
        const g = ctx.createGain(); g.gain.value = LEVEL[p]; g.connect(comp);
        this.bus[p] = g; this.gain[p] = 1;
      }
      // guitar: per-note filter (palm mutes are dark) into one distortion, so chords grind together like an amp
      const gin = ctx.createGain(); gin.gain.value = 3;
      const sh = ctx.createWaveShaper(); sh.curve = shaperCurve(2.6); sh.oversample = '2x';
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100;
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1700; pk.gain.value = 3; pk.Q.value = 0.9;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = 0.5;
      gin.connect(sh); sh.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(this.bus.guitar);
      this.gtrIn = gin;
      const bin = ctx.createGain(); bin.gain.value = 1.4;
      const bsh = ctx.createWaveShaper(); bsh.curve = shaperCurve(1.2);
      const blp = ctx.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 2200;
      bin.connect(bsh); bsh.connect(blp); blp.connect(this.bus.bass);
      this.bassIn = bin;
      const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = nb;
    }

    // 1 is normal, lower when the player misses, 0 when the part is somebody's mic
    setPart(part, g) {
      if (!(part in this.bus) || this.gain[part] === g) return;
      this.gain[part] = g;
      this.bus[part].gain.setTargetAtTime(LEVEL[part] * g, this.ctx.currentTime, 0.03);
    }

    close() {
      const t = this.ctx.currentTime;
      this.out.gain.setTargetAtTime(0, t, 0.03);
      setTimeout(() => { try { this.out.disconnect(); } catch (e) { /* gone */ } }, 400);
    }

    // ---- building blocks ----
    env(g, at, a, peak, hold, rel, sus) {
      const p = g.gain;
      p.setValueAtTime(0.0001, at);
      p.exponentialRampToValueAtTime(peak, at + a);
      p.exponentialRampToValueAtTime(Math.max(0.0001, sus === undefined ? peak : sus), at + a + Math.max(0.001, hold));
      p.exponentialRampToValueAtTime(0.0001, at + a + hold + rel);
      return at + a + hold + rel;
    }
    osc(type, f, at, end, dest) {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.setValueAtTime(f, at);
      o.connect(dest); o.start(at); o.stop(end + 0.02);
      return o;
    }
    noise(at, end, dest) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf; s.connect(dest);
      s.start(at, Math.random() * 1.5); s.stop(end + 0.02);
      return s;
    }
    filter(type, f, q, dest) {
      const b = this.ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f; if (q) b.Q.value = q;
      if (dest) b.connect(dest);
      return b;
    }
    gainTo(dest) { const g = this.ctx.createGain(); g.gain.value = 0; g.connect(dest); return g; }

    // ---- instruments ----
    drum(k, at) {
      const b = this.bus.drums;
      if (k === 'kick') {
        const g = this.gainTo(b), end = this.env(g, at, 0.002, 1, 0.03, 0.3, 0.6);
        const o = this.osc('sine', 150, at, end, g);
        o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
        const c = this.gainTo(b);
        this.env(c, at, 0.001, 0.3, 0.004, 0.02);
        this.noise(at, at + 0.03, this.filter('highpass', 2500, 0, c));
      } else if (k === 'snare') {
        const g = this.gainTo(b), end = this.env(g, at, 0.001, 0.55, 0.02, 0.17, 0.3);
        this.noise(at, end, this.filter('bandpass', 1900, 0.7, g));
        const t = this.gainTo(b), e2 = this.env(t, at, 0.001, 0.35, 0.01, 0.09);
        const o = this.osc('triangle', 200, at, e2, t);
        o.frequency.exponentialRampToValueAtTime(160, at + 0.08);
      } else if (k === 'hat' || k === 'ohat') {
        const g = this.gainTo(b), end = this.env(g, at, 0.001, k === 'hat' ? 0.16 : 0.14, 0.005, k === 'hat' ? 0.045 : 0.3);
        this.noise(at, end, this.filter('highpass', 7500, 0, g));
      } else if (k === 'crash' || k === 'ride') {
        const g = this.gainTo(b), end = this.env(g, at, 0.002, k === 'crash' ? 0.3 : 0.12, 0.05, k === 'crash' ? 1.4 : 0.6, 0.18);
        this.noise(at, end, this.filter('highpass', 4500, 0, g));
      } else {
        const f = { tom1: 210, tom2: 160, tom3: 115 }[k] || 160;
        const g = this.gainTo(b), end = this.env(g, at, 0.002, 0.7, 0.02, 0.28);
        const o = this.osc('sine', f, at, end, g);
        o.frequency.exponentialRampToValueAtTime(f * 0.62, at + 0.25);
      }
    }

    guitar(e, at, len) {
      const ps = e.p;
      for (const p of ps) {
        const f = hz(p);
        const g = this.gainTo(this.gtrIn);
        const lp = this.filter('lowpass', e.pm ? 750 : e.lead ? 3600 : 3000, e.pm ? 1.4 : 0.7, g);
        const peak = (e.lead ? 0.3 : 0.2) / Math.sqrt(ps.length);
        const end = e.pm ? this.env(g, at, 0.002, peak, 0.03, 0.1, peak * 0.4)
          : this.env(g, at, 0.003, peak, Math.max(0.02, len - 0.05), 0.05, peak * (len > 1 ? 0.45 : 0.75));
        const a = this.osc('sawtooth', f, at, end, lp), b = this.osc('sawtooth', f, at, end, lp);
        a.detune.value = -7; b.detune.value = 7;
        if (e.lead && len > 0.3) { // vibrato on longer lead notes
          const lfo = this.ctx.createOscillator(), dep = this.ctx.createGain();
          lfo.frequency.value = 5.5; dep.gain.setValueAtTime(0, at); dep.gain.linearRampToValueAtTime(14, at + Math.min(0.4, len));
          lfo.connect(dep); dep.connect(a.detune); dep.connect(b.detune);
          lfo.start(at); lfo.stop(end + 0.02);
        }
      }
    }

    bass(e, at, len) {
      const f = hz(e.p[0]);
      const g = this.gainTo(this.bassIn);
      const end = this.env(g, at, 0.004, 0.55, Math.max(0.03, len - 0.04), 0.05, 0.38);
      const lp = this.filter('lowpass', 1300, 2, g);
      lp.frequency.setValueAtTime(1300, at);
      lp.frequency.exponentialRampToValueAtTime(380, at + 0.2);
      this.osc('sawtooth', f, at, end, lp);
      const s = this.gainTo(g); s.gain.value = 0.8;
      this.osc('sine', f, at, end, s);
    }

    keys(e, at, len) {
      const g = this.gainTo(this.bus.keys);
      const end = this.env(g, at, 0.12, 0.09, Math.max(0.05, len - 0.15), 0.35, 0.07);
      const lp = this.filter('lowpass', 1600, 0.5, g);
      for (const p of e.p) { const o = this.osc('triangle', hz(p), at, end, lp); o.detune.value = (p % 3) * 4 - 4; }
    }

    voice(e, at, len) {
      const f = hz(e.p);
      const g = this.gainTo(this.bus.vocals);
      const end = this.env(g, at, 0.04, 0.3, Math.max(0.04, len - 0.1), 0.08, 0.24);
      const lp = this.filter('lowpass', 2200, 0.7, g);
      const a = this.osc('triangle', f, at, end, lp);
      const bg = this.ctx.createGain(); bg.gain.value = 0.25; bg.connect(lp);
      const b = this.osc('sine', f * 2, at, end, bg);
      const lfo = this.ctx.createOscillator(), dep = this.ctx.createGain();
      lfo.frequency.value = 5; dep.gain.setValueAtTime(0, at); dep.gain.linearRampToValueAtTime(20, at + Math.min(0.5, len));
      lfo.connect(dep); dep.connect(a.detune); dep.connect(b.detune);
      lfo.start(at); lfo.stop(end + 0.02);
    }

    click(at, accent) {
      const g = this.gainTo(this.bus.click), end = this.env(g, at, 0.001, accent ? 0.6 : 0.4, 0.005, 0.04);
      this.osc('sine', accent ? 2000 : 1500, at, end, g);
    }

    // a dull clunk when you miss, like a string hit with no note
    clunk() {
      const at = this.ctx.currentTime + 0.005;
      const g = this.gainTo(this.out), end = this.env(g, at, 0.002, 0.18, 0.02, 0.1);
      this.noise(at, end, this.filter('bandpass', 320, 1.5, g));
      const o = this.osc('sawtooth', 92, at, end, this.filter('lowpass', 500, 0, g));
      o.detune.value = 30;
    }
  }

  // Plays an arrangement from context time `start` (song time 0). pump() schedules what falls in the next moment.
  class SongPlayer {
    constructor(mixer, arr) {
      this.m = mixer; this.arr = arr; this.start = null;
      this.idx = { drums: 0, bass: 0, guitar: 0, keys: 0, vocals: 0 };
      this.clicks = 0;
    }
    begin(start) { this.start = start; for (const k in this.idx) this.idx[k] = 0; this.clicks = 0; }
    pump(now) {
      if (this.start === null) return;
      const spb = this.arr.spb, horizon = now + 0.3, s = this.start, m = this.m;
      // a bar of count-in clicks
      while (this.clicks < 4 && s + (this.clicks - 4) * spb < horizon) {
        const at = s + (this.clicks - 4) * spb;
        if (at > now - 0.02 && at >= 0) m.click(at, this.clicks === 0);
        this.clicks++;
      }
      for (const part of Object.keys(this.idx)) {
        const list = this.arr.parts[part];
        while (this.idx[part] < list.length) {
          const e = list[this.idx[part]], when = s + e.t * spb;
          if (when >= horizon) break;
          this.idx[part]++;
          if (when < now - 0.02) continue;
          const at = Math.max(0, when);
          const len = (e.d || 0) * spb;
          if (part === 'drums') m.drum(e.k, at);
          else if (part === 'guitar') m.guitar(e, at, len);
          else if (part === 'bass') m.bass(e, at, len);
          else if (part === 'keys') m.keys(e, at, len);
          else m.voice(e, at, len);
        }
      }
    }
  }

  // Maps performance.now() to context time as it is heard, so a tap lines up with the note you heard, not the one being made.
  class Clock {
    constructor(ctx) { this.ctx = ctx; this.off = null; }
    reset() { this.off = null; }
    sample() {
      const ctx = this.ctx;
      let ct = 0, pt = 0;
      if (ctx.getOutputTimestamp) { try { const ts = ctx.getOutputTimestamp(); ct = ts.contextTime; pt = ts.performanceTime; } catch (e) { /* older browser */ } }
      if (!(pt > 0) || !(ct > 0)) { ct = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0); pt = performance.now(); }
      const off = ct - pt / 1000;
      if (this.off === null || Math.abs(off - this.off) > 0.04) this.off = off;
      else this.off += (off - this.off) * 0.05;
    }
    at(perfMs) { if (this.off === null) this.sample(); return perfMs / 1000 + this.off; }
    now() { return this.at(performance.now()); }
  }

  // The mic, for singing or a real instrument. Echo cancelling helps a voice over a speaker but eats a guitar's long notes.
  const MIC_RANGE = { vocals: [75, 1000], guitar: [72, 1400], bass: [36, 420] };
  class Mic {
    static async open(ctx, kind) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot use the mic here.');
      const voice = kind === 'vocals';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: voice, noiseSuppression: false, autoGainControl: voice } });
      return new Mic(ctx, stream, kind);
    }
    constructor(ctx, stream, kind) {
      this.ctx = ctx; this.stream = stream; this.kind = kind;
      const src = this.src = ctx.createMediaStreamSource(stream);
      const an = this.an = ctx.createAnalyser();
      an.fftSize = kind === 'bass' ? 4096 : 2048; an.smoothingTimeConstant = 0;
      src.connect(an);
      this.sink = ctx.createGain(); this.sink.gain.value = 0; this.sink.connect(ctx.destination);
      an.connect(this.sink);
      if (kind !== 'vocals') {
        this.spec = ctx.createAnalyser(); this.spec.fftSize = 8192; this.spec.smoothingTimeConstant = 0.1;
        src.connect(this.spec); this.spec.connect(this.sink);
        this.db = new Float32Array(this.spec.frequencyBinCount);
      }
      this.buf = new Float32Array(an.fftSize);
      this.onsets = new root.RNDSP.Onsets();
      this.range = MIC_RANGE[kind] || MIC_RANGE.vocals;
      this.level = 0;
    }
    // seconds between a sound reaching the mic and the middle of what read() looks at
    get lag() { return this.an.fftSize / 2 / this.ctx.sampleRate; }
    read(t) {
      const D = root.RNDSP, sr = this.ctx.sampleRate;
      this.an.getFloatTimeDomainData(this.buf);
      const recent = this.buf.subarray(this.buf.length - 512);
      const level = D.rms(recent);
      this.level = level;
      const p = D.yin(this.buf, sr, { lo: this.range[0], hi: this.range[1] });
      let chroma = null;
      if (this.spec && level > 0.003) {
        this.spec.getFloatFrequencyData(this.db);
        chroma = D.chroma(this.db, sr, this.spec.fftSize, this.kind === 'bass' ? { lo: 38, hi: 700 } : {});
      }
      return { t, f: p.f, conf: p.conf, chroma, onset: this.onsets.push(level, t), level };
    }
    close() {
      try { this.stream.getTracks().forEach(tr => tr.stop()); } catch (e) { /* gone */ }
      try { this.src.disconnect(); this.sink.disconnect(); } catch (e) { /* gone */ }
    }
  }

  root.RNAudio = { Mixer, SongPlayer, Clock, Mic, LEVEL };
})(window);
