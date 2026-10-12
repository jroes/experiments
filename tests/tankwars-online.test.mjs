import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { installFakeKv } = require('./fake-kv.js');
const T = require('../tankwars/game.js');
globalThis.TW = T;
globalThis.GameStore = require('../shared/store.js');
const S = globalThis.GameStore;
const O = require('../tankwars/online.js');

// Set KV_URL=http://localhost:8123 to run the same tests against the real elf-punch binary instead of the fake.
const REAL = process.env.KV_URL || '';
const SERVER = REAL || 'https://kv.test';
let net = null;
function install(opts) { net = REAL ? { calls: [], spaces: new Map(), set() {}, clock: { now: 0 } } : installFakeKv(opts); return net; }

const people = (...ai) => ai.map((a, i) => ({ name: ['Ann', 'Bo', 'Cy', 'Di'][i], ai: a }));

async function start(players, extra) {
  install();
  const host = await O.Session.create({ server: SERVER, players, seed: 7, width: 320, rounds: 2, ...(extra || {}) });
  const sessions = [host];
  for (let i = 1; i < players.length; i++) if (players[i].ai === 0) sessions.push(await O.Session.join({ server: SERVER, room: host.room, seat: i }));
  return sessions;
}
const bySeat = (sessions, seat) => sessions.find(x => x.seat === seat);
const hashes = sessions => sessions.map(x => T.hashState(x.s));
const syncAll = sessions => Promise.all(sessions.map(x => x.sync()));

// aims the way the computer would, from this session's own copy of the game
function aimFor(sess) {
  const c = JSON.parse(JSON.stringify(sess.s)); // a person's aim never touches the game's random numbers; the computer's does, so aim on a copy
  return T.aiAim(c) || { angle: 90, power: 50, weapon: 'shell' };
}

// plays a whole game: whoever's turn it is shoots, then everyone syncs; shops buy something different
async function playOut(sessions, opts) {
  opts = opts || {};
  let steps = 0;
  const lead = sessions[0];
  while (!lead.s.over) {
    if (opts.stopAfter !== undefined && steps >= opts.stopAfter) break;
    assert.ok(++steps < 3000, 'game does not end');
    const s = lead.s;
    if (s.phase === 'aim' && s.players[s.turn].ai === 0) {
      const mover = bySeat(sessions, s.turn);
      const a = aimFor(mover);
      const r = await mover.submit(a.angle, a.power, a.weapon);
      assert.ok(r.ok);
    } else if (s.phase === 'roundover') {
      for (const x of sessions) await x.nextRound();
    } else if (s.phase === 'shop') {
      let i = 0;
      for (const x of sessions) await x.submitShop(i++ % 2 ? ['shield', 'big'] : ['nuke', 'dirt', 'triple', 'big', 'big']);
    }
    await syncAll(sessions);
    if (opts.each) opts.each(sessions);
    const hs = new Set(hashes(sessions));
    assert.equal(hs.size, 1, 'copies drifted apart at step ' + steps);
    for (const x of sessions) assert.equal(x.desync, false);
  }
  return steps;
}

test('what comes back from the store is checked: setups, shots, shopping', () => {
  const good = { v: 1, game: 'tankwars', rules: O.RULES, seed: 5, width: 480, rounds: 3, players: people(0, 0, 2) };
  assert.ok(O.cleanMeta(good));
  const bad = [null, 3, 'x', [], {}, { ...good, v: 2 }, { ...good, game: 'other' }, { ...good, rules: 99 }, { ...good, seed: 1.5 }, { ...good, width: 5 }, { ...good, width: 9999 }, { ...good, rounds: 0 }, { ...good, rounds: 16 },
    { ...good, players: [] }, { ...good, players: people(0) }, { ...good, players: people(0, 0, 0, 0, 0) }, { ...good, players: people(0, 2) }, { ...good, players: [{ name: 'a', ai: 9 }, { name: 'b', ai: 0 }] },
    { ...good, players: [{ name: 'x'.repeat(40), ai: 0 }, { name: 'b', ai: 0 }] }, { ...good, players: [{ name: 5, ai: 0 }, { name: 'b', ai: 0 }] }];
  for (const b of bad) assert.equal(O.cleanMeta(b), null, JSON.stringify(b).slice(0, 80));

  assert.deepEqual(O.cleanMove({ v: 1, a: 45, p: 60, w: 'shell', h: 'abcdef0123456789' }), { ai: false, a: 45, p: 60, w: 'shell', h: 'abcdef0123456789' });
  assert.deepEqual(O.cleanMove({ v: 1, a: 45, p: 60, w: 'big', h: 'nonsense' }), { ai: false, a: 45, p: 60, w: 'big', h: null });
  assert.deepEqual(O.cleanMove({ v: 1, ai: 1, a: 'x' }), { ai: true, h: null });
  for (const m of [null, 4, 'x', {}, { v: 2, a: 1, p: 1, w: 'shell' }, { v: 1, a: -1, p: 5, w: 'shell' }, { v: 1, a: 181, p: 5, w: 'shell' }, { v: 1, a: 90.5, p: 5, w: 'shell' }, { v: 1, a: 90, p: 0, w: 'shell' }, { v: 1, a: 90, p: 101, w: 'shell' },
    { v: 1, a: 90, p: 50, w: 'constructor' }, { v: 1, a: 90, p: 50, w: '__proto__' }, { v: 1, a: 90, p: 50, w: 7 }, { v: 1, a: '90', p: 50, w: 'shell' }, { v: 1, a: NaN, p: 50, w: 'shell' }]) assert.equal(O.cleanMove(m), null, JSON.stringify(m));

  assert.deepEqual(O.cleanShop({ v: 1, buy: ['big', 'shield'] }), { buy: ['big', 'shield'] });
  assert.deepEqual(O.cleanShop({ v: 1, buy: [] }), { buy: [] });
  for (const b of [null, {}, { v: 1 }, { v: 1, buy: 'big' }, { v: 1, buy: ['constructor'] }, { v: 1, buy: ['__proto__'] }, { v: 1, buy: ['shell'] }, { v: 1, buy: Array(31).fill('big') }, { v: 1, buy: [5] }]) assert.equal(O.cleanShop(b), null, JSON.stringify(b));
});

