# Relay

A tiny message board that lets friends play Sector Dominion online without being online at the same time.

It does not run the game. Each player's browser keeps its own copy and plays the turn itself once everyone's orders are in.
The relay only stores small write-once rows per game room: each player's orders for each turn, and a state hash for desync checks.
So it holds a few hundred bytes per player per turn and costs essentially nothing.

## Deploy on Cloudflare (free, no card)

You need a free Cloudflare account. Nothing here is secret, and there are no keys to put in the repo.

```sh
cd relay
npx wrangler login
npx wrangler deploy
```

Wrangler prints the address, something like `https://sector-relay.YOUR-NAME.workers.dev`. Check it:

```sh
curl https://sector-relay.YOUR-NAME.workers.dev/v1/health
# {"ok":true,"v":1}
```

Then either paste that address into the game (Multiplayer, Play online, Relay address) or put it in `shared/config.js` so
it is filled in for everyone.

It uses one SQLite-backed Durable Object per game, which is the kind available on the Workers free plan. Cloudflare's free plan
(as of when this was written, check their pricing page for current numbers) allows 100,000 Durable Object requests a day, with
100,000 row writes and 5 million row reads a day and 5 GB of storage. A game turn costs a handful of requests per player.
Rooms delete themselves 90 days after the last write.

## Or run it on Fly.io (small always-available server, needs a card)

Fly no longer has a free tier for new accounts. A `shared-cpu-1x` 256 MB machine that stops when idle plus a 1 GB volume is
roughly a dollar or two a month. Use it if you would rather have a plain server than Cloudflare.

```sh
cd relay
fly launch --no-deploy --copy-config   # pick a unique app name when asked
fly volumes create relay_data --size 1
fly deploy
fly scale count 1                      # the volume belongs to one machine
```

`src/node-server.js` is the same logic as the Worker, with rooms kept in memory and saved to a JSON file on the volume.

## Run it locally

```sh
node relay/src/node-server.js           # http://localhost:8787, no dependencies
# or the real Cloudflare runtime:
cd relay && npx wrangler dev --local
```

The game accepts `http://localhost:...` as a relay address for testing. Any other relay must be `https://`.

## Limits

Everything below has a default in `src/limits.js` and can be changed without touching code: set the environment variable
(Cloudflare: `[vars]` in `wrangler.toml` or the dashboard, Node and Fly: the process environment).

| What | Default | Variable |
| --- | --- | --- |
| Request body | 8192 bytes (checked from `Content-Length` before reading, and again after) | `RELAY_BODY_MAX` |
| One orders code | 8000 characters, about 100 orders | `RELAY_CODE_MAX` |
| Rows per room | 4000 | `RELAY_ROOM_ROWS` |
| Stored bytes per room | 1,000,000 | `RELAY_ROOM_BYTES` |
| Turns returned by one range read | 30 | `RELAY_RANGE_MAX` |
| Highest turn number | 5000 | `RELAY_TURN_MAX` |
| Requests per room per minute | 240 | `RELAY_ROOM_REQ_PER_MIN` |
| Writes per room per minute | 90 | `RELAY_ROOM_WRITES_PER_MIN` |
| Requests per address per minute (Node server, and Cloudflare if the `RL` binding is on) | 240 | `RELAY_IP_REQ_PER_MIN` |
| New rooms per address per hour | 6 | `RELAY_IP_CREATE_PER_HOUR` |
| New rooms per day, everyone together | 300 | `RELAY_GLOBAL_CREATE_PER_DAY` |

What happens when a limit is hit: the relay answers `429` (or `413` for a body that is too big) with a `Retry-After` header, and the
game shows a plain message. Nothing is lost, because every browser keeps its own copy of the game.

How the limits are enforced:

- Per-room rates and sizes are checked inside each room before anything is stored, so a flood costs almost nothing. They are exact.
- On Cloudflare, room creation goes through one small `Gate` Durable Object that counts creations per address (hashed) per hour and
  overall per day. This is what protects a free daily quota from someone spamming new rooms.
- Per-address request rates on Cloudflare need Cloudflare's rate limiting binding. It is off by default because I could not confirm
  it is on the free plan, and its counts are per location (a soft limit). Uncomment the `[[ratelimits]]` block in `wrangler.toml` to try it.
  The Node server counts these exactly.
- On Fly, set `CLIENT_IP_HEADER=fly-client-ip` (already in `fly.toml`) so limits see the real visitor. The header is ignored unless
  you set this, so nobody can dodge a limit by sending a fake one.

Games with a lot of orders per turn need `RELAY_CODE_MAX` and `RELAY_BODY_MAX` raised together (the body has to hold the code).

## Writing your own relay (a different host or language)

The relay is only the HTTP API below plus the rules in `src/logic.js`. Any implementation that behaves the same works with the games.
`tests/lockstep.test.mjs` talks to a relay over plain HTTP and is the conformance test:

```sh
RELAY_URL=http://localhost:8787 node --test tests/lockstep.test.mjs
```

Raise the rate limits first so the tests do not trip them (`RELAY_ROOM_REQ_PER_MIN`, `RELAY_ROOM_WRITES_PER_MIN`,
`RELAY_IP_CREATE_PER_HOUR`, `RELAY_GLOBAL_CREATE_PER_DAY`). The things an implementation has to get right are: first write wins and is atomic
per room, the seat-token rules, the host-only skip, the turn-must-be-open rule, and permissive CORS with `Retry-After` exposed.

## What it protects and what it does not

- Each seat has its own secret token, handed out in that player's invite code. Only that seat can post its orders, and the
  relay stores a hash of the token, not the token.
- Orders and skips are write-once. The first write wins, a repeat of the same write is fine, anything different is refused.
  Within a room all requests are serialized, which is what makes this airtight. See `verification/LockstepBoard.tla`.
- Only the host (seat 1) can post a skip for another seat.
- A room is a long random name. Anyone who knows it can read the orders, which is fine for friends. Invite codes are bearer
  secrets, so send them privately.
- Anyone can create rooms, so room creation is capped per address and per day (see Limits). A determined attacker with many addresses
  could still use up the daily room allowance, and then nobody can start a new game until tomorrow. Games already running are
  unaffected. Lower `RELAY_GLOBAL_CREATE_PER_DAY` to cap your exposure, or switch to a new Worker name if you ever need a clean slate.

## API (for reference)

All paths start with `/v1/rooms/<room>`, where `<room>` is 12 to 32 characters of `a-z0-9`. Writes need `X-Seat: <token>`.

| Request | What |
| --- | --- |
| `POST /` `{humans, seats:{n: sha256(token)}}` | create the room (once) |
| `GET /meta` | players, latest turn |
| `GET /sync/<turn>` | all orders and hashes for one turn |
| `GET /orders?from=a&to=b` | up to 30 turns at once, used to rebuild a game |
| `PUT /orders/<turn>/<seat>` `{code}` | post orders (write-once) |
| `PUT /skip/<turn>/<seat>` `{ai?}` | host only: play the turn without that player |
| `PUT /hash/<turn>/<seat>` `{h}` | post the state hash at the start of a turn |
