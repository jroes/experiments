// Rate and size limits for the relay. Every number can be overridden with an environment variable
// (Cloudflare: [vars] in wrangler.toml or the dashboard; Node/Fly: process env), so you can tune without code changes.

export const DEFAULT_LIMITS = {
  // size
  body: 8192,          // bytes accepted in one request body
  codeLen: 8000,       // characters in one orders code (about 100 orders)
  rows: 4000,          // rows per room
  bytes: 1000000,      // stored bytes per room
  turn: 5000,          // highest turn number
  range: 30,           // turns returned by one range read
  // rate
  roomReqPerMin: 240,      // all requests to one room
  roomWritesPerMin: 90,    // writes to one room
  ipReqPerMin: 240,        // all requests from one address (Node server, and Cloudflare if the RL binding is set)
  ipCreatePerHour: 6,      // new rooms per address per hour
  globalCreatePerDay: 300, // new rooms per day, all addresses: protects a free quota
};

const ENV_NAMES = {
  body: 'RELAY_BODY_MAX', codeLen: 'RELAY_CODE_MAX', rows: 'RELAY_ROOM_ROWS', bytes: 'RELAY_ROOM_BYTES',
  turn: 'RELAY_TURN_MAX', range: 'RELAY_RANGE_MAX', roomReqPerMin: 'RELAY_ROOM_REQ_PER_MIN',
  roomWritesPerMin: 'RELAY_ROOM_WRITES_PER_MIN', ipReqPerMin: 'RELAY_IP_REQ_PER_MIN',
  ipCreatePerHour: 'RELAY_IP_CREATE_PER_HOUR', globalCreatePerDay: 'RELAY_GLOBAL_CREATE_PER_DAY',
};

export function readLimits(env) {
  const out = { ...DEFAULT_LIMITS };
  if (!env) return out;
  for (const [k, name] of Object.entries(ENV_NAMES)) {
    const raw = env[name];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
  }
  return out;
}

// Fixed-window counters. Cheap, in memory, good enough for abuse control (a burst up to 2x at a window edge is fine).
export class Windows {
  constructor() { this.map = new Map(); }
  hit(key, limit, windowMs, now) {
    const slot = Math.floor(now / windowMs), e = this.map.get(key);
    if (!e || e.slot !== slot) {
      this.map.set(key, { slot, n: 1, windowMs });
      if (this.map.size > 5000) this.prune(now);
      return { ok: true };
    }
    if (e.n >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil(((slot + 1) * windowMs - now) / 1000)) };
    e.n++;
    return { ok: true };
  }
  prune(now) {
    for (const [k, e] of this.map) if (Math.floor(now / e.windowMs) !== e.slot) this.map.delete(k);
  }
}

async function sha16(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Counts room creations per address per hour and per day in total. store: { get, put } (a Durable Object's storage).
// Addresses are hashed before they are stored.
export async function gateCheck(store, ip, now, limits) {
  const hour = Math.floor(now / 3600e3), day = Math.floor(now / 86400e3);
  const ipKey = 'c:' + (await sha16(String(ip))) + ':' + hour, dayKey = 'd:' + day;
  const ipN = (await store.get(ipKey)) || 0, dayN = (await store.get(dayKey)) || 0;
  if (ipN >= limits.ipCreatePerHour) return { ok: false, reason: 'too_many_rooms_from_your_address', retryAfter: Math.max(1, 3600 - Math.floor(now / 1000) % 3600) };
  if (dayN >= limits.globalCreatePerDay) return { ok: false, reason: 'daily_room_limit', retryAfter: Math.max(1, 86400 - Math.floor(now / 1000) % 86400) };
  await store.put(ipKey, ipN + 1);
  await store.put(dayKey, dayN + 1);
  return { ok: true };
}
