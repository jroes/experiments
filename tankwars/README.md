# Tank Wars

Artillery game in the browser. Two to four tanks on a hill, one shell at a time. Original code and art, inspired by the old DOS artillery games. No build step. Play on one screen, or online with friends.

- `game.js`: rules and computer players, no DOM, runs under node.
- `online.js`: play with friends through the shared key/value store, no game server.
- `ui.js`: canvas picture, controls, shop.
- A game on one screen saves to `localStorage`. An online game lives in the store, and a refresh rebuilds it.

## Playing

Angle 90 is straight up, 0 is right, 180 is left. Wind pushes shells sideways. Shells dig holes, and a tank falls when the ground goes from under it. Drag on the picture to aim, or use the buttons or keys.
Money comes from hitting tanks and winning rounds. Between rounds, the shop sells big shells, triples, a nuke, dirt bombs and shields.

Every round is different: five kinds of land, tanks placed anywhere, a random starting aim. Maps come in three widths.

Mix people and computers (Easy, Medium, Hard) on one screen. A seed gives the same hills, so you can play the same maps as a friend.

## How the computer plays

It tries every angle and power on the same flight code the game uses, keeps the one that lands nearest, then adds some error. Hard is off by a degree or two at most. Easy is off by plenty.


## Online

New game, tick Play online with friends. Seat 1 is you. Every other Human seat gets a link to send. Each person plays on their own screen and turns go in order. A dot by each name shows who is around. If a friend goes quiet, press Let the computer play to play their turn for them. A slow shopper can be skipped the same way.

Every browser keeps its own copy of the game and the shots are passed through the shared store, the same way as Sector Dominion. The rules are deterministic, so the copies stay identical. If two ever disagree you get a warning and can rebuild from the store.
There are no accounts: anyone who has a link can play that seat and can see and change the game. Keep links to friends. Games are kept for 60 days after the last move.

Sound: effects, a click as you adjust angle and power, and slow marching music that is off until you turn it on.
