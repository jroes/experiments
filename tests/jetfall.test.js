'use strict';
// Jetfall: rules, movement, packets and the host. The host's browser runs sim.js; every other browser predicts its own
// player with the same movePlayer, so most of these are about the two agreeing and about junk from the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const JF = require('../jetfall/sim.js');
const Net = require('../jetfall/net.js');
const Bots = require('../jetfall/bots.js');

const { B, TICK, ARMORS } = JF;
const idle = (o) => Object.assign({ seq: 0, b: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, w: 255 }, o || {});

function rng(seed) { return JF.mulberry(seed); }
function spawned(world, id, o) {
  const p = world.addPlayer(Object.assign({ id, name: 'p' + id }, o || {}));
  for (let i = 0; i < 40 && !p.alive; i++) { world.step(); world.applyInput(p, idle({ yaw: p.yaw })); }
  assert.ok(p.alive, 'player spawned');
  return p;
}
const finite = v => v.every(Number.isFinite);

test('the land is the same every time, and height() matches the stored corners', () => {
  for (const k of JF.MAP_KEYS) {
    const a = JF.makeTerrain(k), b = JF.makeTerrain(k);
    assert.deepEqual(a.h, b.h, k);
    for (let i = 0; i < 200; i++) {
      const ix = (i * 37) % (JF.N + 1), iz = (i * 91) % (JF.N + 1);
      if (ix === JF.N || iz === JF.N) continue;
      assert.ok(Math.abs(a.height(ix * JF.CELL, iz * JF.CELL) - a.at(ix, iz)) < 1e-3, k + ' corner ' + ix + ',' + iz);
    }
    // the land is point symmetric, so neither base has the better side
    for (let i = 0; i < 50; i++) {
      const x = 300 + i * 29, z = 400 + i * 23;
      assert.ok(Math.abs(a.height(x, z) - a.height(JF.SIZE - x, JF.SIZE - z)) < 0.5, k + ' symmetric at ' + x + ',' + z);
    }
  }
});

test('a ray down always meets the land just where height() says', () => {
  const t = JF.makeTerrain('ashfall');
  const r = rng(3);
  for (let i = 0; i < 500; i++) {
    const x = 50 + r() * (JF.SIZE - 100), z = 50 + r() * (JF.SIZE - 100);
    const h = t.height(x, z);
    const f = t.raycast(x, h + 50, z, x, h - 50, z);
    assert.ok(f > 0.45 && f < 0.55, 'hit at ' + f);
  }
});

test('the bases are mirror images and the flags sit on the roofs', () => {
  const w = new JF.World({ map: 'highland' });
  assert.equal(w.bases.length, 2);
  const c = JF.SIZE / 2;
  for (const s of w.solids.filter(s => s.team === 0)) {
    const b = s.b;
    const m = [2 * c - b[3], b[1], 2 * c - b[5], 2 * c - b[0], b[4], 2 * c - b[2]];
    assert.ok(w.solids.some(o => o.team === 1 && o.b.every((v, i) => Math.abs(v - m[i]) < 1e-6)), 'mirror of ' + s.mat);
  }
  for (const f of w.flags) assert.ok(f.home[1] > w.terrain.padH + 9, 'flag up on the roof');
  assert.ok(w.objects.filter(o => o.kind === 'gen').length === 2);
});

test('walking, jetting and skiing never go wild: no NaN, no falling through, energy in range', () => {
  for (const map of JF.MAP_KEYS) {
    const w = new JF.World({ map, seed: 9 });
    const ps = [1, 2, 3, 4].map(id => spawned(w, id, { team: id % 2 }));
    const r = rng(11);
    for (const p of ps) { JF.equip(p, { armor: JF.ARMOR_KEYS[p.id % 3], weapons: ['disc'], pack: 'energy' }); }
    for (let t = 0; t < 60 * 40; t++) {
      w.step();
      for (const p of ps) {
        if (!p.alive) { w.applyInput(p, idle({ b: B.FIRE })); continue; }
        const inp = idle({ b: (r() < 0.5 ? B.JET : 0) | (r() < 0.4 ? B.JUMP : 0), mx: r() * 2 - 1, mz: r() * 2 - 1, yaw: p.yaw + (r() - 0.5) * 0.2, pitch: (r() - 0.5) * 2 });
        w.applyInput(p, inp);
        assert.ok(finite(p.pos) && finite(p.vel), map + ' finite');
        assert.ok(p.pos[1] >= w.terrain.height(p.pos[0], p.pos[2]) - 0.05, map + ' under the land at tick ' + t);
        assert.ok(p.pos[0] >= 0 && p.pos[0] <= JF.SIZE && p.pos[2] >= 0 && p.pos[2] <= JF.SIZE);
        assert.ok(p.energy >= 0 && p.energy <= ARMORS[p.armor].energy + 1e-9, 'energy ' + p.energy);
      }
    }
  }
});

