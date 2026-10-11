# Anacreon (browser)

A turn-based space empire game that runs entirely in the browser. Inspired by the old DOS game Anacreon. Not affiliated with it, and no original code or art is used.

Play: open `index.html`, or visit the GitHub Pages URL. No build step, no server, no dependencies.

- `game.js`: game rules, AI, combat. No DOM, runs under node too.
- `ui.js`: canvas map and sidebar.
- Saves go to `localStorage` in your browser. Nothing is sent anywhere.

Quick node check of the rules: `node -e "const G=require('./game.js');const s=G.newGame({seed:1});for(let i=0;i<50;i++)G.endTurn(s);console.log(s.turn)"`
