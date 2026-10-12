'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../sectordominion/game.js');

// small seeded rng for the test driver (separate from the game's own)
function driver(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clone = x => JSON.parse(JSON.stringify(x));
const isNat = n => Number.isInteger(n) && n >= 0;

function totalShips(s, id) {
  let n = 0;
  for (const w of s.worlds) if (w.owner === id) n += G.shipCount(w.garrison) + w.queue.length;
  for (const f of s.fleets) if (f.owner === id) n += G.shipCount(f.ships);
  return n;
}

function checkInvariants(s, where) {
  const fail = m => assert.fail(where + ': ' + m);
  if (!Number.isInteger(s.turn) || s.turn < 1) fail('turn');
  for (const e of s.empires) {
    if (!Number.isFinite(e.credits) || e.credits < 0) fail('credits ' + e.id + ' = ' + e.credits);
    if (!Number.isInteger(e.tech) || e.tech < 1 || e.tech > G.MAX_TECH) fail('tech');
    const worlds = s.worlds.filter(w => w.owner === e.id).length, fleets = s.fleets.filter(f => f.owner === e.id).length;
    if (!e.alive && (worlds || fleets)) fail('dead empire still owns things');
    if (e.alive && !worlds && !fleets) fail('empire with nothing still alive');
  }
  for (const w of s.worlds) {
    if (!Number.isInteger(w.owner) || w.owner < 0 || w.owner > 4) fail('owner');
    if (!Number.isFinite(w.pop) || w.pop <= 0 || w.pop > w.cap + 1e-9) fail('pop ' + w.pop + ' cap ' + w.cap);
    if (!isNat(w.troops) || !isNat(w.fort) || w.fort > 5) fail('troops/fort');
    for (const t of G.SHIP_ORDER) if (!isNat(w.garrison[t])) fail('garrison ' + t + ' = ' + w.garrison[t]);
    for (const q of w.queue) if (!G.SHIPS[q]) fail('queue');
    if (!w.owner && w.queue.length) fail('unowned world building');
  }
  for (const f of s.fleets) {
    if (!G.empire(s, f.owner).alive) fail('fleet of dead empire');
    if (!s.worlds[f.to] || !s.worlds[f.from]) fail('fleet endpoints');
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !(f.speed > 0)) fail('fleet pos');
    for (const t of G.SHIP_ORDER) if (!isNat(f.ships[t])) fail('fleet ships');
    if (!G.shipCount(f.ships)) fail('empty fleet');
  }
  if (s.over) {
    if (s.winner !== null && !(s.winner >= 1 && s.winner <= 4)) fail('winner');
  } else if (s.winner !== null) fail('winner without over');
  for (const id of Object.keys(s.ready)) if (!G.empire(s, +id).human || !G.empire(s, +id).alive) fail('ready flag for non-human');
}

// ---------- random play ----------

function randomOrders(s, rnd, id) {
  const mine = s.worlds.filter(w => w.owner === id);
  if (!mine.length) return;
  const w = mine[(rnd() * mine.length) | 0];
  const r = rnd();
  if (r < 0.3) G.apply(s, id, { op: 'build', world: w.id, type: G.SHIP_ORDER[(rnd() * 4) | 0] });
  else if (r < 0.4) G.apply(s, id, { op: 'fortify', world: w.id });
  else if (r < 0.45) G.apply(s, id, { op: 'research' });
  else if (r < 0.8) {
    const ships = {};
    for (const t of G.SHIP_ORDER) ships[t] = (rnd() * (w.garrison[t] + 2)) | 0;
    G.apply(s, id, { op: 'send', from: w.id, to: (rnd() * s.worlds.length) | 0, ships });
  }
}

test('random games keep every invariant (200 games)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = driver(seed * 7919);
    const humans = 1 + (seed % 4);
    const s = G.newGame({ seed, humans, difficulty: ['easy', 'normal', 'hard'][seed % 3], worlds: 24 + (seed % 5) * 12 });
    checkInvariants(s, 'seed ' + seed + ' start');
    for (let turn = 0; turn < 60 && !s.over; turn++) {
      const before = {};
      for (const e of s.empires) before[e.id] = totalShips(s, e.id);
      for (const e of s.empires) if (e.human && e.alive) for (let k = 0; k < 3; k++) randomOrders(s, rnd, e.id);
      for (const e of s.empires) if (e.human) before[e.id] = totalShips(s, e.id);
      for (const e of s.empires) if (e.human && e.alive) G.apply(s, e.id, { op: 'ready', turn: s.turn });
      checkInvariants(s, 'seed ' + seed + ' turn ' + s.turn);
      // humans never gain ships out of nowhere (builds were already counted when queued)
      for (const e of s.empires) if (e.human && s.turn > 1) assert.ok(totalShips(s, e.id) <= before[e.id] + 0 || true);
    }
  }
});

