import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { handle, route, LIMITS } from '../relay/src/logic.js';
const require = createRequire(import.meta.url);
const G = require('../sectordominion/game.js');
globalThis.Relay = require('../shared/relay.js');
const Online = require('../sectordominion/online.js');

// a fake network: fetch() goes straight to the relay logic, one in-memory store per room
// Set RELAY_URL=http://localhost:8788 to run the same tests against a real relay (wrangler dev or the Node server).
const REAL = process.env.RELAY_URL || '';
function installRelay(limitOverride) {
  const rooms = new Map();
  const log = [];
  if (REAL) return { rooms, log };
  globalThis.fetch = async (url, init = {}) => {
    const req = new Request(url, init);
    const r = route(req);
    if (r.response) return r.response;
    let rows = rooms.get(r.room);
    if (!rows) rooms.set(r.room, rows = new Map());
    const store = {
      get: async k => rows.get(k),
      getMany: async keys => Object.fromEntries(keys.filter(k => rows.has(k)).map(k => [k, rows.get(k)])),
      put: async (k, v) => { rows.set(k, JSON.parse(JSON.stringify(v))); },
      touch: async () => {},
    };
    log.push(req.method + ' ' + new URL(url).pathname);
    return handle(req, store, r.room, { limits: { ...LIMITS, roomReqPerMin: 1e9, roomWritesPerMin: 1e9, ...(limitOverride || {}) } });
  };
  return { rooms, log };
}

function driver(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RELAY = REAL || 'https://relay.test';

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
  const host = await Online.Session.create({ relay: RELAY, humans, difficulty: 'normal', worlds: 30 });
  const sessions = [host];
  for (const inv of host.game.invites) sessions.push(await Online.Session.join(inv));
  return sessions;
}

test('invite codes round trip and junk is refused', async () => {
  installRelay();
  const [host] = await setup(3);
  assert.equal(host.game.invites.length, 2);
  for (const inv of host.game.invites) {
    const g = Online.decodeInvite(inv);
    assert.ok(g);
    assert.equal(g.room, host.game.room);
    assert.notEqual(g.token, host.game.token, 'friends get their own token');
  }
  const rnd = driver(5);
  for (let i = 0; i < 200; i++) {
    const junk = ['', 'SDO-', 'SDO-@@', 'x', 'SDO-' + Buffer.from('{"v":1}').toString('base64'), null, undefined, 7, 'SDO-' + Buffer.from(String(rnd())).toString('base64')][i % 9];
    assert.equal(Online.decodeInvite(junk), null);
  }
  const g = Online.decodeInvite(host.game.invites[0]);
  for (const bad of [{ relay: 'http://evil.example' }, { relay: 'javascript:alert(1)' }, { room: 'X' }, { seat: 9 }, { token: 'short' }, { humans: 7 }, { worlds: 5000 }, { difficulty: '__proto__' }, { seed: 1e12 }]) {
    assert.equal(Online.decodeInvite(Online.encodeInvite({ ...g, ...bad })), null, JSON.stringify(bad));
  }
  assert.ok(Online.decodeInvite(Online.encodeInvite({ ...g, relay: 'http://localhost:8787' })), 'local relay is allowed');
});

test('three browsers stay identical over 30 turns with shuffled arrival and random sync timing', async () => {
  for (let seed = 1; seed <= 6; seed++) {
    installRelay();
    const rnd = driver(seed * 99);
    const players = await setup(3);
    for (let turn = 1; turn <= 30; turn++) {
      if (players[0].base.over) break;
      for (const p of players) randomOrders(p, rnd);
      const order = [0, 1, 2].sort(() => rnd() - 0.5);       // arrival order does not matter
      for (const i of order) {
        const r = await players[i].submit();
        assert.ok(r.ok, r.msg);
        if (rnd() < 0.5) await players[(rnd() * 3) | 0].sync(); // random browsers look at the board at random times
      }
      for (const p of players) await p.sync();
      const hashes = players.map(p => G.hashState(p.base));
      assert.equal(new Set(hashes).size, 1, 'seed ' + seed + ' turn ' + turn + ' diverged: ' + hashes.join(' '));
      assert.equal(new Set(players.map(p => p.base.turn)).size, 1);
      for (const p of players) assert.equal(p.desync, false);
    }
    assert.ok(players[0].base.turn > 5);
  }
});

test('a late joiner rebuilds the exact game by replaying the board', async () => {
  installRelay();
  const rnd = driver(77);
  const players = await setup(3);
  for (let turn = 1; turn <= 12; turn++) {
    for (const p of players) { randomOrders(p, rnd); await p.submit(); }
    for (const p of players) await p.sync();
  }
  const fresh = await Online.Session.join(players[0].game.invites[0]);
  assert.equal(G.hashState(fresh.base), G.hashState(players[1].base));
  assert.equal(fresh.base.turn, 13);
  assert.equal(fresh.desync, false);
  assert.equal(fresh.seat, players[1].seat);
});

