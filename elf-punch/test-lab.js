// Integration test for the /lab API against the release binary: node test-lab.js after `cargo build --release`.
// Several players share one universe over real HTTP, and the server is restarted to check that the universe comes back.
const { spawn } = require("child_process");
const assert = require("assert");
const fs = require("fs");
const bin = process.env.BIN || "target/release/elf-punch";
const PORT = 8125;
const DIR = "/tmp/elf-punch-test-lab";
fs.rmSync(DIR, { recursive: true, force: true });
const env = {
  PORT: String(PORT), WORLD_FILE: "/tmp/elf-punch-test-lab-world.json", KV_DIR: DIR + "-kv", LAB_DIR: DIR,
  LAB_TW_SEED: "42", LAB_TW_SECTORS: "60", LAB_TW_PROTECT_NEW_SECS: "0", LAB_IP_JOINS_PER_HOUR: "1000", LAB_IP_REQ_PER_MIN: "100000", LAB_ACT_PER_MIN: "100000",
};
let srv;
const start = () => { srv = spawn(bin, [], { env, stdio: "inherit" }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (p) => `http://localhost:${PORT}${p}`;
const call = async (method, path, token, body) => {
  const r = await fetch(url(path), { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) };
};
const join = async (name) => { const r = await call("POST", "/lab/warptraders/join", null, { name }); assert.strictEqual(r.status, 201, JSON.stringify(r.json)); return r.json.token; };
const act = (tok, a) => call("POST", "/lab/warptraders/act", tok, a);
const me = async (tok) => { const r = await call("GET", "/lab/warptraders/me", tok); assert.strictEqual(r.status, 200); return r.json; };

(async () => {
  start();
  await sleep(400);

  // the list, CORS, and a preflight with an Authorization header
  let r = await call("GET", "/lab");
  assert.strictEqual(r.status, 200);
  assert(r.json.games.some((g) => g.id === "warptraders"));
  assert.strictEqual(r.headers.get("access-control-allow-origin"), "*");
  const pre = await fetch(url("/lab/warptraders/act"), { method: "OPTIONS", headers: { Origin: "https://jroes.github.io", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
  assert.strictEqual(pre.status, 204);
  assert(/authorization/i.test(pre.headers.get("access-control-allow-headers")));

  // joining
  const ann = await join("Ann");
  const bob = await join("Bob");
  r = await call("POST", "/lab/warptraders/join", null, { name: "ann" });
  assert.strictEqual(r.status, 409);
  r = await call("POST", "/lab/warptraders/join", null, { name: "x" });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await call("GET", "/lab/warptraders/me")).status, 401);
  assert.strictEqual((await call("GET", "/lab/warptraders/me", "f".repeat(32))).status, 401);

  // the game is the server's: a client cannot give itself money
  let v = await me(ann);
  assert.strictEqual(v.you.credits, 1000);
  for (const bad of [{ do: "credits", n: 1e9 }, { do: "buy", good: "fuel", qty: -1 }, { do: "fighters", qty: 1e12 }, "x", null]) {
    r = await act(ann, bad);
    assert.strictEqual(r.status, 400, JSON.stringify(bad));
  }
  assert.strictEqual((await me(ann)).you.credits, 1000);

  // walk Ann out to a port and trade; Bob follows and sees the price Ann moved
  r = await act(ann, { do: "fighters", qty: 2 });
  assert.strictEqual(r.status, 200);
  let seen = new Set([0]);
  let tour = [0];
  v = await me(ann);
  let port = null;
  for (let i = 0; i < 40 && !port; i++) {
    const next = v.sector.warps.find((w) => !seen.has(w)) ?? v.sector.warps[0];
    r = await act(ann, { do: "warp", to: next });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    v = r.json.view; seen.add(next); tour.push(next);
    if (v.sector.port) port = v.sector;
  }
  assert(port, "found a port");
  const sell = port.port.goods.find((g) => g.mode === "sell");
  r = await act(ann, { do: "buy", good: sell.good, qty: "max" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert(r.json.view.you.cargo[sell.good] >= 5);
  assert(r.json.view.you.credits < 1000);

  // Bob travels the same way
  r = await act(bob, { do: "travel", to: port.id });
  if (r.status !== 200) for (const s of tour.slice(1)) { r = await act(bob, { do: "warp", to: s }); assert.strictEqual(r.status, 200); }
  v = await me(bob);
  assert.strictEqual(v.sector.id, port.id);
  assert.strictEqual(v.sector.here.length, 1);
  assert.strictEqual(v.sector.here[0].name, "Ann");
  assert(!("credits" in v.sector.here[0]));
  const bobPrice = v.sector.port.goods.find((g) => g.good === sell.good);
  assert(bobPrice.price > sell.price, `${sell.price} -> ${bobPrice.price} ${JSON.stringify(bobPrice)}`);

  // Bob has no fighters. Ann attacks, wins, and Bob goes home
  r = await act(bob, { do: "attack", target: "Ann" });
  assert.strictEqual(r.status, 400);
  r = await act(ann, { do: "attack", target: "Bob" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert(/^Victory/.test(r.json.msg), r.json.msg);
  v = await me(bob);
  assert.strictEqual(v.you.sector, 0);
  assert.strictEqual(v.you.deaths, 1);
  assert(v.inbox.length >= 1);
  r = await act(ann, { do: "say", to: "Bob", text: "sorry about that" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await me(bob)).inbox[0].text, "sorry about that");

  // the public board
  r = await call("GET", "/lab/warptraders/board");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.players, 2);
  assert(r.json.top[0].net_worth >= r.json.top[1].net_worth);
  assert(!JSON.stringify(r.json).includes(ann));

  // restart: the universe, the players and the tokens come back
  const annNow = await me(ann);
  await sleep(3500); // saves every 3 s
  srv.kill();
  await sleep(300);
  start();
  await sleep(400);
  const annAfter = await me(ann);
  assert.strictEqual(annAfter.you.credits, annNow.you.credits);
  assert.strictEqual(annAfter.you.sector, annNow.you.sector);
  assert.deepStrictEqual(annAfter.you.cargo, annNow.you.cargo);
  assert.deepStrictEqual(annAfter.map.map((m) => m.id), annNow.map.map((m) => m.id));
  assert.strictEqual((await me(bob)).you.deaths, 1);
  r = await call("POST", "/lab/warptraders/join", null, { name: "Bob" });
  assert.strictEqual(r.status, 409);
  const saved = fs.readFileSync(DIR + "/warptraders.json", "utf8");
  assert(!saved.includes(ann) && !saved.includes(bob), "tokens are not saved, only their hashes");

  // the other parts of the server still work
  r = await fetch(url("/kv/demo/k"), { method: "PUT", body: "1" });
  assert([200, 201].includes(r.status));
  console.log("lab ok");
  srv.kill();
  process.exit(0);
})().catch((e) => { console.error(e); srv && srv.kill(); process.exit(1); });
