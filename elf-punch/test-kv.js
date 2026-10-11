// Integration test for the /kv storage API against the release binary: node test-kv.js after `cargo build --release`.
const { spawn } = require("child_process");
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const bin = process.env.BIN || "target/release/elf-punch";
const PORT = 8124;
const DIR = "/tmp/elf-punch-test-kv";
fs.rmSync(DIR, { recursive: true, force: true });
const env = { PORT: String(PORT), WORLD_FILE: "/tmp/elf-punch-test-kv-world.json", KV_DIR: DIR, KV_VALUE_MAX: "200", KV_IP_WRITE_PER_MIN: "40", KV_NS_REQ_PER_MIN: "120", KV_NEW_NS_PER_DAY: "3" };
let srv = spawn(bin, [], { env, stdio: "inherit" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (p) => `http://localhost:${PORT}${p}`;
const put = (p, body, headers = {}) => fetch(url(p), { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body), headers });
// Raw socket request: lets us send a body that disagrees with Content-Length and read the status line only.
const raw = (text) => new Promise((res) => {
  const s = net.connect(PORT, "localhost", () => s.write(text));
  let out = ""; s.on("data", (d) => (out += d)); s.on("close", () => res(out)); s.setTimeout(3000, () => { s.destroy(); });
});
(async () => {
  await sleep(300);
  // CORS preflight from a browser on github.io
  const pre = await fetch(url("/kv/demo/k"), { method: "OPTIONS", headers: { Origin: "https://jroes.github.io", "Access-Control-Request-Method": "PUT" } });
  assert.strictEqual(pre.status, 204);
  assert.strictEqual(pre.headers.get("access-control-allow-origin"), "*");
  assert(/PUT/.test(pre.headers.get("access-control-allow-methods")));

  let r = await put("/kv/demo/score", { name: "ann", pts: 12 });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.headers.get("cache-control"), "no-store");
  assert.strictEqual(r.headers.get("access-control-allow-origin"), "*");
  const rev1 = (await r.json()).rev;
  r = await fetch(url("/kv/demo/score"));
  const got = await r.json();
  assert.deepStrictEqual(got.value, { name: "ann", pts: 12 });
  assert.strictEqual(got.rev, rev1);

  // compare-and-set
  r = await put("/kv/demo/score", { pts: 13 }, { "If-Match": "12345" });
  assert.strictEqual(r.status, 412);
  r = await put("/kv/demo/score", { pts: 13 }, { "If-Match": String(rev1) });
  assert.strictEqual(r.status, 200);
  assert((await r.json()).rev > rev1);

  // keys are read by exact name; there is no way to list them
  await put("/kv/demo/run:1", 1); await put("/kv/demo/run:2", 2);
  for (const q of ["?prefix=run:", "", "?prefix="]) {
    r = await fetch(url("/kv/demo" + q));
    assert.strictEqual(r.status, 404, "listing " + q);
    const body = await r.json();
    assert.strictEqual(body.code, "no_listing");
    assert(!JSON.stringify(body).includes("run:1"), "listing must not leak key names");
  }
  const mg = await (await fetch(url("/kv/demo?keys=run:1,run:2,missing"))).json();
  assert.deepStrictEqual(Object.keys(mg.values).sort(), ["run:1", "run:2"]);
  assert.strictEqual(mg.values["run:2"].value, 2);
  r = await fetch(url("/kv/demo?keys=bad%20key")); assert.strictEqual(r.status, 400);
  assert.strictEqual((await (await fetch(url("/kv/never-written?keys=a,b"))).json()).values.a, undefined);

  // new namespaces per day are capped for everyone (the server was started with a cap of 3: demo + two more)
  assert.strictEqual((await put("/kv/dayone/k", 1)).status, 201);
  assert.strictEqual((await put("/kv/daytwo/k", 1)).status, 201);
  r = await put("/kv/daythree/k", 1);
  assert.strictEqual(r.status, 429);
  assert((await r.json()).error.includes("today"));
  const wait = Number(r.headers.get("retry-after"));
  assert(wait >= 1 && wait <= 86400, "Retry-After is the time left in the day, got " + wait);
  assert.strictEqual((await put("/kv/dayone/k2", 2)).status, 201, "existing namespaces keep working");

  // one namespace has its own request limit, other namespaces are not affected
  let nsLimited = null;
  for (let i = 0; i < 130 && !nsLimited; i++) { const x = await fetch(url("/kv/flood/k")); if (x.status === 429) nsLimited = x; }
  assert(nsLimited, "namespace request limit reached");
  assert(/namespace/.test((await nsLimited.json()).error));
  assert(Number(nsLimited.headers.get("retry-after")) >= 1);
  assert.strictEqual(nsLimited.headers.get("access-control-expose-headers"), "Retry-After", "browsers must be able to read Retry-After");
  assert.strictEqual((await fetch(url("/kv/demo/score"))).status, 200, "another namespace is fine");

  // errors are JSON with a stable code
  r = await put("/kv/demo/big", JSON.stringify("x".repeat(300)));
  assert.strictEqual(r.status, 413); assert.strictEqual((await r.json()).code, "too_large");
  r = await put("/kv/demo/bad", "{nope"); assert.strictEqual(r.status, 400);
  r = await fetch(url("/kv/UPPER/k")); assert.strictEqual(r.status, 400);
  r = await fetch(url("/kv/demo/missing")); assert.strictEqual(r.status, 404);
  // oversized declared body is refused before it is read
  const out = await raw("PUT /kv/demo/x HTTP/1.1\r\nHost: a\r\nContent-Length: 99999999\r\n\r\n");
  assert(out.startsWith("HTTP/1.1 413"), out.slice(0, 40));
  // an address rate limit answers 429 with Retry-After
  let limited = null;
  for (let i = 0; i < 60 && !limited; i++) { const x = await put(`/kv/demo/rk${i % 5}`, i); if (x.status === 429) limited = x; }
  assert(limited, "write rate limit reached");
  assert(Number(limited.headers.get("retry-after")) >= 1);

  // game still works alongside
  assert.strictEqual(await (await fetch(url("/healthz"))).text(), "ok");

  // data survives a restart
  srv.kill(); await sleep(300);
  srv = spawn(bin, [], { env, stdio: "inherit" }); await sleep(300);
  assert.deepStrictEqual((await (await fetch(url("/kv/demo/score"))).json()).value, { pts: 13 });
  r = await fetch(url("/kv/demo/run:1"), { method: "DELETE" });
  assert.deepStrictEqual(await r.json(), { deleted: true });
  assert.strictEqual((await fetch(url("/kv/demo/run:1"))).status, 404);
  console.log("kv ok");
  srv.kill();
  process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