test('invites: room plus seat number, from a code or a whole link', () => {
  assert.deepEqual(O.parseInvite('abcdefghij012345' + '2'), { room: 'abcdefghij012345', seat: 1 });
  assert.deepEqual(O.parseInvite('https://jroes.github.io/experiments/tankwars/#abcdefghij0123453'), { room: 'abcdefghij012345', seat: 2 });
  assert.deepEqual(O.parseInvite('  #join=ABCDEFGHIJ0123451 '), { room: 'abcdefghij012345', seat: 0 });
  for (const t of ['', null, 'short1', 'abcdefghij0123455', 'abcdefghij0123450', 'abcdefghij012345!1', 'x'.repeat(100)]) assert.equal(O.parseInvite(t), null, String(t));
});

test('two people play a whole game, and both copies are identical at every step', async () => {
  const sessions = await start(people(0, 0));
  assert.equal(sessions.length, 2);
  const steps = await playOut(sessions);
  assert.ok(steps > 4);
  assert.equal(sessions[0].s.phase, 'over');
  assert.deepEqual(sessions[0].s.players.map(p => p.money), sessions[1].s.players.map(p => p.money));
});

test('people and computers together: the computers need no entries from anyone', async () => {
  const sessions = await start(people(0, 3, 0, 1));
  await playOut(sessions);
  const writes = net.calls.filter(c => c.method === 'PUT' && /\/m-/.test(c.path)).length;
  const shots = sessions[0].s.shots;
  assert.ok(writes < shots, 'only the people\'s shots are written: ' + writes + ' of ' + shots);
});

test('a new device (or a refresh) rebuilds the whole game by replaying it, and lands on the same state', async () => {
  const sessions = await start(people(0, 0, 2));
  await playOut(sessions);
  const late = await O.Session.join({ server: SERVER, room: sessions[0].room, seat: 1 });
  assert.notEqual(T.hashState(late.s), T.hashState(sessions[0].s));
  const events = await late.sync({ skipRoundOver: true });
  assert.equal(T.hashState(late.s), T.hashState(sessions[0].s));
  assert.ok(events.filter(e => e.type === 'shot').length === sessions[0].s.shots);
  assert.equal(late.desync, false);
});

test('a long replay reads the store in batches, not one shot at a time', async () => {
  const sessions = await start(people(0, 0));
  await playOut(sessions);
  const before = net.calls.length;
  const late = await O.Session.join({ server: SERVER, room: sessions[0].room, seat: 1 });
  await late.sync({ skipRoundOver: true });
  const reads = net.calls.length - before;
  assert.ok(reads < sessions[0].s.shots / 3 + 6, 'reads ' + reads + ' for ' + sessions[0].s.shots + ' shots');
});

test('only the seat whose turn it is can shoot, and it cannot shoot twice', async () => {
  const [a, b] = await start(people(0, 0));
  const other = a.s.turn === a.seat ? b : a;
  await assert.rejects(() => other.submit(45, 50, 'shell'), /not your turn/);
  const mover = a.s.turn === a.seat ? a : b;
  assert.ok((await mover.submit(60, 50, 'shell')).ok);
  await assert.rejects(() => mover.submit(60, 50, 'shell'), /not your turn/);
});

