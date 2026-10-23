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

  const api = { yin, chroma, rms, halve, Onsets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RNDSP = api;
})(typeof window !== 'undefined' ? window : globalThis);
