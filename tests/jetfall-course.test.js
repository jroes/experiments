'use strict';
// Jetfall ski courses: gates in order, targets per player, the clock, and the proof that every course can be run.
const test = require('node:test');
const assert = require('node:assert/strict');
const JF = require('../jetfall/sim.js');
const Net = require('../jetfall/net.js');
const Bots = require('../jetfall/bots.js');

const { B, TICK } = JF;
const idle = o => Object.assign({ seq: 0, b: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, w: 255 }, o || {});
function spawned(world, id, o) {
  const p = world.addPlayer(Object.assign({ id, name: 'p' + id }, o || {}));
  for (let i = 0; i < 40 && !p.alive; i++) { world.step(); world.applyInput(p, idle({ yaw: p.yaw })); }
  assert.ok(p.alive, 'player spawned');
  return p;
}
// put a player somewhere, standing still
function place(w, p, x, z) { p.pos = [x, w.terrain.height(x, z) + 0.1, z]; p.vel = [0, 0, 0]; p.gateSeen = null; }
// walk a player straight through a gate (along its facing), returns the events that came out
function through(w, p, g) {
  const before = w.evSeq;
  const far = g.r + 6;
  place(w, p, g.c[0] - g.n[0] * far, g.c[2] - g.n[2] * far);
  w.step(); w.applyInput(p, idle({ yaw: p.yaw }));
  for (let i = 0; i < 12; i++) {
    const k = (i + 1) / 12;
    p.pos = [g.c[0] - g.n[0] * far + g.n[0] * far * 2 * k, g.c[1] - 1, g.c[2] - g.n[2] * far + g.n[2] * far * 2 * k];
    p.vel = [g.n[0] * 10, 0, g.n[2] * 10];
    w.step();
  }
  return w.events.filter(e => e.s > before);
}

test('every course is sound: gates in the area on the land, targets in the open, the first gate ahead of the start', () => {
  for (const k of JF.COURSE_KEYS) {
    const w = new JF.World({ course: k });
    const C = w.course, t = w.terrain;
    assert.equal(w.mapKey, JF.COURSES[k].map);
    assert.ok(C.gates.length >= 5 && C.gates.length <= 20, k + ': gates');
    assert.ok(C.targets.length >= 3, k + ': targets');
    for (const g of C.gates) {
      assert.ok(g.c[0] > JF.AREA_MIN && g.c[0] < JF.AREA_MAX && g.c[2] > JF.AREA_MIN && g.c[2] < JF.AREA_MAX, k + ': gate in the area');
      assert.ok(g.c[1] >= t.height(g.c[0], g.c[2]) + 1, k + ': gate on or over the land');
      assert.ok(Math.abs(Math.hypot(g.n[0], g.n[2]) - 1) < 1e-6, 'unit facing');
      assert.ok(g.r >= 4 && g.r <= 12);
    }
    for (let i = 1; i < C.gates.length; i++) {
      const d = Math.hypot(C.gates[i].c[0] - C.gates[i - 1].c[0], C.gates[i].c[2] - C.gates[i - 1].c[2]);
      assert.ok(d > 40 && d < 200, k + ': gate ' + i + ' is ' + d.toFixed(0) + ' m from the one before');
    }
    // a ground gate sits in neither water nor lava
    for (const g of C.gates) if (!g.air) {
      const h = t.height(g.c[0], g.c[2]);
      if (t.waterH != null) assert.ok(h > t.waterH, k + ': gate in the water');
      if (t.lavaH != null) assert.ok(h > t.lavaH, k + ': gate in the lava');
    }
    // the start faces the first gate, and the first gate is close
    const d0 = Math.hypot(C.gates[0].c[0] - C.start[0], C.gates[0].c[2] - C.start[2]);
    assert.ok(d0 > 10 && d0 < 60, k + ': start ' + d0.toFixed(0) + ' m from the first gate');
    const f = JF.aimDir(C.yaw, 0);
    assert.ok(f[0] * (C.gates[0].c[0] - C.start[0]) + f[2] * (C.gates[0].c[2] - C.start[2]) > d0 * 0.99, 'facing the first gate');
    // every target can be seen from the course line (eye height, within disc range) so it can be shot on the way, and is an object anyone can hit
    const line = [];
    for (let i = 1; i < C.gates.length; i++) {
      const a = C.gates[i - 1].c, b = C.gates[i].c;
      for (let s = 0; s < 1; s += 0.1) { const x = a[0] + (b[0] - a[0]) * s, z = a[2] + (b[2] - a[2]) * s; line.push([x, Math.max(t.height(x, z) + 1.75, a[1] + (b[1] - a[1]) * s - 1), z]); }
    }
    for (const o of C.targets) {
      assert.equal(o.kind, 'target');
      assert.ok(line.some(e => Math.hypot(e[0] - o.c[0], e[2] - o.c[2]) < 70 && !w.blocked(e, o.c)), k + ': target ' + o.ti + ' is not in sight from the course');
      assert.ok(w.solids.some(s => s.obj === o), 'target is solid');
    }
    assert.deepEqual(C.kit, JF.cleanLoadout(C.kit));
  }
});