test('skiing down a hill is faster than walking, and jets lift every armor', () => {
  const w = new JF.World({ map: 'dunes' });
  for (const armor of JF.ARMOR_KEYS) {
    const p = spawned(w, 1, { team: 0 });
    JF.equip(p, { armor, weapons: ['disc'], pack: 'none' });
    p.pos = [JF.SIZE / 2, w.terrain.height(JF.SIZE / 2, JF.SIZE / 2) + 0.01, JF.SIZE / 2]; p.vel = [0, 0, 0];
    const y0 = p.pos[1];
    for (let i = 0; i < 60; i++) w.applyInput(p, idle({ b: B.JET }));
    assert.ok(p.pos[1] > y0 + 5, armor + ' jets lift: ' + (p.pos[1] - y0));
    w.removePlayer(1);
  }
  // on a long even slope, skiing keeps the speed that walking throws away
  const V = JF.N + 1, H = new Float32Array(V * V);
  for (let iz = 0; iz < V; iz++) for (let ix = 0; ix < V; ix++) H[iz * V + ix] = 900 - ix * JF.CELL * 0.3;
  const slope = new JF.World({ map: 'dunes', terrain: new JF.Terrain(H, 300) });
  const p = spawned(slope, 2, { team: 0 });
  const run = ski => {
    p.pos = [600, slope.terrain.height(600, 1500), 1500]; p.vel = [0, 0, 0]; p.ground = true; p.gn = slope.terrain.normal(600, 1500); p.alive = true;
    for (let i = 0; i < 240; i++) slope.applyInput(p, idle({ b: ski ? B.JUMP : 0, mz: ski ? 0 : 1, yaw: -Math.PI / 2 }));
    return Math.hypot(p.vel[0], p.vel[2]);
  };
  const skiSpeed = run(true), walkSpeed = run(false);
  assert.ok(skiSpeed > walkSpeed + 5, 'ski ' + skiSpeed + ' walk ' + walkSpeed);
});

test('walls stop you: no running or skiing through a bunker', () => {
  const w = new JF.World({ map: 'highland' });
  const p = spawned(w, 1, { team: 0 });
  const o = w.bases[0].o;
  for (const speed of [12, 60, 150]) {
    p.pos = [o.x - 30 * o.face, o.y + 3, o.z + 5]; p.vel = [speed * o.face, 0, 0]; p.alive = true; p.hp = 70;
    for (let i = 0; i < 120; i++) w.applyInput(p, idle({ b: B.JUMP, yaw: p.yaw }));
    const lx = (p.pos[0] - o.x) * o.face;
    assert.ok(lx < -12 + 0.01 || !p.alive, 'stopped at the back wall at ' + speed + ' m/s, local x ' + lx);
  }
});

test('prediction: a client running movePlayer on the same inputs ends exactly where the host does', () => {
  const host = new JF.World({ map: 'frost', seed: 2 });
  const p = spawned(host, 7, { team: 1 });
  const geo = new JF.World({ map: 'frost' }); geo.damage = null;
  const q = JF.newPlayer(7, 'x', 1, false);
  for (const k of ['pos', 'vel', 'gn']) q[k] = p[k].slice();
  for (const k of ['armor', 'energy', 'hp', 'ground', 'wasJet', 'kick', 'pack', 'prevB']) q[k] = p[k];
  const r = rng(5);
  for (let i = 0; i < 1200; i++) {
    const inp = Net.quantize(idle({ seq: i, b: r() < 0.5 ? B.JET : r() < 0.5 ? B.JUMP : 0, mx: r() * 2 - 1, mz: r() * 2 - 1, yaw: r() * 6, pitch: r() - 0.5 }));
    host.applyInput(p, inp);
    JF.movePlayer(geo, q, inp, TICK); q.prevB = inp.b;
    if (!p.alive) break;
  }
  assert.deepEqual(q.pos, p.pos);
  assert.deepEqual(q.vel, p.vel);
  assert.equal(q.energy, p.energy);
});

test('inputs survive the trip: quantize, encode, decode give the very same numbers', () => {
  const r = rng(8);
  const list = [];
  for (let i = 0; i < 12; i++) list.push(Net.quantize({ seq: 1000 + i, b: (r() * 64) | 0, mx: r() * 4 - 2, mz: r() * 2 - 1, yaw: r() * 30 - 15, pitch: r() * 4 - 2, w: (r() * 6) | 0 }));
  const bytes = Net.encodeInputs(list, 77, 999);
  const rd = new Net.Reader(bytes); assert.equal(rd.u8(), Net.T.INPUT);
  const m = Net.decodeInputs(rd);
  assert.equal(m.ackEv, 77); assert.equal(m.ackSnap, 999);
  assert.deepEqual(m.list, list);
  for (const q of list) assert.deepEqual(Net.quantize(q), q, 'quantize is stable');
});

