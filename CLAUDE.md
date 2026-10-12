# Notes for working in this repo

Small browser games inspired by old DOS classics (original code, art and text), plus a tiny Rust server on Fly that hosts a shared
key/value store. Live at https://jroes.github.io/experiments/. Written for whoever (person or Claude) picks this up next.

## Ground rules

- **The repo is public. Never commit secrets.** No keys, tokens or private URLs. The KV store has no accounts on purpose.
- **`main` is the default branch.** Pages (`.github/workflows/pages.yml`) and the Fly deploy (`deploy-elf-punch.yml`, only for changes under `elf-punch/**`) both run on pushes to `main`.
- **Do not run `fly deploy` by hand and do not touch `FLY_API_TOKEN`.** Merging to `main` deploys. Keep the server a single machine: atomic create-only writes depend on it (see `verification/`).
- Work on a branch, open a PR, wait for CI (`tests`, `tlc`, `elf-punch`), merge. The owner said merging is fine without asking.
- Plain, casual writing in the UI, READMEs and PR text. Short sentences, no hype, no sales words, no over-explaining.
- The sandbox cannot reach `fly.dev` or other outside hosts. Test against a local build of `elf-punch` instead (below).

## Layout

| Path | What |
| --- | --- |
| `sectordominion/` | Space-empire game. `game.js` (rules, AI, no DOM), `online.js` (play with friends), `ui.js`, `index.html`, `style.css` |
| `warptraders/` | Space trading game. Challenge seeds, plus a live race over WebRTC (`shared/p2p.js`, `lobby.js`) |
| `tankwars/` | Artillery game. `game.js` (rules, AI, no DOM), `online.js` (play with friends, lockstep through the `/kv` store), `ui.js`, `index.html`, `style.css` |
| `hollowmere/`, `gullrock/`, `starsweeper/` | Three adventures. Each is `game.js` (plain data: rooms, items, handlers) plus a page; the engine is in `shared/` |
| `shared/` | `store.js` (KV client), `config.js` (`KV_URL`), `qrcode.js` (vendored, MIT), p2p and lobby code. `adventure.js` (engine, no DOM), `adventure-art.js` (EGA pixel helpers), `hd2d.js` + `hd2d-post.js` (HD-2D pictures, below), `adventure-ui.js`, `arcade.css` (look shared by Tank Wars and the adventures) |
| `j/` | Invite landing page: OpenGraph tags for link previews, then hands `#<code>` to the game |
| `elf-punch/` | Rust server: `/kv` store (`src/store.rs`), the lab for server-authoritative games (`src/lab/`), the original elf toy (`src/elf.rs`). See its README |
| `warptraders/universe/` | Client for the shared-universe Warp Traders (talks to `/lab/warptraders`) |
| `tests/` | `node --test` suites. `fake-kv.js` is an in-memory stand-in for the server |
| `verification/` | TLA+ models checked with TLC (`run-tlc.sh`) |
| `tools/` | `make-og.js` renders the link-preview images. `video/` makes each game's intro video (below) |

## Patterns that matter

**Deterministic lockstep.** Every player's browser holds the whole game and plays each turn itself from the same orders. That only works if the
rules are deterministic: seeded RNG kept in the state (`rand(state)`), exact arithmetic, no `Math.random`, `Math.hypot`, `Math.pow` or sort
comparators that use randomness (`tests/portability.test.js` bans them). Players are applied in seat order, never arrival order. `hashState`
rides along with every set of orders so a drift is flagged. If you change a rule so an old game would replay differently, bump `RULES`.

**Many games per device.** `sectordominion/games.js` (`Library`) owns the list: one index key plus one key per game, with the open game's id. `ui.js` never writes a
game's data anywhere else. When something async finishes after the player switched games (a poll, sending orders), check the open game is still the one you started with and
`persist(session)` to its own key. Add games with `lib.add(kind)` before writing, and always check `lib.full` before doing anything on the server that cannot be undone.

**The store is the source of truth, localStorage is a cache.** One game is one namespace `sdo-<16 random chars>`. Keys: `meta` (settings, create-only),
`o-<turn>-<seat>` (orders, create-only with `If-None-Match: *`), `p-<seat>` (presence heartbeat, overwrite; carries the display name).
A *link* between devices is its own namespace (`d-<16 chars>` in URLs): `games` (shared list, compare-and-set with `If-Match`), `profile`, `solo-<n>`.
 The server will not list keys, so you can only read what you already know the name of.