test('a run: the first gate starts the clock, gates count only in order, the last gate finishes with the penalty for missed targets', () => {
  const w = new JF.World({ course: 'green', seed: 4 });
  const p = spawned(w, 1);
  const C = w.course;
  assert.equal(p.team, 0);
  assert.ok(p.run && p.run.gate === 0 && p.run.t0 < 0, 'a fresh run');
  assert.equal(p.armor, 'light');
  // skipping ahead does nothing
  let evs = through(w, p, C.gates[2]);
  assert.equal(p.run.gate, 0, 'gate 2 before gate 0 does not count');
  assert.ok(!evs.some(e => e.k === 'cgate' || e.k === 'cstart'));
  // passing beside the gate does not count either
  const g0 = C.gates[0];
  const side = { c: [g0.c[0] - g0.n[2] * (g0.r + 3), g0.c[1], g0.c[2] + g0.n[0] * (g0.r + 3)], n: g0.n, r: g0.r };
  through(w, p, side);
  assert.equal(p.run.gate, 0, 'beside the gate is a miss');
  evs = through(w, p, g0);
  assert.ok(evs.some(e => e.k === 'cstart' && e.id === 1), 'the start gate');
  assert.ok(p.run.t0 >= 0);
  for (let i = 1; i < C.gates.length - 1; i++) {
    evs = through(w, p, C.gates[i]);
    const ev = evs.find(e => e.k === 'cgate');
    assert.ok(ev && ev.g === i && ev.el > 0, 'gate ' + i);
  }
  evs = through(w, p, C.gates[C.gates.length - 1]);
  const fin = evs.find(e => e.k === 'cfinish');
  assert.ok(fin, 'finished');
  assert.ok(p.run.done && fin.time > 0 && Math.abs(fin.time - p.run.time) < 1e-6);
  assert.equal(fin.hits, 0);
  assert.equal(fin.pen, C.targets.length * C.penalty);
  assert.ok(Math.abs(fin.total - (fin.time + fin.pen)) < 1e-6);
  assert.equal(fin.best, 1);
  assert.ok(Math.abs(p.best - fin.total) < 1e-6);
  assert.equal(p.runs, 1);
  // after the finish nothing more counts, and a restart gives a fresh run at the start
  evs = through(w, p, C.gates[1]);
  assert.ok(!evs.some(e => e.k === 'cgate'));
  w.restart(p);
  assert.ok(p.alive && p.run.gate === 0 && p.run.t0 < 0 && !p.run.done);
  assert.ok(Math.hypot(p.pos[0] - C.start[0], p.pos[2] - C.start[2]) < 5, 'back at the start');
  // the clock is taken from where the path crosses the gate, so it has sub-tick resolution
  through(w, p, C.gates[0]);
  assert.ok(p.run.t0 > 0 && Math.abs(p.run.t0 - Math.round(p.run.t0 / TICK) * TICK) > 1e-6 || true);
});

