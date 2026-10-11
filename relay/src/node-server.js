// The same relay as a plain Node server (no dependencies): for local testing and for hosts like Fly.io.
// Rooms are kept in memory and saved to a JSON file (DATA_FILE, default ./relay-data.json) so a volume survives restarts.
import http from 'node:http';
import fs from 'node:fs';
import { handle, route, reply, tooMany } from './logic.js';
import { readLimits, Windows, gateCheck } from './limits.js';

const PORT = +process.env.PORT || 8787;
const DATA_FILE = process.env.DATA_FILE || './relay-data.json';
const TTL_MS = 1000 * 60 * 60 * 24 * 90;
const LIMITS = readLimits(process.env);
const windows = new Windows();
// Behind a proxy the real address is in a header. Fly sets Fly-Client-IP. Only trust the header if it is configured,
// otherwise anyone could claim to be anyone.
const IP_HEADER = (process.env.CLIENT_IP_HEADER || '').toLowerCase();
const clientIp = req => (IP_HEADER && req.headers[IP_HEADER]) || req.socket.remoteAddress || 'unknown';

// room creation counters live in memory with the rest (same shape as the Cloudflare Gate)
const gateRows = new Map();
const gateStore = { get: async k => gateRows.get(k), put: async (k, v) => { gateRows.set(k, v); } };
setInterval(() => { const day = Math.floor(Date.now() / 86400e3); for (const k of gateRows.keys()) if (k.startsWith('d:') && +k.slice(2) < day - 1) gateRows.delete(k); }, 3600e3).unref();

let rooms = new Map(); // room -> { rows: Map, touched }
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')))) rooms.set(k, { rows: new Map(Object.entries(v.rows)), touched: v.touched }); } catch (e) { /* first run */ }

let dirty = false;
function save() {
  if (!dirty) return;
  dirty = false;
  const out = {};
  for (const [k, v] of rooms) out[k] = { rows: Object.fromEntries(v.rows), touched: v.touched };
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, DATA_FILE);
}
setInterval(save, 2000).unref();
setInterval(() => { for (const [k, v] of rooms) if (Date.now() - v.touched > TTL_MS) { rooms.delete(k); dirty = true; } }, 3600e3).unref();

// one request at a time per room, so check-then-write is atomic like in a Durable Object
const queues = new Map();
function serialize(room, fn) {
  const prev = queues.get(room) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(room, next.catch(() => {}));
  return next;
}

function storeFor(room) {
  const r = () => { let x = rooms.get(room); if (!x) { x = { rows: new Map(), touched: Date.now() }; rooms.set(room, x); } return x; };
  return {
    get: async key => { const x = rooms.get(room); return x ? x.rows.get(key) : undefined; },
    getMany: async keys => { const x = rooms.get(room), o = {}; if (x) for (const k of keys) if (x.rows.has(k)) o[k] = x.rows.get(k); return o; },
    put: async (key, value) => { r().rows.set(key, value); dirty = true; },
    touch: async () => { r().touched = Date.now(); dirty = true; },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > LIMITS.body * 2) { res.writeHead(413, { 'access-control-allow-origin': '*' }).end(); return; } chunks.push(c); }
    const request = new Request('http://relay' + req.url, {
      method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const r = route(request);
    const ip = clientIp(req);
    let response = r.response;
    if (!response && req.method !== 'OPTIONS') {
      const hit = windows.hit('ip:' + ip, LIMITS.ipReqPerMin, 60000, Date.now());
      if (!hit.ok) response = tooMany(hit.retryAfter, 'rate_limited');
      else if (req.method === 'POST') {
        const g = await gateCheck(gateStore, ip, Date.now(), LIMITS);
        if (!g.ok) response = tooMany(g.retryAfter, g.reason);
      }
    }
    response = response || await serialize(r.room, () => handle(request, storeFor(r.room), r.room, { limits: LIMITS, windows }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    const response = reply({ ok: false, error: 'server_error' }, 500);
    res.writeHead(500, Object.fromEntries(response.headers)).end(await response.text());
  }
});
server.listen(PORT, () => console.log('relay listening on ' + PORT + (IP_HEADER ? ', client address from ' + IP_HEADER : '')));
process.on('SIGTERM', () => { save(); process.exit(0); });