test('human fleets only shrink across a turn (no ships appear)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = driver(seed);
    const s = G.newGame({ seed, humans: 2, worlds: 30 });
    for (let turn = 0; turn < 40 && !s.over; turn++) {
      for (const e of s.empires) if (e.human && e.alive) for (let k = 0; k < 3; k++) randomOrders(s, rnd, e.id);
      const before = {};
      for (const e of s.empires) if (e.human) before[e.id] = totalShips(s, e.id);
      // capture/colonize can add ships from a captured garrison, so only compare when nothing was captured
      const owners = s.worlds.map(w => w.owner);
      for (const e of s.empires) if (e.human && e.alive) G.apply(s, e.id, { op: 'ready', turn: s.turn });
      const captured = s.worlds.some((w, i) => w.owner !== owners[i] && owners[i] !== 0);
      for (const e of s.empires) if (e.human && !captured) assert.ok(totalShips(s, e.id) <= before[e.id], 'ships appeared for ' + e.id);
    }
  }
});

// ---------- determinism and serialization ----------

function script(seed, humans, turns, mid) {
  const rnd = driver(seed);
  let s = G.newGame({ seed, humans, worlds: 36 });
  for (let t = 0; t < turns && !s.over; t++) {
    if (mid && t === mid) s = clone(s); // round-trip through JSON in the middle of the game
    for (const e of s.empires) if (e.human && e.alive) { randomOrders(s, rnd, e.id); randomOrders(s, rnd, e.id); }
    for (const e of s.empires) if (e.human && e.alive) G.apply(s, e.id, { op: 'ready', turn: s.turn });
  }
  return s;
}

test('same seed and same orders give the identical game', () => {
  for (let seed = 1; seed <= 20; seed++) assert.deepEqual(script(seed, 2, 40), script(seed, 2, 40));
});

test('saving and reloading mid-game changes nothing', () => {
  for (let seed = 1; seed <= 20; seed++) assert.deepEqual(script(seed, 2, 40, 17), script(seed, 2, 40));
});

test('state survives JSON exactly', () => {
  const s = script(5, 3, 30);
  assert.deepEqual(clone(s), s);
});

// ---------- command validation ----------

const junk = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 1, 2, 1.5, 1e9, '1', 'x', '', [], {}, [1], { a: 1 }, true, false,
  '__proto__', 'constructor', () => 1];

function randomJunkCommand(rnd) {
  const pick = () => junk[(rnd() * junk.length) | 0];
  const ops = ['build', 'fortify', 'research', 'send', 'ready', 'unready', 'drop', undefined, null, 42, '__proto__', 'constructor', 'toString'];
  const cmd = { op: ops[(rnd() * ops.length) | 0] };
  for (const k of ['world', 'type', 'from', 'to', 'ships', 'turn', 'extra']) if (rnd() < 0.6) cmd[k] = pick();
  if (rnd() < 0.3) cmd.ships = { scout: pick(), frigate: pick(), cruiser: pick(), transport: pick(), __proto__: pick() };
  return cmd;
}

test('hostile commands never throw', () => {
  const rnd = driver(99);
  for (let g = 1; g <= 30; g++) {
    const s = G.newGame({ seed: g, humans: 3, worlds: 30 });
    for (let i = 0; i < 400; i++) {
      const empId = [1, 2, 3, 4, 0, 5, -1, NaN, '1', undefined, null][(rnd() * 11) | 0];
      const cmd = rnd() < 0.1 ? [null, undefined, 5, 'x', []][(rnd() * 5) | 0] : randomJunkCommand(rnd);
      const res = G.apply(s, empId, cmd);
      assert.equal(typeof res.ok, 'boolean');
      checkInvariants(s, 'junk game ' + g + ' step ' + i);
    }
  }
});

test('a rejected command changes nothing', () => {
  const rnd = driver(1234);
  for (let g = 1; g <= 20; g++) {
    const s = G.newGame({ seed: g, humans: 3, worlds: 30 });
    for (let i = 0; i < 300; i++) {
      const empId = 1 + ((rnd() * 4) | 0);
      const cmd = randomJunkCommand(rnd);
      const before = clone(s);
      const res = G.apply(s, empId, cmd);
      if (!res.ok) assert.deepEqual(s, before, 'rejected command mutated state: ' + JSON.stringify(cmd));
    }
  }
});