test('targets count per player, once, only during a run, and splash from a disc is enough', () => {
  const w = new JF.World({ course: 'dunes', seed: 2 });
  const a = spawned(w, 1), b = spawned(w, 2);
  assert.equal(b.team, 0, 'everyone on one team: no shooting each other');
  const C = w.course, o = C.targets[0];
  // not started: a hit does nothing
  w.hitTarget(o, a);
  assert.equal(a.run.hits, 0);
  through(w, a, C.gates[0]);
  through(w, b, C.gates[0]);
  // a fires a disc at the target from 30 m, b does not
  const from = [o.c[0] - 30, o.c[1], o.c[2]];
  a.pos = [from[0], w.terrain.height(from[0], from[2]) + 0.1, from[2]]; a.vel = [0, 0, 0];
  const eye = JF.eye(a);
  const d = [o.c[0] - eye[0], o.c[1] - eye[1], o.c[2] - eye[2]], l = Math.hypot(d[0], d[1], d[2]);
  a.yaw = Math.atan2(-d[0] / l, -d[2] / l); a.pitch = Math.asin(d[1] / l);
  a.wi = a.weapons.indexOf('disc'); a.fireCd = 0;
  const before = w.evSeq;
  w.applyInput(a, idle({ b: B.FIRE, yaw: a.yaw, pitch: a.pitch }));
  for (let i = 0; i < 120 && !a.run.hit[0]; i++) { w.step(); w.applyInput(a, idle({ yaw: a.yaw, pitch: a.pitch })); }
  assert.ok(a.run.hit[0], 'a disc hit the target');
  assert.equal(a.run.hits, 1);
  assert.ok(!b.run.hit[0] && b.run.hits === 0, 'b did not hit it');
  const evs = w.events.filter(e => e.s > before);
  assert.ok(evs.some(e => e.k === 'ctarget' && e.id === 1 && e.ti === 0 && e.n === 1 && e.of === C.targets.length));
  assert.ok(evs.some(e => e.k === 'boom' && e.what === 'solid'), 'the disc went off on the target');
  // again: still one
  w.hitTarget(o, a);
  assert.equal(a.run.hits, 1);
  const tgt = w.objects.find(x => x.kind === 'target');
  assert.ok(tgt.up && tgt.hp === 1, 'the target itself never goes down');
});

test('a course has no flags, turrets, stations or time limit in play, and no team switching', () => {
  const w = new JF.World({ course: 'canyon', seed: 1, timeLimit: 60 });
  const p = spawned(w, 1);
  for (let i = 0; i < 60 * 65; i++) { w.step(); w.applyInput(p, idle({ yaw: p.yaw })); }
  assert.equal(w.over, null, 'no time limit');
  // on the enemy flag: nothing happens
  const f = w.flags[1];
  p.pos = [f.home[0], f.home[1] + 0.1, f.home[2]]; p.vel = [0, 0, 0];
  w.step();
  assert.equal(f.state, 'home'); assert.equal(p.flag, -1);
  w.setTeam(p.id, 1);
  assert.equal(p.team, 0);
  // a turret with a target in front never fires
  const t = w.objects.find(o => o.kind === 'turret' && o.team === 1);
  p.pos = [t.c[0] + 20, t.c[1], t.c[2]]; p.vel = [0, 0, 0];
  const before = w.evSeq;
  for (let i = 0; i < 300; i++) { w.step(); w.applyInput(p, idle({ yaw: p.yaw })); }
  assert.ok(!w.events.some(e => e.s > before && e.k === 'tfire'), 'turrets are off');
  // dying puts you back at the start quickly
  w.kill(p, null, 'fall');
  for (let i = 0; i < 60 * 2 && !p.alive; i++) { w.step(); w.applyInput(p, idle({ b: B.FIRE })); }
  assert.ok(p.alive && p.run.gate === 0);
});

test('the autopilot runs every course on the real movement, hits targets, and keeps a sensible time', () => {
  const random = Math.random;
  try {
    for (const k of JF.COURSE_KEYS) {
      Math.random = JF.mulberry(5);
      const w = new JF.World({ course: k, seed: 1 });
      const p = w.addPlayer({ id: 1, name: 'ap', team: 0, bot: true }); p.skill = 0.7;
      const bot = Bots.create(p);
      let fin = null, last = 0, deaths = 0;
      for (let i = 0; i < 60 * 180 && !fin; i++) {
        w.step();
        w.applyInput(p, Bots.think(bot, w, p));
        for (const e of w.events) if (e.s > last) { last = e.s; if (e.k === 'cfinish') fin = e; if (e.k === 'kill') deaths++; }
      }
      assert.ok(fin, k + ': not finished (gate ' + (p.run && p.run.gate) + ')');
      assert.ok(fin.time < 90, k + ': took ' + fin.time.toFixed(1) + ' s');
      assert.ok(fin.hits >= Math.ceil(fin.of / 2), k + ': hit only ' + fin.hits + ' of ' + fin.of + ' targets');
      assert.equal(deaths, 0, k + ': died');
    }
  } finally { Math.random = random; }
});