test('a snapshot says what the world says', () => {
  const h = new Net.Host({ send() {}, settings: { map: 'highland', bots: 5, skill: 1 } });
  for (let i = 0; i < 60 * 40; i++) h.tickOnce();
  const w = h.world;
  const pid = [...w.players.keys()][0];
  const bytes = Net.encodeSnap(w, pid, 55, 0, { overIn: 3, next: 'x' });
  const rd = new Net.Reader(bytes); assert.equal(rd.u8(), Net.T.SNAP);
  const s = Net.decodeSnap(rd);
  assert.equal(s.tick, w.tick); assert.equal(s.ack, 55); assert.equal(s.you, pid);
  assert.equal(s.players.length, w.players.size);
  for (const sp of s.players) {
    const p = w.players.get(sp.id);
    assert.ok(Math.abs(sp.pos[0] - p.pos[0]) < 1e-3 && Math.abs(sp.pos[1] - p.pos[1]) < 1e-3);
    assert.equal(sp.alive, p.alive); assert.equal(sp.team, p.team); assert.equal(sp.armor, p.armor);
  }
  const me = w.players.get(pid);
  assert.deepEqual(s.me.weapons, me.weapons);
  assert.equal(s.me.wi, me.wi);
  assert.equal(s.flags.length, 2);
  assert.equal(s.objects.length, w.objects.length);
  assert.ok(s.events.length > 0);
  assert.deepEqual(s.extra, { overIn: 3, next: 'x' });
});

test('junk from the network: the host never throws and nothing changes that should not', () => {
  const sent = [];
  const h = new Net.Host({ send: (peer, bytes, rel) => sent.push({ peer, bytes, rel }), settings: { map: 'highland', bots: 2 } });
  const r = rng(13);
  const junk = n => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (r() * 256) | 0; return u; };
  for (let i = 0; i < 3000; i++) {
    const peer = 1 + ((r() * 4) | 0); // peer 0 is the host's own page
    const kind = r();
    if (kind < 0.3) h.receive(peer, junk((r() * 80) | 0));
    else if (kind < 0.6) { const u = junk(1 + ((r() * 60) | 0)); u[0] = Net.T.INPUT; h.receive(peer, u); }
    else {
      const evil = [{ t: 'hello', v: Net.PROTO, name: '<b>' + 'x'.repeat(500), loadout: { armor: 'constructor', weapons: ['__proto__', 'toString', 'disc', 'disc', 'mortar'], pack: 'hasOwnProperty' }, team: 7 },
        { t: 'loadout', loadout: { armor: 'heavy', weapons: ['laser', 'mortar', 'mortar', 'disc'], pack: 'shield' } },
        { t: 'team', team: '1' }, { t: 'team', team: 1 }, { t: 'chat', text: { toString: 1 } }, { t: 'chat', text: 'a'.repeat(5000) },
        { t: 'host', cmd: 'settings', settings: { bots: 999 } }, { t: 'kill' }, null, [], 'x', 5][(r() * 12) | 0];
      h.receive(peer, Net.encodeCtrl(evil && typeof evil === 'object' && !Array.isArray(evil) ? evil : { t: String(evil) }));
    }
    h.tickOnce();
  }
  for (const p of h.world.players.values()) {
    assert.ok(p.name.length <= 20 && !/[<>]/.test(p.name));
    assert.ok(JF.has(ARMORS, p.loadout.armor));
    for (const k of p.loadout.weapons) assert.ok(JF.has(JF.WEAPONS, k) && !JF.NOT_FOR[p.loadout.armor].includes(k));
    assert.equal(new Set(p.loadout.weapons).size, p.loadout.weapons.length);
    assert.ok(finite(p.pos));
  }
  // only the host's own page (peer 0) may change the game settings
  assert.equal(h.settings.bots, 2);
  for (const e of h.world.events) if (e.k === 'chat') assert.ok(e.text.length <= 140);
});

test('a flood of inputs cannot make you faster than one tick per tick', () => {
  const h = new Net.Host({ send() {}, settings: { map: 'dunes', bots: 0 } });
  h.receive(1, Net.encodeCtrl({ t: 'hello', v: Net.PROTO, name: 'speedy' }));
  const pid = h.peers.get(1).pid;
  for (let i = 0; i < 120; i++) h.tickOnce();
  const p = h.world.players.get(pid);
  assert.ok(p.alive);
  let seq = 1, ran = 0;
  const apply = h.world.applyInput.bind(h.world);
  h.world.applyInput = (pl, q) => { if (pl === p) ran++; apply(pl, q); };
  const t0 = h.world.tick;
  for (let i = 0; i < 300; i++) {
    const list = [];
    for (let k = 0; k < 16; k++) list.push(Net.quantize(idle({ seq: seq++, mz: 1 })));
    h.receive(1, Net.encodeInputs(list, 0, 0));
    h.tickOnce();
  }
  const ticks = h.world.tick - t0;
  assert.ok(ran <= ticks + 12, 'ran ' + ran + ' inputs in ' + ticks + ' ticks');
});