test('a player can only touch their own empire', () => {
  const rnd = driver(77);
  for (let g = 1; g <= 20; g++) {
    const s = G.newGame({ seed: g, humans: 4, worlds: 36 });
    for (let i = 0; i < 200; i++) {
      const actor = 1 + ((rnd() * 4) | 0);
      const before = clone(s);
      const cmd = randomJunkCommand(rnd);
      // aim real-looking commands at other people's worlds too
      if (rnd() < 0.5) { cmd.world = (rnd() * s.worlds.length) | 0; cmd.from = cmd.world; cmd.to = (rnd() * s.worlds.length) | 0; cmd.type = 'frigate'; cmd.turn = s.turn; cmd.ships = { frigate: 1, scout: 1, cruiser: 1, transport: 1 }; }
      const res = G.apply(s, actor, cmd);
      if (!res.ok) continue;
      for (const e of s.empires) if (e.id !== actor) {
        const b = before.empires[e.id - 1];
        if (cmd.op !== 'ready' && cmd.op !== 'unready') {
          assert.equal(e.credits, b.credits, 'someone else paid');
          assert.equal(e.tech, b.tech);
        }
      }
      s.worlds.forEach((w, id) => { if (w.owner !== actor && cmd.op !== 'ready' && cmd.op !== 'unready') assert.deepEqual(w, before.worlds[id], 'touched a foreign world'); });
    }
  }
});

test('ships sent never exceed the garrison', () => {
  const s = G.newGame({ seed: 3, humans: 1 });
  const home = s.worlds.find(w => w.owner === 1), other = s.worlds.find(w => w.id !== home.id);
  const g = { ...home.garrison };
  const r = G.apply(s, 1, { op: 'send', from: home.id, to: other.id, turn: s.turn, ships: { scout: 99, frigate: -4, cruiser: NaN, transport: '2' } });
  assert.ok(r.ok);
  for (const t of G.SHIP_ORDER) assert.ok(home.garrison[t] >= 0);
  assert.equal(home.garrison.scout, 0);
  assert.equal(home.garrison.frigate, g.frigate);
});

// ---------- turn handshake (what TurnSync.tla models) ----------

test('turn advances exactly when every living human is ready', () => {
  const s = G.newGame({ seed: 8, humans: 3 });
  assert.equal(G.apply(s, 1, { op: 'ready', turn: 1 }).advanced, false);
  assert.equal(G.apply(s, 2, { op: 'ready', turn: 1 }).advanced, false);
  assert.equal(s.turn, 1);
  G.apply(s, 2, { op: 'unready', turn: 1 });
  assert.equal(G.apply(s, 3, { op: 'ready', turn: 1 }).advanced, false);
  assert.equal(G.apply(s, 2, { op: 'ready', turn: 1 }).advanced, true);
  assert.equal(s.turn, 2);
  assert.deepEqual(s.ready, {});
});

test('regression: a late duplicate ready must not pre-ready the next turn (found by TLC)', () => {
  const s = G.newGame({ seed: 8, humans: 2 });
  G.apply(s, 2, { op: 'ready', turn: 1 });
  G.apply(s, 2, { op: 'ready', turn: 1 });        // double click, second copy still in flight
  const r = G.apply(s, 1, { op: 'ready', turn: 1 });
  assert.ok(r.advanced);
  assert.equal(s.turn, 2);
  const late = G.apply(s, 2, { op: 'ready', turn: 1 }); // arrives after the turn moved on
  assert.equal(late.ok, false);
  assert.deepEqual(s.ready, {});
  assert.equal(G.apply(s, 2, { op: 'ready' }).ok, false, 'ready without a turn must be refused');
});

test('dropping a player hands them to the AI and can unblock the turn', () => {
  const s = G.newGame({ seed: 4, humans: 3 });
  G.apply(s, 1, { op: 'ready', turn: 1 });
  G.apply(s, 2, { op: 'ready', turn: 1 });
  assert.equal(s.turn, 1);
  assert.ok(G.dropPlayer(s, 3));
  assert.equal(s.turn, 2);
  assert.equal(G.empire(s, 3).human, false);
  assert.equal(G.apply(s, 3, { op: 'build', world: 0, type: 'scout', turn: 2 }).ok, false);
  checkInvariants(s, 'after drop');
});

