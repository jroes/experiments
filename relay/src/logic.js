// Relay logic: a tiny write-once message board per game room.
// Storage-agnostic. It runs inside a Cloudflare Durable Object (src/room.js) or a plain Node server (src/node-server.js).
//
// store interface (all async):
//   get(key) -> value | undefined
//   getMany(keys) -> { key: value } for keys that exist
//   put(key, value)
//   touch()                       // optional: called after every write, used to schedule expiry
//
// Rows in a room:
//   meta        { humans, seats: {n: sha256hex(token)}, created }
//   latest      highest turn that has any orders
//   count       number of rows written (abuse cap)
//   o:<t>:<s>   orders blob for turn t, seat s   ({code} or {skip:true, ai?:true})
//   h:<t>:<s>   state hash a player computed for the start of turn t
//
// Everything that writes is "first write wins". Within one room the store serializes requests, so the
// read-then-write below can't interleave with another request. Keep awaits that are not storage calls
// (hashing the token) BEFORE the first storage call so Durable Object input gates stay closed.

export const LIMITS = { body: 16384, turn: 5000, rows: 6000, range: 30, codeLen: 15000 };

const HEX64 = /^[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{8,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-seat',
  'access-control-max-age': '86400',
};

export function reply(obj, status = 200) {
  return new Response(obj === null ? null : JSON.stringify(obj), {
    status,
    headers: { ...CORS, ...(obj === null ? {} : { 'content-type': 'application/json' }), 'cache-control': 'no-store' },
  });
}
const fail = (status, error) => reply({ ok: false, error }, status);

export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const int = (s, lo, hi) => (/^\d{1,5}$/.test(String(s)) && +s >= lo && +s <= hi ? +s : null);

async function readJson(request) {
  const text = await request.text();
  if (text.length > LIMITS.body) return { error: 'too_big' };
  try {
    const v = text === '' ? {} : JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : { error: 'bad_json' };
  } catch (e) { return { error: 'bad_json' }; }
}

// what we are willing to store as orders: a code string, or a skip marker from the host
function normalizeOrders(v) {
  if (v.skip === true) {
    return v.ai === true ? { skip: true, ai: true } : { skip: true };
  }
  if (typeof v.code === 'string' && v.code.length > 0 && v.code.length <= LIMITS.codeLen && /^[A-Za-z0-9._-]+$/.test(v.code)) return { code: v.code };
  return null;
}

export async function handle(request, store, roomId) {
  if (request.method === 'OPTIONS') return reply(null, 204);

  const url = new URL(request.url);
  // /v1/rooms/<room>/<action...>
  const parts = url.pathname.split('/').filter(Boolean);
  const action = parts.slice(3);
  const m = request.method;

  // hash the presented token first (non-storage await), see note at top
  const presented = request.headers.get('x-seat');
  const presentedHash = presented && TOKEN.test(presented) ? await sha256hex(presented) : null;

  // ----- create -----
  if (m === 'POST' && action.length === 0) {
    const body = await readJson(request);
    if (body.error) return fail(400, body.error);
    const { humans, seats } = body.value;
    if (!Number.isInteger(humans) || humans < 2 || humans > 4) return fail(400, 'bad_humans');
    if (!seats || typeof seats !== 'object') return fail(400, 'bad_seats');
    const clean = {};
    for (let s = 1; s <= humans; s++) {
      if (typeof seats[s] !== 'string' || !HEX64.test(seats[s])) return fail(400, 'bad_seat_hash');
      clean[s] = seats[s];
    }
    if (await store.get('meta')) return fail(409, 'room_exists');
    await store.put('meta', { humans, seats: clean, created: Date.now() });
    await store.put('count', 1);
    if (store.touch) await store.touch();
    return reply({ ok: true }, 201);
  }

  const meta = await store.get('meta');
  if (!meta) return fail(404, 'no_such_room');

  const authedSeat = seat => presentedHash !== null && meta.seats[seat] === presentedHash;
  const validSeat = s => int(s, 1, meta.humans);

  // ----- read -----
  if (m === 'GET' && action[0] === 'meta') {
    return reply({ ok: true, humans: meta.humans, latest: (await store.get('latest')) || 0, created: meta.created });
  }

  if (m === 'GET' && action[0] === 'sync') {
    const t = int(action[1], 1, LIMITS.turn);
    if (t === null) return fail(400, 'bad_turn');
    const keys = [];
    for (let s = 1; s <= meta.humans; s++) keys.push('o:' + t + ':' + s, 'h:' + t + ':' + s);
    const got = await store.getMany(keys);
    const orders = {}, hashes = {};
    for (let s = 1; s <= meta.humans; s++) {
      if (got['o:' + t + ':' + s] !== undefined) orders[s] = got['o:' + t + ':' + s];
      if (got['h:' + t + ':' + s] !== undefined) hashes[s] = got['h:' + t + ':' + s];
    }
    return reply({ ok: true, humans: meta.humans, turn: t, latest: (await store.get('latest')) || 0, orders, hashes });
  }

  if (m === 'GET' && action[0] === 'orders') {
    const from = int(url.searchParams.get('from'), 1, LIMITS.turn), to = int(url.searchParams.get('to'), 1, LIMITS.turn);
    if (from === null || to === null || to < from || to - from + 1 > LIMITS.range) return fail(400, 'bad_range');
    const keys = [];
    for (let t = from; t <= to; t++) for (let s = 1; s <= meta.humans; s++) keys.push('o:' + t + ':' + s, 'h:' + t + ':' + s);
    const got = await store.getMany(keys);
    const orders = {}, hashes = {};
    for (let t = from; t <= to; t++) for (let s = 1; s <= meta.humans; s++) {
      const o = got['o:' + t + ':' + s], h = got['h:' + t + ':' + s];
      if (o !== undefined) (orders[t] = orders[t] || {})[s] = o;
      if (h !== undefined) (hashes[t] = hashes[t] || {})[s] = h;
    }
    return reply({ ok: true, humans: meta.humans, latest: (await store.get('latest')) || 0, orders, hashes });
  }

  // ----- write -----
  if (m === 'PUT' && ['orders', 'skip', 'hash'].includes(action[0])) {
    const t = int(action[1], 1, LIMITS.turn), s = validSeat(action[2]);
    if (t === null || s === null) return fail(400, 'bad_turn_or_seat');

    if (action[0] === 'skip') {
      if (!authedSeat(1)) return fail(403, 'host_only');
      if (s === 1) return fail(400, 'cannot_skip_host');
    } else if (!authedSeat(s)) return fail(403, 'bad_token');

    const body = await readJson(request);
    if (body.error) return fail(400, body.error);

    let key, value;
    if (action[0] === 'hash') {
      if (typeof body.value.h !== 'string' || !HASH.test(body.value.h)) return fail(400, 'bad_hash');
      key = 'h:' + t + ':' + s; value = body.value.h;
    } else {
      value = action[0] === 'skip' ? (body.value.ai === true ? { skip: true, ai: true } : { skip: true }) : normalizeOrders(body.value);
      if (!value) return fail(400, 'bad_orders');
      key = 'o:' + t + ':' + s;
    }

    // From here only storage awaits: the check and the write can't be interleaved with another request.
    if (action[0] !== 'hash' && t > 1) {
      const prev = [];
      for (let q = 1; q <= meta.humans; q++) prev.push('o:' + (t - 1) + ':' + q);
      const got = await store.getMany(prev);
      if (!Object.keys(got).length) return fail(409, 'turn_not_open');
    }
    const existing = await store.get(key);
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(value)) return reply({ ok: true, existing: true });
      return reply({ ok: false, error: 'already_set', value: existing }, 409);
    }
    const count = (await store.get('count')) || 0;
    if (count >= LIMITS.rows) return fail(429, 'room_full');
    await store.put(key, value);
    await store.put('count', count + 1);
    if (action[0] !== 'hash') {
      const latest = (await store.get('latest')) || 0;
      if (t > latest) await store.put('latest', t);
    }
    if (store.touch) await store.touch();
    return reply({ ok: true }, 201);
  }

  return fail(404, 'not_found');
}

// route /v1/rooms/<room>/... and /v1/health. Returns { room } for the caller to dispatch on, or a Response.
export const ROOM_RE = /^[a-z0-9]{12,32}$/;
export function route(request) {
  if (request.method === 'OPTIONS') return { response: reply(null, 204) };
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts[0] === 'v1' && parts[1] === 'health') return { response: reply({ ok: true, v: 1 }) };
  if (parts[0] === 'v1' && parts[1] === 'rooms' && ROOM_RE.test(parts[2] || '')) return { room: parts[2] };
  return { response: fail(404, 'not_found') };
}
