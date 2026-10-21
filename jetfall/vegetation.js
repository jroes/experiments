/*
 * Jetfall vegetation and rocks: shapes made in code, and where they stand. No DOM: the tests run it in node.
 *
 * Every shape is normalised (a tree is 1 unit tall, a rock about 1 across) and placed with a model matrix, like the
 * renderer's boxes. A shape has a solid part { P, N, I } drawn with the mesh shader (bark, kind -5; rock, kind -2)
 * and, for plants, cards { P, N, T, I }: quads cut out by a foliage texture (T = u, v, card layer, ambient occlusion).
 * Card normals point out of the crown, not across the quad, so a tree is lit like a soft ball and not like paper.
 *
 * Only to look at: nothing here collides. Trees stand outside the mission area and on the hills around the map, so
 * they never sit in a ski line or stop a disc; inside the area there are only bushes, which you pass through like grass.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'));
  else root.JFVeg = factory(root.JF);
})(typeof self !== 'undefined' ? self : this, function (JF) {
  'use strict';

  // ---------- a little 3D noise for rock shapes ----------
  function hash3(x, y, z, s) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise3(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const L = (a, b, t) => a + (b - a) * t;
    const c = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
    return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
  }

  // ---------- geometry helpers ----------
  class Builder {
    constructor() { this.P = []; this.N = []; this.T = []; this.I = []; }
    get n() { return this.P.length / 3; }
    v(p, nrm, t) { this.P.push(p[0], p[1], p[2]); this.N.push(nrm[0], nrm[1], nrm[2]); if (t) this.T.push(t[0], t[1], t[2], t[3]); return this.n - 1; }
    tri(a, b, c) { this.I.push(a, b, c); }
    out() { return { P: this.P, N: this.N, T: this.T, I: this.I }; }
  }
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // a tapered tube from a to b, radius ra to rb, `seg` sides
  function tube(B, a, b, ra, rb, seg) {
    const d = norm(sub(b, a));
    const up = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    const x = norm(cross(up, d)), z = cross(d, x);
    const base = B.n;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      const off = add(mul(x, c), mul(z, s));
      B.v(add(a, mul(off, ra)), off);
      B.v(add(b, mul(off, rb)), off);
    }
    for (let i = 0; i < seg; i++) { const k = base + i * 2; B.tri(k, k + 2, k + 1); B.tri(k + 1, k + 2, k + 3); }
  }

  // a card: a quad from `from` along `dir` (length L), `side` across (width W), drooping `droop` at the tip.
  // u runs across, v from the tip (0) to the base (1) to match the baked foliage images. nrm(p) gives the light normal.
  function card(B, from, dir, side, L, W, droop, layer, nrm, ao0, ao1) {
    const tip = add(add(from, mul(dir, L)), [0, -droop, 0]);
    const h = mul(side, W / 2);
    const mid = add(add(from, mul(dir, L * 0.5)), [0, -droop * 0.3, 0]);
    const pts = [add(from, mul(h, -1)), add(from, h), add(mid, mul(h, -1)), add(mid, h), add(tip, mul(h, -1)), add(tip, h)];
    const vs = [[0, 1], [1, 1], [0, 0.5], [1, 0.5], [0, 0], [1, 0]];
    const aos = [ao0, ao0, (ao0 + ao1) / 2, (ao0 + ao1) / 2, ao1, ao1];
    const k = B.n;
    pts.forEach((p, i) => B.v(p, nrm(p), [vs[i][0], vs[i][1], layer, aos[i]]));
    B.tri(k, k + 1, k + 2); B.tri(k + 1, k + 3, k + 2); B.tri(k + 2, k + 3, k + 4); B.tri(k + 3, k + 5, k + 4);
  }

  // ---------- shapes ----------
  // A boulder: a sphere pushed in and out by noise, flattened, with a flat bottom so it sits.
  function rock(seed) {
    const B = new Builder();
    // icosphere, 2 subdivisions
    const t = (1 + Math.sqrt(5)) / 2;
    let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
    let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < 2; s++) {
      const mid = new Map(), NF = [];
      const m = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!mid.has(k)) { V.push(norm(mul(add(V[a], V[b]), 0.5))); mid.set(k, V.length - 1); } return mid.get(k); };
      for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); NF.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      F = NF;
    }
    const sx = 0.9 + hash3(seed, 1, 0, 9) * 0.5, sz = 0.9 + hash3(seed, 2, 0, 9) * 0.5, sy = 0.8 + hash3(seed, 3, 0, 9) * 0.35;
    const P = V.map(d => {
      const r = 1 + (1 - Math.abs(noise3(d[0] * 1.6 + seed, d[1] * 1.6, d[2] * 1.6, seed) * 2 - 1)) * 0.28 + (noise3(d[0] * 4 + 7, d[1] * 4, d[2] * 4, seed) - 0.5) * 0.16;
      // flat-ish facets: pull each point toward the nearest of a few planes
      let y = d[1] * r * sy;
      if (y < -0.3) y = -0.3 - (y + 0.3) * 0.08;
      return [d[0] * r * sx * 0.5, y * 0.5 + 0.06, d[2] * r * sz * 0.5];
    });
    const N = P.map(() => [0, 0, 0]);
    for (const [a, b, c] of F) { const n = cross(sub(P[b], P[a]), sub(P[c], P[a])); for (const i of [a, b, c]) N[i] = add(N[i], n); }
    P.forEach((p, i) => B.v(p, norm(N[i])));
    for (const [a, b, c] of F) B.tri(a, b, c);
    return B.out();
  }

  // A fir: a trunk, whorls of drooping branch cards getting shorter toward the top, a tuft at the top.
  function conifer(seed, lod) {
    const bark = new Builder(), fol = new Builder();
    tube(bark, [0, -0.02, 0], [0, 1.0, 0], 0.028, 0.004, lod ? 5 : 7);
    tube(bark, [0, -0.04, 0], [0, 0.06, 0], 0.045, 0.028, lod ? 5 : 7);
    const whorls = lod ? 5 : 11, per = lod ? 4 : 7;
    const out = p => norm([p[0], 0.55 + p[1] * 0.2, p[2]]);
    for (let k = 0; k < whorls; k++) {
      const h = 0.16 + k / whorls * 0.8;
      const R = 0.34 * Math.pow(1 - (h - 0.1) / 0.92, 0.95) + 0.04;
      for (let i = 0; i < per; i++) {
        const a = i / per * Math.PI * 2 + k * 1.1 + hash3(seed, k, i, 3) * 0.6;
        const dir = [Math.cos(a), -0.12, Math.sin(a)];
        const side = [-Math.sin(a), 0, Math.cos(a)];
        const ao0 = 0.35 + 0.5 * h, ao1 = 0.75 + 0.25 * h;
        const L = R * (0.85 + hash3(seed, k, i, 4) * 0.3);
        card(fol, [0, h, 0], norm(dir), side, L, L * 0.75, L * 0.25, 0, out, ao0, ao1);
        if (!lod) {
          // a second card tilted across the first, so the branch has some depth seen edge-on
          const s2 = norm([side[0] * 0.5, 0.85, side[2] * 0.5]);
          card(fol, [0, h + 0.01, 0], norm([dir[0], 0.05, dir[2]]), s2, L * 0.8, L * 0.45, L * 0.12, 0, out, ao0, ao1);
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI;
      card(fol, [0, 0.82, 0], [0, 1, 0], [Math.cos(a), 0, Math.sin(a)], 0.2, 0.09, 0, 0, out, 0.8, 1);
    }
    return { bark: bark.out(), fol: fol.out() };
  }

  // A broadleaf tree: a trunk splitting into a few limbs, a crown of leaf-cluster cards.
  function broadleaf(seed, lod) {
    const bark = new Builder(), fol = new Builder();
    const seg = lod ? 5 : 7;
    tube(bark, [0, -0.03, 0], [0, 0.42, 0], 0.045, 0.03, seg);
    const limbs = [];
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + hash3(seed, i, 0, 5) * 1.2;
      const end = [Math.cos(a) * 0.17, 0.66 + hash3(seed, i, 1, 5) * 0.12, Math.sin(a) * 0.17];
      tube(bark, [0, 0.38, 0], end, 0.026, 0.008, seg);
      limbs.push(end);
    }
    const C = [0, 0.66, 0], RX = 0.3, RY = 0.22;
    const out = p => norm([(p[0] - C[0]) / RX, (p[1] - C[1]) / RY + 0.3, (p[2] - C[2]) / RX]);
    // the crown is a few lumps round the ends of the limbs, not one ball
    const lumps = limbs.map((e, i) => [e[0] * 0.9, e[1] - 0.02 + hash3(seed, i, 11, 6) * 0.05, e[2] * 0.9]).concat([[0, 0.8, 0]]);
    const n = lod ? 16 : 52;
    for (let i = 0; i < n; i++) {
      const L = lumps[i % lumps.length], lr = 0.15 + hash3(seed, i % lumps.length, 12, 6) * 0.05;
      const u = hash3(seed, i, 7, 6) * 2 - 1, th = hash3(seed, i, 8, 6) * Math.PI * 2;
      const r = Math.sqrt(1 - u * u), shell = 0.65 + hash3(seed, i, 9, 6) * 0.35;
      const p = [L[0] + Math.cos(th) * r * lr * shell, L[1] + u * lr * 0.8 * shell, L[2] + Math.sin(th) * r * lr * shell];
      const o = norm(sub(p, C));
      const side = norm(cross(o, [0, 1, 0.01]));
      const along = norm(cross(side, o));
      const S = (lod ? 0.26 : 0.19) * (0.85 + hash3(seed, i, 10, 6) * 0.3);
      const from = add(p, mul(along, -S / 2));
      const ao = 0.45 + 0.55 * (0.5 + 0.5 * u) * shell;
      card(fol, from, along, side, S, S, 0, 1, out, ao, ao);
    }
    void limbs;
    return { bark: bark.out(), fol: fol.out() };
  }

  // A dead tree: a bent trunk and bare branches.
  function deadTree(seed) {
    const bark = new Builder();
    let p = [0, -0.03, 0], r = 0.04;
    const pts = [p];
    for (let i = 0; i < 4; i++) {
      const q = [p[0] + (hash3(seed, i, 0, 8) - 0.5) * 0.08, p[1] + 0.24, p[2] + (hash3(seed, i, 1, 8) - 0.5) * 0.08];
      tube(bark, p, q, r, r * 0.75, 6);
      p = q; r *= 0.75; pts.push(p);
    }
    for (let i = 0; i < 6; i++) {
      const s = pts[1 + (i % 3)], a = hash3(seed, i, 2, 8) * Math.PI * 2;
      const e = [s[0] + Math.cos(a) * 0.22, s[1] + 0.12 + hash3(seed, i, 3, 8) * 0.12, s[2] + Math.sin(a) * 0.22];
      tube(bark, s, e, 0.016, 0.003, 5);
      const e2 = [e[0] + Math.cos(a + 0.8) * 0.08, e[1] + 0.07, e[2] + Math.sin(a + 0.8) * 0.08];
      tube(bark, e, e2, 0.004, 0.0015, 4);
    }
    return { bark: bark.out(), fol: null };
  }

  // A bush: a low ball of leaf cards. 1 unit tall.
  function bush(seed) {
    const fol = new Builder();
    const C = [0, 0.42, 0], RX = 0.6, RY = 0.42;
    const out = p => norm([(p[0] - C[0]) / RX, (p[1] - C[1]) / RY + 0.4, (p[2] - C[2]) / RX]);
    for (let i = 0; i < 18; i++) {
      const u = hash3(seed, i, 7, 2) * 1.6 - 0.6, th = hash3(seed, i, 8, 2) * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u)), shell = 0.6 + hash3(seed, i, 9, 2) * 0.35;
      const p = [Math.cos(th) * r * RX * shell, C[1] + u * RY * shell, Math.sin(th) * r * RX * shell];
      const o = norm(sub(p, C));
      const side = norm(cross(o, [0, 1, 0.01]));
      const along = norm(cross(side, o));
      const S = 0.62;
      card(fol, add(p, mul(along, -S / 2)), along, side, S, S, 0, 1, out, 0.5 + 0.5 * (0.5 + 0.5 * u), 0.6 + 0.4 * (0.5 + 0.5 * u));
    }
    return { bark: null, fol: fol.out() };
  }

  // ---------- where things go ----------
  // look.veg: { trees: density 0..1, conifer: share of firs (the rest broadleaf), dead: share of dead trees,
  //             bushes: density inside the area, tint: foliage colour, snowy: snow on the foliage }
  // heightAt(x, z) must cover the land outside the map too (the renderer's ring of hills).
  // Returns { trees: [{ kind, x, y, z, s, yaw, tilt }], bushes: [...] }. Deterministic per map.
  function plant(world, heightAt) {
    const def = world.def, look = def.look, veg = look.veg;
    const out = { trees: [], bushes: [] };
    if (!veg) return out;
    const t = world.terrain, rng = JF.mulberry(def.seed * 13 + 5);
    const { AREA_MIN, AREA_MAX, SIZE } = JF;
    const lowH = t.waterH != null ? t.waterH + 1.5 : t.lavaH != null ? t.lavaH + 3 : -1e9;
    // the snow line in metres, from the look (0..1 of the land's height range)
    let hmin = Infinity, hmax = -Infinity;
    for (let i = 0; i <= JF.N; i += 4) for (let j = 0; j <= JF.N; j += 4) { const h = t.at(i, j); if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
    const treeLine = veg.snowy ? Infinity : hmin + (hmax - hmin) * Math.max(0.2, look.snowLine - 0.12);
    const slopeAt = (x, z) => { const e = 3; const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e); return Math.hypot(dx, dz) / (2 * e); };
    const clump = (x, z) => JF.fbm(x / 260, z / 260, def.seed + 77, 3, 0.5) * 0.5 + 0.5;
    const kindOf = () => { const r = rng(); return r < (veg.dead || 0) ? 'dead' : r < (veg.dead || 0) + (veg.conifer == null ? 0.6 : veg.conifer) * (1 - (veg.dead || 0)) ? 'fir' : 'oak'; };
    const reach = 650, step = 11;
    if (veg.trees > 0) {
      for (let x = -reach; x < SIZE + reach; x += step) {
        for (let z = -reach; z < SIZE + reach; z += step) {
          const px = x + (rng() - 0.5) * step * 0.9, pz = z + (rng() - 0.5) * step * 0.9;
          // outside the mission area only, with a margin so none leans into it
          const out_ = Math.max(AREA_MIN - px, px - AREA_MAX, AREA_MIN - pz, pz - AREA_MAX);
          if (out_ < 12) continue;
          const beyond = Math.max(-px, px - SIZE, -pz, pz - SIZE);
          // thinner further out, where only the fog sees them
          const keep = veg.trees * Math.min(1, Math.max(0, (clump(px, pz) - 0.3) * 3)) * (beyond > 0 ? Math.max(0.25, 1 - beyond / reach) : 1);
          if (rng() > keep) continue;
          const y = heightAt(px, pz);
          if (y < lowH || y > treeLine) continue;
          if (slopeAt(px, pz) > 0.55) continue;
          const kind = kindOf();
          const s = (kind === 'fir' ? 19 : kind === 'oak' ? 14 : 11) * (0.7 + rng() * 0.6);
          out.trees.push({ kind, x: px, y: y - 0.3, z: pz, s, yaw: rng() * Math.PI * 2, tilt: (rng() - 0.5) * 0.06 });
        }
      }
    }
    if (veg.bushes > 0) {
      const clear = [];
      for (const b of world.bases) clear.push([b.o.x, b.o.z, 70]);
      for (const sld of world.solids) if (sld.team < 0) clear.push([(sld.b[0] + sld.b[3]) / 2, (sld.b[2] + sld.b[5]) / 2, Math.max(sld.b[3] - sld.b[0], sld.b[5] - sld.b[2]) / 2 + 3]);
      const bstep = 9;
      for (let x = AREA_MIN - 200; x < AREA_MAX + 200; x += bstep) {
        for (let z = AREA_MIN - 200; z < AREA_MAX + 200; z += bstep) {
          const px = x + (rng() - 0.5) * bstep, pz = z + (rng() - 0.5) * bstep;
          if (rng() > veg.bushes * Math.min(1, Math.max(0, (clump(px + 400, pz) - 0.45) * 3))) continue;
          if (clear.some(c => (c[0] - px) ** 2 + (c[1] - pz) ** 2 < c[2] * c[2])) continue;
          const y = heightAt(px, pz);
          if (y < lowH || y > treeLine || slopeAt(px, pz) > 0.5) continue;
          out.bushes.push({ kind: 'bush', x: px, y: y - 0.15, z: pz, s: 0.8 + rng() * 1.1, yaw: rng() * Math.PI * 2, tilt: 0 });
        }
      }
    }
    return out;
  }

  return { rock, conifer, broadleaf, deadTree, bush, plant, noise3 };
});
