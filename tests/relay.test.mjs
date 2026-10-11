import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, route, sha256hex, LIMITS } from '../relay/src/logic.js';
import { DEFAULT_LIMITS, readLimits, Windows, gateCheck } from '../relay/src/limits.js';

// most tests are about rules, not rates, so they run with limits that never trigger
const OPEN = { limits: { ...LIMITS, roomReqPerMin: 1e9, roomWritesPerMin: 1e9 } };

// in-memory store with the same interface the Durable Object and Node server provide
function memStore() {
  const rows = new Map();
  return {
    rows,
    get: async k => rows.get(k),
    getMany: async keys => Object.fromEntries(keys.filter(k => rows.has(k)).map(k => [k, rows.get(k)])),
    put: async (k, v) => { rows.set(k, JSON.parse(JSON.stringify(v))); },
    touch: async () => {},
  };
}

const ROOM = 'abcdefghij12';
async function call(store, method, path, { body, token, opts = OPEN } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-seat'] = token;
  const req = new Request('http://relay/v1/rooms/' + ROOM + path, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const res = await handle(req, store, ROOM, { ...opts, windows: opts.windows || new Windows() });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

const tokens = { 1: 'tokentokentoken1A', 2: 'tokentokentoken2B', 3: 'tokentokentoken3C' };
async function newRoom(humans = 3) {
  const store = memStore(), seats = {};
  for (let s = 1; s <= humans; s++) seats[s] = await sha256hex(tokens[s]);
  const r = await call(store, 'POST', '', { body: { humans, seats } });
  assert.equal(r.status, 201);
  return store;
}
const ord = (code = 'SDO1.abc') => ({ code });

test('create: validates input and refuses a second create', async () => {
  const store = memStore();
  assert.equal((await call(store, 'POST', '', { body: { humans: 9, seats: {} } })).status, 400);
  assert.equal((await call(store, 'POST', '', { body: { humans: 2, seats: { 1: 'x', 2: 'y' } } })).status, 400);
  assert.equal((await call(store, 'POST', '', { body: 'not json' })).status, 400);
  const s2 = await newRoom();
  const again = await call(s2, 'POST', '', { body: { humans: 2, seats: { 1: 'a'.repeat(64), 2: 'b'.repeat(64) } } });
  assert.equal(again.status, 409);
});

test('unknown room is 404, bad paths are 404', async () => {
  assert.equal((await call(memStore(), 'GET', '/meta')).status, 404);
  const s = await newRoom();
  assert.equal((await call(s, 'GET', '/nonsense')).status, 404);
  assert.equal((await call(s, 'DELETE', '/orders/1/1', { token: tokens[1] })).status, 404);
});

test('orders: needs the right seat token', async () => {
  const s = await newRoom();
  assert.equal((await call(s, 'PUT', '/orders/1/2', { body: ord() })).status, 403);
  assert.equal((await call(s, 'PUT', '/orders/1/2', { body: ord(), token: tokens[1] })).status, 403, 'seat 1 token must not write seat 2');
  assert.equal((await call(s, 'PUT', '/orders/1/2', { body: ord(), token: 'tokentokentoken9Z' })).status, 403);
  assert.equal((await call(s, 'PUT', '/orders/1/2', { body: ord(), token: 'short' })).status, 403);
  assert.equal((await call(s, 'PUT', '/orders/1/2', { body: ord(), token: tokens[2] })).status, 201);
});

test('orders: first write wins, identical retry is fine, different write is refused', async () => {
  const s = await newRoom();
  assert.equal((await call(s, 'PUT', '/orders/1/1', { body: ord('SDO1.one'), token: tokens[1] })).status, 201);
  const retry = await call(s, 'PUT', '/orders/1/1', { body: ord('SDO1.one'), token: tokens[1] });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.existing, true);
  const other = await call(s, 'PUT', '/orders/1/1', { body: ord('SDO1.two'), token: tokens[1] });
  assert.equal(other.status, 409);
  assert.deepEqual(other.data.value, { code: 'SDO1.one' });
});

test('orders: junk is refused and unknown keys are not stored', async () => {
  const s = await newRoom();
  for (const body of [{}, { code: '' }, { code: 5 }, { code: 'has space' }, { code: 'x'.repeat(LIMITS.codeLen + 1) }, { skip: false }, []]) {
    assert.equal((await call(s, 'PUT', '/orders/1/1', { body, token: tokens[1] })).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await call(s, 'PUT', '/orders/1/1', { body: 'x'.repeat(LIMITS.body + 1), token: tokens[1] })).status, 413);
  const ok = await call(s, 'PUT', '/orders/1/1', { body: { code: 'SDO1.ok', evil: '<script>', skip: false }, token: tokens[1] });
  assert.equal(ok.status, 201);
  const got = await call(s, 'GET', '/sync/1');
  assert.deepEqual(got.data.orders[1], { code: 'SDO1.ok' });
});

test('bad turns and seats', async () => {
  const s = await newRoom(2);
  for (const p of ['/orders/0/1', '/orders/1/0', '/orders/1/3', '/orders/abc/1', '/orders/99999/1', '/orders/1/1.5', '/orders/-1/1']) {
    assert.equal((await call(s, 'PUT', p, { body: ord(), token: tokens[1] })).status, 400, p);
  }
});

test('a turn only opens after the previous one has orders', async () => {
  const s = await newRoom();
  assert.equal((await call(s, 'PUT', '/orders/2/1', { body: ord(), token: tokens[1] })).status, 409);
  await call(s, 'PUT', '/orders/1/1', { body: ord(), token: tokens[1] });
  assert.equal((await call(s, 'PUT', '/orders/2/1', { body: ord(), token: tokens[1] })).status, 201);
  assert.equal((await call(s, 'PUT', '/orders/4/1', { body: ord(), token: tokens[1] })).status, 409, 'cannot jump ahead');
});

test('skip: only the host, never the host seat, first write wins against the real orders', async () => {
  const s = await newRoom();
  assert.equal((await call(s, 'PUT', '/skip/1/2', { token: tokens[2] })).status, 403, 'a player cannot skip another');
  assert.equal((await call(s, 'PUT', '/skip/1/1', { token: tokens[1] })).status, 400, 'host cannot skip themself');
  assert.equal((await call(s, 'PUT', '/skip/1/2', { token: tokens[1] })).status, 201);
  const late = await call(s, 'PUT', '/orders/1/2', { body: ord(), token: tokens[2] });
  assert.equal(late.status, 409, 'late orders lose to the skip');
  assert.deepEqual(late.data.value, { skip: true });
  // and the other way round
  await call(s, 'PUT', '/orders/1/3', { body: ord('SDO1.x'), token: tokens[3] });
  assert.equal((await call(s, 'PUT', '/skip/1/3', { token: tokens[1] })).status, 409);
  assert.equal((await call(s, 'PUT', '/skip/3/2', { token: tokens[1] })).status, 409, 'turn 3 is not open yet');
});

test('skip with ai flag is stored as such', async () => {
  const s = await newRoom();
  await call(s, 'PUT', '/orders/1/1', { body: ord(), token: tokens[1] });
  await call(s, 'PUT', '/orders/2/1', { body: ord(), token: tokens[1] });
  assert.equal((await call(s, 'PUT', '/skip/2/2', { body: { ai: true, junk: 1 }, token: tokens[1] })).status, 201);
  assert.deepEqual((await call(s, 'GET', '/sync/2')).data.orders[2], { skip: true, ai: true });
});

test('hash: owner only, write once, format checked', async () => {
  const s = await newRoom();
  assert.equal((await call(s, 'PUT', '/hash/1/2', { body: { h: 'deadbeefdeadbeef' }, token: tokens[1] })).status, 403);
  assert.equal((await call(s, 'PUT', '/hash/1/2', { body: { h: 'ZZ' }, token: tokens[2] })).status, 400);
  assert.equal((await call(s, 'PUT', '/hash/1/2', { body: { h: 'deadbeefdeadbeef' }, token: tokens[2] })).status, 201);
  assert.equal((await call(s, 'PUT', '/hash/1/2', { body: { h: 'deadbeefdeadbeef' }, token: tokens[2] })).status, 200);
  assert.equal((await call(s, 'PUT', '/hash/1/2', { body: { h: 'aaaaaaaaaaaaaaaa' }, token: tokens[2] })).status, 409);
  assert.deepEqual((await call(s, 'GET', '/sync/1')).data.hashes, { 2: 'deadbeefdeadbeef' });
});

test('sync and range reads', async () => {
  const s = await newRoom();
  for (let t = 1; t <= 5; t++) {
    await call(s, 'PUT', '/orders/' + t + '/1', { body: ord('SDO1.t' + t), token: tokens[1] });
    await call(s, 'PUT', '/orders/' + t + '/2', { body: ord('SDO1.u' + t), token: tokens[2] });
  }
  const sync = await call(s, 'GET', '/sync/3');
  assert.equal(sync.data.latest, 5);
  assert.deepEqual(sync.data.orders, { 1: { code: 'SDO1.t3' }, 2: { code: 'SDO1.u3' } });
  const range = await call(s, 'GET', '/orders?from=2&to=4');
  assert.deepEqual(Object.keys(range.data.orders), ['2', '3', '4']);
  assert.equal((await call(s, 'GET', '/orders?from=1&to=' + (LIMITS.range + 1))).status, 400);
  assert.equal((await call(s, 'GET', '/orders?from=4&to=2')).status, 400);
  assert.equal((await call(s, 'GET', '/orders')).status, 400);
  assert.equal((await call(s, 'GET', '/meta')).data.latest, 5);
});

test('rooms stop growing at the row cap', async () => {
  const s = await newRoom(2);
  s.rows.set('count', LIMITS.rows);
  assert.equal((await call(s, 'PUT', '/orders/1/1', { body: ord(), token: tokens[1] })).status, 429);
});

test('CORS preflight and headers', async () => {
  const s = await newRoom();
  const pre = await handle(new Request('http://relay/v1/rooms/' + ROOM + '/orders/1/1', { method: 'OPTIONS' }), s, ROOM, OPEN);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-headers'), /x-seat/);
  const g = await call(s, 'GET', '/meta');
  assert.equal(g.headers.get('access-control-allow-origin'), '*');
  assert.equal(g.headers.get('cache-control'), 'no-store');
});

test('routing: health, room id shape', async () => {
  const h = route(new Request('http://relay/v1/health'));
  assert.equal(h.response.status, 200);
  assert.equal(route(new Request('http://relay/v1/rooms/AB')).response.status, 404);
  assert.equal(route(new Request('http://relay/v1/rooms/UPPERCASEROOM1')).response.status, 404);
  assert.equal(route(new Request('http://relay/other')).response.status, 404);
  assert.equal(route(new Request('http://relay/v1/rooms/abcdefghij12/meta')).room, 'abcdefghij12');
});

test('concurrent writers to one key: exactly one wins', async () => {
  const s = await newRoom();
  await call(s, 'PUT', '/orders/1/1', { body: ord(), token: tokens[1] });
  // the memory store is single-threaded like a Durable Object, but still interleaves at awaits
  const results = await Promise.all([
    call(s, 'PUT', '/skip/1/2', { token: tokens[1] }),
    call(s, 'PUT', '/orders/1/2', { body: ord('SDO1.late'), token: tokens[2] }),
  ]);
  const wins = results.filter(r => r.status === 201).length;
  assert.equal(wins, 1, 'both writers won: ' + results.map(r => r.status));
  const final = (await call(s, 'GET', '/sync/1')).data.orders[2];
  const winner = results.find(r => r.status === 201);
  assert.ok(winner);
  assert.ok(final.skip === true || final.code === 'SDO1.late');
});


// ---------- limits ----------

const T0 = 1_800_000_000_000;
const tight = over => ({ limits: { ...LIMITS, ...over }, windows: new Windows(), now: T0 });

test('limits: defaults are sane and overridable from the environment', () => {
  assert.deepEqual(readLimits({}), DEFAULT_LIMITS);
  assert.equal(readLimits({ RELAY_ROOM_REQ_PER_MIN: '5' }).roomReqPerMin, 5);
  assert.equal(readLimits({ RELAY_ROOM_REQ_PER_MIN: 'abc' }).roomReqPerMin, DEFAULT_LIMITS.roomReqPerMin, 'junk falls back');
  assert.equal(readLimits({ RELAY_ROOM_REQ_PER_MIN: '-4' }).roomReqPerMin, DEFAULT_LIMITS.roomReqPerMin);
  assert.equal(readLimits({ RELAY_ROOM_REQ_PER_MIN: '0' }).roomReqPerMin, DEFAULT_LIMITS.roomReqPerMin);
  assert.equal(readLimits({ RELAY_BODY_MAX: '1024.9' }).body, 1024);
  assert.equal(readLimits(undefined).body, DEFAULT_LIMITS.body);
});

test('limits: a flood on one room is stopped with 429 and Retry-After, then recovers next minute', async () => {
  const s = await newRoom();
  const opts = tight({ roomReqPerMin: 5 });
  for (let i = 0; i < 5; i++) assert.equal((await call(s, 'GET', '/meta', { opts })).status, 200, 'request ' + i);
  const r = await call(s, 'GET', '/meta', { opts });
  assert.equal(r.status, 429);
  assert.equal(r.data.error, 'room_rate_limited');
  assert.ok(+r.headers.get('retry-after') >= 1 && +r.headers.get('retry-after') <= 60);
  assert.match(r.headers.get('access-control-expose-headers'), /retry-after/i, 'browsers must be able to read Retry-After');
  opts.now = T0 + 61_000;
  assert.equal((await call(s, 'GET', '/meta', { opts })).status, 200);
});

test('limits: writes have their own, lower limit and reads are unaffected by it', async () => {
  const s = await newRoom();
  const opts = tight({ roomWritesPerMin: 3 });
  let t = 1;
  for (let i = 0; i < 3; i++) {
    assert.equal((await call(s, 'PUT', '/hash/' + t + '/1', { body: { h: 'a'.repeat(16) }, token: tokens[1], opts })).status, 201);
    t++;
  }
  const blocked = await call(s, 'PUT', '/hash/9/1', { body: { h: 'a'.repeat(16) }, token: tokens[1], opts });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error, 'room_write_rate_limited');
  assert.equal((await call(s, 'GET', '/meta', { opts })).status, 200);
});