test('capture the flag: take, drop, return, capture, and the match ends at the cap limit', () => {
  const w = new JF.World({ map: 'highland', capLimit: 2 });
  const a = spawned(w, 1, { team: 0 }), d = spawned(w, 2, { team: 1 });
  const their = w.flags[1], ours = w.flags[0];
  const put = (p, at) => { p.pos = [at[0], at[1], at[2]]; p.vel = [0, 0, 0]; };
  put(a, their.home); w.step();
  assert.equal(their.state, 'carried'); assert.equal(a.flag, 1);
  // killed: the flag drops where you were
  w.damage(a, 999, d, 'disc', null, 0, 1);
  assert.equal(a.alive, false); assert.equal(their.state, 'dropped');
  for (let i = 0; i < 120; i++) w.step();
  // the defender touches it: home again
  put(d, their.pos); w.step();
  assert.equal(their.state, 'home');
  // take it again and bring it home
  for (let i = 0; i < 400 && !a.alive; i++) { w.step(); w.applyInput(a, idle({ b: i % 2 ? B.FIRE : 0 })); }
  for (let cap = 1; cap <= 2; cap++) {
    put(a, their.home); w.step(); assert.equal(their.state, 'carried');
    put(a, ours.home); w.step();
    assert.equal(their.state, 'home'); assert.equal(w.score[0], cap); assert.equal(a.flag, -1);
  }
  assert.ok(w.over && w.over.winner === 0);
});

test('the flag is picked up when you skim over its top or fly past it fast, and not from well above', () => {
  for (const [lift, gap, want] of [[0.5, 0, true], [3.2, 0, true], [3.2, 12, true], [3.2, 26, true], [6, 0, false], [2, 1e3, false]]) {
    const w = new JF.World({ map: 'highland' });
    const a = spawned(w, 1, { team: 0 });
    const h = w.flags[1].home;
    // one tick on one side, the next on the other (gap 0: just hang there; gap 1e3: a teleport, which is not a flight past)
    a.pos = [h[0] - gap / 2, h[1] + lift, h[2] + 1]; a.vel = [0, 0, 0]; w.step();
    a.pos = [h[0] + gap / 2, h[1] + lift, h[2] + 1]; w.step();
    assert.equal(a.flag === 1, want, 'feet ' + lift + ' m up, moved ' + gap + ' m');
  }
});

test('a dropped flag goes home by itself after a while, and you cannot capture while yours is away', () => {
  const w = new JF.World({ map: 'dunes' });
  const a = spawned(w, 1, { team: 0 }), b = spawned(w, 2, { team: 1 });
  b.pos = w.flags[0].home.slice(); w.step();
  assert.equal(w.flags[0].state, 'carried');
  a.pos = w.flags[1].home.slice(); w.step();
  assert.equal(a.flag, 1);
  a.pos = w.flags[0].home.slice(); w.step(); // our flag is not home: no capture
  assert.equal(w.score[0], 0);
  b.pos = [b.pos[0] + 60, b.pos[1], b.pos[2]];
  w.kill(b, a, 'disc');
  assert.equal(w.flags[0].state, 'dropped');
  for (let i = 0; i < 60 * (JF.FLAG_RETURN_S + 1); i++) w.step();
  assert.equal(w.flags[0].state, 'home');
});

test('discs: splash hurts and shoves, your own blast hurts you half as much, teammates are safe', () => {
  const w = new JF.World({ map: 'highland' });
  const a = spawned(w, 1, { team: 0 }), mate = spawned(w, 2, { team: 0 }), foe = spawned(w, 3, { team: 1 });
  const W = JF.WEAPONS.disc;
  const o = w.bases[0].o, at = [o.x + 60 * o.face, 0, o.z]; at[1] = w.terrain.height(at[0], at[2]); // open ground in front of a base
  for (const p of [a, mate, foe]) { p.pos = [at[0] + 2, at[1], at[2]]; p.vel = [0, 0, 0]; p.hp = ARMORS[p.armor].hp; p.spawnProt = 0; }
  w.splash([at[0], at[1] + 0.2, at[2]], W, { owner: 1, team: 0, kind: 'disc' }, null);
  assert.equal(mate.hp, ARMORS[mate.armor].hp, 'no team damage');
  const self = ARMORS.light.hp - a.hp, enemy = ARMORS.light.hp - foe.hp;
  assert.ok(enemy > 0 && Math.abs(self - enemy / 2) < 1e-6, 'self ' + self + ' enemy ' + enemy);
  assert.ok(foe.vel[1] > 5 && a.vel[1] > 5, 'blasts at the feet lift you');
});

test('the generator powers stations and turrets; repair brings them back', () => {
  const w = new JF.World({ map: 'highland' });
  const foe = spawned(w, 1, { team: 1 }), fixer = spawned(w, 2, { team: 0 });
  const gen = w.objects.find(o => o.kind === 'gen' && o.team === 0);
  w.hurtObj(gen, 10000, foe, 1);
  assert.equal(gen.up, false); assert.equal(w.power(0), false);
  // stations do nothing without power
  const st = w.objects.find(o => o.kind === 'station' && o.team === 0);
  fixer.loadout = { armor: 'heavy', weapons: ['mortar', 'disc'], pack: 'repair' };
  fixer.pos = [st.c[0], st.b[4], st.c[2]];
  for (let i = 0; i < 120; i++) { w.step(); w.applyInput(fixer, idle()); }
  assert.equal(fixer.armor, 'light');
  // turrets hold fire
  foe.pos = [w.flags[0].home[0] + 20, w.flags[0].home[1] + 5, w.flags[0].home[2]];
  for (let i = 0; i < 120; i++) w.step();
  assert.ok(!w.proj.some(p => p.kind === 'tbolt' && p.team === 0), 'unpowered turrets do not fire');
  // repair: look at the generator with a repair pack
  JF.equip(fixer, { armor: 'medium', weapons: ['disc'], pack: 'repair' });
  fixer.pos = [gen.c[0] + 4, gen.b[1] + 0.1, gen.c[2]];
  const eye = JF.eye(fixer);
  const dx = gen.c[0] - eye[0], dy = gen.c[1] - eye[1], dz = gen.c[2] - eye[2];
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  for (let i = 0; i < 60 * 15 && !gen.up; i++) { w.step(); w.applyInput(fixer, idle({ b: B.PACK, yaw, pitch })); }
  assert.ok(gen.up, 'repaired');
  // now the station works
  fixer.pos = [st.c[0], st.b[4], st.c[2]]; fixer.vel = [0, 0, 0];
  for (let i = 0; i < 120; i++) { w.step(); w.applyInput(fixer, idle({ yaw: fixer.yaw })); }
  assert.equal(fixer.armor, 'heavy');
  assert.deepEqual(fixer.weapons, ['mortar', 'disc']);
});

