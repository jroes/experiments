/*
 * Star Sweeper: a small science-fiction adventure for the engine in shared/adventure.js.
 * You are the junior custodian on the research ship Pemberton. You slept through the evacuation. The crew took the pods, the reactor is
 * going bad, and there is one pod left. Get off the ship, cross a desert planet, and buy a ride home. Original story, text and art.
 *
 * The pictures are HD-2D (shared/hd2d.js): fine pixel art at three times the world size, lit by the room's lamps. Every number in the
 * art is still in world units (160 x 100), so it lines up with the rects and walking. Each room picks a look: golden (a low sun),
 * mystery (lights mostly out), diorama (a tiny model, for the wide desert views), neon (the bar) or the plain hd2d.
 *
 * Verb names used by handlers: look search take drop open close use give talk push pull climb enter swim eat drink wear light play attack cut kiss tie dig clean
 */
(function (root) {
  'use strict';
  const HD = typeof require !== 'undefined' ? require('../shared/hd2d.js') : root.HD2D;
  const hash = HD.hash;

  const FARE = 75;
  const LAMP = [255, 207, 122], COLD = [170, 210, 255], CYAN = [111, 227, 242], RED = [255, 77, 94], SUN = [255, 190, 110], GREEN = [120, 240, 110], PINK = [255, 79, 168];
  const on = (t, rate, ph) => Math.floor((t || 0) * rate + (ph || 0)) % 2 === 0;
  const O = { outline: true }; // things you can use get a dark edge

  // ---------------------------------------------------------------- scenery pieces
  function space(c, x, y, w, h, t, seed) {
    c.z = 0;
    c.rect(x, y, w, h, 'space', { grad: [0.1, 0.85], unlit: true, dither: true });
    c.ell(x + w * 0.3, y + h * 0.45, w * 0.24, h * 0.32, (px, py) => (hash(Math.floor(px * 1.5), Math.floor(py * 3), seed) < 0.35 + 0.3 * Math.sin(px * 0.3 + py * 0.4) ? 'nebula' : 'space'), { flat: true, bias: -0.2, unlit: true });
    c.stars(x, y, w, h, seed, t, 0.004);
  }
  function planet(c, x, y, r, t) {
    c.ell(x, y, r, r, (px, py, nx, ny) => (Math.sin(ny * 9 + Math.sin(nx * 3 + 1.3) * 1.2 + (t || 0) * 0.05) > 0.45 ? 'band' : 'planet'), { rim: true, unlit: true });
    c.light(x, y, r * 2.6, [255, 160, 90], 0.3);
  }
  // a window onto space: the frame, struts and the glass shine
  function viewport(c, x, y, w, h, t, o) {
    o = o || {};
    space(c, x, y, w, h, t, o.seed || 3);
    if (o.planet) planet(c, o.planet[0], o.planet[1], o.planet[2], t);
    if (o.moon) c.ell(o.moon[0], o.moon[1], 2, 2, 'moon', { unlit: true });
    if (o.sun) { c.ell(o.sun[0], o.sun[1], 2.6, 2.6, 'sunlamp', { emit: true }); c.sunAt(o.sun[0], o.sun[1]); c.light(o.sun[0], o.sun[1], 160, SUN, 0.7); }
    c.z = 0.12;
    c.rect(x - 2, y - 2, w + 4, 2, 'frame'); c.rect(x - 2, y + h, w + 4, 2.5, 'frame');
    c.rect(x - 2, y - 2, 2, h + 4, 'frame', { vcyl: true }); c.rect(x + w, y - 2, 2, h + 4, 'frame', { vcyl: true });
    for (const k of o.struts || []) c.rect(x + w * k - 1, y - 2, 2, h + 4, 'frame', { vcyl: true });
  }
  function wallPanels(c, x, y, w, h, o) {
    o = o || {};
    c.rect(x, y, w, h, o.mat || 'wall', { grad: o.grad || [0.6, 0.3] });
    for (let i = x + (o.step || 16); i < x + w; i += o.step || 16) c.rect(i, y, 0.34, h, 'frame', { flat: true, bias: -0.3 });
    if (o.seam) c.rect(x, y + o.seam, w, 0.34, 'frame', { flat: true, bias: -0.3 });
    for (let i = x + 3; i < x + w; i += o.step || 16) for (const ry of [y + 2, y + h - 2]) c.dot(i, ry, 'wall', 0.95);
  }
  function floor(c, y0, mat, vx, o) {
    o = o || {};
    c.z = 0.42;
    c.rect(0, y0, 160, 100 - y0, mat, { grad: o.grad || [0.32, 0.72] });
    for (let i = 1; i < 7; i++) { const y = y0 + i * i * 0.9 + i * 1.6; if (y < 100) c.rect(0, y, 160, 0.34, mat, { flat: true, bias: -0.45 }); }
    for (let i = -8; i <= 8; i++) c.line(vx + i * 9, y0, vx + i * 26, 100, mat, { s: 0.15 });
  }
  function hazard(c, x, y, w, h) { c.rect(x, y, w, h, (px) => (Math.floor(px / 2.4) % 2 ? 'hazard' : 'dark'), { flat: true }); }
  // a ceiling lamp that lights the room and throws a cone
  function lamp(c, x, y, rgb, o) {
    o = o || {};
    c.z = 0.2;
    c.rect(x - 5, y - 2, 10, 2, 'frame', { cyl: true });
    c.rect(x - 4, y, 8, 1, o.off ? 'frame' : 'lamp', { emit: !o.off, flat: true });
    if (o.off) return;
    c.light(x, y + 4, o.r || 70, rgb || LAMP, o.i || 0.85);
    c.shaft({ kind: 'cone', x, y: y + 1, w0: 4, w1: o.w1 || 22, y1: o.y1 || 100, color: rgb || LAMP, a: o.a === undefined ? 0.1 : o.a, flicker: o.flicker });
  }
  function siren(c, x, y, t, o) {
    const lit = on(t, 1.6, (o && o.ph) || 0);
    c.rrect(x - 2, y, 4, 2.4, 1, lit ? 'redlamp' : 'accent', { emit: lit, bias: -0.2 });
    c.rect(x - 2.5, y + 2.3, 5, 0.7, 'frame');
    if (lit) c.light(x, y + 1, (o && o.r) || 45, RED, (o && o.i) || 0.8);
  }
  function door(c, x, y, w, h, glow) {
    c.rect(x, y, w, h, 'frame', { vcyl: true });
    c.rect(x + 1, y + 1.5, w - 2, h - 1.5, 'dark', { grad: [0.6, 0.3] });
    if (glow) { c.rect(x + w / 2 - 0.5, y + 2, 1, h - 3, 'cyanlamp', { emit: true, flat: true }); c.light(x + w / 2, y + h * 0.6, 26, CYAN, 0.5); }
  }

  // the captain's shuttle, side on: legs, a swept fin, a round body with a tapered nose, a canopy, portholes and an engine
  function shuttle(c, x, y, t) { // x, y: the back end of the body's centre line
    c.z = 0.55;
    c.shadow(x + 30, y + 13, 36, 3.2, 0.6);
    for (const lx of [x + 12, x + 46]) { c.rect(lx, y + 5, 1.6, 7, 'frame', { vcyl: true }); c.rrect(lx - 2, y + 11.4, 5.6, 1.6, 0.6, 'frame', O); }
    c.poly([[x + 8, y - 5.5], [x + 4, y - 17], [x + 12, y - 17], [x + 26, y - 5.5]], 'accent', O);
    c.poly([[x + 4, y - 17], [x + 12, y - 17], [x + 13, y - 15.6], [x + 5, y - 15.6]], 'accent', { bias: 0.35, flat: true });
    c.rrect(x - 4, y - 5, 8, 10, 2, 'frame', { cyl: true, outline: true });
    c.rrect(x, y - 7, 52, 14, 6, 'shuttle', { cyl: true, outline: true, rim: true });
    c.poly([[x + 50, y - 7], [x + 58, y - 5.6], [x + 64, y - 1.5], [x + 64.5, y + 1.4], [x + 60, y + 5.4], [x + 50, y + 7]], 'shuttle', { cyl: true, band: [y - 7, y + 7], outline: true });
    c.rect(x + 0.4, y + 1.6, 61, 1.8, 'accent', { cyl: true, band: [y - 7, y + 7] });
    for (const sx of [x + 14, x + 32]) c.rect(sx, y - 6.4, 0.34, 8, 'frame', { flat: true });
    for (const px of [x + 18, x + 23]) c.ell(px, y - 2.5, 1.5, 1.8, 'glass', { rim: true, outline: true });
    c.text('CPT', x + 34, y - 4, 'frame', { s: 0.25 });
    c.ell(x + 47, y - 6, 7, 5.4, 'glass', { clipY: [0, y - 5.4], rim: true, outline: true });
    c.rrect(x + 43.5, y - 10.4, 3, 0.8, 0.3, 'glass', { bias: 0.6, flat: true });
    const eng = 0.6 + 0.4 * Math.sin((t || 0) * 6);
    c.ell(x - 4.6, y, 1.2, 3.4, 'cyanlamp', { emit: true });
    c.light(x - 6, y, 26 + 4 * eng, CYAN, 0.7 * eng);
  }
  function crateBox(c, x, y, w, h, o) { // a supply crate in three-quarter view; x, y is the front top left
    o = o || {};
    const d = 2.6;
    c.shadow(x + w / 2 + 1, y + h + 0.4, w * 0.62, 1.6, 0.55);
    c.poly([[x, y], [x + w, y], [x + w + d, y - d * 1.3], [x + d, y - d * 1.3]], 'wood', { bias: 0.35, flat: true, outline: true });
    c.poly([[x + w, y], [x + w + d, y - d * 1.3], [x + w + d, y + h - d * 1.3], [x + w, y + h]], 'wood', { bias: -0.3, flat: true, outline: true });
    c.rect(x, y, w, h, 'wood', O);
    for (const k of [0.33, 0.66]) c.rect(x, y + h * k, w, 0.34, 'wood', { bias: -0.7, flat: true });
    for (const cx of [x, x + w - 1.2]) c.rect(cx, y, 1.2, h, 'frame', { vcyl: true });
    if (o.label) { c.rect(x + w * 0.22, y + h * 0.4, w * 0.56, h * 0.22, 'hazard', { flat: true }); c.text(o.label, x + w * 0.26, y + h * 0.43, 'dark', { s: 0.1 }); }
    if (o.cracked) c.poly([[x + 2, y - 1], [x + w - 1, y - 2.6], [x + w + 0.8, y - 1.8]], 'wood', { bias: -0.8, flat: true });
  }
  // a slime: a dome on the floor, darker inside, with bubbles, eyes and a wet shine
  function slime(c, x, y, t, s) {
    s = s || 1;
    const wob = Math.sin((t || 0) * 2.4) * 0.8 * s;
    c.shadow(x, y, 14 * s, 2.2 * s, 0.45);
    c.ell(x - 12 * s, y - 0.3, 5 * s, 1 * s, 'slime', { bias: -0.1 });
    c.ell(x, y, (12 * s) + wob, (10 * s) - wob, 'slime', { clipY: [0, y], rim: true, outline: true });
    c.ell(x + 1.5 * s, y - 3 * s, 6.5 * s, 4.5 * s, 'slime', { bias: -0.35, clipY: [0, y] });
    for (let b = 0; b < 6; b++) { const ph = ((t || 0) * 0.22 + hash(b, 1, 3)) % 1; c.ell(x - 5.5 * s + hash(b, 2, 3) * 11 * s, y - 1 - ph * 7 * s, 0.6 * s, 0.6 * s, 'slime', { bias: 0.45, flat: true }); }
    for (const ex of [-3.4, 2.2]) { c.ell(x + ex * s, y - 7.2 * s + wob, 1.9 * s, 2.2 * s, 'mop', O); c.ell(x + (ex + 0.5) * s, y - 6.8 * s + wob, 0.8 * s, 1 * s, 'boot', { flat: true }); }
    c.rrect(x - 8 * s, y - 7.2 * s, 2 * s, 0.9 * s, 0.4 * s, 'slime', { bias: 0.8, flat: true });
    c.light(x, y - 3, 30 * s, GREEN, 0.45);
  }
  function scrubBot(c, x, y, t) { // the cleaning robot: treads, a round body, a dome head with a visor, an antenna, a scrub brush
    const rb = Math.sin((t || 0) * 3) * 0.4, sw = Math.sin((t || 0) * 4) * 1.8;
    c.shadow(x, y, 9, 1.5, 0.6);
    c.rrect(x - 6, y - 3, 12, 3, 1.2, 'boot', { cyl: true, outline: true });
    for (const wx of [-3.5, 0, 3.5]) c.ell(x + wx, y - 1.5, 1.1, 1.1, 'frame');
    c.line(x - 4.5, y - 7.5 + rb, x - 10 + sw, y - 2.2, 'frame', { w: 0.6 });
    c.rrect(x - 13.4 + sw, y - 2.4, 6, 1.4, 0.4, 'hazard', O);
    c.rrect(x - 5.2, y - 11.2 + rb, 10.4, 8.6, 2.6, 'robot', { vcyl: true, outline: true });
    c.rect(x - 5.2, y - 5.5 + rb, 10.4, 0.9, 'hazard', { vcyl: true });
    c.ell(x, y - 10.8 + rb, 4.8, 5, 'robot', { clipY: [0, y - 10.4 + rb], rim: true, outline: true });
    c.rrect(x - 3.5, y - 14.5 + rb, 7, 2.5, 0.8, 'dark', { flat: true });
    const eye = on(t, 0.7, 0.2) ? 'cyanlamp' : 'redlamp', eh = Math.floor((t || 0) * 0.9) % 5 === 0 ? 0.3 : 1.1;
    for (const ex of [-2.1, 1]) c.rrect(x + ex, y - 13.8 + rb + (1.1 - eh) / 2, 1.1, eh, 0.2, eye, { emit: true, flat: true });
    c.line(x + 1.2, y - 15.5 + rb, x + 2.4, y - 19 + rb, 'frame', { w: 0.4 });
    c.ell(x + 2.5, y - 19.2 + rb, 0.6, 0.7, 'redlamp', { emit: true });
    c.light(x, y - 13, 14, eye === 'cyanlamp' ? CYAN : RED, 0.6);
  }
  function bucket(c, x, y) { // x, y: the bottom middle
    c.shadow(x, y, 4.5, 1, 0.5);
    c.rrect(x - 3.4, y - 6, 6.8, 6, 1, 'robot', { vcyl: true, outline: true });
    c.ell(x, y - 5.8, 3.1, 0.8, 'glass', { bias: -0.2 });
    c.line(x - 3.2, y - 6, x - 1.5, y - 8.4, 'frame', { w: 0.4 }); c.line(x - 1.5, y - 8.4, x + 1.5, y - 8.4, 'frame', { w: 0.4 }); c.line(x + 1.5, y - 8.4, x + 3.2, y - 6, 'frame', { w: 0.4 });
  }
  function mop(c, x, y, lean) { // a mop standing on its head at x, y
    c.line(x + (lean || 4), y - 32, x, y - 3, 'wood', { w: 0.9 });
    c.rrect(x - 4, y - 3.4, 8, 1.6, 0.5, 'frame', O);
    for (let i = 0; i < 8; i++) c.line(x - 3.6 + i, y - 1.9, x - 4 + i * 1.12, y, 'mop', { w: 0.34, s: 0.5 + (i % 3) * 0.2 });
  }
  function pod(c, x, y, o) { // escape pod 4: a round white capsule; x, y is its bottom middle
    o = o || {};
    c.shadow(x, y, 20, 2.4, 0.55);
    c.ell(x, y - 14, 18, 14, 'shuttle', { rim: true, outline: true });
    c.rect(x - 17.6, y - 13.4, 35.2, 1.4, 'accent', { cyl: true, band: [y - 28, y] });
    c.ell(x - 5, y - 18, 7, 5.6, 'glass', { rim: true, outline: true });
    c.rrect(x - 8.4, y - 21.6, 3, 0.9, 0.3, 'glass', { bias: 0.6, flat: true });
    if (o.hatch) { c.rrect(x + 4, y - 16, 10, 12, 3, 'dark', { flat: true, outline: true }); c.rect(x + 5, y - 15, 8, 10, 'lamp', { emit: true, flat: true, bias: -0.5 }); c.light(x + 9, y - 10, 30, LAMP, 0.6); }
    c.text('4', x + 9, y - 25, 'frame', { size: 2, s: 0.3 });
    c.rrect(x - 18, y - 2.4, 36, 2.4, 0.8, 'frame', { cyl: true });
  }

  // ---------------------------------------------------------------- people
  // the custodian (you): boots, legs, jumpsuit with collar, belt and name patch, arms, head and messy hair, and the mop when you have it
  function custodian(c, x, y, dir, moving, step, g, t) {
    const L = dir === 'l', back = dir === 'u', f = moving ? (Math.floor(step / 4) & 1) : 0;
    const X = v => (L ? x - v : x + v);                                    // mirror for walking left
    const R = (x0, y0, w, h, r, mat, o) => c.rrect(L ? x - x0 - w : x + x0, y + y0, w, h, r, mat, o);
    const E = (x0, y0, rx, ry, mat, o) => c.ell(X(x0), y + y0, rx, ry, mat, o);
    const P = (pts, mat, o) => c.poly(pts.map(p => [X(p[0]), y + p[1]]), mat, o);
    const hasMop = g && g.has && g.has('mop');
    c.shadow(x + 0.5, y, 7, 1.3, 0.55);
    // legs (one lifts when walking) and boots
    R(-2.7, -6.6 + (f ? -0.6 : 0), 2.4, 5.6, 0.5, 'suit', { vcyl: true, outline: true });
    R(0.3, -6.6 + (f ? 0 : -0.6), 2.4, 5.6, 0.5, 'suit', { vcyl: true, outline: true });
    R(-3.2, -1.8 + (f ? -0.6 : 0), 3.1, 1.8, 0.7, 'boot', O);
    R(0.1, -1.8 + (f ? 0 : -0.6), 3.1, 1.8, 0.7, 'boot', O);
    // the far arm
    R(-5, -13.2, 1.8, 5.3, 0.7, 'suit', { vcyl: true, bias: -0.25, outline: true });
    if (!back) E(-4.1, -7.7, 1, 1, 'skin');
    // body
    R(-3.8, -14, 7.6, 7.9, 1.6, 'suit', { vcyl: true, outline: true });
    R(-3.8, -8.1, 7.6, 1, 0.2, 'boot');
    if (!back) {
      P([[-1.8, -14], [1.8, -14], [0, -11.8]], 'suit', { bias: 0.4, flat: true });
      R(-0.5, -8.1, 1, 1, 0.1, 'hazard', { flat: true });
      R(-2.9, -12.5, 1.7, 1, 0.1, 'hazard', { flat: true });
    }
    // head and hair
    R(-0.8, -14.9, 1.6, 1.2, 0, 'skin', { bias: -0.25 });
    E(0, -16.9, 3, 3.1, back ? 'hair' : 'skin', O);
    if (!back) {
      E(-2.6, -16.7, 0.7, 1, 'skin', { bias: -0.2 });
      P([[-3.3, -16.7], [-3.1, -18.9], [-1.1, -20.3], [1.5, -20.1], [3.4, -18.7], [2.9, -17.6], [1.8, -18.2], [0.5, -17.6], [-0.7, -18.2], [-2, -17.8], [-2.4, -16.7]], 'hair', O);
      for (const ex of [1.3, -0.4]) { c.dot(X(ex), y - 16.8, 'boot', 0); c.dot(X(ex), y - 16.5, 'boot', 0); }
    } else P([[-3.2, -15.5], [-3.3, -18.8], [-1, -20.4], [1.6, -20.2], [3.4, -18.6], [3.2, -15.5]], 'hair', O);
    // the near arm, and the mop
    const hx = X(4.7), hy = y - 9.7, sway = Math.sin((t || 0) * 3.2 + (moving ? step * 0.3 : 0)) * 1.4;
    if (hasMop) {
      const mx = hx + (L ? -1 : 1) * (moving ? 1.5 : 0) + sway;
      c.line(hx - (L ? -0.4 : 0.4), y - 18.6, mx, y - 2, 'wood', { w: 0.8 });
      c.rrect(mx - 2.8, y - 2.4, 5.6, 1.1, 0.4, 'frame', O);
      for (let i = 0; i < 7; i++) c.line(mx - 2.6 + i * 0.85, y - 1.4, mx - 2.9 + i * 0.95 + sway * 0.3, y - 0.1, 'mop', { w: 0.34, s: 0.5 + (i % 3) * 0.2 });
    }
    if (!back) { R(3, -13.2, 1.8, 4.2, 0.7, 'suit', { vcyl: true, outline: true }); c.ell(hx, hy, 1.1, 1.1, 'skin', O); }
  }
  // Vell: a lizard pilot in a red flight jacket and goggles, sitting with her boots up
  function vell(c, x, y, t) {
    c.shadow(x - 4, y, 14, 1.6, 0.5);
    c.rrect(x - 18, y - 9, 18, 1.6, 0.4, 'wood', { cyl: true, outline: true }); c.rect(x - 10, y - 7.4, 1.6, 7.4, 'wood', { vcyl: true });
    c.rrect(x - 14, y - 11, 2.6, 2, 0.4, 'glass', O); c.rect(x - 13.6, y - 10.6, 1.8, 0.8, 'lamp', { emit: true, flat: true, bias: -0.3 });
    c.rrect(x - 4, y - 13.4, 2.4, 6.4, 0.6, 'cloth', { vcyl: true, outline: true });
    c.rrect(x - 3, y - 14.6, 9, 2.6, 1, 'cloth', { cyl: true, outline: true }); c.rrect(x - 6.6, y - 15.2, 4.4, 2.2, 0.8, 'boot', O);
    c.rrect(x + 2, y - 16, 8, 9, 2, 'accent', { vcyl: true, outline: true });
    c.rect(x + 2.4, y - 12, 7.2, 0.8, 'brass', { flat: true });
    c.rrect(x + 8.4, y - 15, 2, 5, 0.7, 'accent', { vcyl: true, outline: true });
    c.ell(x + 6.4, y - 19.8, 3.4, 3.2, 'lizard', O);
    c.ell(x + 3.4, y - 19.6, 2, 1.6, 'lizard', { bias: -0.1 });
    c.rrect(x + 3.6, y - 21.4, 6, 1.4, 0.5, 'brass', { cyl: true });
    for (const ex of [4.6, 7.4]) c.ell(x + ex, y - 20.7, 0.9, 0.8, 'glass', { bias: 0.3 });
    c.line(x + 2, y - 18.6, x + 4, y - 18.8, 'boot', { w: 0.34 });
    for (let i = 0; i < 4; i++) c.dot(x + 6 + i * 1.2, y - 23.2 + Math.abs(i - 1.5) * 0.4, 'lizard', 0.9);
  }
  // the big alien at the bar, from behind and a bit to the side, with three red eyes
  function brute(c, x, y, t) {
    c.shadow(x, y, 12, 1.6, 0.55);
    c.rect(x - 1, y - 9, 2, 9, 'frame', { vcyl: true }); c.ell(x, y - 9.6, 6, 1.4, 'accent', O);
    c.rrect(x - 11, y - 30, 22, 21, 7, 'alien', { vcyl: true, outline: true, rim: true });
    c.rrect(x - 15, y - 25, 6, 12, 3, 'alien', { vcyl: true, outline: true });
    c.ell(x - 1, y - 33, 7, 6.4, 'alien', { rim: true, outline: true });
    for (const [ex, ey] of [[-4.4, -34], [-1.2, -35.2], [2, -34]]) { c.ell(x + ex, y + ey, 1.1, 1, 'redlamp', { emit: true }); }
    c.light(x - 1, y - 34, 12, RED, 0.35);
    c.line(x - 5, y - 30.5, x + 1, y - 30, 'boot', { w: 0.4 });
    for (const hx of [-5, 3]) c.poly([[x + hx, y - 38], [x + hx + 1.4, y - 42.4], [x + hx + 2.4, y - 37.6]], 'bone', O);
    c.rrect(x - 19, y - 22, 6, 7, 1.4, 'glass', { vcyl: true, outline: true }); c.rect(x - 18.4, y - 20, 4.8, 4.4, 'punch', { bias: 0.2 });
  }
  // the bartender: a robot with four arms polishing glasses
  function barbot(c, x, y, t) {
    const a = Math.sin((t || 0) * 5) * 0.8;
    c.rrect(x - 5.5, y - 13, 11, 13, 2.6, 'robot', { vcyl: true, outline: true });
    c.rrect(x - 4.6, y - 19.6, 9.2, 6.6, 2, 'robot', { vcyl: true, outline: true });
    c.rrect(x - 3.6, y - 17.8, 7.2, 2.4, 0.8, 'dark', { flat: true });
    const e = on(t, 0.6) ? 'cyanlamp' : 'greenlamp';
    for (const ex of [-2.2, 1.2]) c.rect(x + ex, y - 17.2, 1, 1, e, { emit: true, flat: true });
    c.line(x, y - 19.6, x, y - 22.4, 'frame', { w: 0.4 }); c.ell(x, y - 22.6, 0.6, 0.6, 'redlamp', { emit: true });
    for (const [sx, sy, k] of [[-1, -11, 1], [1, -11, 1], [-1, -7.5, -1], [1, -7.5, -1]]) {
      const hx = x + sx * (8.4 + k * a * 0.6), hy = y + sy;
      c.line(x + sx * 5, y + sy, hx, hy + k * a * 0.4, 'robot', { w: 0.7 });
      c.rrect(hx - 0.9, hy - 1.6 + k * a * 0.4, 1.8, 2.4, 0.4, sy < -9 ? 'glass' : 'white', { bias: 0.1 });
    }
    c.text('SPLASH', x - 4.6, y - 5.4, 'dark', { s: 0.1 });
    c.light(x, y - 16, 12, CYAN, 0.4);
  }

  // ---------------------------------------------------------------- the game
  const cash = g => g.flag('cash') || 0;
  function earn(g, n) { g.set('cash', cash(g) + n); g.give('credits'); }
  // "mop the slime" or "clean slime with mop": a cleaning handler that wants the mop in hand
  const withMop = fn => (g, w) => {
    if (w && w.kind === 'item' && w.id !== 'mop') return g.say('That will not clean anything.');
    if (!g.has('mop')) return g.say('You would need your mop.');
    fn(g);
  };

  function feedEel(g) {
    if (g.flag('eel_fed')) return g.say('It is asleep. Let it sleep.');
    g.lose('brick'); g.set('eel_fed'); g.score(10, 'eel');
    g.say('You lob the Nutri-Brick at the mound. A huge mouth full of teeth comes up out of the sand, swallows the brick in one bite, and stops. It chews. It chews some more. It looks surprised, and then very full, and then it sinks into the sand with a long, happy sigh. Thirty days of nutrients. It will be asleep for a month.');
  }
  function playSlots(g) {
    if (g.flag('jackpot')) return g.say('The machine has paid out once already. It looks very sorry about it, and will not take any more tokens.');
    g.lose('token'); g.set('jackpot'); earn(g, 50); g.score(10, 'jackpot');
    g.say('You drop the token in and pull the lever. Clunk. Whirr. Moon. Moon. ... Moon. Bells ring. Lights flash. The machine spits out fifty credits, and the whole bar turns to look at you. The big alien grunts, in a way that might be impressed.');
  }

  const items = {
    mop: { name: 'mop', aliases: ['mop', 'trusty mop', 'mop handle'], desc: 'Your mop. Regulation issue, slightly bent, very absorbent. The handle says PROPERTY OF THE PEMBERTON. DO NOT LICK.',
      verbs: { drop: 'You would sooner leave your own arm behind.', eat: 'The handle says DO NOT LICK. You respect the handle.' } },
    keycard: { name: 'keycard', aliases: ['card', 'key card', 'captains keycard', 'captain keycard', 'pass'], desc: 'The captain\'s keycard. It has his photo on it. He is doing a thumbs up.' },
    brick: { name: 'Nutri-Brick', aliases: ['brick', 'nutri brick', 'nutribrick', 'ration', 'rations', 'food bar', 'food'], desc: 'An emergency Nutri-Brick. The wrapper says it holds all the nutrients a person needs for thirty days, and that it may be eaten or used as a doorstop.',
      verbs: { eat: 'You bite the Nutri-Brick. The Nutri-Brick wins. You put it away and check your teeth.' } },
    token: { name: 'slot token', aliases: ['token', 'coin', 'slot token', 'brass token'], desc: 'A brass token stamped THE DENTED MOON. ONE PLAY. NO REFUNDS.' },
    credits: { name: 'credits', aliases: ['credits', 'money', 'cash', 'chips', 'credit chips', 'fare'], desc: g => 'A little stack of credit chips. ' + cash(g) + ' credits, all told.', verbs: { drop: 'You hold on to your money. It took a lot of mopping.' } },
  };

  const rooms = {
    // ---------------------------------------------------------------- the hangar (where you wake up)
    hangar: {
      name: 'Hangar 2', horizon: 62, exits: { w: 'closet', e: 'corridor' }, look: 'golden',
      desc: 'Hangar 2 of the Pemberton. A wall of windows looks out on a dusty orange planet, and a low sun pours in across the deck. The captain\'s shuttle sits on its pad. A crate marked SPECIMEN 12 has been cracked open from the inside, and a trail of green slime leads east, toward the corridor. A cleaning robot hums to itself. Your supply closet is west.',
      listen: 'A siren, a long way off. The cleaning robot humming. A calm voice saying something about the reactor.',
      smell: 'Engine grease, floor polish, and something like lime.',
      back(c, g, t) {
        c.z = 0.1;
        wallPanels(c, 0, 0, 160, 62, { seam: 46 });
        viewport(c, 9, 5, 142, 36, t, { seed: 11, planet: [118, 21, 12], moon: [140, 11], sun: [64, 33], struts: [0.25, 0.5, 0.75] });
        c.shaft({ kind: 'window', x0: 12, x1: 150, y0: 7, y1: 100, slant: -26, n: 6, color: SUN, a: 0.15 });
        c.z = 0.2;
        c.rect(0, 43, 160, 1.5, 'frame', { cyl: true });
        for (let i = 0; i < 8; i++) { const lx = 14 + i * 18; c.rrect(lx, 50, 10, 6, 1.2, 'wall', { bias: 0.1 }); const lit = on(t, 0.7, i * 0.37) || i % 3; c.rect(lx + 3, 51.6, 4, 1, lit ? 'cyanlamp' : 'frame', { emit: lit, flat: true }); }
        c.text('HANGAR 2', 112, 46.4, 'hazard', { s: 0.55 });
        door(c, 0, 30, 6, 32, false);
        door(c, 154, 30, 6, 32, true);
        siren(c, 150, 24, t, { r: 35, i: 0.5 });
        // the bay door control: a lever in a hazard box
        c.rect(138, 46, 9, 12, 'frame', O); hazard(c, 138.6, 46.6, 7.8, 1.2); c.rect(140, 49, 5, 7, 'dark', { flat: true });
        c.line(142.5, 55, 144.5, 50.5, 'accent', { w: 0.8 }); c.ell(144.6, 50.4, 1, 1, 'redlamp', { emit: true });
        floor(c, 62, 'floor', 80);
        hazard(c, 4, 84.5, 70, 2); hazard(c, 4, 70, 70, 1.2);
        // the slime trail from the crate to the corridor door
        c.z = 0.45;
        for (let i = 0; i < 9; i++) c.ell(108 + i * 5.4, 77 - i * 0.6 + Math.sin(i * 2) * 0.8, 1.6 + hash(i, 1, 4), 0.6, 'slime', { bias: -0.05 });
        shuttle(c, 12, 70, t);
        crateBox(c, 92, 66, 14, 10, { label: 'SPEC 12', cracked: true });
        c.ell(99, 63.6, 4, 1.4, 'slime');
        c.rrect(104, 66, 1.2, 6 + Math.sin((t || 0) * 1.3) * 1.4, 0.6, 'slime', { vcyl: true });
        c.light(99, 66, 20, GREEN, 0.35);
      },
      objects: [
        { id: 'shuttle', name: 'shuttle', aliases: ['captains shuttle', 'ship', 'spaceship', 'pad', 'landing pad', 'canopy'], rect: [6, 50, 72, 34], at: [44, 90],
          desc: 'The captain\'s shuttle, sleek and white with a red stripe and CPT on the side. It has never once been dirty, because you clean it every Tuesday. The canopy is locked. A little screen on it says NO FUEL. THANK YOU FOR NOT ASKING.',
          verbs: { open: 'Locked. The captain keeps the shuttle locked, and the captain is gone.', enter: 'Locked. The captain keeps the shuttle locked, and the captain is gone.', climb: 'You climb on the wing and look in. A very comfortable seat, and a sign that says NO FUEL. You climb down.', clean: 'You give the shuttle a wipe out of habit. It is Tuesday somewhere.', push: 'It does not move. It has no fuel and no interest.', attack: 'You kick the shuttle. It is the captain\'s. You apologise to it.' } },
        { id: 'crate', name: 'specimen crate', aliases: ['crate', 'specimen', 'box', 'specimen 12', 'trail', 'slime trail', 'green trail'], rect: [90, 58, 18, 18], at: [99, 84],
          desc: 'A crate marked SPECIMEN 12. HANDLE WITH CARE. DO NOT FEED. The lid has been pushed up from the inside, and a trail of green slime leads out of it and away east, toward the corridor. Whatever it was, it is out now.',
          verbs: { open: 'It is open already. That is the problem.', search: 'Some straw, a feeding bowl licked clean, and a label: SPECIMEN 12. EATS ANYTHING EXCEPT CLEAN FLOORS.', clean: 'You mop around the crate. The trail goes on east, and so does the slime that made it.', take: 'It is heavy, and it is sticky.', kiss: 'It smells of lime. You stop.' } },
        { id: 'robot', name: 'cleaning robot', aliases: ['robot', 'scrub', 'scrub-e', 'scrube', 'droid', 'bot'], rect: [126, 68, 18, 22], at: [122, 92], base: 90,
          draw(c, g, t) { c.z = 0.7; scrubBot(c, 135, 90, t); },
          desc: 'SCRUB-E, the ship\'s cleaning robot, scrubbing the same spot of floor over and over. It is the closest thing you have to a coworker.',
          verbs: {
            talk(g) {
              if (!g.flag('met_scrub')) { g.set('met_scrub'); return g.say('"Custodian! You are awake! Everyone left in the pods. There was cake. The reactor is unwell and Specimen 12 got out of its crate and went east, toward the bridge. I would chase it, but I am programmed only for this square." It scrubs the square. "Your mop is in the supply closet, west, where you left it. You will want it."'); }
              g.say(g.has('mop') ? '"Good mop. Now go east, and mop that specimen. And find a pod. I will hold the fort. The square, I mean."' : '"Your mop is in the closet, west. Then east, to the slime."');
            },
            kiss: 'SCRUB-E beeps, embarrassed, and scrubs faster.', attack: 'You kick SCRUB-E. It scrubs your boot. You feel bad.', take: 'SCRUB-E is bolted to its square. By choice.', clean: 'You help SCRUB-E scrub its square. It beeps happily.', give: { '*': '"I only need my square," says SCRUB-E.' },
          } },
        { id: 'pail', name: 'bucket', aliases: ['your bucket', 'pail', 'water'], rect: [68, 86, 10, 10], at: [80, 94], base: 95,
          draw(c) { c.z = 0.7; bucket(c, 73, 95); },
          desc: 'Your bucket. You were using it as a pillow. There is a dent in it the shape of your head.', verbs: { take: 'You have your hands full being a hero. The bucket can stay.', drink: 'No.', kiss: 'It is a good bucket.', clean: 'You rinse the bucket. It is the cleanest thing on a sinking ship.' } },
        { id: 'lever', name: 'bay door lever', aliases: ['lever', 'control', 'bay door', 'bay doors', 'box', 'hazard box', 'switch'], rect: [136, 44, 13, 16], at: [142, 68],
          desc: 'The control for the big hangar bay doors. A sign says: CHECK THAT EVERYONE IS IN A SUIT. THEN CHECK AGAIN.',
          verbs: { pull: g => g.die('You pull the lever. The hangar bay doors open onto space. You were not in a suit, and you did not check again. You leave the Pemberton very quickly, along with the shuttle, the crate, and a good deal of the floor polish.'), push: g => g.act('pull', 'lever'), use: { '*': g => g.act('pull', 'lever') }, open: g => g.act('pull', 'lever') } },
        { id: 'view', name: 'window', aliases: ['windows', 'planet', 'sun', 'space', 'stars', 'kesh'], rect: [9, 5, 142, 36], at: [80, 70],
          desc: 'Out the windows: a dusty orange planet with a pale moon, and a sun sitting low. That is Kesh. The escape pods go there. Somewhere down there the crew is having cake without you.',
          verbs: { open: 'They do not open. Good.', clean: 'You polish a patch of window. The sun comes through even brighter.', attack: 'You think about it, and then you think about space, and you stop.' } },
      ],
    },

    // ---------------------------------------------------------------- the closet
    closet: {
      name: 'Supply Closet', horizon: 56, exits: { e: 'hangar' }, look: 'mystery',
      desc: 'The supply closet on deck 3, lit by one bare bulb. Shelves of cleaning fluid line the wall. Your spare bucket and a pile of rags are on the floor. A red light flashes over the door, which leads east to the hangar.',
      listen: 'A siren whoops, a long way off. A calm voice says something about the reactor.',
      smell: 'Lemon cleaner and old rags. Home.',
      back(c, g, t) {
        c.z = 0.15;
        wallPanels(c, 0, 0, 160, 56, { mat: 'wall', grad: [0.5, 0.25], step: 20 });
        for (const sy of [18, 32, 46]) {
          c.rect(5, sy, 58, 1.6, 'wood', { cyl: true });
          for (let i = 0; i < 9; i++) {
            const bx = 8 + i * 6, h = 4 + hash(i, sy, 2) * 3, m = ['glass', 'slime', 'hazard', 'punch', 'cyanlamp', 'accent'][(i + sy) % 6];
            c.rrect(bx, sy - h, 3.4, h, 0.9, m === 'cyanlamp' ? 'glass' : m, { vcyl: true });
            c.rect(bx + 1, sy - h - 1.4, 1.4, 1.4, 'white', { flat: true });
            if (i === 4 && sy === 32) { c.rect(bx + 0.8, sy - h + 1.4, 1.8, 1.4, 'white', { flat: true }); c.dot(bx + 1.4, sy - h + 1.9, 'dark', 0); c.dot(bx + 2.1, sy - h + 1.9, 'dark', 0); }
          }
        }
        door(c, 146, 22, 12, 34, false);
        siren(c, 152, 15, t, { r: 60, i: 0.9 });
        // one bare bulb on a wire
        c.line(90, 0, 90, 8, 'frame', { w: 0.4 });
        c.rect(89, 8, 2, 1.4, 'frame'); c.ell(90, 10.4, 1.6, 1.8, 'lamp', { emit: true });
        c.light(90, 14, 80, COLD, 0.9);
        c.shaft({ kind: 'cone', x: 90, y: 11, w0: 2, w1: 34, y1: 100, color: COLD, a: 0.16, flicker: true });
        floor(c, 56, 'floor', 90, { grad: [0.3, 0.6] });
        // rags and the spare bucket
        c.z = 0.6;
        c.shadow(40, 82, 20, 3, 0.5);
        for (let i = 0; i < 9; i++) c.ell(24 + i * 4 + hash(i, 1, 9) * 2, 80 - hash(i, 2, 9) * 3, 4 + hash(i, 3, 9) * 2, 2.2, ['cloth', 'accent', 'mop', 'hazard'][i % 4], { bias: -0.2 });
        bucket(c, 113, 74);
      },
      objects: [
        { id: 'mop', item: 'mop', name: 'mop', aliases: ['trusty mop'], rect: [74, 34, 14, 40], at: [82, 80], base: 72, points: 5,
          draw(c) { c.z = 0.6; c.shadow(81, 72, 5, 1, 0.5); mop(c, 80, 72, 5); }, desc: 'Your mop, leaning where you left it. Good old mop.', takeMsg: 'You take your mop. You feel ready for anything, as long as anything is a spill.' },
        { id: 'rags', name: 'pile of rags', aliases: ['rags', 'pile', 'bed', 'rag'], rect: [22, 74, 36, 12], at: [40, 90],
          desc: 'Your bed, more or less. There is a mop-handle-shaped dent in it.', verbs: { search: 'Rags, a sock, and the wrapper from a snack you do not remember eating.', take: 'You have plenty of rags back home. Wherever that is.', wait: 'Not again.', climb: 'It is not time for a nap. Well, it is always time for a nap, but not today.' } },
        { id: 'shelves', name: 'shelves', aliases: ['shelf', 'bottles', 'cleaning fluid', 'fluid', 'cleaner', 'supplies', 'bottle'], rect: [6, 8, 56, 40], at: [34, 62],
          desc: 'Floor wax, glass cleaner, Gunk-B-Gone, and a bottle with a skull on it that you have always meant to ask about.',
          verbs: { take: 'You have everything you need. That is to say, a mop.', search: 'All the cleaners in the galaxy, and none of them for reactors.', drink: g => g.die('You drink the bottle with the skull on it. Now you know what it was for. The Pemberton loses its least important crew member, and does not notice.'), eat: 'No.' } },
        { id: 'bucket', name: 'bucket', aliases: ['pail', 'grey water', 'water', 'spare bucket'], rect: [106, 64, 14, 10], at: [112, 80],
          desc: 'Your spare bucket, full of grey water from Tuesday.', verbs: { take: 'It is heavy and it sloshes. The mop is all you need.', drink: 'It is from Tuesday.', kick: 'It sloshes.', search: 'You find a button in it. Not a useful one.' } },
        { id: 'light', name: 'red light', aliases: ['siren', 'alarm', 'light', 'lamp', 'bulb'], rect: [144, 12, 14, 8], at: [140, 70], desc: 'A red light, flashing. It only does that in drills. Or when it is not a drill.' },
      ],
    },

    // ---------------------------------------------------------------- the corridor
    corridor: {
      name: 'Corridor', horizon: 58, exits: { w: 'hangar', e: 'bridge' }, look: 'mystery',
      desc: g => 'A long corridor, empty, with the emergency lights on. A window shows stars and a dusty orange planet. The pod bay door is set in the north wall. ' +
        (g.flag('slime_gone') ? 'The floor by the bridge door, east, is spotless.' : 'A big green blob of slime has spread across the floor in front of the bridge door, to the east. It blinks at you.') + ' The hangar is west.',
      listen: 'A calm voice: "Reactor stability is now... poor. Have a nice day."',
      exitCheck(g, dir) {
        if (dir === 'e' && !g.flag('slime_gone')) {
          g.die('You try to step over the slime. The slime does not let you. It is warm, and friendly, and it is eating your boots, and then your knees, and then everything else. The last thing you see is your name patch, floating inside it.');
          return true;
        }
        return false;
      },
      back(c, g, t) {
        c.z = 0.15;
        wallPanels(c, 0, 4, 160, 54, { step: 20, seam: 38, grad: [0.55, 0.3] });
        c.rect(0, 0, 160, 4, 'frame', { cyl: true });
        for (let i = 0; i < 5; i++) { const x = 10 + i * 34; c.rrect(x, 4, 12, 2, 0.6, 'frame'); const lit = on(t, 1.2, i * 0.5); c.rect(x + 2, 6, 8, 0.8, lit ? 'redlamp' : 'accent', { emit: lit, flat: true }); if (lit) c.light(x + 6, 9, 38, RED, 0.55); }
        viewport(c, 16, 14, 48, 24, t, { seed: 5, planet: [50, 30, 7], struts: [0.5] });
        c.z = 0.2;
        // the pod bay door: a heavy split door with a hazard frame and a card reader
        c.rect(92, 18, 32, 40, 'frame', { vcyl: true, outline: true });
        hazard(c, 93, 19, 30, 1.4);
        c.rect(95, 21, 13, 37, 'wall', { vcyl: true }); c.rect(108, 21, 13, 37, 'wall', { vcyl: true }); c.rect(107.6, 21, 0.8, 37, 'dark', { flat: true });
        c.rect(97, 13, 22, 4, 'dark', { flat: true }); c.text('POD BAY', 99, 13.8, 'hazard', { s: 0.7, emit: true });
        c.rrect(125, 37, 4, 7, 1, 'frame', O);
        const ok = g.flag('bay_open');
        c.rect(126, 38.4, 2, 1, ok ? 'greenlamp' : 'redlamp', { emit: true, flat: true }); c.light(127, 39, 16, ok ? GREEN : RED, 0.6);
        c.rect(126.4, 41, 1.2, 2, 'dark', { flat: true });
        door(c, 0, 18, 6, 40, false);
        door(c, 152, 18, 8, 40, true);
        c.rect(103, 9, 10, 1.4, 'frame', { cyl: true }); c.rect(104, 10.4, 8, 0.7, 'lamp', { emit: true, flat: true }); c.light(108, 14, 36, COLD, 0.7);
        c.shaft({ kind: 'cone', x: 108, y: 11, w0: 4, w1: 18, y1: 66, color: COLD, a: 0.12 });
        floor(c, 58, 'floor', 80);
        c.z = 0.45;
        for (let x = 4; x < 160; x += 22) c.rect(x, 60, 14, 0.5, 'frame', { flat: true, bias: 0.2 });
      },
      objects: [
        { id: 'slime', name: 'slime', aliases: ['blob', 'green slime', 'goo', 'green blob', 'ooze', 'puddle', 'floor', 'specimen'], rect: [118, 62, 36, 22], at: [106, 78], base: 82,
          show: g => !g.flag('slime_gone'), draw(c, g, t) { c.z = 0.66; slime(c, 136, 82, t, 1.45); },
          desc: 'A blob of green slime as big as a bathtub, with two small eyes. It has a tag stuck to it: SPECIMEN 12. DO NOT FEED. It seems to be eating the floor, slowly. It hums.',
          verbs: {
            use: { mop: g => g.act('clean', 'slime'), keycard: 'The slime takes a good look at the keycard. You take it back, quickly.', '*': 'The slime absorbs your interest, and nearly your hand.' },
            clean: withMop(g => {
              g.set('slime_gone'); g.score(10, 'slime');
              g.say('You do what you were born to do. Long, even strokes. The slime is so surprised to be mopped that it squeaks, rolls itself into a ball, and slides off down a floor drain. The floor underneath is the cleanest it has ever been. You are proud of yourself, a little.');
            }),
            take: g => g.die('You try to pick up the slime. It tries to pick you up too, and it is better at it.'),
            eat: g => g.die('You take a bite of the slime. The slime takes a bite of you. It is a fair trade, for the slime.'),
            kiss: g => g.die('You kiss the slime. It is sweet about it, at first.'),
            attack: g => g.die('You kick the slime. Your foot goes in and stays there, and the rest of you follows it.'),
            talk: 'The slime hums at you. You hum back. It is a nice moment, but it does not move.', give: { '*': 'The tag says DO NOT FEED. You decide to believe it.' },
            smell: 'It smells like lime gelatin and despair.',
          } },
        { id: 'baydoor', name: 'pod bay door', aliases: ['door', 'pod bay', 'bay door', 'bay', 'reader', 'card reader', 'slot', 'sign'], rect: [92, 18, 38, 40], at: [108, 64],
          desc: g => (g.flag('bay_open') ? 'The pod bay door. The light on the card reader is green.' : 'A heavy door marked POD BAY. A card reader beside it blinks red. A sign says: COMMAND STAFF ONLY. ALSO NO MOPS.'),
          verbs: {
            open(g) {
              if (!g.flag('bay_open')) return g.say('It does not budge. The card reader blinks red at you, smugly.');
              g.say('The door hisses open, and you go through.'); g.goto('podbay', 80, 90);
            },
            use: {
              keycard(g) {
                if (!g.flag('bay_open')) { g.set('bay_open'); g.score(10, 'bay'); g.say('You swipe the captain\'s keycard. The reader thinks about it, beeps, and turns green. "Welcome, Captain," it says. "You look shorter." The door hisses open.'); }
                else g.say('The door hisses open.');
                g.goto('podbay', 80, 90);
              },
              mop: 'You poke the reader with the mop. It does not think you are the captain.', '*': 'The card reader wants a card.',
            },
            push: g => g.act('open', 'baydoor'), enter: g => g.act('open', 'baydoor'), attack: 'You kick the door. It has been kicked by better.', clean: 'You give the door a wipe. It is now a clean locked door.',
          } },
        { id: 'window', name: 'window', aliases: ['stars', 'planet', 'space', 'orange planet', 'porthole'], rect: [16, 14, 48, 24], at: [40, 64],
          desc: 'Stars, and a dusty orange planet with two suns. That will be Kesh, a desert with a spaceport on it. The pods will land there. Somewhere out there, the crew is having a nice time without you.',
          verbs: { open: 'It does not open, and you should be glad it does not.', attack: g => g.die('You hit the window with all you have. It cracks, and then it does what windows in spaceships do when they crack. You leave the ship quickly, and without the ship.'), clean: 'You polish the window until the stars sparkle. It does not help, but it looks nice.' } },
      ],
    },

    // ---------------------------------------------------------------- the bridge
    bridge: {
      name: 'Bridge', horizon: 60, exits: { w: 'corridor' }, look: 'hd2d',
      desc: 'The bridge of the Pemberton, with nobody on it. A wide window looks out on space. The computer\'s face glows on a screen. On the console is a big red button with a sign. The captain\'s chair is empty, and was left in a hurry.',
      listen: 'The computer hums a little tune to itself. It is a sad one.',
      blocks: [[70, 66, 20, 8]],
      back(c, g, t) {
        c.z = 0.1;
        c.rect(0, 0, 160, 60, 'wall', { grad: [0.4, 0.2] });
        viewport(c, 8, 4, 144, 30, t, { seed: 7, planet: [118, 22, 10], struts: [0.25, 0.5, 0.75] });
        lamp(c, 30, 1, LAMP, { r: 60, a: 0.08 }); lamp(c, 130, 1, LAMP, { r: 60, a: 0.08 });
        // the console, curving round
        c.z = 0.3;
        c.poly([[0, 60], [10, 37], [150, 37], [160, 60]], 'frame', { grad: [0.7, 0.35] });
        c.rect(10, 36.4, 140, 1.4, 'white', { cyl: true });
        for (let i = 0; i < 26; i++) { const m = ['redlamp', 'greenlamp', 'lamp', 'cyanlamp'][(i + Math.floor((t || 0) * 3)) % 4], lx = 14 + i * 5 + (i > 9 ? 34 : 0); if (lx > 140) break; c.rrect(lx, 41 + (i % 3) * 4, 2.4, 1.4, 0.4, m, { emit: (i + Math.floor((t || 0) * 2)) % 5 !== 0, flat: true }); }
        c.light(40, 46, 40, CYAN, 0.4); c.light(122, 46, 40, CYAN, 0.4);
        // NANNY's face
        c.rrect(65, 39, 30, 18, 2, 'frame', O);
        c.rrect(66.4, 40.4, 27.2, 15.2, 1.4, 'glass', { emit: true, grad: [0.75, 0.45] });
        const blinkE = Math.floor((t || 0) * 0.8) % 6 === 0;
        for (const ex of [73, 85]) c.rrect(ex, 44.5 + (blinkE ? 1.2 : 0), 3, blinkE ? 0.6 : 3, 1, 'white', { emit: true, flat: true });
        c.poly([[75, 52], [85, 52], [83.6, 53.2], [76.4, 53.2]], 'dark', { flat: true, emit: true });
        c.light(80, 48, 45, CYAN, 0.7);
        // the red button
        c.rrect(116, 43, 16, 7, 1.6, 'frame', O);
        c.ell(124, 45.6, 4.4, 2.4, 'redlamp', { emit: on(t, 1, 0) });
        c.rrect(115, 51.6, 18, 4.4, 0.6, 'white', O); c.text('DO NOT', 117.2, 52.4, 'accent', { s: 0.4 });
        c.light(124, 45, 18, RED, 0.5);
        floor(c, 60, 'floor', 80, { grad: [0.38, 0.72] });
        // the captain's chair
        c.z = 0.55;
        c.shadow(80, 74.4, 13, 2, 0.55);
        c.rect(79, 69, 2, 5, 'frame', { vcyl: true }); c.rrect(73, 73, 14, 1.4, 0.6, 'frame');
        c.rrect(72, 56, 16, 11, 3, 'cloth', { vcyl: true, outline: true, rim: true });
        c.rrect(69.6, 65.4, 20.8, 4.4, 1.6, 'cloth', { cyl: true, outline: true });
        for (const ax of [69, 88.6]) c.rrect(ax, 62.6, 2.4, 3.4, 0.8, 'frame', O);
      },
      objects: [
        { id: 'keycard', item: 'keycard', name: 'keycard', aliases: ['card', 'key card', 'captains keycard'], rect: [74, 62, 12, 8], at: [80, 82], base: 75, points: 5,
          draw(c) { c.z = 0.56; c.rrect(77, 64.6, 6, 3.4, 0.5, 'white', O); c.rect(77.4, 65, 5.2, 0.8, 'accent', { flat: true }); c.rect(77.8, 66.2, 1.6, 1.4, 'skin', { flat: true }); c.light(80, 66, 8, [255, 240, 200], 0.4); },
          desc: 'A keycard on the captain\'s chair.', takeMsg: 'You take the captain\'s keycard. You have never held one. It feels important. You do a small thumbs up, like the photo.' },
        { id: 'chair', name: 'captain\'s chair', aliases: ['chair', 'captains chair', 'seat', 'command chair'], rect: [68, 56, 24, 18], at: [96, 82],
          desc: g => 'The captain\'s chair, big and blue and still warm. ' + (g.has('keycard') ? '' : 'There is a keycard on the seat.'),
          verbs: { climb: 'You sit in the captain\'s chair. "Engage," you say, to nobody. It feels great. You get up again.', wait: 'You sit for a bit. Nothing engages.', search: g => (g.has('keycard') || g.flag('bay_open') ? g.say('Crumbs, and a hair the color of the captain.') : g.act('take', 'keycard')) } },
        { id: 'computer', name: 'computer', aliases: ['screen', 'face', 'ship computer', 'ai', 'console', 'terminal', 'nanny'], rect: [64, 38, 32, 20], at: [80, 82],
          desc: 'The ship\'s computer, NANNY, shown as a round blue face. It looks worried, which is new.',
          verbs: {
            talk(g) {
              if (!g.flag('met_nanny')) { g.set('met_nanny'); return g.say('"Oh! A person! Custodian, you missed the evacuation. Everyone left in the pods forty minutes ago. They had a cake. The reactor is going bad, and when it goes, so does the Pemberton. Pod 4 is still in the bay, and the pods land on Kesh. The bay is command staff only, so you will need the captain\'s keycard. I think he left it on his chair. And please, whatever you do, do not press the red button."'); }
              if (!g.flag('bay_open')) return g.say('"The captain\'s keycard opens the pod bay. It should be on his chair. Hurry, dear."');
              g.say('"Pod 4 is ready. Off you go. I will be fine. I have been meaning to read a book."');
            },
            clean: 'You wipe NANNY\'s screen. "Oh, that tickles," she says.', attack: '"Please do not," says NANNY. "I have enough going on."', kiss: 'You kiss the screen. NANNY goes a little pink.', push: 'You press some keys. NANNY sighs. "Those are the coffee settings."',
          } },
        { id: 'button', name: 'red button', aliases: ['button', 'big button', 'red', 'big red button', 'sign', 'label'], rect: [114, 42, 20, 16], at: [124, 82],
          desc: 'A big red button. The sign under it says: DO NOT PRESS. SERIOUSLY. Below that, smaller: THIS MEANS YOU, CUSTODIAN.',
          verbs: { push: g => g.die('You press the button. "Oh no," says NANNY. "That one makes the ship explode. It is in the manual." For a moment the Pemberton is the brightest thing for a long way. Then it is not.'), pull: 'It is a button. It does not pull.', clean: 'You polish the button, very carefully, without pressing it. You are sweating.', attack: g => g.act('push', 'button'), kiss: g => g.act('push', 'button') } },
        { id: 'viewport', name: 'viewport', aliases: ['window', 'stars', 'space', 'planet', 'kesh'], rect: [8, 4, 144, 30], at: [40, 82],
          desc: 'Space. A dusty orange planet hangs below with two suns over it. That is Kesh, where the pods go. You can see three little dots heading for it. That is the crew.' },
      ],
    },

    // ---------------------------------------------------------------- the pod bay
    podbay: {
      name: 'Pod Bay', horizon: 56, exits: { n: 'corridor' }, exitAt: { n: [108, 64] }, oneWay: ['n'], look: 'hd2d',
      desc: 'The pod bay. Four cradles, three of them empty. In the last one sits escape pod 4, white and round, with its hatch open. A big airlock door is on the left, and a crew locker by it. The door to the corridor is behind you, north.',
      listen: 'The reactor makes a noise like a stomach that has eaten something it regrets.',
      back(c, g, t) {
        c.z = 0.12;
        wallPanels(c, 0, 0, 160, 56, { step: 20, seam: 30, grad: [0.5, 0.25] });
        c.rect(0, 0, 160, 3, 'frame', { cyl: true });
        lamp(c, 66, 3, LAMP, { r: 60, a: 0.09 }); lamp(c, 128, 3, LAMP, { r: 70, a: 0.1 });
        siren(c, 96, 4, t, { r: 40, i: 0.5 }); siren(c, 150, 4, t, { ph: 1, r: 40, i: 0.5 });
        // the airlock
        c.z = 0.2;
        c.ell(28, 34, 16, 18, 'frame', { rim: true, outline: true });
        c.ell(28, 34, 13, 15, 'wall', { bias: -0.1 });
        c.ell(28, 34, 5.4, 5.4, 'frame', O); c.rect(14.6, 33.2, 26.8, 1.6, 'dark', { flat: true });
        c.ell(28, 34, 3, 3, 'glass', { bias: -0.2 });
        hazard(c, 10, 53.6, 36, 2); c.rect(17, 7, 22, 4, 'accent', O); c.text('SUIT UP', 18.4, 7.8, 'white', { s: 0.9 });
        c.rrect(45, 30, 3, 8, 1, 'frame', O); c.line(46.5, 36, 46.5, 31, 'redlamp', { w: 0.7, emit: true });
        // the locker
        c.rrect(56, 22, 18, 34, 1, 'robot', { vcyl: true, outline: true });
        c.rect(64.6, 23, 0.6, 32, 'dark', { flat: true });
        for (let i = 0; i < 4; i++) c.rect(58, 26 + i * 1.4, 5, 0.5, 'dark', { flat: true });
        c.rect(66.4, 38, 1.4, 3, 'hazard', { flat: true });
        // the empty cradles
        for (const x of [80, 98]) { c.rrect(x, 49, 15, 7, 1.4, 'frame', { cyl: true, outline: true }); c.ell(x + 7.5, 49, 6.6, 2, 'dark', { flat: true }); }
        floor(c, 56, 'floor', 100);
        hazard(c, 110, 58.6, 44, 1.4);
        c.z = 0.5;
        pod(c, 132, 58, { hatch: true });
      },
      objects: [
        { id: 'pod', name: 'escape pod', aliases: ['pod', 'pod 4', 'hatch', 'capsule', 'lifeboat', 'seat', 'launch button'], rect: [112, 28, 40, 30], at: [124, 66],
          desc: 'Escape pod 4. It has one seat, one big LAUNCH button and one small sticker that says ENJOY YOUR CRASH.',
          verbs: {
            enter(g) {
              g.score(10, 'launch');
              g.say('You climb into the pod, buckle up, and hit LAUNCH. The pod drops out of the Pemberton like a pea from a pod. Behind you, the ship gets smaller, and then, quite suddenly, brighter. Ahead, Kesh gets bigger, and bigger, and orange, and very close...');
              g.say('CRUNCH.');
              g.goto('crash', 82, 84);
            },
            open: g => g.act('enter', 'pod'), climb: g => g.act('enter', 'pod'), push: g => g.act('enter', 'pod'), use: { '*': g => g.act('enter', 'pod') },
            clean: 'You give the pod a quick wipe. Nobody wants to crash in a dirty pod.', search: 'One seat, a LAUNCH button, and a box under the seat marked EMERGENCY. You decide to look in it when there is an emergency.',
          } },
        { id: 'airlock', name: 'airlock', aliases: ['airlock door', 'outer door', 'round door', 'hatch door', 'lever'], rect: [10, 14, 36, 42], at: [30, 64],
          desc: 'The airlock. The sign over it says: SUIT UP FIRST. Next to it is a lever.',
          verbs: { open: g => g.die('You open the airlock. You did not suit up first. For a short time you are the fastest custodian in the galaxy.'), pull: g => g.act('open', 'airlock'), push: g => g.act('open', 'airlock'), enter: g => g.act('open', 'airlock'), clean: 'You wipe the window in the airlock door. There is nothing out there but out there.' } },
        { id: 'locker', name: 'locker', aliases: ['crew locker', 'cupboard', 'suit locker', 'suit', 'spacesuit'], rect: [54, 22, 22, 34], at: [66, 64],
          desc: 'A crew locker. The label says SPACE SUITS (12).', verbs: { open: 'Empty, apart from a coat hanger and a note: "Took the suits. Sorry. - The Crew."', search: 'Empty, apart from a coat hanger and a note: "Took the suits. Sorry. - The Crew."', clean: 'You give it a wipe. It is now the cleanest empty locker on a doomed ship.' } },
      ],
    },

    // ---------------------------------------------------------------- the crash site
    crash: {
      name: 'Crash Site', horizon: 50, exits: { e: 'dunes' }, reachedBy: 'the escape pod', look: 'golden',
      desc: 'Kesh. Sand, sky the color of a dried apricot, and two suns, both of them too hot. Escape pod 4 sits nose down in the sand, smoking. A puddle of bright green coolant is leaking from it. Dunes roll away to the east.',
      listen: 'Wind and sand, and the pod going "tick, tick" as it cools.',
      smell: 'Hot sand and burnt pod.',
      back(c, g, t) { desert(c, g, t, 50, 3); crashedPod(c, t); },
      objects: [
        { id: 'pod', name: 'escape pod', aliases: ['pod', 'pod 4', 'capsule', 'box', 'emergency box', 'seat', 'wreck'], rect: [36, 52, 50, 32], at: [82, 88],
          desc: g => 'Escape pod 4, nose down in the sand. It will not fly again. ' + (g.flag('brick_found') ? 'The emergency box is empty.' : 'There is a box under the seat marked EMERGENCY. This seems like an emergency.'),
          verbs: {
            search(g) {
              if (g.flag('brick_found')) return g.say('The box is empty, apart from a leaflet: SO YOU HAVE CRASHED.');
              g.set('brick_found'); g.give('brick'); g.score(5, 'brick'); g.emit('take');
              g.say('You open the EMERGENCY box under the seat. Inside is one Nutri-Brick, wrapped in foil, and a leaflet called SO YOU HAVE CRASHED. You take the brick. The leaflet just says "Oh dear" on every page.');
            },
            open: g => g.act('search', 'pod'), take: g => g.act('search', 'pod'), enter: 'You climb back in. It is hot, and it smells of burnt toast. You climb out.', climb: 'You climb on top of the pod and look around. Sand. More sand. Far to the east, a tower. You climb down.',
            push: 'The pod is stuck fast in the sand.', clean: 'You start to mop the pod and then you stop and think about your life.',
          } },
        { id: 'coolant', name: 'coolant', aliases: ['puddle', 'green puddle', 'green liquid', 'liquid', 'leak', 'goo'], rect: [90, 78, 28, 10], at: [104, 92],
          desc: 'A puddle of bright green coolant. It looks a bit like a fizzy drink. The label on the pod says COOLANT: DO NOT DRINK, EVEN IF THIRSTY.',
          verbs: { drink: g => g.die('You are thirsty, and it does look like a fizzy drink. It is not a fizzy drink. You glow for a while, and then you stop glowing, and then you stop.'), eat: g => g.act('drink', 'coolant'), clean: 'You mop up the coolant. The mop hisses, and you decide to stop.', take: 'You have nothing to carry it in, and you do not want it anyway.', swim: 'It is a puddle, and a nasty one.' } },
        { id: 'suns', name: 'suns', aliases: ['sun', 'sky', 'two suns'], rect: [16, 4, 40, 26], at: [40, 70], desc: 'Two suns. One would have been plenty.' },
      ],
    },

    // ---------------------------------------------------------------- the dunes
    dunes: {
      name: 'Dunes', horizon: 46, exits: { w: 'crash', e: 'spaceport' }, look: 'diorama',
      desc: g => 'Rolling dunes. A skeleton in a tattered flight suit lies half buried in the sand. ' +
        (g.flag('eel_fed') ? 'Something large is asleep under the dunes, digesting.' : 'In the middle of the way east, a mound of sand is moving in slow circles, as if something under it is waiting for lunch.') + ' A tower shows on the horizon to the east.',
      listen: g => (g.flag('eel_fed') ? 'Something under the sand is snoring.' : 'A low hiss, like sand pouring, from the moving mound.'),
      exitCheck(g, dir) {
        if (dir === 'e' && !g.flag('eel_fed')) {
          g.die('You set off east across the dunes. The moving mound stops moving. Then the ground opens up under you, and it turns out to be a mouth. A sand eel of Kesh can go a year between meals. This one does not have to.');
          return true;
        }
        return false;
      },
      back(c, g, t) {
        desert(c, g, t, 46, 7, { tower: true });
        // the skeleton, half buried
        c.z = 0.6;
        c.shadow(36, 78, 14, 2, 0.4);
        c.rrect(27, 72, 15, 4.4, 1.6, 'cloth', { cyl: true, outline: true });
        for (let i = 0; i < 3; i++) c.rect(30.4 + i * 3, 71.2, 0.8, 3.6, 'bone', { vcyl: true });
        c.ell(24.6, 72.4, 3, 2.8, 'bone', { rim: true, outline: true });
        for (const ex of [23.6, 25.6]) c.ell(ex, 72.2, 0.7, 0.8, 'dark', { flat: true });
        c.rect(41.4, 73.4, 7, 0.9, 'bone', { cyl: true }); c.rect(41.4, 75.6, 6, 0.9, 'bone', { cyl: true });
        c.rect(28, 75, 22, 4, 'sand', { grad: [0.75, 0.6] });
        // the mound, or a sleeping bump
        c.z = 0.55;
        if (!g.flag('eel_fed')) {
          const p = (t || 0) * 1.4;
          c.shadow(108, 71, 22, 3, 0.35);
          c.ell(108, 71, 19, 6.4, 'sand', { clipY: [0, 71], rim: true });
          for (let i = 0; i < 14; i++) { const a = p + i * 0.45; c.ell(108 + Math.cos(a) * 15, 70 + Math.sin(a) * 3.4, 1.2, 0.6, 'sand', { bias: -0.35, flat: true }); }
          const peek = Math.sin((t || 0) * 0.7);
          if (peek > 0.6) { const h = (peek - 0.6) * 18; c.rect(111, 66 - h, 0.8, h, 'rock', { vcyl: true }); c.ell(111.4, 65.6 - h, 1.6, 1.4, 'bone', O); c.ell(111.8, 65.6 - h, 0.7, 0.7, 'dark', { flat: true }); }
        } else {
          c.ell(108, 70, 20, 3.6, 'sand', { clipY: [0, 70], bias: 0.05 });
          for (let i = 0; i < 3; i++) { const ph = ((t || 0) * 0.5 + i / 3) % 1; c.text('Z', 112 + i * 3 + ph * 3, 64 - ph * 10, 'white', { s: 0.9 }); }
        }
      },
      objects: [
        { id: 'skeleton', name: 'skeleton', aliases: ['bones', 'skull', 'body', 'flight suit', 'pilot', 'dead pilot', 'pocket', 'pockets'], rect: [20, 64, 30, 14], at: [36, 84], base: 78,
          desc: 'What is left of a pilot, in a flight suit with a lot of pockets. He looks as if he was in a hurry to go east.',
          verbs: {
            search(g) {
              if (g.flag('token_found')) return g.say('Just sand in the pockets now, and a lot of it.');
              g.set('token_found'); g.give('token'); g.score(5, 'token'); g.emit('take');
              g.say('You go through the pockets, apologising as you go. Sand, sand, a comb, sand, and a brass token from a bar called The Dented Moon. You take the token. He was not going to use it.');
            },
            take: g => g.act('search', 'skeleton'), open: g => g.act('search', 'skeleton'), talk: 'He has nothing to say. Well, he has one thing to say, and it is "do not go east without a plan."', kiss: 'No.', attack: 'He has had a bad enough day.', clean: 'You brush the sand off his face. He looks a little happier. Or the same.',
          } },
        { id: 'eel', name: 'sand mound', aliases: ['mound', 'eel', 'sand eel', 'worm', 'monster', 'circle', 'thing', 'moving sand'], rect: [88, 60, 40, 16], at: [80, 84],
          desc: g => (g.flag('eel_fed') ? 'A long bump under the sand, rising and falling, very slowly. It is asleep.' : 'A mound of sand going round in slow circles. Every now and then a small eye on a stalk comes up, has a look at you, and goes back down.'),
          verbs: {
            give: {
              brick: feedEel,
              mop: 'The eye looks at the mop. You pull the mop back before the mouth gets a look too.',
              '*': 'The eye has a look at it and goes back down. Not food. Not interesting.',
            },
            use: { brick: feedEel, '*': 'The eye looks at it and goes back down.' },
            attack: g => (g.flag('eel_fed') ? g.say('Let sleeping eels lie.') : g.die('You poke the mound. The mound pokes back with a lot of teeth.')),
            take: g => (g.flag('eel_fed') ? g.say('It is the size of a train.') : g.die('You reach into the moving sand. Something reaches back.')),
            enter: g => (g.flag('eel_fed') ? g.say('You walk around it, politely.') : g.die('You walk right into the middle of the moving mound. The mound is a mouth, and you have walked right into it.')),
            dig: g => (g.flag('eel_fed') ? g.say('You decide not to wake it.') : g.die('You dig into the mound. The mound digs back.')),
            talk: g => g.say(g.flag('eel_fed') ? 'It snores.' : 'A small eye on a stalk pops up and looks at you hungrily.'),
            kiss: g => (g.flag('eel_fed') ? g.say('It snores at you. That is sweet, in a way.') : g.die('You lean down to kiss the mound. It leans up to kiss you, with teeth.')),
          } },
        { id: 'tower', name: 'tower', aliases: ['horizon', 'spaceport', 'town'], rect: [118, 20, 18, 26], at: [80, 84], desc: 'A tower on the horizon to the east, with a light on top. A spaceport, maybe. Where there are spaceports, there are ways off planets.' },
      ],
    },

    // ---------------------------------------------------------------- the spaceport
    spaceport: {
      name: 'Spaceport', horizon: 58, exits: { w: 'dunes' }, look: 'diorama',
      desc: 'A dusty little spaceport. A battered red and grey ship sits on the landing pad, its engine ticking. Across the way is a bar with a dented moon on its sign. The dunes are west.',
      listen: 'The ship\'s engine ticks. From the bar comes music, and a crash, and laughter.',
      back(c, g, t) {
        c.z = 0;
        c.rect(0, 0, 160, 58, 'sky', { grad: [0.9, 0.38], unlit: true, dither: true });
        suns(c, t);
        c.z = 0.1;
        for (let x = 0; x < 160; x += 1) { const h = 6 + 4 * Math.sin(x * 0.06 + 1) + 2 * Math.sin(x * 0.17); c.rect(x, 50 - h, 1, h + 8, 'rock', { flat: true, bias: -0.15 }); }
        c.z = 0.4;
        c.rect(0, 56, 160, 44, 'sand', { grad: [0.6, 0.4], dither: true });
        for (let i = 0; i < 40; i++) c.ell(hash(i, 1, 5) * 160, 60 + hash(i, 2, 5) * 40, 1.4 + hash(i, 3, 5) * 2, 0.4, 'sand', { flat: true, bias: hash(i, 4, 5) > 0.5 ? 0.25 : -0.2 });
        // the landing pad
        c.rect(4, 55, 76, 6, 'floor', { cyl: true }); hazard(c, 4, 60, 76, 1.2);
        // the bar: adobe and metal, a neon sign, glowing windows and a door
        c.z = 0.3;
        c.shadow(124, 59, 38, 3, 0.5);
        c.rect(90, 16, 68, 42, 'rock', { grad: [0.75, 0.45] });
        c.rect(88, 13, 72, 3.4, 'frame', { cyl: true });
        for (let i = 0; i < 20; i++) c.ell(92 + hash(i, 1, 6) * 64, 20 + hash(i, 2, 6) * 34, 1.2, 0.5, 'rock', { flat: true, bias: -0.25 });
        c.rect(96, 2, 52, 10, 'dark', O);
        const sign = on(t, 1.3) || Math.floor((t || 0) * 3) % 7 !== 0;
        c.ell(104, 7, 3.6, 3.6, sign ? 'lamp' : 'frame', { emit: sign }); c.ell(105.6, 6, 1.2, 1.2, 'frame', { flat: true });
        c.text('DENTED MOON', 110, 4.8, sign ? 'pinklamp' : 'frame', { emit: sign });
        if (sign) { c.light(122, 8, 45, PINK, 0.6); c.light(104, 7, 20, LAMP, 0.4); }
        for (const wx of [95, 140]) { c.rrect(wx, 26, 13, 10, 1, 'frame', O); c.rect(wx + 1, 27, 11, 8, 'lamp', { emit: true, bias: -0.35, flat: true }); c.rect(wx + 6.2, 27, 0.6, 8, 'frame', { flat: true }); c.light(wx + 6, 34, 26, LAMP, 0.5); }
        c.rect(150, 0, 1, 13, 'frame'); c.ell(150.5, 0.4, 0.8, 0.8, on(t, 0.9) ? 'redlamp' : 'accent', { emit: true });
        // barrels by the door
        for (const bx of [138, 144]) { c.shadow(bx, 58, 3.4, 0.8, 0.5); c.rrect(bx - 2.6, 50, 5.2, 8, 1.2, 'wood', { vcyl: true, outline: true }); c.rect(bx - 2.6, 52, 5.2, 0.6, 'frame', { flat: true }); c.rect(bx - 2.6, 55.6, 5.2, 0.6, 'frame', { flat: true }); }
        // Vell's ship on the pad
        rustyShip(c, 16, 52, t);
      },
      objects: [
        { id: 'bardoor', name: 'bar door', aliases: ['door', 'bar', 'dented moon', 'the dented moon', 'sign', 'building'], rect: [114, 32, 20, 26], at: [124, 66],
          draw(c) { c.z = 0.32; c.rect(116, 34, 16, 24, 'frame', O); c.rect(117.4, 36, 13.2, 22, 'wood', { vcyl: true }); c.rect(123.6, 36, 0.8, 22, 'dark', { flat: true }); c.ell(121.6, 47, 0.7, 0.7, 'brass'); c.ell(126.4, 47, 0.7, 0.7, 'brass'); for (let i = 0; i < 4; i++) c.ell(119 + hash(i, 3, 3) * 10, 50 + hash(i, 4, 3) * 6, 1.2, 0.6, 'dark', { flat: true, bias: 0.2 }); },
          desc: 'The Dented Moon. The sign is a moon with a dent in it. The door has a lot of boot marks on it, at about the height of a boot.',
          verbs: { open: g => { g.say('You push the door open and go in.'); g.goto('bar', 80, 94); }, enter: g => g.act('open', 'bardoor'), push: g => g.act('open', 'bardoor'), pull: g => g.act('open', 'bardoor'), clean: 'You wipe a boot mark off the door. There are many more.' } },
        { id: 'ship', name: 'ship', aliases: ['rocket', 'spaceship', 'red ship', 'starship', 'landing pad', 'pad', 'hatch'], rect: [20, 20, 54, 36], at: [44, 66],
          desc: 'A battered red and grey ship, with RUSTY VELL on the side. It looks as if it has been in some fights, and lost some, and kept going anyway. The hatch is locked.',
          verbs: { open: 'Locked. Whoever owns it is not here.', enter: 'The hatch is locked. Whoever owns it is not here.', push: 'It weighs about as much as a building.', clean: 'You wipe a patch of the hull clean. Under the dirt is more dirt.', attack: 'You kick the ship. Something falls off it. You put it back.' } },
        { id: 'engine', name: 'engine', aliases: ['thruster', 'exhaust', 'nozzle', 'engines'], rect: [8, 26, 12, 18], at: [24, 66],
          desc: 'The ship\'s engine, ticking as it cools. A sticker says: CHECK FOR CREW BEFORE AUTO-WARMUP.',
          verbs: { enter: g => g.die('You crawl into the engine for a better look. You did not check the sticker. The ship\'s automatic warm-up checks it for you.'), climb: g => g.act('enter', 'engine'), search: g => g.act('enter', 'engine'), clean: 'You start mopping the engine and then you read the sticker and you stop.', push: 'It is very hot.', take: 'It is very hot and it is bolted on.' } },
      ],
    },

    // ---------------------------------------------------------------- the bar
    bar: {
      name: 'The Dented Moon', horizon: 60, exits: { s: 'spaceport' }, exitAt: { s: [124, 66] }, oneWay: ['s'], look: 'neon',
      desc: g => 'The Dented Moon. Dark, loud and sticky. A robot with four arms tends the bar. A very large alien hunches on a stool. A lizard in a flight jacket sits at a table with her boots up. A slot machine glows in the corner. ' +
        (g.flag('mopped') ? 'The floor is clean. Nobody knows what to make of it.' : 'There is a big purple puddle in the middle of the floor.') + ' The door is south.',
      listen: 'A jukebox plays the one song it knows. The big alien grumbles at it.',
      smell: g => (g.flag('mopped') ? 'Fried things and spilled drinks, but less of the drinks.' : 'Fried things and spilled drinks. Mostly the purple one.'),
      back(c, g, t) {
        c.z = 0.15;
        c.rect(0, 0, 160, 60, 'plum', { grad: [0.55, 0.25] });
        for (let x = 0; x < 160; x += 8) c.rect(x, 0, 0.34, 60, 'plum', { flat: true, bias: -0.4 });
        // shelves of glowing bottles behind the bar
        for (const sy of [15, 27]) {
          c.rect(44, sy, 74, 1.4, 'wood', { cyl: true });
          for (let i = 0; i < 12; i++) {
            const m = ['pinklamp', 'cyanlamp', 'greenlamp', 'lamp', 'glass', 'punch'][(i + sy) % 6], h = 4 + hash(i, sy, 1) * 3, bx = 46 + i * 6;
            const glow = m.endsWith('lamp');
            c.rrect(bx, sy - h, 3, h, 0.9, m, { vcyl: !glow, emit: glow, bias: glow ? -0.4 : 0 });
            c.rect(bx + 0.9, sy - h - 1.4, 1.2, 1.4, 'frame', { flat: true });
          }
        }
        c.light(80, 20, 50, PINK, 0.35);
        // the neon moon
        const n = on(t, 0.8) || Math.floor((t || 0) * 5) % 9 !== 0;
        c.rrect(124, 4, 30, 18, 2, 'dark', O);
        c.ell(133, 13, 6, 6, n ? 'pinklamp' : 'plum', { emit: n }); c.ell(136, 11, 2, 2, 'dark', { flat: true });
        c.text('BAR', 141, 10.4, n ? 'cyanlamp' : 'plum', { emit: n, size: 1 });
        if (n) c.light(138, 14, 50, PINK, 0.8);
        // hanging lamps
        for (const lx of [60, 100]) { c.line(lx, 0, lx, 30, 'frame', { w: 0.34 }); c.poly([[lx - 4, 33], [lx + 4, 33], [lx + 2, 30], [lx - 2, 30]], 'frame', O); c.rect(lx - 3, 33, 6, 0.8, 'lamp', { emit: true, flat: true }); c.light(lx, 40, 48, LAMP, 0.75); c.shaft({ kind: 'cone', x: lx, y: 33.5, w0: 3, w1: 18, y1: 96, color: LAMP, a: 0.1 }); }
        // the jukebox
        c.z = 0.3;
        c.shadow(36, 56, 9, 1.6, 0.5);
        c.rrect(29, 27, 14, 29, 5, 'punch', { vcyl: true, outline: true });
        c.ell(36, 32, 5.6, 4.4, 'pinklamp', { emit: true, bias: -0.2, clipY: [0, 34] });
        c.rrect(31.6, 37, 8.8, 10, 1, 'lamp', { emit: true, bias: -0.3 });
        c.rect(32.4, 38 + (Math.floor((t || 0) * 4) % 8), 7.2, 0.8, 'redlamp', { emit: true, flat: true });
        c.light(36, 40, 30, PINK, 0.7);
        // the slot machine
        c.shadow(13, 60, 11, 1.6, 0.5);
        c.rrect(3, 28, 19, 32, 2, 'accent', { vcyl: true, outline: true });
        c.rrect(5, 33, 15, 9, 1, 'dark', { flat: true });
        const s = g.flag('jackpot') ? ['moon', 'moon', 'moon'] : ['lamp', 'greenlamp', 'cyanlamp'];
        for (let i = 0; i < 3; i++) { c.rrect(6.4 + i * 4.6, 34.4, 3.6, 6, 0.6, 'white', { emit: true, bias: -0.2 }); c.ell(8.2 + i * 4.6, 37.4, 1.2, 1.2, s[i] === 'moon' ? 'lamp' : s[i], { emit: true }); }
        c.rect(22, 33, 1.4, 9, 'frame', { vcyl: true }); c.ell(22.7, 32.4, 1.6, 1.6, 'redlamp', { emit: true });
        c.rect(7, 46, 11, 2, 'brass', { cyl: true });
        if (g.flag('jackpot') && on(t, 3)) { c.rect(5, 26, 15, 1.6, 'lamp', { emit: true, flat: true }); c.light(13, 30, 40, LAMP, 0.8); }
        c.light(12, 38, 24, LAMP, 0.5);
        // the floor: old planks
        c.z = 0.42;
        c.rect(0, 60, 160, 40, 'wood', { grad: [0.32, 0.6] });
        for (let y = 62, k = 0; y < 100; y += 3 + k * 0.8, k++) c.rect(0, y, 160, 0.34, 'wood', { flat: true, bias: -0.55 });
        for (let i = 0; i < 30; i++) { const y = 62 + hash(i, 1, 8) * 36; c.rect(hash(i, 2, 8) * 160, y, 0.34, 2, 'wood', { flat: true, bias: -0.5 }); }
      },
      objects: [
        { id: 'counter', name: 'bar counter', aliases: ['counter', 'bar', 'glasses', 'bottles', 'shelves'], rect: [40, 44, 88, 14], at: [100, 66], base: 59,
          draw(c) {
            c.z = 0.4;
            c.shadow(84, 59, 46, 2, 0.5);
            c.rect(40, 46, 88, 12.4, 'wood', { grad: [0.55, 0.3], outline: true });
            c.rrect(38.6, 43.6, 90.8, 3, 1, 'wood', { cyl: true, outline: true, rim: true });
            for (let x = 46; x < 126; x += 12) c.rect(x, 47.4, 0.34, 10, 'wood', { flat: true, bias: -0.5 });
            c.rect(40, 56.6, 88, 1.4, 'brass', { cyl: true });
            c.rrect(98, 39.6, 3, 4, 0.8, 'glass', O); c.rect(98.4, 41.6, 2.2, 1.8, 'cyanlamp', { emit: true, bias: -0.3 });
            c.rrect(60, 40.6, 3, 3, 0.8, 'glass', O); c.rect(60.4, 42, 2.2, 1.4, 'greenlamp', { emit: true, bias: -0.3 });
          },
          desc: 'A long counter, sticky in places, with glowing bottles on the shelves behind it.', verbs: { clean: 'You give the counter a wipe. "That is my job," says the robot. "The floor is yours."', climb: '"Off the bar," says the robot, with two of its arms.' } },
        { id: 'bartender', name: 'bartender', aliases: ['robot', 'barkeep', 'droid', 'server', 'splash'], rect: [62, 26, 20, 18], at: [72, 66], base: 44,
          draw(c, g, t) { c.z = 0.35; barbot(c, 72, 46, t); },
          desc: 'A robot with four arms, cleaning four glasses with four cloths. Its name tag says SPLASH.',
          verbs: {
            talk(g) {
              if (g.flag('mopped')) return g.say('"Best-looking floor this side of the suns, custodian. You ever want a job, you know where I am."');
              if (!g.flag('met_splash')) { g.set('met_splash'); return g.say('"WE DON\'T SERVE YOUR KIND," says the robot. "What kind?" you ask. "Broke," it says. Then it looks at your jumpsuit, and at your mop. "Hold on. You clean? Somebody dropped a Purple Plasma Punch on my floor and nobody here has touched a mop since the war. Mop it up and I\'ll pay you twenty-five credits."'); }
              g.say('"Twenty-five credits to mop that puddle. Standing offer."');
            },
            give: { '*': '"I don\'t want that. I want my floor clean."' },
            attack: 'The robot catches your fist in one hand and keeps polishing glasses with the other three. You go back to what you were doing.',
            kiss: '"Not on duty," says the robot.', clean: 'You polish the bar. "That is my job," says the robot. "The floor is yours."',
          } },
        { id: 'puddle', name: 'puddle', aliases: ['purple puddle', 'floor', 'spill', 'drink', 'punch', 'plasma punch', 'mess', 'sticky floor'], rect: [70, 70, 30, 10], at: [86, 86], base: 72,
          show: g => !g.flag('mopped'), draw(c, g, t) { c.z = 0.5; c.ell(84, 75, 13, 3.2, 'punch', { bias: -0.05 }); c.ell(81, 74.4, 6, 1.4, 'punch', { bias: 0.35, flat: true }); c.ell(94, 76.4, 3, 0.9, 'punch'); for (let i = 0; i < 3; i++) { const ph = ((t || 0) * 0.6 + i / 3) % 1; c.ell(80 + i * 5, 74.6 - ph * 3, 0.5, 0.5, 'punch', { bias: 0.5, flat: true }); } c.light(84, 75, 18, [200, 90, 220], 0.4); },
          desc: 'A big sticky puddle of Purple Plasma Punch. It is eating a little hole in the floor.',
          verbs: {
            use: { mop: g => g.act('clean', 'puddle'), '*': 'That will not mop anything.' },
            clean: withMop(g => {
              g.set('mopped'); earn(g, 25); g.score(10, 'mopped');
              g.say('You mop. You mop like you have never mopped before. The bar goes quiet to watch. When you are done, the floor shines, and somebody claps, once. The robot slides twenty-five credits across the counter. "Never thought I\'d see that floor again," it says.');
            }),
            drink: g => g.die('You get down on your knees and drink the Purple Plasma Punch off the floor. The whole bar goes quiet. It turns out it was on the floor for a good reason, and that reason was you.'),
            take: 'It is a puddle.', eat: g => g.act('drink', 'puddle'),
          } },
        { id: 'brute', name: 'big alien', aliases: ['alien', 'brute', 'big guy', 'monster', 'customer', 'large alien', 'stool', 'grub'], rect: [126, 30, 26, 32], at: [120, 74], base: 62,
          draw(c, g, t) { c.z = 0.5; brute(c, 140, 62, t); },
          desc: 'A very large green alien with three red eyes and a drink the size of a bucket. He is not looking at you. You would like to keep it that way.',
          verbs: {
            talk: '"GRNNH," says the alien, without turning around. You decide that was the whole conversation.',
            attack: g => g.die('You tap the big alien on the shoulder and get ready to fight. He turns around. He keeps turning around for a while, because there is a lot of him. You do not get ready in time.'),
            kiss: g => g.die('You kiss the big alien on the cheek. All three of his eyes open very wide. In his culture this means you are now married, and in his culture marriage is short.'),
            take: g => g.die('You reach for the big alien\'s drink. His hand gets there first, and then it gets to you.'),
            give: { '*': 'He sniffs it, and then he looks at you with all three eyes. You put it away and back off slowly.' },
            clean: 'You start to mop around his stool. He growls. You mop somewhere else.',
          } },
        { id: 'vell', name: 'Vell', aliases: ['lizard', 'pilot', 'captain', 'woman', 'table', 'flight jacket', 'rusty vell', 'captain vell'], rect: [34, 62, 30, 26], at: [62, 92], base: 86,
          draw(c, g, t) { c.z = 0.65; vell(c, 50, 86, t); },
          desc: 'A lizard in a red flight jacket and goggles, with her boots up on the table. She has the look of a pilot who owns a battered red and grey ship.',
          verbs: {
            talk(g) {
              if (!g.flag('met_vell')) { g.set('met_vell'); return g.say('"Ride off-world? Sure, kid. Rusty Vell will take anyone anywhere, for ' + FARE + ' credits. Cash. No, I don\'t take mops." She looks you up and down. "Pemberton, huh? Saw it blow up. Pretty. Your crew came through an hour ago, by the way. Had cake."'); }
              g.say(cash(g) >= FARE ? '"That looks like ' + FARE + ' credits to me. Hand it over, and we fly."' : '"' + FARE + ' credits, kid. ' + (cash(g) ? 'You\'ve got ' + cash(g) + '.' : 'You\'ve got nothing.') + ' Come back when you\'ve got the rest."');
            },
            give: {
              credits(g) {
                if (cash(g) < FARE) return g.say('Vell counts it. "That\'s ' + cash(g) + '. Fare\'s ' + FARE + '. I\'m a pilot, not a charity."');
                g.lose('credits'); g.set('cash', cash(g) - FARE); g.score(20, 'fare');
                g.win('Vell counts it twice, and grins with a lot of small teeth. "Welcome aboard, custodian." Her ship rattles, coughs, and lifts off into the orange sky, with the dunes falling away below and the big sand eel snoring under them. Vell puts on the autopilot and puts her boots up. "So. Where to?" You look at the stars and think about it. Then you notice the floor of her ship. It has not been mopped since the war. You get out your mop. It is going to be a long, happy trip.');
              },
              token: '"A slot token? Kid, I want credits. Go play it."', mop: '"I said no mops."', '*': '"Credits, kid. ' + FARE + ' of them."',
            },
            attack: 'Vell puts her boots down. You decide to be friends.', kiss: '"Ha! No."', clean: 'You give her table a wipe. "Thanks," she says. "Still ' + FARE + ' credits."',
          } },
        { id: 'slots', name: 'slot machine', aliases: ['slots', 'machine', 'slot', 'one armed bandit', 'lever', 'handle', 'gambling machine'], rect: [2, 26, 24, 34], at: [18, 66],
          desc: g => (g.flag('jackpot') ? 'The slot machine is still flashing JACKPOT, and looks rather sorry about it.' : 'A slot machine with three windows and a lever. It takes brass tokens. A sticker says: ONE PLAY PER CUSTOMER, AND NO HITTING.'),
          verbs: {
            use: {
              token: playSlots,
              '*': 'It only takes tokens.',
            },
            pull: g => (g.has('token') ? playSlots(g) : g.say(g.flag('jackpot') ? 'Nothing happens. The machine has done its one good deed.' : 'You pull the lever. Nothing happens. It wants a token first.')),
            play: g => g.act('pull', 'slots'), push: g => g.act('pull', 'slots'),
            attack: g => g.die('You give the slot machine a good kick, like you saw in a film. It gives you a good jolt, like nobody has ever seen. The sticker did say NO HITTING.'),
            clean: 'You wipe the glass. The three windows sparkle at you.', take: 'It is bolted to the floor, and to the wall, and to a chain.',
          } },
        { id: 'jukebox', name: 'jukebox', aliases: ['music', 'song', 'juke'], rect: [28, 26, 16, 30], at: [36, 64], desc: 'A jukebox that knows one song. Everyone here hates it, and nobody can turn it off.', verbs: { push: 'You press every button. It plays the same song.', attack: 'The big alien looks round at you, hopeful. You stop.', kiss: 'You are not that lonely yet.' } },
      ],
    },
  };

  // ---------------------------------------------------------------- Kesh: sky, suns, mesas and dunes
  function suns(c, t) {
    c.z = 0;
    c.ell(26, 12, 6, 6, 'sunlamp', { emit: true }); c.ell(48, 22, 3, 3, 'lamp', { emit: true });
    c.sunAt(26, 12);
    c.light(26, 12, 170, SUN, 0.42); c.light(48, 22, 70, LAMP, 0.15);
    c.shaft({ kind: 'sun', x: 26, y: 12, from: 0.3, to: 1.2, n: 7, color: SUN, a: 0.1 });
  }
  function desert(c, g, t, y0, seed, o) {
    o = o || {};
    c.z = 0;
    c.rect(0, 0, 160, y0, 'sky', { grad: [0.9, 0.35], unlit: true, dither: true });
    suns(c, t);
    if (o.tower) { c.z = 0.08; c.rect(126, 26, 2.4, 20, 'rock', { vcyl: true }); c.rrect(123.6, 23, 7.2, 3.4, 1, 'rock', { cyl: true }); const l = on(t, 0.8); c.ell(127.2, 21.4, 1, 1, l ? 'redlamp' : 'accent', { emit: l }); if (l) c.light(127, 22, 16, RED, 0.5); }
    c.z = 0.1;
    for (let x = 0; x < 160; x++) { const h = 5 + 4 * Math.sin(x * 0.05 + seed) + 2.5 * Math.sin(x * 0.13 + seed * 2); c.rect(x, y0 - h, 1, h + 2, 'rock', { flat: true, bias: -0.1 + (Math.sin(x * 0.5) > 0.7 ? 0.15 : 0) }); }
    c.z = 0.35;
    c.rect(0, y0, 160, 100 - y0, 'sand', { grad: [0.6, 0.4], dither: true });
    // dune ridges: a lit face toward the suns and a shaded back
    for (let k = 0; k < 4; k++) {
      const yb = y0 + 8 + k * 12, pts = [], back = [];
      for (let x = 0; x <= 160; x += 4) { const yy = yb + Math.sin(x * 0.05 + k * 2 + seed) * 3; pts.push([x, yy]); back.push([x, yy + 3.2]); }
      c.poly(pts.concat(back.reverse()), 'sand', { flat: true, bias: -0.32 });
      c.poly(pts.concat(pts.map(p => [p[0], p[1] - 1.4]).reverse()), 'sand', { flat: true, bias: 0.3 });
    }
    for (let i = 0; i < 26; i++) c.ell(hash(i, 1, seed) * 160, y0 + 4 + hash(i, 2, seed) * (96 - y0), 1 + hash(i, 3, seed) * 2, 0.4, 'sand', { flat: true, bias: hash(i, 4, seed) > 0.5 ? 0.3 : -0.3 });
    if (seed === 3) for (const [rx, ry, rw] of [[142, 70, 9], [18, 94, 6]]) { c.shadow(rx + 2, ry, rw, 1.4, 0.5); c.ell(rx, ry - rw * 0.35, rw, rw * 0.55, 'rock', { clipY: [0, ry], rim: true, outline: true }); }
  }
  function crashedPod(c, t) {
    c.z = 0.55;
    c.poly([[30, 84], [36, 78], [92, 80], [96, 86], [60, 89]], 'sand', { flat: true, bias: -0.45 }); // the scorched trench
    c.shadow(62, 84, 26, 3, 0.55);
    c.poly([[40, 78], [55, 54], [80, 58], [86, 79], [62, 85]], 'shuttle', { outline: true });
    c.poly([[44, 75], [57, 56], [76, 60], [80, 76], [62, 81]], 'shuttle', { bias: 0.15 });
    c.poly([[42, 71.4], [84, 74.6], [84.6, 76.4], [41.4, 73.4]], 'accent', { flat: true });
    c.ell(65, 65, 6, 4.4, 'glass', { rim: true, outline: true });
    c.poly([[38, 82], [84, 82], [88, 86], [34, 86]], 'sand', { grad: [0.6, 0.5] });
    for (let i = 0; i < 4; i++) { const p = ((t || 0) * 0.4 + i / 4) % 1; c.ell(68 + Math.sin(p * 6 + i) * 2.4, 52 - p * 30, 1.6 + p * 4, 1.2 + p * 3, 'mop', { flat: true, bias: -0.1 - p * 0.3 }); }
    // coolant
    c.z = 0.6;
    c.ell(104, 84, 12.4, 3.2, 'slime', { bias: 0.1 }); c.ell(101, 83.4, 6, 1.2, 'greenlamp', { emit: true, bias: -0.3 });
    if (on(t, 2)) c.ell(108, 84, 0.6, 0.6, 'white', { emit: true });
    c.light(104, 83, 26, GREEN, 0.6);
  }
  // Vell's battered red and grey ship, parked on its pad; x, y is the back end of the body at pad level
  function rustyShip(c, x, y, t) {
    c.z = 0.5;
    c.shadow(x + 30, y + 3, 36, 2.4, 0.55);
    for (const lx of [x + 8, x + 38]) { c.poly([[lx, y - 4], [lx + 4, y - 4], [lx + 6, y + 2], [lx - 2, y + 2]], 'frame', O); }
    c.rrect(x - 8, y - 26, 10, 14, 2, 'frame', { cyl: true, outline: true });
    c.ell(x - 8.4, y - 19, 1.6, 5, 'frame', { bias: -0.4 });
    c.poly([[x, y - 30], [x + 26, y - 21], [x + 50, y - 19], [x + 56, y - 11], [x + 52, y - 3], [x, y - 3]], 'shuttle', { outline: true, cyl: true, band: [y - 30, y - 3] });
    c.poly([[x, y - 30], [x + 20, y - 24], [x + 20, y - 21], [x, y - 25]], 'accent', { bias: 0.1 });
    c.rect(x + 2, y - 12, 50, 2, 'accent', { cyl: true, band: [y - 30, y - 3] });
    for (const [px, py, pw, ph] of [[x + 6, y - 20, 6, 4], [x + 30, y - 8, 7, 3], [x + 15, y - 7, 4, 3]]) c.rect(px, py, pw, ph, 'rock', { bias: -0.1, outline: true });
    c.rrect(x + 38, y - 17.4, 10, 4.6, 1.4, 'glass', { rim: true, outline: true });
    for (const wx of [x + 14, x + 21]) c.ell(wx, y - 17, 1.4, 1.4, 'glass', O);
    c.text('RUSTY VELL', x + 4, y - 6.6, 'white', { s: 0.55 });
    c.rect(x + 22, y - 31.4, 9, 2, 'accent', O);
    const tick = on(t, 2);
    c.ell(x - 8, y - 19, 1.2, 3.6, tick ? 'lamp' : 'accent', { emit: true, bias: -0.3 });
    if (tick) c.light(x - 9, y - 19, 18, [255, 150, 80], 0.5);
  }

  // which loop plays where: the synth chase on the ship, chiptune for the crash and the jukebox, the curious one in the dunes, FM at the spaceport and at the end
  const MUSIC = { hangar: 'pursuit', closet: 'pursuit', corridor: 'pursuit', bridge: 'pursuit', podbay: 'pursuit', crash: 'chase', dunes: 'curious', spaceport: 'fm', bar: 'chase' };

  const def = {
    id: 'starsweeper', title: 'Star Sweeper', maxScore: 100,
    hd: { hero: custodian },
    musicFor: (g, o) => (!g || (o && o.intro) ? 'curious' : g.state.won ? 'fm' : (Object.prototype.hasOwnProperty.call(MUSIC, g.state.room) ? MUSIC[g.state.room] : 'curious')),
    musicLabel: ['Soundtrack', 'Changes with where you are: a chase on the ship, something curious in the desert, a jukebox in the bar.'],
    start: { room: 'hangar', x: 84, y: 88 },
    intro: 'You are the junior custodian of the research ship Pemberton. You sat down in Hangar 2 for five minutes. It was longer than you meant. While you slept, the reactor started to go bad, the crew got into the escape pods, and somebody forgot to check the hangar. Now the ship is empty, the sirens are going, and there is one pod left. All you have is a mop, and you left that in the supply closet. That might be enough.',
    help: 'Walk with the arrow keys, or click where you want to go. Type what you want to do: look, look at the crate, talk to robot, take mop, mop slime, use keycard on door, give brick to eel, search skeleton. Say "inventory" to see what you carry. Talk to everyone and look at everything. A lot of things in space can kill you, and you can always try again.',
    waitText: 'You wait. Somewhere, a reactor does not.',
    items, rooms,
    onStart(g) { g.say('You wake up on the floor of Hangar 2, using your bucket as a pillow. The sun is low in the windows. A siren is going. A calm voice says, "This is not a drill. Please proceed to the escape pods." That does not sound good.'); },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = def; else root.STARSWEEPER = def;
})(typeof window !== 'undefined' ? window : globalThis);
