# Star Sweeper

A small science-fiction adventure. You are the junior custodian on the research ship Pemberton, and you slept through the evacuation. Get off the ship, cross a desert planet, and pay for a ride home. Lots of ways to die. Original story, code and art, inspired by the old Sierra space adventures. No build step.

- `game.js`: the whole game as data (rooms, items, puzzles), plus the art for every room and character. Runs under node.
- The pictures are HD-2D: fine pixel art lit by the room's lamps, then filmed like a model set (depth of field, bloom, light shafts, dust). See `../shared/hd2d.js` and `../shared/hd2d-post.js`. Each room picks a lighting look: a low golden sun in the hangar and at the crash, mostly dark in the closet and corridor, a tiny model in the dunes and at the spaceport, neon in the bar.
- The music follows you: a synth chase on the ship, chiptune for the crash and the bar's jukebox, something curious in the desert, FM at the spaceport and at the end. All made in `../shared/sound.js`, off until you turn it on.
- **Effects** turns the camera effects off if a phone struggles. Saves go to `localStorage` only. Type `save` for a copy you can restore later.

Same controls as the other adventures, plus `mop` (or `clean`, `wipe`). It is worth 100 points. `tests/walk-starsweeper.js` is a full playthrough, so spoilers are in there.
