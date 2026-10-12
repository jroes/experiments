# The Lamp at Gullrock

A small seaside adventure. The lighthouse lamp is out, the keeper is ill, a storm is coming and the supper boat is still out there. You need oil, a wick and a light. Original story, code and art, inspired by the old Sierra adventures. No build step.

- `game.js`: the whole game as data (rooms, items, puzzles). Runs under node.
- The engine is in `../shared/adventure.js`, the picture code in `../shared/adventure-art.js`, the page in `../shared/adventure-ui.js`.
- Saves to `localStorage` only. Type `save` for a copy you can restore later.

Same controls as Hollowmere: arrow keys or click to walk, type commands or use the buttons. It is worth 100 points. `tests/walk-gullrock.js` is a full playthrough, so spoilers are in there.
