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
  const at = [JF.SIZE / 2, 0, JF.SIZE / 2]; at[1] = w.terrain.height(at[0], at[2]);
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
