/*
 * Listening: pitch (YIN), which notes are sounding (chroma), and strums (onsets). No DOM, runs under node.
 * The page feeds these from an AnalyserNode on the mic about 60 times a second.
 */
(function (root) {
  'use strict';

  // halve the sample rate (average pairs): plenty for voices and strings, and four times less work for YIN
  function halve(x) {
    const out = new Float32Array(x.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = 0.5 * (x[2 * i] + x[2 * i + 1]);
    return out;
  }

  function rms(x) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return Math.sqrt(s / x.length);
  }

  // YIN (de Cheveigné and Kawahara, 2002). Returns { f, conf } or { f: 0 } when there is no clear pitch.
  // opts: lo and hi (Hz), gate (quietest rms that counts), thresh.
  function yin(buf, rate, opts) {
    opts = opts || {};
    const lo = opts.lo || 70, hi = opts.hi || 1100, gate = opts.gate === undefined ? 0.004 : opts.gate, thresh = opts.thresh || 0.15;
    let x = buf, sr = rate;
    while (sr > 30000) { x = halve(x); sr /= 2; }
    if (rms(x) < gate) return { f: 0, conf: 0 };
    const tauMin = Math.max(2, Math.floor(sr / hi)), tauMax = Math.min(Math.floor(sr / lo), Math.floor(x.length / 2));
    if (tauMax <= tauMin + 2) return { f: 0, conf: 0 };
    const w = x.length - tauMax - 1;
    const d = new Float32Array(tauMax + 2);
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let s = 0;
      for (let j = 0; j < w; j++) { const v = x[j] - x[j + tau]; s += v * v; }
      d[tau] = s;
    }
    // cumulative mean normalised difference
    let run = 0;
    const c = new Float32Array(tauMax + 2);
    c[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; c[tau] = run > 0 ? d[tau] * tau / run : 1; }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (c[t] < thresh) { while (t + 1 <= tauMax && c[t + 1] < c[t]) t++; tau = t; break; }
    }
    if (tau < 0) { // no dip under the threshold: take the deepest one if it is still fairly clear
      let best = tauMin;
      for (let t = tauMin; t <= tauMax; t++) if (c[t] < c[best]) best = t;
      if (c[best] > 0.35) return { f: 0, conf: 0 };
      tau = best;
    }
    // parabola through the three points for a fraction of a sample
    let shift = 0;
    if (tau > 1 && tau < tauMax) {
      const a = c[tau - 1], b = c[tau], e = c[tau + 1], den = a + e - 2 * b;
      if (den > 0) shift = 0.5 * (a - e) / den;
    }
    return { f: sr / (tau + shift), conf: Math.max(0, Math.min(1, 1 - c[tau])) };
  }

  // Which pitch classes are sounding, from an analyser's dB spectrum. Peaks only, so one loud note does not smear into its
  // neighbours. Returns 12 shares that add to 1 (C first), or null when it is quiet.
  function chroma(db, rate, fftSize, opts) {
    opts = opts || {};
    const lo = opts.lo || 75, hi = opts.hi || 1400, floor = opts.floor === undefined ? -75 : opts.floor;
    const out = new Float32Array(12);
    const binHz = rate / fftSize;
    const k0 = Math.max(2, Math.floor(lo / binHz)), k1 = Math.min(db.length - 2, Math.ceil(hi / binHz));
    let total = 0;
    for (let k = k0; k <= k1; k++) {
      const v = db[k];
      if (v < floor || v < db[k - 1] || v < db[k + 1]) continue;
      // refine the peak between bins, then weigh it by how close it is to a real note
      const a = db[k - 1], b = v, e = db[k + 1], den = a + e - 2 * b;
      const off = den < 0 ? 0.5 * (a - e) / den : 0;
      const f = (k + off) * binHz;
      const m = 69 + 12 * Math.log2(f / 440), r = Math.round(m), near = 1 - Math.min(1, Math.abs(m - r) * 2);
      const mag = Math.pow(10, v / 20) * near;
      out[((r % 12) + 12) % 12] += mag;
      total += mag;
    }
    if (total <= 0) return null;
    for (let i = 0; i < 12; i++) out[i] /= total;
    return out;
  }

  // A strum or a pick: the level jumps well above what it was a moment ago, and is rising right now (so the quiet frame
  // before a strum does not set off a second onset while the note rings).
  class Onsets {
    constructor(opts) {
      opts = opts || {};
      this.ratio = opts.ratio || 1.8; this.gate = opts.gate || 0.006; this.gap = opts.gap || 0.07;
      this.hist = []; this.last = -Infinity;
    }
    push(level, t) {
      const lowest = this.hist.length ? Math.min(...this.hist) : Infinity, prev = this.hist.length ? this.hist[this.hist.length - 1] : Infinity;
      this.hist.push(level);
      if (this.hist.length > 6) this.hist.shift();
      if (level >= this.gate && level > lowest * this.ratio && level > prev * 1.25 && t - this.last >= this.gap) { this.last = t; return true; }
      return false;
    }
  }

  // A spectrum into what playing along to any music needs: how much got louder (flux) overall and in three bands (kick, body,
  // cymbals), and how bright it is. Log magnitudes, so a quiet room and a loud speaker look alike. `prev` holds the last
  // call's magnitudes and is updated in place.
  function bands(db, rate, fftSize, prev) {
    const binHz = rate / fftSize, out = { flux: 0, low: 0, mid: 0, high: 0, bright: 0 };
    let wsum = 0, msum = 0;
    for (let k = 1; k < db.length; k++) {
      const f = k * binHz;
      if (f > 12000) break;
      const lin = db[k] < -110 ? 0 : Math.pow(10, db[k] / 20), m = Math.log(1 + 1000 * lin);
      const d = m - prev[k];
      prev[k] = m;
      msum += m; wsum += m * f;
      if (d <= 0 || f < 30) continue;
      out.flux += d;
      if (f < 160) out.low += d; else if (f < 2500) out.mid += d; else if (f > 5000) out.high += d;
    }
    out.bright = msum > 0 ? wsum / msum : 0;
    return out;
  }

  // Finds the beat in music it can only hear, not read: an onset envelope on a 10 ms grid, autocorrelation for the tempo
  // (leaning toward 120 bpm, and checking the double period so it does not pick half or double time), then a comb for where
  // the beats fall. estimate() says { period, beat (the time of a recent beat), bpm, conf }, or null until it has heard enough.
  class BeatTracker {
    constructor(opts) {
      opts = opts || {};
      this.rate = 100; this.keep = (opts.window || 8) * this.rate;
      this.lo = opts.lo || 70; this.hi = opts.hi || 180;
      this.e = []; this.base = null; this.last = null;
      this.period = null; this.pending = null;
    }
    push(t, v) {
      const i = Math.round(t * this.rate);
      if (this.base === null) { this.base = i; this.e.push(v); this.last = i; return; }
      if (i <= this.last) { const k = this.last - this.base; this.e[k] = Math.max(this.e[k], v); return; }
      if (i - this.last > this.rate) { this.e = []; this.base = i; this.e.push(v); this.last = i; return; } // a long gap: start over
      const from = this.e[this.e.length - 1];
      for (let j = this.last + 1; j <= i; j++) this.e.push(from + (v - from) * (j - this.last) / (i - this.last));
      this.last = i;
      if (this.e.length > this.keep) { const cut = this.e.length - this.keep; this.e.splice(0, cut); this.base += cut; }
    }
    estimate() {
      const e = this.e, n = e.length, r = this.rate;
      if (n < 4 * r) return null;
      // novelty: above the local average only
      const pre = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + e[i];
      const x = new Float64Array(n), h = 20;
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - h), b = Math.min(n, i + h + 1);
        x[i] = Math.max(0, e[i] - (pre[b] - pre[a]) / (b - a));
      }
      let ac0 = 0;
      for (let i = 0; i < n; i++) ac0 += x[i] * x[i];
      if (ac0 <= 1e-12) return null;
      const minLag = Math.floor(60 * r / this.hi), maxLag = Math.ceil(60 * r / this.lo);
      const ac = new Float64Array(2 * maxLag + 2);
      for (let lag = minLag; lag <= Math.min(2 * maxLag + 1, n - 1); lag++) {
        let s = 0;
        for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
        ac[lag] = s / (n - lag) * n / ac0;
      }
      const score = lag => (ac[lag] + 0.5 * (2 * lag < ac.length ? ac[2 * lag] : 0)) * Math.exp(-0.5 * Math.pow(Math.log2(60 * r / lag / 120) / 0.9, 2));
      let best = minLag;
      for (let lag = minLag; lag <= maxLag; lag++) if (score(lag) > score(best)) best = lag;
      let p = best;
      if (best > minLag && best < maxLag) {
        const a = ac[best - 1], b = ac[best], c = ac[best + 1], den = a + c - 2 * b;
        if (den < 0) p = best + 0.5 * (a - c) / den;
      }
      const conf = Math.max(0, Math.min(1, ac[best]));
      // keep a steady tempo: small changes are smoothed, a big one has to be heard twice in a row
      if (this.period === null || Math.abs(p / this.period - 1) < 0.04) { this.period = this.period === null ? p : this.period * 0.8 + p * 0.2; this.pending = null; }
      else if (this.pending !== null && Math.abs(p / this.pending - 1) < 0.04) { this.period = p; this.pending = null; }
      else this.pending = p;
      const P = this.period;
      // comb: which offset from the newest sample lines up with the onsets best (recent beats count more)
      let bestPh = 0, bestS = -1;
      for (let ph = 0; ph < P; ph++) {
        let s = 0;
        for (let k = 0; ; k++) {
          const at = n - 1 - ph - k * P;
          if (at < 1) break;
          const j = Math.floor(at), f = at - j;
          s += (x[j] * (1 - f) + x[j + 1] * f) * (1 - k * 0.03);
        }
        if (s > bestS) { bestS = s; bestPh = ph; }
      }
      // refine the beat to the strongest sample near it
      let beatAt = n - 1 - bestPh;
      const lo = Math.max(0, Math.round(beatAt) - 2), hi = Math.min(n - 1, Math.round(beatAt) + 2);
      for (let i = lo; i <= hi; i++) if (x[i] > x[Math.round(beatAt)]) beatAt = i;
      return { period: P / r, beat: (this.base + beatAt) / r, bpm: 60 * r / P, conf };
    }
  }

  const api = { yin, chroma, rms, halve, Onsets, bands, BeatTracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RNDSP = api;
})(typeof window !== 'undefined' ? window : globalThis);