Namespaces starting `sdo-` expire after 60 days without writes.

**Everything read from the store is untrusted.** Orders go through `cleanEntry`, names through `cleanName`, settings through `cleanGame`,
a copied solo game through `G.validState`, the link's game list through `cleanList`, and commands through `Game.apply` (own-property checks with `has()`, never `obj[userKey]`; turn-tagged).
Add a validator and a hostile-input test whenever a new kind of value comes back from the store.

**Store numbers as text.** The real server can round-trip a decimal differently in its last digit. A game snapshot is stored as a JSON *string* for
that reason. This only showed up when running the tests against the real binary, not the fake. Run both.

**One derived view for "who plays what".** `Session.seatState(seat)` is `human`, `ai-pending`, `ai` or `out`. It looks at the game *and* the
board, because handing a seat to the AI takes two steps (a posted entry, then the turn playing). Anything that lists or reacts to seats
(invite links, joining, skip buttons, the panel, the end-turn button) uses it. The first version built the invite list from "all seats", then
from the game alone, and both offered a link to an AI seat. `verification/SeatRoster.tla` models this and fails for both older designs.

**Friends online, in any game.** Having the page open and visible is what makes someone online, so the page heartbeats in *every* game with friends it has loaded, not only the open one.
Every 10 s (20 s with more than 6 games) it also looks at the games that are not open, and `Online.friendsOnline` turns that into "who is around": the count chip in the top
bar and the list in Games. A friend hopping on or off plays a sound and shows a small toast wherever I am (solo game, another game), and the tab title changes if the page is hidden.
A hidden page keeps looking slowly (once a minute after ten minutes) so the sound still plays; Safari on iOS suspends hidden pages, which nothing here can fix. Heartbeats stop while hidden.
The first look at a game is quiet, so loading the page does not announce everyone.

**Presence is a hint, never a rule.** "Online" is a heartbeat written every 15 s, read with the orders in the same request, and judged with the
server's clock. Nothing in the game depends on it. Polling is 3 s when someone else is online and a turn is waiting, slower otherwise.

**Invites.** `room + seat digit` (17 characters), in a link like `.../j/#<code>`. The `#` part never reaches a web server. Settings come from the
`meta` row. iMessage and Slack previews fetch the page without the `#` and run no JS, so the preview is static OpenGraph tags in `j/index.html`.
The preview cannot be tested from here: check it by sending a fresh link to yourself after a deploy (previews are cached).

**Friends-only trust.** No accounts, so anyone who has a game's name can read and write it. Say so in the UI and docs. "Only the host can skip"
is a convention, not a server rule. Per-game write keys would be the next step if that stops being acceptable.

## Tank Wars and the adventures

**Tank Wars** keeps hills as one integer height per column (no overhangs: a hole lowers the column, so dirt always "falls"), wind, and one `flight()` that walks a shell
step by step. The UI replays the path the rules returned, so animation and result cannot disagree. The computer players search every angle and power on the *real* `flight()` and then add error by level, so they
cannot drift from the rules. It uses its own series for sin/cos (`sinD`), because `Math.sin` can differ in the last bit between engines; `tests/portability.test.js` bans it there.
Weapon and item names come from the player's saved game too: look them up with `has()`, never `WEAPONS[name]` (`'constructor'` is a key).
Every round picks one of five kinds of land, puts tanks anywhere (not closer than a gap), and gives each tank a random starting aim and a random first shooter, so a memorised angle and power stops working. Maps are 320, 480 or 640 wide (`s.w`);
a shell's speed grows with the width (`s.speed`) so a full-power shot can always cross. Games saved before widths existed have no `w` and load as 320.