test('loadouts from anywhere are cleaned', () => {
  assert.equal(JF.cleanLoadout(null), null);
  assert.equal(JF.cleanLoadout({ armor: 'constructor' }), null);
  assert.equal(JF.cleanLoadout({ armor: '__proto__' }), null);
  const lo = JF.cleanLoadout({ armor: 'light', weapons: ['mortar', 'laser', 'laser', 'toString', 'disc', 'chain', 'gl'], pack: 'valueOf' });
  assert.deepEqual(lo, { armor: 'light', weapons: ['laser', 'disc', 'chain'], pack: 'none' });
  assert.deepEqual(JF.cleanLoadout({ armor: 'heavy', weapons: 'disc' }), { armor: 'heavy', weapons: ['blaster'], pack: 'none' });
});

test('the host: bots fill the teams and make room for people; refused when the version differs', () => {
  const out = [];
  const h = new Net.Host({ send: (peer, bytes) => out.push({ peer, bytes }), settings: { map: 'highland', bots: 3 } });
  assert.equal(h.world.players.size, 6);
  h.receive(1, Net.encodeCtrl({ t: 'hello', v: Net.PROTO, name: 'ann', team: 0 }));
  assert.equal(h.world.players.size, 6, 'a bot stepped aside');
  assert.equal([...h.world.players.values()].filter(p => p.team === 0 && !p.bot).length, 1);
  h.receive(2, Net.encodeCtrl({ t: 'hello', v: 999, name: 'old' }));
  const last = out.filter(o => o.peer === 2).pop();
  const rd = new Net.Reader(last.bytes); rd.u8();
  assert.equal(JSON.parse(rd.str()).why, 'version');
  h.leave(1);
  assert.equal(h.world.players.size, 6);
  assert.ok([...h.world.players.values()].every(p => p.bot));
});

test('bots play: on every map they fight, and somebody takes a flag within ten minutes', () => {
  for (const map of JF.MAP_KEYS) {
    const h = new Net.Host({ send() {}, settings: { map, bots: 5, skill: 0.7, caps: 99, minutes: 30 } });
    let kills = 0, takes = 0, last = 0;
    for (let i = 0; i < 60 * 60 * 10 && !(kills > 5 && takes > 0); i++) {
      h.tickOnce();
      for (const e of h.world.events) if (e.s > last) { last = e.s; if (e.k === 'kill' && e.by >= 0) kills++; if (e.k === 'flag' && e.a === 'take') takes++; }
    }
    assert.ok(kills > 5, map + ': kills ' + kills);
    assert.ok(takes > 0, map + ': no flag taken');
  }
});

test('bot names and loadouts are valid', () => {
  for (let i = 0; i < 30; i++) {
    const lo = Bots.loadout(i);
    assert.deepEqual(JF.cleanLoadout(lo), lo, 'loadout ' + i);
  }
});

test('the client: welcome, snapshots, prediction and a smooth view', () => {
  let client;
  const h = new Net.Host({ send: (peer, bytes) => { if (peer === 0) client.receive(bytes); }, settings: { map: 'frost', bots: 2 } });
  client = new Net.Client({ send: b => h.receive(0, b), name: 'me', loadout: JF.DEFAULT_LOADOUT });
  client.hello(0);
  assert.equal(client.status, 'playing');
  let maxErr = 0;
  for (let f = 0; f < 600; f++) {
    h.update(1 / 60);
    client.update(1 / 60, { b: f > 100 && f < 200 ? B.JET : 0, mx: 0, mz: f > 60 ? 1 : 0, yaw: -Math.PI / 2, pitch: 0, w: 255 });
    const hp = h.world.players.get(client.welcome.you);
    if (client.me && client.me.alive && hp.alive) maxErr = Math.max(maxErr, Math.hypot(client.me.pos[0] - hp.pos[0], client.me.pos[2] - hp.pos[2]));
    const v = client.view();
    if (v) for (const p of v.players) assert.ok(finite(p.pos));
  }
  // with no lag the prediction is at most a tick or two ahead of the host
  assert.ok(maxErr < 3, 'prediction drifted ' + maxErr);
});

