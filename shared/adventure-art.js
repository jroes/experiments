/*
 * Pixel-art helpers for the adventure games: a 160 x 100 picture in the 16 colours of an old EGA card.
 * Everything is drawn from code (rectangles, lines, filled shapes, dither), so there are no image files.
 * Each helper takes a Pix `c` and numbers. Colours are palette numbers 0..15 (see EGA).
 */
(function (root) {
  'use strict';

  const EGA = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
    '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'];
  // short names so scenes read well
  const K = 0, BL = 1, GR = 2, CY = 3, RD = 4, MG = 5, BR = 6, LG = 7, DG = 8, LB = 9, LGR = 10, LC = 11, LR = 12, LM = 13, YL = 14, WH = 15;

  // a stable hash so "random" speckles are the same every frame and on every device
  const hash = (a, b, c) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  class Pix {
    constructor(ctx) { this.ctx = ctx; }
    rect(x, y, w, h, col) { this.ctx.fillStyle = EGA[col]; this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    px(x, y, col) { this.ctx.fillStyle = EGA[col]; this.ctx.fillRect(Math.round(x), Math.round(y), 1, 1); }
    box(x, y, w, h, fill, edge) { this.rect(x, y, w, h, edge); this.rect(x + 1, y + 1, w - 2, h - 2, fill); }
    line(x0, y0, x1, y1, col) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let n = 0; n < 400; n++) {
        this.px(x0, y0, col);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    // filled polygon, one row at a time
    poly(pts, col) {
      let lo = 1e9, hi = -1e9;
      for (const p of pts) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
      for (let y = Math.ceil(lo); y <= Math.floor(hi); y++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) this.rect(Math.round(xs[i]), y, Math.max(1, Math.round(xs[i + 1]) - Math.round(xs[i])), 1, col);
      }
    }
    ell(cx, cy, rx, ry, col) {
      for (let y = -ry; y <= ry; y++) { const w = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry + 0.0001))); this.rect(cx - w, cy + y, w * 2 + 1, 1, col); }
    }
    // checkerboard of two colours: the old way to get a third shade
    dith(x, y, w, h, a, b, phase) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, ((i + j + (phase | 0)) & 1) ? a : b);
    }
    // scattered speckles
    speck(x, y, w, h, col, density, seed) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (hash(x + i, y + j, seed || 1) < density) this.px(x + i, y + j, col);
    }
  }

  // ----- sky, ground, far things -----
  function sky(c, h, top, bottom) {
    const bands = 5, bh = Math.ceil(h / bands);
    for (let i = 0; i < bands; i++) {
      c.rect(0, i * bh, 160, bh, i < bands / 2 ? top : bottom);
      if (i === Math.floor(bands / 2) - 1 || i === Math.floor(bands / 2)) c.dith(0, i * bh + (i < bands / 2 ? bh - 2 : 0), 160, 2, top, bottom, i);
    }
  }
  function ground(c, y0, base, spot, seed) {
    c.rect(0, y0, 160, 100 - y0, base);
    c.speck(0, y0, 160, 100 - y0, spot, 0.07, seed || 3);
  }
  function hills(c, y, col, seed, amp) {
    for (let x = 0; x < 160; x++) {
      const h = Math.round((amp || 8) * (0.55 + 0.45 * Math.sin(x * 0.045 + (seed || 0)) * Math.sin(x * 0.017 + (seed || 0) * 2)));
      c.rect(x, y - h, 1, h + 1, col);
    }
  }
  function mountain(c, x, y, w, h, col, snow) {
    c.poly([[x, y], [x + w / 2, y - h], [x + w, y]], col);
    if (snow) c.poly([[x + w / 2 - w / 6, y - h + h / 3], [x + w / 2, y - h], [x + w / 2 + w / 6, y - h + h / 3], [x + w / 2 + 1, y - h + h / 4], [x + w / 2 - 2, y - h + h / 3.4]], snow);
  }
  function cloud(c, x, y, col) { c.ell(x, y, 8, 3, col || WH); c.ell(x - 5, y + 1, 5, 2, col || WH); c.ell(x + 6, y + 1, 5, 2, col || WH); }
  function sun(c, x, y, r) { c.ell(x, y, r, r, YL); c.ell(x, y, r - 2, r - 2, WH); }
  function moon(c, x, y) { c.ell(x, y, 5, 5, WH); c.ell(x + 2, y - 1, 4, 4, DG); }

  // ----- plants and rocks (x, y is the base, where it meets the ground) -----
  function tree(c, x, y, s) {
    s = s || 1;
    const th = Math.round(14 * s), tw = Math.max(2, Math.round(3 * s));
    c.rect(x - Math.floor(tw / 2), y - th, tw, th, BR);
    c.rect(x - Math.floor(tw / 2), y - th, 1, th, DG === 8 ? 0 : 0);
    const r = Math.round(9 * s);
    c.ell(x, y - th - r + 3, r, r - 1, GR);
    c.ell(x - Math.round(r * 0.55), y - th - Math.round(r * 0.2), Math.round(r * 0.7), Math.round(r * 0.6), GR);
    c.ell(x + Math.round(r * 0.55), y - th - Math.round(r * 0.2), Math.round(r * 0.7), Math.round(r * 0.6), GR);
    c.speck(x - r, y - th - 2 * r + 2, 2 * r, 2 * r, LGR, 0.14, x + y);
    c.speck(x - r, y - th - 2 * r + 2, 2 * r, 2 * r, K, 0.05, x * 3 + y);
  }
  function pine(c, x, y, s) {
    s = s || 1;
    const h = Math.round(26 * s), w = Math.round(14 * s);
    c.rect(x - 1, y - 4, 3, 4, BR);
    for (let i = 0; i < 3; i++) {
      const top = y - h + i * Math.round(h / 4.2), bw = Math.round(w * (0.5 + i * 0.28));
      c.poly([[x, top], [x + bw / 2, top + Math.round(h / 2.6)], [x - bw / 2, top + Math.round(h / 2.6)]], i % 2 ? GR : GR);
      c.speck(x - bw / 2, top, bw, Math.round(h / 2.6), LGR, 0.07, x + i);
    }
  }
  function bush(c, x, y, s) { s = s || 1; c.ell(x, y - 3 * s, Math.round(7 * s), Math.round(4 * s), GR); c.speck(x - 7 * s, y - 7 * s, 14 * s, 8 * s, LGR, 0.12, x); }
  function rock(c, x, y, w, col) { const h = Math.max(3, Math.round(w * 0.6)); c.ell(x, y - Math.floor(h / 2), Math.round(w / 2), Math.ceil(h / 2), col === undefined ? LG : col); c.speck(x - w / 2, y - h, w, h, DG, 0.2, x); c.px(x - 2, y - h + 1, WH); }
  function flower(c, x, y, col) { c.px(x, y, GR); c.px(x, y - 1, GR); c.px(x, y - 2, col); c.px(x - 1, y - 2, col === YL ? WH : YL); }
  function flowers(c, x, y, w, h, seed) { for (let i = 0; i < Math.round(w * h / 170); i++) flower(c, x + Math.floor(hash(i, seed, 1) * w), y + Math.floor(hash(i, seed, 2) * h), [LR, YL, WH, LM, LB][i % 5]); }
  function fence(c, x0, x1, y) {
    c.rect(x0, y - 5, x1 - x0, 1, BR); c.rect(x0, y - 3, x1 - x0, 1, BR);
    for (let x = x0; x <= x1; x += 8) c.rect(x, y - 7, 2, 7, BR);
  }
  function logs(c, x, y) { c.rect(x, y - 3, 14, 3, BR); c.rect(x, y - 3, 2, 3, YL); c.rect(x + 12, y - 3, 2, 3, YL); }

  // ----- buildings -----
  function house(c, x, y, w, h, roof, wall) {
    c.rect(x, y - h, w, h, wall === undefined ? YL : wall);
    c.speck(x, y - h, w, h, BR, 0.05, x);
    c.poly([[x - 3, y - h], [x + w / 2, y - h - Math.round(h * 0.6)], [x + w + 3, y - h]], roof === undefined ? RD : roof);
    c.line(x - 3, y - h, x + w + 3, y - h, K);
  }
  function door(c, x, y, w, h, col) { c.rect(x, y - h, w, h, col === undefined ? BR : col); c.px(x + w - 2, y - Math.round(h / 2), YL); c.rect(x, y - h, w, 1, K); }
  function window_(c, x, y, w, h) { c.rect(x, y, w, h, LC); c.rect(x + Math.floor(w / 2), y, 1, h, K); c.rect(x, y + Math.floor(h / 2), w, 1, K); c.rect(x - 1, y - 1, w + 2, 1, BR); c.rect(x - 1, y + h, w + 2, 1, BR); }
  function wall(c, x, y, w, h, col) { c.rect(x, y, w, h, col === undefined ? LG : col); for (let j = 0; j < h; j += 4) { c.rect(x, y + j, w, 1, DG); for (let i = (j / 4 % 2) * 4; i < w; i += 8) c.rect(x + i, y + j, 1, 4, DG); } }
  function battlements(c, x, y, w) { for (let i = 0; i < w; i += 6) c.rect(x + i, y - 3, 4, 3, LG); c.rect(x, y, w, 1, DG); }
  function tower(c, x, y, w, h) {
    wall(c, x, y - h, w, h, LG); battlements(c, x - 1, y - h, w + 2);
    c.rect(x + Math.floor(w / 2) - 1, y - h + 8, 2, 5, K);
  }
  function arch(c, x, y, w, h) { c.rect(x, y - h + w / 2, w, h - w / 2, K); c.ell(x + Math.floor(w / 2), y - h + Math.floor(w / 2), Math.floor(w / 2), Math.floor(w / 2), K); }
  function flag(c, x, y, col) { c.rect(x, y - 12, 1, 12, BR); c.poly([[x + 1, y - 12], [x + 8, y - 10], [x + 1, y - 8]], col); }

  // ----- water, fire, small things -----
  function water(c, x, y, w, h, t) {
    c.rect(x, y, w, h, BL);
    for (let j = 2; j < h; j += 4) for (let i = 0; i < w; i += 6) {
      const o = Math.round(Math.sin((t || 0) * 1.5 + i * 0.7 + j) * 1.5);
      c.rect(x + ((i + j * 3) % w) + o, y + j, 3, 1, LB);
    }
  }
  function campfire(c, x, y, t) {
    c.rect(x - 4, y - 1, 9, 2, DG);
    const f = Math.floor((t || 0) * 8) % 3;
    c.poly([[x - 3, y - 1], [x, y - 8 - f], [x + 3, y - 1]], RD);
    c.poly([[x - 2, y - 1], [x, y - 6 - f], [x + 2, y - 1]], YL);
  }
  function torch(c, x, y, t) { c.rect(x, y - 6, 1, 6, BR); const f = Math.floor((t || 0) * 9) % 2; c.rect(x - 1, y - 9 - f, 3, 3, YL); c.px(x, y - 10 - f, RD); }
  function star(c, x, y) { c.px(x, y, WH); }

  // ----- people and animals -----
  // a figure with a robe, a head and a hat (the steward, the troll's friends, the old woman)
  function person(c, x, y, o) {
    o = o || {};
    const robe = o.robe === undefined ? MG : o.robe, hat = o.hat;
    c.rect(x - 4, y - 9, 9, 9, robe); c.rect(x - 5, y - 2, 11, 2, robe);
    c.rect(x - 3, y - 9, 7, 1, o.trim === undefined ? YL : o.trim);
    c.rect(x - 2, y - 14, 5, 5, LR);
    c.rect(x - 2, y - 15, 5, 2, o.hair === undefined ? WH : o.hair);
    if (hat !== undefined) { c.rect(x - 3, y - 16, 7, 2, hat); c.rect(x - 2, y - 19, 5, 3, hat); }
    c.px(x - 1, y - 12, K); c.px(x + 1, y - 12, K);
    if (o.beard) c.rect(x - 2, y - 11, 5, 3, o.beard);
    if (o.arm) { c.rect(x + 5, y - 9, 2, 5, robe); }
  }
  function hero(c, x, y, dir, moving, step) {
    x = Math.round(x); y = Math.round(y);
    const f = moving ? (Math.floor(step / 4) & 1) : 0;
    // legs
    c.rect(x - 2, y - 4, 2, 4, BL); c.rect(x + 1, y - 4, 2, 4, BL);
    if (f) { c.rect(x - 2, y - 1, 2, 1, BL); c.rect(x + 1, y - 4, 2, 3, BL); c.rect(x - 2, y - 4, 2, 2, BL); }
    c.rect(x - 2, y - 1 + (f ? 0 : 0), 2, 1, BR); c.rect(x + 1, y - 1, 2, 1, BR);
    // tunic and belt
    c.rect(x - 3, y - 9, 7, 5, LB); c.rect(x - 3, y - 6, 7, 1, YL);
    // arms
    c.rect(x - 4, y - 9, 1, 4, LB); c.rect(x + 4, y - 9, 1, 4, LB);
    // head
    c.rect(x - 2, y - 13, 5, 4, LR);
    c.rect(x - 2, y - 14, 5, 2, BR);
    c.rect(x - 3, y - 15, 7, 2, RD); c.px(x + 2, y - 17, WH); c.px(x + 3, y - 16, WH); // cap and feather
    if (dir === 'd') { c.px(x - 1, y - 11, K); c.px(x + 1, y - 11, K); }
    else if (dir === 'l') { c.px(x - 2, y - 11, K); c.rect(x + 1, y - 13, 2, 3, BR); }
    else if (dir === 'r') { c.px(x + 2, y - 11, K); c.rect(x - 2, y - 13, 2, 3, BR); }
    else { c.rect(x - 2, y - 13, 5, 3, BR); }
  }
  function crow(c, x, y, t, col) { c.ell(x, y, 3, 2, col === undefined ? K : col); c.px(x + 3, y - 1, YL); c.rect(x - 4, y, 2, 1, K); const w = Math.floor((t || 0) * 3) % 2; if (w) c.rect(x - 1, y - 3, 3, 1, K); }
  function bear(c, x, y) { c.ell(x, y - 6, 11, 6, BR); c.ell(x + 9, y - 8, 5, 4, BR); c.rect(x + 7, y - 13, 2, 2, BR); c.rect(x + 12, y - 13, 2, 2, BR); c.px(x + 11, y - 9, K); c.px(x + 13, y - 8, K); c.rect(x - 8, y - 2, 3, 2, BR); c.rect(x + 3, y - 2, 3, 2, BR); }
  function bee(c, x, y, t) { const o = Math.round(Math.sin((t || 0) * 8 + x) * 1); c.px(x, y + o, YL); c.px(x + 1, y + o, K); }
  function fish(c, x, y, col) { c.ell(x, y, 3, 1, col); c.px(x - 4, y - 1, col); c.px(x - 4, y + 1, col); }

  function chest(c, x, y) { c.box(x - 5, y - 7, 11, 7, BR, K); c.rect(x - 5, y - 4, 11, 1, YL); c.rect(x, y - 5, 1, 2, YL); }
  function sign(c, x, y) { c.rect(x, y - 10, 1, 10, BR); c.box(x - 6, y - 14, 13, 6, BR, K); c.rect(x - 4, y - 12, 9, 1, YL); c.rect(x - 4, y - 10, 5, 1, YL); }
  function bucket(c, x, y) { c.rect(x - 2, y - 4, 5, 4, BR); c.rect(x - 2, y - 4, 5, 1, DG); }
  function lamp(c, x, y, lit) { c.rect(x - 1, y - 5, 3, 5, lit ? YL : DG); c.rect(x - 2, y - 6, 5, 1, K); c.rect(x - 1, y - 7, 3, 1, DG); }
  function jewel(c, x, y, t) { c.poly([[x - 2, y - 3], [x + 2, y - 3], [x + 3, y - 1], [x, y + 1], [x - 3, y - 1]], RD); c.px(x - 1, y - 2, WH); if (Math.floor((t || 0) * 3) % 4 === 0) c.px(x + 2, y - 4, WH); }

  const api = { EGA, Pix, hash, K, BL, GR, CY, RD, MG, BR, LG, DG, LB, LGR, LC, LR, LM, YL, WH,
    sky, ground, hills, mountain, cloud, sun, moon, tree, pine, bush, rock, flower, flowers, fence, logs, house, door, window: window_, wall, battlements, tower, arch, flag,
    water, campfire, torch, star, person, hero, crow, bear, bee, fish, chest, sign, bucket, lamp, jewel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AdvArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
