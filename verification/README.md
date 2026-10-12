# Verification

Two layers. Neither one is a proof that the game has no bugs.

## History worth keeping

An earlier live (peer-to-peer) mode of Sector Dominion had its turn handshake model-checked with TLA+. It found a real bug: with no turn number
on messages, a double-clicked "End turn" could leave a second `ready` in flight when the turn advanced, and the host counted it for the
next turn. The fix was to tag orders with the turn they were issued in and have the host reject stale ones. That live mode is gone (online
play through the shared store replaced it), but the rule stayed in `Game.apply` and has a regression test, because lockstep play needs it too.

## 1. TLA+ model of online play through the shared store (`LockstepBoard.tla`)

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

Run it: `verification/run-tlc.sh` (needs Java).

## 1b. TLA+ model of seats and invite links (`SeatRoster.tla`)

Handing a seat to the AI takes two steps: the host posts an entry, then the turn plays. In between, the game still calls the seat human. A
real bug came from that gap: the host gave a player to the AI and the invite list still offered a link for that seat. The model checks:

- `NoLinkToAI`: while the host sees the links, none is for an AI seat or one about to become AI.
- `NoJoinOfAI`: nobody joins such a seat.
- `AIIsFinal`, `OutIsFinal`: an AI seat never goes back to a person, and a wiped-out empire never comes back.
- `JoinedAreTold` (liveness): someone who joined and then lost their seat to the AI is eventually told.

Three more configs must **fail**, which shows the model can see the bug: `SeatRoster_all.cfg` (list built from every seat, the first version),
`SeatRoster_base.cfg` (list built from the game alone, ignoring the pending entry) and `SeatRosterNoGuard.cfg` (joining does not check the seat).
Writing the model also found a gap in its own first draft (a take-over aimed at a seat that had just been wiped out), which the code already handled.

The same rules are tested on the real code in `tests/roster.test.mjs`: random games where the host hands seats to the AI, checking that every browser agrees on
every seat's role, that `invitable()` is exactly the seats a person still plays, that nobody can join an AI seat, and that roles only move forward.

Nothing here covers presence (who is online): it is display only and cannot change the game.

What this does not cover: the JavaScript itself, more than three seats or three turns (it is a bounded check), or cheating. Every
player's browser sees the whole game state, so this is built for friends, not for adversaries.

## 2. Property and fuzz tests on the real code (`tests/`)

`npm test`. These run the actual `game.js` files:

- Invariants after every action over hundreds of random games (no negative or NaN credits, cargo and ship counts are
  non-negative integers, holds never exceeded, dead empires own nothing, port stock stays in range, ...).
- Same seed and same moves give the identical game, also after a JSON save and reload in the middle.
- Hostile commands (junk types, NaN, huge numbers, `__proto__`, wrong owner) never throw and a rejected command never changes state.
- A player cannot touch another empire's worlds, credits or tech.
- Trading has no free money at a single port.
- Regression test for the stale-ready bug above.
- A game moved to another device is checked by `validState` and a table of broken copies (`tests/roster.test.mjs`). Running those tests against the real server found that it can change the last digit of a stored decimal, so the copy is stored as text.

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