test('a match ends, the next map starts, and the client follows without losing its place', () => {
  let client;
  const h = new Net.Host({ send: (peer, bytes) => { if (peer === 0) client.receive(bytes); }, settings: { map: 'highland', bots: 1, caps: 1, rotate: true } });
  client = new Net.Client({ send: b => h.receive(0, b), name: 'me', loadout: JF.DEFAULT_LOADOUT });
  client.hello(0);
  const you = client.welcome.you;
  for (let f = 0; f < 120; f++) { h.update(1 / 60); client.update(1 / 60, idle()); }
  h.world.finish(0);
  let maps = new Set([client.welcome.map]);
  for (let f = 0; f < 60 * 14; f++) { h.update(1 / 60); client.update(1 / 60, idle()); maps.add(client.welcome.map); }
  assert.ok(maps.has('dunes'), 'moved on to the next map: ' + [...maps]);
  assert.equal(client.world.mapKey, 'dunes');
  assert.equal(client.welcome.you, you, 'same player id');
  assert.equal(h.world.over, null);
  for (let f = 0; f < 120; f++) { h.update(1 / 60); client.update(1 / 60, idle()); }
  assert.ok(client.me && client.me.alive, 'playing again');
  assert.ok(client.takeEvents().some(e => e.k === 'map' && e.map === 'dunes'));
});

test('bot skill matters: easy bots barely hurt a dodging player, brutal ones do', () => {
  // one bot at a time against a strafing, jetting dummy, put back 30-70 m apart every 6 s
  const duel = skill => {
    let dmg = 0;
    const w = new JF.World({ map: 'highland', seed: 3 });
    const d = spawned(w, 1, { team: 0 });
    for (const slot of [0, 1, 2]) {
      const b = w.addPlayer({ id: 10 + slot, name: 'bot', team: 1, bot: true, loadout: Bots.loadout(slot) });
      b.skill = skill;
      const brain = Bots.create(b); brain.role = 'defense';
      let t = 0, last = w.evSeq;
      for (let i = 0; i < 60 * 48; i++) {
        t += TICK;
        if (i % 360 === 0) {
          for (const p of [d, b]) if (!p.alive) w.spawn(p);
          JF.equip(b, b.loadout);
          const cx = 1024 + (i % 7) * 30, cz = 1024, ang = i * 0.37, r = 30 + (i % 3) * 20;
          d.pos = [cx, w.terrain.height(cx, cz) + 0.1, cz]; d.vel = [0, 0, 0]; d.hp = 70; d.spawnProt = 0;
          b.pos = [cx + Math.cos(ang) * r, 0, cz + Math.sin(ang) * r]; b.pos[1] = w.terrain.height(b.pos[0], b.pos[2]) + 0.1; b.vel = [0, 0, 0]; b.spawnProt = 0;
        }
        w.step();
        if (d.alive) w.applyInput(d, idle({ b: (Math.sin(t * 0.9) > 0.2 ? B.JET : 0) | (Math.sin(t * 1.7) > 0 ? B.JUMP : 0), mx: Math.sin(t * 1.3) > 0 ? 1 : -1, mz: Math.sin(t * 0.5) * 0.6, yaw: t * 0.2 }));
        if (b.alive) w.applyInput(b, Bots.think(brain, w, b));
        for (const e of w.events) if (e.s > last) { last = e.s; if (e.k === 'hit' && e.by === b.id) dmg += e.d; }
      }
      w.removePlayer(b.id);
    }
    return dmg;
  };
  // bots use Math.random, so seed it and add up several duels: one duel is too noisy to compare
  const random = Math.random;
  const total = skill => {
    let sum = 0;
    for (let seed = 1; seed <= 4; seed++) { Math.random = JF.mulberry(seed * 7919); sum += duel(skill); }
    return sum;
  };
  let easy, normal, brutal;
  try { easy = total(0.2); normal = total(0.5); brutal = total(1); } finally { Math.random = random; }
  assert.ok(easy * 3 < brutal, 'easy ' + easy + ' brutal ' + brutal);
  assert.ok(normal < brutal * 0.7, 'normal ' + normal + ' brutal ' + brutal);
});

