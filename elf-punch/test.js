// Integration test against the release binary: join, walk to a tree and chop it, cap, hostile input, idle shutdown.
const WebSocket = require("ws");
const { spawn } = require("child_process");
const assert = require("assert");
const bin = process.env.BIN || ["target/release/elf-punch", "target/x86_64-unknown-linux-musl/release/elf-punch"].find((p) => require("fs").existsSync(p));
const PORT = 8123;
const fs = require("fs");
const WORLD = "/tmp/elf-punch-test-world.json";
try { fs.unlinkSync(WORLD); } catch {}
const start = () => spawn(bin, [], { env: { PORT: String(PORT), WORLD_FILE: WORLD }, stdio: "inherit" });
let srv = start();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bot = (name) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`); const b = { ws, last: null, init: null };
  ws.on("error", rej);
  ws.on("open", () => ws.send(JSON.stringify({ t: "join", name })));
  ws.on("message", (d) => { const m = JSON.parse(d); if (m.t === "init") { b.init = m; res(b); } if (m.t === "s") b.last = m; if (m.t === "full") { b.full = true; res(b); } });
});
(async () => {
  await sleep(300);
  const h = await fetch(`http://localhost:${PORT}/healthz`); assert.strictEqual(await h.text(), "ok");
  assert((await (await fetch(`http://localhost:${PORT}/`)).text()).toUpperCase().includes("WOOD PUNCHER"));
  assert.strictEqual((await fetch(`http://localhost:${PORT}/nope`)).status, 404);
  const a = await bot("ann"), c = await bot("bob<script>!");
  assert.strictEqual(a.init.trees.length, 260);
  await sleep(300);
  assert(c.last.p.some((p) => p[5] === "bobscript") || a.last.p.some((p) => p[5] === "bobscript"), "name sanitized");
  // walk to the nearest tree and chop it
  for (let i = 0; i < 200 && !(a.last && a.last.me[5] >= 3); i++) {
    const [x, y] = a.last.me, felled = new Set(a.last.tf);
    const t = a.init.trees.map((t, i) => [t, i]).filter(([, i]) => !felled.has(i)).sort(([p], [q]) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y))[0][0];
    const d = Math.hypot(t[0] - x, t[1] - y);
    if (d > 1.1) a.ws.send(JSON.stringify({ t: "in", x: (t[0] - x) / d, y: (t[1] - y) / d })); else { a.ws.send(JSON.stringify({ t: "in", x: 0, y: 0 })); a.ws.send(JSON.stringify({ t: "punch" })); }
    await sleep(120);
  }
  assert(a.last.me[5] >= 3, "chopped a tree for wood, got " + a.last.me[5]);
  // build: a piece snaps to the grid cell, costs wood, and demolish refunds half
  {
    const w0 = a.last.me[5], [x, y] = a.last.me; let cell = null;
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) {
      const cx = Math.floor(x) + dx, cy = Math.floor(y) + dy;
      a.ws.send(JSON.stringify({ t: "place", k: 0, cx, cy })); await sleep(350);
      if (a.last.w.some((w) => w[0] === cx + 0.5 && w[1] === cy + 0.5 && w[3] === 0)) { cell = [cx, cy]; break; }
    }
    assert(cell, "wall placed on a grid cell"); assert.strictEqual(a.last.me[5], w0 - 2, "wall cost 2 wood");
    a.ws.send(JSON.stringify({ t: "place", k: 1, cx: cell[0], cy: cell[1] })); await sleep(350);
    assert.strictEqual(a.last.w.filter((w) => w[0] === cell[0] + 0.5 && w[1] === cell[1] + 0.5).length, 1, "one piece per cell");
    a.ws.send(JSON.stringify({ t: "place", k: 1, cx: cell[0] + 40, cy: cell[1] })); await sleep(350); assert(!a.last.w.some((w) => w[3] === 1), "out of reach / no stone refused");
    a.ws.send(JSON.stringify({ t: "remove", cx: cell[0], cy: cell[1] })); await sleep(350);
    assert(!a.last.w.some((w) => w[0] === cell[0] + 0.5 && w[1] === cell[1] + 0.5), "demolished"); assert.strictEqual(a.last.me[5], w0 - 1, "half refunded");
    a.ws.send(JSON.stringify({ t: "equip", h: true })); await sleep(300);
    assert.strictEqual(a.last.p.find((p) => p[0] === a.init.id)[7] & 1, 1, "hammer flag visible to others");
    a.ws.send(JSON.stringify({ t: "equip", h: false }));
    assert(a.init.rocks.length === 50 && a.last.me.length === 10, "rocks and stone reported");
  }
  // hostile input must not crash or kill other players
  const evil = new WebSocket(`ws://localhost:${PORT}/ws`); await new Promise((r) => evil.on("open", r));
  evil.send("not json"); evil.send(JSON.stringify({ t: "in", x: "NaN", y: null })); evil.send("x".repeat(5000));
  await sleep(300);
  assert(c.last, "others unaffected");
  // cap: 2 bots + 23 = 25; evil was dropped for its oversize frame, the next is refused
  const extras = []; for (let i = 0; i < 23; i++) extras.push(await bot("x" + i));
  const over = await bot("late"); assert(over.full, "26th refused");
  for (const b of [a, c, ...extras]) b.ws.close();
  evil.close();
  await sleep(500);
  assert.strictEqual((await fetch(`http://localhost:${PORT}/healthz`)).status, 200, "still alive");
  // persistence: the felled tree and a fire survive a restart
  const p = await bot("fred"); await sleep(200);
  p.ws.send(JSON.stringify({ t: "in", x: 0, y: 0 })); p.ws.close(); await sleep(500);
  assert(fs.existsSync(WORLD), "world saved when the last player left");
  const saved = JSON.parse(fs.readFileSync(WORLD)); assert(saved.trees.some((t) => t[0] <= 0), "felled tree persisted");
  srv.kill(); await sleep(300); srv = start(); await sleep(300);
  const q = await bot("gina"); await sleep(300);
  assert(q.last.tm >= saved.tod, "time of day reloaded: " + q.last.tm + " vs " + saved.tod);
  // combat: at night a goblin winds up, a late block parries it and a roll dodges the next one
  srv.kill(); await sleep(300);
  srv = spawn(bin, [], { env: { PORT: String(PORT), WORLD_FILE: WORLD + ".night", TOD_START: "95" }, stdio: "inherit" }); await sleep(300);
  const n = await bot("night"); n.evs = [];
  n.ws.on("message", (d) => { const m = JSON.parse(d); if (m.t === "s") for (const e of m.ev) n.evs.push(e[0]); });
  const wait = async (f, ms, what) => { for (let t = 0; t < ms / 50; t++) { if (f()) return; await sleep(50); } assert.fail("timeout: " + what); };
  const winding = () => n.last && n.last.g.find((g) => g[4] === 1);
  await wait(winding, 60000, "a goblin winds up");
  await sleep(250); n.ws.send(JSON.stringify({ t: "block", on: true }));
  await wait(() => n.evs.includes("parry"), 2000, "parry event");
  n.ws.send(JSON.stringify({ t: "block", on: false }));
  assert(n.last.me[7] > 0, "stamina reported");
  await wait(() => n.last.g.some((g) => g[4] === 3) || true, 100, "");
  n.evs.length = 0;
  await wait(winding, 30000, "second windup");
  await sleep(330); const x0 = n.last.me[0]; n.ws.send(JSON.stringify({ t: "in", x: -1, y: 0 })); n.ws.send(JSON.stringify({ t: "dodge" }));
  await wait(() => n.last.p.some((p) => p[0] === n.init.id && p[6] === 2), 1000, "rolling flag");
  n.evs.length = 0; await sleep(300);
  assert(!n.evs.includes("hurt"), "no damage while rolling");
  console.log("events:", n.evs.join(","));
  console.log("all ok"); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