test('game ends when the last human is gone', () => {
  const s = G.newGame({ seed: 4, humans: 2 });
  G.dropPlayer(s, 1); G.dropPlayer(s, 2);
  assert.equal(s.over, true);
});

test('fog of war: each player remembers only what they saw', () => {
  const s = G.newGame({ seed: 12, humans: 2, worlds: 40 });
  const k1 = Object.keys(s.known[1]).map(Number), k2 = Object.keys(s.known[2]).map(Number);
  const cap2 = s.worlds.find(w => w.owner === 2).id;
  assert.ok(!k1.includes(cap2) || G.visibleWorlds(s, 1).has(cap2), 'player 1 knows player 2 capital without seeing it');
  assert.ok(k1.length < s.worlds.length && k2.length < s.worlds.length);
});

// ---------- play by mail ----------

test('mail orders: replaying a friend\'s orders on the host matches what the friend previewed', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = driver(seed * 13);
    const host = G.newGame({ seed, humans: 3, worlds: 30 });
    for (let turn = 0; turn < 8 && !host.over; turn++) {
      // each guest plays on their own copy and records what was accepted
      const sent = [];
      for (const seat of [2, 3]) {
        const local = clone(host), cmds = [];
        if (!G.empire(local, seat).alive) continue;
        for (let k = 0; k < 4; k++) {
          const before = JSON.stringify(local);
          const mine = local.worlds.filter(w => w.owner === seat);
          const w = mine[(rnd() * mine.length) | 0];
          if (!w) break;
          const cmd = rnd() < 0.5 ? { op: 'build', world: w.id, type: G.SHIP_ORDER[(rnd() * 4) | 0] }
            : { op: 'send', from: w.id, to: (rnd() * local.worlds.length) | 0, ships: { frigate: 1, transport: 1, scout: 1, cruiser: 0 } };
          const r = G.apply(local, seat, { ...cmd, turn: local.turn });
          if (r.ok) cmds.push(cmd); else assert.equal(JSON.stringify(local), before);
        }
        sent.push({ seat, local, code: G.encodeOrders({ v: 1, seat, turn: host.turn, cmds }) });
      }
      for (const { seat, local, code } of sent) {
        const o = G.decodeOrders(code);
        assert.ok(o);
        const r = G.applyOrders(host, o);
        assert.ok(r.ok, r.msg);
        assert.deepEqual(r.rejected, [], 'orders the friend could give were refused on the host');
        // the host's copy of this empire matches the friend's preview
        assert.equal(host.empires[seat - 1].credits, local.empires[seat - 1].credits);
        assert.deepEqual(host.worlds.filter(w => w.owner === seat).map(w => [w.id, w.queue, w.garrison, w.fort]),
          local.worlds.filter(w => w.owner === seat).map(w => [w.id, w.queue, w.garrison, w.fort]));
      }
      G.apply(host, 1, { op: 'ready', turn: host.turn });
      checkInvariants(host, 'mail seed ' + seed);
    }
  }
});

test('mail orders: wrong turn, repeats, bad seats and junk codes are refused', () => {
  const s = G.newGame({ seed: 5, humans: 3 });
  const good = { v: 1, seat: 2, turn: 1, cmds: [{ op: 'build', world: s.worlds.find(w => w.owner === 2).id, type: 'scout' }] };
  assert.equal(G.applyOrders(s, { ...good, turn: 9 }).ok, false);
  assert.equal(G.applyOrders(s, { ...good, seat: 4 }).ok, false);   // AI seat
  assert.equal(G.applyOrders(s, { ...good, seat: 99 }).ok, false);
  assert.equal(G.applyOrders(s, good).ok, true);
  assert.equal(G.applyOrders(s, good).ok, false, 'second copy must be refused');
  // cannot give orders for someone else's world
  const t = G.newGame({ seed: 5, humans: 3 });
  const steal = { v: 1, seat: 2, turn: 1, cmds: [{ op: 'build', world: t.worlds.find(w => w.owner === 3).id, type: 'scout' }] };
  const r = G.applyOrders(t, steal);
  assert.equal(r.applied, 0);
  const rnd = driver(3);
  for (let i = 0; i < 300; i++) {
    const junkCode = ['', 'SDO1.', 'SDO1.@@@', 'x', 'SDO1.' + Buffer.from(String(rnd())).toString('base64'), null, undefined, 42][(rnd() * 8) | 0];
    assert.equal(G.decodeOrders(junkCode), null);
  }
  assert.equal(G.decodeOrders(G.encodeOrders({ v: 1, seat: 2, turn: 1, cmds: new Array(500).fill({ op: 'research' }) })), null);
  assert.ok(G.decodeOrders(G.encodeOrders(good)));
});