test('limits: rooms are limited separately', async () => {
  const opts = tight({ roomReqPerMin: 2 });
  const a = await newRoom(), b = await newRoom();
  const req = (store, room) => handle(new Request('http://relay/v1/rooms/' + room + '/meta'), store, room, opts);
  assert.equal((await req(a, 'aaaaaaaaaaaa')).status, 200);
  assert.equal((await req(a, 'aaaaaaaaaaaa')).status, 200);
  assert.equal((await req(a, 'aaaaaaaaaaaa')).status, 429);
  assert.equal((await req(b, 'bbbbbbbbbbbb')).status, 200, 'a busy room must not slow another');
});

test('limits: body size is checked from the header before reading, and again after', async () => {
  const s = await newRoom();
  const big = 'x'.repeat(DEFAULT_LIMITS.body + 10);
  const lie = new Request('http://relay/v1/rooms/' + ROOM + '/orders/1/1', { method: 'PUT', headers: { 'content-length': String(big.length), 'x-seat': tokens[1] }, body: big });
  assert.equal((await handle(lie, s, ROOM, OPEN)).status, 413);
  // multi-byte characters count as bytes, not characters
  const wide = JSON.stringify({ code: 'SDO1.' + 'a'.repeat(10), pad: 'é'.repeat(DEFAULT_LIMITS.body / 2 + 1) });
  assert.equal((await call(s, 'PUT', '/orders/1/1', { body: wide, token: tokens[1] })).status, 413);
  assert.equal((await call(s, 'PUT', '/orders/1/1', { body: { code: 'a'.repeat(DEFAULT_LIMITS.codeLen) }, token: tokens[1] })).status, 201);
});

