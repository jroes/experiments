# Tank Wars

Browser-only artillery game. Two to four tanks on a hill, one shell at a time. Original code and art, inspired by the old DOS artillery games. No build step.

- `game.js`: rules and computer players, no DOM, runs under node.
- `ui.js`: canvas picture, controls, shop.
- Saves to `localStorage` only. A refresh keeps your game.

## Playing

Angle 90 is straight up, 0 is right, 180 is left. Wind pushes shells sideways. Shells dig holes, and a tank falls when the ground goes from under it. Drag on the picture to aim, or use the buttons or keys.
Money comes from hitting tanks and winning rounds. Between rounds, the shop sells big shells, triples, a nuke, dirt bombs and shields.

Mix people and computers (Easy, Medium, Hard) on one screen. A seed gives the same hills, so you can play the same maps as a friend.

## How the computer plays

It tries every angle and power on the same flight code the game uses, keeps the one that lands nearest, then adds some error. Hard is off by a degree or two at most. Easy is off by plenty.

The Sound button turns effects on or off. There is no music for this one.