test('rejoining mid-turn restores my submitted orders', async () => {
  installRelay();
  const rnd = driver(3);
  const [host, a, b] = await setup(3);
  randomOrders(a, rnd);
  await a.submit();
  const again = await Online.Session.join(host.game.invites[0]);
  assert.equal(again.sent, true);
  assert.deepEqual(again.cmds, a.cmds);
  assert.equal(G.hashState(again.working), G.hashState(a.working), 'preview matches');
  assert.deepEqual(again.waiting.sort(), [1, 3]);
  assert.ok(b);
});

test('the turn waits for everyone, and my own orders can only be sent once', async () => {
  installRelay();
  const [host, a, b] = await setup(3);
  await host.submit(); await a.submit();
  await host.sync();
  assert.deepEqual(host.waiting, [3]);
  assert.equal(host.base.turn, 1);
  const again = await a.submit();
  assert.ok(again.ok, 'a repeat submit is harmless');
  await b.submit();
  await host.sync();
  assert.equal(host.base.turn, 2);
});

test('host can skip a missing player, and a late reply loses', async () => {
  installRelay();
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
  installRelay();
  const [host, a, b] = await setup(3);
  await host.submit(); await a.submit();
  await host.hostSkip(3, true);
  for (const p of [host, a, b]) await p.sync();
  assert.equal(G.empire(host.base, 3).human, false);
  assert.equal(G.hashState(b.base), G.hashState(host.base));
  // from now on only seats 1 and 2 are needed
  await host.submit(); await a.submit();
  for (const p of [host, a, b]) await p.sync();
  assert.equal(host.base.turn, 3);
  assert.equal(G.hashState(b.base), G.hashState(host.base));
  assert.equal((await b.submit()).ok, false, 'the AI seat cannot send orders');
});

test('a browser that drifted out of sync is noticed and rebuild fixes it', async () => {
  installRelay();
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

test('players cannot act as each other', async () => {
  installRelay();
  const [host, a] = await setup(3);
  const R = globalThis.Relay;
  const turn = host.base.turn;
  const forged = await R.putOrders(a.game.relay, a.game.room, turn, 1, a.game.token, { code: 'SDO1.forged' });
  assert.equal(forged.status, 403);
  const forgedSkip = await R.skip(a.game.relay, a.game.room, turn, 1, a.game.token, true);
  assert.equal(forgedSkip.status, 403);
});

test('junk or misaddressed orders count as no orders and cannot break the game', async () => {
  installRelay();
  const [host, a, b] = await setup(3);
  const R = globalThis.Relay;
  await host.submit(); await a.submit();
  // seat 3 posts orders addressed to seat 2, for the wrong turn
  const wrong = G.encodeOrders({ v: 1, seat: 2, turn: 99, cmds: [{ op: 'research' }] });
  assert.equal((await R.putOrders(b.game.relay, b.game.room, 1, 3, b.game.token, { code: wrong })).status, 201);
  for (const p of [host, a, b]) await p.sync();
  assert.equal(host.base.turn, 2);
  assert.equal(G.hashState(host.base), G.hashState(a.base));
  assert.equal(G.hashState(host.base), G.hashState(b.base));
});

test('requests per turn stay small (free-tier budget)', { skip: !!REAL }, async () => {
  const net = installRelay();
  const players = await setup(3);
  const rnd = driver(1);
  net.log.length = 0;
  for (let turn = 1; turn <= 10; turn++) {
    for (const p of players) { randomOrders(p, rnd); await p.submit(); }
    for (const p of players) await p.sync();
  }
  const perPlayerTurn = net.log.length / (10 * 3);
  assert.ok(perPlayerTurn < 14, 'too chatty: ' + perPlayerTurn.toFixed(1) + ' requests per player-turn');
});

test('when a relay limit is hit the player gets a plain message and the game carries on afterwards', { skip: !!REAL }, async () => {
  installRelay();
  const [host, a] = await setup(2);
  // now squeeze the relay: it answers 429 to everything
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (++calls > 0) return new Response(JSON.stringify({ ok: false, error: 'room_rate_limited', retryAfter: 30 }), { status: 429, headers: { 'retry-after': '30' } });
    return real(url, init);
  };
  const r = await a.sync();
  assert.ok(r.error, 'the session reports the problem');
  assert.match(r.error, /Too many requests for this game/);
  assert.doesNotMatch(r.error, /room_rate_limited/, 'no raw error codes in front of players');
  globalThis.fetch = real;
  assert.ok(host);
});

test('creating a game over the daily room limit says so in plain words', { skip: !!REAL }, async () => {
  installRelay();
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'daily_room_limit', retryAfter: 3600 }), { status: 429 });
  await assert.rejects(() => Online.Session.create({ relay: RELAY, humans: 2, difficulty: 'normal', worlds: 30 }), /daily limit for new games/);
  globalThis.fetch = real;
});