test('the computer can play a friend\'s turn when they have gone quiet, and a late shot is refused', async () => {
  const [a, b] = await start(people(0, 0));
  const idle = a.s.turn === a.seat ? a : b, other = idle === a ? b : a;
  assert.deepEqual(other.waiting(), { kind: 'move', seat: idle.seat });
  assert.equal(await other.takeOver(), true);
  await syncAll([a, b]);
  assert.equal(a.s.shots, 1); assert.equal(b.s.shots, 1);
  assert.equal(T.hashState(a.s), T.hashState(b.s));
  // the slow friend wakes up, and their old turn is gone
  await assert.rejects(() => idle.submit(45, 50, 'shell'), /not your turn/);
});

test('a takeover and a real shot arriving together: exactly one of them is played, everywhere', async () => {
  const [a, b] = await start(people(0, 0));
  const mover = a.s.turn === a.seat ? a : b, other = mover === a ? b : a;
  const [r] = await Promise.all([mover.submit(70, 55, 'shell'), other.takeOver()]);
  await syncAll([a, b]);
  assert.equal(a.s.shots, 1); assert.equal(b.s.shots, 1);
  assert.equal(T.hashState(a.s), T.hashState(b.s));
  assert.ok(r.ok || r.ok === false);
});

test('junk written into a shot slot is ignored, and the real shooter can replace it', async () => {
  const [a, b] = await start(people(0, 0));
  const mover = a.s.turn === a.seat ? a : b, other = mover === a ? b : a;
  const key = O.moveKey(0, mover.seat), ns = 'sdo-' + a.room;
  for (const junk of [{ v: 1, a: 999, p: 1, w: 'shell' }, { v: 1, a: 45, p: 50, w: 'constructor' }, 'garbage', { v: 1, ai: 0 }, null]) {
    if (!REAL) net.set(ns, key, junk); else await S.call(SERVER, 'PUT', '/kv/' + ns + '/' + key, { body: junk, ifNoneMatch: false });
    await other.sync();
    assert.equal(other.s.shots, 0, 'junk must not be played: ' + JSON.stringify(junk));
    await S.call(SERVER, 'DELETE', '/kv/' + ns + '/' + key);
  }
  if (!REAL) net.set(ns, key, { v: 1, a: 999, p: 1, w: 'shell' });
  else await S.call(SERVER, 'PUT', '/kv/' + ns + '/' + key, { body: { v: 1, a: 999, p: 1, w: 'shell' } });
  const r = await mover.submit(50, 50, 'shell');
  assert.ok(r.ok, 'a real shot replaces junk');
  await other.sync();
  assert.equal(other.s.shots, 1);
  assert.equal(T.hashState(a.s), T.hashState(b.s));
});

test('a shot written for the wrong seat is never played', async () => {
  const [a, b] = await start(people(0, 0));
  const wrong = a.s.turn === a.seat ? b : a, right = wrong === a ? b : a;
  const ns = 'sdo-' + a.room;
  const key = O.moveKey(0, wrong.seat);
  if (!REAL) net.set(ns, key, { v: 1, a: 45, p: 50, w: 'shell' }); else await S.call(SERVER, 'PUT', '/kv/' + ns + '/' + key, { body: { v: 1, a: 45, p: 50, w: 'shell' } });
  await right.sync(); await wrong.sync();
  assert.equal(right.s.shots, 0); assert.equal(wrong.s.shots, 0);
});

test('two games that have drifted apart are noticed', async () => {
  const [a, b] = await start(people(0, 0));
  const mover = a.s.turn === a.seat ? a : b, other = mover === a ? b : a;
  other.s.players[0].hp -= 1; // a copy that disagrees
  await mover.submit(50, 50, 'shell');
  await other.sync();
  assert.equal(other.desync, true);
  assert.equal(mover.desync, false);
});

test('a shop waits for every person, then everyone starts the round together; a slow shopper can be skipped', async () => {
  const [a, b] = await start(people(0, 0), {});
  // end round one quickly
  while (a.s.phase === 'aim') {
    const mover = bySeat([a, b], a.s.turn);
    const x = aimFor(mover); await mover.submit(x.angle, x.power, x.weapon); await syncAll([a, b]);
  }
  assert.equal(a.s.phase, 'roundover');
  for (const x of [a, b]) await x.nextRound();
  assert.equal(a.s.phase, 'shop');
  const money = a.s.players.map(p => p.money);
  assert.ok(await a.submitShop(['big', 'big']));
  assert.equal(await a.submitShop(['nuke']), false, 'one shopping list per person');
  await syncAll([a, b]);
  assert.equal(a.s.phase, 'shop'); assert.equal(b.s.phase, 'shop');
  assert.deepEqual(a.waiting(), { kind: 'shop', seats: [1] });
  assert.equal(await a.skipShopper(1), true);
  await syncAll([a, b]);
  assert.equal(a.s.phase, 'aim'); assert.equal(b.s.phase, 'aim');
  assert.equal(a.s.round, 2);
  assert.equal(a.s.players[0].inv.big + (a.s.players[0].money === money[0] ? 0 : 0), 2);
  assert.equal(b.s.players[1].inv.big, 0);
  assert.equal(T.hashState(a.s), T.hashState(b.s));
});