**Tank Wars online** (`tankwars/online.js`) is lockstep, like Sector Dominion: each browser holds the whole game. `meta` (create-only) has the seed, width, rounds and seats. `m-<n>-<seat>` (create-only) is shot number `n`, carrying angle, power, weapon and a hash;
`b-<round>-<seat>` is a seat's shopping; `p-<seat>` is presence. Computer seats need no entries (every copy works out their shots the same way, from the seeded state). The hash is taken *after* the shooter's aim is set, because a person's aim lives in the game state
(and changing it must never touch the random numbers: aim on a clone). A friend gone quiet can be replaced for one turn by `{ ai: 1 }`, which any player may post. A refresh rebuilds the game by replaying from the store (`sync({ skipRoundOver: true })`), reading shots in batches.
Seats are 1-based in keys and invites and 0-based in the game. If a change would make an old game replay differently, bump `RULES` in `online.js`. Invites are `.../tankwars/#<room><seat digit>`; there is no link preview page for them.

**Adventure engine** (`shared/adventure.js`). A game is data: `items`, `rooms` (each with `back()` that draws, `exits`, `blocks` the hero cannot walk on, `objects`) and handlers keyed by canonical verb
(`verbs: { take, open, use: { rope: fn }, give: { coin: fn } }`). For two-thing commands the handler lives on the thing acted upon, keyed by what is used on it. The parser maps many words to one verb (see `VERBS`).
`g.die(text)` ends the game with a message; the page offers "Try again" from a checkpoint taken when you *leave* a room, so a death in the next room puts you back outside it. Score is `g.score(n, key)`, once per key.
- State is JSON (`room`, position, `inv`, `flags`, `drops`). Flags are stored in a null-prototype object and `cleanState` checks everything read back; add a hostile case to `tests/adventure.test.js` if you add a saved field.
- Nothing in the engine uses randomness. Animations in `back()` may use `Math.sin`; rules may not.
- Each game has a scripted walkthrough in `tests/walk-<game>.js` (a win with every point, and a list of ways to die). Add to both when you add a puzzle. The tests also check that every clickable thing can be walked up to and every exit can be walked to,
  and fuzz random commands. `maxScore` must equal what the walkthrough earns.
- Art is code (`adventure-art.js`, 16 EGA colours, dither for extra shades), 160 x 100, scaled up with `image-rendering: pixelated`. Objects with a `draw()` are sorted by `base` (or the bottom of `rect`) against the hero, so the hero walks behind and in front of things.
- A game can set `music` (a mood for `Sound.mount`, default `'storybook'`) and `hero` (its own sprite function, same arguments as `AdvArt.hero`), or `musicFor(g, { intro })` to pick the loop by scene (Star Sweeper).
- **HD-2D pictures** (`def.hd`, Star Sweeper only so far). The world stays 160 x 100; pictures are drawn at 480 x 300 by `shared/hd2d.js` (no DOM, runs under node) with
  shaded shapes in world units (`rect`, `rrect`, `ell`, `poly` with `cyl`/`vcyl` rounding, `shadow` for contact shadows, `text`, `stars`), more than 16 colours (ramps of eight
  shades per material), and real lights (`c.light`), worked out on a quarter-size map and banded. `shared/hd2d-post.js` is the camera: depth of field around the hero, bloom,
  light shafts (`c.shaft`), dust, fog, tint, vignette. Each room picks a `look` (`hd2d`, `golden`, `mystery`, `diorama`, `neon`); a game adds its own materials and looks with `HD2D.addMaterials` and `HD2D.addLook` instead of editing `hd2d.js`. Sky and space are `unlit`; things you can use get
  `outline`. The room background is cached for 0.1 s and redrawn only when the state changes, so moving the hero is cheap. **Effects** (top bar, or the help dialog on phones)
  turns the camera off for slow phones. `room.back`, objects' `draw` and `def.hd.hero` get the HD scene, not an `AdvArt.Pix`; the test draws every room with `HD.render`.
- A room entered only by a handler (`g.goto`) and not by an edge, like landing the pod, can say so with `reachedBy`; the reachability test starts from those rooms too.
- Phone: the verb buttons plus the inventory do everything the keyboard does. Tapping a thing looks at it; pick Use or Give, then tap what you carry, then the target.

**Two ways to host a game.** Browsers hold the rules (lockstep, `/kv`, Sector Dominion) when friends are playing and cheating does not matter. The server holds
them (`/lab`, `elf-punch/src/lab/`) when players share one world or the score has to be real. A lab game is one `Game` impl (copy `clicker.rs`); the lab handles players, tokens, saving
and limits. The client is only a screen: never decide anything in it. Lab games keep time-based state lazy (timestamps, brought up to date on access) so the machine can sleep.
Players are a name plus a secret token (stored hashed, kept in localStorage); losing it loses the player. Everything in a request is untrusted, and refused actions must change nothing.
Deploying `elf-punch/**` to main restarts the server, which reloads the lab from `/data/lab`.