test('quick chat: only lines from the list go out, team lines only to the team', () => {
  const VGS = require('../jetfall/vgs.js');
  assert.deepEqual(VGS.line('GS'), { text: 'Shazbot!', team: false });
  for (const bad of ['', 'G', 'GSX', 'Gs', 'ZZ', '__', 'Gc', 'G_', null, 5, { toString: () => 'GS' }, 'constructor', 'Gconstructor']) assert.equal(VGS.line(bad), null, String(bad));
  const sent = [];
  const h = new Net.Host({ send: (peer, bytes) => sent.push({ peer, bytes }), settings: { map: 'highland', bots: 0 } });
  h.receive(1, Net.encodeCtrl({ t: 'hello', v: Net.PROTO, name: 'a', team: 0 }));
  h.receive(2, Net.encodeCtrl({ t: 'hello', v: Net.PROTO, name: 'b', team: 1 }));
  const chats = () => h.world.events.filter(e => e.k === 'chat');
  h.receive(1, Net.encodeCtrl({ t: 'chat', vgs: 'GS' }));
  for (let i = 0; i < 60; i++) h.tickOnce();
  h.receive(1, Net.encodeCtrl({ t: 'chat', vgs: 'XX', text: 'made up' }));
  for (let i = 0; i < 60; i++) h.tickOnce();
  h.receive(1, Net.encodeCtrl({ t: 'chat', vgs: 'FG' }));
  assert.deepEqual(chats().map(e => [e.text, e.team, e.vgs]), [['Shazbot!', null, 'GS'], ['I have the enemy flag!', 0, 'FG']]);
  // the team line does not reach the other team's snapshot
  const pa = h.peers.get(1).pid, pb = h.peers.get(2).pid;
  const evs = pid => { const r = new Net.Reader(Net.encodeSnap(h.world, pid, 0, 0)); r.u8(); return Net.decodeSnap(r).events.filter(e => e.k === 'chat').map(e => e.text); };
  assert.deepEqual(evs(pa), ['Shazbot!', 'I have the enemy flag!']);
  assert.deepEqual(evs(pb), ['Shazbot!']);
});

test('a disc hit lifts you off your feet and you keep flying for a moment', () => {
  const w = new JF.World({ map: 'dunes' });
  const a = spawned(w, 1, { team: 0 }), b = spawned(w, 2, { team: 1 });
  const x = 1024, z = 1024;
  b.pos = [x, w.terrain.height(x, z), z]; b.vel = [0, 0, 0]; b.ground = true; b.spawnProt = 0;
  // a blast level with the chest, from the side: it still lifts
  w.splash([x + 1, b.pos[1] + 1.2, z], JF.WEAPONS.disc, { owner: a.id, team: 0, kind: 'disc' }, b);
  assert.ok(b.vel[1] > 5, 'lifted ' + b.vel[1]);
  const x0 = b.pos[0];
  for (let i = 0; i < 30; i++) w.applyInput(b, idle());
  assert.ok(Math.abs(b.pos[0] - x0) > 6, 'moved ' + (b.pos[0] - x0));
});

test('grenades keep all of your speed when you fire on the move', () => {
  const w = new JF.World({ map: 'dunes' });
  const a = spawned(w, 1, { team: 0 });
  JF.equip(a, { armor: 'light', weapons: ['gl'], pack: 'none' }); a.wi = 0;
  a.pos = [1024, 400, 1024]; a.vel = [60, 0, 0]; a.fireCd = 0; a.switchT = 0;
  w.applyInput(a, idle({ b: B.FIRE, yaw: Math.PI / 2 })); // fire straight back while flying forward
  const g = w.proj.find(p => p.kind === 'gl');
  assert.ok(g, 'fired');
  assert.ok(Math.abs(g.vel[0] - (60 - JF.WEAPONS.gl.speed)) < 1, 'vx ' + g.vel[0]);
});

test('turrets: four discs take one down, and they cannot snap round to a target behind them', () => {
  const w = new JF.World({ map: 'highland' });
  const a = spawned(w, 1, { team: 0 });
  const t = w.objects.find(o => o.kind === 'turret' && o.team === 1);
  for (let i = 0; i < 4; i++) w.splash(t.c.slice(), JF.WEAPONS.disc, { owner: a.id, team: 0, kind: 'disc' }, null);
  assert.equal(t.up, false);
  // a fresh world: a target appears on the side the turret is not facing, and it takes a while to come round
  const w2 = new JF.World({ map: 'highland' });
  const b = spawned(w2, 1, { team: 0 });
  const t2 = w2.objects.find(o => o.kind === 'turret' && o.team === 1);
  const back = [t2.c[0] + Math.sin(t2.yaw) * 30, t2.b[4] + 6, t2.c[2] + Math.cos(t2.yaw) * 30]; // aimDir(yaw) is (-sin, 0, -cos): this is behind
  b.pos = back; b.vel = [0, 0, 0];
  let firstShot = -1;
  for (let i = 0; i < 300 && firstShot < 0; i++) { w2.step(); b.pos = back.slice(); b.vel = [0, 0, 0]; b.hp = 70; if (w2.events.some(e => e.k === 'tfire' && e.id === t2.id)) firstShot = i; }
  assert.ok(firstShot > 60, 'turret fired after ' + firstShot + ' ticks');
});