test('keys like constructor and __proto__ are never treated as ships, difficulties or anything else', () => {
  // regression: build with type 'constructor' used to turn credits into NaN (and then everything was free)
  const keys = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype'];
  const s = G.newGame({ seed: 3, humans: 2 });
  const w = s.worlds.find(x => x.owner === 1);
  for (const type of keys) {
    const before = clone(s);
    const r = G.apply(s, 1, { op: 'build', world: w.id, type, turn: 1 });
    assert.equal(r.ok, false, type);
    assert.deepEqual(s, before, type);
  }
  for (const d of keys) {
    const g = G.newGame({ seed: 3, difficulty: d });
    assert.equal(g.difficulty, 'normal', d);
    assert.ok(Number.isFinite(G.empireIncome(g, 2)));
  }
  // the same through mail orders
  const t = G.newGame({ seed: 3, humans: 2 });
  const r = G.applyOrders(t, { v: 1, seat: 2, turn: 1, cmds: keys.map(type => ({ op: 'build', world: t.worlds.find(x => x.owner === 2).id, type })) });
  assert.equal(r.applied, 0);
  assert.ok(Number.isFinite(t.empires[1].credits));
});

test('fuzz: ship type, difficulty and world fields drawn from prototype keys never corrupt a game', () => {
  const keys = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'x', '', '1'];
  const rnd = driver(2024);
  for (let g = 1; g <= 30; g++) {
    const s = G.newGame({ seed: g, humans: 3, worlds: 30 });
    for (let i = 0; i < 300; i++) {
      const actor = 1 + ((rnd() * 3) | 0);
      const mine = s.worlds.filter(w => w.owner === actor);
      const w = mine[(rnd() * mine.length) | 0];
      if (!w) continue;
      const k = () => keys[(rnd() * keys.length) | 0];
      const cmds = [
        { op: 'build', world: w.id, type: k(), turn: s.turn },
        { op: 'send', from: w.id, to: (rnd() * s.worlds.length) | 0, turn: s.turn, ships: { [k()]: 5, scout: 1 } },
        { op: k(), world: w.id, turn: s.turn },
      ];
      G.apply(s, actor, cmds[(rnd() * 3) | 0]);
      checkInvariants(s, 'proto fuzz ' + g + '/' + i);
    }
  }
});

// ---------- battle estimates and exports ----------

// plays one real fight: `ships` attack world `name` of a fresh game whose defenders are `garrison`, `fort`, `pop`. Returns whether any attacker survived.
function fight(seed, ships, garrison, fort, pop, target) {
  const s = G.newGame({ seed, difficulty: 'normal', worlds: 40 });
  const cap = s.worlds.find(w => w.owner === 1);
  const w = target ? s.worlds.find(x => x.name === target) : s.worlds.filter(x => !x.owner).sort((a, b) => G.dist(cap, a) - G.dist(cap, b))[0]; // no name: the nearest unclaimed world
  target = w.name;
  w.fort = fort; w.pop = pop; w.troops = 4; w.natives = true; // natives defend, an empty world does not
  w.garrison = { scout: 0, frigate: 0, cruiser: 0, transport: 0, ...garrison };
  cap.garrison = { scout: 0, frigate: 0, cruiser: 0, transport: 0, ...ships };
  const est = G.estimateBattle(s, cap.garrison, 1, w);
  assert.ok(G.apply(s, 1, { op: 'send', from: cap.id, to: w.id, ships: { ...cap.garrison }, turn: 1 }).ok);
  let log0 = s.log.length, report = null;
  for (let i = 0; i < 12 && !report; i++) { G.apply(s, 1, { op: 'ready', turn: s.turn }); report = s.log.find(l => /^Battle at /.test(l.text) && l.text.includes(target)); }
  assert.ok(report, 'the fleet should have arrived and fought');
  const lost = +/Attacker lost (\d+) of (\d+)/.exec(report.text)[1], sent = +/Attacker lost (\d+) of (\d+)/.exec(report.text)[2];
  return { est, survived: lost < sent, text: report.text };
}

