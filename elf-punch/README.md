# Elf Castle Wood Puncher 5000

Tiny MMO survival toy in Rust: std threads, tungstenite + serde_json, one shared in-memory world (25 players), ticks only
while someone is connected. About 650 KB static binary, ~6 MB RSS with 25 players.

The same server also hosts a small **key/value store** for the other experiments (`/kv/...`, below), so a static page on
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
