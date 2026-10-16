/*
 * Jetfall computer players. They run on the host only and play through the same inputs as a person:
 * buttons, a move direction and where they look. So they cannot do anything a person cannot.
 */
(function (root) {
  'use strict';
  const JF = root.JF || require('./sim.js');
  const { B, ARMORS, WEAPONS, PROJ, GRAV, clamp } = JF;

  const NAMES = ['Kestrel', 'Basalt', 'Juniper', 'Moth', 'Corvid', 'Talon', 'Quarry', 'Sable', 'Rook', 'Cinder', 'Drift', 'Harrow',
    'Wren', 'Flint', 'Vesper', 'Gale', 'Ridge', 'Ash', 'Marrow', 'Pike', 'Thistle', 'Rune', 'Slate', 'Ember'];

  // in the order a team gets them: one runner and one defender first, so small teams still attack and defend
  const LOADOUTS = [
    { armor: 'light', weapons: ['disc', 'chain', 'gl'], pack: 'energy', role: 'offense' },
    { armor: 'heavy', weapons: ['disc', 'chain', 'mortar', 'plasma', 'gl'], pack: 'repair', role: 'defense' },
    { armor: 'medium', weapons: ['disc', 'chain', 'plasma', 'elf'], pack: 'shield', role: 'offense' },
    { armor: 'light', weapons: ['disc', 'chain', 'laser'], pack: 'energy', role: 'defense' },
    { armor: 'heavy', weapons: ['disc', 'mortar', 'chain', 'plasma', 'gl'], pack: 'ammo', role: 'raider' },
    { armor: 'light', weapons: ['disc', 'chain', 'plasma'], pack: 'energy', role: 'offense' },
  ];

  function name(world, pid) {
    const used = new Set([...world.players.values()].map(p => p.name));
    for (let i = 0; i < NAMES.length; i++) {
      const n = NAMES[(pid * 7 + i) % NAMES.length];
      if (!used.has(n)) return n;
    }
    return 'Bot ' + pid;
  }
  // slot = the bot's place on its team, so both teams get the same mix of jobs
  const pick = slot => LOADOUTS[slot % LOADOUTS.length];
  function loadout(slot) { const L = pick(slot); return { armor: L.armor, weapons: L.weapons.slice(), pack: L.pack }; }

  function create(p) {
    return {
      role: pick(p.botSlot == null ? p.id : p.botSlot).role, yaw: p.yaw, pitch: 0, jet: false, stuckT: 0, lastPos: null, lastCheck: 0, unstickT: 0, strafe: 1,
      enemy: -1, seeT: 0, sees: false, aimErr: [0, 0], errT: 0, wantStation: true, lastAlive: false, grenT: 2, rethinkT: 0, wobble: Math.random() * 6,
      goal: null,
    };
  }

  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;
  const dist3 = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

  // a base's point in world space from its local layout coordinates
  function basePt(world, team, x, y, z) {
    const o = world.bases[team].o;
    return [o.x + x * o.face, o.y + y, o.z + z * o.face];
  }
  function localOf(world, team, pos) {
    const o = world.bases[team].o;
    return [(pos[0] - o.x) * o.face, pos[1] - o.y, (pos[2] - o.z) * o.face];
  }
  const insideBunker = l => Math.abs(l[0]) < 11.4 && Math.abs(l[2]) < 8.4 && l[1] > -1 && l[1] < 7.5;

  // Going in or out of a bunker means using a door: return the next waypoint towards `goal`.
  function route(world, p, goal) {
    for (let team = 0; team < 2; team++) {
      const lp = localOf(world, team, p.pos), lg = localOf(world, team, goal);
      const pin = insideBunker(lp), gin = insideBunker(lg);
      if (pin === gin) continue;
      const side = (pin ? lg[0] : lp[0]) >= 0 ? 1 : -1;  // use the door on the side that is closer to the outside point
      if (pin) {
        // inside and want out: line up with the door, then walk through
        if (Math.abs(lp[2]) > 1.2 && Math.abs(lp[0]) < 10) return basePt(world, team, side * 8, 0.2, 0);
        return basePt(world, team, side * 16, 0.5, 0);
      }
      // outside and want in: get in front of the door at ground level, then go in
      const front = basePt(world, team, side * 15, 0, 0);
      if (lp[1] > 5 || Math.abs(lp[2]) > 1.5 || Math.abs(lp[0]) > 17) return [front[0], world.terrain.height(front[0], front[2]) + 0.5, front[2]];
      return basePt(world, team, side * 6, 0.2, 0);
    }
    return goal;
  }

  function indoorsAt(w, p) { for (let t = 0; t < 2; t++) if (insideBunker(localOf(w, t, p.pos))) return true; return false; }

  function think(bot, w, p) {
    if (w.course) return courseThink(bot, w, p);
    const inp = { seq: 0, b: 0, mx: 0, mz: 0, yaw: bot.yaw, pitch: bot.pitch, w: 255 };
    const skill = p.skill == null ? 0.5 : p.skill;
    if (!p.alive) { bot.lastAlive = false; bot.wantStation = true; return inp; }
    if (!bot.lastAlive) { bot.lastAlive = true; bot.yaw = p.yaw; bot.goal = null; bot.enemy = -1; }
    const dt = JF.TICK;
    const A = ARMORS[p.armor];
    const myFlag = w.flags[p.team], theirFlag = w.flags[1 - p.team];

    // ----- what to do -----
    let goal, mode = 'travel';
    const loadoutArmor = p.loadout && p.loadout.armor;
    const restock = p.weapons.every(k => WEAPONS[k].ammo === 0 || p.ammo[k] < WEAPONS[k].ammo * 0.2);
    const needStation = bot.wantStation && w.power(p.team) && loadoutArmor && (restock || p.armor !== loadoutArmor || p.weapons.join() !== p.loadout.weapons.join()) && p.flag < 0;
    if (!needStation) bot.wantStation = false;
    // low on ammo: go and restock
    if (!bot.wantStation && p.weapons.every(k => WEAPONS[k].ammo === 0 || p.ammo[k] < WEAPONS[k].ammo * 0.2)) bot.wantStation = true;
    if (p.flag >= 0) { goal = myFlag.state === 'home' ? myFlag.home : (myFlag.state === 'dropped' ? myFlag.pos : myFlag.home); mode = 'run'; }
    else if (myFlag.state !== 'home' && (bot.role !== 'offense' || dist3(p.pos, myFlag.pos) < 300)) {
      const c = myFlag.state === 'carried' ? w.players.get(myFlag.carrier) : null;
      goal = c ? c.pos : myFlag.pos; mode = 'chase';
      if (c) bot.enemy = c.id;
    } else if (needStation) {
      const st = w.objects.filter(o => o.kind === 'station' && o.team === p.team && o.up).sort((a, b) => dist2(a.c, p.pos) - dist2(b.c, p.pos))[0];
      if (st) { goal = [st.c[0], st.b[4], st.c[2]]; mode = 'station'; }
      else { bot.wantStation = false; goal = myFlag.home; }
    } else if (bot.role === 'defense') {
      // fix our generator if we can, else patrol near the flag
      const gen = w.objects.find(o => o.kind === 'gen' && o.team === p.team);
      if (p.pack === 'repair' && gen && gen.hp < gen.max * 0.95) { goal = [gen.c[0] + 2.5, gen.b[1] + 0.2, gen.c[2]]; mode = 'repair'; bot.repairObj = gen; }
      else {
        bot.wobble += dt * 0.25;
        const h = myFlag.home;
        goal = [h[0] + Math.cos(bot.wobble + p.id) * 26, 0, h[2] + Math.sin(bot.wobble * 1.3 + p.id) * 26];
        goal[1] = w.terrain.height(goal[0], goal[2]);
        mode = 'patrol';
      }
    } else if (bot.role === 'raider') {
      const gen = w.objects.find(o => o.kind === 'gen' && o.team !== p.team);
      if (gen && gen.up) { goal = [gen.c[0], gen.b[1] + 0.2, gen.c[2]]; mode = 'raid'; bot.raidObj = gen; }
      else goal = theirFlag.state === 'carried' ? (w.players.get(theirFlag.carrier) || { pos: theirFlag.pos }).pos : theirFlag.pos;
    } else {
      if (theirFlag.state === 'carried') {
        const c = w.players.get(theirFlag.carrier);
        goal = c ? [c.pos[0] - 15 * Math.sign(c.vel[0] || 1), c.pos[1] + 10, c.pos[2]] : theirFlag.pos; mode = 'escort';
      } else {
        // come in high and fast, then dive through the flag: hovering over it is how you die
        const f = theirFlag.pos, d = Math.sqrt(dist2(f, p.pos));
        goal = d > 70 ? [f[0], f[1] + 28, f[2]] : f;
        mode = 'grab';
      }
    }
    const way = route(w, p, goal);

    // ----- enemies -----
    bot.seeT -= dt;
    if (bot.seeT <= 0) {
      bot.seeT = 0.3 + Math.random() * 0.2;
      let best = null, bd = mode === 'run' ? 90 : 90 + skill * 130; // worse bots notice you later
      const eyeP = JF.eye(p);
      for (const q of w.players.values()) {
        if (!q.alive || q.team === p.team) continue;
        let d = dist3(q.pos, p.pos);
        if (q.flag >= 0) d *= 0.4; // flag runners first
        if (d < bd && !w.blocked(eyeP, [q.pos[0], q.pos[1] + 1.2, q.pos[2]])) { best = q; bd = d; }
      }
      if (mode === 'chase' && bot.enemy >= 0 && w.players.get(bot.enemy)) best = w.players.get(bot.enemy);
      const id = best ? best.id : -1;
      // a new target: it takes a moment to react
      if (id !== bot.enemy && id >= 0) bot.react = 0.3 + (1 - skill) * 1.1 + Math.random() * 0.3;
      bot.enemy = id;
      bot.errT -= 0.4;
      if (bot.errT <= 0) {
        // the aim wanders: worse bots wander a lot more, and they misjudge the lead and forget to aim at the feet
        bot.errT = 0.7;
        const e = Math.pow(1 - skill, 1.2) * 0.26 + 0.01;
        bot.aimErr = [(Math.random() - 0.5) * 2 * e, (Math.random() - 0.5) * 2 * e];
        bot.leadK = 0.3 + 0.7 * skill + (Math.random() - 0.5) * (1 - skill) * 0.6;
        bot.feet = Math.random() < skill;
      }
    }
    const enemy = bot.enemy >= 0 ? w.players.get(bot.enemy) : null;

    // ----- moving -----
    const dx = way[0] - p.pos[0], dz = way[2] - p.pos[2];
    const hd = Math.sqrt(dx * dx + dz * dz);
    const dy = way[1] - p.pos[1];
    const ground = w.terrain.height(p.pos[0], p.pos[2]);
    const alt = p.pos[1] - ground;
    let mdx = hd > 0.01 ? dx / hd : 0, mdz = hd > 0.01 ? dz / hd : 0;
    const near = mode === 'station' || mode === 'grab' || mode === 'run' || mode === 'chase' ? 0.6 : 4;
    const close = way === goal ? hd < near && Math.abs(dy) < 3 : hd < 0.8;
    let want = !close;
    if (mode === 'patrol' && hd < 8) want = false;
    if ((mode === 'repair' || mode === 'raid') && hd < 3) want = false;
    if (mode === 'station' && way === goal && hd < 1) want = false;

    // arriving: steer by the velocity we want, so we slow down instead of flying past
    const fast = mode === 'grab' || mode === 'run';
    if (want && (hd < 90 || p.vel[0] * mdx + p.vel[2] * mdz < 40)) {
      const vmax = hd < 90 ? clamp(hd * (fast ? 1.3 : 0.7), fast ? 12 : 3, 50) : 60;
      let ddx = mdx * vmax - p.vel[0], ddz = mdz * vmax - p.vel[2];
      const dl = Math.sqrt(ddx * ddx + ddz * ddz);
      if (dl > 0.5) { mdx = ddx / dl; mdz = ddz / dl; }
    }
    // a goal above and close (a roof): go straight up first, then over
    if (want && dy > 1.5 && hd < 14 && !indoorsAt(w, p)) { mdx *= 0.15; mdz *= 0.15; }
    // stuck? try jumping and sidestepping
    bot.lastCheck += dt;
    if (bot.lastCheck > 1.5) {
      if (bot.lastPos && want && dist3(bot.lastPos, p.pos) < 2.5) { bot.unstickT = 1.2; bot.strafe = -bot.strafe; }
      bot.lastPos = p.pos.slice(); bot.lastCheck = 0;
    }
    if (bot.unstickT > 0) {
      bot.unstickT -= dt;
      const sx = -mdz * bot.strafe, sz = mdx * bot.strafe;
      mdx = mdx * 0.3 + sx; mdz = mdz * 0.3 + sz;
      if (p.energy > 10) inp.b |= B.JET;
      else if (p.ground && (w.tick & 8)) inp.b |= B.JUMP; // out of energy: hop over whatever is in the way
    }

    // jets: climb toward high goals, over hills, and to break a hard fall
    const sp = Math.sqrt(p.vel[0] ** 2 + p.vel[2] ** 2);
    const energyF = p.energy / A.energy;
    if (bot.jet && energyF < 0.12) bot.jet = false;
    if (!bot.jet && energyF > 0.55) bot.jet = true;
    const ahead = 25 + sp * 1.2;
    // water and lava ahead count as ground: fly over them, don't wade or burn
    const fl = Math.max(w.terrain.waterH ?? -Infinity, w.terrain.lavaH ?? -Infinity);
    const hAhead = Math.max(w.terrain.height(p.pos[0] + mdx * ahead, p.pos[2] + mdz * ahead), fl);
    let jet = false;
    const indoors = (() => { for (let t = 0; t < 2; t++) if (insideBunker(localOf(w, t, p.pos))) return true; return false; })();
    if (want && !indoors) {
      if (dy > 2 && hd < 80) jet = bot.jet || (p.jetting && p.energy > 2); // the goal is above us: wait for energy, then go up in one go
      else if (hAhead > p.pos[1] - 2 && hd > 30) jet = bot.jet;        // a hill in the way
      else if (hd > 120 && !p.ground && alt < 25 && p.vel[1] < 0) jet = bot.jet; // keep flying on long trips
      else if (hd > 150 && p.ground && sp < 18) jet = bot.jet;         // get going
    }
    // going the wrong way fast: turn with the jets (ground and air steering are weak at speed)
    if (want && sp > 14 && !indoors) {
      const vmax = hd < 90 ? clamp(hd * (fast ? 1.3 : 0.7), fast ? 12 : 3, 50) : 60;
      const ex = mdx * vmax - p.vel[0], ez = mdz * vmax - p.vel[2];
      if (Math.sqrt(ex * ex + ez * ez) > 10 && bot.jet) jet = true;
    }
    if (!p.ground && p.vel[1] < -22 && alt < 60 && p.energy > 3) jet = true; // land softly
    // get out of lava and water
    const lh = w.terrain.lavaH, wh = w.terrain.waterH;
    if (lh != null && ground < lh + 1 && alt < 6 && p.energy > 2) jet = true;
    // in water, float until there is energy to fly out in one go: tapping the jets with every drop of energy keeps you in it
    if (wh != null && p.pos[1] < wh + 0.5) jet = bot.jet || (p.jetting && p.energy > 2);
    // about to fly into a hillside: pull up
    if (!p.ground && sp > 25 && p.energy > 2) {
      const ax = p.pos[0] + p.vel[0] * 0.6, az = p.pos[2] + p.vel[2] * 0.6, ay = p.pos[1] + p.vel[1] * 0.6;
      if (w.terrain.height(ax, az) > ay - 1) jet = true;
    }
    if (jet) inp.b |= B.JET;
    // ski downhill and on long runs
    if (p.ground && want && hd > 35 && !indoors) {
      const g2 = w.terrain.height(p.pos[0] + mdx * 6, p.pos[2] + mdz * 6);
      if (g2 < ground - 0.5 || sp > A.run + 3) inp.b |= B.JUMP;
    }

    // ----- aiming and shooting -----
    let wantYaw, wantPitch;
    let weapon = p.wi;
    if (enemy) {
      const d = dist3(enemy.pos, p.pos);
      // weapon by range
      const hasW = k => p.weapons.indexOf(k);
      let wk = null;
      const order = d < 7 ? ['chain', 'plasma', 'blaster', 'elf'] : d < 45 ? ['disc', 'plasma', 'chain', 'gl', 'blaster'] : d < 130 ? ['disc', 'mortar', 'chain', 'plasma', 'blaster'] : ['laser', 'mortar', 'chain', 'blaster'];
      for (const k of order) { const i = hasW(k); if (i >= 0 && (WEAPONS[k].ammo === 0 || p.ammo[k] > 0)) { wk = k; weapon = i; break; } }
      if (wk === 'laser' && p.energy < A.energy * 0.8) { const i = hasW('chain'); if (i >= 0) { wk = 'chain'; weapon = i; } }
      if (wk === 'mortar' && d < 40) { const i = hasW('disc'); if (i >= 0) { wk = 'disc'; weapon = i; } }
      const eyeP = JF.eye(p);
      const W = wk ? WEAPONS[wk] : null;
      let tp = [enemy.pos[0], enemy.pos[1] + ARMORS[enemy.armor].h * 0.55, enemy.pos[2]];
      if (W && W.r > 0 && enemy.ground && bot.feet) tp = [enemy.pos[0], enemy.pos[1] + 0.2, enemy.pos[2]]; // splash: aim at the feet
      let aim;
      if (W && W.kind === 'proj') {
        const k = bot.leadK == null ? 1 : bot.leadK;
        const relV = [enemy.vel[0] * k - p.vel[0] * W.inherit, enemy.vel[1] * k - p.vel[1] * W.inherit, enemy.vel[2] * k - p.vel[2] * W.inherit];
        aim = JF.leadAim(eyeP, tp, relV, W.speed, W.grav);
      } else {
        const l = dist3(tp, eyeP) || 1;
        aim = [(tp[0] - eyeP[0]) / l, (tp[1] - eyeP[1]) / l, (tp[2] - eyeP[2]) / l];
      }
      wantYaw = Math.atan2(-aim[0], -aim[2]) + bot.aimErr[0];
      wantPitch = Math.asin(clamp(aim[1], -1, 1)) + bot.aimErr[1];
      // shoot when roughly on target
      const dyaw = angDiff(bot.yaw, wantYaw), dp = Math.abs(bot.pitch - wantPitch);
      const tol = 0.04 + (W && W.r ? Math.min(0.15, W.r / Math.max(d, 1) * 0.6) : 0.02);
      const ready = W && (W.ammo > 0 ? p.ammo[wk] > 0 : (!W.minEnergy || p.energy >= W.minEnergy) && (!W.energy || p.energy >= W.energy));
      if (bot.react > 0) bot.react -= dt;
      if (bot.hold > 0) bot.hold -= dt;
      if (weapon === p.wi && Math.abs(dyaw) < tol && dp < tol && ready && bot.react <= 0 && !(bot.hold > 0)) {
        if (!(W.r > 0 && d < W.r * 0.8)) {
          inp.b |= B.FIRE;
          // worse bots also wait a while between shots
          if (!W.spin && p.fireCd <= 0) bot.hold = (1 - skill) * (0.4 + Math.random() * 1.2);
        }
        if (W.kind === 'beam' && d > W.range) inp.b &= ~B.FIRE;
      }
      if (W && W.spin && d < 120 && p.ammo[wk] > 0 && bot.react <= 0) inp.b |= B.FIRE; // keep it spinning
      bot.grenT -= dt;
      if (bot.grenT <= 0 && d < 28 && d > 8 && p.grenades > 0 && skill >= 0.4) { bot.grenT = 4 + Math.random() * 4; inp.b |= B.GREN; }
      // strafe a bit in a fight when not going anywhere in particular
      if (mode === 'patrol' || !want) {
        bot.wobble += dt;
        const s = Math.sin(bot.wobble * 1.7) > 0 ? 1 : -1;
        mdx = -aim[2] * s; mdz = aim[0] * s; want = true;
        if (d < 60 && p.ground && Math.random() < 0.01) inp.b |= B.JUMP;
      }
    } else if (want) {
      wantYaw = Math.atan2(-mdx, -mdz);
      wantPitch = clamp(Math.atan2(dy, Math.max(hd, 1)) * 0.5, -0.6, 0.6);
    } else { wantYaw = bot.yaw; wantPitch = 0; }

    // repair what we came for
    if (mode === 'repair' && !enemy && bot.repairObj) {
      const c = bot.repairObj.c, e = JF.eye(p);
      const l = dist3(c, e) || 1;
      wantYaw = Math.atan2(-(c[0] - e[0]) / l, -(c[2] - e[2]) / l); wantPitch = Math.asin(clamp((c[1] - e[1]) / l, -1, 1));
      inp.b |= B.PACK;
    }
    if (mode === 'raid' && hd < 14 && bot.raidObj) {
      const c = bot.raidObj.c, e = JF.eye(p);
      const l = dist3(c, e) || 1;
      wantYaw = Math.atan2(-(c[0] - e[0]) / l, -(c[2] - e[2]) / l); wantPitch = Math.asin(clamp((c[1] - 1 - e[1]) / l, -1, 1));
      const di = p.weapons.indexOf('disc') >= 0 ? p.weapons.indexOf('disc') : 0;
      weapon = l > 6 ? (p.weapons.indexOf('mortar') >= 0 && l > 12 ? p.weapons.indexOf('mortar') : di) : (p.weapons.indexOf('chain') >= 0 ? p.weapons.indexOf('chain') : di);
      if (weapon === p.wi) inp.b |= B.FIRE;
      want = hd > 7;
    }
    if (p.pack === 'repair' && !enemy && p.hp < A.hp * 0.6) inp.b |= B.PACK;
    if (p.pack === 'shield' && enemy && !p.shieldOn && p.energy > A.energy * 0.5 && Math.random() < 0.02) inp.b |= B.PACK;

    // turn at a limited speed: better bots turn faster
    const turn = (1.5 + skill * 7) * dt;
    bot.yaw += clamp(angDiff(bot.yaw, wantYaw), -turn, turn);
    bot.pitch += clamp(wantPitch - bot.pitch, -turn, turn);
    bot.pitch = clamp(bot.pitch, -1.5, 1.5);
    inp.yaw = bot.yaw; inp.pitch = bot.pitch;
    if (weapon !== p.wi) inp.w = weapon;
    if (want) {
      const sy = Math.sin(bot.yaw), cy = Math.cos(bot.yaw);
      const l = Math.sqrt(mdx * mdx + mdz * mdz) || 1;
      const ux = mdx / l, uz = mdz / l;
      inp.mz = clamp(-sy * ux - cy * uz, -1, 1);
      inp.mx = clamp(cy * ux - sy * uz, -1, 1);
    }
    return inp;
  }
  // ----- courses: ski from gate to gate, jet when the land or a gate is above us, shoot the targets on the way -----
  // The tests run every course with this, so a course is only shipped if this can finish it. Skill sets how well it aims and how fast it turns.
  function courseThink(bot, w, p) {
    const inp = { seq: 0, b: 0, mx: 0, mz: 0, yaw: bot.yaw, pitch: bot.pitch, w: 255 };
    const skill = p.skill == null ? 0.5 : p.skill;
    if (!p.alive) { bot.lastAlive = false; return inp; }
    if (!bot.lastAlive) { bot.lastAlive = true; bot.yaw = p.yaw; bot.pitch = 0; bot.jet = true; }
    const dt = JF.TICK, A = ARMORS[p.armor], C = w.course, run = p.run;
    const t = w.terrain;
    const gi = run && !run.done ? run.gate : -1;
    const v = p.vel, sp = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
    const ground = t.height(p.pos[0], p.pos[2]), alt = p.pos[1] - ground;
    const energyF = p.energy / A.energy;
    if (bot.jet && energyF < 0.1) bot.jet = false;
    if (!bot.jet && energyF > 0.5) bot.jet = true;
    let jet = false, want = false, mdx = 0, mdz = 0, wantYaw = bot.yaw, wantPitch = 0;
    if (gi >= 0) {
      const g = C.gates[gi];
      // aim a little past the gate along its facing, so we go through it rather than turning at it
      const goal = [g.c[0] + g.n[0] * 4, g.c[1], g.c[2] + g.n[2] * 4];
      const dx = goal[0] - p.pos[0], dz = goal[2] - p.pos[2], hd = Math.sqrt(dx * dx + dz * dz) || 1;
      const dy = goal[1] - (p.pos[1] + A.h * 0.5);
      const ux = dx / hd, uz = dz / hd;
      want = true;
      // steer by the velocity we want: the speed we have (or a little, when slow), pointed at the gate
      const vmax = Math.max(sp, 20);
      const ex = ux * vmax - v[0], ez = uz * vmax - v[2], el = Math.sqrt(ex * ex + ez * ez);
      if (el > 1) { mdx = ex / el; mdz = ez / el; } else { mdx = ux; mdz = uz; }
      const toward = v[0] * ux + v[2] * uz;
      const fl = Math.max(t.waterH ?? -Infinity, t.lavaH ?? -Infinity);
      const ahead = 18 + sp * 0.9;
      const rise = Math.max(t.height(p.pos[0] + ux * ahead, p.pos[2] + uz * ahead), fl) - ground; // the land ahead, relative to our feet
      const climb = toward > 0 ? toward * toward / (2 * GRAV) * 0.7 : 0;                          // how high our speed can carry us
      const cosv = sp > 1 ? (v[0] * ux + v[2] * uz) / sp : 1;
      const miss = cosv > 0 ? hd * Math.sqrt(Math.max(0, 1 - cosv * cosv)) : hd; // how far from the gate we would pass at this heading
      if (dy > 3 && hd < 70 && v[1] < 6) jet = bot.jet || (p.jetting && p.energy > 2);   // the gate is up there: go up in one go
      else if (rise > 2 + climb && hd > 20) jet = bot.jet;                               // a hill we cannot ski over
      else if (p.ground && toward < 10 && rise > -1) jet = bot.jet;                      // crawling on the flat: get going
      if (sp > 12 && miss > g.r * 0.5 && bot.jet) jet = true;                              // would miss the gate: turn with the jets
      if (!p.ground && v[1] < -24 && alt < 45 && p.energy > 3) jet = true;               // land softly
      if (!p.ground && sp > 25 && p.energy > 2) {                                        // about to fly into a hillside
        const ax = p.pos[0] + v[0] * 0.6, az = p.pos[2] + v[2] * 0.6, ay = p.pos[1] + v[1] * 0.6;
        if (t.height(ax, az) > ay - 1) jet = true;
      }
      if (t.lavaH != null && ground < t.lavaH + 1 && alt < 8 && p.energy > 2) jet = true; // never stand in lava
      if (t.waterH != null && p.pos[1] < t.waterH + 0.5) jet = bot.jet || (p.jetting && p.energy > 2);
      const hAhead = rise + ground;
      // ski unless crawling uphill with the jets off
      if (p.ground && !(sp < 7 && hAhead > ground + 2 && !jet)) inp.b |= B.JUMP;
      wantYaw = Math.atan2(-ux, -uz);
      wantPitch = clamp(Math.atan2(dy, hd) * 0.6, -0.5, 0.5);
    }
    if (jet) inp.b |= B.JET;

    // a target in sight during the run: look at it and shoot, discs from a distance, the chaingun up close
    let tgt = null;
    if (run && run.t0 >= 0 && !run.done) {
      const eyeP = JF.eye(p);
      let bd = 70 + skill * 40;
      for (const o of C.targets) {
        if (run.hit[o.ti]) continue;
        const d = dist3(o.c, eyeP);
        if (d < bd && !w.blocked(eyeP, o.c)) { tgt = o; bd = d; }
      }
      if (tgt) {
        const eyeP2 = eyeP, d = bd;
        const wk = d < 14 && p.weapons.indexOf('chain') >= 0 ? 'chain' : p.weapons.indexOf('disc') >= 0 ? 'disc' : p.weapons[0];
        const wi = p.weapons.indexOf(wk), W = WEAPONS[wk];
        if (wi !== p.wi) inp.w = wi;
        bot.errT -= dt;
        if (bot.errT <= 0) { bot.errT = 0.5; const e = Math.pow(1 - skill, 1.2) * 0.12 + 0.005; bot.aimErr = [(Math.random() - 0.5) * 2 * e, (Math.random() - 0.5) * 2 * e]; }
        const relV = [-v[0] * W.inherit, -v[1] * W.inherit, -v[2] * W.inherit];
        const aim = JF.leadAim(eyeP2, tgt.c, relV, W.speed, W.grav || 0);
        wantYaw = Math.atan2(-aim[0], -aim[2]) + bot.aimErr[0];
        wantPitch = Math.asin(clamp(aim[1], -1, 1)) + bot.aimErr[1];
        const tol = 0.025 + (W.r ? Math.min(0.12, W.r / Math.max(d, 1) * 0.5) : 0.015);
        const ready = W.ammo > 0 ? p.ammo[wk] > 0 : (!W.energy || p.energy >= W.energy);
        if (wi === p.wi && Math.abs(angDiff(bot.yaw, wantYaw)) < tol && Math.abs(bot.pitch - wantPitch) < tol && ready && !(W.r > 0 && d < W.r)) inp.b |= B.FIRE;
      }
    }

    const turn = (2.5 + skill * 7) * dt;
    bot.yaw += clamp(angDiff(bot.yaw, wantYaw), -turn, turn);
    bot.pitch = clamp(bot.pitch + clamp(wantPitch - bot.pitch, -turn, turn), -1.5, 1.5);
    inp.yaw = bot.yaw; inp.pitch = bot.pitch;
    if (want) {
      const sy = Math.sin(bot.yaw), cy = Math.cos(bot.yaw);
      inp.mz = clamp(-sy * mdx - cy * mdz, -1, 1);
      inp.mx = clamp(cy * mdx - sy * mdz, -1, 1);
    }
    return inp;
  }

  function angDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  const api = { NAMES, LOADOUTS, name, loadout, create, think, courseThink, route, angDiff };
  void PROJ; void GRAV;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JFBots = api;
})(typeof window !== 'undefined' ? window : globalThis);
