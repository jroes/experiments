import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { installFakeKv } = require('./fake-kv.js');
const G = require('../sectordominion/game.js');
globalThis.GameStore = require('../shared/store.js');
const Online = require('../sectordominion/online.js');
const S = globalThis.GameStore;

// Set KV_URL=http://localhost:8123 to run the same tests against the real elf-punch binary instead of the fake.
const REAL = process.env.KV_URL || '';
const SERVER = REAL || 'https://kv.test';
let net = null;
function install(opts) { net = REAL ? { calls: [], spaces: new Map(), set() {} } : installFakeKv(opts); return net; }

function driver(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOrders(session, rnd) {
  const mine = session.working.worlds.filter(w => w.owner === session.seat);
  for (let k = 0; k < 3 && mine.length; k++) {
    const w = mine[(rnd() * mine.length) | 0], r = rnd();
    if (r < 0.4) session.act({ op: 'build', world: w.id, type: G.SHIP_ORDER[(rnd() * 4) | 0] });
    else if (r < 0.5) session.act({ op: 'fortify', world: w.id });
    else if (r < 0.55) session.act({ op: 'research' });
    else session.act({ op: 'send', from: w.id, to: (rnd() * session.working.worlds.length) | 0, ships: { frigate: 1, transport: 1, scout: 1, cruiser: 0 } });
  }
}

async function setup(humans) {
  const host = await Online.Session.create({ server: SERVER, humans, difficulty: 'normal', worlds: 30 });
  const sessions = [host];
  for (let seat = 2; seat <= humans; seat++) sessions.push(await Online.Session.join(Online.inviteCode(host.game.room, seat), SERVER));
  return sessions;
}

const hashes = players => players.map(p => G.hashState(p.base));

test('invite codes are short, round trip, and junk is refused', async () => {
  install();
  const [host, a, b] = await setup(3);
  assert.match(host.game.room, /^[a-z0-9]{16}$/);
  assert.deepEqual([a.seat, b.seat], [2, 3]);
  for (const s of [a, b]) {
    assert.equal(s.game.room, host.game.room);
    assert.equal(s.game.seed, host.game.seed, 'settings come from the game, not the invite');
    assert.equal(s.game.worlds, 30);
  }
  const code = Online.inviteCode(host.game.room, 2);
  assert.equal(code.length, 17);
  assert.deepEqual(Online.parseInvite(code), { room: host.game.room, seat: 2 });
  assert.deepEqual(Online.parseInvite('https://jroes.github.io/experiments/j/#' + code.toUpperCase()), { room: host.game.room, seat: 2 });
  assert.deepEqual(Online.parseInvite('#join=' + code), { room: host.game.room, seat: 2 });
  const rnd = driver(5);
  for (let i = 0; i < 200; i++) {
    const junk = ['', 'x', null, undefined, 7, 'a'.repeat(16), 'a'.repeat(15) + '9', 'a'.repeat(40) + '1', 'SDO-abc', String(rnd())][i % 10];
    assert.equal(Online.parseInvite(junk), null, String(junk));
  }
  // what is in the store decides the game, and it is checked like any other input
  const good = { server: SERVER, room: host.game.room, seat: 1, humans: 2, difficulty: 'normal', worlds: 30, seed: 5, rules: G.RULES };
  assert.ok(Online.cleanGame(good));
  for (const bad of [{ server: 'http://evil.example' }, { server: 'javascript:alert(1)' }, { room: 'X' }, { room: 'a'.repeat(12) }, { seat: 9 }, { humans: 7 }, { worlds: 5000 }, { difficulty: '__proto__' }, { difficulty: 'constructor' }, { seed: 1e12 }]) {
    assert.equal(Online.cleanGame({ ...good, ...bad }), null, JSON.stringify(bad));
  }
  assert.ok(Online.cleanGame({ ...good, server: 'http://localhost:8123' }), 'a server on this machine is allowed');
  await assert.rejects(() => Online.Session.join('zzzzzzzzzzzzzzzz1', SERVER), /does not know this game/);
  await assert.rejects(() => Online.Session.join('nonsense', SERVER), /does not look like an invite/);
  // a seat the game does not have
  await assert.rejects(() => Online.Session.join(Online.inviteCode(host.game.room, 4), SERVER), /does not match/);
  // hostile meta dropped into a made-up room
  await S.createGame(SERVER, 'b'.repeat(16), { v: 2, humans: 2, rules: G.RULES, difficulty: '__proto__', worlds: 30, seed: 1 });
  await assert.rejects(() => Online.Session.join('b'.repeat(16) + '2', SERVER), /does not match/);
});

test('three browsers stay identical over 30 turns with shuffled arrival and random sync timing', async () => {
  for (let seed = 1; seed <= 5; seed++) {
    install();
    const rnd = driver(seed * 99);
    const players = await setup(3);
    for (let turn = 1; turn <= 30; turn++) {
      if (players[0].base.over) break;
      for (const p of players) randomOrders(p, rnd);
      // the order people send in must not matter (Fisher-Yates, so the test does not depend on a sort algorithm)
      const order = [0, 1, 2];
      for (let i = 2; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
      for (const i of order) {
        const r = await players[i].submit();
        assert.ok(r.ok, r.msg);
        if (rnd() < 0.5) await players[(rnd() * 3) | 0].sync();
      }
      for (const p of players) await p.sync();
      assert.equal(new Set(hashes(players)).size, 1, 'seed ' + seed + ' turn ' + turn + ' diverged: ' + hashes(players).join(' '));
      assert.equal(new Set(players.map(p => p.base.turn)).size, 1);
      for (const p of players) assert.equal(p.desync, false);
    }
    assert.ok(players[0].base.turn > 5);
  }
});

test('a late joiner rebuilds the exact game by replaying the log', async () => {
  install();
  const rnd = driver(77);
  const players = await setup(3);
  for (let turn = 1; turn <= 12; turn++) {
    for (const p of players) { randomOrders(p, rnd); await p.submit(); }
    for (const p of players) await p.sync();
  }
  const fresh = await Online.Session.join(Online.inviteCode(players[0].game.room, 2), SERVER);
  assert.equal(G.hashState(fresh.base), G.hashState(players[1].base));
  assert.equal(fresh.base.turn, 13);
  assert.equal(fresh.desync, false);
  assert.equal(fresh.seat, players[1].seat);
});

test('replaying a long game takes few requests, because keys are read in batches', { skip: !!REAL }, async () => {
  const n = install();
  const rnd = driver(8);
  const players = await setup(4);
  for (let turn = 1; turn <= 40; turn++) {
    for (const p of players) { randomOrders(p, rnd); await p.submit(); }
    for (const p of players) await p.sync();
  }
  n.calls.length = 0;
  const fresh = await Online.Session.join(Online.inviteCode(players[0].game.room, 2), SERVER);
  assert.equal(G.hashState(fresh.base), G.hashState(players[1].base));
  const reads = n.calls.filter(c => c.method === 'GET').length;
  assert.ok(reads <= 8, '41 turns of 4 players took ' + reads + ' reads');
});

test('rejoining mid-turn restores my submitted orders', async () => {
  install();
  const rnd = driver(3);
  const [host, a, b] = await setup(3);
  randomOrders(a, rnd);
  await a.submit();
  const again = await Online.Session.join(Online.inviteCode(host.game.room, 2), SERVER);
  assert.equal(again.sent, true);
  assert.deepEqual(again.cmds, a.cmds);
  assert.equal(G.hashState(again.working), G.hashState(a.working), 'preview matches');
  assert.deepEqual(again.waiting.sort(), [1, 3]);
  assert.ok(b);
});

test('the turn waits for everyone, and my own orders can only be sent once', async () => {
  install();
  const [host, a, b] = await setup(3);
  await host.submit(); await a.submit();
  await host.sync();
  assert.deepEqual(host.waiting, [3]);
  assert.equal(host.base.turn, 1);
  assert.ok((await a.submit()).ok, 'a repeat submit is harmless');
  await b.submit();
  await host.sync();
  assert.equal(host.base.turn, 2);
});

test('host can skip a missing player, and a late reply loses', async () => {
  install();
  const [host, a, b] = await setup(3);
  await host.submit(); await a.submit();
  assert.equal((await a.hostSkip(3, false)).ok, false, 'only the host can skip');
  assert.equal((await host.hostSkip(3, false)).ok, true);
  assert.equal(host.base.turn, 2);
  const late = await b.submit();
  assert.equal(late.ok, false);
  await b.sync(); await a.sync();
  assert.equal(b.base.turn, 2);
  assert.equal(G.hashState(b.base), G.hashState(host.base));
  assert.equal(G.hashState(a.base), G.hashState(host.base));
});

test('host can hand a seat to the AI for good', async () => {
  install();
  const [host, a, b] = await setup(3);
  await host.submit(); await a.submit();
  await host.hostSkip(3, true);
  for (const p of [host, a, b]) await p.sync();
  assert.equal(G.empire(host.base, 3).human, false);
  assert.equal(G.hashState(b.base), G.hashState(host.base));
  await host.submit(); await a.submit();
  for (const p of [host, a, b]) await p.sync();
  assert.equal(host.base.turn, 3);
  assert.equal(G.hashState(b.base), G.hashState(host.base));
  assert.equal((await b.submit()).ok, false, 'the AI seat cannot send orders');
});

test('a copy that drifted out of sync is noticed and rebuild fixes it', async () => {
  install();
  const rnd = driver(11);
  const players = await setup(3);
  for (let turn = 1; turn <= 4; turn++) {
    for (const p of players) { randomOrders(p, rnd); await p.submit(); }
    for (const p of players) await p.sync();
  }
  players[1].base.empires[0].credits += 1;            // corrupt one copy (a stand-in for an engine difference)
  for (const p of players) { randomOrders(p, rnd); await p.submit(); }
  for (const p of players) await p.sync();
  for (const p of players) await p.sync();
  assert.ok(players[1].desync, 'the corrupted browser must notice');
  assert.ok(players[0].desync || players[2].desync, 'someone else sees the mismatch too');
  await players[1].rebuild();
  assert.equal(players[1].desync, false);
  await players[0].sync();
  assert.equal(G.hashState(players[1].base), G.hashState(players[2].base));
});

test('junk or misaddressed orders count as no orders and cannot break the game', async () => {
  install();
  const [host, a, b] = await setup(3);
  await host.submit(); await a.submit();
  // seat 3 posts orders addressed to seat 2, for the wrong turn
  const wrong = G.encodeOrders({ v: 1, seat: 2, turn: 99, cmds: [{ op: 'research' }] });
  assert.equal((await S.putOnce(b.game.server, b.game.room, S.orderKey(1, 3), { code: wrong })).status, 201);
  for (const p of [host, a, b]) await p.sync();
  assert.equal(host.base.turn, 2);
  assert.equal(G.hashState(host.base), G.hashState(a.base));
  assert.equal(G.hashState(host.base), G.hashState(b.base));
});

test('garbage a stranger writes into a slot is ignored, and the real owner can still take the slot', async () => {
  install();
  const [host, a, b] = await setup(3);
  const { server, room } = host.game;
  const junk = [{ code: 5 }, 'hello', [1, 2], null, { code: '<script>alert(1)</script>' }, { code: 'ok', h: 'ZZZ' }, { skip: 'yes' }, { code: 'x'.repeat(S.LIMIT_CODE + 1) }];
  for (const v of junk) {
    assert.equal(Online.cleanEntry(v) === null || Object.keys(Online.cleanEntry(v)).every(k => ['code', 'h'].includes(k)), true, JSON.stringify(v).slice(0, 30));
  }
  // a stranger fills seat 3's slot with junk before seat 3 answers
  await S.call(server, 'PUT', '/kv/sdo-' + room + '/' + S.orderKey(1, 3), { body: { code: 5 }, ifNoneMatch: true });
  await host.submit(); await a.submit();
  await host.sync();
  assert.deepEqual(host.waiting, [3], 'junk does not count as orders');
  const r = await b.submit();
  assert.ok(r.ok, 'seat 3 replaces the junk: ' + r.msg);
  await host.sync();
  assert.equal(host.base.turn, 2);
  await a.sync(); await b.sync();
  assert.equal(G.hashState(a.base), G.hashState(host.base));
  assert.equal(G.hashState(b.base), G.hashState(host.base));
});

test('a stranger who finds a room can only read the keys they already know', async () => {
  const n = install();
  const [host] = await setup(2);
  const gameCalls = n.calls.slice();      // everything the game itself asked for so far
  const r = await S.call(host.game.server, 'GET', '/kv/sdo-' + host.game.room);
  assert.equal(r.status, 404);
  assert.equal(r.data.code, 'no_listing');
  assert.ok(!JSON.stringify(r.data).includes('meta'), 'no key names leak');
  const r2 = await S.call(host.game.server, 'GET', '/kv/sdo-' + host.game.room + '?prefix=o-');
  assert.equal(r2.status, 404);
  // and the game itself never asks for a listing
  if (!REAL) for (const c of gameCalls) assert.ok(/\/kv\/sdo-[a-z0-9]+(\/[A-Za-z0-9_.:-]+|\?keys=[^&]+)$/.test(c.path), 'unexpected request ' + c.path);
});

test('requests stay few (the store limits requests per game per minute)', { skip: !!REAL }, async () => {
  const n = install();
  const players = await setup(3);
  const rnd = driver(1);
  n.calls.length = 0;
  for (let turn = 1; turn <= 10; turn++) {
    for (const p of players) { randomOrders(p, rnd); await p.submit(); }
    for (const p of players) await p.sync();
  }
  const perPlayerTurn = n.calls.length / (10 * 3);
  assert.ok(perPlayerTurn <= 8, 'too chatty: ' + perPlayerTurn.toFixed(1) + ' requests per player-turn');
});

test('when the store says no, the player gets a plain message', { skip: !!REAL }, async () => {
  install();
  const [host, a] = await setup(2);
  const real = globalThis.fetch;
  const say = (status, data, retry) => { globalThis.fetch = async () => new Response(JSON.stringify(data), { status, headers: retry ? { 'retry-after': String(retry) } : {} }); };
  say(429, { error: 'too many requests for this namespace; try again in 30 seconds', code: 'rate_limited' }, 30);
  let r = await a.sync();
  assert.match(r.error, /busy.*30 seconds/);
  assert.doesNotMatch(r.error, /rate_limited|namespace/);
  say(507, { code: 'store_full' });
  r = await a.sync();
  assert.match(r.error, /out of space/);
  say(413, { code: 'namespace_full' });
  assert.match((await a.submit()).msg, /used up its storage/);
  say(429, { error: 'too many new namespaces today; try again', code: 'rate_limited' }, 3600);
  await assert.rejects(() => Online.Session.create({ server: SERVER, humans: 2, difficulty: 'normal', worlds: 30 }), /limit for new games today.*60 minutes/);
  say(429, { error: 'too many new namespaces; try again in 100 seconds', code: 'rate_limited' }, 100);
  await assert.rejects(() => Online.Session.create({ server: SERVER, humans: 2, difficulty: 'normal', worlds: 30 }), /lot of games from this connection/);
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  r = await a.sync();
  assert.match(r.error, /Could not reach the game server/);
  globalThis.fetch = real;
  assert.ok(host);
});

test('values read back from the store are validated before use', async () => {
  // only the shape we write survives: a code made of safe characters, a hex hash, nothing else
  assert.deepEqual(Online.cleanEntry({ code: 'SDO1.abc', h: '0123456789abcdef' }), { code: 'SDO1.abc', h: '0123456789abcdef' });
  assert.deepEqual(Online.cleanEntry({ code: 'SDO1.abc', h: 'nothex!!' }), { code: 'SDO1.abc' }, 'a malformed hash is dropped');
  assert.deepEqual(Online.cleanEntry({ code: 'SDO1.abc', extra: { evil: 1 }, __proto__: { polluted: true } }), { code: 'SDO1.abc' });
  assert.deepEqual(Online.cleanEntry({ skip: true, ai: true, code: 'ignored' }), { skip: true, ai: true });
  assert.deepEqual(Online.cleanEntry({ skip: true, ai: 'yes' }), { skip: true });
  for (const bad of [null, undefined, 5, 'x', [], [1], {}, { code: '' }, { code: 7 }, { code: 'a b' }, { code: '<img src=x onerror=alert(1)>' }, { code: 'x'.repeat(S.LIMIT_CODE + 1) }, { skip: 'true' }, { skip: 1 }]) {
    assert.equal(Online.cleanEntry(bad), null, JSON.stringify(bad));
  }
  assert.equal(({}).polluted, undefined);
});

test('one player with a broken copy is flagged for the others and for themselves, and clears after a rebuild', async () => {
  install();
  const rnd = driver(21);
  const players = await setup(3);
  for (let turn = 1; turn <= 3; turn++) { for (const p of players) { randomOrders(p, rnd); await p.submit(); } for (const p of players) await p.sync(); }
  players[2].base.empires[1].credits += 5;
  for (const p of players) { randomOrders(p, rnd); await p.submit(); }
  await players[0].sync();
  assert.equal(players[0].desync, true, 'others see the odd hash');
  for (const p of players) await p.sync();
  await players[2].rebuild();
  assert.equal(players[2].desync, false, 'a replay from the log is healthy');
  // next turn everyone agrees again and the warnings go away by themselves
  for (const p of players) { randomOrders(p, rnd); await p.submit(); }
  for (const p of players) await p.sync();
  for (const p of players) await p.sync();
  assert.equal(new Set(hashes(players)).size, 1);
  assert.deepEqual(players.map(p => p.desync), [false, false, false]);
});

// ---------- presence: who is around ----------

test('a player whose page is open shows as online, and as offline after a minute away', { skip: !!REAL }, async () => {
  const n = install();
  const [host, a, b] = await setup(3);
  for (const p of [host, a, b]) await p.beat();
  for (const p of [host, a, b]) await p.sync();
  assert.equal(host.isOnline(2), true);
  assert.equal(host.isOnline(3), true);
  assert.equal(host.anyoneOnline(), true);
  assert.equal(host.presence[1], undefined, 'nobody tracks themself');
  // seat 2 closes the tab: after more than 45 s of no heartbeat they are away, while 3 keeps checking in
  n.clock.now += 40;
  await b.beat(); await host.sync();
  assert.equal(host.isOnline(2), true, '40 s is still fine');
  n.clock.now += 20;
  await b.beat(); await host.sync();
  assert.equal(host.isOnline(2), false);
  assert.equal(host.isOnline(3), true);
  assert.ok(host.presence[2] >= 60 && host.presence[2] < 70, 'how long ago: ' + host.presence[2]);
});

test('coming online and going offline are reported once each, and the first look is quiet', { skip: !!REAL }, async () => {
  const n = install();
  const [host, a, b] = await setup(3);
  await a.beat();
  // someone who joins while seat 2 is already here does not get an "arrived" notice for them
  const late = await Online.Session.join(Online.inviteCode(host.game.room, 3), SERVER);
  assert.equal(late.isOnline(2), true);
  assert.deepEqual(late.takeEvents(), []);
  // the host looked before seat 2 arrived, so they hear about it, once
  await host.sync();
  assert.deepEqual(host.takeEvents(), [{ seat: 2, kind: 'online' }]);
  await b.beat(); await host.sync();
  assert.deepEqual(host.takeEvents(), [{ seat: 3, kind: 'online' }]);
  await host.sync(); await host.sync();
  assert.deepEqual(host.takeEvents(), [], 'nothing new, nothing reported');
  n.clock.now += 70;
  await b.beat(); await host.sync();       // seat 3 stays, seat 2 has gone quiet
  assert.deepEqual(host.takeEvents(), [{ seat: 2, kind: 'offline' }]);
  await host.sync();
  assert.deepEqual(host.takeEvents(), [], 'reported once');
  await a.beat(); await host.sync();
  assert.deepEqual(host.takeEvents(), [{ seat: 2, kind: 'online' }]);
});

test('a player who never opened the game is "not joined yet", not offline, and the AI is never reported', { skip: !!REAL }, async () => {
  install();
  const [host, a, b] = await setup(3);
  await host.sync();
  assert.equal(host.presence[2], null);
  assert.equal(host.isOnline(2), false);
  await host.submit(); await a.submit();
  await host.hostSkip(3, true);            // seat 3 becomes AI
  await b.beat(); await host.sync();
  assert.deepEqual(host.takeEvents().filter(e => e.seat === 3), [], 'AI seats are not people');
});

test('presence rides along with the orders read: it costs no extra requests', { skip: !!REAL }, async () => {
  const n = install();
  const [host] = await setup(4);
  n.calls.length = 0;
  await host.sync();
  assert.equal(n.calls.length, 1, 'one request to check orders and who is around: ' + n.calls.map(c => c.method + ' ' + c.path).join(' | '));
});

test('nobody can fake being online or hide being away by writing something into their heartbeat', { skip: !!REAL }, async () => {
  const n = install();
  const [host, a] = await setup(2);
  const { server, room } = host.game;
  // seat 2 writes a heartbeat whose body claims it is the far future; only the server's own write time counts
  await S.call(server, 'PUT', '/kv/sdo-' + room + '/p-2', { body: { v: 1, t: 9_999_999_999, now: 0 } });
  n.clock.now += 120;
  await host.sync();
  assert.equal(host.isOnline(2), false);
  assert.ok(host.presence[2] >= 120);
  assert.ok(a);
});

test('a missed heartbeat never throws, and a finished game stops checking in', { skip: !!REAL }, async () => {
  const n = install();
  const [host] = await setup(2);
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await host.beat();                       // offline: must not throw
  globalThis.fetch = real;
  n.calls.length = 0;
  host.base.over = true;
  await host.beat();
  assert.equal(n.calls.length, 0, 'no heartbeat after the game is over');
});

test('presence works against the real server too (a player who just checked in is online)', { skip: !REAL }, async () => {
  install();
  const [host, a] = await setup(2);
  await a.beat();
  await host.sync();
  assert.equal(host.isOnline(2), true, 'age ' + host.presence[2]);
  assert.ok(host.presence[2] >= 0 && host.presence[2] < 20);
});
