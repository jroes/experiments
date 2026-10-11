// The same relay as a plain Node server (no dependencies): for local testing and for hosts like Fly.io.
// Rooms are kept in memory and saved to a JSON file (DATA_FILE, default ./relay-data.json) so a volume survives restarts.
import http from 'node:http';
import fs from 'node:fs';
import { handle, route, reply } from './logic.js';

const PORT = +process.env.PORT || 8787;
const DATA_FILE = process.env.DATA_FILE || './relay-data.json';
const TTL_MS = 1000 * 60 * 60 * 24 * 90;

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
    for await (const c of req) { size += c.length; if (size > 40000) { res.writeHead(413).end(); return; } chunks.push(c); }
    const request = new Request('http://relay' + req.url, {
      method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const r = route(request);
    const response = r.response || await serialize(r.room, () => handle(request, storeFor(r.room), r.room));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    const response = reply({ ok: false, error: 'server_error' }, 500);
    res.writeHead(500, Object.fromEntries(response.headers)).end(await response.text());
  }
});
server.listen(PORT, () => console.log('relay listening on ' + PORT));
process.on('SIGTERM', () => { save(); process.exit(0); });
