/*
 * Jetfall models: armor, weapons, flags, base things and projectiles, all made of boxes, spheres and cylinders.
 * Each function adds instances to the renderer for one frame. Browser only (needs the Renderer), no game rules here.
 *
 * Conventions: a model's forward is -z; `partM(parent, o, rx, rz, p, s)` turns a part by rx about x (positive tips a hanging
 * part forward) and rz about z at offset o, then puts it at p and scales it. Materials are [glow, kind, extra, gloss] as in
 * render.js: kind -4 is armour plating (fine seams), -3 cloth, 0 plain.
 */
(function (root) {
  'use strict';
  const JF = root.JF;
  const { M4 } = root.JFRender;

  const DARK = [0.16, 0.17, 0.19], MID = [0.38, 0.39, 0.42], LIGHT = [0.7, 0.71, 0.74], METAL = [0.55, 0.57, 0.6];
  const RUBBER = [0.1, 0.1, 0.11], BRASS = [0.72, 0.56, 0.26], WARM = [1, 0.95, 0.85];
  const PLATE = -4, CLOTH = -3;
  const PL = [0, PLATE, 0, 0.55];   // armour plating
  const SHAPE = {
    light:  { s: 1.0,  b: 1.0 },
    medium: { s: 1.15, b: 1.18 },
    heavy:  { s: 1.3,  b: 1.45 },
  };
  const mix = (a, t, k) => [a[0] + (t[0] - a[0]) * k, a[1] + (t[1] - a[1]) * k, a[2] + (t[2] - a[2]) * k];

  // matrices without allocation where it matters
  const tmpA = new Float32Array(16), tmpB = new Float32Array(16), tmpC = new Float32Array(16);
  function base(x, y, z, yaw, pitch) {
    const m = new Float32Array(16);
    root.JFRender.trs(m, 0, x, y, z, yaw, pitch || 0, 1, 1, 1);
    return m;
  }
  // part = parent * T(o) * Rx(rx) * Rz(rz) * T(p) * S(s)
  function partM(parent, ox, oy, oz, rx, rz, px, py, pz, sx, sy, sz) {
    root.JFRender.trs(tmpA, 0, ox, oy, oz, 0, rx, 1, 1, 1, rz);
    root.JFRender.trs(tmpB, 0, px, py, pz, 0, 0, sx, sy, sz);
    M4.mul(tmpA, tmpB, tmpC);
    return M4.mul(parent, tmpC, new Float32Array(16));
  }
  function child(parent, ox, oy, oz, rx, rz) {
    root.JFRender.trs(tmpA, 0, ox, oy, oz, 0, rx || 0, 1, 1, 1, rz || 0);
    return M4.mul(parent, tmpA, new Float32Array(16));
  }
  // shape helpers in a parent's space: a box, a cylinder along y, z (rx) or x (rz), a sphere
  function kit(r, m) {
    return {
      box: (x, y, z, sx, sy, sz, col, mat) => r.putM('box', partM(m, x, y, z, 0, 0, 0, 0, 0, sx, sy, sz), col, mat),
      cylY: (x, y, z, d, h, col, mat) => r.putM('cyl', partM(m, x, y, z, 0, 0, 0, 0, 0, d, h, d), col, mat),
      cylZ: (x, y, z, d, len, col, mat) => r.putM('cyl', partM(m, x, y, z, Math.PI / 2, 0, 0, 0, 0, d, len, d), col, mat),
      cylX: (x, y, z, d, len, col, mat) => r.putM('cyl', partM(m, x, y, z, 0, Math.PI / 2, 0, 0, 0, d, len, d), col, mat),
      sph: (x, y, z, d, col, mat) => r.putM('sphere', partM(m, x, y, z, 0, 0, 0, 0, 0, d, d, d), col, mat),
      tilt: (x, y, z, rx, rz, sx, sy, sz, kind, col, mat) => r.putM(kind || 'box', partM(m, x, y, z, rx, rz, 0, 0, 0, sx, sy, sz), col, mat),
    };
  }

  // weapon shapes, in the hand's space: barrel along -z, the grip hanging under the origin
  function weapon(r, hand, wk, team, glowK) {
    const k = kit(r, hand);
    const g = glowK || 0;
    const hot = (c, extra) => [c[0] * (1 + g * 0.3), c[1], c[2], 0]; void hot;
    // the grip and trigger guard are the same on every gun
    k.box(0, -0.15, 0.08, 0.07, 0.2, 0.1, RUBBER, [0, 0, 0, 0.2]);
    k.box(0, -0.06, 0.0, 0.03, 0.03, 0.14, DARK, [0, 0, 0, 0.5]);
    switch (wk) {
      case 'disc':
        k.box(0, 0, -0.1, 0.17, 0.2, 0.62, MID, [0, PLATE, 0, 0.6]);
        k.box(0, 0.12, -0.2, 0.08, 0.05, 0.3, DARK, [0, 0, 0, 0.6]);
        for (const s of [-1, 1]) k.box(s * 0.2, 0.02, -0.46, 0.05, 0.12, 0.34, DARK, [0, 0, 0, 0.6]);
        k.cylY(0, 0.02, -0.42, 0.42, 0.06, [0.75, 0.85, 1.0], [0.5 + g, 0, 0, 0.9]);
        k.cylY(0, 0.02, -0.42, 0.47, 0.02, [0.5, 0.8, 1.6], [2.0 + g, 0, 0, 0.3]);
        k.cylZ(0, 0.15, 0.06, 0.14, 0.3, DARK, [0, 0, 0, 0.5]);
        k.box(0, -0.02, 0.3, 0.12, 0.15, 0.2, DARK, [0, PLATE, 0, 0.4]);
        break;
      case 'chain':
        for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + (r.spin || 0); k.cylZ(Math.cos(a) * 0.055, Math.sin(a) * 0.055, -0.45, 0.05, 0.62, METAL, [0, 0, 0, 0.85]); }
        k.cylZ(0, 0, -0.3, 0.17, 0.05, DARK, [0, 0, 0, 0.6]);
        k.cylZ(0, 0, -0.64, 0.17, 0.04, DARK, [0, 0, 0, 0.6]);
        k.box(0, 0, -0.02, 0.2, 0.22, 0.45, DARK, [0, PLATE, 0, 0.5]);
        k.box(0, 0.16, 0.0, 0.05, 0.06, 0.26, MID, [0, 0, 0, 0.6]);
        k.box(0.16, -0.04, 0.02, 0.1, 0.17, 0.24, [0.5, 0.42, 0.2], [0, PLATE, 0, 0.4]);
        k.box(0.12, 0.04, -0.08, 0.06, 0.05, 0.12, BRASS, [0, 0, 0, 0.8]);
        if (g > 0.05) k.sph(0, 0, -0.8, 0.05 + 0.12 * g, [3, 2.2, 1.2], [2 + g, 0, 0, 0]);
        break;
      case 'plasma':
        k.box(0, 0, -0.18, 0.14, 0.15, 0.6, [0.3, 0.22, 0.18], [0, PLATE, 0, 0.5]);
        k.cylZ(0, 0.06, -0.52, 0.09, 0.3, METAL, [0, 0, 0, 0.8]);
        for (let i = 0; i < 3; i++) k.cylZ(0, 0.06, -0.2 - i * 0.12, 0.17, 0.05, [1.0, 0.5, 0.1], [1.2 + g, 0, 0, 0.3]);
        k.cylZ(0, -0.03, 0.14, 0.12, 0.24, DARK, [0, 0, 0, 0.6]);
        k.box(0, 0.13, 0.02, 0.03, 0.06, 0.16, DARK, [0, 0, 0, 0.5]);
        break;
      case 'gl':
        k.cylZ(0, 0.02, -0.3, 0.16, 0.56, [0.3, 0.36, 0.25], [0, PLATE, 0, 0.45]);
        k.cylZ(0, 0.02, -0.59, 0.19, 0.05, DARK, [0, 0, 0, 0.6]);
        k.cylX(0, -0.06, -0.06, 0.3, 0.14, [0.3, 0.36, 0.25], [0, PLATE, 0, 0.4]);
        k.box(0, 0.14, -0.12, 0.03, 0.06, 0.16, DARK, [0, 0, 0, 0.5]);
        k.box(0, -0.04, 0.22, 0.12, 0.16, 0.26, DARK, [0, PLATE, 0, 0.4]);
        break;
      case 'mortar':
        k.cylZ(0, 0.04, -0.25, 0.26, 0.8, [0.32, 0.36, 0.26], [0, PLATE, 0, 0.45]);
        k.cylZ(0, 0.04, -0.67, 0.3, 0.08, DARK, [0, 0, 0, 0.6]);
        for (const z of [-0.1, -0.4]) k.cylZ(0, 0.04, z, 0.29, 0.05, DARK, [0, 0, 0, 0.6]);
        k.box(0, -0.1, 0.16, 0.24, 0.26, 0.3, DARK, [0, PLATE, 0, 0.5]);
        k.cylZ(0.18, -0.1, -0.1, 0.07, 0.4, METAL, [0, 0, 0, 0.85]);
        k.box(0, 0.22, 0.05, 0.05, 0.05, 0.2, RUBBER, [0, 0, 0, 0.2]);
        break;
      case 'laser':
        k.box(0, 0, -0.35, 0.07, 0.09, 0.95, LIGHT, [0, PLATE, 0, 0.85]);
        k.cylZ(0, 0, -0.84, 0.045, 0.14, [0.2, 1.0, 0.4], [1.5 + g, 0, 0, 0.2]);
        k.cylZ(0, 0.11, -0.15, 0.06, 0.3, DARK, [0, 0, 0, 0.8]);
        k.sph(0, 0.11, 0.0, 0.055, [0.3, 0.8, 0.5], [0.8, 0, 0, 0.9]);
        k.box(0, -0.03, 0.28, 0.08, 0.14, 0.22, DARK, [0, PLATE, 0, 0.4]);
        for (const s of [-1, 1]) k.box(s * 0.045, 0.0, -0.5, 0.02, 0.05, 0.3, DARK, [0, 0, 0, 0.5]);
        break;
      case 'elf':
        k.box(0, 0, -0.12, 0.18, 0.18, 0.46, [0.25, 0.25, 0.4], [0, PLATE, 0, 0.5]);
        k.cylZ(0, 0, -0.22, 0.2, 0.14, [0.35, 0.4, 0.6], [0.3 + g, 0, 0, 0.4]);
        for (const s of [-1, 1]) { k.box(s * 0.09, 0, -0.5, 0.035, 0.035, 0.3, LIGHT, [0, 0, 0, 0.8]); k.sph(s * 0.09, 0, -0.66, 0.05, [0.5, 0.6, 1.0], [2 + g, 0, 0, 0.2]); }
        break;
      default: // blaster
        k.box(0, 0, -0.12, 0.1, 0.13, 0.42, [0.5, 0.18, 0.15], [0, PLATE, 0, 0.5]);
        k.cylZ(0, 0.02, -0.44, 0.06, 0.3, METAL, [0, 0, 0, 0.8]);
        k.sph(0, 0.02, -0.6, 0.06, [1, 0.4, 0.25], [1.5 + g, 0, 0, 0.2]);
        k.box(0, 0.09, 0.0, 0.06, 0.05, 0.16, [1, 0.3, 0.2], [0.9, 0, 0, 0.3]);
        for (const s of [-1, 1]) k.box(s * 0.07, 0.02, -0.3, 0.02, 0.1, 0.2, DARK, [0, 0, 0, 0.5]);
    }
    void team;
  }

  // anim: { phase, ski, air, jet, speed } kept by the page per player
  function player(r, p, anim, opts) {
    const sh = SHAPE[p.armor] || SHAPE.light, s = sh.s, b = sh.b;
    const team = JF.TEAMS[p.team].rgb;
    // the whole suit is painted in the team colour so you can tell sides apart at a distance:
    // bright chest, pauldrons and helmet crest, tinted limbs, glowing shoulder lights and jets in the team colour
    const tc = [team[0], team[1], team[2]];
    const dk = mix(DARK, team, 0.35), md = mix(MID, team, 0.55), lt = mix(LIGHT, team, 0.3);
    const heavy = p.armor === 'heavy';
    const root_ = base(p.pos[0], p.pos[1], p.pos[2], p.yaw, 0);
    const ground = p.ground && !p.jetting;
    const run = ground && !p.skiing ? Math.min(1, anim.speed / 7) : 0;
    const sw = Math.sin(anim.phase) * 0.75 * run;
    const crouch = p.skiing ? 0.18 : 0;
    const hipY = (0.95 - crouch) * s;
    const air = !p.ground;
    // a hit makes the whole suit flash
    const fl = opts && opts.flash ? Math.min(1, opts.flash) : 0;
    const put = fl > 0
      ? (kind, m, col, mat) => r.putM(kind, m, [col[0] + (1 - col[0]) * fl * 0.7, col[1] + (0.75 - col[1]) * fl * 0.7, col[2] + (0.6 - col[2]) * fl * 0.7], [(mat ? mat[0] : 0) + fl * 1.8, mat ? mat[1] : 0, mat ? mat[2] : 0, mat ? mat[3] : 0.3])
      : (kind, m, col, mat) => r.putM(kind, m, col, mat);
    const rr = { putM: put, spin: r.spin };
    // legs: hip joint, thigh with a plate, knee, shin with a guard, boot
    for (const side of [-1, 1]) {
      const rx = air ? 0.35 + side * 0.08 : p.skiing ? (side > 0 ? -0.5 : 0.2) : sw * side;
      const leg = child(root_, side * 0.15 * b, hipY, 0, rx, 0);
      const L = kit(rr, leg);
      L.sph(0, 0, 0, 0.24 * b, dk, [0, 0, 0, 0.5]);
      L.box(0, -0.27 * s, 0, 0.2 * b, 0.5 * s, 0.22 * b, dk, PL);
      L.box(0, -0.25 * s, -0.11 * b, 0.22 * b, 0.36 * s, 0.05, tc, PL);
      const knee = child(leg, 0, -0.5 * s, 0, p.skiing ? 0.7 : air ? 0.5 : Math.max(0, -sw * side) * 0.9, 0);
      const K = kit(rr, knee);
      K.sph(0, 0, 0, 0.2 * b, md, [0, 0, 0, 0.6]);
      K.box(0, -0.22 * s, 0, 0.17 * b, 0.42 * s, 0.19 * b, md, PL);
      K.box(0, -0.2 * s, -0.1 * b, 0.15 * b, 0.3 * s, 0.05, lt, [0, 0, 0, 0.7]);
      K.box(0, -0.45 * s, -0.05, 0.2 * b, 0.12, 0.34 * b, DARK, [0, 0, 0, 0.4]);
      K.box(0, -0.5 * s, -0.08, 0.21 * b, 0.04, 0.36 * b, RUBBER, [0, 0, 0, 0.2]);
      K.box(0, -0.42 * s, -0.19 * b, 0.16 * b, 0.08, 0.1, md, [0, 0, 0, 0.6]);
      if (p.skiing) K.box(0, -0.53 * s, -0.05, 0.24 * b, 0.02, 0.5 * b, mix(tc, [1, 1, 1], 0.3), [1.2, 0, 0, 0.9]);
    }
    // body
    const lean = p.skiing ? 0.35 : air ? 0.12 : run * 0.15;
    const torso = child(root_, 0, hipY, 0, -lean, 0);
    const T = kit(rr, torso);
    T.box(0, 0.06 * s, 0, 0.4 * b, 0.2 * s, 0.26 * b, DARK, PL);                               // belt
    T.box(0, 0.05 * s, -0.14 * b, 0.18 * b, 0.1 * s, 0.05, md, [0, 0, 0, 0.6]);                 // buckle
    for (const side of [-1, 1]) T.box(side * 0.19 * b, 0.03 * s, -0.07 * b, 0.1 * b, 0.12 * s, 0.1 * b, dk, [0, 0, 0, 0.3]); // pouches
    T.box(0, 0.26 * s, 0, 0.56 * b, 0.46 * s, 0.34 * b, tc, [0.12, PLATE, 0, 0.6]);             // chest
    T.box(0, 0.36 * s, -0.18 * b, 0.36 * b, 0.2 * s, 0.05, lt, [0, 0, 0, 0.7]);                 // chest plate ridge
    T.box(0, 0.3 * s, -0.21 * b, 0.22 * b, 0.045 * s, 0.03, tc, [1.6, 0, 0, 0.3]);              // chest light bar
    T.box(0, 0.51 * s, 0, 0.36 * b, 0.08 * s, 0.3 * b, md, [0, 0, 0, 0.6]);                     // collar
    // pack: a body, tanks, two nozzles tilted back, a light in the pack's colour
    const packCol = p.pack === 'shield' ? [0.3, 0.5, 1] : p.pack === 'repair' ? [0.3, 1, 0.4] : p.pack === 'energy' ? [1, 0.85, 0.3] : p.pack === 'ammo' ? [0.8, 0.6, 0.3] : MID;
    T.box(0, 0.3 * s, 0.25 * b, 0.46 * b, 0.5 * s, 0.2 * b, md, PL);
    T.box(0, 0.44 * s, 0.36 * b, 0.22 * b, 0.1 * s, 0.03, packCol, [0.9, 0, 0, 0.2]);
    for (const side of [-1, 1]) {
      T.cylY(side * 0.12 * b, 0.4 * s, 0.37 * b, 0.11 * b, 0.3 * s, METAL, [0, 0, 0, 0.85]);
      T.tilt(side * 0.15 * b, 0.1 * s, 0.3 * b, 0.35, 0, 0.12 * b, 0.16 * s, 0.12 * b, 'cyl', p.jetting ? mix([1, 1, 1], team, 0.5) : DARK, [p.jetting ? 3 : 0, 0, 0, 0.5]);
      T.tilt(side * 0.15 * b, 0.0 * s, 0.34 * b, 0.35, 0, 0.15 * b, 0.05, 0.15 * b, 'cyl', DARK, [0, 0, 0, 0.6]);
      if (heavy) T.cylY(side * 0.3 * b, 0.32 * s, 0.3 * b, 0.1 * b, 0.34 * s, dk, PL);
    }
    // shoulders: a joint, a pauldron, a light
    for (const side of [-1, 1]) {
      T.sph(side * 0.33 * b, 0.45 * s, 0, 0.2 * b, dk, [0, 0, 0, 0.5]);
      T.tilt(side * 0.37 * b, 0.52 * s, 0, 0, side * 0.3, 0.26 * b, 0.1, 0.34 * b, 'box', tc, PL);
      T.tilt(side * 0.37 * b, 0.575 * s, 0, 0, side * 0.3, 0.14 * b, 0.05, 0.28 * b, 'box', tc, [2.2, 0, 0, 0.2]);
      if (heavy) T.tilt(side * 0.44 * b, 0.5 * s, 0, 0, side * 0.3, 0.14 * b, 0.16, 0.38 * b, 'box', dk, PL);
    }
    // head turns with the aim: neck, helmet, crest, visor, chin guard, ear pods
    const head = child(torso, 0, 0.6 * s, 0, -p.pitch * 0.5 + lean, 0);
    const H = kit(rr, head);
    H.cylY(0, 0.03 * s, 0, 0.14 * b, 0.1 * s, DARK, [0, 0, 0, 0.4]);
    H.box(0, 0.18 * s, 0, 0.27 * b, 0.28 * s, 0.3 * b, md, PL);
    H.box(0, 0.32 * s, 0.02, 0.2 * b, 0.05, 0.24 * b, tc, PL);
    H.box(0, 0.2 * s, -0.15 * b, 0.22 * b, 0.07 * s, 0.03, [team[0] * 0.6 + 0.4, team[1] * 0.6 + 0.4, team[2] * 0.6 + 0.4], [2.2, 0, 0, 0.9]);
    H.box(0, 0.09 * s, -0.14 * b, 0.24 * b, 0.06 * s, 0.05, DARK, [0, 0, 0, 0.5]);
    for (const side of [-1, 1]) H.cylX(side * 0.15 * b, 0.18 * s, 0, 0.1 * b, 0.05, dk, [0, 0, 0, 0.6]);
    if (heavy) H.cylY(0.1 * b, 0.42 * s, 0.08, 0.02, 0.2 * s, LIGHT, [0, 0, 0, 0.8]);
    // arms: both reach forward to the gun, pitched with the aim. Upper arm, elbow, forearm, glove.
    const shoulder = child(torso, 0, 0.45 * s, 0, lean + p.pitch * 0.9, 0);
    for (const side of [-1, 1]) {
      const arm = child(shoulder, side * 0.36 * b, 0, 0, side > 0 ? 1.1 : 0.95, -side * 0.15);
      const A = kit(rr, arm);
      A.box(0, -0.16 * s, 0, 0.15 * b, 0.32 * s, 0.16 * b, dk, PL);
      A.sph(0, -0.32 * s, 0, 0.17 * b, md, [0, 0, 0, 0.6]);
      const fore = child(arm, 0, -0.32 * s, 0, side > 0 ? 0.35 : 0.5, -side * 0.35);
      const F = kit(rr, fore);
      F.box(0, -0.14 * s, 0, 0.13 * b, 0.28 * s, 0.14 * b, md, PL);
      F.box(0, -0.3 * s, 0, 0.12 * b, 0.1 * s, 0.12 * b, DARK, [0, 0, 0, 0.3]);
    }
    const hand = child(shoulder, 0.18 * b, -0.02, -0.48 * s, 0, 0);
    if (p.weapon) weapon(rr, hand, p.weapon, team, opts && opts.fireGlow);
    // carried flag on the back
    if (p.hasFlag && opts && opts.flagTeam != null) {
      const ft = JF.TEAMS[opts.flagTeam].rgb;
      const fb = child(torso, 0, 0.3 * s, 0.35 * b, 0.25, 0);
      flagShape(rr, fb, ft, opts.time || 0, 0.8);
    }
  }

  // a pole with a finial and the cloth flying from it, waving in two directions
  function flagShape(r, m, team, t, scale) {
    const k = scale || 1;
    const K = kit(r, m);
    K.cylY(0, 0.08 * k, 0, 0.3 * k, 0.16 * k, DARK, [0, 0, 0, 0.5]);
    K.cylY(0, 1.4 * k, 0, 0.07, 2.8 * k, LIGHT, [0, 0, 0, 0.9]);
    K.cylY(0, 2.82 * k, 0, 0.12, 0.08, BRASS, [0, 0, 0, 0.9]);
    K.sph(0, 2.92 * k, 0, 0.18, mix(team, [1, 1, 1], 0.5), [2, 0, 0, 0.5]);
    // cloth: segments that wave, pitched to follow the wave so it reads as one sheet
    const segs = 7, w = 1.6 * k / segs;
    const wave = i => Math.sin(t * 6 - i * 0.9) * 0.14 * (i + 1) / segs + Math.sin(t * 2.3 + i * 0.5) * 0.04;
    for (let i = 0; i < segs; i++) {
      const x = (i + 0.5) * w, z = wave(i), dz = (wave(i + 1) - wave(i)) / w;
      const sag = 0.08 * k * (i / segs) * (i / segs);
      const edge = i === segs - 1;
      r.putM('box', partM(m, x, 2.35 * k - sag, z, 0, -Math.atan(dz) * 0.0 , 0, 0, 0, w * 1.08, 0.95 * k, 0.03 + (edge ? 0.0 : 0)), team, [0.8, CLOTH, 0, 0.1]);
      void dz;
    }
    // a pale stripe along the bottom edge of the cloth
    for (let i = 0; i < segs; i++) {
      const x = (i + 0.5) * w, z = wave(i), sag = 0.08 * k * (i / segs) * (i / segs);
      r.putM('box', partM(m, x, 1.9 * k - sag, z, 0, 0, 0, 0, 0, w * 1.08, 0.07, 0.035), mix(team, [1, 1, 1], 0.6), [1.2, CLOTH, 0, 0.1]);
    }
  }

  function flag(r, f, t) {
    const team = JF.TEAMS[f.team].rgb;
    flagShape(r, base(f.pos[0], f.pos[1], f.pos[2], t * 0.3, 0), team, t, 1);
  }

  // base things: generator, stations, turrets, sensor. so = the object from the snapshot (hp, up, power, yaw, pitch)
  function object(r, o, so, t) {
    const team = JF.TEAMS[o.team].rgb;
    const b = o.b, cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    const sx = b[3] - b[0], sy = b[4] - b[1], sz = b[5] - b[2];
    const live = so ? so.up && so.power : true;
    const dead = so ? !so.up : false;
    const pulse = 0.6 + 0.4 * Math.sin(t * 4 + o.id);
    const K = kit(r, base(cx, b[1], cz, 0, 0));
    if (o.kind === 'gen') {
      // a frame of four columns, plates top and bottom, the glowing core with rings riding up and down it, coils and pipes
      for (const ix of [-1, 1]) for (const iz of [-1, 1]) K.cylY(ix * (sx / 2 - 0.2), sy / 2, iz * (sz / 2 - 0.2), 0.3, sy, MID, [0, 0, 0, 0.7]);
      K.box(0, 0.2, 0, sx, 0.4, sz, DARK, [0, PLATE, 0, 0.5]);
      K.box(0, sy - 0.2, 0, sx, 0.4, sz, DARK, [0, PLATE, 0, 0.5]);
      K.box(0, 0.45, 0, sx * 0.8, 0.1, sz * 0.8, dead ? DARK : team, [dead ? 0 : 1.2, 0, 0, 0.3]);
      const coreCol = dead ? [0.15, 0.12, 0.1] : team;
      K.tilt(0, sy / 2, 0, 0, 0, sx * 0.5, sy - 0.9, sz * 0.5, 'cyl', coreCol, [dead ? 0 : 1.0 + pulse * 0.8, 0, 0, 0.8]);
      r.putM('cyl', partM(base(cx, b[1] + sy / 2, cz, t * (dead ? 0 : 2), 0), 0, 0, 0, 0, 0, 0, 0, 0, sx * 0.3, sy - 1.0, sz * 0.3), dead ? DARK : mix(team, [1, 1, 1], 0.5), [dead ? 0 : 1.6, 0, 0, 0.9]);
      for (let i = 0; i < 3; i++) K.cylY(0, 0.9 + i * 0.9 + (dead ? 0 : Math.sin(t * 2 + i) * 0.1), 0, sx * 0.72, 0.14, METAL, [0, 0, 0, 0.9]);
      for (const ix of [-1, 1]) { K.cylY(ix * sx * 0.45, sy * 0.5, 0, 0.26, sy * 0.5, dead ? DARK : mix(team, DARK, 0.5), [dead ? 0 : 0.6 * pulse, 0, 0, 0.5]); K.cylZ(ix * sx * 0.45, sy * 0.78, 0, 0.1, sz * 0.9, METAL, [0, 0, 0, 0.8]); }
      for (const iz of [-1, 1]) K.cylX(0, 0.7, iz * sz * 0.45, 0.12, sx * 1.4, [0.33, 0.34, 0.38], [0, 0, 0, 0.7]);
      K.sph(0, sy + 0.1, 0, 0.3, dead ? DARK : mix(team, [1, 1, 1], 0.5), [dead ? 0 : 1.6, 0, 0, 0.5]);
    } else if (o.kind === 'station') {
      // an alcove against the wall: a glowing pad to stand on, a back panel with a screen, two posts and a lit canopy
      const c = dead ? [0.6, 0.12, 0.05] : live ? team : [0.25, 0.25, 0.25];
      const w = o.wall || 1, zw = (w > 0 ? b[5] : b[2]) - cz, glow = live ? 1 + pulse * 0.8 : 0.15;
      const H = 3.0, pr = Math.min(sx, sz);
      K.box(0, 0.05, 0, sx + 0.3, 0.1, sz + 0.3, DARK, [0, 0, 0, 0.4]);
      K.box(0, sy / 2, 0, sx, sy, sz, MID, [0, 1, 0, 0.5]);
      K.cylY(0, sy + 0.015, -w * 0.15, pr * 0.8, 0.03, c, [glow, 0, 0, 0.2]);
      K.cylY(0, sy + 0.03, -w * 0.15, pr * 0.5, 0.02, DARK, [0, 0, 0, 0.3]);
      // back panel, screen, indicator lights
      K.box(0, H / 2, zw - w * 0.1, sx, H, 0.2, DARK, [0, 1, 0, 0.5]);
      K.box(0, 1.9, zw - w * 0.22, sx * 0.55, 0.75, 0.05, c, [live ? 1.2 : 0.1, 0, 0, 0.3]);
      for (let i = 0; i < 3; i++) K.box(-sx * 0.35 + i * 0.25, 1.2, zw - w * 0.22, 0.12, 0.08, 0.04, i === 0 ? [0.3, 1, 0.4] : i === 1 ? [1, 0.8, 0.2] : [1, 0.3, 0.2], [live ? 1.5 : 0.1, 0, 0, 0.3]);
      K.box(0, 0.6, zw - w * 0.22, sx * 0.7, 0.3, 0.06, MID, [0, 0.3, 0, 0.6]);
      // posts, canopy, a lamp under it, a cable up the wall
      for (const x of [-sx / 2 + 0.12, sx / 2 - 0.12]) K.box(x, H / 2, zw - w * 0.35, 0.24, H, 0.5, MID, [0, 0, 0, 0.6]);
      K.box(0, H, zw - w * 0.6, sx + 0.1, 0.22, 1.2, MID, [0, 1, 0, 0.6]);
      K.box(0, H - 0.13, zw - w * 0.75, sx * 0.8, 0.03, 0.18, c, [glow * 1.5, 0, 0, 0.2]);
      K.cylY(sx * 0.4, H + 0.6, zw - w * 0.1, 0.08, 1.2, [0.33, 0.34, 0.38], [0, 0, 0, 0.7]);
      // a hologram of a suit turns over the pad while it works
      if (live) {
        const hm = base(cx, b[1] + sy + 0.5, cz - w * 0.15, t * 1.2, 0);
        const hc = mix(team, [1, 1, 1], 0.5);
        const hg = [1.8 + pulse * 0.5, 0, 0, 0.2];
        r.putM('box', partM(hm, 0, 0, 0, 0, 0, 0, 0.95, 0, 0.45, 0.5, 0.25), hc, hg);
        r.putM('box', partM(hm, 0, 0, 0, 0, 0, 0, 1.4, 0, 0.22, 0.24, 0.24), hc, hg);
        for (const sdx of [-1, 1]) r.putM('box', partM(hm, 0, 0, 0, 0, 0, sdx * 0.14, 0.35, 0, 0.16, 0.65, 0.18), hc, hg);
      }
    } else if (o.kind === 'turret') {
      // a base plate, a pedestal, a yoke that turns, the gun that pitches with twin barrels and an eye
      K.box(0, 0.15, 0, sx, 0.3, sz, DARK, [0, PLATE, 0, 0.5]);
      K.cylY(0, 0.6, 0, 1.0, 0.6, MID, [0, 0, 0, 0.6]);
      const yaw = so ? so.yaw : 0, pitch = so ? so.pitch : 0;
      const ym = base(cx, b[1] + 0.9, cz, yaw, 0);
      const Y = kit(r, ym);
      Y.cylY(0, 0.05, 0, 1.3, 0.1, dead ? DARK : team, [dead ? 0 : 1.0, 0, 0, 0.3]);
      for (const s of [-1, 1]) Y.box(s * 0.65, 0.35, 0.1, 0.12, 0.7, 0.9, dead ? [0.2, 0.18, 0.16] : MID, [0, 0, 0, 0.6]);
      const hm = base(cx, b[1] + 1.1, cz, yaw, dead ? -0.5 : pitch);
      const G = kit(r, hm);
      G.box(0, 0, 0, 1.0, 0.55, 1.1, dead ? [0.2, 0.18, 0.16] : MID, [0, PLATE, 0, 0.6]);
      G.box(0, 0.1, -0.56, 0.6, 0.14, 0.05, dead ? DARK : team, [live ? 2 : 0, 0, 0, 0.2]);
      G.sph(0, 0.32, -0.2, 0.22, dead ? DARK : [1, 0.3, 0.2], [live ? 2.5 * pulse : 0, 0, 0, 0.4]);
      for (const s of [-1, 1]) {
        G.cylZ(s * 0.28, 0, -0.95, 0.14, 1.0, METAL, [0, 0, 0, 0.85]);
        G.cylZ(s * 0.28, 0, -0.75, 0.2, 0.3, DARK, [0, 0, 0, 0.6]);
        G.cylZ(s * 0.28, 0, -1.42, 0.17, 0.08, DARK, [0, 0, 0, 0.6]);
      }
      G.box(0, -0.1, 0.65, 0.5, 0.3, 0.3, DARK, [0, 0, 0, 0.5]);
    } else if (o.kind === 'sensor') {
      // a dish on the mast that turns, with a feed horn held out in front
      const dm = base(cx, b[1] + 1.0, cz, dead ? 0 : t * 0.8, 0.25);
      K.cylY(0, 0.4, 0, 0.6, 0.8, DARK, [0, 0, 0, 0.5]);
      K.cylY(0, 0.85, 0, 0.9, 0.1, dead ? DARK : team, [dead ? 0 : 0.8, 0, 0, 0.3]);
      const D = kit(r, dm);
      D.tilt(0, 0.4, 0, 1.2, 0, 3.0, 0.15, 3.0, 'cyl', dead ? DARK : LIGHT, [0, 0, 0, 0.8]);
      D.tilt(0, 0.4, 0, 1.2, 0, 2.2, 0.08, 2.2, 'cyl', dead ? DARK : [0.8, 0.82, 0.86], [0, 0, 0, 0.9]);
      D.tilt(0, 0.4, 0, 1.2, 0, 0.5, 0.3, 0.5, 'cyl', DARK, [0, 0, 0, 0.6]);
      for (const a of [0, 2.1, 4.2]) { const sm = child(dm, 0, 0.4, 0, 1.2, 0); r.putM('cyl', partM(sm, 0, 0, 0, 0, a, 0, 0, 0, 0.05, 1.4, 0.05), METAL, [0, 0, 0, 0.8]); }
      D.tilt(0, 0.4, 0, 1.2, 0, 0.06, 1.4, 0.06, 'cyl', METAL, [0, 0, 0, 0.8]);
      D.sph(0, 0.65, -0.55, 0.35, dead ? DARK : team, [live ? 2.5 * pulse : 0, 0, 0, 0.3]);
      D.box(0, -0.2, 0.4, 0.5, 0.4, 0.6, DARK, [0, 0, 0, 0.5]);
    }
  }

  function projectile(r, q, t) {
    const p = q.pos;
    if (q.kind === 'disc') {
      const m = base(p[0], p[1], p[2], t * 25, 0);
      r.putM('cyl', partM(m, 0, 0, 0, 0, 0, 0, 0, 0, 0.55, 0.1, 0.55), [0.8, 0.9, 1.0], [1.4, 0, 0, 1]);
      r.putM('cyl', partM(m, 0, 0, 0, 0, 0, 0, 0, 0, 0.62, 0.04, 0.62), [0.5, 0.8, 1.6], [3, 0, 0, 0.3]);
      r.putM('cyl', partM(m, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.14, 0.2), DARK, [0, 0, 0, 0.8]);
    } else if (q.kind === 'gl' || q.kind === 'hgren') {
      const m = base(p[0], p[1], p[2], t * 10, t * 7);
      r.putM('sphere', partM(m, 0, 0, 0, 0, 0, 0, 0, 0, 0.26, 0.26, 0.26), [0.25, 0.32, 0.2], [0.3, 0, 0, 0.6]);
      r.putM('cyl', partM(m, 0, 0, 0, 0, 0, 0, 0, 0, 0.28, 0.06, 0.28), DARK, [0, 0, 0, 0.7]);
      r.putM('cyl', partM(m, 0, 0, 0, 0, 0, 0, 0.15, 0, 0.1, 0.06, 0.1), [1, 0.3, 0.2], [2, 0, 0, 0.3]);
    } else if (q.kind === 'mortar') {
      const v = q.vel, sp = Math.hypot(v[0], v[1], v[2]) || 1;
      const yaw = Math.atan2(-v[0], -v[2]), pitch = Math.atan2(v[1], Math.hypot(v[0], v[2]));
      const m = base(p[0], p[1], p[2], yaw, pitch);
      r.putM('sphere', partM(m, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.9), [0.35, 0.5, 0.2], [0.8, 0, 0, 0.6]);
      r.putM('cyl', partM(m, 0, 0, 0.35, Math.PI / 2, 0, 0, 0, 0, 0.3, 0.3, 0.3), DARK, [0, 0, 0, 0.6]);
      for (const a of [0, 1, 2, 3]) r.putM('box', partM(m, 0, 0, 0.45, 0, a * Math.PI / 2, 0, 0.3, 0, 0.03, 0.25, 0.25), DARK, [0, 0, 0, 0.6]);
      r.putM('sphere', partM(m, 0, 0, 0.55, 0, 0, 0, 0, 0, 0.25, 0.25, 0.25), [3, 1.5, 0.5], [3, 0, 0, 0]);
      void sp;
    }
  }

  // first-person weapon in world space, in front of the eye. Returns a list of { kind, m, col, mat }.
  function viewModel(eye, yaw, pitch, wk, team, k) {
    const out = [];
    const rr = { putM: (kind, m, col, mat) => out.push({ kind, m, col, mat }), spin: k.spin };
    const m = base(eye[0], eye[1], eye[2], yaw, pitch);
    const h0 = child(m, 0.24 + k.swayX, -0.22 + k.bobY + k.swayY, -0.5 + k.recoil, -k.recoil * 0.6 + k.tilt, k.roll);
    const hand = new Float32Array(16);
    root.JFRender.trs(tmpA, 0, 0, 0, 0, 0, 0, 0.72, 0.72, 0.72);
    M4.mul(h0, tmpA, hand);
    weapon(rr, hand, wk, team, k.glow);
    const tc = JF.TEAMS[team].rgb, dk = mix(DARK, tc, 0.35), md = mix(MID, tc, 0.5);
    const Hd = kit(rr, hand);
    // the arm holding it: forearm from the lower right, a glove on the grip, the off hand on the foregrip
    rr.putM('box', partM(hand, 0.08, -0.16, 0.45, 0.25, 0.1, 0, 0, 0, 0.15, 0.16, 0.6), dk, PL);
    Hd.box(0.05, -0.12, 0.12, 0.17, 0.2, 0.17, md, [0, 0, 0, 0.5]);
    for (const i of [-1, 0, 1]) Hd.box(-0.04, -0.1 + i * 0.05, 0.08, 0.06, 0.04, 0.12, dk, [0, 0, 0, 0.3]);
    rr.putM('box', partM(hand, -0.3, -0.22, 0.1, 0.6, -0.5, 0, 0, 0, 0.14, 0.15, 0.5), dk, PL);
    Hd.box(-0.1, -0.1, -0.28, 0.16, 0.14, 0.16, md, [0, 0, 0, 0.5]);
    return out;
  }

  root.JFModels = { player, flag, object, projectile, viewModel, base, child, partM };
})(window);
