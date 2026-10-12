/*
 * The Crown of Hollowmere: a small fairy-tale adventure for the engine in shared/adventure.js.
 * The old king is gone and the three royal treasures are scattered. Bring them back to the steward.
 * Original story, text and art. Rooms, puzzles and handlers are all plain data and small functions.
 *
 * The pictures are HD-2D (shared/hd2d.js): fine pixel art at three times the world size, lit by the sun, the fire and your lamp.
 * Every number in the art is in world units (160 x 100), so it lines up with the rects and walking. Each room picks a look:
 * golden (a low sun: the castle, the far bank), diorama (a tiny model: the meadow, the yard), hm-day (a bright day: the orchard,
 * the bridge), hd2d (firelight: the cottage), hm-woods (the dark pines) and mystery (the cave).
 *
 * Verb names used by handlers: look search take drop open close use give talk push pull climb enter swim eat drink wear light play attack cut kiss tie
 * (see VERBS in the engine for the words that map to each).
 */
(function (root) {
  'use strict';
  const HD = typeof require !== 'undefined' ? require('../shared/hd2d.js') : root.HD2D;
  const hash = HD.hash;

  const lampLit = g => g.has('lamp') && g.flag('lamp_lit');

  // ---------------------------------------------------------------- materials and looks (names start with h. so they never clash with another game's)
  HD.addMaterials({
    'h.sky': ['#3460b4', '#4a7ed0', '#76a6e6', '#a8ccf4', '#dcedfc'],
    'h.dusk': ['#3c447e', '#6a64a0', '#b8849e', '#eeae88', '#ffdca4'],
    'h.fog': ['#1c2a28', '#2e443c', '#4c6858', '#7a9a80', '#b4cca8'],
    'h.cloud': ['#8a92ba', '#b6bedc', '#e0e5f4', '#ffffff'],
    'h.mount': ['#3a4670', '#55658e', '#7a8cb0', '#a8b8d4', '#d8e2f0'],
    'h.snow': ['#9aa8cc', '#d0dcf0', '#ffffff'],
    'h.hillfar': ['#2a4a50', '#3c645c', '#58826a', '#80a67c', '#aecaa0'],
    'h.grass': ['#163a1a', '#24561e', '#3a7428', '#5a9432', '#88b848', '#c0dc78'],
    'h.leaf': ['#0e2a1c', '#18442a', '#2a6632', '#46883a', '#76ae48', '#b4d470'],
    'h.oakleaf': ['#10261a', '#1c3e24', '#2e5c2a', '#4a7a30', '#7aa040', '#b0c868'],
    'h.pine': ['#0a1c18', '#12302a', '#1c4636', '#2a6044', '#4a8052'],
    'h.pinefar': ['#1a2c30', '#24403e', '#30544a', '#446a58'],
    'h.bark': ['#1e120c', '#3a2416', '#5a3a22', '#7e5634', '#a6784c'],
    'h.sapwood': ['#5a3a1e', '#8e6234', '#c09058', '#e4c08a', '#f8e2b4'],
    'h.oak': ['#3e2414', '#6a4024', '#946036', '#b8844e'],
    'h.dirt': ['#3a2616', '#5c3e24', '#82603a', '#a88250', '#cfac76'],
    'h.stone': ['#2a2a38', '#44465a', '#666a7e', '#9094a4', '#c2c4cc', '#e8e8ec'],
    'h.cobble': ['#36302e', '#554c48', '#7a6e66', '#a29484', '#c8baa6'],
    'h.cliff': ['#1c1e26', '#2e323c', '#464c56', '#646c72', '#8a9294'],
    'h.slate': ['#1a1e32', '#2a3150', '#3e4a72', '#5c6e98', '#8aa0c4'],
    'h.iron': ['#121418', '#24282e', '#3c4048', '#5c626c', '#868c96'],
    'h.crimson': ['#2e0610', '#5e0e1e', '#981c2e', '#cc3a3e', '#ee7a68', '#ffb8a0'],
    'h.tunic': ['#0e1a44', '#1a3072', '#2a4ea8', '#4278d4', '#7eaaf0', '#c0dcff'],
    'h.hose': ['#141428', '#22243e', '#343a5a', '#4e5678', '#707a9c'],
    'h.leather': ['#1c100a', '#3a2214', '#5c3a20', '#845832', '#aa7a4a'],
    'h.robe': ['#1c0a2c', '#3a1452', '#5e2078', '#8638a2', '#b464c8', '#dca0e8'],
    'h.hair': ['#24120a', '#422412', '#663a1c', '#8a562a', '#ae7840'],
    'h.beard': ['#6e7086', '#a4a8ba', '#d6d8e4', '#ffffff'],
    'h.troll': ['#14220c', '#263c14', '#3e5c1e', '#5c7e2c', '#88a844', '#bcd47a'],
    'h.fur': ['#1a0e08', '#341c10', '#56321c', '#7c4e2c', '#a87448', '#cc9c6c'],
    'h.muzzle': ['#4a2c18', '#7a5232', '#a87c52', '#d0a878', '#ecd0a4'],
    'h.crow': ['#06060c', '#121420', '#20263a', '#343e5c', '#56648a'],
    'h.water': ['#0a2440', '#12406a', '#1c6494', '#3a90bc', '#78c4e0', '#c8f0fc'],
    'h.plaster': ['#5e4a3a', '#957c64', '#c8b292', '#e8dabe', '#fbf3e2'],
    'h.straw': ['#4a3410', '#7c5c1e', '#b08a34', '#d8b65a', '#f2dc90'],
    'h.rope': ['#3e2a12', '#6e5026', '#a07c42', '#cfb070', '#ecd8a0'],
    'h.silver': ['#30323e', '#5a5e72', '#9296aa', '#c8ccd8', '#f4f6fa'],
    'h.ruby': ['#300410', '#6a0820', '#b01434', '#e8384e', '#ff8a96'],
    'h.honey': ['#4a2204', '#8a4a0a', '#d08a1a', '#f4c040', '#fff0a0'],
    'h.door': ['#0c2618', '#174630', '#246a44', '#3a9060', '#72c088'],
    'h.wool': ['#3a0a24', '#6e1840', '#a8305c', '#d86080', '#f4a0b0'],
    'h.cavern': ['#16141c', '#28242e', '#3c3640', '#544c54', '#746a70', '#968a8c'],
    'h.cavefloor': ['#1e1812', '#32281c', '#4a3c2a', '#66543a', '#86704e'],
    'h.moss': ['#142410', '#22381a', '#344e22', '#4c6a2c', '#6e8c3c'],
    'h.leafdry': ['#3a1a08', '#6a3410', '#a05a1c', '#d08a34', '#f0b860'],
    'h.smoke': ['#5a5e6e', '#8a8e9e', '#b8bcc8', '#e2e4ea'],
    'h.firelamp': ['#ff7418', '#ffe08a'],
    'h.glowlamp': ['#5ce0e8', '#d8fcff'],
    'h.bugslamp': ['#c8f060', '#f8ffc0'],
  });
  const DOF = { clear: 0.17, ramp: 0.34, bg: 0.5 };
  // a bright day outside: high sun, soft camera, pollen in the air
  HD.addLook('hm-day', { grade: { shadow: [100, 110, 210], high: [255, 240, 200], amt: 0.25, sat: 1.12, contrast: 1.05 }, light: { ambient: 0.8, gain: 0.8, steps: 10 },
    post: { dof: { clear: 0.3, ramp: 0.4, bg: 0.45 }, bloom: 0.45, thr: 0.74, dust: { n: 40, color: [255, 250, 210] }, tint: { color: '#ffe0a0', a: 0.08 }, vignette: 0.32 } });
  // under the pines: green shade, mist on the ground, light breaking through
  HD.addLook('hm-woods', { grade: { shadow: [50, 100, 120], high: [215, 240, 190], amt: 0.45, sat: 0.95, contrast: 1.08 }, light: { ambient: 0.52, gain: 1.3, steps: 10 },
    post: { dof: DOF, bloom: 0.55, thr: 0.62, fog: { color: [120, 170, 150], a: 0.2 }, dust: { n: 70, color: [210, 240, 200] }, tint: { color: '#305848', a: 0.12 }, vignette: 0.55 } });

  const SUN = [255, 214, 150], GOLD = [255, 180, 100], FIRE = [255, 140, 50], LAMP = [255, 207, 122], CANDLE = [255, 180, 90], DAY = [205, 225, 255], GLOW = [110, 230, 240];
  const O = { outline: true }; // things you can use get a dark edge
  const T = t => t || 0;
  function inPoly(pts, x, y) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  // an arch: a half ellipse on top of a rectangle, as one shape (x0..x1 wide, springing at ys, top at ys - rise, bottom at yb)
  function archPts(x0, x1, ys, rise, yb) {
    const pts = [], cx = (x0 + x1) / 2, rx = (x1 - x0) / 2;
    for (let i = 0; i <= 14; i++) { const a = Math.PI - (i / 14) * Math.PI; pts.push([cx + Math.cos(a) * rx, ys - Math.sin(a) * rise]); }
    pts.push([x1, yb], [x0, yb]);
    return pts;
  }

  // ---------------------------------------------------------------- sky and far things
  function sky(c, y1, mat, grad) { c.z = 0; c.rect(0, 0, 160, y1 + 2, mat || 'h.sky', { grad: grad || [0.25, 0.95], unlit: true, dither: true }); }
  function cloud(c, x, y, s) {
    const o = { unlit: true, clipY: [0, y + 1.6 * s] };
    for (const [dx, dy, rx, ry] of [[0, 0.6, 10, 2.4], [-6.5, 0, 5, 2.8], [7, 0.2, 5.6, 2.6], [-2.4, -1.8, 5.6, 3.8], [3.2, -2.8, 4.6, 3.6]]) c.ell(x + dx * s, y + dy * s, rx * s, ry * s, 'h.cloud', o);
  }
  function clouds(c, t, list) { c.z = 0; for (const [x, y, s, sp] of list) cloud(c, ((x + T(t) * (sp || 0.3)) % 200 + 200) % 200 - 20, y, s); }
  function sun(c, x, y, r, o) {
    o = o || {}; c.z = 0;
    c.ell(x, y, r * 1.45, r * 1.45, 'sunlamp', { emit: true, flat: true, bias: -0.6 });
    c.ell(x, y, r, r, 'sunlamp', { emit: true, flat: true, bias: 0.4 });
    c.sunAt(x, y);
    c.light(x, y, o.reach || 220, o.color || SUN, o.i === undefined ? 0.35 : o.i);
    if (o.rays) c.shaft({ kind: 'sun', x, y, from: o.from === undefined ? 0.3 : o.from, to: o.to || 1.3, n: 7, color: o.color || SUN, a: o.a || 0.08 });
  }
  function mountain(c, x, y, w, h) {
    c.z = 0.04;
    const px = x + w / 2;
    c.poly([[x, y], [px, y - h], [x + w, y]], 'h.mount', { grad: [0.8, 0.5] });
    c.poly([[px, y - h], [x + w, y], [px + w * 0.1, y]], 'h.mount', { flat: true, bias: -0.22 });
    c.poly([[px - w * 0.13, y - h * 0.66], [px, y - h], [px + w * 0.13, y - h * 0.66], [px + w * 0.05, y - h * 0.74], [px - 0.4, y - h * 0.62], [px - w * 0.06, y - h * 0.72]], 'h.snow', { grad: [0.95, 0.7] });
  }
  const hillY = (x, y, seed, amp) => y - amp * (0.55 + 0.45 * Math.sin(x * 0.045 + seed) * Math.sin(x * 0.017 + seed * 2));
  function hills(c, y, mat, seed, amp, o) {
    o = o || {}; c.z = o.z === undefined ? 0.08 : o.z;
    const pts = [[0, y + 3]];
    for (let x = 0; x <= 160; x += 2) pts.push([x, hillY(x, y, seed, amp)]);
    pts.push([160, y + 3]);
    c.poly(pts, mat, { grad: o.grad || [0.78, 0.5], dither: true });
    for (let i = 0; i < (o.trees || 0); i++) { // little round trees along the ridge
      const x = hash(i, 5, seed) * 160, r = 1 + hash(i, 6, seed) * 1.5, top = hillY(x, y, seed, amp) + r * 0.5;
      c.ell(x, top, r, r * 0.95, o.treeMat || 'h.leaf', { bias: -0.12 });
    }
  }

  // ---------------------------------------------------------------- ground and plants
  function tufts(c, x, y, w, h, n, seed, mat) {
    mat = mat || 'h.grass';
    for (let i = 0; i < n; i++) {
      const k = hash(i, 8, seed), tx = x + hash(i, 7, seed) * w, ty = y + k * h, s = 0.5 + k * 0.8; // nearer tufts are bigger
      c.dot(tx, ty + 0.3, mat, 0.12);
      for (let b = -1; b <= 1; b++) c.line(tx + b * 0.35 * s, ty, tx + b * 0.9 * s + (hash(i, 9, seed) - 0.5) * 0.6, ty - (1.1 + hash(i, b + 2, seed)) * s, mat, { s: b === 0 ? 0.92 : 0.7 });
    }
  }
  function grassland(c, y0, seed, o) {
    o = o || {}; c.z = 0.4;
    const mat = o.mat || 'h.grass';
    c.rect(0, y0, 160, 100 - y0, mat, { grad: o.grad || [0.66, 0.5], dither: true });
    for (let i = 0; i < 16; i++) c.ell(hash(i, 1, seed) * 170 - 5, y0 + 3 + hash(i, 2, seed) * (97 - y0), 10 + hash(i, 3, seed) * 16, 1.6 + hash(i, 4, seed) * 3, mat, { flat: true, bias: (hash(i, 5, seed) - 0.5) * 0.16 + (o.grad ? 0 : -0.02), dither: true });
    tufts(c, 0, y0 + 1, 160, 100 - y0, o.n || 200, seed, mat);
  }
  function dirtPath(c, pts, seed, o) {
    o = o || {}; c.z = 0.41;
    const mat = o.mat || 'h.dirt';
    c.poly(pts, mat, { grad: o.grad || [0.66, 0.5], dither: true });
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (let i = 0; i < (o.n || 40); i++) {
      const px = x0 + hash(i, 31, seed) * (x1 - x0), py = y0 + hash(i, 32, seed) * (y1 - y0);
      if (!inPoly(pts, px, py)) continue;
      const r = 0.3 + hash(i, 33, seed) * 0.6;
      if (hash(i, 34, seed) > 0.5) c.ell(px, py, r * 1.4, r * 0.7, o.pebble || 'h.stone', { bias: -0.05 });
      else c.ell(px, py, r * 3, r * 0.5, mat, { flat: true, bias: hash(i, 35, seed) > 0.5 ? 0.18 : -0.2 });
    }
    // grass creeping over the edges
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], len = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
      for (let j = 0; j < len / 3; j++) { const u = hash(k, j, seed); tufts(c, a[0] + (b[0] - a[0]) * u - 0.5, a[1] + (b[1] - a[1]) * u, 1, 0.5, 1, seed + k * 31 + j, o.edge || 'h.grass'); }
    }
  }
  function flowers(c, x, y, w, h, n, seed, kinds) {
    kinds = kinds || ['white', 'h.ruby', 'h.honey', 'h.wool', 'h.sky'];
    for (let i = 0; i < n; i++) {
      const k = hash(i, 12, seed), fx = x + hash(i, 11, seed) * w, fy = y + k * h, s = 0.55 + k * 0.6, m = kinds[Math.floor(hash(i, 13, seed) * kinds.length)];
      c.line(fx, fy, fx, fy - 1.4 * s, 'h.grass', { s: 0.35 });
      c.ell(fx, fy - 1.6 * s, 0.75 * s, 0.6 * s, m, { bias: 0.15 });
      c.dot(fx, fy - 1.7 * s, m === 'white' ? 'h.honey' : 'white', 0.9);
    }
  }
  // a mass of leaves: a dark back, then clumps each lit from the top left, lighter toward the light
  function foliage(c, x, y, rx, ry, seed, t, leaf, fruit) {
    leaf = leaf || 'h.leaf';
    c.ell(x + rx * 0.06, y + ry * 0.08, rx, ry, leaf, { bias: -0.34 });
    const n = Math.round(9 + rx * 1.3), list = [];
    for (let i = 0; i < n; i++) {
      const a = hash(i, 21, seed) * 6.283, d = Math.sqrt(hash(i, 22, seed)) * 0.74, ca = Math.cos(a) * d, sa = Math.sin(a) * d;
      list.push({ x: x + ca * rx, y: y + sa * ry, r: (0.26 + hash(i, 23, seed) * 0.16) * Math.min(rx, ry * 1.3), lit: -(ca * 0.55 + sa * 0.75), i });
    }
    list.sort((a, b) => a.lit - b.lit);
    for (const l of list) c.ell(l.x + Math.sin(T(t) * 1.3 + l.i) * 0.12, l.y, l.r, l.r * 0.82, leaf, { bias: l.lit * 0.22 - 0.04, rim: true });
    for (let i = 0; i < n * 3; i++) { // single leaves along the edge
      const a = hash(i, 24, seed) * 6.283, d = 0.72 + hash(i, 25, seed) * 0.3;
      c.ell(x + Math.cos(a) * d * rx, y + Math.sin(a) * d * ry, 0.5, 0.4, leaf, { flat: true, bias: Math.sin(a) < -0.2 ? 0.2 : -0.12 });
    }
    for (let i = 0; i < (fruit || 0); i++) {
      const a = hash(i, 26, seed) * 6.283, d = Math.sqrt(hash(i, 27, seed)) * 0.8;
      c.ell(x + Math.cos(a) * d * rx, y + Math.sin(a) * d * ry + 0.6, 0.75, 0.75, 'h.ruby', { rim: true });
    }
  }
  function tree(c, x, y, s, seed, t, o) { // a round leafy tree; x, y is where the trunk meets the ground
    o = o || {};
    const th = (o.trunk || 13) * s, R = 9 * s;
    c.shadow(x + 3 * s, y + 0.3, 12 * s, 2.2 * s, 0.5);
    c.poly([[x - 2.6 * s, y + 0.4], [x - 1.3 * s, y - 2 * s], [x - 1.1 * s, y - th - 2], [x + 1.1 * s, y - th - 2], [x + 1.4 * s, y - 2 * s], [x + 2.8 * s, y + 0.4]], 'h.bark', { vcyl: true });
    for (const k of [-1, 1]) c.line(x + k * 0.4 * s, y - th + 1, x + k * 4 * s, y - th - 4 * s, 'h.bark', { w: 0.9 * s, s: 0.4 });
    foliage(c, x, y - th - R * 0.5, R, R * 0.8, seed, t, o.leaf, o.fruit);
  }
  function pine(c, x, y, s, seed, t, o) { // x, y: the foot of the trunk
    o = o || {};
    const m = o.mat || 'h.pine';
    if (!o.noShadow) c.shadow(x + 1.5 * s, y + 0.2, 8 * s, 1.5 * s, 0.5);
    c.rect(x - 0.9 * s, y - 6 * s, 1.8 * s, 6.2 * s, 'h.bark', { vcyl: true });
    for (let i = 0; i < 4; i++) {
      const ty = y - 32 * s + i * 6.4 * s, by = ty + 10.5 * s, hw = (3.4 + i * 2.5) * s, sw = Math.sin(T(t) * 0.9 + i + x) * 0.2 * s;
      c.poly([[x + sw * 0.5, ty], [x + hw + sw, by], [x + hw * 0.55 + sw, by - 1.3 * s], [x + hw * 0.25 + sw, by + 0.3 * s], [x - hw * 0.2 + sw, by - 1.1 * s], [x - hw * 0.6 + sw, by + 0.2 * s], [x - hw + sw, by]], m, { vcyl: true, bias: o.bias || 0 });
      if (!o.plain) for (let j = 0; j < 4 + i * 2; j++) { const u = hash(j, i, seed), v = hash(j, i + 9, seed); c.line(x + sw - hw * 0.8 * u * v, ty + (by - ty) * (0.3 + 0.6 * v), x + sw - hw * 0.8 * u * v - 1.2 * s, ty + (by - ty) * (0.3 + 0.6 * v) + 0.9 * s, m, { s: 0.85 }); }
    }
  }
  function bush(c, x, y, s, seed, o) {
    o = o || {};
    c.shadow(x + s, y, 8 * s, 1.5 * s, 0.45);
    foliage(c, x, y - 3.3 * s, 7 * s, 3.8 * s, seed, 0, o.leaf, o.fruit);
  }
  function stoneRow(c, x, y, w, h, o) { // a wall of cut stone: courses with a lit top, staggered joints
    o = o || {};
    const mat = o.mat || 'h.stone', row = o.row || 3, len = o.len || 6, g0 = o.grad ? o.grad[0] : 0.62, g1 = o.grad ? o.grad[1] : 0.42;
    c.rect(x, y, w, h, mat, { grad: o.vcyl ? undefined : [g0, g1], vcyl: o.vcyl });
    for (let j = 0; j * row < h; j++) {
      const yy = y + j * row, sr = g0 + (g1 - g0) * (j * row / h);
      if (j) { c.rect(x, yy, w, 0.34, mat, { flat: true, bias: -0.45, vcyl: o.vcyl }); c.rect(x, yy + 0.34, w, 0.34, mat, o.vcyl ? { vcyl: true, bias: 0.12 } : { flat: true, bias: sr - 0.6 + 0.16 }); }
      for (let xx = x + (j % 2 ? len / 2 : 0); xx < x + w; xx += len) {
        c.rect(xx, yy, 0.34, Math.min(row, y + h - yy), mat, { flat: true, bias: -0.45 });
        const k = hash(Math.round(xx * 3), j, o.seed || 1);
        if (!o.vcyl && k > 0.7 && xx + len < x + w) c.rect(xx + 0.34, yy + 0.68, len - 0.34, Math.min(row, y + h - yy) - 0.68, mat, { flat: true, bias: sr - 0.6 + (k - 0.85) * 0.8 });
      }
    }
  }
  function merlons(c, x, y, w, mat) {
    c.rect(x, y - 0.6, w, 1.4, mat || 'h.stone', { cyl: true });
    for (let i = x + 0.6; i < x + w - 3; i += 6) c.rect(i, y - 3.6, 4, 3.4, mat || 'h.stone', { grad: [0.85, 0.5] });
  }
  function pennant(c, x, y, t, len) { // a pole from y up, and a flag streaming right
    len = len || 8;
    c.line(x, y, x, y - 8, 'h.bark', { w: 0.5, s: 0.35 }); c.ell(x + 0.2, y - 8.3, 0.6, 0.6, 'brass');
    const top = [], bot = [];
    for (let i = 0; i <= 6; i++) { const u = i / 6, w = Math.sin(T(t) * 4 - u * 4) * u * 0.9; top.push([x + 0.4 + u * len, y - 7.8 + u * 1.5 + w]); bot.push([x + 0.4 + u * len, y - 4.2 - u * 1.5 + w]); }
    c.poly(top.concat(bot.reverse()), 'h.crimson', { outline: true });
  }
  function fence(c, x0, x1, y) { // a picket fence along the ground at y
    c.shadow((x0 + x1) / 2, y + 0.2, (x1 - x0) / 2 + 2, 1, 0.4);
    c.rect(x0, y - 5.6, x1 - x0, 1, 'wood', { cyl: true }); c.rect(x0, y - 2.8, x1 - x0, 1, 'wood', { cyl: true });
    for (let x = x0; x <= x1 - 1.6; x += 3) c.poly([[x, y], [x, y - 6.4], [x + 0.8, y - 7.4], [x + 1.7, y - 6.4], [x + 1.7, y]], 'h.sapwood', { vcyl: true, bias: -0.1 });
  }
  function butterfly(c, x, y, t, mat) {
    const f = Math.floor(T(t) * 9 + x) % 2;
    c.ell(x - 0.7, y - (f ? 0.6 : 0.2), 0.8, f ? 0.4 : 0.9, mat, { flat: true, bias: 0.2 }); c.ell(x + 0.7, y - (f ? 0.6 : 0.2), 0.8, f ? 0.4 : 0.9, mat, { flat: true, bias: 0.1 });
    c.dot(x, y, 'dark', 0.2);
  }
  function smoke(c, x, y, t, n) {
    for (let i = 0; i < (n || 6); i++) {
      const p = (T(t) * 0.12 + i / (n || 6)) % 1;
      c.ell(x + p * 10 + Math.sin(p * 6 + i) * 1.4, y - p * 22, 1.1 + p * 3.4, (1.1 + p * 3.4) * 0.85, 'h.smoke', { bias: 0.1 + p * 0.25 });
    }
  }

  // ---------------------------------------------------------------- the hero: blue tunic, yellow belt, red cap with a white feather
  function knight(c, x, y, dir, moving, step, g, t) {
    const L = dir === 'l', back = dir === 'u', front = dir === 'd', f = moving ? (Math.floor(step / 4) & 1) : 0;
    const X = v => (L ? x - v : x + v);
    const R = (x0, y0, w, h, r, mat, o) => c.rrect(L ? x - x0 - w : x + x0, y + y0, w, h, r, mat, o);
    const E = (x0, y0, rx, ry, mat, o) => c.ell(X(x0), y + y0, rx, ry, mat, o);
    const P = (pts, mat, o) => c.poly(pts.map(p => [X(p[0]), y + p[1]]), mat, o);
    const lamp = g && g.has && lampLit(g), veil = g && g.flag && g.flag('veil_on') && g.state.room === 'orchard';
    const swing = moving ? (f ? 0.7 : -0.7) : 0;
    c.shadow(x + 0.5, y, 6.4, 1.3, 0.55);
    // legs and boots (one lifts when walking)
    R(-2.5, -6.8 + (f ? -0.6 : 0), 2.2, 5.8, 0.6, 'h.hose', { vcyl: true, outline: true });
    R(0.3, -6.8 + (f ? 0 : -0.6), 2.2, 5.8, 0.6, 'h.hose', { vcyl: true, outline: true });
    const toe = front || back ? 0 : 0.5;
    R(-2.8 + toe, -2.4 + (f ? -0.6 : 0), 2.8, 2.4, 0.8, 'h.leather', O);
    R(0.1 + toe, -2.4 + (f ? 0 : -0.6), 2.8, 2.4, 0.8, 'h.leather', O);
    // the far arm, behind the body
    if (!front) { R(-4.6, -13.4 - swing * 0.3, 1.8, 5, 0.8, 'h.tunic', { vcyl: true, bias: -0.28, outline: true }); if (!back) E(-3.7, -8.2 - swing * 0.3, 0.9, 0.9, 'skin', { bias: -0.2 }); }
    // the tunic: a flared skirt, folds, a yellow belt
    P([[-3.4, -14.2], [3.4, -14.2], [4.3, -6.6], [3, -5.6], [0, -6.1], [-3, -5.6], [-4.3, -6.6]], 'h.tunic', { vcyl: true, outline: true });
    for (const fx of [-1.6, 1.4]) c.line(X(fx), y - 8.4, X(fx * 1.35), y - 6, 'h.tunic', { s: 0.15 });
    R(-3.6, -9.6, 7.2, 1.2, 0.3, 'brass', { cyl: true });
    if (!back) { R(-0.7, -9.8, 1.4, 1.5, 0.3, 'brass', { bias: 0.25, outline: true }); P([[-1.4, -14.2], [1.4, -14.2], [0, -12.2]], 'skin', { bias: -0.15 }); c.line(X(0), y - 12.4, X(0), y - 10, 'h.tunic', { s: 0.2 }); }
    // the near arm(s)
    if (front) {
      for (const k of [-1, 1]) { c.rrect(x + (k < 0 ? -5.1 : 3.3), y - 13.6 + k * swing * 0.3, 1.8, 5, 0.8, 'h.tunic', { vcyl: true, outline: true }); c.ell(x + k * 4.2, y - 8.4 + k * swing * 0.3, 0.95, 0.95, 'skin', O); }
    } else if (!back) { R(2.8, -13.4 + swing * 0.3, 1.8, 5, 0.8, 'h.tunic', { vcyl: true, outline: true }); }
    else { R(-4.6, -13.4, 1.8, 5, 0.8, 'h.tunic', { vcyl: true, outline: true }); R(2.8, -13.4, 1.8, 5, 0.8, 'h.tunic', { vcyl: true, outline: true }); }
    // head: neck, face, hair under the cap
    R(-0.8, -15.2, 1.6, 1.4, 0, 'skin', { bias: -0.3 });
    E(0.2, -17.3, 2.8, 2.9, back ? 'h.hair' : 'skin', O);
    if (back) P([[-2.7, -16.2], [-2.8, -18.6], [2.9, -18.6], [2.8, -16.2], [1.6, -15.2], [-1.6, -15.2]], 'h.hair', { bias: 0.05 });
    else if (front) {
      P([[-2.8, -16.4], [-2.6, -18.8], [2.9, -18.8], [3, -16.4], [2.4, -17.9], [0.4, -18.3], [-2.1, -17.9]], 'h.hair', { bias: 0.05 });
      for (const ex of [-1, 1.4]) { c.dot(x + ex, y - 17.1, 'boot', 0); c.dot(x + ex, y - 16.8, 'boot', 0); c.dot(x + ex - 0.33, y - 17.6, 'h.hair', 0.2); c.dot(x + ex, y - 17.6, 'h.hair', 0.2); }
      c.dot(x + 0.2, y - 16.2, 'skin', 0.1); c.dot(x, y - 15.3, 'h.ruby', 0.3); c.dot(x + 0.33, y - 15.3, 'h.ruby', 0.3);
    } else {
      P([[-2.6, -15.6], [-2.8, -18.8], [2.6, -18.8], [1.6, -18.1], [-0.6, -17.8], [-1.4, -16]], 'h.hair', { bias: 0.05 });
      E(-1.4, -16.9, 0.6, 0.85, 'skin', { bias: -0.25 });
      for (const ex of [0.9, 2.3]) { c.dot(X(ex), y - 17.1, 'boot', 0); c.dot(X(ex), y - 16.8, 'boot', 0); }
      E(3, -16.4, 0.45, 0.5, 'skin', { bias: 0.05 }); c.dot(X(1.9), y - 15.3, 'h.ruby', 0.3); c.dot(X(2.2), y - 15.3, 'h.ruby', 0.3);
    }
    if (veil) { // the beekeeper's hat and net, in the orchard
      E(0.2, -19.4, 5.2, 1.3, 'h.straw', O); R(-2.4, -22.2, 5.2, 2.9, 1.2, 'h.straw', { vcyl: true, outline: true });
      for (let i = 0; i <= 8; i++) c.line(X(-4.4 + i * 1.15), y - 19, X(-3.4 + i * 0.9), y - 13.6, 'h.smoke', { s: 0.35 });
      for (const vy of [-17.4, -15.4]) c.line(X(-4.2), y + vy, X(4.4), y + vy, 'h.smoke', { s: 0.3 });
    } else {
      // the red cap: a dome, a band, a point that hangs back, and the white feather
      const fb = front ? 1.6 : -1.4, fd = front ? 1 : -1;
      P([[fb, -20.2], [fb + fd * 1.4, -22.8], [fb + fd * 3, -25.4], [fb + fd * 3.9, -25], [fb + fd * 3, -22.4], [fb + fd * 1.3, -19.8]], 'white', { bias: 0.3 });
      c.line(X(fb + fd * 0.6), y - 20.2, X(fb + fd * 3.2), y - 24.8, 'white', { s: 0.2 });
      if (!front) P([[-2.4, -21.4], [-6.2, -18.6], [-5.6, -17.8], [-2.2, -19.4]], 'h.crimson', O);
      E(0.2, -19.4, 3.3, 2.9, 'h.crimson', { clipY: [0, y - 18.8], rim: true, outline: true });
      R(-3.2, -19.6, 6.8, 1.3, 0.5, 'h.crimson', { cyl: true, bias: -0.15, outline: true });
      if (!front && !back) P([[2.8, -19.7], [5.2, -18.9], [3, -18.4]], 'h.crimson', O);
    }
    // the near arm when walking right or left, holding the lamp if it is lit
    if (!front && !back) E(3.7, -8.2 + swing * 0.3, 0.95, 0.95, 'skin', O);
    if (lamp) {
      const lx = front ? x + 4.6 : X(4.6), ly = y - 6.6 + (front ? 0 : swing * 0.3), fl = 0.9 + 0.1 * Math.sin(T(t) * 13);
      c.line(lx, ly - 2.4, lx, ly - 1.4, 'brass', { w: 0.34 });
      c.ell(lx, ly, 1.3, 1.1, 'brass', { rim: true, outline: true });
      c.rrect(lx - 0.7, ly - 1.4, 1.4, 1.3, 0.5, 'lamp', { emit: true });
      c.light(lx, ly - 1, 46 * fl, LAMP, 0.95 * fl);
    }
  }

  // ---------------------------------------------------------------- people and animals
  // the steward: a very old man in a very purple robe, white beard, a soft hat, the chain of office, hands behind his back
  function steward(c, x, y, t) {
    const br = Math.sin(T(t) * 1.3) * 0.18, blink = (T(t) * 0.6) % 5 < 0.1;
    c.z = 0.66;
    c.shadow(x, y, 7.4, 1.4, 0.55);
    c.ell(x - 2.2, y - 0.5, 1.8, 0.8, 'h.leather', O); c.ell(x + 2.2, y - 0.5, 1.8, 0.8, 'h.leather', O);
    // arms behind the back: only the elbows show
    c.rrect(x - 5.6, y - 14.6, 2.2, 6.4, 0.9, 'h.robe', { vcyl: true, bias: -0.15, outline: true });
    c.rrect(x + 3.4, y - 14.6, 2.2, 6.4, 0.9, 'h.robe', { vcyl: true, bias: -0.15, outline: true });
    c.poly([[x - 3.6, y - 15 - br], [x + 3.6, y - 15 - br], [x + 5.4, y - 0.8], [x - 5.4, y - 0.8]], 'h.robe', { vcyl: true, outline: true });
    for (const k of [-1, 1]) c.line(x + k * 1.6, y - 11, x + k * 3, y - 1.2, 'h.robe', { s: 0.12 });
    c.rect(x - 0.35, y - 13.6, 0.7, 12.6, 'brass', { flat: true, bias: 0.1 });
    c.poly([[x - 5.3, y - 2.2], [x + 5.3, y - 2.2], [x + 5.4, y - 0.8], [x - 5.4, y - 0.8]], 'brass', { cyl: true });
    c.ell(x, y - 14.4 - br, 4.6, 2, 'h.robe', { bias: 0.08, clipY: [0, y - 13.6] });
    // the chain of office
    for (let i = 0; i <= 8; i++) { const u = i / 8 * Math.PI; c.ell(x - Math.cos(u) * 3.4, y - 14.4 + Math.sin(u) * 2.6 - br, 0.45, 0.45, 'brass', { bias: 0.2 }); }
    c.ell(x, y - 11.2 - br, 1.1, 1.1, 'brass', { rim: true, outline: true }); c.dot(x, y - 11.3 - br, 'h.ruby', 0.8);
    // head, beard, moustache, eyebrows
    c.ell(x, y - 17.8, 2.7, 2.9, 'skin', O);
    c.poly([[x - 2.6, y - 17.2], [x + 2.6, y - 17.2], [x + 2, y - 14.4], [x + 0.6, y - 12.2], [x, y - 11.8], [x - 0.6, y - 12.2], [x - 2, y - 14.4]], 'h.beard', { outline: true });
    for (let i = 0; i < 4; i++) c.line(x - 1.2 + i * 0.8, y - 15.6, x - 0.6 + i * 0.4, y - 13, 'h.beard', { s: 0.3 });
    c.ell(x - 1, y - 16.4, 1.4, 0.6, 'h.beard', { bias: 0.15 }); c.ell(x + 1, y - 16.4, 1.4, 0.6, 'h.beard', { bias: 0.1 });
    c.ell(x, y - 17.1, 0.6, 0.55, 'skin', { bias: -0.05 });
    for (const ex of [-1.1, 1.1]) { if (blink) c.line(x + ex - 0.3, y - 18.2, x + ex + 0.3, y - 18.2, 'boot', { s: 0.1 }); else { c.dot(x + ex, y - 18.3, 'boot', 0); c.dot(x + ex, y - 18, 'boot', 0); } c.line(x + ex - 0.6, y - 19, x + ex + 0.5, y - 19.2, 'h.beard', { s: 0.9, w: 0.5 }); }
    c.ell(x - 2.6, y - 18.6, 0.9, 1.4, 'h.beard', { bias: 0.1 }); c.ell(x + 2.6, y - 18.6, 0.9, 1.4, 'h.beard', { bias: -0.1 });
    // the hat: a soft purple cap with a gold band and a tassel
    c.rrect(x - 3.1, y - 23.6, 6.2, 4, 1.8, 'h.robe', { vcyl: true, outline: true });
    c.ell(x + 1.4, y - 23.4, 2.8, 1.5, 'h.robe', { rim: true, outline: true });
    c.rect(x - 3.1, y - 20.6, 6.2, 1, 'brass', { cyl: true });
    c.line(x + 3.8, y - 23.2, x + 4.4, y - 20.6, 'brass', { w: 0.4 }); c.ell(x + 4.4, y - 20.2, 0.5, 0.7, 'brass');
  }
  // the troll: big, green, tired, leaning on a club; or asleep on his back
  function troll(c, x, y, t) {
    const br = Math.sin(T(t) * 1.6) * 0.35, yawn = (T(t) * 0.13) % 1 < 0.1;
    c.z = 0.66;
    c.shadow(x - 2, y, 13, 2, 0.6);
    // the club, standing on the ground by his left hand
    c.poly([[x - 12.4, y - 0.6], [x - 10.4, y - 0.6], [x - 9.8, y - 16], [x - 13.4, y - 16]], 'h.oak', { vcyl: true, outline: true });
    c.ell(x - 11.6, y - 19, 3, 4, 'h.oak', { rim: true, outline: true });
    for (const [kx, ky] of [[-12.6, -20.4], [-10.4, -18.2], [-12, -16.8]]) c.ell(x + kx, y + ky, 0.5, 0.5, 'h.iron', { bias: 0.3 });
    // legs and big feet
    c.rrect(x - 6, y - 7.4, 4.6, 7, 1.8, 'h.troll', { vcyl: true, outline: true }); c.rrect(x + 1.6, y - 7.4, 4.6, 7, 1.8, 'h.troll', { vcyl: true, outline: true });
    c.ell(x - 4.4, y - 0.9, 3.4, 1.4, 'h.troll', O); c.ell(x + 4.4, y - 0.9, 3.4, 1.4, 'h.troll', O);
    for (const tx of [-6.6, -5.2, 2.6, 4]) c.dot(x + tx, y - 0.6, 'bone', 0.6);
    // belly and chest
    c.ell(x, y - 15 - br * 0.3, 9, 9.4 + br, 'h.troll', { rim: true, outline: true });
    c.ell(x + 1, y - 12.6, 5.6, 4.8, 'h.troll', { bias: 0.08, flat: true });
    c.dot(x + 1, y - 11.4, 'h.troll', 0.1);
    for (const [wx, wy] of [[-4, -18], [3.6, -20], [5.4, -13]]) c.ell(x + wx, y + wy, 0.5, 0.45, 'h.troll', { bias: -0.2 });
    // a ragged loincloth with a rope belt
    c.poly([[x - 8.4, y - 10.6], [x + 8.4, y - 10.6], [x + 7.4, y - 5.8], [x + 4.6, y - 4.4], [x + 2.4, y - 5.8], [x, y - 4], [x - 2.6, y - 5.6], [x - 5, y - 4.2], [x - 7.4, y - 5.8]], 'h.leather', { outline: true });
    c.rect(x - 8.4, y - 11.2, 16.8, 1, 'h.rope', { cyl: true });
    // arms: one on the club, one hanging
    c.rrect(x - 11.4, y - 21, 3.6, 9, 1.6, 'h.troll', { vcyl: true, outline: true }); c.ell(x - 11.4, y - 12.6, 2, 1.8, 'h.troll', O);
    c.rrect(x + 7.6, y - 21, 3.6, 10.6, 1.6, 'h.troll', { vcyl: true, outline: true }); c.ell(x + 9.4, y - 10, 2, 2, 'h.troll', O);
    // head sunk into the shoulders
    c.ell(x - 6, y - 25.6, 1.6, 2.2, 'h.troll', O); c.ell(x + 7, y - 25.6, 1.6, 2.2, 'h.troll', O);
    c.ell(x + 0.5, y - 25, 6, 5.4, 'h.troll', { rim: true, outline: true });
    for (let i = 0; i < 5; i++) c.line(x - 2 + i, y - 30, x - 2.6 + i * 1.3, y - 32 - (i % 2), 'boot', { s: 0.4 });
    for (const ex of [-2.2, 2.8]) { c.ell(x + ex, y - 26, 1.3, 0.9, 'h.honey', { bias: 0.1 }); c.dot(x + ex + 0.2, y - 25.8, 'boot', 0); c.rect(x + ex - 1.4, y - 27.1, 2.8, 1, 'h.troll', { bias: -0.05, flat: true }); }
    c.poly([[x - 4.4, y - 28], [x + 5.6, y - 28.2], [x + 5, y - 27], [x - 4, y - 26.8]], 'h.troll', { bias: -0.25, flat: true });
    c.ell(x + 1, y - 23.6, 2, 1.6, 'h.troll', { rim: true, outline: true });
    if (yawn) c.ell(x + 0.6, y - 20.8, 2.6, 1.6, 'dark', { flat: true });
    else c.line(x - 2.6, y - 21, x + 3.8, y - 21.2, 'boot', { s: 0.1, w: 0.4 });
    for (const tx of [-1.8, 2.6]) c.poly([[x + tx - 0.5, y - 20.8], [x + tx + 0.5, y - 20.8], [x + tx, y - 22.6]], 'bone', O);
  }
  function trollAsleep(c, t) {
    const br = Math.sin(T(t) * 1.1) * 0.5;
    c.z = 0.66;
    c.shadow(127, 80.6, 17, 2.4, 0.6);
    c.poly([[110, 81.6], [112, 79.6], [134, 79.4], [134.6, 81.4]], 'h.oak', { cyl: true, outline: true }); c.ell(133.6, 80.2, 2.8, 2, 'h.oak', { rim: true, outline: true });
    c.rrect(111.4, 74.6, 7, 4, 1.8, 'h.troll', { cyl: true, outline: true }); c.ell(112.6, 72.6, 1.8, 2.6, 'h.troll', O); // legs and a foot up
    c.ell(126, 75.6 - br * 0.4, 11, 5.4 + br, 'h.troll', { rim: true, outline: true, clipY: [0, 80.6] });
    c.poly([[118, 76.4], [127, 76.6], [126.4, 80.4], [118.4, 80.4]], 'h.leather', { outline: true });
    c.rrect(124, 79.2, 9, 2.4, 1, 'h.troll', { cyl: true, outline: true }); c.ell(133, 80.2, 1.8, 1.4, 'h.troll', O);
    c.ell(139.4, 74.6, 5, 4.4, 'h.troll', { rim: true, outline: true });
    c.ell(141.4, 73.2, 1.8, 1.4, 'h.troll', { rim: true, outline: true });
    for (const ex of [137.6, 140.4]) c.line(ex - 0.6, 72.6, ex + 0.6, 72.8, 'boot', { s: 0.1 });
    const open = Math.sin(T(t) * 1.1) > 0;
    c.ell(140, 77, 1.6, open ? 1 : 0.4, 'dark', { flat: true });
    for (let i = 0; i < 3; i++) { const p = (T(t) * 0.4 + i / 3) % 1; c.text('Z', 142 + p * 5, 66 - p * 12, 'white', { s: 0.9 - p * 0.3, size: p > 0.5 ? 2 : 1 }); }
  }
  // the crow on its nest: glossy blue-black, one bright eye, a head that turns
  function crow(c, x, y, t) {
    const look = Math.sin(T(t) * 0.7) > -0.2 ? 1 : -1, hop = (T(t) * 0.8) % 4 < 0.2 ? -0.7 : 0, flap = (T(t) * 0.5) % 5 < 0.35;
    c.z = 0.3;
    c.poly([[x - 2.6, y + 0.4 + hop], [x - 7.6, y + 2.6 + hop], [x - 7, y + 3.8 + hop], [x - 2, y + 2 + hop]], 'h.crow', O);
    c.line(x - 0.6, y + 2.6, x - 1.2, y + 4.6, 'h.iron', { w: 0.34 }); c.line(x + 1.2, y + 2.6, x + 1.2, y + 4.6, 'h.iron', { w: 0.34 });
    c.ell(x, y + hop, 4, 2.9, 'h.crow', { rim: true, outline: true });
    if (flap) c.poly([[x - 2.6, y - 0.6 + hop], [x - 5.2, y - 6 + hop], [x - 1.6, y - 3.6 + hop], [x + 1.2, y - 0.8 + hop]], 'h.crow', { bias: 0.1, outline: true });
    else { c.ell(x - 0.8, y + 0.4 + hop, 3.2, 1.8, 'h.crow', { bias: -0.08 }); for (let i = 0; i < 3; i++) c.line(x - 3 + i * 1.2, y + 1.6 + hop, x - 1.4 + i * 1.2, y + 0.6 + hop, 'h.crow', { s: 0.75 }); }
    const hx = x + 2.6 * look, hy = y - 2.4 + hop;
    c.ell(hx, hy, 2.1, 1.9, 'h.crow', { rim: true, outline: true });
    c.poly([[hx + 1.5 * look, hy - 0.6], [hx + 4.4 * look, hy + 0.1], [hx + 1.5 * look, hy + 0.7]], 'h.iron', { bias: 0.15, outline: true });
    c.ell(hx + 0.7 * look, hy - 0.5, 0.45, 0.45, 'white', { emit: true }); c.dot(hx + 0.8 * look, hy - 0.5, 'boot', 0);
  }
  // the bear, asleep in a heap with its head on its paws; x, y is the floor under its middle
  function bear(c, x, y, t) {
    const br = Math.sin(T(t) * 1.1) * 0.5;
    c.z = 0.6;
    c.shadow(x + 1, y, 23, 3.4, 0.6);
    const fur = (cx, cy, rx, ry, seed, n) => { // short strokes, lighter toward the top left
      for (let i = 0; i < n; i++) {
        const a = hash(i, 1, seed) * 6.283, d = Math.sqrt(hash(i, 2, seed)) * 0.82, px = cx + Math.cos(a) * d * rx, py = cy + Math.sin(a) * d * ry;
        if (py > y - 0.8) continue;
        const lit = -(Math.cos(a) * d * 0.5 + Math.sin(a) * d * 0.8);
        c.line(px, py, px + 0.8, py + 1.1, 'h.fur', { s: 0.38 + lit * 0.5 });
      }
    };
    // hind leg and rump, the long back, the shoulder hump
    c.ell(x - 14, y - 6.6, 8, 6.8, 'h.fur', { rim: true, outline: true, clipY: [0, y + 0.4] });
    c.ell(x - 20, y - 0.9, 3.6, 1.5, 'h.fur', O);
    for (const cx of [-22.4, -21, -19.6]) c.dot(x + cx, y - 0.2, 'bone', 0.7);
    c.ell(x - 3, y - 7.6 - br * 0.3, 15.6, 8.6 + br, 'h.fur', { rim: true, outline: true, clipY: [0, y + 0.6] });
    c.ell(x + 5, y - 10.4 - br * 0.3, 8, 6.6 + br * 0.5, 'h.fur', { rim: true, bias: 0.04 });
    fur(x - 3, y - 8, 15, 8.4, 77, 80); fur(x - 14, y - 7, 7.4, 6, 78, 24);
    c.line(x - 14, y - 1, x + 8, y - 0.8, 'h.fur', { s: 0.05, w: 0.6 });
    // front paws stretched out, the head resting on them
    c.ell(x + 12, y - 1.1, 5, 1.8, 'h.fur', O); c.ell(x + 17.4, y - 0.9, 3.8, 1.6, 'h.fur', O);
    for (const cx of [14.6, 16, 19.6, 21]) c.dot(x + cx, y - 0.1, 'bone', 0.75);
    c.ell(x + 9.4, y - 11.8, 2.2, 2, 'h.fur', O); c.ell(x + 17.4, y - 12, 2.2, 2, 'h.fur', O);
    c.ell(x + 9.4, y - 11.6, 1.1, 1, 'h.muzzle', { bias: -0.3, flat: true }); c.ell(x + 17.4, y - 11.8, 1.1, 1, 'h.muzzle', { bias: -0.3, flat: true });
    c.ell(x + 13.4, y - 6.6, 7.2, 5.8, 'h.fur', { rim: true, outline: true });
    fur(x + 13.4, y - 7, 6.6, 5, 79, 26);
    c.ell(x + 16.6, y - 3.8, 3.6, 2.6, 'h.muzzle', { rim: true, outline: true });
    c.ell(x + 19.2, y - 4.8, 1.3, 0.95, 'dark'); c.dot(x + 18.8, y - 5.1, 'white', 0.8);
    c.line(x + 16, y - 2.4, x + 18.4, y - 2.6, 'boot', { s: 0.2 });
    for (const ex of [10.6, 15]) c.line(x + ex, y - 7.6, x + ex + 1.6, y - 7.3, 'boot', { s: 0.1, w: 0.4 });
    for (let i = 0; i < 3; i++) { const p = (T(t) * 0.35 + i / 3) % 1; c.text('Z', x + 21 + p * 5, y - 15 - p * 12, 'white', { s: 0.9 - p * 0.3, size: p > 0.5 ? 2 : 1 }); }
  }
  // Old Marta in her rocking chair, knitting; x, y is the floor under the seat
  function marta(c, x, y, t) {
    const rock = Math.sin(T(t) * 1.3) * 0.6, k = Math.sin(T(t) * 7) * 0.4, u = rock * 0.6;
    c.z = 0.62;
    c.shadow(x, y, 12.4, 1.8, 0.55);
    // the chair: curved rockers, a spindle back, the seat
    c.poly([[x - 12.4, y - 2.6], [x - 10, y - 0.9], [x + 9, y - 0.9], [x + 11.6, y - 2.8], [x + 11.8, y - 1.6], [x + 9.6, y + 0.2], [x - 10.4, y + 0.2], [x - 12.6, y - 1.6]], 'wood', { outline: true });
    for (const px of [1.4 + u, 8.4 + u]) c.rrect(x + px, y - 27, 1.4, 17.4, 0.6, 'wood', { vcyl: true, outline: true });
    for (const px of [3.6, 5.4, 7]) c.rect(x + px + u, y - 25.6, 0.7, 15, 'wood', { vcyl: true, bias: -0.15 });
    c.rrect(x + 0.6 + u, y - 28.8, 10, 2.6, 1.2, 'wood', { cyl: true, outline: true });
    for (const lx of [-7, 6.4]) c.line(x + lx, y - 9.2, x + lx * 1.15, y - 1.4, 'wood', { w: 0.8 });
    c.rrect(x - 8.6, y - 10.6, 18, 2.2, 0.8, 'wood', { cyl: true, outline: true });
    // skirt over the lap and down to the shoes, a white apron
    c.ell(x - 8.8, y - 1.1, 1.9, 0.9, 'h.leather', O); c.ell(x - 4.8, y - 1.1, 1.9, 0.9, 'h.leather', O);
    c.poly([[x - 10.2, y - 12], [x - 3.6, y - 12], [x - 2.6, y - 1.6], [x - 10.8, y - 1.6]], 'punch', { vcyl: true, outline: true });
    c.rrect(x - 10 + u * 0.5, y - 14.6, 15.6, 4.6, 2, 'punch', { cyl: true, outline: true });
    for (const fx of [-8.6, -6.4, -4.4]) c.line(x + fx, y - 10.6, x + fx - 0.4, y - 2, 'punch', { s: 0.2 });
    c.poly([[x - 9.4 + u * 0.5, y - 14.2], [x - 3 + u * 0.5, y - 14.2], [x - 3.4, y - 6.6], [x - 9.8, y - 6.6]], 'white', { vcyl: true, bias: -0.05, outline: true });
    for (let i = 0; i < 7; i++) c.ell(x - 9.4 + i, y - 6.5, 0.5, 0.45, 'white', { flat: true, bias: 0.1 });
    c.line(x - 6.6, y - 12.6, x - 6.8, y - 7.4, 'white', { s: 0.25 });
    // body and shawl
    c.rrect(x - 3.4 + u, y - 22.4, 8, 10, 2.8, 'cloth', { vcyl: true, outline: true });
    c.poly([[x - 3.8 + u, y - 22.2], [x + 5 + u, y - 22.2], [x + 4.8 + u, y - 20.2], [x + 0.6 + u, y - 16.8], [x - 3.6 + u, y - 20.2]], 'h.crimson', { vcyl: true, outline: true });
    for (let i = 0; i < 6; i++) c.dot(x - 2.6 + u + i * 0.55, y - 19.8 + i * 0.5, 'h.crimson', 0.85);
    // arms, hands, needles and the knitting
    c.rrect(x - 4.8 + u, y - 21.4, 2.2, 6.4, 1, 'cloth', { vcyl: true, outline: true });
    c.line(x - 3.8 + u, y - 15.6, x - 7.4, y - 16, 'cloth', { w: 1.6, s: 0.55 });
    c.line(x + 3 + u, y - 17, x - 4.2, y - 15.2, 'cloth', { w: 1.6, s: 0.45 });
    c.rect(x - 8.6, y - 16, 4.2, 4, 'h.crimson', { bias: 0.05 }); c.rect(x - 8.6, y - 14.6, 4.2, 1.2, 'h.honey', { flat: true });
    c.line(x - 11 + k, y - 19.4, x - 4.4 - k, y - 14.6, 'brass', { w: 0.34, s: 0.85 }); c.line(x - 10.6 - k, y - 14.8, x - 3.4 + k, y - 19, 'brass', { w: 0.34, s: 0.85 });
    c.ell(x - 7.8, y - 16.2, 1.1, 1, 'skin', O); c.ell(x - 4.6, y - 15.4, 1.1, 1, 'skin', O);
    // head: grey hair in a bun, little round spectacles, rosy cheeks
    c.rrect(x - 0.6 + u, y - 23.4, 2, 1.6, 0.4, 'skin', { bias: -0.25 });
    c.ell(x + 0.2 + u, y - 25.4, 3.1, 3.2, 'skin', O);
    c.poly([[x - 2.4 + u, y - 26.4], [x - 2 + u, y - 28], [x + 0.4 + u, y - 28.8], [x + 3.2 + u, y - 27.8], [x + 3.5 + u, y - 24.8], [x + 2.8 + u, y - 23.4], [x + 2.4 + u, y - 26.2], [x - 0.2 + u, y - 27]], 'h.beard', { outline: true });
    c.ell(x + 2.4 + u, y - 29.2, 1.7, 1.4, 'h.beard', { rim: true, outline: true });
    for (const ex of [-1.6, 0.6]) { c.ell(x + ex + u, y - 25.4, 0.8, 0.75, 'brass', { flat: true, bias: 0.15 }); c.ell(x + ex + u, y - 25.4, 0.5, 0.45, 'skin', { flat: true, bias: 0.15 }); c.dot(x + ex + u, y - 25.3, 'boot', 0); }
    c.line(x - 0.8 + u, y - 25.4, x - 0.2 + u, y - 25.4, 'brass', { s: 0.6 });
    c.ell(x - 2.8 + u, y - 24.6, 0.45, 0.5, 'skin', { bias: 0.05 });
    c.dot(x - 2 + u, y - 24, 'h.ruby', 0.75); c.dot(x + 1 + u, y - 24, 'h.ruby', 0.75);
    c.line(x - 1.4 + u, y - 23.1, x - 0.2 + u, y - 23, 'h.ruby', { s: 0.3 });
  }
  // a wooden bucket; x, y is the bottom middle
  function bucket(c, x, y) {
    c.poly([[x - 3, y - 4.6], [x + 3, y - 4.6], [x + 2.4, y], [x - 2.4, y]], 'wood', { vcyl: true, outline: true });
    for (const by of [-3.6, -1.2]) c.rect(x - 2.9 + (by + 4.6) * 0.12, y + by, 5.8 - (by + 4.6) * 0.24, 0.6, 'h.iron', { cyl: true });
    c.ell(x, y - 4.5, 2.9, 0.7, 'h.water', { bias: -0.1 });
    c.line(x - 3, y - 4.6, x - 1.6, y - 7, 'h.iron', { w: 0.34 }); c.line(x - 1.6, y - 7, x + 1.6, y - 7, 'h.iron', { w: 0.34 }); c.line(x + 1.6, y - 7, x + 3, y - 4.6, 'h.iron', { w: 0.34 });
  }
  function rubyGem(c, x, y, t, s) { // x, y: where it rests
    s = s || 1;
    c.shadow(x + 0.4, y, 3.4 * s, 0.8 * s, 0.5);
    c.poly([[x - 2.6 * s, y - 2.4 * s], [x - 1.4 * s, y - 3.6 * s], [x + 1.4 * s, y - 3.6 * s], [x + 2.6 * s, y - 2.4 * s], [x, y]], 'h.ruby', O);
    c.poly([[x - 1.2 * s, y - 3.2 * s], [x + 1.2 * s, y - 3.2 * s], [x + 1.8 * s, y - 2.4 * s], [x - 1.8 * s, y - 2.4 * s]], 'h.ruby', { flat: true, bias: 0.35 });
    c.poly([[x - 1.8 * s, y - 2.4 * s], [x - 0.4 * s, y - 2.4 * s], [x, y]], 'h.ruby', { flat: true, bias: 0.15 });
    c.poly([[x + 0.6 * s, y - 2.4 * s], [x + 2.4 * s, y - 2.4 * s], [x, y]], 'h.ruby', { flat: true, bias: -0.25 });
    if (Math.sin(T(t) * 2.6) > 0.6) for (const [dx, dy] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) c.dot(x + 1 * s + dx, y - 3.4 * s + dy, 'sunlamp', 1, true);
    c.light(x, y - 2, 12 * s, [255, 70, 90], 0.4 + 0.15 * Math.sin(T(t) * 3));
  }
  function ladle(c, x, y, t, s) { // x, y: the middle of the bowl
    s = s || 1;
    c.poly([[x - 12.6 * s, y + 0.5 * s], [x - 2.6 * s, y - 0.3 * s], [x - 2.6 * s, y + 0.7 * s], [x - 12.6 * s, y + 1.5 * s]], 'h.silver', { cyl: true, outline: true });
    c.ell(x - 12.6 * s, y + 1 * s, 0.9 * s, 0.7 * s, 'brass', { rim: true });
    c.ell(x, y, 3.1 * s, 1.8 * s, 'h.silver', { rim: true, outline: true });
    c.ell(x - 0.2 * s, y - 0.4 * s, 2.3 * s, 0.9 * s, 'h.silver', { flat: true, bias: -0.25 });
    if (Math.floor(T(t) * 3) % 4 === 0) for (const [dx, dy] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) c.dot(x + 1.2 * s + dx, y - 1.6 * s + dy, 'sunlamp', 1, true);
  }
  function brassLamp(c, x, y, lit, t) { // x, y: the foot of the lamp
    c.ell(x, y - 0.4, 2.6, 0.8, 'brass', { outline: true });
    c.rect(x - 0.6, y - 1.6, 1.2, 1.2, 'brass', { vcyl: true });
    c.ell(x, y - 3, 2.4, 1.8, 'brass', { rim: true, outline: true });
    c.ell(x + 3, y - 3, 1, 1.3, 'brass', { flat: true, bias: -0.2 }); c.ell(x + 3, y - 3, 0.5, 0.8, 'h.plaster', { flat: true, bias: -0.3 });
    c.rrect(x - 1.1, y - 8.6, 2.2, 4.4, 1, 'glass', { vcyl: true, outline: true, bias: 0.1 });
    c.rect(x - 1.3, y - 9.2, 2.6, 0.8, 'brass', { cyl: true });
    if (lit) { c.ell(x, y - 6, 0.6, 1.2, 'lamp', { emit: true }); c.light(x, y - 6, 36, LAMP, 0.8 + 0.1 * Math.sin(T(t) * 12)); }
    else c.line(x, y - 5, x, y - 5.8, 'boot', { s: 0.3 });
  }
  function ropeCoil(c, x, y) { // x, y: the middle of the coil on the ground
    c.shadow(x + 0.6, y + 0.6, 6.6, 1.8, 0.55);
    for (const [rx, ry, dy] of [[5.6, 2.7, 0], [4.4, 2, -0.7], [3.2, 1.4, -1.3]]) {
      c.ell(x, y + dy, rx, ry, 'h.rope', { rim: true, outline: true });
      for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283; c.line(x + Math.cos(a) * rx * 0.86, y + dy + Math.sin(a) * ry * 0.86, x + Math.cos(a) * rx * 0.86 + 0.5, y + dy + Math.sin(a) * ry * 0.86 + 0.4, 'h.rope', { s: 0.25 }); }
    }
    c.ell(x, y - 1.4, 1.8, 0.7, 'dark', { flat: true });
    c.poly([[x + 4.8, y + 0.6], [x + 8.6, y + 1.8], [x + 9.8, y + 1.2], [x + 9.8, y + 2.2], [x + 8.4, y + 2.8], [x + 4.4, y + 1.8]], 'h.rope', { outline: true });
  }
  function strawHat(c, x, y, net) { // x, y: the middle of the brim
    c.ell(x, y, 6.6, 1.8, 'h.straw', { rim: true, outline: true });
    c.rrect(x - 3.2, y - 3.8, 6.4, 4, 1.8, 'h.straw', { vcyl: true, outline: true });
    c.rect(x - 3.2, y - 1.2, 6.4, 0.9, 'h.crimson', { cyl: true });
    for (let i = 0; i < 6; i++) c.line(x - 5.6 + i * 2.2, y + 0.4, x - 5 + i * 2.2, y - 0.6, 'h.straw', { s: 0.25 });
    if (!net) return;
    for (let i = 0; i <= 10; i++) c.line(x - 6.2 + i * 1.24, y + 1.2, x - 5 + i * 1, y + 9.4, 'h.smoke', { s: 0.4 });
    for (let j = 0; j < 5; j++) { const yy = y + 2.4 + j * 1.6; c.line(x - 6 + j * 0.24, yy, x + 6 - j * 0.24, yy, 'h.smoke', { s: 0.3 }); }
  }
  function grassBlades(c, x, y, n, seed) { tufts(c, x - 1, y, 2, 0.4, n || 2, seed || 5); }

  const items = {
    flute: { name: 'wooden flute', aliases: ['flute', 'pipe', 'whistle'], desc: 'A small wooden flute, worn smooth. It has a soft, sleepy sound.',
      verbs: { play(g) {
        if (g.state.room === 'bridge' && !g.flag('troll_asleep')) {
          g.set('troll_asleep'); g.score(10, 'troll');
          g.say('You play a slow, slow tune. The troll\'s eyes droop. His club slips from his hand and he topples over, snoring like a landslide. The bridge is yours.');
        } else if (g.state.room === 'cave' && !g.flag('bear_gone')) g.say('The bear shifts in its sleep. You stop playing, very quickly.');
        else g.say('You play a little tune. Somewhere, a bird answers.');
      } } },
    rope: { name: 'coil of rope', aliases: ['rope', 'cord', 'coil'], desc: 'A sturdy coil of rope.' },
    coin: { name: 'silver coin', aliases: ['coin', 'silver', 'money'], desc: 'A bright silver coin. It is rather shiny.' },
    jewel: { name: 'ruby', aliases: ['ruby', 'jewel', 'gem', 'crown jewel', 'royal jewel'], desc: 'The Crown Jewel of Hollowmere, a ruby the size of a plum.' },
    lamp: { name: 'brass lamp', aliases: ['lamp', 'lantern', 'brass lamp', 'oil lamp'],
      desc: g => (g.flag('lamp_lit') ? 'A brass lamp, burning with a steady yellow flame.' : 'A brass oil lamp. It is not lit.'),
      verbs: { light(g) {
        if (g.flag('lamp_lit')) return g.say('It is already lit.');
        if (!g.has('tinderbox')) return g.say('You have nothing to light it with.');
        g.set('lamp_lit'); g.score(5, 'lamp'); g.say('You strike a spark. The lamp catches and glows warm and yellow.');
      } } },
    tinderbox: { name: 'tinderbox', aliases: ['tinder', 'flint', 'box', 'tinder box'], desc: 'A tin box with flint, steel and dry tinder.' },
    veil: { name: 'beekeeper\'s veil', aliases: ['veil', 'hat', 'net', 'beekeepers veil', 'bee veil'], desc: g => (g.flag('veil_on') ? 'You are wearing the veil. You feel a bit silly.' : 'A wide straw hat with a net veil hanging from the brim.'),
      verbs: { wear(g) { if (g.flag('veil_on')) return g.say('You are already wearing it.'); g.set('veil_on'); g.say('You put on the veil. The world looks like it is behind a screen door.'); },
        drop(g) { g.say('Dropped.'); } } },
    honey: { name: 'honeycomb', aliases: ['honey', 'comb', 'honeycomb'], desc: 'A dripping chunk of golden honeycomb. A few bees are still hanging on to it.', food: 'Delicious! But you suspect you needed that for something.' },
    ladle: { name: 'royal ladle', aliases: ['ladle', 'spoon', 'royal ladle', 'soup ladle'], desc: 'A heavy silver ladle with a crown stamped on the handle. The Royal Ladle of Hollowmere.' },
    banner: { name: 'royal banner', aliases: ['banner', 'flag', 'royal banner', 'cloth'], desc: 'A big crimson banner with a golden crown. It smells strongly of bear.' },
  };

  const treasures = { jewel: 'ruby', ladle: 'ladle', banner: 'banner' };

  // how each thing looks if you drop it somewhere (x, y: where it lies)
  const dropArt = {
    flute: (c, x, y) => { c.rrect(x - 3.4, y - 1.6, 6.8, 1.4, 0.6, 'wood', { cyl: true, outline: true }); for (const hx of [-0.6, 0.8, 2.2]) c.dot(x + hx, y - 1, 'dark', 0); },
    rope: (c, x, y) => ropeCoil(c, x - 1.6, y - 1.6),
    coin: (c, x, y, g) => { c.ell(x, y - 0.8, 1.4, 0.7, 'h.silver', { rim: true, outline: true }); },
    jewel: (c, x, y) => rubyGem(c, x, y, 0, 0.9),
    lamp: (c, x, y, g) => brassLamp(c, x, y, g && g.flag('lamp_lit'), 0),
    tinderbox: (c, x, y) => { c.rrect(x - 2.6, y - 2.4, 5.2, 2.2, 0.5, 'h.silver', { outline: true }); c.rect(x - 2.6, y - 2.4, 5.2, 0.7, 'h.silver', { cyl: true, bias: 0.15 }); },
    veil: (c, x, y) => strawHat(c, x, y - 1.2, false),
    honey: (c, x, y) => { c.poly([[x - 2.6, y - 1], [x - 1.4, y - 3.4], [x + 1.4, y - 3.4], [x + 2.6, y - 1], [x + 1.4, y + 0.2], [x - 1.4, y + 0.2]], 'h.honey', { outline: true }); for (const [dx, dy] of [[-0.8, -2], [0.8, -2], [0, -1]]) c.ell(x + dx, y + dy, 0.5, 0.4, 'h.honey', { flat: true, bias: 0.35 }); },
    ladle: (c, x, y) => ladle(c, x + 2, y - 1.4, 0, 0.5),
    banner: (c, x, y) => { c.poly([[x - 3.4, y - 2.4], [x + 3, y - 2.8], [x + 3.6, y], [x - 3, y + 0.4]], 'h.crimson', { outline: true }); c.ell(x, y - 1.2, 1, 0.6, 'brass'); },
  };
  for (const [id, fn] of Object.entries(dropArt)) items[id].draw = (c, x, y, g) => { c.z = 0.62; c.shadow(x + 0.4, y, 3.4, 0.8, 0.5); fn(c, x, y, g); };

  function giveToSteward(id, text) {
    return g => {
      g.lose(id); g.set('gave_' + id); g.score(5, 'gave_' + id);
      const n = ['jewel', 'ladle', 'banner'].filter(t => g.flag('gave_' + t)).length;
      g.say(text);
      if (n === 3) {
        g.score(5, 'finish');
        g.win('The steward lays the ruby in the crown, hangs the banner on the wall and sets the ladle on the royal soup pot. The bells of Hollowmere ring all night long. At dawn they call you Your Majesty, and the first thing you do is have a very large bowl of soup.');
      } else g.say('"' + (3 - n) + ' to go," says the steward.');
    };
  }

  const rooms = {
    // ---------------------------------------------------------------- the castle
    castle: {
      name: 'Hollowmere Castle', horizon: 54, exits: { e: 'meadow' },
      desc: 'Hollowmere Castle. Its gate is shut, and the royal steward stands before it with his hands behind his back. The only open way is east, back to the meadow.',
      blocks: [[0, 0, 160, 54], [88, 60, 14, 8]],
      look: 'golden',
      back(c, g, t) {
        sky(c, 32, 'h.dusk', [0.15, 0.92]);
        sun(c, 64, 8, 4.4, { rays: true, from: 0.2, to: 1.5, reach: 240, i: 0.26, a: 0.07 });
        clouds(c, t, [[20, 8, 0.9, 0.25], [104, 5, 1.2, 0.18], [150, 19, 0.7, 0.3]]);
        // two spires of the keep, behind the walls
        c.z = 0.1;
        for (const [sx, top, w, rh] of [[38, 8, 10, 13], [114, 13, 9, 11]]) {
          stoneRow(c, sx - w / 2, top, w, 30 - top, { vcyl: true, row: 3, len: 4 });
          c.rrect(sx - 1, top + 6, 2, 3.4, 0.9, 'lamp', { emit: true, bias: -0.4 }); c.light(sx, top + 7.6, 12, LAMP, 0.4);
          c.poly([[sx - w / 2 - 1.4, top + 0.5], [sx, top - rh], [sx + w / 2 + 1.4, top + 0.5]], 'h.slate', { vcyl: true, outline: true });
          c.ell(sx, top - rh - 0.4, 0.7, 0.7, 'brass', { rim: true });
        }
        pennant(c, 114, 2, t, 7);
        // the curtain wall, its battlements, and banners
        c.z = 0.2;
        stoneRow(c, 0, 30, 160, 28, { row: 3, len: 6, seed: 2, grad: [0.52, 0.36] });
        merlons(c, 0, 30, 160);
        for (const bx of [38, 120]) {
          const sw = Math.sin(T(t) * 1.4 + bx) * 0.5;
          c.rect(bx - 5, 32.6, 10, 0.8, 'h.bark', { cyl: true });
          c.poly([[bx - 4.2, 33.4], [bx + 4.2, 33.4], [bx + 4.2 + sw * 0.6, 46], [bx + sw, 49], [bx - 4.2 + sw * 0.6, 46]], 'h.crimson', { vcyl: true, outline: true });
          c.poly([[bx - 2.6, 39.6], [bx - 1.4, 37.6], [bx, 39], [bx + 1.4, 37.6], [bx + 2.6, 39.6], [bx + 2.4, 41.6], [bx - 2.4, 41.6]], 'brass', { bias: 0.15 });
        }
        // ivy at the foot of the wall
        for (let i = 0; i < 26; i++) { const ix = hash(i, 1, 3) < 0.5 ? 2 + hash(i, 2, 3) * 50 : 110 + hash(i, 2, 3) * 44, iy = 44 + hash(i, 3, 3) * 13; c.ell(ix, iy, 1.4 + hash(i, 4, 3), 1.1, 'h.leaf', { bias: -0.05 }); }
        // round towers with slate cones
        for (const [tx, top, w] of [[8, 14, 22], [130, 18, 22]]) {
          c.z = 0.22;
          stoneRow(c, tx, top, w, 58 - top, { vcyl: true, row: 3.2, len: 5 });
          c.rect(tx - 0.6, top + 7, w + 1.2, 1.4, 'h.stone', { vcyl: true, bias: 0.12 });
          for (const sy of [top + 13, top + 28]) c.rrect(tx + w / 2 - 0.8, sy, 1.6, 4.6, 0.7, 'dark', { flat: true });
          c.rrect(tx + w / 2 - 1.8, top + 20, 3.6, 4.6, 1.6, 'lamp', { emit: true, bias: -0.45 }); c.light(tx + w / 2, top + 22, 18, LAMP, 0.45);
          c.poly([[tx - 2, top + 0.6], [tx + w / 2, top - 15], [tx + w + 2, top + 0.6]], 'h.slate', { vcyl: true, outline: true });
          for (let k = 1; k < 5; k++) { const yy = top + 0.6 - k * 3.1, hw = (w / 2 + 2) * (1 - k * 3.1 / 15.6); c.line(tx + w / 2 - hw, yy, tx + w / 2 + hw, yy, 'h.slate', { s: 0.15 }); }
          c.rect(tx - 2, top, w + 4, 1.4, 'h.slate', { vcyl: true, bias: -0.15 });
        }
        // the gatehouse
        c.z = 0.24;
        stoneRow(c, 54, 16, 52, 42, { row: 3, len: 5, seed: 5, grad: [0.58, 0.4] });
        merlons(c, 54, 16, 52);
        pennant(c, 80, 13, t, 9);
        c.poly([[76.6, 18.6], [83.4, 18.6], [83.4, 22.4], [80, 25.4], [76.6, 22.4]], 'h.crimson', { outline: true });
        c.poly([[77.8, 22], [78.4, 19.8], [79.2, 21], [80, 19.4], [80.8, 21], [81.6, 19.8], [82.2, 22]], 'brass', { bias: 0.2 });
        for (const sx of [62, 98]) c.rrect(sx - 0.7, 21, 1.4, 4.4, 0.6, 'dark', { flat: true });
        // lanterns either side of the gate
        for (const lx of [57.4, 102.6]) {
          const fl = 0.85 + 0.15 * Math.sin(T(t) * 9 + lx);
          c.line(lx, 34, lx, 36, 'h.iron', { w: 0.4 }); c.rect(lx - 1.2, 33.4, 2.4, 0.7, 'h.iron', { cyl: true });
          c.rrect(lx - 1.1, 36, 2.2, 3, 0.5, 'lamp', { emit: true, bias: -0.2 }); c.rect(lx - 1.4, 38.8, 2.8, 0.7, 'h.iron', { cyl: true });
          c.light(lx, 37.6, 26, LAMP, 0.6 * fl);
        }
        // the arch, the oak gate and its iron bands
        c.z = 0.26;
        c.poly(archPts(60, 100, 41, 13, 58), 'h.stone', { grad: [0.66, 0.48], outline: true });
        for (let i = 1; i < 10; i++) { const a = Math.PI * i / 10; c.line(80 + Math.cos(a) * 15.6, 41 - Math.sin(a) * 9.6, 80 + Math.cos(a) * 20, 41 - Math.sin(a) * 13, 'h.stone', { s: 0.12 }); }
        c.poly([[78.4, 27.8], [81.6, 27.8], [81, 32], [79, 32]], 'h.stone', { bias: 0.25, outline: true });
        c.poly(archPts(64.4, 95.6, 41, 9.8, 58), 'dark', { flat: true });
        const plank = px => (Math.floor((px - 65) / 3) % 2 ? 'h.oak' : 'wood');
        c.poly(archPts(65.2, 94.8, 41, 9, 58), plank, { outline: true, grad: [0.62, 0.42] });
        for (let x = 68; x < 94; x += 3) { const top = 41 - 9 * Math.sqrt(Math.max(0, 1 - ((x - 80) / 14.8) * ((x - 80) / 14.8))); c.line(x, top + 0.4, x, 57.8, 'h.bark', { s: x === 80 ? 0 : 0.1, w: x === 80 ? 0.7 : 0.34 }); }
        for (const by of [44.6, 52.6]) { c.rect(65.2, by, 29.6, 1.3, 'h.iron', { cyl: true }); for (let x = 67; x < 94; x += 3) c.ell(x, by + 0.65, 0.35, 0.35, 'h.iron', { bias: 0.4 }); }
        for (const rx of [77.4, 82.6]) { c.ell(rx, 49.4, 1.2, 1.4, 'h.iron', { outline: true }); c.ell(rx, 49.4, 0.6, 0.8, 'h.oak', { flat: true }); }
        c.rect(61.6, 57.2, 36.8, 1.6, 'h.stone', { cyl: true });
        // the ground: grass, the cobbled road from the gate to the east
        grassland(c, 58, 11, { n: 160 });
        c.shadow(80, 58.4, 92, 2.2, 0.45);
        const road = [[62, 58.6], [98, 58.6], [112, 62], [160, 62.6], [160, 73.6], [114, 74], [92, 71], [74, 66.4], [64, 61.6]];
        c.z = 0.41;
        c.poly(road, 'h.cobble', { grad: [0.6, 0.45], dither: true });
        for (let row = 0; row < 12; row++) for (let i = 0; i < 40; i++) {
          const yy = 59.4 + row * 1.25, xx = 60 + i * 2.6 + (row % 2) * 1.3 + (hash(i, row, 8) - 0.5) * 0.5;
          if (!inPoly(road, xx, yy)) continue;
          c.ell(xx, yy, 1.05, 0.5, 'h.cobble', { bias: (hash(i, row, 9) - 0.5) * 0.3 });
        }
        for (let k = 0; k < road.length; k++) { const a = road[k], b = road[(k + 1) % road.length]; for (let j = 0; j < 10; j++) { const u = hash(k, j, 12); tufts(c, a[0] + (b[0] - a[0]) * u - 0.5, a[1] + (b[1] - a[1]) * u, 1, 0.4, 1, k * 13 + j); } }
        // a stone planter by the road (where the hero cannot walk)
        c.z = 0.5;
        c.shadow(95.4, 67.6, 8.4, 1.4, 0.5);
        c.rrect(88.6, 62.6, 13.6, 5, 0.8, 'h.stone', { outline: true });
        c.ell(95.4, 62.8, 6.4, 1.2, 'h.dirt', { bias: -0.3 });
        foliage(c, 95.4, 61, 6, 2.4, 41, t, 'h.leaf');
        for (let i = 0; i < 9; i++) c.ell(90.4 + hash(i, 1, 41) * 10, 59.6 + hash(i, 2, 41) * 2.6, 0.75, 0.65, i % 3 ? 'h.crimson' : 'h.honey', { rim: true });
        // hedges, bushes, flowers
        bush(c, 18, 70, 1.1, 4, { fruit: 0 });
        bush(c, 148, 92, 1.4, 7);
        bush(c, 4, 60, 0.8, 9); bush(c, 154, 60, 0.8, 10);
        flowers(c, 4, 80, 50, 18, 26, 2);
        flowers(c, 118, 78, 40, 12, 12, 6);
      },
      objects: [
        { id: 'gate', name: 'castle gate', aliases: ['gate', 'door', 'castle', 'doors', 'portcullis'], rect: [60, 28, 40, 30], at: [80, 64],
          desc: 'A tall oak gate with iron bands. It is shut tight.',
          verbs: { open: 'The steward steps in front of you. "Not yet. The treasures first."', push: 'It will not budge. The steward coughs politely.', enter: 'The steward steps in front of you. "Not yet. The treasures first."', talk: 'Nobody is home but the steward.' } },
        { id: 'steward', name: 'steward', aliases: ['man', 'old man', 'royal steward', 'butler', 'guard'], rect: [102, 62, 12, 20], at: [96, 80], base: 82,
          draw(c, g, t) { steward(c, 108, 82, t); },
          desc: 'The royal steward of Hollowmere, a very old man in a very purple robe. He has been waiting a long time.',
          verbs: {
            talk(g) {
              if (!g.flag('met_steward')) {
                g.set('met_steward');
                g.say('"Ah! At last, someone. The old king is gone and left no heir. The crown is in pieces: the Ruby from its band, the Royal Ladle, and the Royal Banner. A crow, a troll and a bear have them. Bring all three back and the crown is yours. Don\'t ask why the ladle matters. It is soup. It is always soup."');
              } else if (!g.has('jewel') && !g.flag('gave_jewel')) g.say('"The ruby? A crow took it. Crows love shiny things. Do you have anything shiny?"');
              else if (!g.flag('gave_ladle')) g.say('"The ladle was last seen across the river. Mind the troll."');
              else if (!g.flag('gave_banner')) g.say('"The banner. A bear sleeps on it, in the cave past the forest. It is dark in there. And bears like honey, I hear."');
              else g.say('"Wonderful. Wonderful!"');
            },
            attack: 'You raise a fist. The steward raises an eyebrow. You lower the fist.',
            kiss: 'The steward goes pink. "I am on duty."',
            give: {
              jewel: giveToSteward('jewel', 'The steward takes the ruby with both hands, and a tear runs into his moustache. "The Crown Jewel."'),
              ladle: giveToSteward('ladle', 'The steward polishes the ladle on his sleeve. "Oh, I have missed this."'),
              banner: giveToSteward('banner', 'The steward holds the banner at arm\'s length. "It smells of bear. That can be fixed."'),
              '*': 'The steward shakes his head. "That is not one of the royal treasures."',
            },
          } },
      ],
    },

    // ---------------------------------------------------------------- the meadow
    meadow: {
      name: 'Meadow', horizon: 42, exits: { w: 'castle', n: 'orchard', s: 'yard', e: 'bridge' },
      desc: 'A sunny meadow with a crossroads. The castle is west, an orchard is north, a cottage yard is south and a bridge is east. A big flat rock sits in the grass.',
      blocks: [[28, 70, 20, 10]],
      listen: 'Bees. Larks. A far-off river.',
      look: 'diorama',
      back(c, g, t) {
        sky(c, 40);
        sun(c, 128, 12, 4.6, { reach: 260, i: 0.14 });
        clouds(c, t, [[34, 12, 1, 0.3], [84, 22, 0.8, 0.22], [150, 7, 0.7, 0.35]]);
        mountain(c, 6, 41, 64, 24); mountain(c, 50, 41, 52, 17); mountain(c, 104, 41, 46, 12);
        hills(c, 42, 'h.hillfar', 3, 6, { trees: 28 });
        hills(c, 44, 'h.grass', 1.3, 3.4, { z: 0.12, grad: [0.8, 0.62], trees: 10 });
        grassland(c, 42, 5, { n: 230 });
        // the crossroads: north to the orchard, south to the yard, west to the castle, east to the bridge
        dirtPath(c, [[0, 66], [40, 65.4], [74, 66.4], [74.6, 42], [79.4, 42], [82, 66.2], [120, 65.6], [160, 66.4], [160, 74.4], [120, 73.8], [86, 74.2], [88.4, 100], [64, 100], [70, 74.4], [40, 74], [0, 74.6]], 7, { n: 70 });
        for (const [x0, x1] of [[2, 70], [88, 158]]) for (const k of [0, 1]) c.line(x0, 68.4 + k * 3.4, x1, 68.2 + k * 3.4, 'h.dirt', { s: 0.32 }); // cart ruts
        c.z = 0.3;
        tree(c, 142, 60, 1.15, 14, t, { fruit: 0 });
        bush(c, 12, 56, 1, 15);
        bush(c, 58, 50, 0.6, 16);
        flowers(c, 4, 46, 150, 52, 70, 7);
        // two butterflies
        for (const [bx, by, m, ph] of [[46, 56, 'white', 0], [112, 82, 'h.honey', 2]]) butterfly(c, bx + Math.sin(T(t) * 0.5 + ph) * 12, by + Math.sin(T(t) * 1.3 + ph) * 4, t, m);
      },
      objects: [
        { id: 'rock', name: 'flat rock', aliases: ['rock', 'stone', 'boulder', 'big rock'], rect: [26, 64, 24, 14], at: [40, 82],
          draw(c, g) {
            c.z = 0.55;
            if (!g.flag('flute_found')) {
              c.shadow(39, 77.6, 14, 2.4, 0.55);
              c.ell(38, 74, 12.4, 5.4, 'h.stone', { clipY: [0, 78], rim: true, outline: true });
              c.ell(37, 71, 10, 3, 'h.stone', { bias: 0.12, flat: true });
              c.ell(36, 70.6, 7, 1.8, 'h.stone', { bias: 0.22, flat: true });
              for (const [x0, y0, x1, y1] of [[30, 72, 33, 74], [33, 74, 32, 76.6], [44, 71.4, 46, 74]]) c.line(x0, y0, x1, y1, 'h.stone', { s: 0.12 });
              for (let i = 0; i < 6; i++) c.ell(42 + hash(i, 1, 2) * 6, 74 + hash(i, 2, 2) * 3, 0.9, 0.6, 'h.moss', { bias: 0.1 });
              grassBlades(c, 30, 78, 2, 3); grassBlades(c, 45, 78.2, 2, 4);
            } else { // tipped up on its side, with a pale patch where it lay
              c.ell(39, 79, 9, 2.2, 'h.dirt', { flat: true, bias: 0.12 });
              c.ell(39, 79, 6, 1.2, 'h.grass', { flat: true, bias: 0.2 });
              c.shadow(33, 77.8, 9, 1.8, 0.55);
              c.ell(32, 70, 6, 8, 'h.stone', { clipY: [0, 78], rim: true, outline: true });
              c.ell(30.6, 69, 3.6, 6, 'h.stone', { bias: 0.15, flat: true });
              c.line(33, 65, 34, 69, 'h.stone', { s: 0.12 });
            }
          },
          desc: g => (g.flag('flute_found') ? 'A big flat rock, tipped on its side.' : 'A flat grey rock, bigger than it looks. The grass under one edge is pressed down, as if something small hid there.'),
          verbs: {
            search(g) { if (g.flag('flute_found')) return g.say('Nothing else under it.'); g.set('flute_found'); g.say('You tip the rock over. Underneath, in a nest of dry grass, lies a little wooden flute.'); },
            push(g) { g.say('You shove, and the rock shifts. Something small rattles under it. Maybe look under it.'); },
            pull(g) { g.say('You heave the rock up on its side.'); if (!g.flag('flute_found')) { g.set('flute_found'); g.say('A little wooden flute lies in the grass underneath.'); } },
            climb: 'You climb on the rock and enjoy the view. Then you climb down.',
          } },
        { id: 'flute', item: 'flute', name: 'wooden flute', aliases: ['flute', 'pipe'], show: g => g.flag('flute_found'), rect: [40, 80, 8, 6], at: [44, 86], base: 86,
          draw(c) { c.z = 0.6; c.shadow(44, 85.2, 4.6, 0.8, 0.5); c.rrect(40, 83, 8, 1.6, 0.7, 'wood', { cyl: true, outline: true }); c.rect(40.6, 83, 1, 1.6, 'h.sapwood', { cyl: true }); for (const hx of [43, 44.6, 46.2]) c.ell(hx, 83.6, 0.34, 0.3, 'dark', { flat: true }); grassBlades(c, 46, 85.6, 1, 9); },
          desc: 'A small wooden flute.', takeMsg: 'You pick up the flute and brush the grass off. (Try "play flute" somewhere.)', points: 5 },
        { id: 'sign', name: 'signpost', aliases: ['sign', 'post', 'signs'], rect: [100, 54, 14, 18], at: [106, 76],
          draw(c) {
            c.z = 0.5;
            c.shadow(107, 72, 4.4, 1, 0.55);
            c.rect(105.2, 54.6, 1.8, 17.6, 'h.bark', { vcyl: true, outline: true });
            c.poly([[104.6, 54.6], [107.6, 54.6], [106.1, 53.4]], 'h.bark', { flat: true, bias: 0.2 });
            const board = (pts, label, tx, ty) => { c.poly(pts, 'h.sapwood', { outline: true, grad: [0.75, 0.5] }); c.text(label, tx, ty, 'h.bark', { s: 0.1 }); };
            board([[98.4, 55.6], [105.2, 55.6], [105.2, 58.6], [98.4, 58.6], [96.8, 57.1]], 'W', 100.6, 56.3);
            board([[107, 59.2], [113.6, 59.2], [115.2, 60.7], [113.6, 62.2], [107, 62.2]], 'E', 109.6, 59.9);
            c.poly([[104.4, 63], [108, 63.2], [107.6, 66], [104.6, 65.8]], 'h.sapwood', { outline: true, bias: -0.1 });
            c.text('S', 105.6, 63.6, 'h.bark', { s: 0.1 });
            c.poly([[107, 54.8], [111.6, 53.4], [111.6, 55.6], [107, 56.6]], 'h.sapwood', { outline: true, bias: -0.2 });
            grassBlades(c, 104, 72.2, 2, 11); grassBlades(c, 108.6, 72.4, 2, 12);
          },
          desc: 'The signpost points four ways: WEST, Castle. NORTH, Orchard (Mind the Bees). SOUTH, Old Marta\'s Cottage. EAST, Troll Bridge (Pay the Toll, or Else).' },
      ],
    },

    // ---------------------------------------------------------------- the orchard
    orchard: {
      name: 'Orchard', horizon: 42, exits: { s: 'meadow' },
      desc: 'An orchard. A huge oak stands on the right with an untidy nest in the top. A beehive hangs from an apple tree on the left, humming.',
      blocks: [[96, 66, 10, 8], [32, 62, 10, 8]],
      look: 'hm-day',
      back(c, g, t) {
        sky(c, 40);
        clouds(c, t, [[60, 10, 1, 0.25], [140, 18, 0.7, 0.35], [8, 22, 0.6, 0.3]]);
        hills(c, 42, 'h.hillfar', 9, 6, { trees: 30 });
        // rows of little apple trees, far off
        c.z = 0.12;
        for (let i = 0; i < 14; i++) { const x = 4 + i * 11.6 + hash(i, 1, 9) * 3; c.rect(x - 0.4, 40.6, 0.8, 2.4, 'h.bark', { flat: true }); c.ell(x, 39.4, 2.8, 2.2, 'h.leaf', { bias: -0.05 }); c.dot(x - 1, 39, 'h.ruby', 0.6); c.dot(x + 0.8, 40, 'h.ruby', 0.6); }
        grassland(c, 42, 8, { n: 240 });
        // dappled light under the trees
        c.z = 0.41;
        for (let i = 0; i < 18; i++) c.ell(80 + hash(i, 1, 19) * 50, 60 + hash(i, 2, 19) * 16, 1.6 + hash(i, 3, 19) * 2, 0.6, 'h.grass', { flat: true, bias: 0.16 });
        c.shadow(100, 74, 30, 6, 0.3);
        c.z = 0.3;
        tree(c, 60, 54, 0.8, 21, t, { fruit: 7 });
        tree(c, 128, 52, 0.8, 22, t, { fruit: 7 });
        // the apple tree with the hive: a forked trunk, and a branch across the fork for the hive to hang from
        c.z = 0.36;
        c.shadow(40, 70.4, 15, 2.6, 0.5);
        c.poly([[32.6, 70.6], [34.6, 66], [35, 54], [39.4, 54], [39.8, 66], [42, 70.6]], 'h.bark', { vcyl: true, outline: true });
        c.poly([[35, 55.6], [33.6, 50], [23.4, 32.6], [26.2, 31.8], [36, 48.4], [37.6, 54]], 'h.bark', { outline: true });
        c.poly([[37, 54], [38.6, 48.4], [48.4, 31.4], [51, 32.6], [40.4, 50], [39.6, 55.6]], 'h.bark', { outline: true });
        c.line(30, 42, 22, 38, 'h.bark', { w: 0.8, s: 0.4 }); c.line(44, 41, 53, 36, 'h.bark', { w: 0.8, s: 0.4 });
        c.line(27.6, 39.6, 47.6, 38.4, 'h.bark', { w: 1.2, s: 0.45 });
        for (const lx of [35.4, 37.6]) c.line(lx, 58, lx + 0.4, 69, 'h.bark', { s: 0.15 });
        foliage(c, 37, 23.4, 23, 13.4, 23, t, 'h.leaf', 14);
        // the great oak, with a nest at the top
        c.z = 0.38;
        c.shadow(104, 74.4, 22, 3.2, 0.6);
        c.poly([[91.4, 74.8], [96, 69.6], [98.2, 74.8]], 'h.bark', { outline: true });
        c.poly([[104.6, 74.8], [106.6, 69.4], [111.6, 74.8]], 'h.bark', { outline: true });
        c.line(97, 40, 83, 23, 'h.bark', { w: 2.4, s: 0.5 }); c.line(105, 40, 121, 21, 'h.bark', { w: 2.4, s: 0.45 }); c.line(101, 38, 101, 18, 'h.bark', { w: 2, s: 0.5 });
        c.poly([[94.6, 74.8], [96.4, 66], [97, 46], [95.6, 36], [106.6, 36], [105.2, 46], [105.6, 66], [107.6, 74.8]], 'h.bark', { vcyl: true, outline: true });
        for (const gx of [98.4, 100.8, 103.4]) c.line(gx, 40, gx + Math.sin(gx) * 0.6, 73, 'h.bark', { s: 0.12 });
        c.ell(101.6, 56, 1.4, 1.9, 'dark', { flat: true, bias: -0.3 });
        foliage(c, 84, 30, 14, 10, 31, t, 'h.oakleaf');
        foliage(c, 121, 28, 14, 11, 32, t, 'h.oakleaf');
        foliage(c, 102, 20, 24, 16, 33, t, 'h.oakleaf');
        // the nest: twigs, and the ruby glinting while the crow still has it
        c.ell(101, 23.6, 6.6, 2.8, 'h.bark', { rim: true, outline: true });
        for (let i = 0; i < 9; i++) c.line(95 + i * 1.4, 22 + hash(i, 1, 4) * 2, 96.6 + i * 1.3, 25 + hash(i, 2, 4), i % 2 ? 'h.straw' : 'h.bark', { s: 0.5 });
        if (!g.flag('crow_paid')) { c.ell(105.2, 21.6, 0.9, 0.8, 'h.ruby', { rim: true }); if (Math.sin(T(t) * 2.2) > 0.5) c.dot(105.5, 21.2, 'sunlamp', 1, true); }
        c.shaft({ kind: 'window', x0: 70, x1: 132, y0: 12, y1: 90, slant: -12, n: 4, color: SUN, a: 0.07 });
        flowers(c, 4, 76, 150, 20, 34, 4);
        flowers(c, 50, 46, 100, 12, 14, 5);
        // a leaf or two drifting down
        for (let i = 0; i < 3; i++) { const p = (T(t) * 0.07 + i / 3) % 1; c.ell(86 + i * 16 + Math.sin(p * 12 + i) * 4, 32 + p * 46, 0.6, 0.35, i % 2 ? 'h.leafdry' : 'h.oakleaf', { flat: true, bias: 0.2 }); }
      },
      objects: [
        { id: 'tree', name: 'oak tree', aliases: ['tree', 'oak', 'big tree', 'trunk', 'nest'], rect: [90, 8, 24, 66], at: [96, 80], base: 80,
          desc: g => (g.flag('crow_paid') ? 'A huge old oak. The nest at the top is empty now.' : 'A huge old oak. Something red glints in the nest at the top, and a big black crow sits over it.'),
          verbs: {
            climb: g => g.die('You start up the oak. The crow lets you get all the way to the nest, then pecks you very, very hard. You fall a long way. The orchard goes quiet.'),
            take: 'It is a tree. You would need a bigger pocket.',
          } },
        { id: 'crow', name: 'crow', aliases: ['bird', 'black crow', 'big crow', 'raven'], rect: [95, 12, 14, 12], at: [96, 80], base: 80,
          draw(c, g, t) { if (!g.flag('crow_paid')) crow(c, 101, 18.6, t); },
          show: g => !g.flag('crow_paid'),
          desc: 'A big black crow sits over a nest. It is watching you with one bright eye, and the eye keeps drifting to anything shiny.',
          verbs: {
            talk: 'The crow says "CAW." It might mean something.', attack: 'You wave your arms. The crow lifts a wing and looks at you with great calm.', kiss: 'The crow looks insulted.',
            give: { coin(g) {
              g.lose('coin'); g.set('crow_paid'); g.score(15, 'crow');
              g.say('The crow snatches the coin, admires it, and swoops down to tuck it away somewhere. As it goes, something red tumbles out of the nest and thumps into the grass below the tree.');
            }, '*': 'The crow looks at it and turns away. Not shiny enough.' },
          } },
        { id: 'jewel', item: 'jewel', name: 'ruby', aliases: ['ruby', 'jewel', 'gem'], show: g => g.flag('crow_paid'), rect: [88, 70, 10, 8], at: [92, 80], base: 78,
          draw(c, g, t) { c.z = 0.62; rubyGem(c, 92, 77.4, t, 1.1); grassBlades(c, 89.4, 78.2, 1, 3); grassBlades(c, 95.2, 78.4, 1, 6); }, desc: 'The Crown Jewel, lying in the grass.', takeMsg: 'You pick up the ruby. It is warm, and it weighs almost nothing.' },
        { id: 'hive', name: 'beehive', aliases: ['hive', 'bees', 'bee', 'honey', 'honeycomb', 'comb', 'nest', 'apple tree'], rect: [30, 34, 14, 22], at: [46, 76], base: 76,
          draw(c, g, t) {
            c.z = 0.36;
            c.line(37, 38.6, 37, 40, 'h.bark', { w: 0.6, s: 0.3 });
            const widths = [2, 3.4, 4.5, 5.1, 5.3, 5, 4.2, 2.8];
            widths.forEach((w, i) => c.rrect(37 - w, 39.4 + i * 1.8, w * 2, 2.2, 1, 'h.straw', { cyl: true, outline: true, bias: 0.05 - i * 0.02 }));
            c.ell(37.6, 50.4, 1.4, 0.8, 'dark', { flat: true });
            const drip = (T(t) * 0.4) % 1;
            c.rrect(39.2, 52.6, 0.9, 1.2 + drip * 1.6, 0.45, 'h.honey', { bias: 0.25 });
            if (drip > 0.7) c.ell(39.65, 55 + (drip - 0.7) * 40, 0.4, 0.5, 'h.honey', { bias: 0.35 });
            for (let k = 0; k < 8; k++) { // the bees, busy and cross
              const a = T(t) * (1.4 + k * 0.17) + k * 0.9, bx = 37 + Math.cos(a) * (7 + (k % 3) * 2.4), by = 46 + Math.sin(a * 1.3) * 6;
              c.ell(bx, by, 0.75, 0.5, 'h.honey', { bias: 0.1 }); c.dot(bx, by, 'boot', 0);
              c.ell(bx - 0.2, by - 0.7, 0.55, (Math.floor(T(t) * 20 + k) % 2) ? 0.4 : 0.2, 'white', { flat: true, bias: 0.3 });
            }
          },
          show: g => !g.gone('hive'),
          desc: 'A wild beehive hangs from a branch, dripping honey. The bees are cross.',
          verbs: {
            take(g) {
              if (g.flag('veil_on')) {
                g.remove('hive'); g.give('honey'); g.score(7, 'honey'); g.emit('take');
                g.say('Behind the veil, you slowly cut a comb of honey from the hive. The bees buzz furiously, but nothing gets through. You back away with the honey and a very strong feeling of accomplishment.');
              } else g.die('You reach for the honey. The bees explain, in large numbers, that it is theirs. You are discovered much later, very puffy.');
            },
            attack: g => g.die('You poke the hive. The hive pokes back, several thousand times.'),
            push: g => g.die('You shove the hive. This was a bad idea, and it takes the bees about a second to tell you so.'),
            pull: g => g.die('You pull the hive. The hive comes with a great deal of company.'),
            climb: 'The branch is too thin, and the bees are watching.', search: 'You get close enough to hear the hive and then you get less close.',
          } },
      ],
    },

    // ---------------------------------------------------------------- the bridge
    bridge: {
      name: 'Troll Bridge', horizon: 40, exits: { w: 'meadow', e: 'farbank' },
      desc: g => (g.flag('troll_asleep') ? 'A river runs north to south under a wooden bridge. The troll lies on the east bank, snoring.' : 'A river runs north to south under a wooden bridge. A troll with a big club stands at the east end, blocking the way.'),
      blocks: [[58, 40, 44, 24], [58, 74, 44, 26]],
      exitCheck(g, dir) {
        if (dir === 'e' && !g.flag('troll_asleep')) {
          g.die('You step onto the bridge. "TOLL!" bellows the troll, and there is a moment of surprised silence, and then a club. You are very flat.');
          return true;
        }
        return false;
      },
      listen: g => (g.flag('troll_asleep') ? 'Snoring. Loud, gravelly snoring.' : 'The river hurries along. The troll mutters something about tolls.'),
      look: 'hm-day',
      back(c, g, t) {
        sky(c, 38);
        clouds(c, t, [[110, 12, 1, 0.25], [30, 8, 0.8, 0.3]]);
        hills(c, 40, 'h.hillfar', 2, 6, { trees: 26 });
        grassland(c, 40, 15, { n: 200 });
        // the river, running from the far hills down past you
        c.z = 0.38;
        const bankL = y => 57.6 + Math.sin(y * 0.35) * 0.6, bankR = y => 102.4 + Math.sin(y * 0.3 + 1) * 0.6;
        const wl = [], wr = []; for (let y = 40; y <= 100; y += 2) { wl.push([bankL(y) - 2.6, y]); wr.push([bankR(y) + 2.6, y]); }
        c.poly(wl.concat(wr.reverse()), 'h.dirt', { grad: [0.5, 0.42] });
        const ww = [], wv = []; for (let y = 40; y <= 100; y += 2) { ww.push([bankL(y), y]); wv.push([bankR(y), y]); }
        c.poly(ww.concat(wv.reverse()), 'h.water', { grad: [0.78, 0.42], dither: true });
        c.z = 0.39;
        for (let i = 0; i < 46; i++) { // ripples drifting downstream, light and dark
          const sp = 4 + hash(i, 2, 6) * 5, yy = 40 + ((hash(i, 1, 6) * 60 + T(t) * sp) % 60), xx = 60 + hash(i, 3, 6) * 38, len = 1.2 + hash(i, 4, 6) * 2.6 * (yy - 30) / 50;
          c.line(xx, yy, xx + len, yy, 'h.water', { s: i % 3 ? 0.95 : 0.2 });
        }
        for (let i = 0; i < 16; i++) if (Math.sin(T(t) * 3 + i * 1.7) > 0.65) c.dot(60 + hash(i, 5, 6) * 40, 42 + hash(i, 6, 6) * 56, 'sunlamp', 1, true);
        for (let i = 0; i < 26; i++) { const k = i % 2, y = 41 + hash(i, 1, 2) * 58, r = (0.5 + hash(i, 2, 2) * 1.1) * (0.6 + y / 100), bx = k ? bankR(y) + (hash(i, 3, 2) - 0.3) * 2 : bankL(y) - (hash(i, 3, 2) - 0.3) * 2; c.ell(bx, y, r, r * 0.6, 'h.stone', { rim: true, bias: -0.05 }); }
        tufts(c, 52, 42, 4, 56, 30, 61); tufts(c, 104, 42, 4, 56, 30, 62);
        // a fish under the water, and one that jumps now and then
        c.ell(72 + Math.sin(T(t) * 0.4) * 4, 88, 2.4, 0.8, 'h.water', { flat: true, bias: -0.35 });
        const jp = (T(t) * 0.3) % 1;
        if (jp < 0.14) { const u = jp / 0.14, fx = 84 + u * 8, fy = 52 - Math.sin(u * Math.PI) * 5; c.ell(fx, fy, 1.8, 0.8, 'h.silver', { rim: true, outline: true }); c.poly([[fx - 1.6, fy], [fx - 3, fy - 0.9], [fx - 3, fy + 0.9]], 'h.silver', O); }
        else if (jp < 0.24) { const r = (jp - 0.14) * 30; c.ell(92, 52, r, r * 0.3, 'h.water', { flat: true, bias: 0.35 }); c.ell(92, 52, r * 0.6, r * 0.18, 'h.water', { flat: true, bias: -0.1 }); }
        // reeds along the banks
        for (let i = 0; i < 18; i++) { const k = i % 2, y = 44 + hash(i, 1, 13) * 54, bx = k ? bankR(y) + 1.4 : bankL(y) - 1.4, h = 3 + hash(i, 2, 13) * 3 * (y / 70), sw = Math.sin(T(t) * 1.5 + i) * 0.5; c.line(bx, y, bx + sw, y - h, 'h.grass', { s: 0.6 }); c.line(bx + 0.6, y, bx + 0.6 + sw * 1.2, y - h * 0.8, 'h.grass', { s: 0.4 }); if (i % 3 === 0) c.rrect(bx + sw - 0.4, y - h - 1.6, 0.8, 1.8, 0.4, 'h.bark', { bias: 0.1 }); }
        // the bridge: piles in the water, the deck of planks, the back rail
        c.z = 0.45;
        for (const px of [55.4, 69, 82.6, 96.2]) { c.rect(px, 73.6, 2, 7, 'h.bark', { vcyl: true }); c.ell(px + 1, 80.4, 2.4 + Math.sin(T(t) * 3 + px) * 0.3, 0.6, 'h.water', { flat: true, bias: 0.35 }); }
        c.shadow(80, 75.4, 30, 2, 0.5);
        for (let x = 52; x < 108; x += 3) c.rect(x + 0.17, 62, 2.8, 12, hash(x, 1, 3) > 0.5 ? 'wood' : 'h.oak', { bias: (hash(x, 2, 3) - 0.5) * 0.15, grad: [0.72, 0.5] });
        for (let x = 52; x < 108; x += 3) { c.rect(x, 62, 0.34, 12, 'h.bark', { flat: true, bias: -0.45 }); c.dot(x + 1.5, 62.8, 'h.iron', 0.6); c.dot(x + 1.5, 72.8, 'h.iron', 0.6); }
        c.rect(51, 61, 58, 1.2, 'h.bark', { cyl: true }); c.rect(51, 73.6, 58, 1.6, 'h.bark', { cyl: true });
        for (const px of [52.6, 66.2, 79.8, 93.4, 107]) c.rect(px - 0.9, 55.4, 1.8, 6.8, 'h.bark', { vcyl: true, outline: true });
        c.rect(52, 55.8, 56, 1.5, 'wood', { cyl: true, outline: true });
        c.text('TOLLS UNPAID', 58.6, 58.2, 'h.bark', { s: 0.08 });
        // the toll sign on the far bank
        c.z = 0.4;
        c.shadow(141, 56.2, 3, 0.8, 0.5);
        c.rect(140.2, 47, 1.6, 9.2, 'h.bark', { vcyl: true });
        c.rrect(135.6, 44, 11, 5, 0.6, 'h.sapwood', { outline: true });
        c.text('TOLL', 138.4, 45.3, 'h.crimson', { s: 0.2 });
        c.z = 0.3;
        tree(c, 18, 56, 1.1, 51, t, { fruit: 0 });
        bush(c, 154, 52, 0.9, 52);
        bush(c, 8, 92, 1.2, 53);
        flowers(c, 0, 80, 52, 18, 18, 3);
        flowers(c, 110, 80, 50, 18, 18, 5);
      },
      front(c) { // the near rail of the bridge, in front of anyone on it
        c.z = 0.6;
        for (const px of [52.6, 66.2, 79.8, 93.4, 107]) c.rect(px - 0.9, 68.4, 1.8, 6.4, 'h.bark', { vcyl: true, outline: true });
        c.rect(52, 68.6, 56, 1.4, 'wood', { cyl: true, outline: true });
      },
      objects: [
        { id: 'troll', name: 'troll', aliases: ['big troll', 'monster', 'ogre', 'giant'], rect: [108, 46, 24, 32], at: [96, 68], base: 80,
          draw(c, g, t) { if (g.flag('troll_asleep')) trollAsleep(c, t); else troll(c, 122, 81, t); },
          desc: g => (g.flag('troll_asleep') ? 'The troll is fast asleep, drooling slightly.' : 'A very large, very green troll. He looks tired and cross, in about equal measure.'),
          verbs: {
            talk(g) { g.say(g.flag('troll_asleep') ? 'He just snores.' : '"Toll! No toll, no crossing! And no loud noises, I have not slept in three weeks. Something soothing, perhaps, if you must do anything." He yawns hugely.'); },
            attack: g => (g.flag('troll_asleep') ? g.say('You decide not to push your luck.') : g.die('You attack the troll. It is the shortest fight in Hollowmere history.')),
            kiss: 'You decide you would rather not.',
            give: { coin: 'The troll bites the coin. "One coin? That is not a toll. That is an insult."', honey: 'The troll sniffs the honey. "Not enough." His stomach rumbles anyway.', flute: g => g.say('"What do I do with that?" says the troll. Maybe you should play it for him, not hand it over.'), '*': 'The troll shakes his head. "No."' },
          } },
        { id: 'river', name: 'river', aliases: ['water', 'stream', 'current'], rect: [58, 40, 44, 22], at: [80, 66],
          desc: 'A deep, quick river, much too cold to swim in.',
          verbs: { swim: g => g.die('You dive into the river. It is colder than you thought, and faster. You think about this for quite a long way.'), drink: 'The water is cold and clean.', enter: g => g.die('You wade in. The current takes your feet right away, and the rest of you soon afterwards.') } },
        { id: 'bridge', name: 'bridge', aliases: ['planks', 'wooden bridge'], rect: [52, 58, 56, 20], at: [80, 68],
          desc: 'A wooden bridge, sturdy enough. Someone has carved TOLLS UNPAID IS TROLLS FED into the rail.' },
      ],
    },

    // ---------------------------------------------------------------- across the river
    farbank: {
      name: 'Far Bank', horizon: 42, exits: { w: 'bridge' },
      desc: 'The far side of the river. A hollow stump stands in a field of daisies, and something silver winks from the top of it.',
      blocks: [[66, 64, 20, 10]],
      look: 'golden',
      back(c, g, t) {
        sky(c, 42, 'h.dusk', [0.12, 0.95]);
        sun(c, 20, 16, 4.8, { rays: true, from: -0.15, to: 1.1, reach: 260, i: 0.36, a: 0.08 });
        clouds(c, t, [[80, 14, 1, 0.2], [134, 8, 0.8, 0.25]]);
        mountain(c, 92, 41, 60, 14);
        hills(c, 42, 'h.hillfar', 6, 7, { trees: 30 });
        hills(c, 44, 'h.grass', 2.2, 2.6, { z: 0.12, grad: [0.85, 0.62] });
        grassland(c, 42, 22, { n: 170 });
        c.z = 0.3;
        pine(c, 130, 56, 1.2, 71, t); pine(c, 14, 60, 1.1, 72, t);
        // the daisy field: thousands of daisies, nodding
        c.z = 0.45;
        for (let i = 0; i < 420; i++) {
          const left = i < 300, k = hash(i, 2, 81), dx = left ? hash(i, 1, 81) * 62 : 60 + hash(i, 1, 81) * 100, dy = (left ? 46 : 48) + k * (left ? 52 : 50);
          if (!left && hash(i, 3, 81) > 0.45) continue;
          const s = 0.45 + k * 0.6, sw = Math.sin(T(t) * 1.6 + i) * 0.25 * s;
          c.line(dx, dy, dx + sw, dy - 1.4 * s, 'h.grass', { s: 0.45 });
          c.ell(dx + sw, dy - 1.6 * s, 0.85 * s, 0.55 * s, 'white', { bias: 0.15 });
          c.dot(dx + sw, dy - 1.65 * s, 'h.honey', 0.85);
        }
        pine(c, 148, 66, 1.4, 73, t);
        bush(c, 100, 90, 1.1, 74);
        // midges in the low sun
        for (let i = 0; i < 8; i++) c.dot(40 + hash(i, 1, 5) * 30 + Math.sin(T(t) * 2 + i) * 2, 50 + hash(i, 2, 5) * 12 + Math.cos(T(t) * 2.6 + i) * 1.5, 'sunlamp', 1, true);
      },
      objects: [
        { id: 'stump', name: 'stump', aliases: ['hollow stump', 'old stump', 'tree stump', 'log'], rect: [64, 58, 24, 18], at: [76, 80], base: 76,
          draw(c) {
            c.z = 0.55;
            c.shadow(78, 76.2, 15, 2.6, 0.6);
            c.poly([[62.4, 76.6], [66.4, 70.6], [69.4, 76.6]], 'h.bark', { outline: true });
            c.poly([[83, 76.6], [86.2, 70.4], [90, 76.6]], 'h.bark', { outline: true });
            c.poly([[66, 62], [86, 62], [86.4, 72], [87.4, 76.4], [64.6, 76.4], [65.6, 72]], 'h.bark', { vcyl: true, outline: true });
            for (let i = 0; i < 7; i++) { const x = 67.4 + i * 2.8; c.line(x, 63.4, x + Math.sin(i * 2) * 0.6, 75.6, 'h.bark', { s: 0.06 }); }
            c.ell(73.4, 71.4, 3.2, 4, 'dark', { flat: true, clipY: [0, 75.6] });
            c.dot(73.6, 74.4, 'h.ruby', 0.4);
            for (let i = 0; i < 7; i++) c.ell(66.4 + hash(i, 1, 6) * 6, 73.6 + hash(i, 2, 6) * 2.4, 1.2, 0.7, 'h.moss', { bias: 0.15 });
            for (const [fx, fy] of [[85.8, 66.4], [86.2, 68.6]]) c.ell(fx, fy, 1.6, 0.6, 'h.honey', { rim: true, outline: true });
            c.ell(76, 62, 10, 3, 'h.sapwood', { outline: true });
            c.ell(76, 61.9, 8.4, 2.4, 'h.sapwood', { flat: true, bias: -0.08 });
            c.ell(76, 61.9, 7, 1.9, 'h.sapwood', { flat: true, bias: 0.06 });
            c.ell(76, 62, 5.2, 1.3, 'dark', { flat: true });
            c.ell(76, 62.4, 4.2, 0.8, 'h.bark', { flat: true, bias: -0.3 });
          },
          desc: g => (g.gone('ladle') ? 'An old hollow stump.' : 'An old hollow stump, wide as a table. A silver ladle lies across the top, glinting.'),
          verbs: { climb: 'You stand on the stump. It is not very comfortable. You get down.', search: g => g.say(g.gone('ladle') ? 'Just wood and beetles.' : 'It is hollow and full of beetles, and the ladle is lying right on top.') } },
        { id: 'ladle', item: 'ladle', name: 'royal ladle', aliases: ['ladle', 'spoon', 'silver ladle'], rect: [66, 56, 20, 7], at: [76, 80], base: 76,
          draw(c, g, t) { c.z = 0.56; ladle(c, 82, 60, t, 1.15); c.light(81, 60, 14, [255, 240, 210], 0.35); },
          desc: 'The Royal Ladle of Hollowmere.', takeMsg: 'You lift the Royal Ladle. It is heavy, and it is definitely silver.', points: 5 },
        { id: 'daisies', name: 'daisies', aliases: ['flowers', 'daisy', 'flower', 'field'], rect: [0, 46, 60, 52], at: [30, 80],
          desc: 'Thousands of daisies.', verbs: { take: 'You pick a daisy. It wilts at once from the shame of being picked. You drop it.', eat: 'They taste like grass that thinks it is better than grass.' } },
      ],
    },

    // ---------------------------------------------------------------- Marta's yard
    yard: {
      name: 'Old Marta\'s Yard', horizon: 42, exits: { n: 'meadow', e: 'forest' },
      desc: 'A tidy yard in front of a small cottage with a green door. An old stone well stands on the left, with a barrel next to it.',
      blocks: [[96, 40, 52, 24], [20, 48, 30, 22]],
      look: 'diorama',
      back(c, g, t) {
        sky(c, 40);
        sun(c, 24, 9, 4.2, { reach: 260, i: 0.12 });
        clouds(c, t, [[70, 12, 1, 0.25], [118, 6, 0.7, 0.3]]);
        hills(c, 42, 'h.hillfar', 4, 6, { trees: 26 });
        grassland(c, 42, 31, { n: 200 });
        // paths: from the green door south and east, and a footpath north to the meadow
        dirtPath(c, [[112.6, 62.4], [127.4, 62.4], [131, 70], [160, 72.4], [160, 82], [132, 81], [130, 100], [106, 100], [110, 72]], 32, { n: 50 });
        dirtPath(c, [[111.6, 66], [113.4, 71.6], [92, 60], [76, 48], [71, 42], [74.6, 42], [80.6, 48], [96, 57.6]], 33, { n: 16 });
        c.z = 0.2;
        tree(c, 80, 40, 0.6, 34, t, { fruit: 4 });
        // the cottage: thatch, plaster and timbers, a green door, flower boxes
        c.z = 0.25;
        c.shadow(123, 62.8, 31, 2.4, 0.5);
        c.rect(98, 40, 50, 22, 'h.plaster', { grad: [0.72, 0.58], dither: true });
        for (let i = 0; i < 30; i++) c.dot(99 + hash(i, 1, 35) * 48, 42 + hash(i, 2, 35) * 18, 'h.plaster', 0.3);
        c.rect(98, 40, 50, 2.6, 'h.plaster', { flat: true, bias: -0.4 });
        for (const px of [97.4, 111.2, 127, 146.6]) c.rect(px, 40, 2, 22, 'h.bark', { vcyl: true });
        c.rect(97.4, 60.6, 51.2, 1.6, 'h.bark', { cyl: true }); c.rect(97.4, 46, 51.2, 1.2, 'h.bark', { cyl: true });
        c.line(129.6, 60.4, 135.2, 47.4, 'h.bark', { w: 1, s: 0.45 });
        c.rect(97, 61.8, 52, 1.6, 'h.stone', { cyl: true });
        for (const wx of [100, 136]) {
          c.rrect(wx - 1, 47, 11, 10, 0.4, 'h.bark', { outline: true });
          c.rect(wx, 48, 9, 8, 'glass', { grad: [0.78, 0.38] });
          c.rect(wx + 0.6, 52.2, 7.8, 3.4, 'lamp', { flat: true, bias: -0.55, emit: true });
          c.rect(wx + 4.1, 48, 0.8, 8, 'h.bark', { flat: true, bias: -0.1 }); c.rect(wx, 51.6, 9, 0.8, 'h.bark', { flat: true, bias: -0.1 });
          c.poly([[wx + 0.6, 48.6], [wx + 2.4, 48.6], [wx + 0.6, 50.6]], 'white', { flat: true, bias: 0.1 });
          c.rect(wx - 1.4, 56.6, 11.8, 2, 'wood', { cyl: true, outline: true });
          for (let i = 0; i < 6; i++) c.ell(wx + 0.4 + i * 1.6, 56 - hash(i, wx, 3) * 0.8, 0.85, 0.75, ['h.crimson', 'h.wool', 'h.honey'][i % 3], { rim: true });
          for (let i = 0; i < 4; i++) c.ell(wx + 1.2 + i * 2.2, 56.6, 1, 0.5, 'h.leaf', { bias: 0.05 });
          c.light(wx + 4.5, 54, 12, FIRE, 0.25);
        }
        // the door, with Marta's sign
        c.rect(113, 44.6, 14, 17.4, 'h.bark', { vcyl: true });
        c.poly(archPts(114, 126, 47.6, 2.6, 62), 'h.door', { outline: true });
        for (const dx of [117, 120, 123]) c.line(dx, 45.6, dx, 61.6, 'h.door', { s: 0.12 });
        for (const hy of [49.6, 58]) c.rect(114, hy, 6, 0.8, 'h.iron', { cyl: true });
        c.ell(124.2, 55, 0.7, 0.7, 'brass', { rim: true });
        c.rrect(115.6, 50.6, 8.8, 2.8, 0.4, 'h.sapwood', { outline: true }); c.text('MARTA', 116.6, 51.2, 'h.bark', { s: 0.1 });
        c.rrect(112, 61.8, 16, 1.8, 0.5, 'h.stone', { cyl: true });
        // the thatched roof and the chimney
        c.poly([[94, 41.6], [104, 24.6], [142, 24.6], [152, 41.6]], 'h.straw', { grad: [0.8, 0.52], dither: true, outline: true });
        c.poly([[142, 24.6], [152, 41.6], [146, 41.6]], 'h.straw', { flat: true, bias: -0.25 });
        for (let i = 0; i < 300; i++) {
          const y = 25.6 + hash(i, 1, 36) * 15, l = 94 + (41.6 - y) / 17 * 10 + 1, r = 152 - (41.6 - y) / 17 * 10 - 1, x = l + hash(i, 2, 36) * (r - l);
          c.line(x, y, x + (x - 123) * 0.03, y + 1.6, 'h.straw', { s: 0.2 + hash(i, 3, 36) * 0.6 });
        }
        for (let i = 0; i < 6; i++) c.ell(104 + hash(i, 1, 37) * 36, 30 + hash(i, 2, 37) * 8, 1.6, 0.8, 'h.moss', { bias: 0.1 });
        c.rrect(102.6, 23.6, 41, 2.4, 1.1, 'h.straw', { cyl: true, outline: true });
        c.rrect(93, 40.2, 60, 2.6, 1.2, 'h.straw', { cyl: true, outline: true });
        stoneRow(c, 136.6, 18.4, 6.8, 9, { row: 2.2, len: 3.4, grad: [0.7, 0.5] });
        c.rect(136, 17.4, 8, 1.4, 'h.stone', { cyl: true, outline: true });
        c.z = 0.1;
        smoke(c, 140, 16, t, 7);
        // a bird on the ridge
        c.z = 0.25;
        const hop = (T(t) * 0.3) % 1, bx = 108 + (hop < 0.5 ? hop * 30 : (1 - hop) * 30);
        c.ell(bx, 22.6, 1.3, 0.9, 'h.leafdry', { rim: true }); c.ell(bx + (hop < 0.5 ? 1 : -1), 21.8, 0.7, 0.7, 'h.leafdry', { rim: true }); c.dot(bx + (hop < 0.5 ? 1.7 : -1.7), 21.8, 'h.honey', 0.8);
        // hollyhocks by the walls
        for (const hx of [99.6, 147.4]) { c.line(hx, 62, hx + 0.4, 46, 'h.grass', { w: 0.5, s: 0.4 }); for (let k = 0; k < 6; k++) c.ell(hx + 0.4 + (k % 2 ? 0.7 : -0.7), 48 + k * 2.2, 1.1, 1, 'h.wool', { rim: true }); }
        flowers(c, 100, 63, 48, 4, 16, 8);
        // the well: stone, a little thatched roof, the windlass and crank
        c.z = 0.4;
        c.shadow(36, 70.4, 15, 2.4, 0.55);
        c.rect(22.4, 57, 25.2, 13, 'h.iron', { flat: true, bias: -0.3 });
        for (let j = 0; j < 4; j++) for (let k = 0; k < 7; k++) {
          const sx = 22.4 + k * 3.8 - (j % 2) * 1.9, w = 3.6, n = (sx + w / 2 - 35) / 12.6;
          if (sx + w < 22.4 || sx > 47.6) continue;
          c.rrect(Math.max(22.6, sx), 57.4 + j * 3.2, Math.min(sx + w, 47.4) - Math.max(22.6, sx), 2.9, 0.6, 'h.stone', { bias: -0.05 - n * 0.3 + (hash(j, k, 38) - 0.5) * 0.12 });
        }
        c.ell(35, 57, 13, 3.2, 'h.stone', { bias: 0.12, outline: true });
        c.ell(35, 57.2, 10.6, 2.2, 'dark', { flat: true });
        if (!g.flag('bucket_up') && Math.sin(T(t) * 1.7) > 0.5) c.dot(36.6, 57.6, 'sunlamp', 1, true);
        for (const px of [23.4, 44.6]) c.rect(px, 42.6, 2, 14.8, 'h.bark', { vcyl: true, outline: true });
        c.poly([[19, 44.4], [22.6, 38], [47.4, 38], [51, 44.4]], 'h.straw', { grad: [0.85, 0.55], outline: true });
        for (let i = 0; i < 70; i++) { const y = 38.6 + hash(i, 1, 39) * 5, x = 21 + hash(i, 2, 39) * 28; c.line(x, y, x + (x - 35) * 0.04, y + 1.2, 'h.straw', { s: 0.2 + hash(i, 3, 39) * 0.6 }); }
        c.rrect(18.6, 43.4, 32.8, 1.8, 0.8, 'h.straw', { cyl: true, outline: true });
        c.rect(25.4, 48.4, 19.2, 2, 'wood', { cyl: true, outline: true });
        c.rect(46.6, 49, 1.8, 0.8, 'h.iron', { cyl: true }); c.line(48.2, 49.4, 48.6, 52.4, 'h.iron', { w: 0.5 }); c.rrect(47.8, 52.2, 1.6, 2, 0.5, 'wood', O);
        if (g.flag('rope_tied')) {
          for (let i = 0; i < 6; i++) c.rect(31.4 + i * 1, 48.2, 0.8, 2.4, 'h.rope', { cyl: true });
          c.line(35.6, 50.4, 35.6, g.flag('bucket_up') ? 52.6 : 57.4, 'h.rope', { w: 0.5, s: 0.6 });
          if (g.flag('bucket_up')) bucket(c, 35.6, 57.4);
        }
        // a hen, pecking about
        c.z = 0.5;
        const peck = Math.sin(T(t) * 2.2) > 0.4, hx = 84 + Math.sin(T(t) * 0.25) * 6, hy = 84, hd = Math.cos(T(t) * 0.25) > 0 ? 1 : -1;
        c.shadow(hx, hy, 3, 0.7, 0.45);
        c.line(hx - 0.6, hy - 2, hx - 0.6, hy, 'h.honey', { s: 0.4 }); c.line(hx + 0.6, hy - 2, hx + 0.6, hy, 'h.honey', { s: 0.4 });
        c.poly([[hx - 2.4 * hd, hy - 4.6], [hx - 3.4 * hd, hy - 6], [hx - 1.6 * hd, hy - 4.2]], 'h.leafdry', { bias: -0.1 });
        c.ell(hx, hy - 3.4, 2.6, 1.8, 'h.leafdry', { rim: true, outline: true });
        const hhx = hx + (peck ? 2.6 : 1.8) * hd, hhy = hy - (peck ? 1.6 : 5.2);
        c.ell(hhx, hhy, 1, 1, 'h.leafdry', { rim: true, outline: true }); c.ell(hhx, hhy - 1, 0.5, 0.4, 'h.crimson'); c.dot(hhx + 1 * hd, hhy + 0.1, 'h.honey', 0.8);
        // fences, flowers, a bush
        fence(c, 100, 158, 94); fence(c, 0, 18, 94);
        flowers(c, 4, 80, 50, 18, 24, 6);
        bush(c, 154, 64, 0.9, 40, { fruit: 5 });
      },
      objects: [
        { id: 'well', name: 'well', aliases: ['old well', 'stone well', 'windlass', 'crank', 'winch', 'pit'], rect: [20, 40, 30, 32], at: [36, 76], base: 74,
          desc: g => {
            if (!g.flag('rope_tied')) return 'A stone well with a windlass. The rope is gone, and the bucket is a dark shape far below. Something shiny winks near it.';
            return g.flag('bucket_up') ? 'The bucket is at the top of the well.' : 'The rope is tied to the windlass and runs down to a bucket at the bottom.';
          },
          verbs: {
            use: { rope(g) { if (g.flag('rope_tied')) return g.say('It is already tied on.'); g.lose('rope'); g.set('rope_tied'); g.score(2, 'tie'); g.say('You tie the rope to the windlass and lower the free end down. There is a clink, and it feels as if the bucket has been caught.'); } },
            tie: { rope(g) { if (g.flag('rope_tied')) return g.say('It is already tied on.'); g.lose('rope'); g.set('rope_tied'); g.score(2, 'tie'); g.say('You tie the rope to the windlass and lower the free end down. There is a clink, and it feels as if the bucket has been caught.'); } },
            pull(g) {
              if (!g.flag('rope_tied')) return g.say('The windlass spins and nothing happens. There is no rope.');
              if (g.flag('bucket_up')) return g.say('The bucket is already up.');
              g.set('bucket_up'); g.say('You crank the windlass. The bucket comes up out of the dark, with a shiny silver coin lying in the bottom.');
            },
            push(g) { g.act('pull', 'well'); },
            climb: g => g.die('You climb into the well to look for the shiny thing. The well has opinions about that. It is a long drop and a very short stop.'),
            enter: g => g.die('You jump into the well. Why? Nobody knows. It is a long way down.'),
            swim: g => g.die('The well is too deep and too narrow for swimming, but it does a fine job of the other thing.'),
            drink: 'The water is down there somewhere. You cannot reach it.',
            search: 'You peer down. Something shiny winks from the bottom, next to the bucket.',
          } },
        { id: 'coin', item: 'coin', name: 'silver coin', aliases: ['coin', 'silver'], show: g => g.flag('bucket_up'), rect: [30, 52, 12, 10], at: [38, 76], base: 74,
          draw(c, g, t) { c.z = 0.45; c.ell(36.2, 53.2, 1.5, 0.7, 'h.silver', { rim: true, outline: true }); c.ell(36, 53.1, 0.8, 0.3, 'h.silver', { flat: true, bias: 0.3 }); if (Math.sin(T(t) * 2.4) > 0.4) for (const [dx, dy] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) c.dot(37 + dx, 52.4 + dy, 'sunlamp', 1, true); }, desc: 'A silver coin in the bucket.', takeMsg: 'You pick the coin out of the bucket. It is bright and cold.', points: 5 },
        { id: 'rope', item: 'rope', name: 'coil of rope', aliases: ['rope', 'cord', 'coil'], rect: [62, 82, 12, 10], at: [66, 94], base: 94,
          draw(c) { c.z = 0.66; ropeCoil(c, 67, 89.6); grassBlades(c, 62.4, 92.6, 2, 7); }, desc: 'A coil of good rope, left lying about.', takeMsg: 'You take the rope.', points: 3 },
        { id: 'cottage', name: 'cottage', aliases: ['house', 'home', 'green door', 'door', 'hut'], rect: [98, 44, 50, 36], at: [120, 68],
          desc: 'A snug little cottage with a green door and a smoking chimney. A hand-painted sign on the door says: OLD MARTA. KNOCK AND COME IN. NO BEARS.',
          verbs: {
            open: g => { g.say('You push the green door open and go in.'); g.goto('cottage', 80, 92); },
            enter: g => { g.say('You go in.'); g.goto('cottage', 80, 92); },
            push: g => { g.say('You push the green door open and go in.'); g.goto('cottage', 80, 92); },
            talk: 'You knock. A voice inside calls "It\'s open, dear!"',
          } },
        { id: 'barrel', name: 'barrel', aliases: ['rain barrel', 'cask', 'water barrel'], rect: [52, 66, 12, 14], at: [58, 84], base: 82,
          draw(c, g, t) {
            c.z = 0.55;
            c.shadow(58.6, 82, 8, 1.6, 0.6);
            c.poly([[52.4, 69], [63.6, 69], [64.2, 75], [63.6, 81.4], [52.4, 81.4], [51.8, 75]], 'wood', { vcyl: true, outline: true });
            for (const sx of [55, 58, 61]) c.line(sx, 69.4, sx, 81, 'h.bark', { s: 0.2 });
            for (const by of [71, 75, 79]) c.rect(51.9, by, 12.2, 0.9, 'h.iron', { vcyl: true });
            c.ell(58, 69, 5.6, 1.6, 'wood', { outline: true });
            c.ell(58, 69.2, 4.8, 1.1, 'h.water', { flat: true, bias: -0.1 });
            c.ell(56.6 + Math.sin(T(t)) * 0.4, 69, 1.6, 0.3, 'h.water', { flat: true, bias: 0.4 });
            c.ell(60.4, 69.3, 0.7, 0.35, 'h.leafdry', { flat: true });
          },
          desc: 'A rain barrel, half full of water.', verbs: { drink: 'It tastes of rain and slightly of barrel.', search: 'Just water and leaves.', climb: 'You are not a rain barrel person.' } },
      ],
    },

    // ---------------------------------------------------------------- the cottage
    cottage: {
      name: 'Marta\'s Cottage', horizon: 46, exits: { s: 'yard' }, exitAt: { s: [120, 66] }, oneWay: ['s'], // the way in is the door in the yard
      desc: 'A cosy one-room cottage. A fire crackles in the hearth, and Old Marta sits in a rocking chair, knitting a long, long scarf. A shelf, a hook by the door and a chest of drawers stand against the wall.',
      blocks: [[96, 58, 24, 14], [8, 46, 46, 14]],
      look: 'hd2d',
      back(c, g, t) {
        const fl = 0.86 + 0.1 * Math.sin(T(t) * 11) + 0.06 * Math.sin(T(t) * 17.3);
        // the back wall: plaster above, boards below, a beam across the top
        c.z = 0.15;
        c.rect(0, 0, 160, 34, 'h.plaster', { grad: [0.42, 0.6], dither: true });
        for (let i = 0; i < 40; i++) c.ell(hash(i, 1, 51) * 160, 4 + hash(i, 2, 51) * 28, 1 + hash(i, 3, 51) * 2, 0.5, 'h.plaster', { flat: true, bias: -0.12 });
        c.rect(0, 32, 160, 14, 'wood', { grad: [0.5, 0.36] });
        for (let x = 2; x < 160; x += 4) c.rect(x, 33.4, 0.34, 12.6, 'h.bark', { flat: true, bias: -0.4 });
        c.rect(0, 31.4, 160, 1.6, 'h.bark', { cyl: true });
        for (const px of [0, 66, 89.4]) c.rect(px, 0, 2.4, 32, 'h.bark', { vcyl: true });
        c.rect(0, 0, 160, 3.4, 'h.bark', { cyl: true });
        for (let x = 6; x < 160; x += 22) c.rrect(x, 2.4, 3.6, 3, 0.5, 'h.bark', { bias: 0.05 });
        // bunches of herbs drying from the beam
        for (const [hx, m] of [[10, 'h.leaf'], [46, 'h.leafdry'], [96, 'h.leaf'], [104, 'h.wool'], [111, 'h.leafdry']]) {
          c.line(hx, 3.4, hx, 5.6, 'h.rope', { s: 0.5 });
          c.poly([[hx - 1.6, 5.6], [hx + 1.6, 5.6], [hx + 0.6, 10.6], [hx - 0.6, 10.6]], m, { bias: -0.05, outline: true });
          for (let k = 0; k < 4; k++) c.ell(hx - 1.2 + k * 0.8, 9 + (k % 2) * 1.4, 0.6, 0.9, m, { bias: 0.1 });
        }
        // the window: a bright day outside, little curtains
        c.rrect(68.6, 12.6, 18.8, 16.8, 0.6, 'h.bark', { outline: true });
        c.rect(70, 14, 16, 14, 'h.sky', { grad: [0.45, 0.95], unlit: true, dither: true });
        c.poly([[70, 28], [70, 23.4], [74, 22], [79, 23.2], [83, 21.6], [86, 22.6], [86, 28]], 'h.grass', { unlit: true, grad: [0.85, 0.65] });
        c.ell(75, 17.6, 2.4, 1, 'h.cloud', { unlit: true });
        c.rect(77.6, 14, 0.8, 14, 'h.bark', { flat: true }); c.rect(70, 20.6, 16, 0.8, 'h.bark', { flat: true });
        c.rect(67.6, 28, 20.8, 1.6, 'wood', { cyl: true, outline: true });
        for (const [cx, d] of [[68.2, 1], [87.8, -1]]) c.poly([[cx, 12.4], [cx + d * 4, 12.4], [cx + d * 1.6, 20], [cx + d * 2.4, 24.6], [cx, 24.6]], 'h.crimson', { vcyl: true, outline: true });
        c.rect(67.4, 12, 21.2, 1, 'h.iron', { cyl: true });
        c.light(78, 22, 50, DAY, 0.4);
        c.shaft({ kind: 'window', x0: 70, x1: 86, y0: 15, y1: 86, slant: 20, n: 3, color: [255, 240, 210], a: 0.1 });
        // the hook by the window
        c.rect(58.2, 13.4, 1.6, 1.2, 'h.iron', { cyl: true }); c.line(59.6, 14, 61, 15.8, 'h.iron', { w: 0.5 });
        // the shelf, with dusty jars (the lamp sits in the gap)
        c.z = 0.2;
        c.rect(13, 23.4, 38, 1.8, 'wood', { cyl: true, outline: true });
        for (const bx of [16.6, 45.6]) c.poly([[bx, 25.2], [bx + 1.8, 25.2], [bx + 1.8, 29.6]], 'h.bark', { outline: true });
        for (const [jx, w, h, m] of [[15, 3, 4.2, 'h.honey'], [18.6, 2.6, 5.4, 'glass'], [22, 2.4, 3.4, 'h.dirt'], [38, 3, 5, 'h.dirt'], [41.6, 2.4, 3.6, 'h.ruby'], [44.8, 3, 4.6, 'glass'], [48.2, 2, 3, 'h.honey']]) {
          c.rrect(jx, 23.4 - h, w, h, 0.8, m, { vcyl: true, outline: true, bias: m === 'glass' ? 0.1 : 0 });
          c.rect(jx + 0.3, 23.4 - h - 0.8, w - 0.6, 0.9, m === 'glass' ? 'h.dirt' : 'h.straw', { cyl: true });
        }
        // the hearth: stone, a mantel with candles and a plate, a fire under the soup pot
        stoneRow(c, 120, 0, 26, 10, { row: 2.6, len: 4, grad: [0.42, 0.5] });
        stoneRow(c, 118, 12, 30, 34, { row: 2.8, len: 4.4, grad: [0.55, 0.42], seed: 7 });
        c.rrect(115, 9.4, 36, 3.2, 0.6, 'h.bark', { cyl: true, outline: true });
        for (const cx of [118.6, 147.4]) { c.rrect(cx - 1, 7.6, 2, 1.8, 0.4, 'brass', { outline: true }); c.rect(cx - 0.5, 4.4, 1, 3.2, 'bone', { vcyl: true }); c.ell(cx, 3.6, 0.45, 0.8, 'lamp', { emit: true }); c.light(cx, 4, 22, CANDLE, 0.4 * fl); }
        c.ell(133, 6, 3, 3, 'white', { rim: true, outline: true }); c.ell(133, 6, 1.8, 1.8, 'h.sky', { flat: true, bias: -0.1 });
        c.rrect(125, 6.4, 2.6, 3, 0.6, 'h.dirt', { vcyl: true, outline: true }); c.rrect(139.4, 5.6, 3, 3.8, 0.8, 'h.honey', { vcyl: true, outline: true });
        c.poly(archPts(123, 143, 30, 4, 46), 'h.stone', { bias: 0.15, outline: true });
        c.poly(archPts(124.4, 141.6, 30.4, 3, 46), 'dark', { grad: [0.15, 0.45] });
        c.ell(133, 45.4, 8, 1.6, 'h.firelamp', { emit: true, flat: true, bias: -0.6 });
        c.rrect(125.4, 42.6, 15, 2.4, 1, 'h.bark', { cyl: true, outline: true }); c.rrect(128, 41, 10, 2, 0.9, 'h.bark', { cyl: true, outline: true, bias: -0.1 });
        for (let k = 0; k < 5; k++) { // flames, licking up round the pot
          const fx = 127 + k * 3, h = 8 + 3 * Math.sin(T(t) * 9 + k * 2.1) + 2 * hash(k, Math.floor(T(t) * 8), 3), sw = Math.sin(T(t) * 7 + k) * 0.8;
          c.poly([[fx - 2, 43], [fx - 1.4, 43 - h * 0.5], [fx + sw, 43 - h], [fx + 1.4, 43 - h * 0.45], [fx + 2, 43]], 'h.firelamp', { emit: true, flat: true, bias: -0.6 });
          c.poly([[fx - 1, 43], [fx + sw * 0.6, 43 - h * 0.62], [fx + 1, 43]], 'h.firelamp', { emit: true, flat: true, bias: 0.4 });
        }
        c.line(133, 30.4, 133, 33.6, 'h.iron', { w: 0.4 });
        c.ell(133, 37, 5, 3.8, 'h.iron', { clipY: [33.6, 50], rim: true, outline: true });
        c.rect(127.6, 33, 10.8, 1.4, 'h.iron', { cyl: true, outline: true });
        for (let i = 0; i < 3; i++) { const p = (T(t) * 0.3 + i / 3) % 1; c.ell(131 + i * 2 + Math.sin(p * 6 + i) * 1, 31 - p * 6, 0.8 + p, 0.6 + p * 0.6, 'h.smoke', { bias: 0.3 - p * 0.2 }); }
        for (let i = 0; i < 6; i++) { const p = (T(t) * 0.5 + hash(i, 1, 52)) % 1; c.dot(128 + hash(i, 2, 52) * 10 + Math.sin(p * 9 + i), 42 - p * 14, 'h.firelamp', 1 - p, true); }
        c.light(133, 40, 92, FIRE, 1.05 * fl);
        c.light(133, 50, 40, [255, 200, 120], 0.45 * fl);
        c.rect(113.6, 46, 38.8, 3, 'h.stone', { cyl: true, outline: true });
        // the floor: boards running toward you
        c.z = 0.42;
        c.rect(0, 46, 160, 54, 'wood', { grad: [0.42, 0.6] });
        for (let i = -12; i <= 12; i++) c.line(80 + i * 7, 46, 80 + i * 16, 100, 'h.bark', { s: 0.28 });
        for (let i = 0; i < 26; i++) { const y = 48 + hash(i, 1, 53) * 50, x = hash(i, 2, 53) * 160; c.line(x, y, x + 2 + (y - 46) * 0.05, y, 'h.bark', { s: 0.32 }); }
        c.shadow(80, 46.4, 82, 1.6, 0.45);
        // the rug, a braided oval
        c.z = 0.44;
        [[30, 8, 'h.crimson', -0.05], [26.4, 6.8, 'h.honey', -0.1], [22.6, 5.6, 'h.crimson', 0], [18.4, 4.4, 'h.door', 0], [13.6, 3.2, 'h.honey', -0.05], [8.4, 1.9, 'h.crimson', 0.05]].forEach(([rx, ry, m, b]) => c.ell(80, 84, rx, ry, m, { flat: true, bias: b }));
        for (let i = 0; i < 60; i++) { const a = i / 60 * 6.283; c.dot(80 + Math.cos(a) * 28.2, 84 + Math.sin(a) * 7.5, 'h.honey', 0.3); }
        // the scarf: from Marta's needles, across the floor, up the wall and out of the window
        c.z = 0.45;
        const path = [[97.6, 74], [96, 79], [90, 84.6], [80, 86.6], [70, 85], [64.6, 79], [64.4, 70], [68, 58], [72.6, 50], [75.4, 46.2], [76.6, 40], [77.4, 33], [77.8, 28.6]];
        let n = 0;
        for (let k = 0; k < path.length - 1; k++) {
          const [ax, ay] = path[k], [bx, by] = path[k + 1], len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
          for (let u = 0; u < len; u += 0.8) { const x = ax + (bx - ax) * u / len, y = ay + (by - ay) * u / len; c.rrect(x - 0.9, y - 0.55, 1.8, 1.2, 0.5, ['h.crimson', 'h.crimson', 'h.honey', 'h.wool'][Math.floor(n++ / 3) % 4], { bias: y < 46 ? -0.1 : 0.05 }); }
        }
        // the table, with a teapot and a bowl of apples
        c.z = 0.5;
        c.shadow(108, 73.2, 12, 1.6, 0.55);
        for (const lx of [99.4, 115]) c.rect(lx, 63.6, 1.6, 9.6, 'wood', { vcyl: true, outline: true });
        c.poly([[98.6, 59.6], [117.4, 59.6], [118.6, 62], [97.4, 62]], 'wood', { bias: 0.15, flat: true, outline: true });
        c.rrect(97.4, 61.8, 21.2, 2.2, 0.5, 'wood', { cyl: true, outline: true });
        c.ell(103, 58.2, 2.6, 2.1, 'cloth', { rim: true, outline: true }); c.line(105.4, 57.8, 107, 56.4, 'cloth', { w: 0.6 }); c.ell(103, 56, 0.6, 0.4, 'cloth');
        c.ell(112.4, 59.4, 3.2, 1.1, 'wood', { outline: true });
        for (const [ax, ay] of [[111.2, 58.4], [113.4, 58.2], [112.4, 57.4]]) c.ell(ax, ay, 1, 1, 'h.ruby', { rim: true });
        // the chest of drawers, a candle and a vase on it
        c.shadow(22, 64.2, 15, 1.8, 0.55);
        c.rrect(8, 49, 28, 15, 0.6, 'wood', { outline: true, grad: [0.62, 0.42] });
        c.rrect(7.4, 48.2, 29.2, 1.8, 0.6, 'wood', { cyl: true, outline: true });
        if (g.flag('drawer_open')) {
          c.rect(9.4, 50.8, 25.2, 3, 'dark', { flat: true });
          c.rrect(9, 53.8, 26, 5.2, 0.5, 'wood', { bias: 0.1, outline: true });
          c.rect(9.4, 50.8, 1, 3, 'wood', { flat: true, bias: -0.2 }); c.rect(33.6, 50.8, 1, 3, 'wood', { flat: true, bias: -0.2 });
          for (const kx of [16, 28]) c.ell(kx, 56.2, 0.7, 0.7, 'brass', { rim: true });
        } else {
          c.rrect(9.4, 51, 25.2, 5, 0.5, 'wood', { outline: true });
          for (const kx of [16, 28]) c.ell(kx, 53.5, 0.7, 0.7, 'brass', { rim: true });
        }
        c.rrect(9.4, 57.2, 25.2, 5.4, 0.5, 'wood', { outline: true });
        for (const kx of [16, 28]) c.ell(kx, 59.9, 0.7, 0.7, 'brass', { rim: true });
        c.rrect(10.8, 44, 3.4, 4.4, 1.2, 'h.sky', { vcyl: true, outline: true });
        for (let k = 0; k < 4; k++) c.ell(11.2 + k * 0.9, 42.6 - (k % 2), 0.8, 0.8, ['h.honey', 'white', 'h.wool'][k % 3], { rim: true });
        c.rrect(30.8, 47, 2.4, 1.4, 0.5, 'brass', { outline: true }); c.rect(31.5, 43.4, 1, 3.6, 'bone', { vcyl: true });
        c.ell(32, 42.6, 0.5, 0.9, 'lamp', { emit: true }); c.light(32, 43, 26, CANDLE, 0.5 * fl);
        // a basket of yarn
        c.shadow(46, 60, 8, 1.4, 0.55);
        c.rrect(39, 54, 13, 6, 1.4, 'h.straw', { vcyl: true, outline: true });
        for (let k = 0; k < 6; k++) c.line(40.6 + k * 2, 54.6, 40.6 + k * 2, 59.4, 'h.straw', { s: 0.25 });
        for (const [yx, yy, m] of [[42.4, 53.6, 'h.wool'], [46.6, 53, 'h.tunic'], [49.6, 54, 'h.honey']]) c.ell(yx, yy, 2.3, 2.1, m, { rim: true, outline: true });
        c.line(45, 51.6, 48, 48.6, 'brass', { w: 0.34, s: 0.8 }); c.line(46.4, 51.4, 44.6, 48.4, 'brass', { w: 0.34, s: 0.8 });
        // the cat, asleep on the warm hearthstone
        c.z = 0.5;
        const tail = Math.sin(T(t) * 0.9) * 0.8;
        c.shadow(122, 49.2, 4.2, 0.9, 0.5);
        c.ell(122, 47.6, 3.6, 1.8, 'h.leafdry', { rim: true, outline: true });
        c.ell(119.2, 47.2, 1.5, 1.3, 'h.leafdry', { rim: true, outline: true });
        c.poly([[118.2, 46.2], [118.6, 45], [119.4, 46]], 'h.leafdry', O); c.poly([[119.6, 46], [120.4, 45], [120.6, 46.4]], 'h.leafdry', O);
        c.line(125.4, 48, 127.4, 47.6 + tail, 'h.leafdry', { w: 0.6, s: 0.5 });
        for (let k = 0; k < 3; k++) c.line(121 + k * 1.4, 46.2, 121.6 + k * 1.4, 47.4, 'h.leafdry', { s: 0.25 });
      },
      objects: [
        { id: 'marta', name: 'Marta', aliases: ['woman', 'old woman', 'old marta', 'lady', 'granny', 'grandma'], rect: [92, 66, 22, 22], at: [100, 90], base: 88,
          draw(c, g, t) { marta(c, 106, 88, t); },
          desc: 'Old Marta. She is about a hundred, and she is knitting a scarf that goes out the window and around the well.',
          verbs: {
            talk(g) {
              if (!g.flag('met_marta')) { g.set('met_marta'); g.say('"Hello, dear! A knight, is it? Looking for the royal things? Take what you can use from my shelf, and the hooks, and the drawers. Nothing in here is any use to me. Mind: the honey is in the orchard, but the bees don\'t like folk. My old beekeeping veil is on the hook. And if you mean to go in the cave, bring a light!"'); }
              else g.say('"Take whatever you need, dear. There\'s a good soul."');
            },
            give: { '*': '"No, no. You keep it, dear. I have all I need."' }, attack: 'Marta swats you with the scarf. It is very long, and it reaches.', kiss: '"Oh, aren\'t you sweet."',
          } },
        { id: 'shelf', name: 'shelf', aliases: ['wooden shelf'], rect: [12, 20, 40, 12], at: [30, 64], base: 66,
          desc: g => (g.gone('lamp') ? 'A shelf with some dusty jars.' : 'A shelf with dusty jars and a brass oil lamp.'),
          verbs: { search: g => g.say(g.gone('lamp') ? 'Dusty jars.' : 'There is a brass oil lamp.') } },
        { id: 'lamp', item: 'lamp', name: 'brass lamp', aliases: ['lamp', 'lantern', 'oil lamp'], rect: [26, 14, 10, 10], at: [30, 64], base: 66,
          draw(c, g, t) { c.z = 0.22; brassLamp(c, 31, 23.4, false, t); }, desc: 'A brass oil lamp, not lit.', takeMsg: 'You take the lamp. It is full of oil.', points: 3 },
        { id: 'hook', name: 'hook', aliases: ['wall hook', 'peg', 'wall'], rect: [54, 12, 10, 12], at: [60, 54], base: 56,
          desc: g => (g.gone('veil') ? 'A hook on the wall, with nothing on it.' : 'A hook with a big straw hat on it. A net veil hangs from its brim.') },
        { id: 'veil', item: 'veil', name: 'beekeeper\'s veil', aliases: ['veil', 'hat', 'straw hat', 'net'], rect: [52, 16, 14, 14], at: [60, 54], base: 56,
          draw(c) { c.z = 0.22; strawHat(c, 59.4, 19.6, true); }, desc: 'A straw hat with a net veil.', takeMsg: 'You take the beekeeper\'s veil.', points: 3 },
        { id: 'drawers', name: 'chest of drawers', aliases: ['drawers', 'drawer', 'chest', 'dresser', 'cabinet'], rect: [8, 50, 28, 14], at: [24, 68], base: 66,
          desc: g => (g.flag('drawer_open') ? 'A chest of drawers. The top drawer is open.' : 'A chest of drawers with a stiff top drawer.'),
          verbs: {
            open(g) { if (g.flag('drawer_open')) return g.say('It is already open.'); g.set('drawer_open'); g.say(g.gone('tinderbox') ? 'You open the top drawer. Empty.' : 'You tug open the stiff top drawer. A tin tinderbox sits inside.'); },
            close(g) { g.say('You leave it open.'); }, search(g) { g.act('open', 'drawers'); },
          } },
        { id: 'tinderbox', item: 'tinderbox', name: 'tinderbox', aliases: ['tinder', 'box', 'tin box', 'flint'], show: g => g.flag('drawer_open'), rect: [14, 50, 10, 6], at: [24, 68], base: 66,
          draw(c) { c.z = 0.52; c.rrect(14.4, 51.2, 7.6, 2.6, 0.5, 'h.silver', { outline: true }); c.rect(14.4, 51.2, 7.6, 0.8, 'h.silver', { cyl: true, bias: 0.15 }); c.ell(18.2, 52.6, 0.7, 0.45, 'h.iron'); }, desc: 'A tinderbox.', takeMsg: 'You take the tinderbox.', points: 2 },
        { id: 'fire', name: 'fire', aliases: ['hearth', 'fireplace', 'flames'], rect: [118, 12, 30, 34], at: [124, 52], desc: 'A friendly fire.',
          verbs: { take: 'Ow.', climb: 'Ow.', enter: g => g.die('You step into the fireplace. You are not the first to do this, but you are the first to do it on purpose. It is hot. Very.'), eat: 'It is fire.', light: 'It is already lit.' } },
        { id: 'scarf', name: 'scarf', aliases: ['knitting', 'wool'], rect: [90, 74, 22, 12], desc: 'The scarf goes out of the room and around the well, and probably on to the next village.', verbs: { take: 'You take the end of the scarf. Marta gently takes it back.' } },
      ],
    },

    // ---------------------------------------------------------------- the forest path
    forest: {
      name: 'Forest Path', horizon: 40, exits: { w: 'yard', e: 'cave' },
      desc: 'A dark pine forest. A cave mouth gapes in the rock to the east. A hand-painted sign nailed to a tree says: CAVE. BEAR. BRING A LIGHT.',
      blocks: [[28, 58, 8, 6], [60, 52, 8, 6], [110, 50, 8, 6]],
      exitCheck(g, dir) {
        if (dir === 'e' && !lampLit(g)) {
          g.die('You walk into the cave in the dark. The cave has a pit just inside the door. You have found it. You can tell from the way you are no longer standing.');
          return true;
        }
        return false;
      },
      listen: 'Wind in the pines. Something big snores, far off.',
      look: 'hm-woods',
      back(c, g, t) {
        // pale sky between the trees, and light breaking through
        sky(c, 44, 'h.fog', [0.5, 0.92]);
        c.light(60, -10, 120, [210, 240, 200], 0.45);
        c.shaft({ kind: 'window', x0: 6, x1: 104, y0: 0, y1: 92, slant: 22, n: 5, color: [215, 240, 200], a: 0.09 });
        // rows of pines, far to near
        c.z = 0.05;
        for (let i = 0; i < 24; i++) pine(c, i * 7.4 - 4 + hash(i, 1, 40) * 4, 42 + hash(i, 2, 40) * 2, 0.5 + hash(i, 3, 40) * 0.3, i, t, { mat: 'h.pinefar', noShadow: true, plain: true, bias: 0.1 });
        c.z = 0.12;
        for (let i = 0; i < 9; i++) pine(c, 6 + i * 13 + hash(i, 4, 41) * 6, 46 + hash(i, 5, 41) * 3, 0.75 + hash(i, 6, 41) * 0.2, i + 40, t, { mat: 'h.pinefar', bias: -0.1, plain: true });
        // the forest floor: moss, needles, and the trail
        c.z = 0.4;
        c.rect(0, 40, 160, 60, 'h.moss', { grad: [0.48, 0.6], dither: true });
        for (let i = 0; i < 180; i++) { const k = hash(i, 2, 42), x = hash(i, 1, 42) * 160, y = 42 + k * 58; c.line(x, y, x + 0.8 + k, y + (hash(i, 3, 42) - 0.5) * 0.8, i % 4 ? 'h.moss' : 'h.leafdry', { s: 0.3 + hash(i, 4, 42) * 0.6 }); }
        dirtPath(c, [[0, 70.4], [40, 72], [80, 69.4], [120, 71], [140, 64], [160, 62], [160, 74], [130, 82], [100, 84], [80, 82.6], [40, 86], [0, 84.4]], 43, { n: 50, edge: 'h.moss', grad: [0.55, 0.42] });
        for (const [x0, y0, x1, y1] of [[20, 70.6, 28, 85], [92, 70.6, 86, 83.4]]) c.line(x0, y0, x1, y1, 'h.bark', { w: 1, s: 0.5 }); // roots across the trail
        // the rock face and the cave mouth
        c.z = 0.3;
        c.poly([[106, 62], [109, 44], [112, 32], [119, 22], [131, 15], [146, 11], [160, 9], [160, 64], [106, 64]], 'h.cliff', { grad: [0.72, 0.42], outline: true });
        for (const [x0, y0, x1, y1] of [[114, 34, 122, 46], [122, 46, 120, 58], [128, 20, 134, 30], [150, 14, 156, 24], [112, 50, 118, 53]]) c.line(x0, y0, x1, y1, 'h.cliff', { s: 0.1 });
        for (let i = 0; i < 9; i++) c.ell(118 + hash(i, 1, 44) * 40, 16 + hash(i, 2, 44) * 40, 2 + hash(i, 3, 44) * 2.4, 1.2, 'h.cliff', { flat: true, bias: 0.12 });
        for (let i = 0; i < 16; i++) { const x = 108 + i * 3.4, y = i < 4 ? 50 - i * 6 : i < 8 ? 26 - (i - 4) * 3 : 14 - (i - 8) * 0.6; c.ell(x, y, 2.4, 1.2, 'h.moss', { bias: 0.05 }); }
        c.poly(archPts(132, 160.6, 48, 15, 62.6), 'h.cavern', { grad: [0.32, 0.2], outline: true });
        c.poly(archPts(135, 160.6, 49, 12.4, 62.6), 'dark', { grad: [0.2, 0.05] });
        for (const [tx, h] of [[137, 3], [141, 4.4], [146, 3.6], [151, 5], [156, 3.2]]) { const top = 49 - 12.4 * Math.sqrt(Math.max(0, 1 - ((tx - 147.8) / 12.8) * ((tx - 147.8) / 12.8))); c.poly([[tx - 1.2, top - 0.4], [tx + 1.2, top - 0.4], [tx, top + h]], 'h.cavern', { vcyl: true }); }
        for (const [bx, by, r] of [[131, 61.4, 3], [134.6, 62.8, 2], [158, 63, 2.6]]) { c.shadow(bx, by + 0.4, r * 1.2, 0.8, 0.5); c.ell(bx, by - r * 0.4, r, r * 0.65, 'h.cliff', { clipY: [0, by], rim: true, outline: true }); }
        // the pines nearest the trail
        c.z = 0.3;
        pine(c, 32, 64, 1.35, 45, t); pine(c, 64, 58, 1.2, 46, t); pine(c, 114, 56, 1.05, 47, t);
        pine(c, 5, 74, 1.7, 48, t);
        // ferns
        for (const [fx, fy, s] of [[16, 92, 1.2], [52, 66, 0.8], [100, 62, 0.8], [148, 94, 1.3], [74, 96, 1]]) for (let k = 0; k < 7; k++) { const a = -2.6 + k * 0.36; c.line(fx, fy, fx + Math.cos(a) * 5 * s, fy + Math.sin(a) * 3.2 * s, 'h.leaf', { w: 0.6, s: 0.5 + (k % 2) * 0.2 }); }
        // the sign, nailed to its post, with claw marks
        c.z = 0.45;
        c.shadow(82.6, 68.4, 3.6, 0.9, 0.55);
        c.rect(81.4, 56, 1.8, 12.4, 'h.bark', { vcyl: true, outline: true });
        c.rrect(74.6, 50.4, 15.2, 8.4, 0.6, 'h.sapwood', { outline: true, grad: [0.62, 0.42] });
        c.rect(74.6, 54.4, 15.2, 0.34, 'h.bark', { flat: true, bias: -0.3 });
        c.text('CAVE', 80.2, 50.9, 'h.bark', { s: 0.08 }); c.text('BEAR', 80.2, 53.2, 'h.crimson', { s: 0.35 }); c.text('LIGHT', 79.6, 55.6, 'h.bark', { s: 0.08 });
        for (let k = 0; k < 3; k++) c.line(76.2 + k * 0.8, 52, 75.4 + k * 0.8, 57.4, 'h.bark', { s: 0.05 });
        for (const nx of [75.6, 88.6]) c.dot(nx, 51.4, 'h.iron', 0.8);
        // boughs hanging in at the top
        c.z = 0.2;
        foliage(c, 4, -1, 26, 8, 68, t, 'h.pine'); foliage(c, 72, -4, 18, 6, 69, t, 'h.pine');
        // fireflies
        for (let i = 0; i < 9; i++) { const ph = T(t) * (0.4 + hash(i, 1, 46) * 0.3) + i, on = Math.sin(T(t) * 2 + i * 1.9) > 0.1; if (!on) continue; const fx = 10 + hash(i, 2, 46) * 100 + Math.sin(ph) * 4, fy = 50 + hash(i, 3, 46) * 30 + Math.cos(ph * 1.3) * 2; c.dot(fx, fy, 'h.bugslamp', 1, true); c.dot(fx + 0.34, fy, 'h.bugslamp', 0.4, true); c.light(fx, fy, 7, [200, 240, 120], 0.35); }
      },
      objects: [
        { id: 'cave', name: 'cave', aliases: ['cave mouth', 'cave entrance', 'entrance', 'opening', 'rock'], rect: [124, 30, 36, 34], at: [140, 66],
          desc: 'A black mouth in the rock. You hear slow, huge breathing. It is very dark inside.', verbs: { enter: g => g.exit('e') } },
        { id: 'sign', name: 'sign', aliases: ['signpost', 'wooden sign'], rect: [74, 50, 16, 18], at: [82, 70], desc: 'CAVE. BEAR. BRING A LIGHT. Someone has added, in smaller letters: bears like honey.' },
        { id: 'toadstools', name: 'red mushrooms', aliases: ['mushrooms', 'mushroom', 'toadstool', 'toadstools', 'red toadstools', 'red mushroom'], rect: [92, 84, 14, 8], at: [98, 94], base: 92,
          draw(c) {
            c.z = 0.62;
            for (const [x, y, r] of [[94.4, 91, 2], [99.4, 92, 2.6], [103.6, 90, 1.7]]) {
              c.shadow(x + 0.4, y, r * 1.2, 0.6, 0.5);
              c.rrect(x - r * 0.35, y - r * 1.5, r * 0.7, r * 1.5, r * 0.3, 'bone', { vcyl: true, outline: true });
              c.ell(x, y - r * 1.4, r, r * 0.8, 'h.crimson', { clipY: [0, y - r * 1.2], rim: true, outline: true });
              for (const [dx, dy] of [[-0.45, -0.55], [0.3, -0.85], [0.55, -0.4], [-0.1, -0.3]]) c.ell(x + dx * r, y - r * 1.4 + dy * r * 0.7, r * 0.16, r * 0.12, 'white', { flat: true, bias: 0.2 });
            }
            grassBlades(c, 92, 92, 2, 21); grassBlades(c, 106, 91, 2, 22);
          },
          desc: 'A ring of shiny red mushrooms with white spots. Pretty. Probably not food.',
          verbs: {
            eat: g => g.die('You eat a red mushroom. It tastes fine for about ten seconds. Then the forest begins to sing, and then to hum, and then you lie down for a very long nap.'),
            take: 'You leave them where they are. They look like they have strong feelings about that.',
          } },
      ],
    },

    // ---------------------------------------------------------------- the cave
    cave: {
      name: 'Bear Cave', horizon: 36, exits: { w: 'forest' },
      desc: g => (g.flag('bear_gone') ? 'The lamp lights up a big, damp cave. The bear has left, and its bed is a pile of leaves.' : 'Your lamp lights up a big, damp cave. A huge brown bear sleeps in a heap in the middle, on something red.'),
      blocks: [[50, 56, 52, 24]],
      listen: g => (g.flag('bear_gone') ? 'Drips.' : 'Slow breathing. Very large breathing.'),
      look: 'mystery',
      back(c, g, t) {
        // the back wall: slabs of rock, lit at the top edges, cracks between
        c.z = 0.1;
        c.rect(0, 0, 160, 40, 'h.cavern', { grad: [0.22, 0.42], dither: true });
        for (let i = 0; i < 34; i++) {
          const cx = hash(i, 1, 61) * 172 - 6, cy = 14 + hash(i, 2, 61) * 22, r = 5 + hash(i, 3, 61) * 7, pts = [];
          for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283 + hash(i, 5, 61), rr = r * (0.7 + 0.3 * hash(i, k + 6, 61)); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7]); }
          c.poly(pts, 'h.cavern', { outline: true, bias: -0.18 + hash(i, 4, 61) * 0.16 });
        }
        for (const [x0, y0, x1, y1] of [[20, 20, 34, 30], [70, 14, 86, 22], [118, 26, 130, 18], [44, 32, 60, 36]]) c.line(x0, y0, x1, y1, 'h.cavern', { s: 0.05 });
        for (let i = 0; i < 7; i++) if (Math.sin(T(t) * 1.3 + i * 2.3) > 0.7) c.dot(10 + hash(i, 1, 66) * 140, 18 + hash(i, 2, 66) * 18, 'h.glowlamp', 1, true);
        // the ceiling and its stalactites
        c.poly([[0, 0], [160, 0], [160, 14], [142, 22], [124, 15], [106, 20], [84, 13], [62, 21], [40, 14], [20, 22], [0, 15]], 'h.cavern', { grad: [0.1, 0.32] });
        const tips = [];
        for (let i = 0; i < 18; i++) {
          const x = 3 + i * 9 + hash(i, 1, 62) * 4, top = 13 + hash(i, 2, 62) * 6, len = 4 + hash(i, 3, 62) * 10, w = 1.2 + hash(i, 4, 62) * 1.4;
          c.poly([[x - w, top], [x + w, top], [x + 0.2, top + len]], 'h.cavern', { vcyl: true, bias: 0.05 });
          c.dot(x + 0.2, top + len - 0.3, 'h.water', 0.95);
          tips.push([x + 0.2, top + len]);
        }
        // the floor
        c.z = 0.4;
        c.rect(0, 36, 160, 64, 'h.cavefloor', { grad: [0.36, 0.6], dither: true });
        c.rect(0, 35, 160, 2.4, 'h.cavern', { flat: true, bias: -0.3 });
        for (let i = 0; i < 70; i++) { const x = hash(i, 1, 63) * 160, y = 38 + hash(i, 2, 63) * 62, r = 0.4 + hash(i, 3, 63) * (y - 30) / 40; c.ell(x, y, r * 1.5, r * 0.7, i % 3 ? 'h.cavefloor' : 'h.cavern', { bias: hash(i, 4, 63) > 0.5 ? 0.2 : -0.2 }); }
        // puddles, with drips falling into them
        for (const [px, py, rx] of [[28, 88, 10], [128, 84, 8], [140, 52, 6]]) { c.ell(px, py, rx, rx * 0.22, 'h.water', { flat: true, bias: -0.25 }); c.ell(px - rx * 0.3, py - 0.2, rx * 0.4, rx * 0.06, 'h.water', { flat: true, bias: 0.2 }); }
        for (const [k, px, py] of [[2, 28, 88], [14, 128, 84], [15, 140, 52]]) {
          const [tx, ty] = tips[k], p = (T(t) * 0.5 + k * 0.37) % 1;
          if (p < 0.7) c.ell(tx, ty + p / 0.7 * (py - ty), 0.3, 0.5, 'h.water', { bias: 0.4 });
          else { const r = (p - 0.7) * 14; c.ell(px, py, r, r * 0.25, 'h.water', { flat: true, bias: 0.35 }); c.ell(px, py, r * 0.7, r * 0.17, 'h.water', { flat: true, bias: -0.25 }); }
        }
        // stalagmites at the sides
        for (const [sx, sy, h] of [[8, 74, 14], [16, 66, 8], [150, 64, 12], [156, 80, 16]]) {
          c.shadow(sx + 1, sy, 4.4, 1.1, 0.55);
          c.poly([[sx - 3.4, sy], [sx - 2.6, sy - h * 0.3], [sx - 1.8, sy - h * 0.55], [sx - 1.2, sy - h * 0.8], [sx - 0.3, sy - h], [sx + 0.6, sy - h * 0.94], [sx + 1, sy - h * 0.7], [sx + 1.8, sy - h * 0.45], [sx + 2.4, sy - h * 0.2], [sx + 3.4, sy]], 'h.cavern', { vcyl: true, outline: true, bias: 0.08 });
          for (const k of [0.3, 0.55, 0.8]) c.line(sx - 3 * (1 - k), sy - h * k, sx + 2.6 * (1 - k), sy - h * k + 0.4, 'h.cavern', { s: 0.15 });
        }
        // rocks along the foot of the wall
        for (let i = 0; i < 10; i++) { const bx = hash(i, 1, 67) * 160, r = 1.6 + hash(i, 2, 67) * 4; c.ell(bx, 37.6, r, r * 0.6, 'h.cavern', { clipY: [0, 38.4], rim: true, outline: true, bias: 0.05 }); }
        // glowing mushrooms
        for (const [gx, gy, n] of [[12, 58, 3], [146, 46, 4], [120, 96, 3], [44, 44, 2]]) {
          for (let k = 0; k < n; k++) { const x = gx + k * 2 - n, y = gy - (k % 2) * 0.6, h = 1.4 + (k % 2); c.rect(x - 0.25, y - h, 0.5, h, 'bone', { flat: true, bias: -0.1 }); c.ell(x, y - h, 1, 0.6, 'h.glowlamp', { emit: true, clipY: [0, y - h + 0.2] }); }
          c.light(gx, gy - 2, 26, GLOW, 0.6);
        }
        // daylight from the way out, to the west
        c.light(-8, 60, 90, [170, 200, 240], 0.75);
        c.shaft({ kind: 'sun', x: -8, y: 50, from: -0.32, to: 0.42, n: 5, color: [190, 215, 255], a: 0.08 });
        // the bear's bed of leaves, and some old fish bones
        c.z = 0.45;
        for (let i = 0; i < 90; i++) { const a = hash(i, 1, 64) * 6.283, d = Math.sqrt(hash(i, 2, 64)); c.ell(77 + Math.cos(a) * d * 31, 72 + Math.sin(a) * d * 8.6, 1.2, 0.55, 'h.leafdry', { bias: (hash(i, 3, 64) - 0.5) * 0.5 }); }
        for (const [fx, fy] of [[36, 84], [112, 90]]) { c.line(fx - 3, fy, fx + 3, fy, 'bone', { s: 0.6 }); for (let k = 0; k < 4; k++) c.line(fx - 2 + k * 1.3, fy - 1, fx - 2 + k * 1.3, fy + 1, 'bone', { s: 0.5 }); c.poly([[fx + 3, fy], [fx + 4.6, fy - 1.2], [fx + 4.6, fy + 1.2]], 'bone', { flat: true }); }
      },
      objects: [
        { id: 'bear', name: 'bear', aliases: ['big bear', 'brown bear', 'grizzly', 'banner', 'red cloth', 'cloth', 'flag'], rect: [52, 46, 50, 30], at: [40, 82], base: 80,
          show: g => !g.flag('bear_gone'),
          draw(c, g, t) {
            c.z = 0.5;
            c.poly([[51, 74], [99, 70.6], [102, 78.4], [54, 80.2]], 'h.crimson', { outline: true }); // the banner, under the bear
            c.line(51.6, 74.6, 99, 71.2, 'brass', { s: 0.6 }); c.line(54.4, 79.4, 101.4, 77.8, 'brass', { s: 0.6 });
            bear(c, 74, 77.4, t);
          },
          desc: 'A very big bear, sound asleep, with its head on its paws. It is snoring. It is lying on a crimson banner.',
          verbs: {
            talk: 'The bear snores. It does not seem to be in the mood for conversation.',
            attack: g => g.die('You attack the bear. It wakes up. You notice that it has a lot of teeth, and that you are not at all as fast as it is.'),
            push: g => g.die('You push the bear. It wakes up. It is not pleased, and it is a great deal bigger than you.'),
            pull: g => g.die('You pull the bear\'s ear. It wakes up. You learn something about bears.'),
            kiss: g => g.die('You give the bear a kiss on the nose. It wakes up, confused, and then hungry.'),
            take: g => g.die('You try to take the bear. The bear has other ideas.'),
            climb: g => g.die('You climb onto the sleeping bear. This is quite brave, and quite short.'),
            search: 'You peek under the bear. There is something red under it, but you would have to wake it to get it.',
            give: { honey(g) {
              g.lose('honey'); g.set('bear_gone'); g.score(10, 'bear');
              g.say('You hold the honeycomb under the bear\'s nose. Its nostrils twitch. One eye opens, then the other. It rises, takes the honey very gently, and ambles out of the cave with a happy grumble. A crimson banner lies where it slept.');
            }, '*': 'The bear sleeps through it.' },
          } },
        { id: 'banner', item: 'banner', name: 'royal banner', aliases: ['banner', 'flag', 'cloth'], show: g => g.flag('bear_gone'), rect: [50, 56, 52, 22], at: [76, 84], base: 80,
          draw(c) {
            c.z = 0.5;
            c.shadow(77, 76.6, 25, 3, 0.45);
            c.poly([[54, 70.6], [98, 68.6], [101, 78], [53, 79.6]], 'h.crimson', { outline: true, grad: [0.62, 0.48] });
            for (const [x0, y0, x1, y1] of [[64, 70.2, 62, 79.4], [88, 69.2, 90, 78.4]]) c.line(x0, y0, x1, y1, 'h.crimson', { s: 0.2, w: 0.6 });
            c.line(54.6, 71.2, 98, 69.2, 'brass', { s: 0.7 }); c.line(53.8, 79, 100.4, 77.4, 'brass', { s: 0.7 });
            c.poly([[70.6, 76.6], [70.4, 71.6], [73.2, 73.8], [76, 70.6], [78.8, 73.6], [81.6, 71.2], [81.6, 76.4]], 'brass', { outline: true });
            for (const jx of [73.2, 76, 78.8]) c.ell(jx, 75, 0.6, 0.6, 'h.ruby', { rim: true });
            for (let i = 0; i < 14; i++) c.line(56 + hash(i, 1, 65) * 42, 71 + hash(i, 2, 65) * 7, 57 + hash(i, 1, 65) * 42, 71.6 + hash(i, 2, 65) * 7, 'h.fur', { s: 0.5 });
          },
          desc: 'The Royal Banner of Hollowmere, crimson with a golden crown.', takeMsg: 'You pick up the banner. It is damp and fur-covered, but it is the Royal Banner.', points: 5 },
      ],
    },
  };

  const def = {
    id: 'hollowmere', title: 'The Crown of Hollowmere', maxScore: 100,
    hd: { hero: knight },
    start: { room: 'castle', x: 80, y: 80 },
    intro: 'The old king of Hollowmere is gone. He left no heir, but he left a crown, and the crown has been broken into three treasures that are lost in the kingdom: the Ruby, the Royal Ladle and the Royal Banner. Whoever brings them back to the steward may wear it. You have a good pair of boots and a feather in your cap. That will have to do.',
    help: 'Walk with the arrow keys, or click where you want to go. Type what you want to do: look, look at the well, take rope, open door, climb tree, talk to troll, give coin to crow, use rope on well. Say "inventory" to see what you carry. Look at everything. Some things in this kingdom will kill you. That is part of the fun.',
    items, rooms,
    onStart(g) { g.say('Welcome to the Kingdom of Hollowmere. Talk to the steward, and look at everything.'); },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = def; else root.HOLLOWMERE = def;
})(typeof window !== 'undefined' ? window : globalThis);