test('new map features: water slows and floats you, shots stop at its surface, lava burns, structures block', () => {
  // water
  const w = new JF.World({ map: 'lakes' });
  const p = spawned(w, 1, { team: 0 });
  const wh = w.terrain.waterH;
  assert.ok(wh > 0, 'lakes has water');
  const lake = [JF.SIZE / 2, JF.SIZE / 2 - 330];
  assert.ok(w.terrain.height(lake[0], lake[1]) < wh - 10, 'the lake is deep');
  p.pos = [lake[0], wh - 3, lake[1]]; p.vel = [30, 0, 0];
  for (let i = 0; i < 120; i++) w.applyInput(p, idle());
  assert.ok(Math.abs(p.vel[0]) < 5, 'water slowed you: ' + p.vel[0]);
  assert.ok(p.pos[1] > wh - 2.5, 'floating near the top: ' + (p.pos[1] - wh));
  const hit = w.traceProj({ pos: [lake[0], wh + 20, lake[1]], kind: 'disc', owner: -9, age: 9 }, [lake[0], wh - 20, lake[1]], -1);
  assert.equal(hit.what, 'water');
  assert.ok(Math.abs(hit.pos[1] - wh) < 0.01);
  // lava
  const a = new JF.World({ map: 'ashfall' });
  const q = spawned(a, 1, { team: 0 });
  let low = null;
  for (let x = 400; x < 1650 && !low; x += 16) for (let z = 400; z < 1650 && !low; z += 16) if (a.terrain.height(x, z) < a.terrain.lavaH - 1 && a.terrain.normal(x, z)[1] > 0.95) low = [x, z];
  assert.ok(low, 'there is lava');
  q.pos = [low[0], a.terrain.height(low[0], low[1]), low[1]]; q.vel = [0, 0, 0]; q.spawnProt = 0;
  for (let i = 0; i < 60 && q.alive; i++) { a.step(); a.applyInput(q, idle()); }
  assert.ok(q.hp < ARMORS[q.armor].hp - 20 || !q.alive, 'burned: ' + q.hp);
  // structures: mirrored pairs, and they stop you
  for (const map of JF.MAP_KEYS) {
    const m = new JF.World({ map });
    const props = m.solids.filter(s => s.team < 0);
    assert.ok(props.length >= 6, map + ' has things in the field');
    const c = JF.SIZE / 2;
    for (const s of props) {
      const b = s.b, mb = [2 * c - b[3], b[1], 2 * c - b[5], 2 * c - b[0], b[4], 2 * c - b[2]];
      assert.ok(props.some(o => o.b.every((v, i) => Math.abs(v - mb[i]) < 1e-6)), map + ': ' + s.mat + ' has a mirror twin');
    }
    const tall = props.find(s => s.b[4] - s.b[1] > 8 && s.b[3] - s.b[0] > 2.5 && s.b[5] - s.b[2] > 2.5);
    if (!tall) continue;
    const r = spawned(m, 9, { team: 0 });
    const mid = (tall.b[2] + tall.b[5]) / 2, y = tall.b[1] + 4;
    r.pos = [tall.b[0] - 6, y, mid]; r.vel = [80, 0, 0]; r.spawnProt = 0;
    for (let i = 0; i < 20; i++) { r.vel[1] = Math.max(r.vel[1], 0); m.applyInput(r, idle({ b: B.JET })); }
    assert.ok(r.pos[0] < tall.b[0] + 0.01 || r.pos[1] > tall.b[4] - 0.1 || r.pos[2] < tall.b[2] || r.pos[2] > tall.b[5], map + ': went through a ' + tall.mat);
  }
});

test('a disc fired into the ground hurts and shoves whoever is next to it, and lets you disc-jump', () => {
  // the first version checked the blast's line of sight from the exact impact point, which sits in the ground,
  // so every ground blast was "blocked": no damage, no shove, no disc jumping
  const w = new JF.World({ map: 'dunes' });
  const a = spawned(w, 1, { team: 0 }), b = spawned(w, 2, { team: 1 });
  const o = w.bases[0].o;
  const x = o.x + 90 * o.face, z = o.z;
  b.pos = [x, w.terrain.height(x, z), z]; b.vel = [0, 0, 0]; b.spawnProt = 0;
  a.pos = [x - 40 * o.face, w.terrain.height(x - 40 * o.face, z) + 6, z]; a.vel = [0, 0, 0];
  a.wi = a.weapons.indexOf('disc'); a.fireCd = 0; a.switchT = 0;
  const tx = x - 2 * o.face, e = JF.eye(a);
  const dx = tx - e[0], dy = w.terrain.height(tx, z) - e[1], dz = z - e[2];
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  let lift = 0;
  for (let i = 0; i < 90; i++) { w.step(); w.applyInput(a, idle({ b: i === 0 ? B.FIRE : 0, yaw, pitch })); a.vel = [0, 0, 0]; lift = Math.max(lift, b.vel[1]); }
  assert.ok(b.hp < ARMORS.light.hp - 15, 'hurt: ' + b.hp);
  assert.ok(lift > 4, 'shoved up: ' + lift);
  // disc jump: fire straight down while standing
  b.pos = [x + 30 * o.face, w.terrain.height(x + 30 * o.face, z), z]; b.vel = [0, 0, 0]; b.hp = ARMORS.light.hp; b.ground = true;
  b.wi = b.weapons.indexOf('disc'); b.fireCd = 0; b.switchT = 0; b.ammo.disc = 15;
  const y0 = b.pos[1];
  let top = y0;
  for (let i = 0; i < 60; i++) { w.step(); w.applyInput(b, idle({ b: i === 0 ? B.FIRE : 0, pitch: -1.5 })); top = Math.max(top, b.pos[1]); }
  assert.ok(top > y0 + 2, 'disc jump height ' + (top - y0));
  assert.ok(b.hp < ARMORS.light.hp, 'it costs some health');
});
