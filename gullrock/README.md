# The Lamp at Gullrock

A small seaside adventure. The lighthouse lamp is out, the keeper is ill, a storm is coming and the supper boat is still out there. You need oil, a wick and a light. Original story, code and art, inspired by the old Sierra adventures. No build step.

- `game.js`: the whole game as data (rooms, items, puzzles). Runs under node.
- The engine is in `../shared/adventure.js`, the page in `../shared/adventure-ui.js`.
- The pictures are HD-2D, like Star Sweeper: pixel art drawn in code with `../shared/hd2d.js`, lit, with rain, spray and a turning beam once the lamp is lit. If it runs slowly, turn Effects off.
- Saves to `localStorage` only. Type `save` for a copy you can restore later.

Same controls as Hollowmere: arrow keys or click to walk, type commands or use the buttons. It is worth 100 points. `tests/walk-gullrock.js` is a full playthrough, so spoilers are in there.
