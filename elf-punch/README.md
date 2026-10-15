# Elf Castle Wood Puncher 5000

Tiny MMO survival toy in Rust: std threads, tungstenite + serde_json, one shared in-memory world (25 players), ticks only
while someone is connected. About 650 KB static binary, ~6 MB RSS with 25 players.

The same server is also a small **game-experiments host** with two parts: a **key/value store** (`/kv`) for games where the browsers
hold the rules, and the **lab** (`/lab`) for games where the server holds them. The key/value store for the other experiments (`/kv/...`, below), so a static page on
GitHub Pages can keep scores, saves or shared state without its own backend.

Live: https://elf-castle-wood-puncher.fly.dev/

## Build, test, run

```sh
cargo test                      # store unit tests
cargo build --release
npm ci && npm test              # world integration test + /kv integration test (BIN=... to point at another binary)
PORT=8080 WORLD_FILE=/tmp/world.json KV_DIR=/tmp/kv target/release/elf-punch
```

`build.sh` is only for a box without a C toolchain (musl target via `zig cc`). The Dockerfile builds on Alpine.

Art: `sprite-gen.py` generates the sprite sheet used by the game page.

## Persistence

`/data` is a Fly volume named `world`, single machine only (the world lives in memory).

- The world (time of day, stumps, walls, fires) saves to `/data/world.json` every 30 s while someone is playing and when the last
  player leaves. `WORLD_FILE` overrides the path.
- Key/value data lives in `/data/kv/<namespace>.json`, one file per namespace, rewritten (tmp + rename) on every write.
  `KV_DIR` overrides the directory.

## Deploy

```sh
fly apps create <app>                    # once; set `app` in fly.toml
fly volumes create world --size 1 -a <app>
fly deploy --ha=false
```

Pushes to `main` that touch `elf-punch/` deploy themselves (`.github/workflows/deploy-elf-punch.yml`: tests, then `flyctl deploy`),
using the repo secret `FLY_API_TOKEN`, a deploy token for this one app. It expires 2027-10-11; renew with
`fly tokens create deploy -a elf-castle-wood-puncher -x 8760h | gh secret set FLY_API_TOKEN -R jroes/experiments`.

Keep it to one machine: both the world and the store are in that machine's memory and volume.

## Key/value store

`/kv/<namespace>/<key>` holds one JSON value. **There are no accounts and no keys.** Anyone who knows a namespace can read,
overwrite and delete it, so store nothing private, and treat what you read back as untrusted input. Pick a namespace per
experiment, and give it a long random suffix when you want it to be hard to find: **the server will not list keys**, so a
namespace name is the only way in. Per-namespace write keys would be the next step for an experiment that needs real protection.

| | |
| --- | --- |
| `GET /kv/<ns>/<key>` | `{"value": <json>, "rev": 12, "t": 1760000000}` or `404` |
| `GET /kv/<ns>?keys=a,b,c` | several keys by exact name in one request (at most 60): `{"now": 1760000100, "values": {"a": {"value","rev","t"}, ...}}`. Missing keys are left out. `now` is the server's clock, so `now - t` is how long ago a key was written, with no need to trust yours. |
| `PUT /kv/<ns>/<key>` | body is any JSON value; `201 {"rev","created":true}` or `200 {"rev","created":false}` |
| `DELETE /kv/<ns>/<key>` | `{"deleted": true|false}` |
| `GET /kv/<ns>` or `?prefix=` | `404 no_listing` unless the operator sets `KV_ALLOW_LIST=1` |

- Namespace: 1-40 chars of `a-z 0-9 _ -`. Key: 1-100 chars of `A-Z a-z 0-9 _ - . :`.
- `rev` is a number that increases on every write anywhere in the store. Send `If-Match: <rev>` on a PUT to overwrite only if
  nobody changed the key since you read it (`412` otherwise), or `If-None-Match: *` to create only. Create-only is atomic, so
  when two writers race for a key exactly one wins; the games use it for "first write wins".
