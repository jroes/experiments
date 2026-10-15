// Integration test for the Jetfall relay (/jetfall) against the release binary: node test-relay.js after `cargo build --release`.
const { spawn } = require("child_process");
const assert = require("assert");
const WebSocket = require("ws");
const bin = process.env.BIN || "target/release/elf-punch";
const PORT = 8126, PORT2 = 8127;
const base = { WORLD_FILE: "/tmp/elf-punch-test-relay-world.json", KV_DIR: "/tmp/elf-punch-test-relay-kv", LAB_DIR: "/tmp/elf-punch-test-relay-lab" };
const srvs = [spawn(bin, [], { env: { ...base, PORT: String(PORT), JF_ROOM_MAX: "3", JF_ROOMS: "8" }, stdio: "inherit" })];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A client that queues what it receives: text as parsed JSON, binary as { from, data }.
function client(port = PORT) {
  const ws = new WebSocket(`ws://localhost:${port}/jetfall`);
  const c = { ws, q: [], waiters: [], code: null };
  ws.on("message", (d, isBin) => {
    const m = isBin ? { bin: true, from: d.readUInt16BE(0), data: d.subarray(2) } : JSON.parse(d.toString());
    c.q.push(m);
    c.waiters.slice().forEach((w) => w());
  });
  c.closed = new Promise((r) => ws.on("close", (code) => { c.code = code; r(code); }));
  ws.on("error", () => {});
  c.open = new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.bin = (to, bytes) => { const b = Buffer.alloc(2 + bytes.length); b.writeUInt16BE(to, 0); Buffer.from(bytes).copy(b, 2); ws.send(b); };
  c.next = (pred = () => true, ms = 2000) => new Promise((res, rej) => {
    const look = () => {
      const i = c.q.findIndex((m) => (typeof pred === "string" ? m.t === pred : pred(m)));
      if (i < 0) return false;
      const [m] = c.q.splice(i, 1);
      c.waiters = c.waiters.filter((w) => w !== look2); clearTimeout(t); res(m); return true;
    };
    const look2 = () => look();
    const t = setTimeout(() => { c.waiters = c.waiters.filter((w) => w !== look2); rej(new Error("timeout waiting for " + pred)); }, ms);
    if (!look()) c.waiters.push(look2);
  });
  c.none = async (pred, ms = 300) => {
    await sleep(ms);
    const hit = c.q.find((m) => (typeof pred === "string" ? m.t === pred : pred(m)));
    assert(!hit, "did not expect " + JSON.stringify(hit));
  };
  return c;
}
async function host(name, info, port) {
  const h = client(port); await h.open;
  h.send({ t: "host", name, info });
  const m = await h.next("hosted");
  assert.strictEqual(m.id, 0);
  assert.match(m.room, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  h.room = m.room;
  return h;
}
async function join(h, name, code = h.room) {
  const g = client(); await g.open;
  g.send({ t: "join", room: code, name });
  const m = await g.next((x) => x.t === "joined" || x.t === "error");
  if (m.t === "error") { g.err = m.why; return g; }
  g.id = m.id;
  assert.strictEqual(m.room, h.room);
  const p = await h.next((x) => x.t === "peer" && x.id === g.id);
  g.peerName = p.name;
  return g;
}

(async () => {
  await sleep(300);
  const h = await host("  Night \u0007 Fight  ", { public: true, map: "dock" });
  // join with a lower-case code; names are cleaned
  const a = await join(h, "ann", h.room.toLowerCase());
  assert.strictEqual(a.id, 1);
  const b = await join(h, "x".repeat(40));
  assert.strictEqual(b.id, 2);
  assert.strictEqual(b.peerName, "x".repeat(24));
  const blank = await join(h, " \n ");
  assert.strictEqual(blank.peerName, "player");

  // room full (JF_ROOM_MAX=3), bad code
  const full = await join(h, "late");
  assert.strictEqual(full.err, "full");
  const lost = await join(h, "who", "ZZZZZZ");
  assert.strictEqual(lost.err, "no-room");
  // a connection hosts or joins once
  a.send({ t: "host", name: "again" });
  assert.strictEqual((await a.next("error")).why, "already");

  // ping
  a.send({ t: "ping" });
  await a.next("pong");
  // junk is ignored
  a.ws.send("{nope"); a.send({ t: "what" }); a.send([1, 2]);
  a.send({ t: "ping" }); await a.next("pong");

  // signaling both ways; guests can only reach the host
  a.send({ t: "sig", to: 0, d: { sdp: "offer-from-a" } });
  let s = await h.next("sig");
  assert.deepStrictEqual(s, { t: "sig", from: 1, d: { sdp: "offer-from-a" } });
  h.send({ t: "sig", to: 1, d: { sdp: "answer" } });
  s = await a.next("sig");
  assert.deepStrictEqual(s, { t: "sig", from: 0, d: { sdp: "answer" } });
  a.send({ t: "sig", to: 2, d: "sneaky" });
  await b.none("sig");
  await h.none("sig", 0);

  // binary: host -> one guest, guest -> host, broadcast, guest -> guest dropped
  h.bin(2, [1, 2, 3]);
  let m = await b.next((x) => x.bin);
  assert.strictEqual(m.from, 0); assert.deepStrictEqual([...m.data], [1, 2, 3]);
  await a.none((x) => x.bin, 100);
  a.bin(0, [9, 9]);
  m = await h.next((x) => x.bin);
  assert.strictEqual(m.from, 1); assert.deepStrictEqual([...m.data], [9, 9]);
  h.bin(0xffff, [42]);
  for (const g of [a, b, blank]) { m = await g.next((x) => x.bin); assert.strictEqual(m.from, 0); assert.deepStrictEqual([...m.data], [42]); }
  a.bin(2, [7]);
  a.bin(0xffff, [7]);
  h.bin(77, [7]);
  await b.none((x) => x.bin);
  await h.none((x) => x.bin, 0);
  // a big binary frame (just under 64 KB) goes through
  const bigPayload = Buffer.alloc(65000, 5);
  h.bin(1, bigPayload);
  m = await a.next((x) => x.bin);
  assert.strictEqual(m.data.length, 65000);

  // list shows public rooms with guest counts; private rooms stay out
  const priv = await host("secret", { public: false });
  const lister = client(); await lister.open;
  lister.send({ t: "list" });
  let rooms = (await lister.next("rooms")).rooms;
  let mine = rooms.find((r) => r.room === h.room);
  assert.deepStrictEqual(mine, { room: h.room, name: "Night  Fight", info: { public: true, map: "dock" }, n: 3 });
  assert(!rooms.some((r) => r.room === priv.room));
  // info update: host only, object of at most 600 bytes
  h.send({ t: "info", info: { public: true, map: "yard", score: [3, 1] } });
  h.send({ t: "info", info: { public: true, junk: "x".repeat(700) } });
  assert.strictEqual((await h.next("error")).why, "bad-info");
  a.send({ t: "info", info: { public: false } });
  priv.send({ t: "info", info: { public: true } });
  await sleep(100);
  lister.send({ t: "list" });
  rooms = (await lister.next("rooms")).rooms;
  mine = rooms.find((r) => r.room === h.room);
  assert.deepStrictEqual(mine.info, { public: true, map: "yard", score: [3, 1] });
  assert(rooms.some((r) => r.room === priv.room && r.n === 0 && r.name === "secret"));

  // kick: the guest is told, then closed; the host gets "left"
  h.send({ t: "kick", id: 3 });
  assert.strictEqual((await blank.next("error")).why, "kicked");
  await blank.closed;
  assert.strictEqual((await h.next("left")).id, 3);
  // a guest can't kick
  a.send({ t: "kick", id: 2 });
  await b.none((x) => x.t === "error");

  // ids are never reused within a room
  const c = await join(h, "cat");
  assert.strictEqual(c.id, 4);

  // a guest leaving tells the host
  c.ws.close();
  assert.strictEqual((await h.next("left")).id, 4);

  // latency: 200 round trips host -> guest -> host
  b.ws.on("message", (d, isBin) => { if (isBin) b.bin(0, d.subarray(2)); });
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) {
    h.bin(2, [i & 255, 1, 2, 3, 4, 5, 6, 7]);
    const r = await h.next((x) => x.bin);
    assert.strictEqual(r.from, 2); assert.strictEqual(r.data[0], i & 255);
  }
  const took = Date.now() - t0;
  console.log(`relay: 200 round trips in ${took} ms`);
  assert(took < 2000, "round trips too slow: " + took);
  b.ws.removeAllListeners("message");
  b.ws.on("message", (d, isBin) => { b.q.push(isBin ? { bin: true, from: d.readUInt16BE(0), data: d.subarray(2) } : JSON.parse(d.toString())); b.waiters.slice().forEach((w) => w()); });

  // guest rate limit: a burst of 1000 is cut to about one second's worth, and the guest stays connected
  await sleep(1100);
  b.q.length = 0; h.q.length = 0;
  for (let i = 0; i < 1000; i++) b.bin(0, [1]);
  await sleep(500);
  const got = h.q.filter((x) => x.bin).length;
  assert(got >= 250 && got < 500, "rate limited burst got " + got);
  assert.strictEqual(b.code, null);
  h.q.length = 0;

  // oversized frames close the connection
  a.ws.send("x".repeat(20000));
  assert.strictEqual(await a.closed, 1009);
  assert.strictEqual((await h.next("left")).id, 1);
  const d = await join(h, "dan");
  d.bin(0, Buffer.alloc(70000));
  assert.strictEqual(await d.closed, 1009);

  // the host leaving closes every guest with {"t":"closed"}, and the room is gone
  const e = await join(h, "eve");
  h.ws.close();
  await b.next("closed"); await e.next("closed");
  await b.closed; await e.closed;
  const late = client(); await late.open;
  late.send({ t: "join", room: h.room, name: "late" });
  assert.strictEqual((await late.next("error")).why, "no-room");
  lister.send({ t: "list" });
  assert(!(await lister.next("rooms")).rooms.some((r) => r.room === h.room));

  // fixed servers: always listed first, in order, idle with their defaults until someone claims one
  const FIXED = ["HGHLND", "DSTBWL", "FRSTBT", "ASHPT2", "TWNLKS", "CNYNRN", "RTATN2", "NEWBYS"];
  const idle = (info) => ({ ...info, public: true, idle: true });
  lister.send({ t: "list" });
  rooms = (await lister.next("rooms")).rooms;
  assert.deepStrictEqual(rooms.map((r) => r.room), [...FIXED, priv.room]);
  assert.deepStrictEqual(rooms[0], { room: "HGHLND", name: "Highland Brawl", info: idle({ map: "highland", bots: 3 }), n: 0, fixed: true });
  assert.deepStrictEqual(rooms[3], { room: "ASHPT2", name: "Ash Pit", info: idle({ map: "ashfall", bots: 3 }), n: 0, fixed: true });
  assert.deepStrictEqual(rooms[6].info, idle({ map: "highland", bots: 4, rotate: true }));
  assert.deepStrictEqual(rooms[7], { room: "NEWBYS", name: "Easy Hill", info: idle({ map: "highland", bots: 2, skill: 0.2 }), n: 0, fixed: true });
  assert.strictEqual(rooms[8].fixed, undefined);

  // claim one (any case): the code is kept and the name is the slot's
  const fx = client(); await fx.open;
  fx.send({ t: "host", name: "my own name", info: { public: true, map: "dunes", bots: 3, players: 1 }, room: "dstBwl" });
  assert.deepStrictEqual(await fx.next((x) => x.t === "hosted" || x.t === "error"), { t: "hosted", room: "DSTBWL", id: 0 });
  // a second claim is refused, and that connection can then join normally
  const fx2 = client(); await fx2.open;
  fx2.send({ t: "host", name: "me too", room: "DSTBWL" });
  assert.deepStrictEqual(await fx2.next((x) => x.t === "hosted" || x.t === "error"), { t: "error", why: "taken" });
  fx2.send({ t: "join", room: "dstbwl", name: "fred" });
  assert.deepStrictEqual(await fx2.next((x) => x.t === "joined" || x.t === "error"), { t: "joined", room: "DSTBWL", id: 1 });
  assert.deepStrictEqual(await fx.next("peer"), { t: "peer", id: 1, name: "fred" });
  lister.send({ t: "list" });
  rooms = (await lister.next("rooms")).rooms;
  assert.deepStrictEqual(rooms[1], { room: "DSTBWL", name: "Dust Bowl", info: { public: true, map: "dunes", bots: 3, players: 1 }, n: 1, fixed: true });
  assert.deepStrictEqual(rooms.map((r) => r.room), [...FIXED, priv.room]);
  // joining an idle slot says "idle"; claiming a code that isn't a fixed slot says "no-room"
  for (const code of ["FRSTBT", "frstbt"]) {
    const j = client(); await j.open;
    j.send({ t: "join", room: code, name: "j" });
    assert.strictEqual((await j.next("error")).why, "idle");
    j.ws.close();
  }
  for (const code of ["ZZZZZZ", priv.room, "", 123, "DSTBWLX"]) {
    const j = client(); await j.open;
    j.send({ t: "host", name: "j", room: code });
    assert.strictEqual((await j.next((x) => x.t === "hosted" || x.t === "error")).why, "no-room", "claim " + code);
    j.ws.close();
  }
  // the host leaving closes the room as usual, and the slot is idle again
  fx.ws.close();
  await fx2.next("closed"); await fx2.closed;
  lister.send({ t: "list" });
  rooms = (await lister.next("rooms")).rooms;
  assert.deepStrictEqual(rooms[1], { room: "DSTBWL", name: "Dust Bowl", info: idle({ map: "dunes", bots: 3 }), n: 0, fixed: true });
  // with no info, a claimed room lists the slot's defaults
  const fx3 = client(); await fx3.open;
  fx3.send({ t: "host", room: "DSTBWL" });
  await fx3.next("hosted");
  lister.send({ t: "list" });
  assert.deepStrictEqual((await lister.next("rooms")).rooms[1].info, { map: "dunes", bots: 3, public: true });
  fx3.ws.close();

  // two claims at the same moment: exactly one wins
  const claimed = [];
  for (const code of ["HGHLND", "FRSTBT", "ASHPT2", "TWNLKS", "CNYNRN"]) {
    const pair = [client(), client()];
    await Promise.all(pair.map((x) => x.open));
    pair.forEach((x) => x.send({ t: "host", name: "race", info: { public: true }, room: code }));
    const got = await Promise.all(pair.map((x) => x.next((y) => y.t === "hosted" || y.t === "error")));
    assert.deepStrictEqual(got.map((g) => g.t).sort(), ["error", "hosted"], code + " " + JSON.stringify(got));
    assert.strictEqual(got.find((g) => g.t === "error").why, "taken");
    assert.strictEqual(got.find((g) => g.t === "hosted").room, code);
    claimed.push(pair[got.findIndex((g) => g.t === "hosted")]);
    pair.forEach((x, i) => { if (got[i].t === "error") x.ws.close(); });
  }

  // room cap (JF_ROOMS=8; one room, priv, is still open, and the five fixed rooms above don't count).
  // A normal host never gets a fixed code.
  const hosts = [];
  for (let i = 0; i < 10; i++) {
    const x = client(); await x.open;
    x.send({ t: "host", name: "r" + i });
    const r = await x.next((y) => y.t === "hosted" || y.t === "error");
    hosts.push(x);
    if (r.t === "error") { assert.strictEqual(r.why, "busy"); break; }
    assert(!FIXED.includes(r.room), "normal room got a fixed code " + r.room);
  }
  assert.strictEqual(hosts.length, 8, "7 more rooms, then busy");
  // a fixed slot can still be claimed when the normal rooms are full
  const fx4 = client(); await fx4.open;
  fx4.send({ t: "host", name: "x", room: "RTATN2" });
  assert.strictEqual((await fx4.next((x) => x.t === "hosted" || x.t === "error")).room, "RTATN2");
  hosts.forEach((x) => x.ws.close());
  [...claimed, fx4].forEach((x) => x.ws.close());

  // plain HTTP still works
  assert.strictEqual(await (await fetch(`http://localhost:${PORT}/healthz`)).text(), "ok");

  // timeouts: a connection that never hosts or joins, and one that goes quiet
  // JF_FIXED replaces the fixed list; bad entries are skipped
  const JF_FIXED = "abcdef|Test Room|dunes|5;bad|x;ABCDEF|Dup|a|1;OOOOOO|Has O|a|1;KLMNPQ|No bots|frost|x;MNPQRS|Bad extra|frost|1|oops;GHJKLM|Two|frost|0|rotate=true|skill=0.5";
  srvs.push(spawn(bin, [], { env: { ...base, PORT: String(PORT2), JF_HELLO_SECS: "1", JF_IDLE_SECS: "2", JF_FIXED }, stdio: "inherit" }));
  await sleep(300);
  const lister2 = client(PORT2); await lister2.open;
  lister2.send({ t: "list" });
  assert.deepStrictEqual((await lister2.next("rooms")).rooms, [
    { room: "ABCDEF", name: "Test Room", info: { map: "dunes", bots: 5, public: true, idle: true }, n: 0, fixed: true },
    { room: "GHJKLM", name: "Two", info: { map: "frost", bots: 0, rotate: true, skill: 0.5, public: true, idle: true }, n: 0, fixed: true },
  ]);
  lister2.ws.close();
  const lurk = client(PORT2); await lurk.open;
  const quiet = await host("q", {}, PORT2);
  const t1 = Date.now();
  await lurk.closed;
  assert(Date.now() - t1 < 3500, "lurker closed after about a second");
  quiet.send({ t: "ping" }); await quiet.next("pong");
  await quiet.closed;
  assert(Date.now() - t1 >= 1900, "idle close waits for the idle time");

  console.log("relay ok");
  srvs.forEach((s) => s.kill());
  process.exit(0);
})().catch((e) => { console.error(e); srvs.forEach((s) => s.kill()); process.exit(1); });
