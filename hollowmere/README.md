# The Crown of Hollowmere

A small fairy-tale adventure with a text parser. The old king is gone and the three royal treasures are lost. Bring them back to the steward. Original story, code and art, inspired by the old Sierra adventures. No build step.

- `game.js`: the whole game as data (rooms, items, puzzles). Runs under node.
- The engine is in `../shared/adventure.js`, the picture code in `../shared/hd2d.js` and `../shared/hd2d-post.js`, the page in `../shared/adventure-ui.js`.
- The pictures are HD-2D: fine pixel art lit by the sun, the fire and your lamp, with a little depth of field. Each place has its own light, from a gold evening at the castle to a cold, dark cave. If it runs slowly, turn Effects off.
- Saves to `localStorage` only. Type `save` for a copy you can restore later.

Walk with the arrow keys or click. Type commands (`look`, `take rope`, `use rope on well`, `give coin to crow`) or use the buttons. Some things here will kill you. You can try again from where you were.
It is worth 100 points. `tests/walk-hollowmere.js` is a full playthrough, so spoilers are in there.