- Responses are JSON, never cached (`Cache-Control: no-store`), and CORS is open (`Access-Control-Allow-Origin: *`, and
  `Retry-After` is exposed so a page can read it) so pages on `jroes.github.io` and `localhost` can call it directly.
- Errors look like `{"error": "...", "code": "too_large"}`. Codes: `bad_namespace`, `bad_key`, `too_many_keys`, `bad_json`,
  `no_listing` (404), `too_large` (413), `namespace_full` (413), `store_full` (507), `rev_mismatch` / `exists` (412),
  `rate_limited` (429, with `Retry-After`).

```js
const KV = "https://elf-castle-wood-puncher.fly.dev/kv/my-experiment-k7q2m9x4h8wz";
await fetch(`${KV}/best`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "ann", pts: 12 }) });
const { value, rev } = await (await fetch(`${KV}/best`)).json();
```

Send `Content-Type: application/json` on a PUT from a browser; the preflight is answered for you.

### Limits

Every limit has a default and an environment variable (Fly: `[env]` in `fly.toml`). When one is hit the answer is `429` (or `413` /
`507`) with a plain JSON error, and `Retry-After` says how long to wait. Clients should back off and keep working offline.

| What | Default | Variable |
| --- | --- | --- |
| One value (also checked from `Content-Length` before the body is read) | 65,536 bytes | `KV_VALUE_MAX` |
| Keys per namespace | 2,000 | `KV_NS_KEYS` |
| Stored bytes per namespace | 4,000,000 | `KV_NS_BYTES` |
| Stored bytes, everyone together | 24,000,000 | `KV_TOTAL_BYTES` |
| Namespaces | 200 | `KV_NS_COUNT` |
| Requests per address per minute | 300 | `KV_IP_REQ_PER_MIN` |
| Writes per address per minute | 60 | `KV_IP_WRITE_PER_MIN` |
| New namespaces per address per hour | 10 | `KV_IP_NEW_NS_PER_HOUR` |
| Requests per namespace per minute, everyone together | 240 | `KV_NS_REQ_PER_MIN` |
| Writes per namespace per minute, everyone together | 90 | `KV_NS_WRITE_PER_MIN` |
| New namespaces per day, everyone together (kept across restarts) | 100 | `KV_NEW_NS_PER_DAY` |
| Key listing | off | `KV_ALLOW_LIST=1` turns it on |
| Namespaces that expire: `prefix:days,...`, deleted after that many days with no write | `sdo-:60` | `KV_EXPIRE` |

The per-namespace limits mean a flood on one game never slows another, and they are counted before any data is touched. The
daily cap on new namespaces is what stops someone from filling the 200 slots with junk in a day, and namespaces that match
`KV_EXPIRE` clean themselves up (an active one never expires; anything with no matching prefix is kept forever). A namespace is
only deleted by the hourly sweep, which also runs when the machine starts.