test('limits: a room stops accepting writes at the byte cap', async () => {
  const s = await newRoom(2);
  const opts = tight({ bytes: 400, roomWritesPerMin: 1e9, roomReqPerMin: 1e9 });
  const big = { code: 'a'.repeat(300) };
  assert.equal((await call(s, 'PUT', '/orders/1/1', { body: big, token: tokens[1], opts })).status, 201);
  const second = await call(s, 'PUT', '/orders/1/2', { body: big, token: tokens[2], opts });
  assert.equal(second.status, 429);
  assert.equal(second.data.error, 'room_full');
  // reads still work, and a repeat of an accepted write is still fine
  assert.equal((await call(s, 'GET', '/sync/1', { opts })).status, 200);
  assert.equal((await call(s, 'PUT', '/orders/1/1', { body: big, token: tokens[1], opts })).status, 200);
});

test('limits: turn and range maximums come from the limits', async () => {
  const s = await newRoom();
  const opts = tight({ turn: 3, range: 2, roomReqPerMin: 1e9, roomWritesPerMin: 1e9 });
  assert.equal((await call(s, 'GET', '/sync/4', { opts })).status, 400);
  assert.equal((await call(s, 'GET', '/orders?from=1&to=3', { opts })).status, 400);
  assert.equal((await call(s, 'GET', '/orders?from=1&to=2', { opts })).status, 200);
});

