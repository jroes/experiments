/*
 * The Lamp at Gullrock: a small seaside adventure for the engine in shared/adventure.js.
 * The lighthouse is dark, the keeper is ill in bed and a storm is coming, with the supper boat still out. You are the keeper's apprentice.
 * You need oil, a wick and a light. Original story, text and art.
 *
 * The pictures are HD-2D (shared/hd2d.js): fine pixel art at three times the world size, lit by the room's lamps. Every number in the
 * art is still in world units (160 x 100), so it lines up with the rects and walking. The game brings its own materials (sea, sand,
 * grass, paint, wool) and four looks: overcast (a grey afternoon), gale (the exposed cliff top), shelter (the quiet rocks and cove)
 * and lamp (the lamp room, cold until the lamp is lit).
 *
 * Verb names used by handlers: look search take drop open close use give talk push pull climb enter swim eat drink wear light play attack cut kiss tie dig
 */
(function (root) {
  'use strict';
  const HD = typeof require !== 'undefined' ? require('../shared/hd2d.js') : root.HD2D;
  const hash = HD.hash;

  const LAMP = [255, 207, 122], WARM = [255, 170, 90], COLD = [170, 200, 225], FLAME = [255, 190, 110];
  const O = { outline: true }; // things you can use get a dark edge
  const T = t => t || 0;

  // ---------------------------------------------------------------- materials and looks (dark to light)
  HD.addMaterials({
    storm: ['#1c222c', '#28303c', '#38414e', '#4c5662', '#646e78', '#7f8a92', '#a0a9ad', '#c4cacb'],
    cloud: ['#262c36', '#363e4a', '#4c5560', '#66707a', '#848e96', '#a8b0b4', '#cdd2d2'],
    sea: ['#0a161e', '#10222c', '#18313c', '#22434e', '#305962', '#437176', '#5e8e8e'],
    foam: ['#5a747c', '#8ea8ac', '#c2d4d4', '#e8f2f0', '#ffffff'],
    skyB: ['#5c5a52', '#726c60', '#8c846e', '#a89c82', '#c2b496', '#d8caa8', '#eadcbc', '#f8ecd2'],
    seaB: ['#2a3430', '#3a463e', '#4e5a4c', '#66705c', '#808870', '#9ea284', '#bcbc9c'],
    cloudB: ['#4a4842', '#625e54', '#7e786a', '#9c9480', '#bab098', '#d6ccb2', '#ece2ca'],
    grass: ['#1a281c', '#273c26', '#365430', '#4a6c3a', '#628846', '#82a65a'],
    beach: ['#3c362c', '#5a5244', '#7c725e', '#9e937a', '#bdb296', '#d8cfb2'],
    wetsand: ['#2e2a24', '#433e35', '#5a5446', '#736b59', '#8c836c'],
    kelp: ['#14100a', '#261e10', '#3a2e18', '#524222', '#6c5a2e', '#8a7840'],
    dirt: ['#261e18', '#3c3026', '#544434', '#6e5a44', '#8a7458'],
    stone: ['#1a1c22', '#282b33', '#3b3f48', '#53585f', '#71767c', '#959a9c'],
    blackrock: ['#141519', '#1f2127', '#2c2f36', '#3c3f46', '#50535a', '#6a6d72'],
    whitewash: ['#545660', '#7c7e86', '#a6a7a8', '#cdccc6', '#ebe8de', '#fbf8f0'],
    redpaint: ['#2e1016', '#561a20', '#842828', '#b04032', '#d2664a', '#e88c6a'],
    ochre: ['#43351c', '#6e5a2e', '#9a8044', '#c0a45e', '#dcc484', '#eedcaa'],
    teal: ['#162c30', '#234850', '#346870', '#508a90', '#76aeae', '#a2cec8'],
    rose: ['#3a2228', '#62383f', '#8c545a', '#b2747a', '#d29a9a', '#ecc0b8'],
    slate: ['#141820', '#202634', '#2f3848', '#424e62', '#5c6a7e', '#7c8a9a'],
    thatch: ['#2a2014', '#45371f', '#64522e', '#857040', '#a68e58', '#c4ac78'],
    oilskin: ['#3a2a08', '#664c10', '#9a781c', '#c8a22c', '#e6c650', '#f8e48c'],
    knit: ['#2a0a10', '#50141c', '#7e2028', '#ac3236', '#d2544a', '#ec8064'],
    navy: ['#0e121c', '#18202e', '#253248', '#364866', '#4e6386', '#6e84a4'],
    heather: ['#1e1626', '#33263e', '#4c3a58', '#6a5476', '#8a7294', '#ae98b4'],
    robe: ['#1e140c', '#342416', '#503a24', '#6e5434', '#8e7048', '#ae9064'],
    driftwood: ['#211d1a', '#36302b', '#504740', '#6c6156', '#8c7f70', '#ada08e'],
    weed: ['#0c140a', '#162210', '#223218', '#324620', '#465c2a', '#5e7434'],
    crab: ['#300a0a', '#5a1410', '#8a281c', '#b8442c', '#dc704a', '#f4a07a'],
    ginger: ['#38160a', '#682e10', '#9a4e1e', '#c67634', '#e8a056', '#f8cc8e'],
    grey: ['#36363c', '#56565e', '#7e7e84', '#a8a8aa', '#d0d0ce', '#f0eee8'],
    flounder: ['#2a2418', '#4a402c', '#706244', '#9a8a62', '#c2b48a'],
    iron: ['#101116', '#1b1d24', '#2a2d36', '#3f434e', '#5c616c', '#828894'],
    tin: ['#262a30', '#444a52', '#6c747c', '#9aa2a8', '#c8cfd2', '#f0f4f4'],
    pool: ['#0c1c22', '#132e36', '#1e4650', '#2e626a', '#4a8488', '#7ab0ac'],
    lensglass: ['#16242a', '#24383f', '#385259', '#527078', '#7a969a', '#b4cccc', '#e6f2f0'],
    petal: ['#4a1e36', '#82304e', '#bc4e6a', '#e88a98', '#f8c4c4'],
    oil: ['#3a2406', '#6e4a0c', '#a87418', '#d8a432', '#f4d070'],
    beamlamp: ['#ffe2a0', '#fffaea'],
    glow: ['#5a2408', '#9a4410', '#d4741c', '#f4a83a', '#ffd270', '#fff0c0'],
    amberlamp: ['#f0a040', '#ffd890'],
  });
  const DOF = { clear: 0.24, ramp: 0.42, bg: 0.45 };
  // a grey afternoon with weather coming: cool shadows, soft grey light, a little spray in the air
  HD.addLook('overcast', { grade: { shadow: [80, 112, 140], high: [228, 232, 226], amt: 0.35, sat: 0.92, contrast: 1.06 }, light: { ambient: 0.97, gain: 1.0, steps: 10 },
    post: { dof: DOF, bloom: 0.38, thr: 0.76, fog: { color: [150, 168, 178], a: 0.12 }, dust: { n: 24, color: [200, 212, 220] }, tint: { color: '#7a96a4', a: 0.1 }, vignette: 0.45 } });
  // the top of the cliff: darker, wetter, more spray
  HD.addLook('gale', { grade: { shadow: [64, 100, 140], high: [214, 226, 228], amt: 0.45, sat: 0.82, contrast: 1.1 }, light: { ambient: 0.9, gain: 1.1, steps: 10 },
    post: { dof: DOF, bloom: 0.45, thr: 0.72, fog: { color: [140, 162, 178], a: 0.2 }, dust: { n: 90, color: [214, 226, 234] }, tint: { color: '#5a7a8e', a: 0.13 }, vignette: 0.55 } });
  // out of the wind: a touch warmer, and close in, like a model on a table
  HD.addLook('shelter', { grade: { shadow: [90, 110, 150], high: [240, 232, 214], amt: 0.3, sat: 0.98, contrast: 1.06 }, light: { ambient: 0.98, gain: 1.0, steps: 10 },
    post: { dof: { clear: 0.16, ramp: 0.28, bg: 0.7 }, bloom: 0.4, thr: 0.74, dust: { n: 30, color: [230, 230, 220] }, tint: { color: '#a0a090', a: 0.08 }, vignette: 0.4 } });
  // the lamp room: cold grey window light, until the lamp burns
  HD.addLook('lamp', { grade: { shadow: [70, 96, 150], high: [255, 228, 180], amt: 0.4, sat: 1.0, contrast: 1.08 }, light: { ambient: 0.74, gain: 1.4, steps: 10 },
    post: { dof: { clear: 0.2, ramp: 0.34, bg: 0.35 }, bloom: 0.65, thr: 0.66, dust: { n: 60, color: [255, 228, 190] }, tint: { color: '#b09070', a: 0.08 }, vignette: 0.55 } });

  // ---------------------------------------------------------------- the lighthouse beam
  // A turning beam seen from the side: a wedge from the lamp out to the horizon, long when it points sideways, short when it points at us.
  function beamFor(ox, oy, t) {
    const az = T(t) * 0.9, s = Math.sin(az);
    return { ox, oy, ex: ox + 175 * s, ey: oy + 4 + 3 * Math.abs(s), w: 7, at: Math.max(0, Math.cos(az)) };
  }
  function inBeam(b, px, py) {
    const dx = b.ex - b.ox, dy = b.ey - b.oy, L2 = dx * dx + dy * dy;
    if (L2 < 1) return false;
    const u = ((px - b.ox) * dx + (py - b.oy) * dy) / L2;
    if (u < 0 || u > 1.3) return false;
    return Math.abs((px - b.ox) * dy - (py - b.oy) * dx) / Math.sqrt(L2) < 0.6 + b.w * u;
  }
  const beamMat = (b, mat, lit) => (b ? (px, py) => (inBeam(b, px, py) ? lit : mat) : mat);

  // ---------------------------------------------------------------- weather: sky, clouds, sea, surf, rain
  // o: seed, beam, bolt (now and then, lightning far out), glow (where the sun is behind the clouds)
  function sky(c, y1, t, o) {
    o = o || {};
    const seed = o.seed || 1, b = o.beam;
    const flash = o.bolt && ((T(t) + seed * 1.7) % 9) < 0.18;
    c.z = 0;
    c.rect(0, 0, 160, y1, beamMat(b, 'storm', 'skyB'), { grad: [0.34 + (flash ? 0.25 : 0), 0.88 + (flash ? 0.1 : 0)], unlit: true, dither: true });
    if (flash) {
      const bx = 20 + hash(Math.floor((T(t) + seed * 1.7) / 9), 1, seed) * 120;
      let x = bx, y = 2;
      while (y < y1 - 6) { const nx = x + (hash(Math.floor(y), 2, seed) - 0.5) * 6, ny = y + 2 + hash(Math.floor(y), 3, seed) * 3; c.line(x, y, nx, ny, 'beamlamp', { emit: true, w: 0.4 }); x = nx; y = ny; }
      c.light(bx, 10, 160, [200, 215, 255], 0.5);
    }
    // clouds: soft lumps lit from above, with flat dark bellies, drifting with the wind
    const n = o.clouds || 7;
    for (let i = 0; i < n; i++) {
      const w = 16 + hash(i, 3, seed) * 28, cx = ((hash(i, 1, seed) * 230 + T(t) * (0.6 + hash(i, 4, seed) * 0.8)) % 230) - 35, cy = 3 + hash(i, 2, seed) * (y1 * 0.5);
      const m = beamMat(b, 'cloud', 'cloudB');
      c.ell(cx, cy + w * 0.08, w * 0.56, w * 0.1, m, { flat: true, bias: -0.2, unlit: true });
      for (let k = 0; k < 5; k++) {
        const kx = cx + (k - 2) * w * 0.2, ky = cy - Math.sin((k + 0.5) / 5 * Math.PI) * w * 0.1 - hash(i, k + 7, seed) * 1.5;
        c.ell(kx, ky, w * (0.16 + hash(i, k + 11, seed) * 0.08), w * (0.11 + hash(i, k + 13, seed) * 0.05), m, { unlit: true, bias: 0.04 - (i % 3) * 0.07, clipY: [0, cy + w * 0.08] });
      }
    }
  }
  // the sea from y0 (the horizon) to y1: rows of waves that get bigger as they come closer, a few whitecaps
  function sea(c, y0, y1, t, o) {
    o = o || {};
    const b = o.beam, calm = o.calm ? 0.55 : 1, seed = o.seed || 2;
    c.z = o.z === undefined ? 0.1 : o.z;
    const m = beamMat(b, 'sea', 'seaB');
    c.rect(0, y0, 160, y1 - y0, m, { grad: [0.66, 0.28], dither: true });
    c.rect(0, y0, 160, 0.4, beamMat(b, 'storm', 'skyB'), { flat: true, bias: 0.2, unlit: true });
    let k = 0;
    for (let y = y0 + 0.9; y < y1 - 0.3; y += 0.6 + (y - y0) * 0.11, k++) {
      const near = (y - y0) / Math.max(8, y1 - y0), len = 2 + near * 9 * calm, step = len * 2.3 + 2;
      const drift = T(t) * (1.2 + (k % 3) * 0.4) + Math.sin(T(t) * 0.9 + k * 1.7) * 1.4 * calm;
      for (let x = -step; x < 160 + step; x += step) {
        const xx = ((x + hash(k, 1, seed) * step + drift) % (160 + 2 * step) + (160 + 2 * step)) % (160 + 2 * step) - step;
        c.rect(xx, y, len, 0.34 + near * 0.4, m, { flat: true, bias: 0.24 + near * 0.12 });
        c.rect(xx + len * 0.15, y + 0.34 + near * 0.4, len * 0.85, 0.34 + near * 0.3, m, { flat: true, bias: -0.32 });
        const cap = hash(k, Math.floor(x), seed);
        if (cap > 0.86 - near * 0.08 * calm && Math.sin(T(t) * 2 + cap * 40) > 0.1 && !o.calm) c.rect(xx + len * 0.3, y - 0.2, len * 0.45, 0.4 + near * 0.3, 'foam', { flat: true, bias: 0.1 });
      }
    }
  }
  // where the sea meets the sand: the wash slides in and out, leaving dark wet sand and a lacy edge of foam
  function surf(c, y, t, o) {
    o = o || {};
    const p = Math.sin(T(t) * 0.8) * (o.calm ? 0.7 : 1.3), edge = x => y + p + Math.sin(x * 0.14 + T(t) * 1.2) * 0.6 + Math.sin(x * 0.37) * 0.3;
    const top = [], wet = [], foamB = [];
    for (let x = 0; x <= 160; x += 2) { top.push([x, edge(x) - 1.6]); wet.push([x, edge(x) + 2.6 + Math.sin(x * 0.21) * 0.6]); foamB.push([x, edge(x) + 0.7]); }
    c.z = 0.36;
    c.poly(top.concat(wet.slice().reverse()), 'wetsand', { grad: [0.55, 0.75] });
    c.poly(top.concat(foamB.slice().reverse()), 'foam', { flat: true, bias: -0.05 });
    for (let x = 0; x < 160; x += 1.3) if (hash(Math.floor(x * 3), 7, 3) > 0.45) c.dot(x, edge(x) + 0.9 + hash(Math.floor(x * 3), 8, 3) * 0.6, 'foam', 0.9);
    // the next wave, coming in
    const q = (T(t) * 0.25) % 1;
    for (let x = 0; x < 160; x += 6) c.rect(x + Math.sin(x) * 2, y - 3.4 + q * 1.6, 4, 0.5, 'foam', { flat: true, bias: -0.25 + q * 0.3 });
  }
  // light rain, blown in on the wind (drawn over everything, so keep it fine)
  function rain(c, t, n, seed) {
    c.z = 0.9;
    for (let i = 0; i < n; i++) {
      const sp = 50 + hash(i, 1, seed) * 30, y = ((hash(i, 2, seed) * 115 + T(t) * sp) % 115) - 8, x = ((hash(i, 3, seed) * 190 + y * 0.28 + T(t) * 9) % 190) - 15;
      c.line(x, y, x + 0.7, y + 2.6, 'foam', { s: 0.5 + hash(i, 4, seed) * 0.3, w: 0.34 });
    }
  }
  function grass(c, y0, t, o) {
    o = o || {};
    const seed = o.seed || 4;
    c.z = 0.4;
    c.rect(0, y0, 160, 100 - y0, 'grass', { grad: [0.4, 0.62], dither: true });
    for (let i = 0; i < 46; i++) c.ell(hash(i, 1, seed) * 160, y0 + 2 + hash(i, 2, seed) * (98 - y0), 2 + hash(i, 3, seed) * 6, 0.5 + hash(i, 4, seed) * 1, 'grass', { flat: true, bias: hash(i, 5, seed) > 0.5 ? 0.12 : -0.12 });
    tufts(c, y0, 100, t, o.tufts || 70, seed);
  }
  function tufts(c, y0, y1, t, n, seed, x0, x1) {
    if (x0 === undefined) { x0 = 0; x1 = 160; }
    for (let i = 0; i < n; i++) {
      const x = x0 + hash(i, 6, seed) * (x1 - x0), y = y0 + 1.5 + hash(i, 7, seed) * (y1 - y0 - 1.5), near = (y - y0) / 50, sw = 0.7 + Math.sin(T(t) * 2.4 + x * 0.25) * 0.5;
      for (let k = -1; k <= 1; k++) c.line(x + k * 0.5, y, x + k * 0.4 + sw, y - 1.4 - near * 1.2 - (k === 0 ? 0.5 : 0), 'grass', { s: 0.75 + k * 0.1, w: 0.34 });
    }
  }
  function flowers(c, x0, y0, w, h, n, seed) {
    for (let i = 0; i < n; i++) {
      const x = x0 + hash(i, 1, seed) * w, y = y0 + hash(i, 2, seed) * h;
      c.line(x, y, x, y - 1.2, 'grass', { s: 0.5, w: 0.34 });
      c.ell(x, y - 1.4, 0.55, 0.45, ['petal', 'oilskin', 'whitewash', 'petal', 'heather'][i % 5], { bias: 0.15 });
    }
  }
  // a boulder sitting in the ground, lit from the top left, with lichen and barnacles
  function boulder(c, x, y, w, mat, seed) {
    const h = w * 0.58;
    c.shadow(x + w * 0.12, y, w * 0.62, Math.max(1, w * 0.1), 0.55);
    c.ell(x, y - h * 0.45, w / 2, h * 0.6, mat || 'stone', { clipY: [0, y], rim: true });
    c.ell(x - w * 0.12, y - h * 0.62, w * 0.26, h * 0.26, mat || 'stone', { flat: true, bias: 0.22 });
    c.line(x - w * 0.05, y - h * 0.7, x + w * 0.08, y - h * 0.25, mat || 'stone', { s: 0.05 });
    for (let i = 0; i < Math.round(w * 0.8); i++) {
      const a = hash(i, 1, seed || 5) * Math.PI, r = hash(i, 2, seed || 5) * 0.9;
      c.dot(x - Math.cos(a) * w * 0.45 * r, y - h * 0.45 - Math.sin(a) * h * 0.5 * r, i % 3 ? 'ochre' : 'whitewash', 0.55 + (i % 2) * 0.3);
    }
  }
  function bush(c, x, y, s, t, seed) { // gorse: dark spiky green with yellow flowers, leaning in the wind
    c.shadow(x + 1, y, 7 * s, 1.3 * s, 0.5);
    const lean = Math.sin(T(t) * 1.8 + x) * 0.5;
    c.ell(x, y - 2.4 * s, 7 * s, 3.4 * s, 'grass', { clipY: [0, y], bias: -0.3 });
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * (0.1 + 0.8 * hash(i, 1, seed || 6)), r = 0.35 + 0.6 * hash(i, 2, seed || 6);
      const cx = x - Math.cos(a) * 5.4 * s * r + lean * r, cy = y - 1.6 * s - Math.sin(a) * 3.4 * s * r;
      c.ell(cx, cy, (1.4 + hash(i, 3, seed || 6)) * s, (1.1 + hash(i, 4, seed || 6) * 0.8) * s, 'grass', { rim: true, bias: -0.18 + hash(i, 5, seed || 6) * 0.14, clipY: [0, y] });
    }
    for (let i = 0; i < 16; i++) { const px = x - 6 * s + hash(i, 6, seed || 6) * 12 * s, py = y - 0.8 - hash(i, 7, seed || 6) * 5 * s; c.line(px, py, px + 0.6 + lean, py - 0.9, 'grass', { s: 0.15, w: 0.34 }); }
    for (let i = 0; i < 12; i++) c.dot(x - 5 * s + hash(i, 1, seed || 7) * 10 * s + lean, y - 1.2 - hash(i, 2, seed || 7) * 4.6 * s, 'oilskin', 0.85);
  }
  // a gull: a white body and long bent wings that flap; xs is how fast it flies across
  function gull(c, x0, y0, t, o) {
    o = o || {};
    const s = o.s || 1, x = (((x0 + T(t) * (o.v === undefined ? 3 : o.v)) % 190) + 190) % 190 - 15, y = y0 + Math.sin(T(t) * 0.8 + x0) * 1.5;
    const f = Math.sin(T(t) * 6 + x0), wy = -f * 1.6 * s;
    c.z = 0.2;
    for (const d of [-1, 1]) {
      c.line(x, y, x + d * 2 * s, y - 0.8 * s + wy * 0.5, 'whitewash', { s: 0.8, w: 0.4 * s });
      c.line(x + d * 2 * s, y - 0.8 * s + wy * 0.5, x + d * 4.2 * s, y + wy, 'grey', { s: 0.4, w: 0.34 });
    }
    c.ell(x, y + 0.1, 1.2 * s, 0.6 * s, 'whitewash', { flat: true, bias: 0.25 });
  }
  function standingGull(c, x, y, t) { // a gull standing on something, turning its head now and then
    const look = Math.floor(T(t) * 0.5 + x) % 3 === 0 ? -1 : 1;
    c.shadow(x, y, 2, 0.5, 0.4);
    c.line(x - 0.4, y, x - 0.4, y - 1.2, 'oilskin', { w: 0.34 }); c.line(x + 0.4, y, x + 0.4, y - 1.2, 'oilskin', { w: 0.34 });
    c.ell(x, y - 2.4, 2, 1.3, 'whitewash', { rim: true });
    c.ell(x - look * 0.9, y - 2.5, 1.3, 0.8, 'grey', { bias: -0.05 });
    c.ell(x + look * 1.2, y - 4, 0.9, 0.9, 'whitewash');
    c.rect(look > 0 ? x + 2 : x - 0.4 - 1.6 + 0.4, y - 4.1, 1.2, 0.4, 'oilskin', { flat: true, bias: 0.2 });
    c.dot(x + look * 1.4, y - 4.3, 'iron', 0);
  }

  // ---------------------------------------------------------------- buildings and props
  // a cottage seen from the front: wall, a side going back, a hipped roof with courses, a chimney with smoke, a door, shuttered windows with flower boxes
  function cottage(c, x, y, w, h, wall, roof, door, t, seed) {
    c.z = 0.3;
    const rh = h * 0.62, top = y - h;
    c.shadow(x + w / 2 + 2, y + 0.2, w * 0.64, 2.2, 0.5);
    c.poly([[x + w, y], [x + w, top], [x + w + 4, top - 2.4], [x + w + 4, y - 2.4]], wall, { flat: true, bias: -0.34 });
    c.rect(x, top, w, h, wall, { grad: [0.74, 0.52], outline: true });
    for (let i = 0; i < 10; i++) c.ell(x + 1 + hash(i, 1, seed) * (w - 2), top + 2 + hash(i, 2, seed) * (h - 4), 0.8 + hash(i, 3, seed), 0.4, wall, { flat: true, bias: -0.08 });
    c.rect(x, top, w, 1.2, wall, { flat: true, bias: -0.42 });
    c.rect(x, y - 2, w, 2, 'stone', { grad: [0.6, 0.35] });
    for (let i = 2.2; i < w; i += 2.6) c.rect(x + i, y - 2, 0.34, 2, 'stone', { flat: true, bias: -0.45 });
    // roof
    const L = x - 2.6, R = x + w + 2.6, ry = top + 0.6;
    c.poly([[R, ry], [x + w - 1, top - rh], [R + 4, ry - 2.4]], roof, { flat: true, bias: -0.22, outline: true });
    c.poly([[L, ry], [R, ry], [x + w - 1, top - rh], [x + 3, top - rh]], roof, { grad: [0.7, 0.42], outline: true });
    for (let yy = top - rh + 1.6; yy < ry - 0.3; yy += 1.6) {
      const k = (yy - (top - rh)) / (ry - (top - rh)), xa = x + 3 + (L - x - 3) * k, xb = x + w - 1 + (R - x - w + 1) * k;
      c.rect(xa + 0.3, yy, xb - xa - 0.6, 0.34, roof, { flat: true, bias: -0.42 });
      for (let xx = xa + ((yy * 7) % 2.4); xx < xb - 1; xx += 2.4) c.rect(xx, yy - 1.2, 0.34, 1.2, roof, { flat: true, bias: -0.3 });
    }
    c.rect(L, ry - 0.2, R - L, 0.8, roof, { flat: true, bias: 0.25 });
    // chimney and smoke, blown east
    const cx = x + w * 0.74, cy = top - rh * 0.72;
    c.rect(cx, cy - 4, 3.4, 5, 'stone', { vcyl: true, outline: true });
    c.rect(cx - 0.5, cy - 4.6, 4.4, 1, 'stone', { cyl: true });
    for (let i = 0; i < 5; i++) {
      const p = (T(t) * 0.3 + i / 5 + hash(seed, 1, 1)) % 1;
      c.ell(cx + 1.7 + p * 14 + Math.sin(T(t) + i) * 0.6, cy - 5.4 - p * 8, 0.8 + p * 2.6, 0.6 + p * 1.6, 'cloud', { unlit: true, bias: 0.2 - p * 0.35 });
    }
    // door, with a stone step
    const dx = x + w / 2 - 3;
    c.rrect(dx - 0.7, y - 11.7, 7.4, 11.7, 3, 'stone', { flat: true, bias: -0.15 });
    c.rrect(dx, y - 11, 6, 11, 2.8, door, { grad: [0.6, 0.35], outline: true });
    for (const px of [dx + 2, dx + 4]) c.rect(px, y - 10, 0.34, 9.6, door, { flat: true, bias: -0.4 });
    c.dot(dx + 4.8, y - 5.5, 'brass', 0.9);
    c.rect(dx - 1, y - 0.6, 8, 1.2, 'stone', { cyl: true });
    // shuttered windows with flower boxes
    for (const wx of [x + 3, x + w - 9]) {
      const wy = top + 5;
      c.rect(wx - 0.6, wy - 0.6, 7.2, 6.2, 'stone', { flat: true, bias: 0.05 });
      for (const sx of [wx, wx + 3]) {
        c.rect(sx, wy, 3, 5, door, { grad: [0.62, 0.42] });
        c.line(sx + 0.3, wy + 0.8, sx + 2.6, wy + 4.2, door, { s: 0.2 });
      }
      c.rect(wx + 2.9, wy, 0.34, 5, door, { flat: true, bias: -0.5 });
      c.rect(wx - 0.8, wy + 5, 7.6, 1.5, 'driftwood', { cyl: true });
      for (let i = 0; i < 6; i++) c.ell(wx + 0.2 + i * 1.25, wy + 4.6 - (i % 2) * 0.4, 0.75, 0.6, i % 3 === 0 ? 'petal' : i % 3 === 1 ? 'grass' : 'oilskin', { bias: 0.1 });
    }
  }
  // bunting on a rope between two chimneys, snapping in the wind
  function bunting(c, x0, y0, x1, y1, sag, t) {
    c.z = 0.33;
    const at = u => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + sag * 4 * u * (1 - u)];
    let prev = at(0);
    for (let i = 1; i <= 40; i++) { const p = at(i / 40); c.line(prev[0], prev[1], p[0], p[1], 'driftwood', { s: 0.3 }); prev = p; }
    const mats = ['knit', 'oilskin', 'teal', 'whitewash', 'navy'];
    for (let i = 1; i < 22; i++) {
      const [px, py] = at(i / 22), f = Math.sin(T(t) * 5 + i * 1.3);
      c.poly([[px - 1.3, py], [px + 1.3, py], [px + 1.6 + f * 0.9, py + 3.2 - Math.abs(f) * 0.4]], mats[i % 5], { bias: f * 0.12 });
    }
  }
  // the lighthouse: a tapered tower in red and white bands, a gallery with a rail, the glass lantern, a red dome and a vane
  function lighthouse(c, cx, baseY, topY, wb, wt, lit, t, o) {
    o = o || {};
    const bands = 6, hb = (baseY - topY) / bands;
    c.shadow(cx + 2, baseY + 0.2, wb * 0.8, wb * 0.12, 0.55);
    c.poly([[cx - wb / 2, baseY], [cx + wb / 2, baseY], [cx + wt / 2, topY], [cx - wt / 2, topY]],
      (px, py) => (Math.floor((baseY - py) / hb) % 2 ? 'redpaint' : 'whitewash'), { vcyl: true, outline: o.outline });
    for (let i = 1; i < 4; i++) { const wy = baseY - (i + 0.5) * (baseY - topY) / 4 - 1; c.rrect(cx - wb * 0.06, wy, wb * 0.12, wb * 0.18, wb * 0.05, 'iron', { flat: true, bias: -0.1 }); }
    // the gallery and its rail
    const gw = wt + wb * 0.22, gy = topY - wb * 0.07;
    c.rect(cx - gw / 2, gy, gw, wb * 0.08, 'iron', { cyl: true, outline: o.outline });
    for (let i = 0; i <= 8; i++) c.line(cx - gw / 2 + i * gw / 8, gy, cx - gw / 2 + i * gw / 8, gy - wb * 0.18, 'iron', { s: 0.5, w: 0.34 });
    c.line(cx - gw / 2, gy - wb * 0.18, cx + gw / 2, gy - wb * 0.18, 'iron', { s: 0.6, w: 0.34 });
    // the lantern: glass, dark or blazing
    const lw = wt * 0.72, lh = wb * 0.36, ly = gy - lh;
    c.rect(cx - lw / 2, ly, lw, lh, lit ? 'beamlamp' : 'lensglass', lit ? { emit: true } : { rim: true, grad: [0.75, 0.35] });
    if (lit) { c.ell(cx, ly + lh * 0.55, lw * 0.26, lh * 0.36, 'sunlamp', { emit: true }); c.light(cx, ly + lh / 2, o.r || 110, LAMP, 0.5); }
    for (let i = 0; i <= 3; i++) c.rect(cx - lw / 2 + i * lw / 3 - 0.2, ly, 0.4, lh, 'iron', { flat: true, bias: -0.1 });
    // the dome, the vent ball and a vane turning in the wind
    c.ell(cx, ly, lw / 2 + wb * 0.04, wb * 0.16, 'redpaint', { clipY: [0, ly + 0.2], rim: true, outline: o.outline });
    c.ell(cx, ly - wb * 0.17, wb * 0.04 + 0.3, wb * 0.04 + 0.3, 'iron');
    const vane = Math.sin(T(t) * 0.7) * wb * 0.1;
    c.line(cx, ly - wb * 0.2, cx, ly - wb * 0.34, 'iron', { s: 0.5, w: 0.34 });
    c.line(cx - vane, ly - wb * 0.3, cx + vane, ly - wb * 0.3, 'iron', { s: 0.6, w: 0.34 });
  }

  // ---------------------------------------------------------------- people and animals
  // the keeper's apprentice (you): wellies, a yellow oilskin coat and sou'wester, and a red scarf Granny knitted
  function apprentice(c, x, y, dir, moving, step, g, t) {
    const L = dir === 'l', back = dir === 'u', f = moving ? (Math.floor(step / 4) & 1) : 0;
    const X = v => (L ? x - v : x + v);
    const R = (x0, y0, w, h, r, mat, o) => c.rrect(L ? x - x0 - w : x + x0, y + y0, w, h, r, mat, o);
    const E = (x0, y0, rx, ry, mat, o) => c.ell(X(x0), y + y0, rx, ry, mat, o);
    const P = (pts, mat, o) => c.poly(pts.map(p => [X(p[0]), y + p[1]]), mat, o);
    const has = id => g && g.has && g.has(id);
    c.shadow(x + 0.5, y, 6.5, 1.3, 0.55);
    // legs and wellies (one lifts when walking)
    R(-2.5, -7 + (f ? -0.6 : 0), 2.2, 4.6, 0.5, 'navy', { vcyl: true, outline: true });
    R(0.3, -7 + (f ? 0 : -0.6), 2.2, 4.6, 0.5, 'navy', { vcyl: true, outline: true });
    R(-3, -3 + (f ? -0.6 : 0), 3, 3, 0.7, 'iron', { vcyl: true, outline: true });
    R(0, -3 + (f ? 0 : -0.6), 3, 3, 0.7, 'iron', { vcyl: true, outline: true });
    // the far arm
    R(-5, -13.4, 1.9, 5.6, 0.8, 'oilskin', { vcyl: true, bias: -0.25, outline: true });
    if (!back) E(-4.1, -7.6, 1, 1, 'skin');
    // the coat, flaring to the knees
    P([[-3.6, -14.4], [3.6, -14.4], [4.5, -5.6], [-4.5, -5.6]], 'oilskin', { vcyl: true, outline: true });
    P([[-4.5, -6.3], [4.5, -6.3], [4.5, -5.6], [-4.5, -5.6]], 'oilskin', { flat: true, bias: -0.35 });
    if (!back) {
      c.line(X(0.3), y - 13.4, X(0.6), y - 6, 'oilskin', { s: 0.15 });
      for (const by of [-12, -10, -8]) c.dot(X(1.2), y + by, 'iron', 0.6);
      R(1.7, -10.6, 2, 0.4, 0.1, 'oilskin', { flat: true, bias: -0.3 });
    } else c.line(X(0), y - 13.6, X(0), y - 6, 'oilskin', { s: 0.2 });
    // the red scarf, its end flying in the wind
    R(-3, -15, 6, 1.9, 0.8, 'knit', { cyl: true, outline: true });
    const fl = Math.sin(T(t) * 5) * 0.8;
    P([[-2.6, -14.2], [-1.2, -14.2], [-4.2 - (moving ? 1.2 : 0), -11.6 + fl], [-5.4 - (moving ? 1.4 : 0), -12 + fl]], 'knit', { flat: true, bias: -0.1, outline: true });
    // head
    E(0, -17.4, 2.9, 3, back ? 'hair' : 'skin', O);
    if (!back) {
      E(-2.6, -17.2, 0.6, 0.9, 'skin', { bias: -0.2 });
      for (const ex of [1.3, -0.3]) { c.dot(X(ex), y - 17.3, 'boot', 0); c.dot(X(ex), y - 17, 'boot', 0); }
      c.dot(X(2.1), y - 16.2, 'knit', 0.6);
      P([[-2.6, -18.8], [2.8, -18.8], [2.4, -18], [1, -18.4], [-0.4, -17.9], [-1.8, -18.3]], 'hair', { flat: true, bias: 0.05 });
    }
    // the sou'wester: a round crown and a brim that is longer at the back
    E(back ? 0 : -0.6, -18.9, 4.4, 1.3, 'oilskin', { outline: true, bias: -0.05 });
    E(0, -19.6, 3, 2.3, 'oilskin', { clipY: [0, y - 18.7], rim: true, outline: true });
    R(-2.9, -19.3, 5.8, 0.5, 0.2, 'oilskin', { flat: true, bias: -0.35 });
    // the near arm, and whatever is being carried
    const hx = X(4.6), hy = y - 8.6, sw = moving ? Math.sin(step * 0.4) * 0.6 : 0;
    if (has('oil')) {
      c.rrect(hx - 1.6, hy + 0.2 + sw, 3.2, 4, 0.4, 'tin', { vcyl: true, outline: true });
      c.rect(hx - 1.4, hy + 1.4 + sw, 2.8, 1.2, 'knit', { vcyl: true });
      c.line(hx - 0.4, hy + sw, hx + 0.6, hy - 0.6 + sw, 'tin', { w: 0.4 });
    } else if (has('bucket') || has('fish')) {
      c.line(hx - 1.6, hy + 1.6 + sw, hx, hy + sw, 'thatch', { w: 0.34 }); c.line(hx, hy + sw, hx + 1.6, hy + 1.6 + sw, 'thatch', { w: 0.34 });
      c.rrect(hx - 1.8, hy + 1.6 + sw, 3.6, 3.4, 0.5, 'tin', { vcyl: true, outline: true });
      c.ell(hx, hy + 1.7 + sw, 1.6, 0.4, has('fish') ? 'pool' : 'iron', { flat: true });
      if (has('fish')) c.poly([[hx - 0.4, hy + 1.6 + sw], [hx - 1.6, hy - 0.6 + sw], [hx + 0.4, hy - 0.4 + sw]], 'flounder', { bias: 0.2, outline: true });
    }
    if (!back) { R(3.1, -13.4, 1.9, 4.8, 0.8, 'oilskin', { vcyl: true, outline: true }); c.ell(hx, hy, 1.05, 1.05, 'skin', O); }
  }
  // Granny Gull, knitting on her bench: a long red something pours off her needles and piles on the grass
  function granny(c, g, t) {
    const x = 110, y = 86, k = Math.sin(T(t) * 7), k2 = Math.sin(T(t) * 7 + 2);
    c.z = 0.65;
    c.shadow(x + 1, y, 9, 1.4, 0.5);
    // the yarn ball at her feet, and the yarn going up
    c.ell(x - 6.8, y - 1.3, 1.6, 1.5, 'knit', { rim: true, outline: true });
    for (let i = 0; i < 3; i++) c.line(x - 8 + i * 0.6, y - 2.2 + i * 0.2, x - 6 + i * 0.6, y - 0.4, 'knit', { s: 0.3 });
    c.line(x - 5.4, y - 1.8, x - 1.2, y - 10.6, 'knit', { s: 0.75, w: 0.34 });
    // skirt over her knees, boots peeping out
    c.rrect(x - 4.6, y - 2, 3, 2, 0.8, 'boot', O); c.rrect(x - 0.4, y - 2, 3, 2, 0.8, 'boot', O);
    c.poly([[x - 4.8, y - 11], [x + 3.6, y - 11], [x + 4.4, y - 1.4], [x - 5.6, y - 1.4]], 'navy', { vcyl: true, outline: true });
    c.line(x - 0.6, y - 9, x - 0.8, y - 2, 'navy', { s: 0.15 });
    // the knitting: a long red scarf, ribbed, falling off her lap and folded up on the grass beside her
    for (const [fx, fy, fw] of [[x + 4, y - 3.2, 10], [x + 4.8, y - 4.6, 9], [x + 4.2, y - 6, 8.4]]) {
      c.rrect(fx, fy, fw, 1.8, 0.8, 'knit', { cyl: true, outline: true });
      for (let i = 0.8; i < fw - 0.4; i += 0.9) c.rect(fx + i, fy + 0.3, 0.34, 1.2, 'knit', { flat: true, bias: -0.3 });
    }
    c.poly([[x - 1.6, y - 11], [x + 2.6, y - 11], [x + 6.6, y - 5.4], [x + 3.8, y - 5]], 'knit', { outline: true, cyl: true, band: [y - 11, y - 5] });
    for (let i = 0; i < 6; i++) { const u = i / 6; c.line(x - 1.2 + u * 5.4, y - 10.6 + u * 5.4, x + 2.4 + u * 4, y - 10.6 + u * 5.4, 'knit', { s: 0.28 }); }
    // body and shawl
    c.rrect(x - 4.2, y - 19.4, 8.4, 9.4, 3, 'navy', { vcyl: true, outline: true });
    c.poly([[x - 5, y - 18.8], [x - 2.6, y - 19.6], [x + 2.6, y - 19.6], [x + 5, y - 18.8], [x + 3.6, y - 15.4], [x, y - 12.6], [x - 3.6, y - 15.4]], 'heather', { outline: true, vcyl: true });
    for (let i = 0; i < 4; i++) c.line(x - 3.6 + i * 2.4, y - 18.6, x - 1.8 + i * 1.2, y - 14.4, 'heather', { s: 0.25 });
    for (let i = 0; i < 6; i++) c.line(x - 2 + i * 0.8, y - 13.4 + Math.abs(i - 2.5) * 0.5, x - 2 + i * 0.8, y - 12.4 + Math.abs(i - 2.5) * 0.5, 'heather', { s: 0.7, w: 0.34 });
    // arms, hands and the clicking needles
    c.rrect(x - 5.4, y - 17.4, 2.2, 6, 1, 'navy', { vcyl: true, bias: -0.15, outline: true });
    c.rrect(x + 3.2, y - 17.4, 2.2, 6, 1, 'navy', { vcyl: true, outline: true });
    c.ell(x - 2.6, y - 11.4, 1.1, 1, 'skin', O); c.ell(x + 2.6, y - 11.4, 1.1, 1, 'skin', O);
    c.line(x - 3.4, y - 13.4 + k * 0.4, x + 1.4, y - 10.2, 'tin', { s: 0.85, w: 0.34 });
    c.line(x + 3.4, y - 13.4 + k2 * 0.4, x - 1.2, y - 10.2, 'tin', { s: 0.85, w: 0.34 });
    c.rrect(x - 1.6, y - 11.4, 4.4, 2, 0.8, 'knit', { cyl: true });
    // head: grey hair in a bun, little round glasses, a smile
    c.rect(x - 0.8, y - 20.4, 1.6, 1.2, 'skin', { bias: -0.2 });
    c.ell(x, y - 22.6, 2.8, 2.9, 'skin', O);
    c.ell(x, y - 24, 3.1, 1.9, 'grey', { clipY: [0, y - 23.2], rim: true, outline: true });
    c.ell(x - 2.6, y - 22.4, 0.8, 1.6, 'grey', { bias: 0.1 }); c.ell(x + 2.6, y - 22.4, 0.8, 1.6, 'grey', { bias: -0.05 });
    c.ell(x + 0.6, y - 26, 1.5, 1.3, 'grey', { rim: true, outline: true });
    for (const ex of [-1.1, 1.1]) { c.ell(x + ex, y - 22.4, 0.85, 0.75, 'tin', { flat: true, bias: 0.2 }); c.dot(x + ex, y - 22.4, 'boot', 0); }
    c.line(x - 0.6, y - 20.9, x + 0.6, y - 20.9, 'knit', { s: 0.2 });
    c.dot(x - 1.9, y - 21.4, 'knit', 0.7); c.dot(x + 1.9, y - 21.4, 'knit', 0.7);
  }
  // the hermit on his rock: a beard to his belt, a patched robe, squinting at nothing (or not, once he has his spectacles back)
  function hermit(c, g, t) {
    const x = 60, y = 72, specs = g && g.flag && g.flag('gave_glasses'), nod = Math.sin(T(t) * 0.8) * 0.3;
    c.z = 0.65;
    // the stick, leaning on the rock
    c.line(x + 8.4, y - 0.4, x + 10.6, y - 21, 'driftwood', { w: 0.6, s: 0.55 });
    // legs and feet over the front of the rock
    c.rrect(x - 4, y - 4.6, 2.8, 4.2, 0.8, 'robe', { vcyl: true, outline: true }); c.rrect(x + 1.4, y - 4.6, 2.8, 4.2, 0.8, 'robe', { vcyl: true, outline: true });
    c.rrect(x - 4.6, y - 1.2, 3.4, 1.4, 0.6, 'thatch', O); c.rrect(x + 1, y - 1.2, 3.4, 1.4, 0.6, 'thatch', O);
    c.poly([[x - 4.8, y - 11.6], [x + 4.8, y - 11.6], [x + 5.2, y - 7], [x - 5.2, y - 7]], 'robe', { flat: true, bias: -0.25 });
    for (const kx of [-2.5, 2.5]) c.ell(x + kx, y - 7.6, 2.7, 2.1, 'robe', { rim: true, outline: true });
    c.rrect(x + 3, y - 8.2, 2, 1.8, 0.4, 'heather', { bias: -0.1 });
    // body, rope belt
    c.rrect(x - 4.4, y - 19, 8.8, 9.4, 3, 'robe', { vcyl: true, outline: true });
    c.rrect(x - 3.4, y - 16, 2.4, 2.4, 0.4, 'heather', { bias: -0.1 });
    c.rect(x - 4.4, y - 11.4, 8.8, 0.8, 'thatch', { cyl: true });
    // arms resting on his knees
    c.rrect(x - 6, y - 17.6, 2.2, 7, 1, 'robe', { vcyl: true, bias: -0.15, outline: true }); c.rrect(x + 3.8, y - 17.6, 2.2, 7, 1, 'robe', { vcyl: true, outline: true });
    c.ell(x - 4.6, y - 10, 1.1, 1, 'skin', O); c.ell(x + 4.8, y - 10, 1.1, 1, 'skin', O);
    // head
    c.ell(x, y - 21.6 + nod, 2.9, 3, 'skin', O);
    c.ell(x, y - 23.4 + nod, 2.6, 1.3, 'skin', { bias: 0.25, clipY: [0, y - 23 + nod] });
    for (const d of [-1, 1]) for (let i = 0; i < 3; i++) c.line(x + d * 2.6, y - 23 + nod + i * 0.7, x + d * (3.6 + i * 0.3) + Math.sin(T(t) * 2.4 + i) * 0.3, y - 22.4 + nod + i * 0.9, 'grey', { s: 0.75, w: 0.34 });
    for (let i = 0; i < 3; i++) c.line(x - 1 + i, y - 24.3 + nod, x - 1.4 + i * 1.4, y - 25.6 + nod + Math.sin(T(t) * 3 + i) * 0.3, 'grey', { s: 0.8, w: 0.34 });
    c.rect(x - 2.1, y - 22.8 + nod, 1.6, 0.5, 'grey', { flat: true, bias: 0.2 }); c.rect(x + 0.5, y - 22.8 + nod, 1.6, 0.5, 'grey', { flat: true, bias: 0.2 });
    if (specs) {
      for (const ex of [-1.2, 1.2]) { c.ell(x + ex, y - 21.8 + nod, 1, 0.9, 'iron', { flat: true }); c.ell(x + ex, y - 21.8 + nod, 0.65, 0.55, 'lensglass', { flat: true, bias: 0.3 }); c.dot(x + ex, y - 21.8 + nod, 'boot', 0); }
    } else for (const ex of [-1.2, 1.2]) c.line(x + ex - 0.6, y - 21.8 + nod, x + ex + 0.6, y - 21.7 + nod, 'boot', { s: 0.1 });
    c.ell(x + 0.2, y - 20.9 + nod, 0.6, 0.7, 'skin', { bias: -0.2 });
    // the beard, down to his belt, stirring in the wind
    const bw = Math.sin(T(t) * 2.2) * 0.6;
    c.poly([[x - 2.8, y - 20.4 + nod], [x + 2.8, y - 20.4 + nod], [x + 2.6, y - 16], [x + 1.2 + bw, y - 12.2], [x + bw * 1.4, y - 10.8], [x - 1.4 + bw, y - 12.6], [x - 2.6, y - 16]], 'grey', { rim: true, outline: true, vcyl: true });
    for (let i = 0; i < 4; i++) c.line(x - 1.6 + i * 1.1, y - 19 + nod, x - 1.2 + i * 0.8 + bw, y - 13.4, 'grey', { s: 0.35 });
    c.line(x - 0.9, y - 19.6 + nod, x + 0.9, y - 19.6 + nod, 'robe', { s: 0.1 });
  }
  // Barnaby on his barrel: a big knitted jumper, a hat that has seen things, a pipe and a rod, the float bobbing out on the water
  function barnaby(c, g, t) {
    const x = 47, y = 64, bob = Math.sin(T(t) * 2.1) * 0.5;
    c.z = 0.62;
    c.shadow(x + 1, y + 0.2, 8.4, 1.4, 0.55);
    // the barrel
    c.rrect(x - 6, y - 10, 12, 10, 2.4, 'wood', { vcyl: true, outline: true });
    for (const hy of [-8.6, -1.8]) c.rect(x - 6, y + hy, 12, 0.8, 'iron', { vcyl: true });
    for (const sx of [-3, 0, 3]) c.rect(x + sx, y - 9.4, 0.34, 8, 'wood', { flat: true, bias: -0.45 });
    // the line from the rod tip to the float
    c.line(76, 28, 78, 47 + bob, 'whitewash', { s: 0.6, w: 0.34 });
    c.ell(78, 47.4 + bob, 0.8, 0.9, 'knit', { bias: 0.1 }); c.rect(77.3, 46.8 + bob, 1.4, 0.4, 'whitewash', { flat: true, bias: 0.3 });
    c.ell(78, 48.2 + bob * 0.3, 2.4, 0.4, 'foam', { flat: true, bias: -0.2 });
    // legs dangling, boots
    c.rrect(x - 4.4, y - 11, 3.2, 8, 1, 'navy', { vcyl: true, bias: -0.2, outline: true }); c.rrect(x + 1, y - 11, 3.2, 8, 1, 'navy', { vcyl: true, bias: -0.2, outline: true });
    c.rrect(x - 5, y - 3.6, 4, 2.8, 0.8, 'iron', { vcyl: true, outline: true }); c.rrect(x + 0.6, y - 3.6, 4, 2.8, 0.8, 'iron', { vcyl: true, outline: true });
    // the round body in a cable-knit jumper
    c.ell(x, y - 17, 7.6, 7.2, 'navy', { rim: true, outline: true });
    for (const kx of [-2.6, 0, 2.6]) for (let i = 0; i < 6; i++) c.dot(x + kx + (i % 2 ? 0.34 : -0.34), y - 21.4 + i * 1.4, 'navy', 0.8);
    c.rect(x - 5.6, y - 11.4, 11.2, 1.2, 'navy', { cyl: true, bias: -0.1 });
    // the rod, held in both hands
    c.line(x + 4.6, y - 12.6, 76, 28, 'driftwood', { w: 0.5, s: 0.7 });
    c.ell(x + 6, y - 14.2, 1, 0.8, 'iron');
    c.poly([[x - 7.4, y - 21], [x - 4.6, y - 22], [x - 2.4, y - 16.6], [x + 1.4, y - 15.6], [x + 1.6, y - 13.4], [x - 3.6, y - 14], [x - 7, y - 17.4]], 'navy', { bias: -0.12, outline: true });
    c.poly([[x + 7.4, y - 21], [x + 4.8, y - 22], [x + 4.4, y - 17], [x + 3.4, y - 14.8], [x + 5.6, y - 13], [x + 7.6, y - 16.4]], 'navy', { bias: 0.05, outline: true });
    c.ell(x + 2.6, y - 14.6, 1.4, 1.3, 'skin', O); c.ell(x + 4.8, y - 13.6, 1.4, 1.3, 'skin', O);
    // head: red cheeks, a grey beard, a pipe with a curl of smoke
    c.ell(x, y - 26.4, 3.4, 3.4, 'skin', O);
    c.ell(x, y - 24.2, 3.8, 2.6, 'grey', { clipY: [y - 25.4, 0 + 200], rim: true, outline: true });
    c.ell(x + 0.6, y - 25.4, 0.9, 0.8, 'skin', { bias: 0.1 });
    for (const ex of [-1.4, 1.6]) c.dot(x + ex, y - 27, 'boot', 0);
    c.dot(x - 2.4, y - 25.8, 'knit', 0.7); c.dot(x + 2.6, y - 25.8, 'knit', 0.7);
    c.line(x + 1.6, y - 24.4, x + 4.2, y - 24.6, 'driftwood', { w: 0.4, s: 0.3 }); c.rrect(x + 3.8, y - 26, 1.4, 1.6, 0.4, 'driftwood', { bias: -0.1 });
    for (let i = 0; i < 3; i++) { const p = (T(t) * 0.4 + i / 3) % 1; c.ell(x + 4.6 + p * 4, y - 26.6 - p * 6, 0.4 + p * 0.9, 0.4 + p * 0.7, 'cloud', { unlit: true, bias: 0.3 - p * 0.4 }); }
    // the battered sou'wester
    c.ell(x - 0.4, y - 28.8, 5, 1.4, 'oilskin', { bias: -0.15, outline: true });
    c.ell(x, y - 29.8, 3.6, 2.6, 'oilskin', { clipY: [0, y - 28.9], rim: true, outline: true });
    c.poly([[x + 1.4, y - 32.2], [x + 3.4, y - 30.8], [x + 2, y - 30.4]], 'oilskin', { flat: true, bias: -0.35 });
  }
  // Biscuit: a fat ginger cat, sitting, staring at Barnaby, tail going
  function cat(c, g, t) {
    const x = 72, y = 62, sw = Math.sin(T(t) * 2.4);
    c.z = 0.62;
    c.shadow(x + 1, y, 6.4, 1.1, 0.55);
    // tail
    for (let i = 0; i < 9; i++) { const u = i / 8; c.ell(x + 4 + u * 4 + Math.sin(u * 2.4 + sw) * 1.2, y - 0.6 - u * u * 4 * (0.6 + 0.4 * sw), 0.95, 0.95, 'ginger', { bias: i % 3 === 0 ? -0.2 : 0.05 }); }
    // body, a loaf with a white front
    c.ell(x + 1, y - 3.4, 5, 3.6, 'ginger', { rim: true, outline: true });
    for (let i = 0; i < 4; i++) c.line(x + 0.6 + i * 1.3, y - 6.6 + i * 0.1, x + 1 + i * 1.3, y - 3.8, 'ginger', { s: 0.2, w: 0.34 });
    c.ell(x - 2.4, y - 3.2, 1.8, 2.4, 'whitewash', { bias: 0.05 });
    c.ell(x - 2.6, y - 0.6, 1.2, 0.6, 'whitewash', { bias: 0.1 }); c.ell(x - 0.4, y - 0.6, 1.2, 0.6, 'whitewash', { bias: 0.05 });
    // head, looking left at Barnaby
    c.ell(x - 3, y - 7.4, 2.8, 2.4, 'ginger', { rim: true, outline: true });
    c.poly([[x - 5.2, y - 8.4], [x - 4.8, y - 11], [x - 3.4, y - 9.2]], 'ginger', { outline: true }); c.poly([[x - 2.4, y - 9.4], [x - 1, y - 11], [x - 0.6, y - 8.6]], 'ginger', { outline: true });
    c.dot(x - 4.6, y - 9.6, 'petal', 0.6); c.dot(x - 1.4, y - 9.8, 'petal', 0.6);
    for (const ex of [-4.2, -2.4]) { c.ell(x + ex, y - 7.8, 0.55, 0.5, 'grass', { flat: true, bias: 0.4 }); c.dot(x + ex - 0.1, y - 7.8, 'boot', 0); }
    c.ell(x - 4.6, y - 6.6, 0.9, 0.6, 'whitewash', { flat: true, bias: 0.2 }); c.dot(x - 5, y - 6.9, 'petal', 0.5);
    for (const wy of [-6.8, -6.2]) c.line(x - 5.4, y + wy, x - 7.6, y + wy - 0.3 + (wy + 6.5), 'whitewash', { s: 0.9, w: 0.34 });
    if (g && g.flag && g.flag('gave_fish')) { // what is left of a flounder
      c.line(x + 7, y - 0.6, x + 11, y - 0.8, 'bone', { w: 0.34 });
      for (let i = 0; i < 4; i++) c.line(x + 7.6 + i, y - 1.4, x + 7.6 + i, y, 'bone', { w: 0.34 });
      c.poly([[x + 11, y - 0.8], [x + 12.4, y - 1.8], [x + 12.4, y + 0.2]], 'bone', { flat: true });
    }
  }
  // the crab: one claw much bigger than the other, eyes on stalks, legs tapping
  function crab(c, x, y, t) {
    const snap = Math.max(0, Math.sin(T(t) * 2.6)) * 0.9, step = Math.floor(T(t) * 5) % 2, sh = Math.sin(T(t) * 1.3) * 0.4;
    c.z = 0.62;
    c.shadow(x + 0.5, y + 0.1, 9, 1.4, 0.6);
    for (const d of [-1, 1]) for (let k = 0; k < 3; k++) {
      const kx = x + d * (2.4 + k * 0.6), lift = ((k + step) % 2) * 0.6;
      c.line(kx, y - 2 + k * 0.3, kx + d * 2.4, y - 2.8 + k * 0.4 - lift, 'crab', { w: 0.5, s: 0.45 });
      c.line(kx + d * 2.4, y - 2.8 + k * 0.4 - lift, kx + d * 3.2, y - lift * 0.4, 'crab', { w: 0.4, s: 0.35 });
    }
    // the small claw, the big claw
    c.line(x - 3.4, y - 3, x - 5.8, y - 4.8, 'crab', { w: 0.7, s: 0.5 });
    c.ell(x - 6.6, y - 5.2, 1.5, 1, 'crab', { rim: true, outline: true });
    c.line(x + 3.4, y - 3, x + 6, y - 5.4 + sh, 'crab', { w: 0.9, s: 0.5 });
    c.ell(x + 8, y - 6.2 + sh, 2.8, 1.9, 'crab', { rim: true, outline: true });
    c.poly([[x + 9.4, y - 6.8 + sh], [x + 12, y - 8.6 + sh - snap], [x + 11.6, y - 7.4 + sh - snap * 0.4]], 'crab', { outline: true, bias: 0.15 });
    c.poly([[x + 9.6, y - 5.6 + sh], [x + 12.2, y - 5 + sh + snap * 0.6], [x + 10, y - 4.8 + sh]], 'crab', { outline: true, bias: -0.1 });
    // body: a wide shell with a ridge and spots
    c.ell(x, y - 3, 4.8, 2.7, 'crab', { rim: true, outline: true });
    c.ell(x - 0.6, y - 3.8, 3, 1.2, 'crab', { flat: true, bias: 0.25 });
    for (const [sx, sy] of [[-2.2, -2.6], [1.8, -2.2], [0.2, -1.6], [2.8, -3.4]]) c.dot(x + sx, y + sy, 'crab', 0.1);
    // eyes on stalks
    for (const ex of [-1.2, 1.2]) { c.line(x + ex, y - 4.8, x + ex * 1.2, y - 6.6, 'crab', { w: 0.4, s: 0.5 }); c.ell(x + ex * 1.2, y - 6.9, 0.6, 0.6, 'blackrock', { bias: -0.2 }); c.dot(x + ex * 1.2 - 0.2, y - 7.1, 'whitewash', 1); }
  }
  // a flounder, flat on the bottom of the pool, gliding a little
  function flounder(c, x, y, t) {
    const wob = Math.sin(T(t) * 2) * 0.3;
    c.ell(x, y, 5, 2.2, 'flounder', { flat: true, bias: -0.32 });
    c.ell(x, y, 4.2, 1.7, 'flounder', { rim: true, bias: -0.08 });
    c.poly([[x + 4, y], [x + 6.4, y - 1.4 + wob], [x + 6.4, y + 1.4 + wob]], 'flounder', { flat: true, bias: -0.15 });
    for (const [sx, sy] of [[-1.4, 0.3], [0.6, -0.5], [1.8, 0.5], [-0.2, 0.8]]) c.ell(x + sx, y + sy, 0.4, 0.3, 'ochre', { flat: true, bias: 0.1 });
    for (const ex of [-2.6, -2]) c.dot(x + ex, y - 0.7 + (ex === -2 ? -0.2 : 0), 'boot', 0);
  }
  // a little boat far out, thrown about, with its lamps lit
  function farBoat(c, x, y, t) {
    const roll = Math.sin(T(t) * 1.6) * 0.8, heave = Math.sin(T(t) * 1.1) * 0.6;
    c.z = 0.11;
    c.poly([[x - 4.6, y - 1.4 + roll + heave], [x + 4.6, y - 1.4 - roll + heave], [x + 3.4, y + 0.6 + heave], [x - 3.4, y + 0.6 + heave]], 'redpaint', { flat: true, bias: -0.15 });
    c.rect(x - 1.4, y - 3 + heave, 3, 1.6, 'whitewash', { flat: true, bias: -0.1 });
    c.line(x, y - 3 + heave, x + roll * 1.4, y - 8 + heave, 'iron', { w: 0.34, s: 0.6 });
    c.poly([[x + 0.3 + roll * 1.3, y - 7.4 + heave], [x + 3 + roll, y - 3.4 + heave], [x + 0.3, y - 3.4 + heave]], 'whitewash', { flat: true, bias: -0.05 });
    const blink = Math.floor(T(t) * 1.5) % 2;
    c.dot(x - 4, y - 1.8 + roll + heave, blink ? 'redlamp' : 'redpaint', 1, blink);
    c.dot(x + roll * 1.4, y - 8.2 + heave, 'lamp', 1, true);
    c.ell(x, y + 0.8 + heave, 6, 0.5, 'foam', { flat: true, bias: -0.25 });
  }

  // ---------------------------------------------------------------- the rooms' pictures
  function villageBack(c, g, t) {
    sky(c, 40, t, { seed: 1, glow: 120 });
    sea(c, 33, 46, t, { seed: 3 });
    // the far headland, and the hill the village sits on
    c.z = 0.12;
    const far = [];
    for (let x = 0; x <= 96; x += 2) far.push([x, 31 + Math.sin(x * 0.05) * 2 + x * 0.12]);
    c.poly([[0, 46]].concat(far, [[96, 46]]), 'grass', { grad: [0.22, 0.32], dither: true });
    c.z = 0.2;
    const hill = [];
    for (let x = 0; x <= 160; x += 2) hill.push([x, 43 + Math.sin(x * 0.07 + 1) * 1.2]);
    c.poly([[0, 50]].concat(hill, [[160, 50]]), 'grass', { grad: [0.36, 0.42] });
    grass(c, 44, t, { seed: 4, tufts: 60 });
    // paths: one down the hill, one across
    c.z = 0.4;
    c.poly([[74, 58], [92, 58], [100, 100], [64, 100]], 'dirt', { grad: [0.42, 0.62], dither: true });
    c.poly([[0, 77], [160, 75], [160, 83], [0, 85]], 'dirt', { grad: [0.45, 0.6], dither: true });
    for (let i = 0; i < 70; i++) { const px = hash(i, 1, 8), py = hash(i, 2, 8); const x = i < 40 ? px * 160 : 66 + px * 32, y = i < 40 ? 76.4 + py * 7.6 - px * 2 : 59 + py * 40; c.ell(x, y, 0.8 + hash(i, 3, 8) * 0.8, 0.4, 'stone', { flat: true, bias: 0.12 + hash(i, 4, 8) * 0.2 }); }
    cottage(c, 46, 56, 26, 18, 'teal', 'slate', 'redpaint', t, 2);
    cottage(c, 8, 62, 30, 20, 'ochre', 'redpaint', 'teal', t, 1);
    cottage(c, 116, 60, 30, 20, 'rose', 'thatch', 'navy', t, 3);
    bunting(c, 33.5, 31, 140, 28.4, 7, t);
    // the notice board: posts, a little roof, papers pinned on, one corner flapping
    c.z = 0.45;
    c.shadow(38, 78.2, 13, 1.4, 0.5);
    for (const px of [28, 46]) c.rect(px, 64, 2, 14, 'driftwood', { vcyl: true, outline: true });
    c.poly([[22.6, 56.4], [53.4, 56.4], [51, 53.4], [25, 53.4]], 'slate', { grad: [0.7, 0.45], outline: true });
    c.rect(24, 56, 28, 12, 'driftwood', { grad: [0.6, 0.4], outline: true });
    c.rect(25.4, 57.4, 25.2, 9.2, 'thatch', { grad: [0.5, 0.35] });
    c.rect(26.4, 58.2, 9.6, 7.4, 'whitewash', { grad: [0.8, 0.62] });
    c.rect(26.4, 58.2, 9.6, 1.5, 'knit', { flat: true, bias: 0.05 });
    c.text('STORM', 26.9, 58.45, 'whitewash', { s: 0.9 });
    for (let i = 0; i < 4; i++) c.rect(27.2, 60.8 + i * 1.2, 8 - (i % 2) * 2.4, 0.4, 'iron', { flat: true, bias: 0.2 });
    c.rect(37.6, 58.8, 6, 5, 'whitewash', { grad: [0.72, 0.58] });
    for (let i = 0; i < 3; i++) c.rect(38.2, 59.8 + i * 1.2, 4.6 - i, 0.34, 'iron', { flat: true, bias: 0.25 });
    const fl = Math.sin(T(t) * 6) * 0.6;
    c.poly([[45, 58.6], [50, 58.6], [50 + fl * 0.3, 64.2], [45.4, 64.6]], 'ochre', { grad: [0.78, 0.6] });
    c.poly([[50, 63], [50 + fl * 0.3, 64.2], [48.4 + fl, 63.8]], 'ochre', { flat: true, bias: 0.3 });
    for (const [px, py] of [[31, 58.6], [40.6, 59.2], [47.4, 59]]) c.dot(px, py, 'knit', 0.6);
    // the bench Granny sits on
    c.z = 0.5;
    c.shadow(108, 82.4, 10, 1.4, 0.5);
    c.rect(99, 71, 18, 1.8, 'driftwood', { cyl: true, outline: true });
    for (const lx of [100.4, 114.6]) { c.rect(lx, 72.6, 1.2, 3.4, 'driftwood', { vcyl: true }); c.rect(lx, 78, 1.4, 4.2, 'driftwood', { vcyl: true, outline: true }); }
    c.rect(99, 76, 18, 2.2, 'driftwood', { cyl: true, outline: true });
    // flowers along the bottom, and a gull or two
    flowers(c, 2, 87, 58, 12, 26, 3); flowers(c, 120, 88, 38, 10, 14, 5);
    gull(c, 70, 18, t, { v: 3 }); gull(c, 140, 24, t + 3, { v: 4, s: 0.8 });
    standingGull(c, 32.5, 23.4, t);
  }

  function cliffBack(c, g, t) {
    sky(c, 32, t, { seed: 2, glow: 40, bolt: true });
    sea(c, 30, 48, t, { seed: 4 });
    // the lighthouse, far off to the east on its headland
    c.z = 0.11;
    c.poly([[136, 34], [146, 29.4], [160, 28.4], [160, 36]], 'grass', { grad: [0.2, 0.3] });
    lighthouse(c, 152, 30, 17, 4, 2.8, g.flag('lit'), t, { r: 30 });
    // spray thrown up from the rocks below the edge
    c.z = 0.2;
    for (let i = 0; i < 6; i++) {
      const p = (T(t) * 0.4 + hash(i, 1, 6)) % 1, sx = 8 + hash(i, 2, 6) * 145;
      if (p > 0.75) continue;
      for (let k = 0; k < 14; k++) { const a = hash(i, k, 7) * Math.PI, r = p * (3 + hash(k, i, 8) * 6); c.ell(sx + Math.cos(a) * r + p * 5, 45.6 - Math.sin(a) * r * 1.2 - p * 3, 0.35 + hash(k, 2, i) * 0.4, 0.3, 'foam', { flat: true, bias: 0.25 - p * 0.6, unlit: true }); }
    }
    // the cliff top, a ragged lip of grass and rock
    grass(c, 46, t, { seed: 7, tufts: 80 });
    c.z = 0.36;
    const lip = [], under = [];
    for (let x = 0; x <= 160; x += 2) { lip.push([x, 44.4 + Math.sin(x * 0.3) * 0.8 + hash(x, 1, 2) * 0.9]); under.push([x, 48.6 + Math.sin(x * 0.21 + 1) * 1.2 + hash(x, 2, 2) * 1.4]); }
    c.poly(lip.concat(under.slice().reverse()), 'stone', { grad: [0.68, 0.32], outline: true });
    for (let i = 0; i < 26; i++) { const x = hash(i, 3, 2) * 160; c.line(x, 45.6, x + 0.6, 48.6, 'stone', { s: 0.12 }); }
    const top = lip.map(([x, y]) => [x, y - 0.6]);
    c.poly(top.concat(lip.map(([x, y]) => [x, y + 1.2]).reverse()), 'grass', { flat: true, bias: 0.15 });
    tufts(c, 44, 47, t, 30, 9);
    // the path along the top, worn into the grass
    c.z = 0.4;
    c.poly([[0, 76], [70, 73], [110, 72.4], [160, 74], [160, 79], [110, 77.6], [70, 78.4], [0, 81]], 'dirt', { grad: [0.42, 0.58], dither: true });
    c.poly([[60, 78.4], [74, 78.4], [80, 100], [52, 100]], 'dirt', { grad: [0.44, 0.6], dither: true });
    // the hermit's rock
    c.z = 0.5;
    boulder(c, 60, 72.6, 22, 'stone', 3);
    // the hut: driftwood planks, a tarred roof patched with an old sail, a stovepipe, a net, a porthole
    c.z = 0.45;
    c.shadow(127, 70.6, 19, 2.2, 0.55);
    c.rect(112, 54, 28, 16.4, 'driftwood', O);
    for (let i = 0; i < 14; i++) c.rect(112.34 + i * 1.95, 54.34 + (i % 3) * 0.2, 1.95, 15.7 - (i % 3) * 0.2, 'driftwood', { vcyl: true, bias: (hash(i, 1, 9) - 0.5) * 0.4 });
    c.rect(112.34, 61.2, 27.3, 0.8, 'driftwood', { cyl: true, bias: -0.1 });
    c.poly([[109.4, 55], [142.6, 55], [135, 44.6], [117.6, 44.6]], 'driftwood', { grad: [0.5, 0.3], outline: true });
    c.poly([[120, 46], [131, 46], [134, 51.6], [121.6, 52.4]], 'thatch', { grad: [0.62, 0.48] });
    for (let i = 0; i < 4; i++) c.line(110 + i * 0.5, 54.6 - i * 2.6, 142 - i * 1.8, 54.6 - i * 2.6, 'driftwood', { s: 0.1 });
    c.line(121, 47, 133.6, 51.4, 'thatch', { s: 0.2 });
    c.rect(130, 44.4, 3, 6, 'iron', { vcyl: true, outline: true }); c.rect(129.4, 43.6, 4.2, 1.2, 'iron', { cyl: true });
    for (let i = 0; i < 5; i++) { const p = (T(t) * 0.38 + i / 5) % 1; c.ell(131.5 + p * 15 + Math.sin(T(t) * 1.3 + i) * 0.6, 42.6 - p * 9, 0.8 + p * 2.8, 0.6 + p * 1.8, 'cloud', { unlit: true, bias: 0.15 - p * 0.35 }); }
    c.rrect(122, 59, 8, 11.4, 0.6, 'blackrock', { flat: true, bias: -0.2 });
    c.poly([[122, 59], [119.6, 60.2], [119.6, 70.6], [122, 70.4]], 'driftwood', { bias: 0.1, outline: true });
    c.ell(116.6, 58.6, 2.1, 2.1, 'brass', { rim: true, outline: true }); c.ell(116.6, 58.6, 1.4, 1.4, 'lensglass', { flat: true, bias: -0.2 });
    for (let i = 0; i < 6; i++) { c.line(133 + i * 1.2, 56, 132.6 + i * 1.3, 66, 'grey', { s: 0.45, w: 0.34 }); c.line(133, 57 + i * 1.6, 140, 57.6 + i * 1.6, 'grey', { s: 0.45, w: 0.34 }); }
    for (const fx of [134, 137.4]) c.ell(fx, 66.4, 0.9, 0.8, 'oilskin', { rim: true });
    // a lobster pot by the door
    c.shadow(145.6, 72.2, 4, 0.8, 0.5);
    c.ell(145.6, 72, 3.4, 3, 'driftwood', { clipY: [0, 72], outline: true });
    for (let i = 0; i < 4; i++) c.line(142.8 + i * 1.8, 72, 143.6 + i * 1.3, 69.2, 'driftwood', { s: 0.15 });
    bush(c, 10, 90, 1.1, t, 1); bush(c, 150, 92, 1.3, t, 2); bush(c, 96, 84, 0.7, t, 3);
    gull(c, 40, 20, t, { v: 2 }); gull(c, 120, 14, t + 2, { v: 5, s: 0.8 });
  }

  function lighthouseBack(c, g, t) {
    const lit = g.flag('lit'), b = lit ? beamFor(80, 11, t) : null;
    sky(c, 34, t, { seed: 3, glow: 140, bolt: !lit, beam: b });
    sea(c, 32, 48, t, { seed: 5, beam: b });
    farBoat(c, 30 + Math.sin(T(t) * 0.2) * 3, 40, t);
    grass(c, 46, t, { seed: 11, tufts: 70 });
    c.z = 0.36;
    const lip = [];
    for (let x = 0; x <= 160; x += 2) lip.push([x, 45.4 + Math.sin(x * 0.3) * 0.6 + hash(x, 1, 4) * 0.7]);
    c.poly(lip.concat(lip.map(([x, y]) => [x, y + 2.2]).reverse()), 'stone', { grad: [0.62, 0.32] });
    tufts(c, 45, 48, t, 26, 12);
    // the sandy stair down to the beach, and the path to the door
    c.z = 0.4;
    c.poly([[70, 62], [90, 62], [104, 100], [58, 100]], 'beach', { grad: [0.5, 0.66], dither: true });
    for (let i = 0; i < 5; i++) { const y = 70 + i * 6.4, w = 22 + i * 7; c.rect(80 - w / 2, y, w, 1.2, 'stone', { cyl: true, bias: -0.05 }); c.rect(80 - w / 2, y + 1.2, w, 0.5, 'beach', { flat: true, bias: -0.35 }); }
    // the plinth: stone steps up to the door
    c.z = 0.45;
    c.shadow(80, 62.2, 17, 1.8, 0.5);
    c.rect(66, 56, 28, 6, 'stone', { grad: [0.68, 0.4], outline: true });
    for (let i = 0; i < 6; i++) c.rect(66 + i * 4.8 + (i % 2) * 1.2, 56, 0.34, 6, 'stone', { flat: true, bias: -0.4 });
    c.rect(66, 58.8, 28, 0.34, 'stone', { flat: true, bias: -0.4 });
    c.rect(72, 61, 16, 1.4, 'stone', { cyl: true, bias: 0.05 });
    // the tower
    lighthouse(c, 80, 56.4, 17, 22, 15, lit, t, { outline: true, r: 120 });
    // the door: round-topped, painted, with iron straps
    c.rrect(75, 45.4, 10, 11, 4.6, 'stone', { flat: true, bias: -0.05 });
    c.rrect(76, 46.4, 8, 10, 3.8, 'wood', { grad: [0.55, 0.32], outline: true });
    for (const px of [78, 80, 82]) c.rect(px - 0.17, 46.8, 0.34, 9.4, 'wood', { flat: true, bias: -0.45 });
    for (const sy of [49.4, 53.6]) { c.rect(76.3, sy, 5.4, 0.7, 'iron', { cyl: true }); c.dot(81.4, sy + 0.3, 'iron', 0.8); }
    c.ell(82.6, 51.8, 0.7, 0.7, 'brass', { flat: true, bias: 0.1 }); c.ell(82.6, 51.8, 0.35, 0.35, 'wood', { flat: true, bias: -0.4 });
    // rocks, gorse and a gull
    c.z = 0.5;
    boulder(c, 30, 70.4, 14, 'stone', 1); boulder(c, 130, 66.4, 20, 'stone', 2);
    standingGull(c, 132, 55.6, t);
    bush(c, 20, 90, 1.2, t, 4); bush(c, 148, 90, 1.1, t, 5);
    gull(c, 30, 22, t, { v: 3 });
    if (lit) { c.light(80, 12, 150, LAMP, 0.25 + b.at * 0.45); c.shaft({ kind: 'sweep', x: 80, y: 11, color: LAMP, a: 0.18, speed: 0.9 }); }
  }

  function lampBack(c, g, t) {
    const lit = g.flag('lit'), b = lit ? beamFor(80, 38, t) : null;
    // through the windows: the storm, the sea, and the supper boat out there
    sky(c, 34, t, { seed: 5, glow: 60, bolt: !lit, beam: b, clouds: 8 });
    sea(c, 32, 50, t, { seed: 6, beam: b });
    farBoat(c, 130 + Math.sin(T(t) * 0.5) * 3, 44, t);
    // rain running down the glass
    c.z = 0.3;
    for (let i = 0; i < 46; i++) {
      const x = hash(i, 1, 21) * 160, p = (T(t) * 0.12 * (0.5 + hash(i, 2, 21)) + hash(i, 3, 21)) % 1, y = p * 50, len = 0.8 + hash(i, 4, 21) * 2.4;
      c.line(x, y, x + 0.2, y + len, 'foam', { s: 0.6, w: 0.34 }); c.dot(x + 0.2, y + len + 0.3, 'foam', 0.95);
    }
    // the glazing: astragals and a transom
    c.z = 0.32;
    c.rect(0, 17, 160, 1.2, 'iron', { cyl: true });
    for (let x = 0; x <= 160; x += 40) { c.rect(x - 1.8, 0, 3.6, 50, 'iron', { vcyl: true, outline: true }); c.rect(x - 2.4, 16.4, 4.8, 2.4, 'brass', { cyl: true }); }
    for (let x = 20; x < 160; x += 40) c.rect(x - 0.4, 0, 0.8, 50, 'iron', { vcyl: true });
    // the sill, a brass rail and the iron floor, round like the room
    c.z = 0.4;
    c.rect(0, 48, 160, 6, 'iron', { grad: [0.6, 0.25] });
    c.rect(0, 48, 160, 1, 'brass', { cyl: true });
    c.rect(0, 54, 160, 46, 'iron', { grad: [0.42, 0.66], dither: true });
    for (const R of [36, 56, 82, 112]) {
      let px = 80 - R, py = 62;
      for (let a = 1; a <= 24; a++) { const ang = Math.PI - a * Math.PI / 24, nx = 80 + R * Math.cos(ang), ny = 62 + R * 0.34 * Math.sin(ang); c.line(px, py, nx, ny, 'iron', { s: 0.08 }); px = nx; py = ny; }
    }
    for (let i = 0; i <= 10; i++) { const a = i * Math.PI / 10; c.line(80 + 36 * Math.cos(a), 62 + 12.2 * Math.sin(a), 80 + 130 * Math.cos(a), 62 + 44 * Math.sin(a), 'iron', { s: 0.12 }); }
    for (let i = 0; i < 40; i++) { const a = hash(i, 1, 4) * Math.PI, R = [36, 56, 82][i % 3]; c.dot(80 + R * Math.cos(a) + 1, 62 + R * 0.34 * Math.sin(a) + 0.6, 'iron', 0.85); }
    // the keeper's stool with the log book and a hand lamp, and a coil of rope
    c.z = 0.5;
    c.shadow(22, 78.4, 6, 1, 0.5);
    c.rect(17.6, 72, 1, 6.4, 'wood', { vcyl: true }); c.rect(25.4, 72, 1, 6.4, 'wood', { vcyl: true }); c.rect(21.6, 72.4, 1, 5.6, 'wood', { vcyl: true, bias: -0.2 });
    c.rrect(16.6, 70.6, 10.8, 1.8, 0.6, 'wood', { cyl: true });
    c.rect(18, 69, 5.4, 1.6, 'heather', { cyl: true }); c.rect(18.2, 69.2, 5, 0.4, 'whitewash', { flat: true, bias: 0.1 });
    c.rrect(23.4, 66.6, 2.4, 4, 0.5, 'brass', { vcyl: true }); c.rect(23.8, 67.4, 1.6, 2, 'lensglass', { flat: true, bias: -0.1 });
    c.shadow(136, 82.4, 7, 1.2, 0.5);
    for (let i = 0; i < 4; i++) c.ell(136, 80.6 - i * 0.7, 5.6 - i * 0.6, 1.8 - i * 0.12, 'thatch', { bias: -0.15 + i * 0.08 });
    c.ell(136, 78.5, 2.6, 0.7, 'iron', { flat: true });
    // the lamp: the pedestal, the oil tank with its sight glass, the great lens, the burner
    c.z = 0.52;
    c.shadow(80, 74.4, 30, 3.2, 0.6);
    c.rrect(54, 64, 52, 10, 1.2, 'iron', { cyl: true, outline: true });
    c.rect(54, 64, 52, 1, 'brass', { cyl: true });
    for (let i = 0; i < 9; i++) c.dot(56 + i * 6, 72.6, 'brass', 0.8);
    c.rrect(60, 65.6, 40, 6.6, 1, 'brass', { cyl: true, outline: true });
    c.rrect(68, 66.8, 24, 3.6, 0.8, 'iron', { flat: true, bias: -0.3 });
    if (g.flag('oil_in')) { c.rect(68.6, 67.6, 22.8, 2.4, 'oil', { cyl: true }); c.rect(68.6, 67.6, 22.8, 0.5, 'oil', { flat: true, bias: 0.35 }); }
    else c.rect(68.6, 69.4, 22.8, 0.6, 'oil', { flat: true, bias: -0.3 });
    c.rect(68.4, 67.2, 0.5, 2.8, 'lensglass', { flat: true, bias: 0.4 });
    c.ell(97, 68.8, 1.8, 1.8, 'brass', { rim: true, outline: true }); c.ell(97, 68.8, 0.6, 0.6, 'iron');
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; c.line(97, 68.8, 97 + Math.cos(a) * 1.6, 68.8 + Math.sin(a) * 1.6, 'brass', { s: 0.3 }); }
    c.rrect(58, 60, 44, 4.4, 1, 'iron', { cyl: true, outline: true });
    c.rect(58, 60, 44, 0.8, 'brass', { cyl: true });
    lens(c, g, t, lit);
    if (lit) {
      c.light(80, 38, 170, LAMP, 0.55 + b.at * 0.35); c.light(80, 40, 36, [255, 240, 210], 0.7); c.light(80, 78, 60, LAMP, 0.5);
      c.shaft({ kind: 'sweep', x: 80, y: 38, color: LAMP, a: 0.2, speed: 0.9 });
      c.shaft({ kind: 'cone', x: 80, y: 58, w0: 22, w1: 40, y1: 100, color: LAMP, a: 0.08, flicker: true });
    } else { c.light(30, 14, 70, COLD, 0.3); c.light(130, 14, 70, COLD, 0.3); }
  }
  // the great lens: a barrel of glass prisms in a brass cage, a bullseye drum in the middle, and the burner at its heart
  function lens(c, g, t, lit) {
    const cx = 80, cy = 38, x0 = 63, x1 = 97, y0 = 20, y1 = 57, w = x1 - x0;
    c.z = 0.55;
    c.rrect(x0 - 1.2, y0 - 1.2, w + 2.4, y1 - y0 + 2.4, 4, 'brass', { vcyl: true, outline: true });
    // rings of prisms: each band is round like the barrel, with a bright top edge
    let k = 0;
    for (let y = y0; y < y1 - 0.2; y += 2.4, k++) {
      if (y > cy - 6 && y < cy + 4.2) continue;
      const h = Math.min(2.4, y1 - y);
      if (lit) c.rect(x0, y, w, h, 'glow', { vcyl: true, unlit: true, bias: k % 2 ? -0.12 : 0.04 });
      else c.rect(x0, y, w, h, 'lensglass', { vcyl: true, bias: k % 2 ? -0.12 : 0.02 });
      c.rect(x0, y, w, 0.34, lit ? 'glow' : 'lensglass', lit ? { unlit: true, flat: true, bias: 0.4 } : { flat: true, bias: 0.42 });
      c.rect(x0, y + h - 0.34, w, 0.34, 'brass', { flat: true, bias: lit ? 0.05 : -0.3 });
    }
    // the middle drum and its bullseye
    c.rect(x0, cy - 6, w, 10.2, lit ? 'glow' : 'lensglass', lit ? { vcyl: true, unlit: true, bias: 0.12 } : { vcyl: true, bias: 0.1 });
    c.rect(x0, cy - 6.3, w, 0.6, 'brass', { cyl: true }); c.rect(x0, cy + 3.9, w, 0.6, 'brass', { cyl: true });
    for (const [rx, ry, b] of [[6.4, 4.6, 0], [4.4, 3.2, 0.15], [2.4, 1.8, 0.3]]) c.ell(cx, cy - 1, rx, ry, lit ? 'glow' : 'lensglass', lit ? { unlit: true, rim: true, bias: b + 0.1 } : { rim: true, bias: b });
    // the brass cage
    for (const bx of [x0 + 0.2, 70.5, 89.5, x1 - 1.1]) c.rect(bx - 0.5, y0, 1.1, y1 - y0, 'brass', { vcyl: true, bias: lit ? 0.1 : 0 });
    // the cold glass catches the grey sky
    if (!lit) {
      c.rect(x0 + 2.4, y0 + 1, 1.4, y1 - y0 - 2, 'lensglass', { flat: true, bias: 0.38 });
      c.rect(x1 - 5.6, y0 + 1, 0.7, y1 - y0 - 2, 'lensglass', { flat: true, bias: 0.25 });
      if (Math.floor(T(t) * 0.7) % 4 === 0) { c.dot(x0 + 3, y0 + 4, 'white', 1, true); c.line(x0 + 1.8, y0 + 4, x0 + 4.2, y0 + 4, 'white', { emit: true, w: 0.34 }); c.line(x0 + 3, y0 + 2.8, x0 + 3, y0 + 5.2, 'white', { emit: true, w: 0.34 }); }
    }
    // the top dome, the vent and the bottom ring
    c.ell(cx, y0 - 1, w / 2 + 1, 5, 'brass', { clipY: [0, y0 - 0.8], rim: true, outline: true });
    c.rrect(cx - 3, y0 - 8, 6, 2.6, 1, 'brass', { cyl: true, outline: true });
    c.rrect(cx - 0.8, y0 - 10.4, 1.6, 2.6, 0.6, 'brass', { vcyl: true }); c.ell(cx, y0 - 10.8, 1.2, 1.1, 'brass', { rim: true });
    c.rect(x0 - 2, y1 + 0.6, w + 4, 2.4, 'brass', { cyl: true, outline: true });
    // the burner, seen through the glass: a brass tube up to the wick
    c.rect(cx - 1.2, cy + 1.6, 2.4, y1 - cy - 1, 'brass', { vcyl: true, bias: lit ? 0.15 : -0.3 });
    c.rrect(cx - 2.2, cy + 0.6, 4.4, 1.8, 0.6, 'brass', { cyl: true });
    if (g.flag('wick_in')) for (let i = 0; i < 4; i++) c.ell(cx + (i % 2 ? 0.35 : -0.35), cy - 0.1 - i * 0.6, 0.7, 0.45, i % 2 ? 'knit' : 'whitewash', { bias: 0.1 });
    if (lit) {
      const fl = Math.sin(T(t) * 13) * 0.4 + Math.sin(T(t) * 7.3) * 0.3;
      c.poly([[cx - 1.7, cy - 1], [cx + 1.7, cy - 1], [cx + 1, cy - 4], [cx + fl * 0.6, cy - 7.4 - fl], [cx - 1, cy - 4]], 'lamp', { emit: true });
      c.ell(cx, cy - 2.6, 0.8, 1.4, 'white', { emit: true });
    }
  }

  function beachBack(c, g, t) {
    sky(c, 26, t, { seed: 4, glow: 30 });
    sea(c, 24, 50, t, { seed: 7 });
    // the sand: ripples, pebbles, shells, footprints going up to the steps
    c.z = 0.4;
    c.rect(0, 48, 160, 52, 'beach', { grad: [0.5, 0.66], dither: true });
    for (let k = 0; k < 9; k++) { const yb = 56 + k * 5.2; for (let x = 0; x < 160; x += 3) c.rect(x, yb + Math.sin(x * 0.09 + k) * 1.2, 2.4, 0.34, 'beach', { flat: true, bias: k % 2 ? -0.22 : 0.18 }); }
    for (let i = 0; i < 40; i++) c.ell(hash(i, 1, 14) * 160, 52 + hash(i, 2, 14) * 46, 0.4 + hash(i, 3, 14) * 0.7, 0.3 + hash(i, 4, 14) * 0.3, i % 4 ? 'stone' : 'whitewash', { bias: 0.1 });
    for (let i = 0; i < 8; i++) c.ell(80 + Math.sin(i) * 2 + (i % 2) * 2, 92 - i * 5.4, 0.6, 0.4, 'beach', { flat: true, bias: -0.3 });
    surf(c, 48.4, t);
    // the headland in the middle: a grassy hump rising out of the sand, rocks at its foot, the lighthouse on top and steps cut into it
    c.z = 0.15;
    c.ell(82, 53, 34, 27.4, 'grass', { clipY: [0, 52.4], rim: true, outline: true });
    for (let k = 0; k < 16; k++) {
      const side = k % 2 ? 1 : -1, y = 42 + hash(k, 1, 33) * 10, half = 34 * Math.sqrt(Math.max(0, 1 - Math.pow((53 - y) / 27.4, 2)));
      c.ell(82 + side * (half - 3 - hash(k, 2, 33) * 6), y, 2.6 + hash(k, 3, 33) * 2.6, 1.8 + hash(k, 4, 33) * 1.4, 'stone', { rim: true, bias: side < 0 ? 0.1 : -0.12, clipY: [0, 52.4] });
    }
    tufts(c, 28, 50, t, 40, 13, 58, 106);
    lighthouse(c, 82, 26.6, 4, 10, 7, g.flag('lit'), t, { r: 50 });
    c.z = 0.2;
    for (let i = 0; i < 10; i++) { const y = 29 + i * 2.3, x = 82 + Math.sin(i * 0.7) * 3; c.rect(x - 2.4 - i * 0.25, y, 4.8 + i * 0.5, 0.9, 'stone', { cyl: true, bias: 0.2 }); c.rect(x - 2.4 - i * 0.25, y + 0.9, 4.8 + i * 0.5, 0.5, 'stone', { flat: true, bias: -0.3 }); }
    // sand blown up against its foot
    c.z = 0.38;
    c.poly([[46, 53.4], [56, 50.4], [72, 51.2], [92, 51.2], [108, 50.6], [118, 53.4], [100, 55], [64, 55]], 'beach', { grad: [0.58, 0.52] });
    // a driftwood log half in the sand
    c.z = 0.5;
    c.shadow(68, 97.6, 10, 1, 0.5);
    c.rrect(58, 94.6, 20, 3, 1.4, 'driftwood', { cyl: true });
    c.ell(58.4, 96.1, 1.3, 1.5, 'driftwood', { bias: 0.25 });
    // rocks, one with a gull on it
    boulder(c, 20, 71, 16, 'blackrock', 7); boulder(c, 140, 89, 12, 'stone', 8);
    for (let i = 0; i < 7; i++) c.ell(14 + i * 2, 70.4 - Math.sin(i / 6 * Math.PI) * 1.6, 0.9, 0.5, 'weed', { bias: 0.1 });
    standingGull(c, 21, 63.2, t);
    gull(c, 30, 12, t, { v: 3 }); gull(c, 120, 6, t + 4, { v: 4, s: 0.8 });
  }
  function seaweed(c, g, t) {
    c.z = 0.6;
    c.shadow(113, 81, 12.4, 1.6, 0.55);
    for (const [sx, sy, dx, dy, ph] of [[103, 80, -9, 1.6, 0], [120, 80.2, 8, 1.2, 1], [112, 80.8, 2, 2.2, 2], [106, 80.6, -4, 2.4, 3]]) {
      for (let i = 0; i <= 10; i++) { const u = i / 10; c.ell(sx + dx * u, sy + dy * u + Math.sin(u * 7 + ph) * 0.5, 0.9 - u * 0.3, 0.45, 'kelp', { flat: true, bias: -0.05 + (i % 2) * 0.08 }); }
    }
    for (let i = 0; i < 7; i++) c.ell(103.4 + i * 2.9 + hash(i, 1, 30) * 1.2, 79 - Math.sin(i / 6 * Math.PI) * 1.6 + hash(i, 2, 30), 3.4 + hash(i, 3, 30) * 1.4, 2 + hash(i, 4, 30) * 0.8, 'kelp', { clipY: [0, 81], rim: true, bias: -0.08 + hash(i, 5, 30) * 0.16, outline: true });
    for (let i = 0; i < 14; i++) {
      const x = 103 + hash(i, 1, 31) * 18, y = 76 + hash(i, 2, 31) * 3.6, d = hash(i, 3, 31) - 0.5;
      c.line(x, y, x + d * 4, y + 0.6 + hash(i, 4, 31) * 0.6, i % 4 ? 'kelp' : 'weed', { s: 0.5 + hash(i, 5, 31) * 0.4, w: 0.34 });
    }
    for (let i = 0; i < 10; i++) c.ell(104 + hash(i, 6, 31) * 16, 76.4 + hash(i, 7, 31) * 3.6, 0.6, 0.5, 'kelp', { rim: true, bias: 0.35 });
    if (!g.flag('glasses_found') && Math.floor(T(t) * 1.3) % 3 === 0) { c.dot(110, 77.2, 'white', 1, true); c.line(109.3, 77.2, 110.7, 77.2, 'white', { emit: true, w: 0.34 }); }
    for (let i = 0; i < 4; i++) { const a = T(t) * (3 + i) + i * 2; c.dot(112 + Math.cos(a) * (3 + i), 72 + Math.sin(a * 1.3) * 1.6 - i * 0.6, 'iron', 0); }
  }
  function spectacles(c, g, t) {
    c.z = 0.62;
    c.shadow(110.6, 79.4, 4.4, 0.7, 0.45);
    for (const ex of [108.4, 112.8]) { c.ell(ex, 78.2, 1.9, 1.1, 'tin', O); c.ell(ex, 78.2, 1.5, 0.75, 'lensglass', { flat: true, bias: 0.15 }); c.dot(ex - 0.6, 77.9, 'white', 1); }
    c.line(110.2, 77.9, 111, 77.9, 'tin', { s: 0.7, w: 0.34 });
    c.line(114.8, 77.6, 117.2, 76.6, 'iron', { s: 0.5, w: 0.34 }); c.line(106.4, 77.6, 105, 79.4, 'iron', { s: 0.5, w: 0.34 });
    c.dot(105.6, 78.6, 'whitewash', 0.9);
    if (Math.floor(T(t) * 0.9) % 3 === 0) c.dot(107.6, 77.4, 'white', 1, true);
  }
  function bucket(c, g, t) { // a dented tin bucket, lying on its side
    c.z = 0.6;
    c.shadow(42.6, 90.2, 6.6, 1.1, 0.55);
    c.rrect(38, 84.6, 9, 5.6, 1, 'tin', { cyl: true, outline: true });
    c.rect(40, 84.6, 0.4, 5.6, 'tin', { flat: true, bias: -0.3 }); c.rect(44.4, 84.6, 0.4, 5.6, 'tin', { flat: true, bias: -0.3 });
    c.ell(46.6, 86.6, 0.8, 0.9, 'tin', { flat: true, bias: -0.35 });
    c.ell(38.2, 87.4, 1.7, 2.9, 'tin', { rim: true, outline: true }); c.ell(38.1, 87.4, 1.1, 2.2, 'iron', { flat: true, bias: -0.2 });
    c.line(39, 84.8, 36, 82.6, 'thatch', { s: 0.5, w: 0.4 }); c.line(36, 82.6, 38.4, 90, 'thatch', { s: 0.4, w: 0.4 });
    c.ell(37.4, 90.2, 2.6, 0.6, 'beach', { flat: true, bias: 0.05 });
  }

  function dockBack(c, g, t) {
    sky(c, 30, t, { seed: 6, glow: 100 });
    sea(c, 30, 78, t, { seed: 8 });
    // the shore on the left, curving away
    c.z = 0.38;
    const shore = [];
    for (let y = 30; y <= 80; y += 2) shore.push([5 + (y - 30) * 0.3 + Math.sin(y * 0.4 + T(t) * 0.8) * 0.5, y]);
    c.poly([[0, 30]].concat(shore, [[0, 80]]), 'beach', { grad: [0.42, 0.6], dither: true });
    for (let i = 1; i < shore.length; i++) c.line(shore[i - 1][0], shore[i - 1][1], shore[i][0], shore[i][1], 'foam', { s: 0.7, w: 0.6 });
    c.rect(0, 78, 160, 22, 'beach', { grad: [0.5, 0.66], dither: true });
    for (let i = 0; i < 24; i++) c.ell(hash(i, 1, 15) * 160, 82 + hash(i, 2, 15) * 16, 0.4 + hash(i, 3, 15) * 0.7, 0.3, i % 3 ? 'stone' : 'whitewash', { bias: 0.1 });
    surf(c, 78.4, t);
    // the pier: pilings into the water with foam round them, a deck of planks, a front beam
    c.z = 0.45;
    for (let x = 22; x < 160; x += 16) {
      c.rect(x, 66, 3, 11.4, 'driftwood', { vcyl: true, outline: true });
      c.rect(x, 74.4, 3, 3, 'weed', { vcyl: true, bias: -0.1 });
      const r = Math.sin(T(t) * 1.6 + x) * 0.4; c.ell(x + 1.5, 77.2 + r * 0.3, 3 + r, 0.6, 'foam', { flat: true, bias: -0.1 });
    }
    c.rect(20, 52, 140, 13, 'wood', { grad: [0.36, 0.6], outline: true });
    for (let r = 0; r < 7; r++) {
      const y = 52.4 + r * 1.8, off = hash(r, 1, 16) * 20;
      for (let x = 20 - off; x < 160; x += 20) {
        const xa = Math.max(20.4, x), xb = Math.min(159.6, x + 20);
        if (xb - xa < 0.5) continue;
        c.rect(xa, y, xb - xa, 1.5, 'wood', { flat: true, bias: -0.18 + r * 0.035 + (hash(r, Math.floor(x), 16) - 0.5) * 0.14 });
        c.rect(xa, y, xb - xa, 0.34, 'wood', { flat: true, bias: 0.05 + r * 0.03 });
        c.rect(xa, y, 0.34, 1.5, 'wood', { flat: true, bias: -0.5 });
        c.dot(xa + 0.8, y + 0.8, 'iron', 0.5);
      }
      c.rect(20.4, y + 1.5, 139.2, 0.34, 'wood', { flat: true, bias: -0.55 });
    }
    c.rect(20, 64.6, 140, 2.4, 'wood', { cyl: true, bias: -0.15, outline: true });
    // bollards on the back edge, with rope
    for (const bx of [60, 104, 134]) { c.rect(bx, 47.6, 2.6, 5, 'iron', { vcyl: true, outline: true }); c.ell(bx + 1.3, 47.6, 1.6, 0.7, 'iron', { bias: 0.2 }); }
    c.line(105.3, 50, 108, 66, 'thatch', { s: 0.5, w: 0.4 });
    // the harbour bell on its post, swinging
    c.z = 0.48;
    c.shadow(25, 52.6, 3, 0.7, 0.5);
    c.rect(23.6, 37.6, 1.6, 15, 'driftwood', { vcyl: true, outline: true });
    c.rect(23.6, 38.4, 6.4, 1.2, 'driftwood', { cyl: true, outline: true });
    const a = Math.sin(T(t) * 2.2) * 0.45, px = 28.4, py = 39.6, rot = (u, v) => [px + u * Math.cos(a) - v * Math.sin(a), py + u * Math.sin(a) + v * Math.cos(a)];
    c.poly([[-1.1, 0.4], [1.1, 0.4], [1.6, 3], [2.3, 4.2], [-2.3, 4.2], [-1.6, 3]].map(([u, v]) => rot(u, v)), 'brass', { rim: true, outline: true });
    const cl = rot(Math.sin(T(t) * 2.2 - 0.6) * 0.8, 4.4); c.ell(cl[0], cl[1], 0.5, 0.5, 'iron');
    // the lantern post, lit against the weather
    c.z = 0.48;
    c.shadow(97, 52.6, 3, 0.7, 0.5);
    c.rect(96, 33, 1.8, 19.6, 'iron', { vcyl: true, outline: true });
    c.rect(96.9, 32.4, 4, 0.8, 'iron', { cyl: true });
    c.rrect(98.8, 33.2, 3.4, 4.6, 0.6, 'iron', O);
    c.rect(99.4, 34, 2.2, 3, 'lamp', { emit: true, flat: true });
    c.poly([[98.4, 33.4], [102.6, 33.4], [100.5, 31.6]], 'iron', { flat: true });
    const flk = 0.9 + Math.sin(T(t) * 11) * 0.06;
    c.light(100.5, 36, 46, WARM, 0.75 * flk);
    c.shaft({ kind: 'cone', x: 100.5, y: 37, w0: 1.6, w1: 12, y1: 66, color: WARM, a: 0.07, flicker: true });
    // barrels and a crate of salt fish at the back
    c.z = 0.5;
    c.shadow(147, 62.4, 9.4, 1.4, 0.55);
    for (const bx of [139, 146.6]) {
      c.rrect(bx, 50.4, 7.4, 11.6, 2, 'wood', { vcyl: true, outline: true });
      for (const hy of [52, 59.4]) c.rect(bx, hy, 7.4, 0.8, 'iron', { vcyl: true });
    }
    c.rect(141.6, 43, 10, 7.6, 'wood', { grad: [0.66, 0.42], outline: true });
    c.rect(141.6, 46.4, 10, 0.5, 'wood', { flat: true, bias: -0.4 });
    c.text('SALT', 142.6, 44, 'whitewash', { s: 0.35 });
    // the rowboat, rocking in front of the pier
    const bob = Math.sin(T(t) * 1.5) * 0.6, tilt = Math.sin(T(t) * 1.1) * 0.5;
    c.z = 0.55;
    c.ell(118, 77.8 + bob * 0.3, 16, 1.2, 'sea', { flat: true, bias: -0.3 });
    c.poly([[105, 70.4 + bob - tilt], [131, 70.4 + bob + tilt], [127.4, 77 + bob], [108.6, 77 + bob]], 'teal', { cyl: true, band: [70 + bob, 77 + bob], outline: true });
    c.poly([[105, 70.4 + bob - tilt], [131, 70.4 + bob + tilt], [130.6, 71.8 + bob + tilt], [105.4, 71.8 + bob - tilt]], 'whitewash', { flat: true, bias: -0.1 });
    c.line(106, 73.6 + bob, 129, 73.6 + bob, 'teal', { s: 0.1 });
    c.poly([[105.6, 70.6 + bob - tilt], [130.4, 70.6 + bob + tilt], [127.6, 68.6 + bob + tilt], [108.6, 68.6 + bob - tilt]], 'wood', { flat: true, bias: -0.35 });
    for (const sx of [113, 121]) c.rect(sx, 68.8 + bob, 2.2, 1.6, 'wood', { cyl: true, bias: 0.1 });
    c.line(110, 68.6 + bob, 126, 70.6 + bob, 'driftwood', { w: 0.6, s: 0.6 });
    c.text('MAY', 112, 74.4 + bob, 'whitewash', { s: 0.5 });
    c.ell(118, 77.6 + bob, 13, 0.6, 'foam', { flat: true, bias: -0.15 });
    c.line(131, 70.6 + bob + tilt, 136, 64.6, 'thatch', { s: 0.5, w: 0.4 });
    gull(c, 80, 18, t + 1, { v: 3 }); gull(c, 10, 10, t + 5, { v: 2.4, s: 0.8 });
    standingGull(c, 61.3, 47.4, t);
  }

  function poolsBack(c, g, t) {
    sky(c, 24, t, { seed: 7, glow: 90, clouds: 6 });
    sea(c, 22, 46, t, { seed: 9 });
    // the rock shelf: dark slabs, cracks, weed, barnacles and mussels
    c.z = 0.4;
    c.rect(0, 44, 160, 56, 'blackrock', { grad: [0.42, 0.62], dither: true });
    // rounded lumps of rock, lit on top, with dark cracks between
    for (let i = 0; i < 34; i++) {
      const x = hash(i, 1, 17) * 170 - 5, y = 47 + hash(i, 2, 17) * 52, w = 5 + hash(i, 3, 17) * 10 + (y - 46) * 0.12, h = 1.6 + hash(i, 4, 17) * 1.8 + (y - 46) * 0.03;
      c.ell(x, y + h * 0.5, w * 0.55, h * 0.5, 'blackrock', { flat: true, bias: -0.25 });
      c.ell(x, y, w * 0.5, h, 'blackrock', { clipY: [0, y + h * 0.3], rim: true, bias: -0.05 + hash(i, 5, 17) * 0.1 });
    }
    for (let i = 0; i < 18; i++) { const x = hash(i, 12, 17) * 160, y = 48 + hash(i, 13, 17) * 50; c.line(x, y, x + 3 + hash(i, 14, 17) * 6, y + (hash(i, 15, 17) - 0.5) * 2, 'blackrock', { s: 0 }); }
    for (let i = 0; i < 30; i++) c.ell(hash(i, 6, 17) * 160, 48 + hash(i, 7, 17) * 50, 1.6 + hash(i, 8, 17) * 3, 0.6 + hash(i, 9, 17), 'weed', { bias: 0.05 + (i % 2) * 0.12 });
    for (let i = 0; i < 70; i++) c.dot(hash(i, 10, 17) * 160, 46 + hash(i, 11, 17) * 54, i % 3 ? 'whitewash' : 'navy', i % 3 ? 0.55 : 0.4);
    // surf breaking on the outer edge
    c.z = 0.36;
    for (let x = 0; x < 160; x += 3) { const p = Math.sin(T(t) * 1.4 + x * 0.12); c.ell(x + 1.5, 44.6 - Math.max(0, p) * 1.2, 2.4, 0.8 + Math.max(0, p) * 0.8, 'foam', { bias: -0.1 + p * 0.12 }); }
    for (let i = 0; i < 5; i++) { const p = (T(t) * 0.6 + hash(i, 1, 18)) % 1, sx = hash(i, 2, 18) * 150 + 5; if (p < 0.6) c.ell(sx, 43.4 - p * 6, 1 + p * 3, 0.8 + p * 1.6, 'foam', { unlit: true, bias: -p * 0.6 }); }
    // the little pools: a rim, still water with a bit of sky in it, anemones and a starfish
    c.z = 0.42;
    for (const [x, y, w, h] of [[10, 52, 22, 10], [120, 50, 30, 12], [20, 82, 30, 12], [118, 84, 30, 12]]) tidePool(c, x + w / 2, y + h / 2, w / 2, h / 2, t, x);
    // the big pool, with the flounder and the shrimp
    c.z = 0.45;
    c.ell(76, 70.4, 28.4, 10.4, 'stone', { rim: true, outline: true });
    c.ell(76, 70.4, 25.6, 8.4, 'pool', { grad: [0.62, 0.3], dither: true });
    c.ell(76, 71.4, 21, 6, 'pool', { flat: true, bias: -0.3 });
    for (let i = 0; i < 7; i++) { const kx = 56 + i * 6.4, sw = Math.sin(T(t) * 1.6 + i) * 1.2; c.line(kx, 75.4, kx + sw, 71 + (i % 2), 'weed', { w: 0.5, s: 0.55 }); c.line(kx + sw, 71 + (i % 2), kx + sw * 1.6, 68.8 + (i % 3), 'weed', { w: 0.4, s: 0.7 }); }
    for (let i = 0; i < 9; i++) c.ell(54 + hash(i, 1, 19) * 44, 72 + hash(i, 2, 19) * 4, 0.7, 0.5, 'beach', { flat: true, bias: -0.1 });
    if (!g.flag('fished')) flounder(c, 76 + Math.sin(T(t) * 0.4) * 4, 71.4, t);
    for (let i = 0; i < 6; i++) { const a = T(t) * (0.8 + hash(i, 3, 19)) + i * 1.1; c.dot(76 + Math.cos(a) * (8 + i * 2.2), 70 + Math.sin(a * 1.4) * 3.2, 'rose', 0.8); }
    c.rrect(56, 64.2, 22, 0.8, 0.4, 'skyB', { flat: true, bias: -0.1, unlit: true }); c.rect(82, 65.4, 9, 0.6, 'skyB', { flat: true, bias: -0.2, unlit: true });
    for (let k = 0; k < 2; k++) { const p = (T(t) * 0.3 + k / 2) % 1; c.ell(66 + k * 18, 69 + k * 2, 2 + p * 6, 0.6 + p * 2, 'foam', { flat: true, bias: -0.35 - p * 0.3, clipY: [69 + k * 2 - 0.2 - p * 2, 69 + k * 2 - 0.2 - p * 2 + 0.7] }); }
    // boulders, a starfish on the shelf
    c.z = 0.5;
    boulder(c, 24, 94.4, 14, 'blackrock', 11); boulder(c, 140, 96.4, 12, 'stone', 12);
    starfish(c, 108, 92, 0.3);
    gull(c, 100, 10, t, { v: 3 });
  }
  function tidePool(c, cx, cy, rx, ry, t, seed) {
    c.ell(cx, cy, rx, ry, 'stone', { rim: true });
    c.ell(cx, cy, rx - 1.6, ry - 1.1, 'pool', { grad: [0.6, 0.32], dither: true });
    c.rrect(cx - rx * 0.6, cy - ry * 0.55, rx * 0.8, 0.6, 0.3, 'skyB', { flat: true, bias: -0.15, unlit: true });
    for (let i = 0; i < 4; i++) {
      const ax = cx - rx * 0.6 + hash(i, 1, seed) * rx * 1.2, ay = cy - ry * 0.2 + hash(i, 2, seed) * ry * 0.6, w = Math.sin(T(t) * 2 + i) * 0.3;
      if (i % 2) { c.ell(ax, ay, 0.9, 0.6, 'petal', { bias: 0.1 }); for (let k = -1; k <= 1; k++) c.line(ax + k * 0.5, ay - 0.4, ax + k * 0.8 + w, ay - 1.4, 'petal', { s: 0.8, w: 0.34 }); }
      else c.ell(ax, ay, 0.8, 0.5, 'beach', { bias: -0.1 });
    }
    if (seed % 2 === 0) starfish(c, cx + rx * 0.4, cy + ry * 0.1, 0.25);
  }
  function starfish(c, x, y, s) {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = (i % 2 ? 1.1 : 2.8) * s * 4; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r * 0.55]); }
    c.poly(pts, 'ochre', { outline: true, bias: 0.05 });
    c.dot(x, y, 'oilskin', 0.9);
  }

  function coveBack(c, g, t) {
    sky(c, 24, t, { seed: 8, glow: 80, clouds: 6 });
    sea(c, 22, 47, t, { seed: 10, calm: true });
    // the sand
    c.z = 0.4;
    c.rect(0, 46, 160, 54, 'beach', { grad: [0.52, 0.7], dither: true });
    for (let k = 0; k < 8; k++) { const yb = 54 + k * 5.6; for (let x = 0; x < 160; x += 3) c.rect(x, yb + Math.sin(x * 0.08 + k * 2) * 1.4, 2.2, 0.34, 'beach', { flat: true, bias: k % 2 ? -0.2 : 0.16 }); }
    for (let i = 0; i < 46; i++) c.ell(hash(i, 1, 23) * 160, 50 + hash(i, 2, 23) * 48, 0.4 + hash(i, 3, 23) * 0.7, 0.3 + hash(i, 4, 23) * 0.3, ['stone', 'whitewash', 'rose', 'beach'][i % 4], { bias: 0.1 });
    surf(c, 46.4, t, { calm: true });
    // the cliffs that close the cove in, with strata and grass on top
    c.z = 0.3;
    const left = [[0, 0], [24, 0], [29, 8], [25, 18], [31, 30], [26, 42], [30, 48], [20, 56], [0, 62]];
    const right = [[160, 0], [136, 0], [131, 10], [136, 22], [129, 34], [134, 46], [142, 54], [160, 58]];
    for (const [pts, dir] of [[left, 1], [right, -1]]) {
      c.shadow(dir > 0 ? 18 : 142, dir > 0 ? 59 : 56, 14, 2.4, 0.3);
      c.poly(pts, 'stone', { grad: [0.5, 0.26], outline: true });
      // the face along the inner edge catches the light (the left cliff faces it, the right one is in shade), with ledges
      const inner = pts.slice(1, pts.length - 1), off = inner.map(([x, y]) => [x - dir * 6, y + 1]);
      c.poly(inner.concat(off.slice().reverse()), 'stone', { flat: true, bias: dir > 0 ? 0.14 : -0.04 });
      for (let i = 0; i < inner.length - 1; i++) { const [ax, ay] = inner[i]; c.line(ax, ay, ax - dir * 6, ay + 1, 'stone', { s: dir > 0 ? 0.25 : 0.05 }); }
      for (let i = 0; i < 4; i++) { const y = 12 + i * 10, x = dir > 0 ? 14 : 146; c.ell(x, y, 5, 0.8, 'grass', { flat: true, bias: -0.05 }); }
      for (let k = 0; k < 8; k++) { const y = 5 + k * 6.4; c.line(dir > 0 ? 0 : 160, y + 1.4, dir > 0 ? 16 : 144, y - 0.6 + (k % 2), 'stone', { s: 0.12 }); }
      for (let i = 0; i < 7; i++) { const x = dir > 0 ? 3 + i * 2.6 : 157 - i * 2.6, y = 6 + hash(i, 3, 24) * 36; c.line(x, y, x + (hash(i, 4, 24) - 0.5) * 2, y + 4 + hash(i, 5, 24) * 5, 'stone', { s: 0.05 }); }
      for (let i = 0; i < 6; i++) c.ell(dir > 0 ? 6 + i * 3 : 154 - i * 3, 1 + (i % 2), 2.6, 1.6, 'grass', { bias: -0.05 });
      for (let i = 0; i < 12; i++) c.dot(dir > 0 ? hash(i, 1, 24) * 22 : 160 - hash(i, 1, 24) * 22, 40 + hash(i, 2, 24) * 14, 'whitewash', 0.5);
    }
    // the wet patch, glittering with bits of glass
    c.z = 0.45;
    c.ell(52, 80.4, 22.4, 8.2, 'wetsand', { grad: [0.72, 0.86], dither: true });
    c.ell(52, 80.6, 18, 6, 'wetsand', { grad: [0.5, 0.7], dither: true });
    c.ell(48, 78.4, 11, 1.6, 'storm', { flat: true, bias: 0.1, unlit: true, dither: true });
    const blues = g.flag('glass_found') ? [] : [[44, 82], [60, 79], [54, 85]];
    for (let i = 0; i < 14; i++) {
      const gx = 36 + hash(i, 1, 25) * 32, gy = 75 + hash(i, 2, 25) * 10, m = ['grass', 'ochre', 'whitewash', 'oil'][i % 4];
      c.rrect(gx, gy, 0.9, 0.6, 0.2, m, { bias: 0.15 });
      if ((i + Math.floor(T(t) * 2)) % 6 === 0) c.dot(gx + 0.4, gy - 0.2, 'white', 1, true);
    }
    for (const [bx, by] of blues) { c.rrect(bx, by, 1.2, 0.8, 0.3, 'glass', { bias: 0.3, outline: true }); if (Math.floor(T(t) * 1.5 + bx) % 3 === 0) c.dot(bx + 0.5, by - 0.3, 'cyanlamp', 1, true); }
    // shells, a bottle half buried, a crab shell
    c.z = 0.5;
    for (const [sx, sy] of [[20, 70], [80, 64], [140, 72], [30, 94]]) { c.ell(sx, sy, 1.2, 0.8, 'rose', { rim: true }); for (let k = -1; k <= 1; k++) c.line(sx, sy + 0.6, sx + k * 0.8, sy - 0.6, 'rose', { s: 0.2 }); }
    c.shadow(142, 92.4, 4, 0.7, 0.4); c.rrect(138.6, 89.6, 6, 2.4, 1, 'grass', { cyl: true, bias: 0.1 }); c.rect(144.4, 90.2, 1.6, 1.2, 'grass', { cyl: true }); c.rect(138, 91.2, 7, 1.4, 'beach', { flat: true, bias: 0.06 });
    wreck(c, g, t);
  }
  // the wreck: a boat on its side, planks sprung, ribs showing through the hole, a broken mast with a rag of sail and a gull on top
  function wreck(c, g, t) {
    c.z = 0.55;
    c.shadow(111, 91.6, 24, 2.4, 0.55);
    // the broken mast and its rag
    c.line(101.6, 78, 95, 57, 'driftwood', { w: 1.4, s: 0.55 });
    c.line(96, 61, 112, 66, 'thatch', { s: 0.35, w: 0.34 });
    const f = Math.sin(T(t) * 3.4) * 1.2;
    c.poly([[96.2, 60], [98.4, 67], [103.4 + f, 65.4 + f * 0.3], [101 + f * 0.6, 61.4]], 'whitewash', { bias: -0.2, outline: true });
    standingGull(c, 95.2, 57, t);
    // the hull, lying over: a curved sheer, a pointed bow, planks following the curve, a hole with ribs showing
    const top = [[90, 79], [100, 77.6], [112, 76.2], [122, 74.4], [131, 71]], bot = [[95, 92], [104, 92.4], [116, 91.4], [124, 88], [128, 80]];
    c.poly(top.concat(bot.slice().reverse()), 'driftwood', { cyl: true, band: [71, 92.4], outline: true });
    for (let k = 1; k < 6; k++) {
      const u = k / 6; let prev = null;
      for (let i = 0; i <= 8; i++) {
        const v = i / 8, tx = 90 + v * 41, ty = 79 - v * 8 - Math.sin(v * Math.PI) * 0.6, bx = 95 + v * 33, by = 92 - v * 12 + Math.sin(v * Math.PI) * 1.4;
        const p = [tx + (bx - tx) * u, ty + (by - ty) * u];
        if (prev) c.line(prev[0], prev[1], p[0], p[1], 'driftwood', { s: 0.12 });
        prev = p;
      }
    }
    c.poly(top.concat(top.slice().reverse().map(([x, y]) => [x, y + 1.3])), 'redpaint', { flat: true, bias: -0.12 });
    c.poly([[90, 79], [95, 92], [93.4, 92.2], [89, 80]], 'driftwood', { flat: true, bias: -0.3 });
    c.poly([[103.6, 80.8], [106, 79.2], [108, 80.4], [110.4, 78.8], [113, 79.6], [115, 79.2], [116.4, 82], [115.4, 84.6], [116.6, 86.4], [112, 87.8], [109.4, 86.6], [106.4, 88], [104.6, 85.4], [105, 83]], 'blackrock', { flat: true, bias: -0.12 });
    for (let i = 0; i < 4; i++) { const rx = 106 + i * 2.8; c.line(rx, 79.4, rx - 0.4, 83.4, 'driftwood', { w: 0.6, s: 0.45 }); c.line(rx - 0.4, 83.4, rx + 0.4, 87.4, 'driftwood', { w: 0.6, s: 0.35 }); }
    c.poly([[103.4, 81], [106, 79.8], [104.4, 83.6]], 'driftwood', { flat: true, bias: 0.12 });
    c.poly([[114.2, 79.6], [116.8, 81.2], [115.2, 82.6]], 'driftwood', { flat: true, bias: 0.05 });
    for (let i = 0; i < 8; i++) c.dot(92 + i * 4.6, 78.4 - i * 0.7, 'iron', 0.5);
    // sand drifted up against it
    c.poly([[92, 92.4], [100, 88.6], [118, 88.8], [126, 92], [124, 93.4], [94, 93.6]], 'beach', { grad: [0.68, 0.55] });
  }

  // fine rain over the exposed rooms (sheltered ones get almost none)
  const rainy = (n, seed) => (c, g, t) => rain(c, t, n, seed);

  const items = {
    bucket: { name: 'tin bucket', aliases: ['bucket', 'pail', 'tin bucket'], desc: g => (g.flag('bucket_wet') ? 'A dented tin bucket, wet inside.' : 'A dented tin bucket with a rope handle. It has a smell of old fish.') },
    fish: { name: 'flounder', aliases: ['fish', 'flounder', 'fresh fish'], desc: 'A fat, fresh flounder, flapping a little in the bucket.', food: 'You eat the whole flounder raw. It was rather good, but you suspect somebody was waiting for it.' },
    glasses: { name: 'spectacles', aliases: ['spectacles', 'glasses', 'specs', 'hermits spectacles', 'eyeglasses'], desc: 'A pair of small round spectacles with one cracked arm, held together with fishing line.' },
    glass: { name: 'blue sea glass', aliases: ['glass', 'sea glass', 'blue glass', 'bottle glass', 'shard'], desc: 'A piece of bottle glass worn smooth by the sea, blue as a summer sky.' },
    oil: { name: 'can of oil', aliases: ['oil', 'can', 'lamp oil', 'oil can', 'can of oil'], desc: 'A heavy tin can of lamp oil. It smells like fish.', verbs: { drink: g => g.die('You drink the lamp oil. It tastes like a candle that has been lying in a harbour. You do not recover.') } },
    wick: { name: 'braided wick', aliases: ['wick', 'braid', 'yarn', 'braided wick'], desc: 'A thick braided wick of cotton and wool, as long as your arm.' },
    matches: { name: 'box of matches', aliases: ['matches', 'match', 'matchbox', 'box', 'box of matches'], desc: 'A tin box of dry matches, with a picture of a ship on the lid.' },
  };

  const rooms = {
    // ---------------------------------------------------------------- the village
    village: {
      name: 'Gullrock Village', horizon: 44, exits: { e: 'beach', n: 'cliff' },
      desc: 'Gullrock, a handful of little cottages on a hill above the harbour, under a heavy grey sky. Granny Gull sits knitting on a bench. A notice is pinned to a board. The beach is east, the cliff path north.',
      listen: 'Wind, gulls, and the harbour bell ringing, over and over.',
      look: 'overcast', back: villageBack, front: rainy(36, 1),
      objects: [
        { id: 'granny', name: 'Granny Gull', aliases: ['granny', 'gull', 'woman', 'old woman', 'old lady', 'granny gull', 'knitter'], rect: [98, 62, 22, 24], at: [100, 90], base: 86,
          draw: granny,
          desc: 'Granny Gull, the oldest person in the village, knitting something very long and very red.',
          verbs: {
            talk(g) {
              if (g.flag('gave_glass')) return g.say('"Bless you, dear. Go and light that lamp."');
              if (!g.flag('met_granny')) { g.set('met_granny'); return g.say('"The lamp is out and the keeper\'s abed with the fever, the poor lamb. And the supper boat out there with the little ones aboard. You\'ll want a wick, dear. The old one rotted. I braid a good one, but I\'m out of the thing I use to tie the ends: a bit of blue glass. The sea washes it up in the cove, but I can\'t go down there with these knees."'); }
              g.say(g.has('glass') ? '"Is that blue glass? Give it here, dear!"' : '"A bit of blue sea glass from the cove, dear. Then I\'ll braid your wick."');
            },
            give: {
              glass(g) { g.lose('glass'); g.give('wick'); g.set('gave_glass'); g.score(15, 'wick'); g.say('"Oh, that\'s a lovely one." Her needles click and her fingers fly. In a minute there is a thick braided wick in your hand, as long as your arm. "Off you go now, dear. Quick as you can."'); },
              '*': '"No, dear. That\'s not what I need."',
            },
            attack: 'Granny Gull lifts a knitting needle. You lower your fist.', kiss: '"Oh, you cheeky thing." She pats your cheek, and drops a stitch.',
          } },
        { id: 'notice', name: 'notice board', aliases: ['notice', 'board', 'sign', 'poster', 'notices'], rect: [24, 56, 28, 12], at: [38, 80],
          desc: 'STORM WARNING. All boats to harbour by dark. SUPPER BOAT STILL OUT. KEEPER TAM ILL; APPRENTICE TO LIGHT THE LAMP. A smaller note says: Oil: ask Barnaby at the dock. Matches: the hermit has some.' },
        { id: 'cottages', name: 'cottages', aliases: ['cottage', 'houses', 'house', 'door', 'doors'], rect: [8, 42, 30, 22], at: [24, 70], desc: 'Everyone is down at the harbour. The doors are shut and the shutters are up.', verbs: { open: 'Locked. Everyone is at the harbour.', push: 'Locked. Everyone is at the harbour.', talk: 'Nobody answers.' } },
      ],
    },

    // ---------------------------------------------------------------- the cliff
    cliff: {
      name: 'Cliff Path', horizon: 42, exits: { s: 'village', e: 'lighthouse' },
      desc: 'A windy path along the top of a cliff. A hermit sits on a rock beside a tiny hut, peering at nothing. The lighthouse is east.',
      blocks: [[0, 42, 160, 8], [48, 62, 24, 12]],
      listen: 'The wind. The waves, a long way down.',
      look: 'gale', back: cliffBack, front: rainy(60, 2),
      objects: [
        { id: 'hermit', name: 'hermit', aliases: ['old man', 'man', 'beard', 'old hermit'], rect: [48, 50, 24, 24], at: [56, 82], base: 76,
          draw: hermit,
          desc: 'A hermit with a beard to his belt, squinting at the sea. He keeps looking at things a foot to the left of where they are.',
          verbs: {
            talk(g) {
              if (g.flag('gave_glasses')) return g.say('"Now I can see the sea. It is bigger than I remembered. Thank you."');
              if (!g.flag('met_hermit')) { g.set('met_hermit'); return g.say('"Who\'s that? You\'re a blur. Oh, the apprentice. You want matches? I have matches. I also have no spectacles. I lost them on the beach feeding the gulls, and without them I cannot find where I keep the matches. Bring me my spectacles and I\'ll give you a box."'); }
              g.say(g.has('glasses') ? '"Are those my spectacles? Hand them over, hand them over!"' : '"My spectacles. On the beach. Possibly under something."');
            },
            give: {
              glasses(g) { g.lose('glasses'); g.give('matches'); g.set('gave_glasses'); g.score(15, 'matches'); g.say('The hermit puts them on, and blinks, and sees you for the first time. "A child. Good heavens. And what a lot of sea!" He fumbles in his hut and presses a box of matches into your hand. "Don\'t waste them."'); },
              '*': '"That is not my spectacles."',
            },
            attack: 'The hermit does not see it coming, and you do not do it.', kiss: '"Ah! A gull." You back away.',
          } },
        { id: 'edge', name: 'cliff edge', aliases: ['edge', 'cliff', 'drop', 'sea', 'ocean', 'waves'], rect: [0, 42, 160, 10], at: [30, 60],
          desc: 'A very long way down to some very hard rocks.', verbs: { swim: g => g.die('You jump off the cliff. This is the sort of swimming that is better done from a beach. The rocks agree.'), climb: g => g.die('You climb down the cliff. It goes well for the first three feet.'), enter: g => g.die('You step off the cliff, and it turns out the sea is not in the mood.') } },
        { id: 'hut', name: 'hut', aliases: ['hermit hut', 'door', 'shed'], rect: [110, 52, 32, 20], at: [126, 78], desc: 'A tiny driftwood hut, the sort of thing one builds if one has not been to a village for a decade.', verbs: { open: 'The hermit mutters, "Not in there! I cannot see where anything is!"', enter: 'The hermit mutters, "Not in there! I cannot see where anything is!"', push: 'The hermit mutters, "Not in there! I cannot see where anything is!"' } },
      ],
    },

    // ---------------------------------------------------------------- the lighthouse
    lighthouse: {
      name: 'Lighthouse', horizon: 44, exits: { w: 'cliff', s: 'beach' }, exitZones: { s: [60, 104] },
      desc: 'The Gullrock lighthouse stands tall and cold, with its great lamp dark. The door at the bottom is not locked. The cliff path goes west, and a stairway of sandy steps runs south to the beach.',
      blocks: [[66, 40, 28, 22]],
      look: 'gale', back: lighthouseBack, front: rainy(55, 3),
      objects: [
        { id: 'door', name: 'lighthouse door', aliases: ['door', 'wooden door', 'tower door', 'lighthouse', 'tower', 'stairs'], rect: [74, 48, 12, 14], at: [80, 68],
          desc: 'A round-topped wooden door at the foot of the tower. There are one hundred and twelve steps behind it. You know, you have counted.',
          verbs: { open: g => { g.say('You climb the one hundred and twelve steps, counting out loud. At the top, you stop, breathe, and look at the lamp.'); g.goto('lamproom', 80, 90); }, enter: g => g.act('open', 'door'), push: g => g.act('open', 'door'), climb: g => g.act('open', 'door') } },
        { id: 'tower', name: 'tower', aliases: ['white tower', 'striped tower'], rect: [66, 4, 28, 44], at: [80, 68], desc: 'A tall tower striped red and white. At the very top, the lamp room is dark.', verbs: { climb: g => g.act('open', 'door'), push: 'It does not budge. It has stood for two hundred years.' } },
      ],
    },

    // ---------------------------------------------------------------- the lamp room
    lamproom: {
      name: 'The Lamp Room', horizon: 52, exits: { s: 'lighthouse' }, exitAt: { s: [80, 70] }, oneWay: ['s'],
      desc: g => {
        const need = [];
        if (!g.flag('oil_in')) need.push('oil'); if (!g.flag('wick_in')) need.push('a wick'); if (!g.has('matches')) need.push('a light');
        return 'The lamp room at the top of the tower. A great glass lens as tall as you stands over an iron lamp. Out the windows is a grey sea and a storm coming in, and far away, a small boat. ' +
          (g.flag('lit') ? 'The lamp is burning.' : need.length ? 'The lamp needs ' + need.join(', ') + '.' : 'The lamp is ready to light.');
      },
      blocks: [[54, 52, 52, 22]],
      listen: 'The wind sings through the windows. It is a long way up.',
      look: 'lamp', back: lampBack,
      objects: [
        { id: 'lamp', name: 'lamp', aliases: ['lantern', 'oil lamp', 'big lamp', 'iron lamp', 'lens', 'glass', 'wick holder', 'reservoir', 'tank', 'light'], rect: [54, 14, 52, 62], at: [80, 84],
          desc: g => {
            if (g.flag('lit')) return 'The lamp burns, and the lens turns it into a beam that sweeps over the sea.';
            const s = ['The great lamp of Gullrock, cold and dark. The oil reservoir is ' + (g.flag('oil_in') ? 'full' : 'empty') + ', and the wick holder is ' + (g.flag('wick_in') ? 'filled with a fresh braided wick.' : 'bare.')];
            return s.join('');
          },
          verbs: {
            use: {
              oil(g) { if (g.flag('oil_in')) return g.say('The reservoir is already full.'); g.lose('oil'); g.set('oil_in'); g.score(10, 'oil_in'); g.say('You pour the oil into the reservoir. It gurgles and glugs and settles, golden and strong-smelling.'); },
              wick(g) { if (g.flag('wick_in')) return g.say('There is a wick in there already.'); g.lose('wick'); g.set('wick_in'); g.score(10, 'wick_in'); g.say('You feed the braided wick up through the holder and trim it with your thumbnail. It sits just right.'); },
              matches(g) { g.act('light', 'lamp'); },
              fish: 'The lamp does not want a fish. It is that sort of lamp.',
              bucket: 'You stare at the bucket and at the lamp, and you can see no way these two are related.',
              '*': 'That does not go in the lamp.',
            },
            light(g) {
              if (g.flag('lit')) return g.say('It is already burning.');
              if (!g.has('matches')) return g.say('You have nothing to light it with.');
              if (!g.flag('oil_in')) return g.say('You strike a match and hold it to the wick, but the reservoir is empty and there is nothing to burn. The match goes out.');
              if (!g.flag('wick_in')) return g.say('You strike a match, but there is no wick. The flame has nothing to hold on to, and it burns your fingers.');
              g.set('lit'); g.score(15, 'lit');
              g.win('The wick catches. The flame grows. The great lens takes it, turns it, and throws a beam as bright as day out across the black water. Far out, a boat blows its whistle, once, twice, and turns for the harbour. When the supper boat bumps the quay, forty children and one very wet dog cheer so loudly you can hear them from the tower. The keeper, in his bed with the fever, hears it, and smiles, and goes to sleep.');
            },
            take: 'It weighs more than a horse.', push: 'It does not move. It is bolted to the floor.', drink: g => g.die('You drink from the oil reservoir. Why you thought this was a good idea is between you and the oil.'),
            climb: 'You climb on the lamp for a better look. The lamp is not at all keen on this, and you climb down.',
          } },
        { id: 'window', name: 'window', aliases: ['windows', 'sea', 'boat', 'storm', 'supper boat', 'ship'], rect: [0, 0, 160, 52], at: [80, 84],
          desc: 'Out in the grey sea, a small boat is being thrown about. That is the supper boat. It will not find the harbour in the dark without the light.', verbs: { open: 'The window is stuck shut with salt. The wind is shoving at it from the outside.', climb: g => g.die('You climb out of the window. It is a very, very long way down. At least the view is good.') } },
      ],
    },

    // ---------------------------------------------------------------- the beach
    beach: {
      name: 'Beach', horizon: 46, exits: { w: 'village', e: 'dock', s: 'tidepools', n: 'lighthouse' }, exitZones: { n: [60, 104] },
      desc: 'A grey beach under a darkening sky. A heap of seaweed lies by the rocks, and a tin bucket lies in the sand. A path goes up to the lighthouse. Beyond the beach, the sea goes on. The village is west, the dock is east, and tide pools lie to the south.',
      blocks: [[0, 46, 58, 4], [106, 46, 54, 4]],
      listen: 'The surf, and the harbour bell.',
      look: 'overcast', back: beachBack, front: rainy(36, 4),
      objects: [
        { id: 'seaweed', name: 'seaweed', aliases: ['weed', 'kelp', 'pile', 'heap', 'seaweed pile', 'heap of seaweed'], rect: [100, 66, 24, 14], at: [106, 84], base: 82,
          draw: seaweed,
          desc: g => (g.flag('glasses_found') ? 'A heap of stinking seaweed.' : 'A big heap of seaweed, with flies. Something small glints in it.'),
          verbs: {
            search(g) { if (g.flag('glasses_found')) return g.say('Nothing else but flies.'); g.set('glasses_found'); g.say('You dig through the seaweed with a stick. It is as bad as it sounds. In the middle lies a pair of small round spectacles with a cracked arm.'); },
            take(g) { g.act('search', 'seaweed'); }, eat: 'No. Absolutely not.', smell: 'It smells like a low tide that has gone off.', climb: 'You are not in the mood.',
          } },
        { id: 'glasses', item: 'glasses', name: 'spectacles', aliases: ['glasses', 'specs'], show: g => g.flag('glasses_found'), rect: [108, 74, 10, 6], at: [112, 86], base: 82,
          draw: spectacles, desc: 'A pair of small round spectacles.', takeMsg: 'You pick up the spectacles and wipe them on your sleeve. They are a bit seaweedy.', points: 5 },
        { id: 'bucket', item: 'bucket', name: 'tin bucket', aliases: ['bucket', 'pail'], rect: [36, 80, 12, 10], at: [42, 92], base: 90,
          draw: bucket, desc: 'A dented tin bucket, lying on its side.', takeMsg: 'You pick up the bucket and shake the sand out.', points: 3 },
        { id: 'sea', name: 'sea', aliases: ['water', 'ocean', 'waves', 'surf', 'tide'], rect: [0, 24, 160, 24], at: [30, 60],
          desc: 'The sea, grey and heaving. It does not look friendly today.', verbs: { swim: g => g.die('You wade in and start swimming. The sea takes you out much further than you meant to go. You were a very brave swimmer for about a minute.'), enter: g => g.die('You wade into the sea. The undertow wades back.'), drink: 'Salt. Blech.', climb: 'There is nothing to climb but water.' } },
      ],
    },

    // ---------------------------------------------------------------- the dock
    dock: {
      name: 'Dock', horizon: 48, exits: { w: 'beach', s: 'cove' },
      desc: 'A wooden dock with a fisherman sitting on a barrel, fiddling with a rod. A fat ginger cat is looking at him very carefully. A little rowboat rocks at the end of the dock. The beach is west and the cove is south.',
      blocks: [[20, 48, 140, 4], [20, 66, 140, 12]],
      listen: 'Ropes creaking, water slapping on the piles, and the harbour bell.',
      look: 'overcast', back: dockBack, front: rainy(40, 5),
      objects: [
        { id: 'barnaby', name: 'Barnaby', aliases: ['fisherman', 'man', 'old man', 'barnaby', 'angler'], rect: [38, 40, 22, 28], at: [50, 62], base: 64,
          draw: barnaby,
          desc: 'Barnaby, the harbour fisherman, as wide as he is tall, with a hat that has seen things.',
          verbs: {
            talk(g) {
              if (g.flag('gave_fish')) return g.say('"Biscuit is delighted. She has not been this nice to me since Tuesday."');
              if (!g.flag('met_barnaby')) { g.set('met_barnaby'); return g.say('"Oil? For the lamp? Aye, I\'ve a can, and I\'ll gladly give it. But Biscuit there has had nothing but my old catch for a week and she\'s given me the look. She\'ll only eat a fresh one. The tide pools are full of flounder, but I can\'t get down those rocks with my knees. Bring me one fresh, and the oil is yours."'); }
              g.say(g.has('fish') ? '"That\'s a lovely fish, lad. Give it here!"' : '"A fresh flounder, lad. From the tide pools. Mind the crab."');
            },
            give: {
              fish(g) { g.lose('fish'); g.give('oil'); g.set('gave_fish'); g.score(15, 'oil'); g.say('Barnaby holds the flounder up. Biscuit leaps onto the barrel, takes it in one lunge and goes away to enjoy it behind a crate. "Aye, that did it." He hands you a heavy tin can of lamp oil. "Go on, lad. Be quick."'); },
              '*': '"No, lad, I want a fish."',
            },
            attack: 'Barnaby picks you up by the collar, puts you down again, and goes back to his rod.', kiss: '"Steady on, lad."',
          } },
        { id: 'cat', name: 'cat', aliases: ['biscuit', 'ginger cat', 'kitty', 'fat cat'], rect: [64, 50, 18, 14], at: [70, 64], base: 64,
          draw: cat,
          desc: 'A very large ginger cat called Biscuit. She is looking at the fisherman as if he owes her money.', verbs: { talk: 'Biscuit says "mrrp." You think it means: fish.', kiss: 'Biscuit allows this for about a second, then gives you a look.', attack: 'Biscuit shows you every claw she has. You decide not to.', take: 'Biscuit goes soft and then goes very hard, all at once, and you let go.', give: { fish: 'The cat looks at it with deep interest. Barnaby clears his throat. Perhaps it should go to him.', '*': 'Biscuit sniffs it and turns her back.' } } },
        { id: 'boat', name: 'rowboat', aliases: ['boat', 'little boat', 'skiff', 'dinghy'], rect: [104, 64, 28, 16], at: [108, 64],
          desc: 'A little rowboat, tied up with a rope. It looks as if it likes the shelter of the dock.', verbs: { enter: g => g.die('You climb into the rowboat and push off. The waves are bigger than they looked from the dock. You are not the first person to row out toward a storm, but you may be the last for this evening.'), climb: g => g.act('enter', 'boat'), take: 'It is too big to carry.', push: 'It does not need your help.', pull: 'It is tied to the dock, and that is how it likes it.' } },
        { id: 'crate', name: 'barrel', aliases: ['barrels', 'crate', 'crates'], rect: [138, 42, 16, 20], at: [146, 64], desc: 'Barrels of salt fish. They smell, and they are not for you.', verbs: { open: 'You lift the lid. A great wave of old fish rolls out. You close it again, quickly.', search: 'Only salt fish. Not fresh.' } },
      ],
    },

    // ---------------------------------------------------------------- the tide pools
    tidepools: {
      name: 'Tide Pools', horizon: 44, exits: { n: 'beach', e: 'cove' },
      desc: 'A shelf of black rock with tide pools full of little lives. The biggest pool has a fat flounder in it. A crab the size of a dinner plate sits at the edge of it, watching you.',
      blocks: [[48, 60, 54, 20]],
      listen: 'Dripping, trickling and the sea sighing on the rocks.',
      look: 'shelter', back: poolsBack, front: rainy(14, 6),
      objects: [
        { id: 'pool', name: 'tide pool', aliases: ['pool', 'big pool', 'water', 'pools', 'rock pool', 'tidepool', 'flounder', 'fish'], rect: [48, 60, 56, 20], at: [76, 86],
          desc: g => (g.flag('fished') ? 'A tide pool, now fishless. Little shrimp dart about.' : 'A deep tide pool with a fat flounder swimming around. A big crab is guarding the near edge.'),
          verbs: {
            use: {
              bucket(g) {
                if (g.flag('fished')) return g.say('There are only shrimp left.');
                g.set('fished'); g.set('bucket_wet'); g.lose('bucket'); g.give('fish'); g.score(7, 'fish');
                g.say('You dip the bucket in at the far end, where the crab is not looking, and sweep it slowly toward the flounder. A flick of the tail, a splash, and the fish is in the bucket. You carry the lot off, bucket and flounder.');
              },
              '*': 'That does not catch fish.',
            },
            take: g => g.die('You reach into the pool to grab the flounder with your bare hand. The crab has been waiting all afternoon for exactly this.'),
            search: 'There is a fat flounder, some shrimp, and a very watchful crab.', drink: 'It is salt water. Do not.', swim: 'It is a puddle. You could not swim in it if you tried.',
            enter: 'You put a foot in. It is cold. You take it out again.', eat: 'You would have to catch something first.',
          } },
        { id: 'crab', name: 'crab', aliases: ['big crab', 'giant crab', 'red crab'], rect: [92, 62, 20, 12], at: [100, 86], base: 80,
          draw(c, g, t) { if (!g.flag('fished')) crab(c, 98, 74, t); }, show: g => !g.flag('fished'),
          desc: 'A crab as big as a dinner plate, with one claw bigger than the other, and a look of great and personal interest in your fingers.',
          verbs: { take: g => g.die('You pick up the crab. The crab picks up your finger, and then the rest of you goes along.'), attack: g => g.die('You attack the crab. The crab is delighted. It is the best afternoon it has had in years.'), kiss: g => g.die('You lean in to kiss the crab. The crab has views.'), talk: 'The crab clicks its claw. You think this means no.', give: { '*': 'The crab considers it, and takes it, and nothing else happens. That was close.' } } },
      ],
    },

    // ---------------------------------------------------------------- the cove
    cove: {
      name: 'Hidden Cove', horizon: 46, exits: { w: 'tidepools', n: 'dock' },
      desc: 'A small, hidden cove, sheltered from the wind, with a wrecked boat lying in the sand. A patch of wet sand glitters with bits of broken glass.',
      listen: 'The sea. The wind, from far away.',
      look: 'shelter', back: coveBack, front: rainy(8, 7),
      objects: [
        { id: 'sand', name: 'wet sand', aliases: ['sand', 'glass', 'patch', 'wet patch', 'shards', 'broken glass', 'beach'], rect: [32, 72, 40, 16], at: [52, 92],
          desc: g => (g.flag('glass_found') ? 'Wet sand with bits of glass in it. All the blue ones are gone.' : 'A patch of wet sand with little bits of glass glinting in it, green, brown, clear, and here and there, blue.'),
          verbs: {
            dig(g) {
              if (g.flag('glass_found')) return g.say('You dig and dig, and find no more blue glass.');
              g.set('glass_found'); g.give('glass'); g.score(5, 'glass'); g.emit('take');
              g.say('You dig through the wet sand with your fingers. Most of it is brown glass and bottle bits, but near the bottom there is a smooth blue piece, worn round as a coin. Perfect.');
            },
            search(g) { g.act('dig', 'sand'); }, take(g) { g.act('dig', 'sand'); }, eat: 'It is sand.',
          } },
        { id: 'wreck', name: 'wrecked boat', aliases: ['wreck', 'boat', 'hull', 'old boat', 'broken boat', 'wrecked rowboat'], rect: [88, 54, 44, 40], at: [84, 94],
          desc: 'An old boat, with a hole in its side big enough to crawl through. It has been here for years. There is nothing in it but sand and a crab shell.',
          verbs: { search: 'You poke about. Sand, and a crab shell, and a very old boot.', open: 'It is already open, in more ways than one.', enter: 'You climb in and out again. It is exactly as exciting as it looks.', climb: 'You climb in and out again. It is exactly as exciting as it looks.', take: 'It weighs as much as a house.' } },
        { id: 'water', name: 'sea', aliases: ['ocean', 'waves', 'surf', 'water'], rect: [20, 22, 120, 24], at: [60, 60], desc: 'The sea, kinder here, but still the sea.', verbs: { swim: g => g.die('You swim out from the cove. The cove is calm. The sea behind it is not. You are discovered by the gulls.'), enter: g => g.die('You wade out of the cove and the sea gets hold of you.') } },
      ],
    },
  };

  const def = {
    id: 'gullrock', title: 'The Lamp at Gullrock', maxScore: 100,
    start: { room: 'village', x: 60, y: 90 },
    intro: 'The lamp at Gullrock lighthouse is out. The keeper is in bed with a fever, and a storm is coming in off the sea. Out there, in the grey, is the supper boat with every child in the village on it. You are the keeper\'s apprentice, and you are the only one who can light the lamp. To light it, you need three things: oil, a wick, and a light. You have about one afternoon.',
    help: 'Walk with the arrow keys, or click where you want to go. Type what you want to do: look, look at the pool, take bucket, talk to Barnaby, give fish to Barnaby, use oil on lamp, dig sand, search seaweed. Say "inventory" to see what you carry. Talk to everyone, and look at everything. The sea is not friendly. Things here can kill you, and you can always try again.',
    hd: { hero: apprentice },
    items, rooms,
    onStart(g) { g.say('The harbour bell is ringing. The supper boat is still out. Talk to the people of Gullrock, and find what you need to light the lamp.'); },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = def; else root.GULLROCK = def;
})(typeof window !== 'undefined' ? window : globalThis);