The address comes from the `Fly-Client-IP` header (set by Fly's proxy), and from the socket when that header is absent.


## The lab: server-authoritative games (`/lab`)

`/kv` trusts the browsers. The lab doesn't: the server owns the rules and the state, so nobody can edit their own score. Use it when
players share one world and must not be able to cheat (the universe version of Warp Traders is the first game).

The lab gives a game everything around the rules: players, a secret token each, saving, limits, presence. A game is one type that implements
`Game` (`src/lab/mod.rs`) and gets handed `now`, so it never touches sockets, files or clocks.

```
GET  /lab                         list games
POST /lab/<game>/join {"name"}    -> 201 {id, name, token}   (the token is shown once; send it as Authorization: Bearer <token>)
GET  /lab/<game>/me               what this player may see (auth)
POST /lab/<game>/act  {...}       one action, game-defined (auth) -> 200 {...} or 400 {error:"refused", message}
GET  /lab/<game>/board            public view, no login
```

Other statuses: 401 no or unknown token, 404 unknown game, 409 name taken, 429 slow down (`Retry-After`), 507 full.
Names are 2 to 16 letters, digits, spaces, `_`, `-`. There are no accounts: the token is the player, and only its SHA-256 is saved.

**Add a game:** copy `src/lab/clicker.rs` (40 lines), put your rules in `act`, add it to `games()` in `src/lab/mod.rs`, and write rules tests next to it.
Anything in `act`'s JSON is untrusted. Return `Err(msg)` to refuse, which changes nothing and is not saved. State has to survive `save`/`load`.
Keep time-based things lazy (store a timestamp, bring it up to date when someone looks), so the machine can sleep with nobody connected.

**Persistence:** `/data/lab/<game>.json` (tmp + rename), saved every 3 s when something changed. A save that cannot be read is moved to
`<game>.corrupt-<time>` and the game starts fresh, because the server must always come up. Single machine only.

**Limits (env):** `LAB_MAX_PLAYERS` (1000), `LAB_IP_REQ_PER_MIN` (240), `LAB_IP_JOINS_PER_HOUR` (6), `LAB_ACT_PER_MIN` (90), `LAB_DIR` (`/data/lab`).

### Warp Traders: the universe (`src/lab/tradewars.rs`)

One galaxy for everybody. Ports have stock that buying drains and selling fills, so prices move for everyone and drift back over hours.
Turns come back at 1 per 90 s up to 600, even while you're away. Stardock sells holds and fighters. Another trader in your sector can
be attacked (3 turns, needs fighters, never at Stardock, not while protected). The loser goes back to Stardock with no fighters or cargo
and keeps their credits. The winner takes what fits in their holds.

Env: `LAB_TW_SEED`, `LAB_TW_SECTORS` (250), `LAB_TW_TURN_SECS` (90), `LAB_TW_TURN_CAP` (600), `LAB_TW_START_TURNS` (300),
`LAB_TW_PORT_TAU` (14400, seconds for stock to drift about two thirds of the way back), `LAB_TW_PROTECT_NEW_SECS` (10800), `LAB_TW_PROTECT_DEATH_SECS` (3600).
The galaxy is saved with the game, so it does not change if the seed or code does. Balance has not been tested with real players yet.
Client: `warptraders/universe/`. To reset the universe, delete `/data/lab/warptraders.json` and restart.

Tests: `cargo test --release` (rules and framework), `npm run test:lab` (several players over HTTP, with a restart in the middle).

## Jetfall relay (`/jetfall`)

A WebSocket room relay for Jetfall, the browser FPS. One player's browser is the host and runs the game. The server only puts people
in rooms, passes WebRTC signaling between host and guests, and passes game packets itself when WebRTC can't connect. Everything is in
memory: a restart drops every room. Code: `src/relay.rs`. Test: `npm run test:relay`.

Connect to `wss://<server>/jetfall`. Text frames are JSON:

| Client sends | What happens |
| --- | --- |
| `{"t":"host","name":"Dock fight","info":{...}}` | `{"t":"hosted","room":"K7Q2MX","id":0}`. Codes are 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. |
| `{"t":"host","info":{...},"room":"DSTBWL"}` | claims a fixed server (below): `hosted` with that code, `taken` if someone hosts it, `no-room` if it isn't a fixed code |
| `{"t":"info","info":{...}}` | host only: replaces the listing info (a JSON object, at most 600 bytes, else `{"t":"error","why":"bad-info"}`) |
| `{"t":"join","room":"k7q2mx","name":"ann"}` | joiner gets `{"t":"joined","room":"K7Q2MX","id":3}`, host gets `{"t":"peer","id":3,"name":"ann"}` |
| `{"t":"list"}` | `{"t":"rooms","rooms":[{"room","name","info","n"}]}`: every fixed server first, then rooms whose info has `"public":true` (at most 50), `n` = guests |
| `{"t":"sig","to":0,"d":{...}}` | the target gets `{"t":"sig","from":3,"d":{...}}`. Guests can only send to the host (0). |
| `{"t":"kick","id":3}` | host only: the guest gets `{"t":"error","why":"kicked"}` and is closed; the host gets `{"t":"left","id":3}` |
| `{"t":"ping"}` | `{"t":"pong"}` |

The server also sends `{"t":"left","id":N}` to the host when a guest goes, and `{"t":"closed"}` to every guest when the host goes (then
closes them; the room is gone). Errors: `no-room`, `full`, `busy` (too many rooms), `already` (a connection hosts or joins once),
`bad-info`, `kicked`, `taken` and `idle` (fixed servers). Junk and unknown messages are ignored. Guest ids run from 1 and are never reused in a room. Names are trimmed,
lose control characters and keep at most 24 characters (empty becomes `player` or `room`).

**Fixed servers.** A short list of named rooms that always show in the list, so there is always something to pick. A browser still
hosts the game; the relay only keeps the name and code free. Idle, one is listed as
`{"room":"DSTBWL","name":"Dust Bowl","info":{"map":"dunes","bots":3,"public":true,"idle":true},"n":0,"fixed":true}`. Once someone
claims it, it's listed like any room (with the info the host sent) plus `"fixed":true`. Claiming is `host` with `"room"` (any case).
The name is always the slot's. Two claims at once: one gets `hosted`, the other `taken`, and should then `join`. A `join` to an idle
slot gets `idle`, which means claim it. When the host leaves, the room closes as usual and the slot is idle again. Fixed rooms don't
count against `JF_ROOMS` or the 50 in the list, and a normal room never gets a fixed code.

| Code | Name | Defaults |
| --- | --- | --- |
| `HGHLND` | Highland Brawl | `{"map":"highland","bots":3}` |
| `DSTBWL` | Dust Bowl | `{"map":"dunes","bots":3}` |
| `FRSTBT` | Frostbite | `{"map":"frost","bots":3}` |
| `ASHPT2` | Ash Pit | `{"map":"ashfall","bots":3}` |
| `TWNLKS` | Twin Lakes | `{"map":"lakes","bots":3}` |
| `CNYNRN` | Canyon Run | `{"map":"canyon","bots":3}` |
| `RTATN2` | Map Rotation | `{"map":"highland","bots":4,"rotate":true}` |
| `NEWBYS` | Easy Hill | `{"map":"highland","bots":2,"skill":0.2}` |

`JF_FIXED` replaces the list: `CODE|Name|map|bots`, then any `key=value` extras (JSON if it parses, else text), `;` between entries.
For example `HGHLND|Highland Brawl|highland|3;RTATN2|Map Rotation|highland|4|rotate=true`. Bad entries (wrong code, repeated code,
no map, bots not a number) are skipped. Set it empty for no fixed servers.

Binary frames are game packets: the first 2 bytes (big-endian) are who it's for, the rest is passed on untouched. The receiver gets the
same payload with the first 2 bytes changed to who it's from. Guests can only send to 0 (the host); the host sends to a guest id or
`0xFFFF` for every guest. Anything else is dropped without a word.

Limits (env, default):

| What | Default | Variable |
| --- | --- | --- |
| Guests per room | 15 | `JF_ROOM_MAX` |
| Rooms (not counting fixed servers) | 40 | `JF_ROOMS` |
| Relay connections | 150 | `JF_CONNS` (more get a `503` before the upgrade) |
| Binary message | 65,536 bytes | `JF_BIN_MAX` (bigger closes with 1009) |
| Text message | 16,384 bytes | `JF_TEXT_MAX` (bigger closes with 1009) |
| Host messages and bytes per second | 1500 and 2,000,000 | `JF_HOST_MSGS`, `JF_HOST_BYTES` |
| Guest messages and bytes per second | 300 and 200,000 | `JF_GUEST_MSGS`, `JF_GUEST_BYTES` |
| Closed after nothing received for | 60 s | `JF_IDLE_SECS` (so clients send a `ping` every 20 s or so) |
| Closed if it hasn't hosted or joined within | 30 s | `JF_HELLO_SECS` |

Over the rate, messages are dropped and the connection stays up. Like `/kv`, there are no accounts: anyone with a room code can join,
and the host decides who stays.

How it's built: tungstenite only does the handshake. After that each connection has one thread that reads frames, and any thread can
write a frame straight into another player's socket (a mutex per socket, 1 s write timeout, `TCP_NODELAY`). A socket that can't take a
write in time is closed. 200 round trips host to guest to host take about 40 ms locally.
