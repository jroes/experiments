/*
 * Jetfall models: armor, weapons, flags, base things and projectiles, all made of boxes, spheres and cylinders.
 * Each function adds instances to the renderer for one frame. Browser only (needs the Renderer), no game rules here.
 */
(function (root) {
  'use strict';
  const JF = root.JF;
  const { M4 } = root.JFRender;

  const DARK = [0.16, 0.17, 0.19], MID = [0.38, 0.39, 0.42], LIGHT = [0.7, 0.71, 0.74], METAL = [0.55, 0.57, 0.6];
  const SHAPE = {
    light:  { s: 1.0,  b: 1.0 },
    medium: { s: 1.15, b: 1.18 },
    heavy:  { s: 1.3,  b: 1.45 },
  };

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

  // weapon shapes, in the hand's space: barrel along -z
  function weapon(r, hand, wk, team, glowK) {
    const tc = team;
    const box = (x, y, z, sx, sy, sz, col, mat) => r.putM('box', partM(hand, x, y, z, 0, 0, 0, 0, 0, sx, sy, sz), col, mat);
    const cyl = (x, y, z, rx, sx, sy, sz, col, mat) => r.putM('cyl', partM(hand, x, y, z, rx, 0, 0, 0, 0, sx, sy, sz), col, mat);
    const g = glowK || 0;
    switch (wk) {
      case 'disc':
        box(0, 0, -0.15, 0.16, 0.18, 0.7, MID, [0, 0, 0, 0.6]);
        cyl(0, 0.02, -0.38, 0, 0.42, 0.06, 0.42, [0.75, 0.85, 1.0], [0.6 + g, 0, 0, 0.9]);
        box(0, -0.12, 0.05, 0.08, 0.16, 0.12, DARK);
        break;
      case 'chain':
        for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + (r.spin || 0); cyl(Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.45, Math.PI / 2, 0.05, 0.6, 0.05, METAL, [0, 0, 0, 0.8]); }
        box(0, 0, -0.05, 0.18, 0.2, 0.4, DARK, [0, 0, 0, 0.5]);
        box(0.12, -0.05, -0.05, 0.08, 0.14, 0.2, [0.6, 0.5, 0.2]);
        break;
      case 'plasma':
        box(0, 0, -0.2, 0.14, 0.16, 0.65, [0.3, 0.2, 0.15], [0, 0, 0, 0.5]);
        cyl(0, 0.08, -0.25, Math.PI / 2, 0.12, 0.35, 0.12, [1.0, 0.5, 0.1], [1.4 + g, 0, 0, 0.3]);
        break;
      case 'gl':
        cyl(0, 0, -0.3, Math.PI / 2, 0.16, 0.55, 0.16, [0.3, 0.36, 0.25], [0, 0, 0, 0.4]);
        box(0, -0.06, 0.05, 0.16, 0.2, 0.3, DARK);
        break;
      case 'mortar':
        cyl(0, 0.02, -0.25, Math.PI / 2, 0.26, 0.8, 0.26, [0.32, 0.36, 0.26], [0, 0, 0, 0.4]);
        box(0, -0.12, 0.12, 0.22, 0.2, 0.35, DARK);
        break;
      case 'laser':
        box(0, 0, -0.3, 0.08, 0.12, 0.9, LIGHT, [0, 0, 0, 0.9]);
        box(0, 0.1, -0.15, 0.06, 0.06, 0.3, [0.2, 1.0, 0.4], [1.5 + g, 0, 0, 0.2]);
        break;
      case 'elf':
        box(0, 0, -0.15, 0.18, 0.18, 0.5, [0.25, 0.25, 0.4]);
        for (const s of [-1, 1]) box(s * 0.08, 0, -0.45, 0.04, 0.04, 0.25, [0.5, 0.6, 1.0], [1.5 + g, 0, 0, 0.2]);
        break;
      default: // blaster
        box(0, 0, -0.15, 0.1, 0.14, 0.45, [0.5, 0.18, 0.15], [0, 0, 0, 0.5]);
        box(0, 0.02, -0.4, 0.05, 0.05, 0.12, [1, 0.3, 0.2], [1.2 + g, 0, 0, 0.2]);
    }
    void tc;
  }

  // anim: { phase, ski, air, jet, speed } kept by the page per player
  function player(r, p, anim, opts) {
    const sh = SHAPE[p.armor] || SHAPE.light, s = sh.s, b = sh.b;
    const team = JF.TEAMS[p.team].rgb;
    const tc = [team[0] * 0.85, team[1] * 0.85, team[2] * 0.85];
    const root_ = base(p.pos[0], p.pos[1], p.pos[2], p.yaw, 0);
    const ground = p.ground && !p.jetting;
    const run = ground && !p.skiing ? Math.min(1, anim.speed / 7) : 0;
    const sw = Math.sin(anim.phase) * 0.75 * run;
    const crouch = p.skiing ? 0.18 : 0;
    const hipY = (0.95 - crouch) * s;
    const air = !p.ground;
    const put = (kind, m, col, mat) => r.putM(kind, m, col, mat);
    const glowV = opts && opts.flash ? 1.2 : 0;
    // legs
    for (const side of [-1, 1]) {
      let rx = air ? 0.35 + side * 0.08 : p.skiing ? (side > 0 ? -0.5 : 0.2) : sw * side;
      const leg = child(root_, side * 0.14 * b, hipY, 0, rx, 0);
      put('box', partM(leg, 0, 0, 0, 0, 0, 0, -0.27 * s, 0, 0.2 * b, 0.55 * s, 0.24 * b), DARK, [0, 1, 0, 0.4]);
      const knee = child(leg, 0, -0.5 * s, 0, p.skiing ? 0.7 : air ? 0.5 : Math.max(0, -sw * side) * 0.9, 0);
      put('box', partM(knee, 0, 0, 0, 0, 0, 0, -0.22 * s, 0, 0.18 * b, 0.45 * s, 0.22 * b), MID, [0, 0, 0, 0.5]);
      put('box', partM(knee, 0, -0.45 * s, -0.04, 0, 0, 0, 0, 0, 0.2 * b, 0.1, 0.32 * b), DARK);
    }
    // body
    const lean = p.skiing ? 0.35 : air ? 0.12 : run * 0.15;
    const torso = child(root_, 0, hipY, 0, -lean, 0);
    put('box', partM(torso, 0, 0, 0, 0, 0, 0, 0.08 * s, 0, 0.42 * b, 0.22 * s, 0.28 * b), DARK); // belt
    put('box', partM(torso, 0, 0.2 * s, 0, 0, 0, 0, 0.25 * s, 0, 0.56 * b, 0.5 * s, 0.34 * b), tc, [glowV, 1, 0, 0.6]); // chest
    put('box', partM(torso, 0, 0.32 * s, -0.17 * b, 0, 0, 0, 0, 0, 0.3 * b, 0.18 * s, 0.04), [team[0], team[1], team[2]], [1.4, 0, 0, 0.3]); // chest light
    // pack
    const packCol = p.pack === 'shield' ? [0.3, 0.5, 1] : p.pack === 'repair' ? [0.3, 1, 0.4] : p.pack === 'energy' ? [1, 0.85, 0.3] : p.pack === 'ammo' ? [0.8, 0.6, 0.3] : MID;
    put('box', partM(torso, 0, 0.32 * s, 0.24 * b, 0, 0, 0, 0, 0, 0.44 * b, 0.48 * s, 0.18 * b), MID, [0, 0, 0, 0.5]);
    put('box', partM(torso, 0, 0.45 * s, 0.34 * b, 0, 0, 0, 0, 0, 0.2 * b, 0.12 * s, 0.03), packCol, [0.8, 0, 0, 0.2]);
    for (const side of [-1, 1]) {
      put('cyl', partM(torso, side * 0.14 * b, 0.12 * s, 0.3 * b, 0, 0, 0, 0, 0, 0.12 * b, 0.14 * s, 0.12 * b), p.jetting ? [0.6, 0.85, 1] : DARK, [p.jetting ? 3 : 0, 0, 0, 0.5]);
    }
    if (p.armor === 'heavy') for (const side of [-1, 1]) put('box', partM(torso, side * 0.36 * b, 0.48 * s, 0, 0, side * 0.2, 0, 0, 0, 0.26 * b, 0.12, 0.36 * b), tc, [0, 0, 0, 0.6]);
    // head turns with the aim
    const head = child(torso, 0, 0.6 * s, 0, -p.pitch * 0.5 + lean, 0);
    put('box', partM(head, 0, 0, 0, 0, 0, 0, 0.14 * s, 0, 0.26 * b, 0.28 * s, 0.3 * b), MID, [0, 0, 0, 0.7]);
    put('box', partM(head, 0, 0.16 * s, -0.14 * b, 0, 0, 0, 0, 0, 0.22 * b, 0.07 * s, 0.04), [team[0] * 0.6 + 0.4, team[1] * 0.6 + 0.4, team[2] * 0.6 + 0.4], [2.2, 0, 0, 0.9]);
    put('box', partM(head, 0, 0.3 * s, 0.02, 0, 0, 0, 0, 0, 0.18 * b, 0.05, 0.2 * b), tc);
    // arms: both forward holding the gun, pitched with the aim
    const shoulder = child(torso, 0, 0.42 * s, 0, lean + p.pitch * 0.9, 0);
    for (const side of [-1, 1]) {
      const arm = child(shoulder, side * 0.34 * b, 0, 0, side > 0 ? -1.35 : -1.2, side * 0.12);
      put('box', partM(arm, 0, 0, 0, 0, 0, 0, -0.25 * s, 0, 0.15 * b, 0.5 * s, 0.17 * b), DARK, [0, 0, 0, 0.4]);
    }
    const hand = child(shoulder, 0.18 * b, -0.02, -0.48 * s, 0, 0);
    if (p.weapon) weapon(r, hand, p.weapon, team, opts && opts.fireGlow);
    // carried flag on the back
    if (p.hasFlag && opts && opts.flagTeam != null) {
      const ft = JF.TEAMS[opts.flagTeam].rgb;
      const fb = child(torso, 0, 0.3 * s, 0.35 * b, 0.25, 0);
      flagShape(r, fb, ft, opts.time || 0, 0.8);
    }
  }

  function flagShape(r, m, team, t, scale) {
    const k = scale || 1;
    r.putM('cyl', partM(m, 0, 1.4 * k, 0, 0, 0, 0, 0, 0, 0.07, 2.8 * k, 0.07), LIGHT, [0, 0, 0, 0.9]);
    r.putM('sphere', partM(m, 0, 2.85 * k, 0, 0, 0, 0, 0, 0, 0.18, 0.18, 0.18), [1, 1, 1], [2, 0, 0, 0.5]);
    // cloth: a few segments that wave
    const segs = 5, w = 1.5 * k / segs;
    for (let i = 0; i < segs; i++) {
      const x = (i + 0.5) * w;
      const wave = Math.sin(t * 6 - i * 0.9) * 0.12 * (i + 1) / segs;
      const z = wave, rz = 0;
      r.putM('box', partM(m, x, 2.35 * k + Math.sin(t * 3 - i) * 0.03, z, 0, rz, 0, 0, 0, w * 1.05, 0.95 * k, 0.04), team, [0.9, 0, 0, 0.2]);
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
    if (o.kind === 'gen') {
      for (const ix of [-1, 1]) for (const iz of [-1, 1]) r.put('box', cx + ix * (sx / 2 - 0.15), b[1] + sy / 2, cz + iz * (sz / 2 - 0.15), 0, 0, 0.3, sy, 0.3, MID, [0, 0, 0, 0.6]);
      r.put('box', cx, b[1] + 0.2, cz, 0, 0, sx, 0.4, sz, DARK);
      r.put('box', cx, b[4] - 0.2, cz, 0, 0, sx, 0.4, sz, DARK);
      const coreCol = dead ? [0.15, 0.12, 0.1] : team;
      r.put('cyl', cx, b[1] + sy / 2, cz, t * (dead ? 0 : 2), 0, sx * 0.55, sy - 0.8, sz * 0.55, coreCol, [dead ? 0 : 1.5 + pulse, 0, 0, 0.8]);
      for (let i = 0; i < 3; i++) r.put('cyl', cx, b[1] + 0.9 + i * 0.9 + (dead ? 0 : Math.sin(t * 2 + i) * 0.1), cz, 0, 0, sx * 0.75, 0.12, sz * 0.75, METAL, [0, 0, 0, 0.9]);
    } else if (o.kind === 'station') {
      r.put('box', cx, b[1] + sy / 2, cz, 0, 0, sx, sy, sz, MID, [0, 1, 0, 0.5]);
      const c = dead ? [0.5, 0.1, 0.05] : live ? team : [0.25, 0.25, 0.25];
      r.put('box', cx, b[4] + 0.01, cz, 0, 0, sx * 0.8, 0.02, sz * 0.8, c, [live ? 1.2 + pulse * 0.8 : 0.2, 0, 0, 0.2]);
      // a post with a screen at the wall side
      const wall = o.c[2] > 0 ? 1 : -1;
      const pz = Math.abs(b[2] - o.c[2]) < 2 ? 0 : 0;
      void pz;
      const nearWallZ = Math.abs(b[5] - (b[5] + b[2]) / 2) && (b[5] > o.c[2] ? b[5] : b[2]);
      void nearWallZ; void wall;
      r.put('box', cx, b[1] + 1.4, (b[2] + b[5]) / 2, 0, 0, sx * 0.9, 2.5, 0.06, DARK);
      r.put('box', cx, b[1] + 1.8, (b[2] + b[5]) / 2, 0, 0, sx * 0.7, 0.9, 0.08, c, [live ? 1 : 0.1, 0, 0, 0.3]);
    } else if (o.kind === 'turret') {
      r.put('box', cx, b[1] + 0.35, cz, 0, 0, sx, 0.7, sz, DARK, [0, 0, 0, 0.5]);
      const yaw = so ? so.yaw : 0, pitch = so ? so.pitch : 0;
      const hm = base(cx, b[1] + 1.0, cz, yaw, dead ? -0.5 : pitch);
      r.putM('box', partM(hm, 0, 0, 0, 0, 0, 0, 0, 0, 1.2, 0.6, 1.0), dead ? [0.2, 0.18, 0.16] : MID, [0, 1, 0, 0.6]);
      r.putM('box', partM(hm, 0, 0.1, -0.52, 0, 0, 0, 0, 0, 0.6, 0.12, 0.05), dead ? DARK : team, [live ? 2 : 0, 0, 0, 0.2]);
      for (const s of [-1, 1]) r.putM('cyl', partM(hm, s * 0.25, 0, -0.9, Math.PI / 2, 0, 0, 0, 0, 0.14, 0.9, 0.14), METAL, [0, 0, 0, 0.8]);
    } else if (o.kind === 'sensor') {
      const dm = base(cx, b[1] + 1.0, cz, dead ? 0 : t * 0.8, 0.25);
      r.put('cyl', cx, b[1] + 0.4, cz, 0, 0, 0.6, 0.8, 0.6, DARK);
      r.putM('cyl', partM(dm, 0, 0.4, 0, 1.2, 0, 0, 0, 0, 3.0, 0.15, 3.0), dead ? DARK : LIGHT, [0, 0, 0, 0.8]);
      r.putM('sphere', partM(dm, 0, 0.6, -0.4, 0, 0, 0, 0, 0, 0.35, 0.35, 0.35), dead ? DARK : team, [live ? 2.5 * pulse : 0, 0, 0, 0.3]);
    }
  }

  function projectile(r, q, t) {
    const p = q.pos;
    if (q.kind === 'disc') {
      r.put('cyl', p[0], p[1], p[2], t * 25, 0, 0.55, 0.1, 0.55, [0.8, 0.9, 1.0], [1.4, 0, 0, 1]);
    } else if (q.kind === 'gl' || q.kind === 'hgren') {
      r.put('sphere', p[0], p[1], p[2], t * 10, t * 7, 0.26, 0.26, 0.26, [0.25, 0.32, 0.2], [0.3, 0, 0, 0.6]);
    } else if (q.kind === 'mortar') {
      r.put('sphere', p[0], p[1], p[2], 0, t * 5, 0.5, 0.5, 0.5, [0.35, 0.5, 0.2], [0.8, 0, 0, 0.6]);
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
    // the arm holding it
    rr.putM('box', partM(hand, 0.05, -0.12, 0.35, 0.2, 0, 0, 0, 0, 0.14, 0.16, 0.5), DARK, [0, 0, 0, 0.4]);
    rr.putM('box', partM(hand, 0.05, -0.1, 0.12, 0, 0, 0, 0, 0, 0.17, 0.2, 0.16), JF.TEAMS[team].rgb.map(v => v * 0.8), [0, 0, 0, 0.5]);
    return out;
  }

  root.JFModels = { player, flag, object, projectile, viewModel, base, child, partM };
})(window);
