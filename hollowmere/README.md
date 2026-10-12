# The Crown of Hollowmere

A small fairy-tale adventure with a text parser. The old king is gone and the three royal treasures are lost. Bring them back to the steward. Original story, code and art, inspired by the old Sierra adventures. No build step.

- `game.js`: the whole game as data (rooms, items, puzzles). Runs under node.
- The engine is in `../shared/adventure.js`, the picture code in `../shared/adventure-art.js`, the page in `../shared/adventure-ui.js`.
- Saves to `localStorage` only. Type `save` for a copy you can restore later.

Walk with the arrow keys or click. Type commands (`look`, `take rope`, `use rope on well`, `give coin to crow`) or use the buttons. Some things here will kill you. You can try again from where you were.
It is worth 100 points. `tests/walk-hollowmere.js` is a full playthrough, so spoilers are in there.