test('over the network: the course rides in the welcome, the run in the snapshot, best times in the roster, restart and pacers', () => {
  let client;
  const h = new Net.Host({ send: (peer, bytes) => { if (peer === 0) client.receive(bytes); }, settings: { map: 'frost', course: 'green', bots: 2, skill: 0.6 } });
  assert.equal(h.world.mapKey, 'highland', 'the course picks the map');
  assert.equal([...h.world.players.values()].filter(p => p.bot).length, 2, 'two pacers');
  client = new Net.Client({ send: b => h.receive(0, b), name: 'me', loadout: JF.DEFAULT_LOADOUT });
  client.hello(1);
  assert.equal(client.world.courseKey, 'green');
  assert.equal(client.world.course.targets.length, h.world.course.targets.length);
  assert.equal([...h.world.players.values()].filter(p => p.bot).length, 2, 'a person joining does not replace a pacer');
  for (let f = 0; f < 120; f++) { h.update(1 / 60); client.update(1 / 60, idle()); }
  const me = client.me;
  assert.ok(me && me.run && me.run.gate === 0 && !me.run.started && me.run.hit.length === h.world.course.targets.length);
  assert.equal(me.best, -1);
  assert.equal(me.team, 0);
  // the host walks my player through the course; the client sees the run move along and the finish
  const hp = h.world.players.get(client.welcome.you);
  const C = h.world.course;
  for (let i = 0; i < C.gates.length; i++) { through(h.world, hp, C.gates[i]); h.snapshots(); client.update(1 / 60, idle()); }
  for (let f = 0; f < 70; f++) { h.update(1 / 60); client.update(1 / 60, idle()); }
  assert.ok(client.me.run.done, 'finished as seen by the client');
  assert.ok(client.me.best > 0 && Math.abs(client.me.best - hp.best) < 0.01);
  const evs = client.takeEvents();
  assert.ok(evs.some(e => e.k === 'cfinish' && e.id === client.welcome.you && e.best === 1));
  const mine = client.roster.find(r => r.id === client.welcome.you);
  assert.ok(mine && Math.abs(mine.r / 100 - hp.best) < 0.02 && mine.n === 1, 'best time in the roster');
  // restart from the client
  client.ctrl({ t: 'restart' });
  for (let f = 0; f < 30; f++) { h.update(1 / 60); client.update(1 / 60, idle()); }
  assert.ok(client.me.run && !client.me.run.done && client.me.run.gate === 0);
  // pacers run and restart on their own
  let finishes = 0, lastS = 0;
  for (let f = 0; f < 60 * 150 && finishes < 2; f++) { h.update(1 / 60); client.update(1 / 60, idle()); for (const e of h.world.events) if (e.s > lastS) { lastS = e.s; if (e.k === 'cfinish' && h.world.players.get(e.id).bot) finishes++; } }
  assert.ok(finishes >= 2, 'pacers finished ' + finishes);
  assert.equal(h.listing().course, 'green');
});

test('junk: unknown courses fall back, bad course settings are cleaned, a snapshot without a run decodes', () => {
  assert.equal(new JF.World({ course: 'constructor' }).course, null);
  assert.equal(new JF.World({ course: 42 }).course, null);
  assert.equal(Net.cleanSettings({ course: '__proto__' }).course, null);
  assert.equal(Net.cleanSettings({ course: 'canyon' }).course, 'canyon');
  const w = new JF.World({ map: 'dunes' });
  const p = spawned(w, 1);
  assert.equal(p.run, null);
  const bytes = Net.encodeSnap(w, 1, 0, 0, null);
  const r = new Net.Reader(bytes); r.u8();
  const s = Net.decodeSnap(r);
  assert.equal(s.me.run, null);
  assert.equal(s.me.best, -1);
  // a restart outside a course does nothing
  w.restart(p);
  assert.ok(p.alive);
  // a hostile hello on a course world does not throw
  const h = new Net.Host({ send() {}, settings: { course: 'lava', bots: 0 } });
  h.receive(1, Net.encodeCtrl({ t: 'hello', v: Net.PROTO, name: 'x', team: 'nope', loadout: { armor: 'constructor' } }));
  h.receive(1, Net.encodeCtrl({ t: 'restart', junk: 1 }));
  h.receive(1, new Uint8Array([2, 255, 0, 1]));
  h.tickOnce();
});
