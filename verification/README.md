# Verification

Two layers. Neither one is a proof that the game has no bugs.

## 1. TLA+ model of the multiplayer turn handshake (`TurnSync.tla`)

Checks the protocol design with TLC: a host and two guests, ordered reliable channels, guests that can
send ready/unready at any time, disconnect at any time, and a host that notices late and hands the empire to the AI.

Checked in every reachable state (about 123k states, 2 guests, 3 turns, queues of up to 3):

- `AdvanceNeededAll`: the turn only advances when every living human is ready.
- `ReadyIsFresh`: nobody is counted ready for a turn they had not yet seen.
- `NoStuckAllReady`: the host never sits in an all-ready state without playing the turn.
- `NoZombieReady`: a player handed to the AI is never counted ready.
- `GuestsCatchUp` (liveness): a connected guest eventually sees the current turn.

It found a real bug in the first version. Messages had no turn number, so a guest who double-clicked "End turn"
could have a second `ready` still in flight when the turn advanced, and the host counted it for the next turn.
`TurnSyncUntagged.cfg` reproduces that counterexample and is expected to fail. `TurnSync.cfg` is the fix (orders carry the turn
they were issued in, the host rejects stale ones) and passes. The real code does the same in `Game.apply`.

## 1b. TLA+ model of online play through the shared store (`LockstepBoard.tla`)

Checks the design of Sector Dominion's online mode: each player's browser holds its own game, players post orders to a
key that can only be created once, the host can post a skip for someone who has not answered, and a browser plays a turn once
every seat has an entry.

- `Agreement`: two browsers that both played turn t played it from identical entries.
- `NoGaps`: a turn is only played when every seat had an entry.
- `EntriesNeverChange`: an entry on the board is immutable.
- `EveryoneFinishes` (liveness): if players keep answering and browsers keep checking, everyone reaches the end.

`LockstepBoardNonAtomic.cfg` models a store where writes can overwrite each other (an eventually consistent key-value
store, or a client that does not use create-only). TLC finds the race: the host skips a player, one browser plays the turn with
the skip, then the player's late orders overwrite it and another browser plays the turn with the orders. That is why every
write to a turn's key uses `If-None-Match: *`, and why the elf-punch server has to stay on one machine.

What the model leaves out: the store has no accounts, so anyone who knows a game's name can write to it. Entries are validated when
read (`cleanEntry`), orders that do not match their seat and turn count as no orders, and a stranger's junk in a slot is replaced by
the real owner, but a determined player who knows the name could still post a valid set of orders for someone else. It is built for
friends. See `sectordominion/README.md`.

Run both models: `verification/run-tlc.sh` (needs Java).

Play by mail is not in the TLA+ model. It has no concurrent messages to race: orders are replayed one code at a time through the same validated `Game.apply`, a repeated or wrong-turn code is refused, and `tests/` checks that the host's replay matches what the friend previewed.

What this does not cover: the JavaScript itself, WebRTC, more than two guests or three turns (it is a bounded check),
or cheating. A guest browser and the host both see the full game state, so this is built for friends, not for adversaries.

## 2. Property and fuzz tests on the real code (`tests/`)

`npm test`. These run the actual `game.js` files:

- Invariants after every action over hundreds of random games (no negative or NaN credits, cargo and ship counts are
  non-negative integers, holds never exceeded, dead empires own nothing, port stock stays in range, ...).
- Same seed and same moves give the identical game, also after a JSON save and reload in the middle.
- Hostile commands (junk types, NaN, huge numbers, `__proto__`, wrong owner) never throw and a rejected command never changes state.
- A player cannot touch another empire's worlds, credits or tech.
- Trading has no free money at a single port.
- Regression test for the stale-ready bug above.

Tests also found a hole in Sector Dominion that had already shipped: a `build` order with the ship type `"constructor"` made credits `NaN`, after which everything was free. Keys that come from players now go through own-property checks, and a regression test covers them. They found four real bugs in Warp Traders while this was being written: a `NaN` quantity corrupted cargo, `buyFighters(NaN)` did the same, a
buy-then-sell round trip at one port made a small profit that grew with the square of the amount, and fleeing a pirate on the last turn made
turns go negative. They are fixed and covered. A seed also used to give a different galaxy in different browsers (a random sort comparator), which is fixed and tested.

## Why not Lean or Coq

Lockstep also depends on every browser computing identical numbers. That is not something TLA+ can say. `tests/portability.test.js`
bans `Math.hypot`, `Math.pow` and other functions engines may round differently, and checks that the same seed builds the same
world under a different sort algorithm. It has only been exercised on V8 (Chrome, Node). Firefox and Safari have not been tried,
so the state hash after every turn is the safety net: a mismatch is flagged, and Rebuild replays the game from the board.

A machine-checked proof of the real JavaScript would mean rewriting the rules in Lean and proving the rewrite correct. The
interesting risks here are races between peers (TLA+ is the better fit) and arithmetic edge cases (the fuzzer finds those quickly).
If one piece deserves a proof later, the price curve and its no-arbitrage property is the best candidate.