test('gate: room creation is limited per address per hour and per day overall', async () => {
  const rows = new Map(), store = { get: async k => rows.get(k), put: async (k, v) => { rows.set(k, v); } };
  const L = { ...LIMITS, ipCreatePerHour: 2, globalCreatePerDay: 4 };
  assert.equal((await gateCheck(store, '1.1.1.1', T0, L)).ok, true);
  assert.equal((await gateCheck(store, '1.1.1.1', T0 + 1000, L)).ok, true);
  const third = await gateCheck(store, '1.1.1.1', T0 + 2000, L);
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'too_many_rooms_from_your_address');
  assert.ok(third.retryAfter >= 1 && third.retryAfter <= 3600);
  assert.equal((await gateCheck(store, '2.2.2.2', T0 + 3000, L)).ok, true, 'other addresses are separate');
  assert.equal((await gateCheck(store, '2.2.2.2', T0 + 4000, L)).ok, true);
  const day = await gateCheck(store, '3.3.3.3', T0 + 5000, L);
  assert.equal(day.ok, false, 'the daily total applies to everyone');
  assert.equal(day.reason, 'daily_room_limit');
  assert.equal((await gateCheck(store, '1.1.1.1', T0 + 3600e3 + 10, L)).ok, false, 'the day cap still holds in the next hour');
  assert.equal((await gateCheck(store, '1.1.1.1', T0 + 86400e3 + 10, L)).ok, true, 'a new day starts fresh');
  for (const k of rows.keys()) assert.ok(!k.includes('1.1.1.1'), 'addresses are stored hashed');
});

test('windows: counters reset each window and do not grow without bound', () => {
  const w = new Windows();
  for (let i = 0; i < 3; i++) assert.equal(w.hit('k', 3, 1000, 5000).ok, true);
  assert.equal(w.hit('k', 3, 1000, 5500).ok, false);
  assert.equal(w.hit('k', 3, 1000, 6000).ok, true);
  for (let i = 0; i < 6000; i++) w.hit('spam' + i, 1, 1000, 10_000);
  w.hit('later', 1, 1000, 20_000);
  assert.ok(w.map.size < 6001, 'old windows are pruned');
});
