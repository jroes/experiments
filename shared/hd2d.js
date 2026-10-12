/*
 * HD-2D pictures for the adventure games: fine pixel art, lit by the room's lamps, then (in hd2d-post.js) given depth of field,
 * bloom, light shafts and dust, like a little model set filmed with a real camera.
 *
 * A game keeps its 160 x 100 world (walking, clicks, rects). Pictures are drawn at three times that (480 x 300) with shaded shapes:
 * every call here takes world coordinates, so a room's art lines up with its objects. No DOM in this file, so it runs under node.
 *
 * A room picks a look (hd2d, golden, mystery, diorama, neon). The look sets the colour grading, how dark the room is, and the
 * camera effects. The room adds lights (c.light) and light shafts (c.shaft) as it draws.
 */
(function (root) {
  'use strict';

  const SCALE = 3, W = 160 * SCALE, H = 100 * SCALE;   // the picture
  const DW = W * 2, DH = H * 2;                        // the canvas on the page
  const LQ = 4, LW = W / LQ, LH = H / LQ;              // the light map is worked out at a quarter of the size, then smoothed back up

  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  // a stable hash, so "random" detail is the same every frame
  const hash = (a, b, c) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  const LX = -0.55, LY = -0.6, LZ = 0.58; // the key light comes from the top left, a little in front

  // ---------- materials: dark to light, shadows leaning blue or purple, highlights leaning warm ----------
  const BASE = {
    space: ['#05051a', '#0c0d2c', '#171544', '#251d5c'],
    nebula: ['#1d1340', '#3a1d5c', '#6a2a72', '#a54480'],
    wall: ['#181a2e', '#262b48', '#373f61', '#4f5c80', '#7486a8'],
    frame: ['#10121f', '#1d2136', '#2d3350', '#454f72', '#6a7aa0'],
    floor: ['#121424', '#1e2238', '#2c3150', '#3f4769', '#5b6688'],
    hazard: ['#6b3d12', '#b8741c', '#f2b33d', '#ffe08a'],
    dark: ['#07080f', '#11131f', '#1b1e30'],
    white: ['#5a6078', '#9aa0b8', '#d0d4e2', '#ffffff'],
    shuttle: ['#2c2a3e', '#585870', '#9496ad', '#d0d4e2', '#ffffff'],
    accent: ['#4a1520', '#922b2c', '#d65334', '#ff8f4f', '#ffc68a'],
    glass: ['#08223a', '#0f4466', '#1f7c9e', '#5fc7dc', '#c2f4ff'],
    skin: ['#5a2b28', '#a35643', '#dc9572', '#f7c6a0'],
    hair: ['#3a1d14', '#7a3d1c', '#c06a2a', '#e8a04a'],
    suit: ['#0d2f3d', '#145664', '#1f8584', '#4bbfa9', '#a6f0d0'],
    boot: ['#0f0e18', '#24202f', '#3a3548'],
    wood: ['#4a2a1a', '#82502c', '#bb8146', '#e2b170'],
    mop: ['#6e6a80', '#a9a6ba', '#dcdae8', '#ffffff'],
    robot: ['#232842', '#434d70', '#7586ab', '#b8c8e6', '#eef4ff'],
    slime: ['#0d3a26', '#1b7038', '#3cb052', '#90e86c', '#e2ffb0'],
    planet: ['#2c1230', '#6a2433', '#b24a34', '#e58644', '#ffc77a'],
    band: ['#40172c', '#82312f', '#c46238', '#f0a050'],
    moon: ['#2a2a3e', '#55566e', '#8c8ea6', '#c8cad8'],
    sand: ['#5a3a1e', '#8c5a2c', '#c48a48', '#e8b56a', '#f8d898'],
    sky: ['#7a2f3a', '#b04e3c', '#e07e48', '#f4ac6a', '#ffd9a0'],
    rock: ['#2e1e22', '#4e3230', '#78503e', '#a07458', '#c8a080'],
    bone: ['#6e6458', '#a89c88', '#d8ceb8', '#f4eee0'],
    cloth: ['#1a2040', '#2c3a6a', '#44609a', '#6e90c4'],
    alien: ['#14301a', '#245a2a', '#3c8a3a', '#68b850', '#a8e080'],
    lizard: ['#1e3a2a', '#2e6a44', '#4c9a5c', '#86c878', '#c8f0a0'],
    brass: ['#4a3010', '#8a6020', '#c89838', '#f0d070'],
    punch: ['#2a0f3a', '#5a1c6a', '#9a3aa0', '#d070d0', '#f8b0f0'],
    plum: ['#1a0f22', '#2e1a3a', '#462a56', '#644078'],
    lamp: ['#ffcf7a', '#fff1c2'],
    cyanlamp: ['#6fe3f2', '#e0fdff'],
    redlamp: ['#ff4d5e', '#ffd0d4'],
    pinklamp: ['#ff4fa8', '#ffd0ea'],
    greenlamp: ['#7cff8a', '#e0ffe4'],
    sunlamp: ['#fff0b0', '#ffffff'],
  };
  // the old 16 EGA colour numbers, for anything a shared helper still draws with a number (a dropped item)
  const EGA_MAT = ['dark', 'cloth', 'slime', 'glass', 'accent', 'punch', 'wood', 'white', 'frame', 'cyanlamp', 'greenlamp', 'cyanlamp', 'redlamp', 'pinklamp', 'lamp', 'white'];
  const STEPS = 8;

  function expand(r, n) {
    const c = r.map(hex), out = [];
    for (let i = 0; i < n; i++) { const p = i / (n - 1) * (c.length - 1), k = Math.min(c.length - 2, Math.floor(p)); out.push(lerp3(c[k], c[k + 1], p - k)); }
    return out;
  }
  // colour grading: tint shadows and highlights, then saturation and contrast
  function grade(rgb, g) {
    if (!g) return rgb;
    const l = (0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]) / 255;
    const tint = lerp3(g.shadow, g.high, Math.min(1, l * 1.4));
    let c = lerp3(rgb, [rgb[0] * tint[0] / 200, rgb[1] * tint[1] / 200, rgb[2] * tint[2] / 200], g.amt);
    const m = (c[0] + c[1] + c[2]) / 3; c = c.map(v => m + (v - m) * g.sat);
    return c.map(v => clamp(128 + (v - 128) * g.contrast, 0, 255));
  }

  // ---------- the looks ----------
  const DOF = { clear: 0.17, ramp: 0.34, bg: 0.5 };
  const LOOKS = {
    // H1: the standard one. Warm lamps, a soft camera
    hd2d: { light: { ambient: 0.62, gain: 1.0, steps: 10 },
      post: { dof: DOF, bloom: 0.55, thr: 0.7, dust: { n: 45, color: [255, 230, 190] }, tint: { color: '#ffb070', a: 0.12 }, vignette: 0.42 } },
    // H5: a low sun, long warm shafts, lens flare
    golden: { grade: { shadow: [170, 90, 160], high: [255, 220, 150], amt: 0.45, sat: 1.15, contrast: 1.05 }, light: { ambient: 0.52, gain: 1.1, steps: 10 },
      post: { dof: DOF, bloom: 0.75, thr: 0.62, dust: { n: 80, color: [255, 220, 160] }, flare: true, tint: { color: '#ff9a40', a: 0.15 }, vignette: 0.45 } },
    // H4: most lights out, cold, fog on the floor
    mystery: { grade: { shadow: [60, 110, 200], high: [190, 230, 255], amt: 0.55, sat: 0.85, contrast: 1.1 }, light: { ambient: 0.4, gain: 1.5, steps: 10 },
      post: { dof: { clear: 0.17, ramp: 0.34, bg: 0.45 }, bloom: 0.6, thr: 0.6, fog: { color: [90, 140, 220], a: 0.2 }, dust: { n: 100, color: [190, 220, 255] }, tint: { color: '#3060a0', a: 0.16 }, vignette: 0.62 } },
    // H3: a tiny model on a table. Strong tilt-shift, rich colour
    diorama: { grade: { shadow: [120, 110, 230], high: [255, 230, 190], amt: 0.3, sat: 1.25, contrast: 1.08 }, light: { ambient: 0.76, gain: 0.9, steps: 10 },
      post: { dof: { clear: 0.14, ramp: 0.26, bg: 0.85 }, bloom: 0.5, thr: 0.7, dust: { n: 25, color: [255, 240, 210] }, tint: { color: '#ffd0a0', a: 0.1 }, vignette: 0.3 } },
    // the mystery look, in a bar full of neon
    neon: { grade: { shadow: [120, 60, 200], high: [255, 200, 230], amt: 0.45, sat: 1.15, contrast: 1.1 }, light: { ambient: 0.38, gain: 1.6, steps: 10 },
      post: { dof: { clear: 0.17, ramp: 0.34, bg: 0.45 }, bloom: 0.75, thr: 0.55, fog: { color: [170, 60, 200], a: 0.14 }, dust: { n: 60, color: [255, 200, 240] }, tint: { color: '#a040c0', a: 0.12 }, vignette: 0.6 } },
  };
  const rampsOf = (look, mats) => { for (const [k, v] of Object.entries(mats)) look.ramps[k] = expand(v, k.endsWith('lamp') ? 2 : STEPS).map(c => grade(c, look.grade)); };
  for (const look of Object.values(LOOKS)) { look.ramps = {}; rampsOf(look, BASE); }
  // A game can bring its own materials (name -> dark-to-light hex colours; a name ending in 'lamp' is a glow) and its own looks,
  // without changing this file. Call these when the game's file loads, before anything is drawn.
  function addMaterials(mats) {
    for (const [k, v] of Object.entries(mats)) { if (!Array.isArray(v) || v.length < 2) throw new Error('material ' + k + ' needs two or more colours'); BASE[k] = v; }
    for (const look of Object.values(LOOKS)) rampsOf(look, mats);
  }
  function addLook(name, spec) { // spec like the entries in LOOKS: { grade?, light: { ambient, gain, steps }, post: {...} }
    const look = Object.assign({}, spec, { ramps: {} }); rampsOf(look, BASE); LOOKS[name] = look; return look;
  }

  // ---------- one picture being drawn ----------
  class Scene {
    constructor(look) {
      this.look = look; this.R = look.ramps;
      const n = W * H;
      this.col = new Float32Array(n * 3); this.emit = new Uint8Array(n); this.depth = new Float32Array(n); this.stamp = new Int32Array(n);
      this.id = 0; this.z = 0.4; this.lights = []; this.shafts = []; this.sun = null;
    }
    ramp(mat) { if (typeof mat === 'number') mat = EGA_MAT[mat & 15]; return Object.prototype.hasOwnProperty.call(this.R, mat) ? this.R[mat] : this.R.frame; }
    tone(mat, s, x, y) { // x, y given: blend between two shades with a fine dither, for smooth skies
      const r = this.ramp(mat), p = clamp(s, 0, 1) * (r.length - 1);
      if (x === undefined) return r[Math.round(p)];
      const lo = Math.floor(p); return r[Math.min(r.length - 1, p - lo > BAYER[(y & 3) * 4 + (x & 3)] ? lo + 1 : lo)];
    }
    put(x, y, c, emit) {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = y * W + x; this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2]; this.emit[i] = emit === 2 ? 2 : emit ? 1 : 0; this.depth[i] = this.z; this.stamp[i] = this.id;
    }
    // all shapes take world coordinates (0..160, 0..100). Options:
    //   flat (one shade), bias (lighter or darker), grad [top, bottom] (a set shading), emit (glows: not lit, feeds the bloom), unlit (not lit by the room: sky, space), dither (blend shades, for big smooth gradients),
    //   outline (a dark edge, for things you can use),
    //   rim (a lit edge on the far side), cyl (round across its height, like a pipe lying down), vcyl (round across its width, like a can),
    //   band [y0, y1] (the height the cyl rounding spans), clipY / clipX [lo, hi] (cut the shape: half a circle is a dome)
    shape(kind, g, mat, o) {
      o = o || {};
      if (api.fast && (kind === 'rect' || kind === 'poly') && typeof mat !== 'function' && !o.cyl && !o.vcyl && !o.outline && !o.clipX && !o.clipY) return this.fill(kind, g, mat, o);
      this.id++;
      const list = [];
      let x0, y0, x1, y1, rr = 0, cx = 0, cy = 0, rx = 1, ry = 1, pts = null;
      if (kind === 'rect' || kind === 'rrect') { x0 = Math.round(g[0] * SCALE); y0 = Math.round(g[1] * SCALE); x1 = Math.round((g[0] + g[2]) * SCALE); y1 = Math.round((g[1] + g[3]) * SCALE); if (kind === 'rrect') rr = Math.min(g[4] * SCALE, (x1 - x0) / 2, (y1 - y0) / 2); }
      else if (kind === 'ell') { cx = g[0] * SCALE; cy = g[1] * SCALE; rx = Math.max(0.5, g[2] * SCALE); ry = Math.max(0.5, g[3] * SCALE); x0 = Math.floor(cx - rx); x1 = Math.ceil(cx + rx) + 1; y0 = Math.floor(cy - ry); y1 = Math.ceil(cy + ry) + 1; }
      else { pts = g.map(p => [p[0] * SCALE, p[1] * SCALE]); x0 = Math.floor(Math.min(...pts.map(p => p[0]))); x1 = Math.ceil(Math.max(...pts.map(p => p[0]))); y0 = Math.floor(Math.min(...pts.map(p => p[1]))); y1 = Math.ceil(Math.max(...pts.map(p => p[1]))); }
      const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
      const inRR = (px, py) => { if (px < x0 || px >= x1 || py < y0 || py >= y1) return false; if (!rr) return true; const qx = px + 0.5, qy = py + 0.5; const dx = Math.max(x0 + rr - qx, 0, qx - (x1 - rr)), dy = Math.max(y0 + rr - qy, 0, qy - (y1 - rr)); return dx * dx + dy * dy <= rr * rr; };
      const b0 = o.band ? o.band[0] * SCALE : y0, b1 = o.band ? o.band[1] * SCALE : y1;
      const cyA = o.clipY ? o.clipY[0] * SCALE : -1e9, cyB = o.clipY ? o.clipY[1] * SCALE : 1e9, cxA = o.clipX ? o.clipX[0] * SCALE : -1e9, cxB = o.clipX ? o.clipX[1] * SCALE : 1e9;
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
        if (y + 0.5 < cyA || y + 0.5 > cyB) continue;
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
          if (x + 0.5 < cxA || x + 0.5 > cxB) continue;
          let s, nx = 0, ny = 0;
          if (kind === 'ell') {
            nx = (x + 0.5 - cx) / rx; ny = (y + 0.5 - cy) / ry; const d = nx * nx + ny * ny; if (d > 1) continue;
            const nz = Math.sqrt(1 - d); s = o.flat ? 0.6 : 0.12 + Math.max(0, nx * LX + ny * LY + nz * LZ) * 0.95;
            if (o.rim && !o.flat && nz < 0.32 && nx + ny < -0.2) s = 1.05;
          } else {
            if (kind === 'poly' ? !inPoly(pts, x + 0.5, y + 0.5) : !inRR(x, y)) continue;
            s = o.flat ? 0.6 : 1 - ((x - x0) / bw * 0.3 + (y - y0) / bh * 0.6);
            if (!o.flat && o.cyl) { const t = clamp((y + 0.5 - b0) / Math.max(1, b1 - b0), 0, 1), n = t * 2 - 1, nz = Math.sqrt(Math.max(0, 1 - n * n)); s = 0.12 + 0.95 * Math.max(0, n * LY + nz * LZ) + 0.08 - 0.16 * (x - x0) / bw; if (o.rim && n > 0.82) s += 0.25; }
            if (!o.flat && o.vcyl) { const t = (x + 0.5 - x0) / bw, n = t * 2 - 1, nz = Math.sqrt(Math.max(0, 1 - n * n)); s = 0.12 + 0.95 * Math.max(0, n * LX + nz * LZ) + 0.1 - 0.2 * (y - y0) / bh; }
            if (!o.flat && kind !== 'poly' && bh > 3 && !o.grad) { if (!inRR(x, y - 1)) s += 0.3; else if (!inRR(x, y + 1)) s -= 0.2; } // a lit top edge and a dark bottom edge
          }
          if (o.grad) s = o.grad[0] + (o.grad[1] - o.grad[0]) * ((y - y0) / bh);
          const m = typeof mat === 'function' ? mat(x / SCALE, y / SCALE, nx, ny) : mat;
          this.put(x, y, o.dither ? this.tone(m, s + (o.bias || 0), x, y) : this.tone(m, s + (o.bias || 0)), o.emit ? 1 : o.unlit ? 2 : 0);
          list.push(x, y);
        }
      }
      if (o.outline && !o.emit) this.outline(list, typeof mat === 'function' ? 'dark' : mat);
    }
    // The common case (a plain rect or polygon) made fast: most of a room is these. Same pixels as shape(), checked by a test.
    // The ramp is looked up once, there is no pixel list, and polygons are filled a row at a time from their edge crossings.
    fill(kind, g, mat, o) {
      this.id++;
      let x0, y0, x1, y1, pts = null;
      if (kind === 'rect') { x0 = Math.round(g[0] * SCALE); y0 = Math.round(g[1] * SCALE); x1 = Math.round((g[0] + g[2]) * SCALE); y1 = Math.round((g[1] + g[3]) * SCALE); }
      else { pts = g.map(p => [p[0] * SCALE, p[1] * SCALE]); x0 = Infinity; x1 = -Infinity; y0 = Infinity; y1 = -Infinity; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } x0 = Math.floor(x0); x1 = Math.ceil(x1); y0 = Math.floor(y0); y1 = Math.ceil(y1); }
      const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
      const r = this.ramp(mat), last = r.length - 1, bias = o.bias || 0, em = o.emit ? 1 : o.unlit ? 2 : 0, dith = !!o.dither, flat = !!o.flat, grad = o.grad;
      const col = this.col, emit = this.emit, depth = this.depth, stamp = this.stamp, z = this.z, id = this.id, xs = [];
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
        if (pts) { // where this row of pixel centres crosses the edges; a pixel is inside when an odd number of crossings lie to its right (as inPoly)
          xs.length = 0; const yc = y + 0.5;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > yc) !== (b[1] > yc)) xs.push((b[0] - a[0]) * (yc - a[1]) / (b[1] - a[1]) + a[0]); }
          if (!xs.length) continue; xs.sort((p, q) => p - q);
        }
        let k = 0;
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
          if (pts) { const xc = x + 0.5; while (k < xs.length && xs[k] <= xc) k++; if (((xs.length - k) & 1) === 0) continue; }
          let s = flat ? 0.6 : 1 - ((x - x0) / bw * 0.3 + (y - y0) / bh * 0.6);
          if (!flat && !pts && bh > 3 && !grad) { if (y === y0) s += 0.3; else if (y === y1 - 1) s -= 0.2; }
          if (grad) s = grad[0] + (grad[1] - grad[0]) * ((y - y0) / bh);
          const p = clamp(s + bias, 0, 1) * last; let c;
          if (dith) { const fl = Math.floor(p); c = r[Math.min(last, p - fl > BAYER[(y & 3) * 4 + (x & 3)] ? fl + 1 : fl)]; } else c = r[Math.round(p)];
          const i = y * W + x; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; emit[i] = em; depth[i] = z; stamp[i] = id;
        }
      }
    }
    // a dark edge around a shape, where it meets something else
    outline(list, mat) {
      const id = this.id, edge = [];
      for (let i = 0; i < list.length; i += 2) {
        const x = list[i], y = list[i + 1];
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || this.stamp[y * W + x + 1] !== id || this.stamp[y * W + x - 1] !== id || this.stamp[(y + 1) * W + x] !== id || this.stamp[(y - 1) * W + x] !== id) edge.push(x, y);
      }
      const oc = lerp3(this.ramp(mat)[0], [10, 8, 24], 0.55);
      for (let i = 0; i < edge.length; i += 2) { const k = (edge[i + 1] * W + edge[i]) * 3; this.col[k] = oc[0]; this.col[k + 1] = oc[1]; this.col[k + 2] = oc[2]; }
    }
    rect(x, y, w, h, mat, o) { this.shape('rect', [x, y, w, h], mat, o); }
    rrect(x, y, w, h, r, mat, o) { this.shape('rrect', [x, y, w, h, r], mat, o); }
    ell(x, y, rx, ry, mat, o) { this.shape('ell', [x, y, rx, ry], mat, o); }
    poly(pts, mat, o) { this.shape('poly', pts, mat, o); }
    // a straight line, w world units wide (at least one fine pixel)
    line(xa, ya, xb, yb, mat, o) {
      o = o || {}; this.id++;
      let x0 = Math.round(xa * SCALE), y0 = Math.round(ya * SCALE); const x1 = Math.round(xb * SCALE), y1 = Math.round(yb * SCALE);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
      const t = Math.max(1, Math.round((o.w || 0.34) * SCALE)), c = this.tone(mat, o.s === undefined ? 0.6 : o.s), c2 = this.tone(mat, (o.s === undefined ? 0.6 : o.s) + 0.3);
      for (let n = 0; n < 4000; n++) {
        for (let k = 0; k < t; k++) this.put(x0 + k, y0, k === 0 && t > 1 ? c2 : c, o.emit);
        if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    // one fine pixel (a third of a world unit)
    dot(x, y, mat, s, emit) { this.put(Math.round(x * SCALE), Math.round(y * SCALE), this.tone(mat, s === undefined ? 0.6 : s), emit); }
    px(x, y, mat) { this.rect(x, y, 1, 1, mat, { flat: true }); } // for shared helpers that draw in whole world pixels
    // a soft shadow where something meets the floor: darkens what is there, in a few bands
    shadow(cx, cy, rx, ry, str) {
      const X = cx * SCALE, Y = cy * SCALE, RX = rx * SCALE, RY = ry * SCALE;
      for (let y = Math.floor(Y - RY); y <= Math.ceil(Y + RY); y++) for (let x = Math.floor(X - RX); x <= Math.ceil(X + RX); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const nx = (x + 0.5 - X) / RX, ny = (y + 0.5 - Y) / RY, d = nx * nx + ny * ny; if (d >= 1) continue;
        const f = Math.ceil((1 - d) * 3) / 3, m = 1 - str * f, i = (y * W + x) * 3;
        this.col[i] *= m; this.col[i + 1] *= m; this.col[i + 2] *= m;
      }
    }
    // stencil letters, 3 x 5 fine pixels each (size multiplies)
    text(str, x, y, mat, o) {
      o = o || {}; const p = o.size || 1, c = this.tone(mat, o.s === undefined ? 0.6 : o.s);
      let cx = Math.round(x * SCALE); const cy = Math.round(y * SCALE);
      for (const ch of String(str).toUpperCase()) {
        const rows = FONT[ch] || FONT[' '];
        for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (rows[r][k] === '1') for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) this.put(cx + k * p + a, cy + r * p + b, c, o.emit);
        cx += 4 * p;
      }
    }
    // stars in a window: fine pixels, a few twinkling crosses
    stars(x, y, w, h, seed, t, drift) {
      const n = Math.round(w * h / 8);
      for (let i = 0; i < n; i++) {
        const sx = x + ((hash(i, 1, seed) + (t || 0) * (drift || 0) * (0.5 + hash(i, 2, seed))) % 1) * w, sy = y + hash(i, 3, seed) * h;
        const b = hash(i, 4, seed), tw = 0.5 + 0.5 * Math.sin((t || 0) * (1 + b * 3) + i);
        const X = Math.floor(sx * SCALE), Y = Math.floor(sy * SCALE);
        if (b * tw > 0.25) this.put(X, Y, b > 0.85 ? this.R.cyanlamp[1] : b > 0.6 ? [255, 255, 255] : [150, 150, 190], true);
        if (b > 0.94 && tw > 0.7) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.put(X + dx, Y + dy, [120, 160, 220], true);
      }
    }
    // things that light the room. r is how far the light reaches, in world units
    light(x, y, r, rgb, i) { this.lights.push({ x, y, r, c: rgb, i: i === undefined ? 1 : i }); }
    // light shafts and cones for the camera effects (see hd2d-post.js)
    shaft(spec) { this.shafts.push(spec); }
    sunAt(x, y) { this.sun = [x, y]; }

    // a copy of the picture so far (the room's background), into spare buffers when given
    snapshot(into) {
      const s = into || { col: new Float32Array(this.col.length), emit: new Uint8Array(this.emit.length), depth: new Float32Array(this.depth.length), stamp: new Int32Array(this.stamp.length) };
      s.col.set(this.col); s.emit.set(this.emit); s.depth.set(this.depth); s.stamp.set(this.stamp);
      s.id = this.id; s.lights = this.lights.slice(); s.shafts = this.shafts.slice(); s.sun = this.sun; s.z = this.z;
      return s;
    }
    // start again with a look, keeping the buffers (a new Scene every frame makes megabytes of garbage)
    reset(look) { this.look = look; this.R = look.ramps; this.id = 0; this.z = 0.4; this.lights = []; this.shafts = []; this.sun = null; return this; }
    clear() { this.col.fill(0); this.emit.fill(0); this.depth.fill(0); this.stamp.fill(0); return this; }
    restore(s) { this.col.set(s.col); this.emit.set(s.emit); this.depth.set(s.depth); this.stamp.set(s.stamp); this.id = s.id; this.lights = s.lights.slice(); this.shafts = s.shafts.slice(); this.sun = s.sun; this.z = s.z; }

    // light the picture. Returns RGBA pixels.
    finish(out) {
      const L = this.look.light, k = 160 / LW;
      for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) {
        let r = L.ambient, g = L.ambient, b = L.ambient; const px = (i + 0.5) * k, py = (j + 0.5) * k;
        for (const l of this.lights) {
          const dx = px - l.x, dy = py - l.y, d2 = (dx * dx + dy * dy) / (l.r * l.r);
          if (d2 >= 1) continue;
          const d = Math.sqrt(d2), f = (1 - d) * (1 - d) * l.i * L.gain;
          r += f * l.c[0] / 255; g += f * l.c[1] / 255; b += f * l.c[2] / 255;
        }
        const q = (j * LW + i) * 3; LM[q] = r; LM[q + 1] = g; LM[q + 2] = b;
      }
      out = out || new Uint8ClampedArray(W * H * 4);
      const st = L.steps, col = this.col, emit = this.emit, lm = LM;
      for (let y = 0; y < H; y++) {
        const fy = clamp((y + 0.5) / LQ - 0.5, 0, LH - 1), j0 = Math.floor(fy), j1 = Math.min(LH - 1, j0 + 1), ty = fy - j0, R0 = j0 * LW * 3, R1 = j1 * LW * 3;
        for (let x = 0; x < W; x++) {
          const i = y * W + x, o = i * 4, c3 = i * 3;
          let r = col[c3], g = col[c3 + 1], b = col[c3 + 2];
          if (!emit[i]) { // the light map, smoothed back up, then banded like hand-shaded pixel art
            const tx = TX[x], a = R0 + I0[x], bq = R0 + I1[x], c = R1 + I0[x], d = R1 + I1[x];
            r *= Math.round(((lm[a] * (1 - tx) + lm[bq] * tx) * (1 - ty) + (lm[c] * (1 - tx) + lm[d] * tx) * ty) * st) / st;
            g *= Math.round(((lm[a + 1] * (1 - tx) + lm[bq + 1] * tx) * (1 - ty) + (lm[c + 1] * (1 - tx) + lm[d + 1] * tx) * ty) * st) / st;
            b *= Math.round(((lm[a + 2] * (1 - tx) + lm[bq + 2] * tx) * (1 - ty) + (lm[c + 2] * (1 - tx) + lm[d + 2] * tx) * ty) * st) / st;
          }
          out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
        }
      }
      return out;
    }
  }
  // the light map and, for each picture column, which light map cells it blends and how much
  const LM = new Float32Array(LW * LH * 3), I0 = new Int32Array(W), I1 = new Int32Array(W), TX = new Float64Array(W);
  for (let x = 0; x < W; x++) { const fx = clamp((x + 0.5) / LQ - 0.5, 0, LW - 1), i0 = Math.floor(fx); I0[x] = i0 * 3; I1[x] = Math.min(LW - 1, i0 + 1) * 3; TX[x] = fx - i0; }
  function inPoly(pts, x, y) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

  const FONT = {
    A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
    E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'], G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
    I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '010'], K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
    M: ['101', '111', '111', '101', '101'], N: ['101', '111', '111', '111', '101'], O: ['010', '101', '101', '101', '010'], P: ['110', '101', '110', '100', '100'],
    Q: ['010', '101', '101', '111', '011'], R: ['110', '101', '110', '101', '101'], S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
    U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'], W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
    Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'], 0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
    2: ['110', '001', '010', '100', '111'], 3: ['110', '001', '010', '001', '110'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '110', '001', '110'],
    6: ['011', '100', '110', '101', '010'], 7: ['111', '001', '010', '010', '010'], 8: ['010', '101', '010', '101', '010'], 9: ['010', '101', '011', '001', '110'],
    '-': ['000', '000', '111', '000', '000'], '.': ['000', '000', '000', '000', '010'], '!': ['010', '010', '010', '000', '010'], ' ': ['000', '000', '000', '000', '000'],
  };

  // ---------- a whole frame of the game ----------
  const lookOf = room => (Object.prototype.hasOwnProperty.call(LOOKS, room.look) ? LOOKS[room.look] : LOOKS.hd2d);
  // what the room's background depends on: a new key means it has to be drawn again before it can be used
  // (only what a background can show: not the move count, so typing "look" does not redraw the room)
  const backKey = g => { const st = g.state; let f = ''; for (const k in st.flags) f += k + '=' + st.flags[k] + ';'; return st.room + '|' + st.points + '|' + st.inv.join(',') + '|' + st.drops.length + '|' + f; };
  // the room's background on its own (hd2d-worker.js draws it with this off the main thread)
  function background(def, g, t, S) {
    const room = def.rooms[g.state.room];
    S.reset(lookOf(room)).clear();
    room.back(S, g, t);
    return S;
  }
  // opts:
  //   cache    {} kept by the caller. The room's background is reused while its key is the same and it is younger than backEvery seconds.
  //   refresh  (g, key, t) asks for a newer background to be drawn elsewhere (a worker) and put in the cache; the old one is used until then.
  //   scene    a Scene to reuse.  moving  the hero is walking.  out  pixels to reuse.
  //   raw      skip the lighting and return the unlit picture, for the GPU (hd2d-gl.js) to light.
  function render(def, g, t, opts) {
    opts = opts || {};
    const room = def.rooms[g.state.room], look = lookOf(room);
    const S = opts.scene ? opts.scene.reset(look) : new Scene(look), c = opts.cache, key = backKey(g), every = opts.backEvery || 0.1;
    if (c && c.snap && c.key === key && c.look === look && (opts.refresh || Math.abs(t - c.t) < every)) {
      S.restore(c.snap);
      if (opts.refresh && Math.abs(t - c.t) >= every) opts.refresh(g, key, t);
    } else {
      background(def, g, t, S);
      if (c) { c.key = key; c.look = look; c.t = t; c.snap = S.snapshot(c.snap && c.own ? c.snap : undefined); c.own = true; }
    }
    S.z = 0.4;
    const list = [];
    for (const o of g.objects()) if (o.draw) list.push({ base: o.base !== undefined ? o.base : (o.rect ? o.rect[1] + o.rect[3] : 0), f: () => o.draw(S, g, t) });
    if (opts.hero !== false && !g.state.dead) list.push({ base: g.state.y, f: () => { S.z = 0.7; def.hd.hero(S, g.state.x, g.state.y, g.state.dir, !!opts.moving, g.step, g, t); } });
    list.sort((a, b) => a.base - b.base);
    for (const l of list) l.f();
    if (room.front) room.front(S, g, t);
    const frame = { scene: S, emit: S.emit, depth: S.depth, shafts: S.shafts, sun: S.sun, look, W, H, focus: (g.state.y - 9) / 100 };
    if (!opts.raw) frame.rgba = S.finish(opts.out);
    return frame;
  }

  const api = { fast: true, SCALE, W, H, DW, DH, LOOKS, BASE, Scene, render, background, backKey, lookOf, hash, expand, grade, FONT, addMaterials, addLook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HD2D = Object.assign(root.HD2D || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
