/*
 * Sounds for the games: short effects for things that happen, and a very quiet generative space ambience that is off until you turn it on.
 *
 * Everything is made in the browser with the Web Audio API (oscillators and noise), so there are no sound files to load or license.
 * Browsers only allow sound after the person has touched the page, so the audio starts on the first tap or key press.
 * The settings (effects on/off, music on/off, volume) are saved on the device and shared by every game on this site.
 *
 * Nothing here touches the game rules: it only listens to what the page already knows.
 */
(function (root) {
  'use strict';

  const KEY = 'experiments-sound-v1';
  const DEFAULTS = { sfx: true, music: false, volume: 0.6 };

  // Whatever is in storage, turned into settings that are safe to use.
  function cleanSettings(raw) {
    let o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ...DEFAULTS };
    const v = typeof o.volume === 'number' && Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : DEFAULTS.volume;
    return { sfx: typeof o.sfx === 'boolean' ? o.sfx : DEFAULTS.sfx, music: o.music === true, volume: v };
  }

  // note names to frequencies, so the sounds below read like music
  const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568.0 };
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  // The sound engine for one AudioContext (a real one in the page, an offline one when testing).
  function engine(ctx, dest, opts) {
    // effects go through their own gain so they can sit above the quiet music; the music goes straight to dest
    const sfx = ctx.createGain(); sfx.gain.value = (opts && opts.sfxGain) || 1; sfx.connect(dest);
    let noiseBuf = null;
    const noise = () => {
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      return noiseBuf;
    };

    function tone(o) {
      const t = o.at, osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
      const a = o.a || 0.006, peak = o.gain === undefined ? 0.25 : o.gain;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      osc.connect(g); g.connect(sfx);
      osc.start(t); osc.stop(t + o.dur + 0.05);
    }

    function hiss(o) { // filtered noise: whooshes and thumps
      const t = o.at, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noise();
      f.type = o.type || 'bandpass'; f.Q.value = o.q || 1.2;
      f.frequency.setValueAtTime(o.from, t);
      f.frequency.exponentialRampToValueAtTime(o.to || o.from, t + o.dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.gain === undefined ? 0.2 : o.gain, t + (o.a || 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(f); f.connect(g); g.connect(sfx);
      src.start(t, Math.random()); src.stop(t + o.dur + 0.05);
    }

    // a note with a soft second harmonic, like a small bell
    const bell = (f, at, dur, gain) => { tone({ f, at, dur, gain }); tone({ f: f * 2.01, at, dur: dur * 0.6, gain: (gain || 0.25) * 0.25 }); };

    const SOUNDS = {
      // a small click for each press of an angle or power button. x (0 to 1) is how far along the dial it is, so it climbs as the number does
      adjust: (t, x) => { const f = 380 + 760 * Math.min(1, Math.max(0, x || 0)); tone({ f, to: f * 0.8, at: t, dur: 0.045, type: 'square', gain: 0.13 }); },
      tick: t => tone({ f: 1500, to: 950, at: t, dur: 0.05, gain: 0.14 }),
      build: t => { tone({ f: 520, at: t, dur: 0.08, type: 'triangle', gain: 0.18 }); tone({ f: 780, at: t + 0.07, dur: 0.1, type: 'triangle', gain: 0.18 }); },
      launch: t => { hiss({ at: t, dur: 0.45, from: 300, to: 2600, q: 1.4, gain: 0.22 }); tone({ f: 180, to: 520, at: t, dur: 0.4, gain: 0.1, type: 'triangle' }); },
      end: t => { tone({ f: 120, to: 62, at: t, dur: 0.2, gain: 0.3 }); tone({ f: 180, to: 90, at: t + 0.11, dur: 0.16, gain: 0.2 }); },
      turn: t => { bell(NOTE.E5, t, 0.55, 0.22); bell(NOTE.B5, t + 0.13, 0.7, 0.2); },
      yourmove: t => { bell(NOTE.A5, t, 0.5, 0.14); bell(NOTE.C6, t + 0.1, 0.5, 0.14); bell(NOTE.E6, t + 0.2, 0.7, 0.14); },
      join: t => { tone({ f: 660, to: 880, at: t, dur: 0.14, type: 'triangle', gain: 0.22 }); bell(NOTE.E6, t + 0.12, 0.35, 0.13); },
      leave: t => { tone({ f: 620, to: 400, at: t, dur: 0.22, type: 'triangle', gain: 0.17 }); tone({ f: 400, to: 300, at: t + 0.15, dur: 0.25, type: 'triangle', gain: 0.1 }); },
      good: t => ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => bell(NOTE[n], t + i * 0.07, 0.35, 0.18)),
      bad: t => tone({ f: 230, to: 130, at: t, dur: 0.28, type: 'sawtooth', gain: 0.09 }),
      battle: t => { hiss({ at: t, dur: 0.35, from: 900, to: 120, type: 'lowpass', q: 0.7, gain: 0.34 }); tone({ f: 95, to: 42, at: t, dur: 0.3, gain: 0.3 }); },
      research: t => { tone({ f: 560, to: 1250, at: t, dur: 0.5, gain: 0.12 }); bell(NOTE.G5, t + 0.35, 0.4, 0.14); bell(NOTE.C6, t + 0.45, 0.5, 0.14); },
      win: t => ['C5', 'E5', 'G5', 'C6', 'E6'].forEach((n, i) => bell(NOTE[n], t + i * 0.12, 0.9, 0.2)),
      lose: t => [[NOTE.A4, 0], [NOTE.G4, 0.22], [NOTE.E4, 0.44], [NOTE.C4 / 1.0, 0.7]].forEach(([f, d]) => tone({ f, at: t + d, dur: 0.7, type: 'triangle', gain: 0.17 })),
      start: t => { hiss({ at: t, dur: 0.5, from: 200, to: 3000, q: 1.2, gain: 0.18 }); bell(NOTE.G5, t + 0.3, 0.6, 0.17); bell(NOTE.C6, t + 0.4, 0.8, 0.17); },
      nope: t => tone({ f: 200, to: 160, at: t, dur: 0.12, type: 'square', gain: 0.07 }),
      // Warp Traders
      warp: t => { hiss({ at: t, dur: 0.5, from: 250, to: 2200, q: 1.0, gain: 0.2 }); tone({ f: 110, to: 700, at: t, dur: 0.45, gain: 0.12, type: 'triangle' }); },
      coin: t => { tone({ f: 1568, at: t, dur: 0.08, type: 'square', gain: 0.07 }); tone({ f: 2093, at: t + 0.07, dur: 0.18, type: 'square', gain: 0.07 }); },
      // Tank Wars and the adventures
      shoot: t => { hiss({ at: t, dur: 0.18, from: 1400, to: 300, type: 'lowpass', q: 0.8, gain: 0.3 }); tone({ f: 150, to: 60, at: t, dur: 0.16, gain: 0.22, type: 'triangle' }); },
      boom: t => { hiss({ at: t, dur: 0.6, from: 1100, to: 90, type: 'lowpass', q: 0.7, gain: 0.4 }); tone({ f: 90, to: 38, at: t, dur: 0.5, gain: 0.35 }); },
      thud: t => { hiss({ at: t, dur: 0.18, from: 500, to: 120, type: 'lowpass', q: 0.7, gain: 0.2 }); tone({ f: 110, to: 55, at: t, dur: 0.15, gain: 0.2 }); },
      ding: t => { bell(NOTE.E6, t, 0.4, 0.12); bell(NOTE.G6, t + 0.09, 0.5, 0.1); },
      die: t => [[NOTE.E4, 0], [NOTE.D4, 0.2], [NOTE.C4, 0.4], [NOTE.C4 / 2, 0.7]].forEach(([f, d]) => tone({ f, at: t + d, dur: 0.5, type: 'square', gain: 0.06 })),
      alarm: t => { for (let i = 0; i < 4; i++) tone({ f: i % 2 ? 330 : 440, at: t + i * 0.13, dur: 0.12, type: 'square', gain: 0.07 }); },
    };

    // ----- the ambience -----
    // Slow chords (A minor family) that fade in and out, with a few soft high notes drifting over them through a long echo.
    const CHORDS = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]];
    const PENT = [69, 72, 74, 76, 79, 81, 84]; // A minor pentatonic-ish, the "stars"
    const BAR = 9; // seconds per chord
    let mus = null;
    // Other moods for other games. 'space' is the default above; each plays a loop of its own, and stays far under the effects.
    const STYLE_LEN = { space: BAR, march: 6, storybook: 6 };
    const STYLE_GAIN = { space: 1, march: 2, storybook: 1.8 }; // the new beds are made of sparser sounds, so they need a little more to sit at the same loudness

    // a soft note into the music bus (not the effects bus)
    function mnote(o) {
      const t = o.at, osc = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      osc.type = o.type || 'triangle'; osc.frequency.value = o.f;
      f.type = 'lowpass'; f.frequency.value = o.lp || 1200;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.gain, t + (o.a || 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      osc.connect(f); f.connect(g); g.connect(mus.dry); if (o.wet) { const w = ctx.createGain(); w.gain.value = o.wet; g.connect(w); w.connect(mus.send); }
      osc.start(t); osc.stop(t + o.dur + 0.05);
    }
    function mdrum(t, kind, gain) { // kind: 'kick' a low thump, 'snare' a soft tap of noise
      if (kind === 'kick') { const osc = ctx.createOscillator(), g = ctx.createGain(); osc.frequency.setValueAtTime(95, t); osc.frequency.exponentialRampToValueAtTime(48, t + 0.18); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28); osc.connect(g); g.connect(mus.dry); osc.start(t); osc.stop(t + 0.3); return; }
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noise(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 0.9;
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      src.connect(f); f.connect(g); g.connect(mus.dry); src.start(t, 0.3); src.stop(t + 0.12);
    }

    // Tank Wars: a slow march. Low drum on every other beat, soft snare taps, a walking bass and a mellow horn tune. 80 beats a minute.
    const MARCH_ROOTS = [38, 41, 43, 45];                      // D F G A, the bass for each bar of the loop
    const MARCH_TUNES = [
      [[0, 62, 1.5], [1.5, 65, 0.5], [2, 69, 2], [4, 67, 1.5], [5.5, 65, 0.5], [6, 62, 2]],
      [[0, 65, 1.5], [1.5, 67, 0.5], [2, 70, 2], [4, 69, 1.5], [5.5, 67, 0.5], [6, 65, 2]],
      [[0, 67, 1.5], [1.5, 70, 0.5], [2, 74, 2], [4, 72, 1.5], [5.5, 70, 0.5], [6, 67, 2]],
      [[0, 69, 1], [1, 72, 1], [2, 69, 1], [3, 67, 1], [4, 65, 2], [6, 69, 1.5]],
    ];
    function scheduleMarch(t0, n) {
      const beat = 0.75, k = n % 4;
      for (let b = 0; b < 8; b++) {
        if (b % 2 === 0) mdrum(t0 + b * beat, 'kick', b % 4 === 0 ? 0.2 : 0.12); else mdrum(t0 + b * beat, 'snare', 0.07);
      }
      mdrum(t0 + 7.5 * beat, 'snare', 0.05);
      for (const b of [0, 2, 4, 6]) mnote({ f: hz(MARCH_ROOTS[k] + (b % 4 === 2 ? 7 : 0)), at: t0 + b * beat, dur: beat * 1.7, gain: 0.1, lp: 420, type: 'triangle' });
      for (const [b, m, d] of MARCH_TUNES[k]) mnote({ f: hz(m), at: t0 + b * beat, dur: d * beat * 0.95, gain: 0.07, lp: 900, a: 0.06, wet: 0.5 });
    }

    // Adventures: soft plucked strings, a slow chord loop (C G Am F) with now and then a high bell note.
    const STORY_CHORDS = [[48, 55, 60, 64], [43, 50, 55, 59], [45, 52, 57, 60], [41, 48, 53, 57]];
    function scheduleStory(t0, n) {
      const ch = STORY_CHORDS[n % 4], beat = 0.75, order = [0, 1, 2, 3, 2, 1, 2, 1];
      for (let b = 0; b < 8; b++) mnote({ f: hz(ch[order[b]] + (order[b] > 1 ? 12 : 0)), at: t0 + b * beat, dur: 1.1, gain: b % 4 === 0 ? 0.11 : 0.08, lp: 1500, a: 0.008, wet: 0.5 });
      mnote({ f: hz(ch[0] - 12), at: t0, dur: 3.2, gain: 0.09, lp: 300, a: 0.1, type: 'sine' });
      if (n % 2) { const m = PENT[(Math.random() * PENT.length) | 0] - 12, t = t0 + 2 + Math.random() * 3; mnote({ f: hz(m), at: t, dur: 1.6, gain: 0.05, lp: 3000, a: 0.01, type: 'sine', wet: 0.8 }); }
    }

    function reverb(seconds) {
      const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5); }
      const cv = ctx.createConvolver(); cv.buffer = buf; return cv;
    }

    function startMusic(level, horizon, style) { // horizon: how many seconds ahead to schedule (tests render a whole stretch at once)
      if (mus) return;
      style = Object.prototype.hasOwnProperty.call(STYLE_LEN, style) ? style : 'space'; // never STYLE_LEN[name] on its own: 'constructor' is a key too
      const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(dest);
      out.gain.setTargetAtTime(level * STYLE_GAIN[style], ctx.currentTime, 2.5);   // fades in over a few seconds
      const dry = ctx.createGain(); dry.gain.value = 0.8; dry.connect(out);
      const rv = reverb(3.2), wet = ctx.createGain(); wet.gain.value = 0.9; rv.connect(wet); wet.connect(out);
      const send = ctx.createGain(); send.gain.value = 0.7; send.connect(rv);
      const echo = ctx.createDelay(2); echo.delayTime.value = 0.62;
      const fb = ctx.createGain(); fb.gain.value = 0.42; echo.connect(fb); fb.connect(echo);
      const eo = ctx.createGain(); eo.gain.value = 0.5; echo.connect(eo); eo.connect(send); eo.connect(dry);
      mus = { out, dry, send, echo, style, len: STYLE_LEN[style], next: ctx.currentTime + 0.1, bar: 0, timer: 0, stars: ctx.currentTime + 4 };
      const pump = () => {
        if (!mus) return;
        while (mus.next < ctx.currentTime + (horizon || 12)) { (mus.style === 'march' ? scheduleMarch : mus.style === 'storybook' ? scheduleStory : scheduleBar)(mus.next, mus.bar++); mus.next += mus.len; }
        mus.timer = setTimeout(pump, 2000);
      };
      pump();
    }

    function scheduleBar(t0, n) {
      const chord = CHORDS[n % CHORDS.length];
      for (const m of chord) {
        for (const det of [-5, 5]) {
          const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
          o.type = m < 50 ? 'sine' : 'triangle'; o.frequency.value = hz(m); o.detune.value = det + (Math.random() - 0.5) * 4;
          f.type = 'lowpass'; f.frequency.value = 700 + Math.random() * 300;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.linearRampToValueAtTime(0.055, t0 + BAR * 0.42);
          g.gain.linearRampToValueAtTime(0.0001, t0 + BAR * 1.18);
          o.connect(f); f.connect(g); g.connect(mus.dry); g.connect(mus.send);
          o.start(t0); o.stop(t0 + BAR * 1.2 + 0.1);
        }
      }
      // a few notes high above, at uneven gaps
      let t = Math.max(t0, mus.stars);
      while (t < t0 + BAR) {
        const m = PENT[(Math.random() * PENT.length) | 0], o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = hz(m);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        o.connect(g); g.connect(mus.echo); g.connect(mus.send);
        o.start(t); o.stop(t + 2);
        t += 1.6 + Math.random() * 3.4;
      }
      mus.stars = t;
    }

    function stopMusic() {
      if (!mus) return;
      const m = mus; mus = null;
      clearTimeout(m.timer);
      m.out.gain.cancelScheduledValues(ctx.currentTime);
      m.out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6);  // fades out, then the graph is dropped
      setTimeout(() => { try { m.out.disconnect(); } catch (e) { /* gone */ } }, 4000);
    }

    return {
      names: Object.keys(SOUNDS),
      play(name, at, arg) { const f = SOUNDS[name]; if (f) f(at === undefined ? ctx.currentTime + 0.005 : at, arg); return !!f; },
      startMusic, stopMusic, get musicOn() { return !!mus; }, setMusicLevel(l) { if (mus) mus.out.gain.setTargetAtTime(l * STYLE_GAIN[mus.style], ctx.currentTime, 0.2); },
    };
  }

  // ----- the page's sound: settings, unlocking, and the settings dialog -----
  const S = {
    settings: { ...DEFAULTS },
    ctx: null, eng: null, master: null,
    last: {},       // sound name -> when it last played, so a burst of the same event is one sound
    GAP: { adjust: 30 },    // the same sound again sooner than this many ms is dropped (90 for any other)
    MUSIC_LEVEL: 0.4,   // the ambience is meant to sit far under the effects
    SFX_GAIN: 2.2,

    cleanSettings, engine, DEFAULTS,

    load() {
      let raw = null;
      try { raw = root.localStorage.getItem(KEY); } catch (e) { /* blocked */ }
      this.settings = cleanSettings(raw);
      return this;
    },
    save() { try { root.localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch (e) { /* blocked */ } },

    // the audio context is made only when it is first needed, and only ever after a tap or key press
    ensure() {
      if (this.ctx) return this.ctx;
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.settings.volume;
        const comp = this.ctx.createDynamicsCompressor(); // keeps a busy moment from clipping
        this.master.connect(comp); comp.connect(this.ctx.destination);
        this.eng = engine(this.ctx, this.master, { sfxGain: this.SFX_GAIN });
      } catch (e) { this.ctx = null; return null; }
      return this.ctx;
    },

    unlock() {
      const c = this.ensure();
      if (!c) return;
      if (c.state === 'suspended') c.resume().then(() => this.applyMusic()).catch(() => { /* still locked */ });
      else this.applyMusic();
    },

    applyMusic() {
      if (!this.eng || !this.ctx || this.ctx.state !== 'running') return;
      const want = this.settings.music && !root.document.hidden;
      if (want && !this.eng.musicOn) this.eng.startMusic(this.MUSIC_LEVEL, undefined, this.musicStyle);
      else if (!want && this.eng.musicOn) this.eng.stopMusic();
    },

    play(name, arg) {
      if (!this.settings.sfx || !this.eng || !this.ctx || this.ctx.state !== 'running') return false;
      const now = Date.now();
      if (now - (this.last[name] || 0) < (this.GAP[name] || 90)) return false;
      this.last[name] = now;
      try { return this.eng.play(name, undefined, arg); } catch (e) { return false; }
    },

    set(patch) {
      this.settings = cleanSettings({ ...this.settings, ...patch });
      if (this.master) this.master.gain.setTargetAtTime(this.settings.volume, this.ctx.currentTime, 0.05);
      this.save();
      this.unlock();
      this.applyMusic();
      this.paint();
    },

    // wires a button to a small settings dialog (made here, styled by the page's own dialog styles)
    // opts.music: 'march' or 'storybook' picks the mood of the music for this game (the default is the quiet space one)
    mount(button, opts) {
      this.button = button;
      const mood = ({ march: ['Marching music', 'Slow drums and low horns.'], storybook: ['Storybook music', 'Soft plucked strings.'] })[opts && opts.music] || ['Quiet space music', 'A soft, slow drift.'];
      this.musicStyle = opts && opts.music;
      const d = root.document.createElement('dialog');
      d.id = 'd-sound';
      d.innerHTML = '<h2>Sound</h2>' +
        '<label class="check"><input type="checkbox" id="snd-sfx"><span>Sound effects<span class="fine">When friends join or leave, turns play, and things happen.</span></span></label>' +
        '<label class="check"><input type="checkbox" id="snd-music"><span>' + mood[0] + '<span class="fine">' + mood[1] + ' Off until you turn it on. Stops when the page is hidden.</span></span></label>' +
        '<label>Volume <input type="range" id="snd-vol" min="0" max="100" step="5" aria-label="Volume"></label>' +
        '<div class="row"><button type="button" id="snd-test">Play a sound</button></div>' +
        '<form method="dialog"><button class="primary">Done</button></form>';
      root.document.body.appendChild(d);
      const $ = id => d.querySelector('#' + id);
      button.addEventListener('click', () => { this.unlock(); this.paint(); d.showModal(); });
      $('snd-sfx').addEventListener('change', e => this.set({ sfx: e.target.checked }));
      $('snd-music').addEventListener('change', e => this.set({ music: e.target.checked }));
      $('snd-vol').addEventListener('input', e => this.set({ volume: e.target.value / 100 }));
      $('snd-test').addEventListener('click', () => { this.unlock(); this.last = {}; this.play('turn'); });
      this.dialog = d;
      this.paint();
      // sound can only start after a touch: the first one wakes it up
      const wake = () => { this.unlock(); if (this.ctx && this.ctx.state === 'running') { root.removeEventListener('pointerdown', wake, true); root.removeEventListener('keydown', wake, true); } };
      root.addEventListener('pointerdown', wake, true); root.addEventListener('keydown', wake, true);
      // no music while the page is hidden
      root.document.addEventListener('visibilitychange', () => this.applyMusic());
    },

    paint() {
      if (!this.dialog) return;
      const s = this.settings, d = this.dialog;
      d.querySelector('#snd-sfx').checked = s.sfx;
      d.querySelector('#snd-music').checked = s.music;
      d.querySelector('#snd-vol').value = Math.round(s.volume * 100);
      if (this.button) this.button.textContent = (s.sfx || s.music) ? 'Sound' : 'Sound off';
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else root.Sound = S;
})(typeof window !== 'undefined' ? window : globalThis);