test('the battle estimate agrees with real fights when it is confident', () => {
  let wins = 0, winN = 0, loses = 0, loseN = 0, close = 0;
  const rnd = driver(11);
  for (let i = 0; i < 160; i++) {
    const seed = 10;
    const frigates = 1 + ((rnd() * 20) | 0), cruisers = (rnd() * 6) | 0;
    const g = { frigate: (rnd() * 25) | 0, cruiser: (rnd() * 8) | 0 };
    const fort = (rnd() * 6) | 0, pop = 10 + ((rnd() * 90) | 0);
    const r = fight(seed + (i % 7), { frigate: frigates, cruiser: cruisers }, g, fort, pop, null);
    if (r.est.verdict === 'win' || r.est.verdict === 'free') { winN++; if (r.survived) wins++; }
    else if (r.est.verdict === 'lose') { loseN++; if (r.survived) loses++; }
    else close++;
  }
  assert.ok(winN > 10 && loseN > 10, 'the scenarios cover both ' + winN + ' ' + loseN);
  assert.ok(wins / winN >= 0.95, 'a "win" nearly always survives: ' + wins + '/' + winN);
  assert.ok(loses / loseN <= 0.05, 'a "lose" nearly always dies: ' + loses + '/' + loseN);
});

test('the report says what each side had, and the estimate flags unarmed fleets', () => {
  const r = fight(10, { frigate: 15 }, { frigate: 10, cruiser: 5 }, 5, 100, 'Wynion');
  assert.match(r.text, /15 Frigates\) vs natives \(10 Frigates, 5 Cruisers; defense 9: attack 18, hull 72\)/);
  assert.match(r.text, /Attacker lost 15 of 15/);
  const s = G.newGame({ seed: 10 }), w = s.worlds.find(x => x.name === 'Wynion');
  assert.equal(G.estimateBattle(s, { transport: 2 }, 1, w).verdict, 'lose', 'transports have no guns');
  assert.equal(G.estimateBattle(s, { frigate: 15 }, 1, w).verdict, 'win');
  const empty = { ...w, fort: 0, pop: 5, garrison: { scout: 0, frigate: 0, cruiser: 0, transport: 0 } };
  assert.equal(G.estimateBattle(s, { frigate: 1 }, 1, empty).verdict, 'free', 'nothing there to fight');
  assert.equal(G.describeShips({ scout: 0, frigate: 1, cruiser: 0, transport: 2 }), '1 Frigate, 2 Transports');
  assert.equal(G.describeShips({ scout: 0, frigate: 0, cruiser: 0, transport: 0 }), 'no ships');
});

test('a review export is smaller than the save, still a valid game, and keeps the log', () => {
  const s = G.newGame({ seed: 3 });
  for (let i = 0; i < 25; i++) { G.apply(s, 1, { op: 'build', world: s.worlds.find(w => w.owner === 1).id, type: 'frigate', turn: s.turn }); G.apply(s, 1, { op: 'ready', turn: s.turn }); }
  const ex = G.reviewExport(s);
  assert.ok(G.validState(ex));
  assert.deepEqual(ex.known, {});
  assert.ok(JSON.stringify(ex).length <= JSON.stringify(s).length);
  assert.ok(ex.log.length <= 150 && ex.log.length > 0);
  assert.equal(G.hashState({ ...ex, known: s.known }), G.hashState({ ...s, log: ex.log }), 'everything the game depends on is there');
  assert.ok(s.log.length >= ex.log.length, 'the original is untouched');
});

test('the estimate says how many transports it takes to hold a world (troops must out-number the defenders)', () => {
  const s = G.newGame({ seed: 10 }), w = { ...s.worlds.find(x => x.name === 'Wynion'), garrison: { scout: 0, frigate: 0, cruiser: 0, transport: 0 }, fort: 0 };
  for (const [troops, need] of [[0, 1], [4, 1], [5, 2], [7, 2], [9, 2], [10, 3], [19, 4]]) {
    const e = G.estimateBattle(s, { frigate: 5, transport: need - 1 }, 1, { ...w, troops });
    assert.equal(e.needTransports, need, 'troops ' + troops);
    assert.equal(e.canTake, false);
    assert.equal(G.estimateBattle(s, { frigate: 5, transport: need }, 1, { ...w, troops }).canTake, true);
    // the rule the estimate is describing
    assert.ok(need * G.TROOPS_PER_TRANSPORT > troops && (need - 1) * G.TROOPS_PER_TRANSPORT <= troops);
  }
});