## Testing

```
npm test                                   # unit, property, fuzz, lockstep (fake store)
verification/run-tlc.sh                    # TLA+ models (needs Java)
cd elf-punch && cargo test --release       # server (store and lab rules)
cd elf-punch && npm test                   # server over HTTP: world, /kv, /lab (needs the release build)
```

Run the store-backed suites against the real binary too. Raise the limits or the suite trips the per-address ones (CI does the same):

```
export PORT=8135 WORLD_FILE=/tmp/w.json KV_DIR=/tmp/kv KV_IP_REQ_PER_MIN=1000000 KV_IP_WRITE_PER_MIN=1000000 \
  KV_NS_REQ_PER_MIN=1000000 KV_NS_WRITE_PER_MIN=1000000 KV_IP_NEW_NS_PER_HOUR=1000000 KV_NEW_NS_PER_DAY=1000000 KV_NS_COUNT=100000
elf-punch/target/release/elf-punch &
KV_URL=http://127.0.0.1:8135 node --test tests/lockstep.test.mjs tests/roster.test.mjs tests/tankwars-online.test.mjs
```

**Verification approach.** TLA+ for protocol and roster questions (races, who may do what, derived views that can disagree). Property and fuzz tests on
the real JavaScript for arithmetic, hostile input and invariants. A model that "must fail" for a known-bad design (`must_fail` in `run-tlc.sh`)
proves the model can see the bug. When a bug turns up, add the property to the model or the fuzz tests so the whole class is covered, not just the one case.

**Browser checks.** Playwright with Chromium (`/opt/pw-browsers/chromium`, global `NODE_PATH=$(npm root -g)`). Emulate a phone with `devices['iPhone 13']`
and serve the repo with `python3 -m http.server`. To use a local server in place of Fly, route `https://elf-castle-wood-puncher.fly.dev/**` to it
with `route.fetch({ url })` and add CORS headers. Open several browser contexts to play as several people. Look at screenshots, not just assertions.
Only Chromium has been tried, not Safari or Firefox.

Shell gotcha: `pkill -f <pattern>` can match and kill your own shell command. Use `pkill -x name` or bracket the pattern.

## Intro videos

`sectordominion/intro.mp4` and `warptraders/intro.mp4` (with `intro.jpg` posters) are made by scripts that play the real game in headless Chromium:
`node tools/video/sectordominion.js` and `node tools/video/warptraders.js`. Needs Playwright, ffmpeg and python3 with numpy, a local elf-punch
(the friends scenes use it; see Testing) on port 8135 (`KV_PORT` to change), and takes a few minutes. Rerun them after changing the UI they show.

- `lib.js` records Chrome's screencast (full-quality frames with timestamps, not Playwright's low-bitrate recorder), adds captions, a ring to point at things, a visible cursor
  and ripples, title and end cards, then encodes with ffmpeg. Overlays live in a popover so they stay above open dialogs. The page is zoomed (CSS `zoom`) so text reads at video size.
- `music.py` makes the soundtrack from scratch with numpy (no samples, no licences): a loop plus click and hit sounds placed where the script clicked.
- `common.js` serves the repo as `https://jroes.github.io/experiments/` and routes the store to the local server, so the videos show the real address.
- The scripts use a fixed seed so the run is repeatable: Sector Dominion seed 10 (an empty world and natives close to the capital), Warp Traders seed 112 (a three-turn loop with no pirates that doubles the money; found by searching seeds with the game code).
- Map clicks are computed with the game's own fit rule. Dispatch `resize` first so the game refits to what is on screen.
- Videos are a few MB each and live in git, so do not regenerate them for small changes.

## Reviewing a player's game

