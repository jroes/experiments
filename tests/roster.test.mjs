import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { installFakeKv } = require('./fake-kv.js');
const G = require('../sectordominion/game.js');
globalThis.GameStore = require('../shared/store.js');
const Online = require('../sectordominion/online.js');
const S = globalThis.GameStore;

// Who plays which seat, what is on offer to a friend, names, and moving a game to another device.
// Set KV_URL=http://localhost:8123 to run the same tests against the real elf-punch binary.
const REAL = process.env.KV_URL || '';
const SERVER = REAL || 'https://kv.test';
function install() { return REAL ? null : installFakeKv(); }

function driver(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function setup(humans) {
  const host = await Online.Session.create({ server: SERVER, humans, difficulty: 'normal', worlds: 30 });
  const sessions = [host];
  for (let seat = 2; seat <= humans; seat++) sessions.push(await Online.Session.join(Online.inviteCode(host.game.room, seat), SERVER));
  return sessions;
}
const join = (host, seat) => Online.Session.join(Online.inviteCode(host.game.room, seat), SERVER);
const syncAll = async ps => { for (let i = 0; i < 2; i++) for (const p of ps) await p.sync(); };

test('an empire handed to the AI is never offered to a friend, before or after the turn plays', async () => {
  install();
  const [host, a, b] = await setup(3);
  assert.deepEqual(host.invitable(), [2, 3]);
  assert.equal(host.seatState(2), 'human');

  const r = await host.hostSkip(3, true);
  assert.ok(r.ok, r.msg);
  await syncAll([host, a, b]);
  // the turn has not played (seats 1 and 2 have not sent orders), but the board already says seat 3 is going to the AI
  assert.equal(host.base.turn, 1);
  assert.equal(host.seatState(3), 'ai-pending');
  assert.deepEqual(host.invitable(), [2], 'the link list drops them as soon as the host chooses the AI');
  await assert.rejects(() => join(host, 3), /gave that seat to the AI/);
  assert.equal(b.seatState(3), 'ai-pending', 'their own page knows too');
  assert.equal((await b.submit()).ok, false, 'and cannot send orders any more');

  for (const p of [host, a]) assert.ok((await p.submit()).ok);
  await syncAll([host, a, b]);
  assert.equal(host.base.turn, 2);
  for (const p of [host, a, b]) assert.equal(p.seatState(3), 'ai');
  assert.deepEqual(host.invitable(), [2]);
  await assert.rejects(() => join(host, 3), /gave that seat to the AI/);
  assert.ok((await join(host, 2)).seat === 2, 'the seat that is still a person can be joined');
});

test('the host cannot skip or hand over a seat that is not an active person', async () => {
  install();
  const [host, a] = await setup(3);
  for (const bad of [1, 0, 4, 99, -1, 2.5, NaN, '2', null, undefined]) {
    const r = await host.hostSkip(bad, true);
    assert.equal(r.ok, false, 'seat ' + String(bad));
  }
  assert.equal((await a.hostSkip(3, true)).ok, false, 'only the host');
  assert.ok((await host.hostSkip(3, true)).ok);
  assert.equal((await host.hostSkip(3, true)).ok, false, 'already on its way to the AI');
  assert.equal((await host.hostSkip(3, false)).ok, false);
});

test('roles stay consistent over random games: all browsers agree, the AI never turns back into a person, nobody can join an AI seat', async () => {
  for (let seed = 1; seed <= 6; seed++) {
    install();
    const rnd = driver(seed * 31);
    const humans = 3 + (seed % 2);
    const players = await setup(humans);
    const host = players[0];
    const was = {};
    for (let round = 1; round <= 8 && !host.base.over; round++) {
      if (rnd() < 0.45) {
        const seat = 2 + ((rnd() * (humans - 1)) | 0);
        const before = host.seatState(seat);
        const r = await host.hostSkip(seat, rnd() < 0.7);
        if (before !== 'human') assert.equal(r.ok, false, 'a seat that is ' + before + ' cannot be taken over again');
      }
      for (const p of players) if (rnd() < 0.9) await p.submit();
      await syncAll(players);

      assert.ok(G.validState(host.base), 'the game stays a well-formed game');
      for (let seat = 1; seat <= humans; seat++) {
        const states = new Set(players.map(p => p.seatState(seat)));
        assert.equal(states.size, 1, 'seat ' + seat + ' differs between browsers: ' + [...states]);
        const now = host.seatState(seat);
        if (was[seat] === 'ai') assert.equal(now, 'ai', 'the AI never gives an empire back');
        if (was[seat] === 'ai-pending') assert.ok(now === 'ai-pending' || now === 'ai');
        if (was[seat] === 'out') assert.ok(now === 'out' || now === 'ai', 'a dead empire never comes back');
        was[seat] = now;
      }
      const wanted = [];
      for (let seat = 2; seat <= humans; seat++) if (host.seatState(seat) === 'human') wanted.push(seat);
      assert.deepEqual(host.invitable(), wanted, 'invitable() is exactly the seats a person still plays');

      for (let seat = 2; seat <= humans; seat++) {
        const st = host.seatState(seat);
        if (st === 'ai' || st === 'ai-pending') await assert.rejects(() => join(host, seat), /AI/, 'seat ' + seat + ' is ' + st);
        else if (round % 3 === 0) {
          const s = await join(host, seat);
          assert.equal(s.seat, seat);
          assert.equal(G.hashState(s.base), G.hashState(host.base));
        }
      }
    }
  }
});

test('display names: cleaned, short, shown to friends, and carried to a new device', async () => {
  assert.equal(Online.cleanName('  Ada   Lovelace  '), 'Ada Lovelace');
  assert.equal(Online.cleanName('<img src=x onerror=alert(1)>'), 'img src=x onerro', 'no markup characters, and cut to length');
  assert.equal(Online.cleanName('a"b\'c&d`e'), 'abcde');
  assert.equal(Online.cleanName('x'.repeat(100)).length, Online.NAME_MAX);
  assert.equal(Online.cleanName('😀'.repeat(40)), '😀'.repeat(Online.NAME_MAX), 'never cut in the middle of a character');
  assert.equal(Online.cleanName('line1\nline2\u0000'), 'line1line2', 'control characters go');
  for (const bad of ['', '   ', '<>', null, undefined, 5, {}, [], '\u0000']) assert.equal(Online.cleanName(bad), null, JSON.stringify(bad));

  install();
  const [host, a, b] = await setup(3);
  a.setName('Ada');
  await a.beat(); await b.beat();
  await host.sync();
  assert.equal(host.names[2], 'Ada');
  assert.equal(host.names[3], undefined, 'a player with no name has none');
  // junk dropped into a heartbeat is cleaned like any name
  await S.call(SERVER, 'PUT', '/kv/' + S.nsName(host.game.room) + '/' + S.presenceKey(3), { body: { v: 1, name: '<script>alert(1)</script>'.repeat(3) } });
  await S.call(SERVER, 'PUT', '/kv/' + S.nsName(host.game.room) + '/' + S.presenceKey(2), { body: { v: 1, name: { a: 1 } } });
  await host.sync();
  assert.ok(host.names[3].length <= Online.NAME_MAX && !/[<>]/.test(host.names[3]), host.names[3]);
  assert.equal(host.names[2], 'Ada', 'a bad name does not wipe a good one');
  // a new device for seat 2 learns the name from the store
  await S.beat(SERVER, host.game.room, 2, 'Ada');
  const phone = await join(host, 2);
  assert.equal(phone.names[2], 'Ada');
  assert.equal(phone.myName, null);
  // names survive a save and reload, and bad ones in the save are dropped
  const saved = JSON.parse(JSON.stringify(host));
  saved.names = { 2: 'Ada', 3: '<b>', 9: 'x', q: 'y' };
  const again = Online.Session.fromSaved(saved);
  assert.equal(again.names[2], 'Ada');
  assert.equal(again.names[3], 'b');
});

const entry = (n, seat = 1) => ({ room: ('abcdefghijklmnop' + n).slice(-16).replace(/[^a-z0-9]/g, 'x'), seat });

test('linking a device: name, games with friends and copies of solo games arrive intact', async () => {
  install();
  const rnd = driver(5);
  const state = G.newGame({ seed: 4242 });
  for (let t = 0; t < 6; t++) {
    for (const w of state.worlds.filter(w => w.owner === 1)) {
      G.apply(state, 1, { op: 'build', world: w.id, type: G.SHIP_ORDER[(rnd() * 4) | 0], turn: state.turn });
      G.apply(state, 1, { op: 'send', from: w.id, to: (rnd() * state.worlds.length) | 0, ships: { frigate: 1, transport: 1, scout: 1, cruiser: 0 }, turn: state.turn });
    }
    G.apply(state, 1, { op: 'ready', turn: state.turn });
    assert.ok(G.validState(state), 'turn ' + state.turn);
  }
  const [host, a] = await setup(2);
  const room = await Online.Link.create(SERVER);
  assert.match(Online.Link.code(room), /^d-[a-z0-9]{16}$/);
  await Online.Link.publish(SERVER, room, { name: 'Ada', online: [{ room: host.game.room, seat: 1 }, { room: a.game.room, seat: 2 }], solos: [state] });
  const got = await Online.Link.open(SERVER, room);
  assert.equal(got.name, 'Ada');
  assert.deepEqual(got.online, [{ room: host.game.room, seat: 1 }, { room: a.game.room, seat: 2 }]);
  assert.equal(got.solos.length, 1);
  assert.equal(G.hashState(got.solos[0]), G.hashState(state), 'the same game, to the last digit');
  // and it plays on identically from there
  const x = JSON.parse(JSON.stringify(state)), y = JSON.parse(JSON.stringify(got.solos[0]));
  for (const s2 of [x, y]) { G.apply(s2, 1, { op: 'research', turn: s2.turn }); G.apply(s2, 1, { op: 'ready', turn: s2.turn }); }
  assert.equal(G.hashState(x), G.hashState(y));

  assert.equal(Online.Link.parse('https://jroes.github.io/experiments/j/#' + Online.Link.code(room).toUpperCase()), room);
  assert.equal(Online.Link.parse('#join=d-' + room), room);
  for (const bad of ['', 'nonsense', 't-' + room, 'd-short', null, undefined]) assert.equal(Online.Link.parse(bad), null, String(bad));
  await assert.rejects(() => Online.Link.open(SERVER, 'e'.repeat(16)), /does not go anywhere/);
  await assert.rejects(() => Online.Link.open(SERVER, host.game.room), /does not go anywhere/, 'a game is not a link');
});

test('a link only ever hands back things that check out', async () => {
  install();
  const room = await Online.Link.create(SERVER);
  const ns = '/kv/' + S.nsName(room) + '/';
  const good = entry('g1', 2);
  await S.call(SERVER, 'PUT', ns + 'games', { body: { v: 1, list: [good, good, { room: 'x', seat: 1 }, { room: 'a'.repeat(16), seat: 9 }, { room: '__proto__', seat: 1 }, null, 5, { room: 'a'.repeat(16) }, { room: 'b'.repeat(16), seat: 1, extra: 'ignored' }] } });
  await S.call(SERVER, 'PUT', ns + 'profile', { body: { v: 1, name: '<script>alert(1)</script>', solos: 3 } });
  await S.call(SERVER, 'PUT', ns + 'solo-0', { body: { v: 1, game: 'not json' } });
  await S.call(SERVER, 'PUT', ns + 'solo-1', { body: { v: 1, game: { version: 2 } } });
  await S.call(SERVER, 'PUT', ns + 'solo-2', { body: { v: 1, game: JSON.stringify({ version: 2, turn: 1 }) } });
  const got = await Online.Link.open(SERVER, room);
  assert.deepEqual(got.online, [good, { room: 'b'.repeat(16), seat: 1 }]);
  assert.ok(!/[<>]/.test(got.name), got.name);
  assert.deepEqual(got.solos, [], 'broken copies are dropped, not played');
  await Online.Link.publish(SERVER, room, { name: '', online: [], solos: [{ version: 2 }, null] });
  assert.deepEqual((await Online.Link.open(SERVER, room)).solos, []);
  // a list can only grow so far
  const many = Array.from({ length: 60 }, (_, i) => entry('m' + String(i).padStart(2, '0'), 1 + (i % 4)));
  await Online.Link.add(SERVER, room, many);
  assert.ok((await Online.Link.list(SERVER, room)).length <= 24);
});

test('two devices adding games at the same moment never lose one', async () => {
  for (let round = 0; round < 12; round++) {
    install();
    const room = await Online.Link.create(SERVER);
    const wanted = [];
    const jobs = [];
    for (let dev = 0; dev < 3; dev++) for (let k = 0; k < 2; k++) {
      const e = entry('d' + dev + 'k' + k + 'r' + round, 1 + ((dev + k) % 4));
      wanted.push(e);
      jobs.push(Online.Link.add(SERVER, room, [e]));
    }
    await Promise.all(jobs);
    const got = await Online.Link.list(SERVER, room);
    assert.equal(got.length, wanted.length, 'round ' + round + ': ' + got.length);
    for (const e of wanted) assert.ok(got.some(x => x.room === e.room && x.seat === e.seat), 'lost ' + JSON.stringify(e));
  }
});

test('the games another device has that this one does not, minus ones removed on purpose', () => {
  const list = [entry('a1'), entry('b2', 2), entry('c3', 3)];
  const have = e => e.room === entry('a1').room && e.seat === 1;
  assert.deepEqual(Online.Link.newEntries(list, have, new Set()), [entry('b2', 2), entry('c3', 3)]);
  assert.deepEqual(Online.Link.newEntries(list, have, new Set([entry('b2', 2).room + 2])), [entry('c3', 3)]);
  assert.deepEqual(Online.Link.newEntries('junk', have, null), []);
});

test('validState refuses games that are not something the rules could have made', () => {
  const good = G.newGame({ seed: 9 });
  assert.ok(G.validState(good));
  const mutate = f => { const s = JSON.parse(JSON.stringify(good)); f(s); return s; };
  const bads = {
    'null': null, 'array': [], 'old version': mutate(s => { s.version = 1; }),
    'turn 0': mutate(s => { s.turn = 0; }), 'turn huge': mutate(s => { s.turn = 1e9; }),
    'three empires': mutate(s => { s.empires.length = 3; }),
    'nan credits': mutate(s => { s.empires[0].credits = null; }),
    'tech 99': mutate(s => { s.empires[0].tech = 99; }),
    'few worlds': mutate(s => { s.worlds.length = 5; }),
    'world type constructor': mutate(s => { s.worlds[0].type = 'constructor'; }),
    'garrison text': mutate(s => { s.worlds[3].garrison.scout = 'x'; }),
    'garrison negative': mutate(s => { s.worlds[3].garrison.scout = -4; }),
    'garrison missing': mutate(s => { delete s.worlds[3].garrison.frigate; }),
    'queue constructor': mutate(s => { s.worlds[0].queue = ['constructor']; }),
    'owner 9': mutate(s => { s.worlds[0].owner = 9; }),
    'bad difficulty': mutate(s => { s.difficulty = '__proto__'; }),
    'fleet to nowhere': mutate(s => { s.fleets.push({ owner: 1, to: 999, x: 0, y: 0, speed: 5, ships: { scout: 1, frigate: 0, cruiser: 0, transport: 0 } }); }),
    'huge world': mutate(s => { s.width = 1e9; }),
  };
  for (const [name, s] of Object.entries(bads)) assert.equal(G.validState(s), false, name);
});