test('shopping that cannot be afforded is simply not bought, the same way on every copy', async () => {
  const [a, b] = await start(people(0, 0));
  while (a.s.phase === 'aim') { const m = bySeat([a, b], a.s.turn); const x = aimFor(m); await m.submit(x.angle, x.power, x.weapon); await syncAll([a, b]); }
  for (const x of [a, b]) await x.nextRound();
  await a.submitShop(Array(30).fill('nuke')); await b.submitShop([]);
  await syncAll([a, b]);
  assert.ok(a.s.players[0].inv.nuke <= Math.floor((T.START_MONEY + 2000) / 900));
  assert.ok(a.s.players.every(p => p.money >= 0));
  assert.equal(T.hashState(a.s), T.hashState(b.s));
});

test('joining checks the game and the seat', async () => {
  install();
  await assert.rejects(() => O.Session.join({ server: SERVER, room: 'abcdefghij012345', seat: 1 }), /not found/);
  const host = await O.Session.create({ server: SERVER, players: people(0, 0, 3) });
  await assert.rejects(() => O.Session.join({ server: SERVER, room: host.room, seat: 2 }), /not for a person/);
  await assert.rejects(() => O.Session.join({ server: SERVER, room: host.room, seat: 7 }), /not for a person/);
  await assert.rejects(() => O.Session.join({ server: SERVER, room: host.room, seat: -1 }), /not for a person/);
  await assert.rejects(() => O.Session.create({ server: SERVER, players: people(0, 3) }), /at least two people/);
  await assert.rejects(() => O.Session.create({ server: SERVER, players: people(0) }), /at least two people/);
  if (!REAL) {
    net.set('sdo-' + host.room, 'meta', { v: 1, game: 'tankwars', rules: 99, seed: 1, width: 480, rounds: 3, players: people(0, 0) });
    await assert.rejects(() => O.Session.join({ server: SERVER, room: host.room, seat: 1 }), /Could not read/);
  }
});

test('a game with a bad connection changes nothing and says so', async () => {
  const [a, b] = await start(people(0, 0));
  if (REAL) return;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const before = T.hashState(a.s);
    await assert.rejects(() => a.sync(), /Could not reach/);
    assert.equal(T.hashState(a.s), before);
    const mover = a.s.turn === a.seat ? a : b;
    await assert.rejects(() => mover.submit(50, 50, 'shell'), /Could not|reach/);
  } finally { globalThis.fetch = orig; }
});

test('who is online comes from the server clock, not anybody\'s own', async () => {
  const [a, b] = await start(people(0, 0));
  await b.beat();
  await a.sync();
  assert.equal(a.isOnline(0), true, 'I am always here');
  assert.equal(a.isOnline(1), true);
  if (REAL) return;
  net.clock.now += O.ONLINE_SECS + 5;
  await a.sync();
  assert.equal(a.isOnline(1), false);
  await b.beat(); await a.sync();
  assert.equal(a.isOnline(1), true);
});

test('whole games with three or four people, any map size, always end with identical copies', async () => {
  let n = 0;
  for (const [seed, width, line] of [[1, 320, [0, 0, 0]], [2, 480, [0, 0, 0, 0]], [3, 640, [0, 2, 0, 3]], [4, 480, [0, 0, 1]]]) {
    install();
    const host = await O.Session.create({ server: SERVER, players: people(...line), seed, width, rounds: 2 });
    const sessions = [host];
    for (let i = 1; i < line.length; i++) if (line[i] === 0) sessions.push(await O.Session.join({ server: SERVER, room: host.room, seat: i }));
    await playOut(sessions);
    n++;
    const standings = T.standings(host.s).map(p => p.id);
    for (const x of sessions) assert.deepEqual(T.standings(x.s).map(p => p.id), standings);
  }
  assert.equal(n, 4);
});

test('rebuilding from the store works from any moment of a game: mid-round, in the shop, at a round end', async () => {
  for (const stop of [1, 4, 9, 15, 22, 30]) {
    const sessions = await start(people(0, 0, 2));
    await playOut(sessions, { stopAfter: stop });
    for (const x of sessions) while (x.s.phase === 'roundover') await x.nextRound();
    await syncAll(sessions);
    const late = await O.Session.join({ server: SERVER, room: sessions[0].room, seat: 1 });
    await late.sync({ skipRoundOver: true });
    assert.equal(T.hashState(late.s), T.hashState(sessions[0].s), 'stopped after ' + stop + ' steps, phase ' + sessions[0].s.phase);
  }
});
