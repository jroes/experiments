# Star Sweeper

A small science-fiction adventure. You are the junior custodian on the research ship Pemberton, and you slept through the evacuation. Get off the ship, cross a desert planet, and pay for a ride home. Lots of ways to die. Original story, code and art, inspired by the old Sierra space adventures. No build step.

- `game.js`: the whole game as data (rooms, items, puzzles), plus the custodian sprite. Runs under node.
- The engine is in `../shared/adventure.js`, the picture code in `../shared/adventure-art.js`, the page in `../shared/adventure-ui.js`.
- Saves to `localStorage` only. Type `save` for a copy you can restore later.

Same controls as the other adventures, plus `mop` (or `clean`, `wipe`). It is worth 100 points. `tests/walk-starsweeper.js` is a full playthrough, so spoilers are in there.