The side panel has **Export game**: the game as one JSON file (no room name, server or link in it, so it is not a way into a game with friends). Someone can send it for a review.
`node tools/review.js export.json [--world Name]` prints who has what, the worlds near the player (owner, defense, garrison), recent battles, and optionally what the player's biggest
garrison would meet at a world. Battle reports in the log list both sides, including the world's own defense, so a fight can be understood afterwards. `Game.estimateBattle` is the same
arithmetic as a real fight (attack times hull, tested against 160 real fights), used for the target tooltip and the "this looks like a losing fight" warning.

## Deploys and updates

A deploy is a static copy of the repo on GitHub Pages. The workflow stamps the commit into `shared/version.js` (what each page was built from) and `version.json` (what is live now).
`shared/update.js` asks for `version.json` every 5 minutes while a page is visible (and when it becomes visible again). If it differs, a bar at the top says a new version is ready,
with **Refresh** and **Later**. It never reloads by itself, so it cannot interrupt a turn. `shared/version.js` says `dev` as committed, which turns the checks off locally.

Nothing should be lost on an update:
- Everything is saved as it happens (every action, when the page is hidden or closed, and every 20 s), and Refresh saves once more first.
- **Saved data must stay readable by newer code.** Games, sessions, settings and links carry a version. If you change a saved shape, keep reading the old one (or migrate it), and bump the version only when you must.
- A game that cannot be read is never deleted. It stays in the list as "Could not be read", so a later fix or going back can still open it. This matters most for `RULES`: a bump means older games replay differently, and the code refuses to guess.
- Two versions can be open at once (two tabs, two devices, a friend who has not refreshed). Anything shared through the store must tolerate that: new fields are optional, unknown fields are ignored, and `cleanEntry`, `cleanGame` and the others already drop what they do not recognise.

## Sound

`shared/sound.js` makes every sound in the browser with Web Audio (oscillators and noise): no files, no licences. Short effects for things that happen (a friend joins or
leaves, a turn plays, a build, a launch, a world settled, a battle, winning or losing) and a very quiet generative space ambience that is **off until the player turns it on**.
Settings (effects, music, volume) are saved on the device under one key shared by all the games. Rules for adding sounds:

- Music has moods: `Sound.mount(button, { music: 'march' })` (Tank Wars) or `'storybook'` (the adventures); the default is the space ambience. Star Sweeper switches between four step-sequenced loops (`chase`, `fm`, `pursuit`, `curious` in `STEP_TRACKS`) with `Sound.setMusicStyle`, which crossfades. Keep a new loop near -37 dB RMS like the others (render it in an `OfflineAudioContext` in Chromium and measure). Each mood has its own loop and its own level in `STYLE_GAIN`. The same sound within 90 ms plays once, except `adjust` (the click on angle and power) which allows 30 ms.
- Sounds only listen to what the page already knows. They never touch game rules or state. Play them from UI code (`Sound.play('join')`), never from `game.js`.
- Browsers only allow audio after a tap or key press, so the context is made on the first one. Nothing plays before that, and that is fine.
- Opening or switching to a game must be silent: set the baseline first (`quietBaseline()` in Sector Dominion), then play sounds for what changes.
- Music stops while the page is hidden. Same sound twice within 90 ms plays once.
- Add a new sound in `SOUNDS` in `sound.js`, then run the offline render check (peak under 0.95, not silent, no NaN) and keep it well under the loudest ones. Effects sit about 15 to 20 dB above the music.
- Check levels, not taste: nobody can listen to it in the sandbox. Ask the owner to listen after a deploy.

## UI conventions

- Works on a phone first: 16px fields (iOS zooms smaller ones), 40px tap targets on coarse pointers, `100dvh`, safe-area padding, the main action pinned to the bottom, map with one-finger pan and pinch zoom.
- Dialogs are `<dialog>`; they scroll when tall. Keep first-run flow short: name (once), then the intro, then any link in the URL.
- A game in progress is saved to localStorage as soon as it exists, and again when the page is hidden. A refresh must never start a new game.
- Help should say what things are for, not just list controls. Ship stats in the help table come from the rules, so they cannot drift.
- Copy that mentions limits or trust (friends only, links are private, copies diverge) belongs in the dialog where the choice is made.

## Adding a game

Folder with `index.html`, `game.js` (no DOM, runs under node), `ui.js`, `style.css`. Add it to the root `index.html` and README, give it
property/fuzz tests in `tests/`, make it deterministic if it will ever be played in lockstep, and use `shared/store.js` for anything shared.
