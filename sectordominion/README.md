# Sector Dominion

A turn-based space empire game that runs entirely in the browser. Original code and art, inspired by classic 4X space strategy games.

Play: open `index.html`, or visit the GitHub Pages URL. No build step, no server, no dependencies.

- `game.js`: game rules, AI, combat. No DOM, runs under node too.
- `ui.js`: canvas map and sidebar.
- Your current game is saved to `localStorage` as soon as it starts, so a refresh brings it back. Solo play sends nothing anywhere.
- Works on phones: the map pans with one finger and zooms with a pinch, and End turn stays at the bottom of the screen.
- `../j/index.html` is the invite landing page, and `../tools/` makes the link-preview images.

## Play with friends

One flow for everyone, whether your friends are online right now or will not be for days. Nothing to set up: it keeps its state in the
small shared key/value store that runs with `elf-punch/` (https://elf-castle-wood-puncher.fly.dev).

1. One person clicks Play with friends, chooses the number of players and clicks Create.
2. A box opens right away with one short link per friend (like `https://jroes.github.io/experiments/j/#k3x9q2m7a1b4c8d62`). Each link is one seat. Send them privately.
3. Friends open their link and they are in, with nothing to type. Everyone plays from their own browser.
4. You give your orders and click Send orders. When every player's orders are in, each browser plays the turn itself.
5. If someone is gone, the host can skip them for a turn, or hand their empire to the AI for good.

**Online or not, it just works.** Open pages check in every 15 seconds, so each page knows who is around. The panel shows who is
online now and who was last seen when, and the log says when someone comes online or goes offline. When someone else is online your
page looks for their orders every 3 seconds, so a turn plays almost at once. When nobody is, it slows down (and after 20 minutes
to once a minute), and the page says plainly that the game keeps going: it is saved, you can close the page, and you will see the new
turn when you come back. There is no separate "live" mode and no connection to set up. A tab that is in the background shows a
"(new turn)" title when something happened.

Your copy is saved in your browser, and the store keeps the full log, so you can also join from another device with the same
invite link. Rebuild replays the whole game from the log.

How it stays in sync: the game is deterministic (seeded random numbers, exact arithmetic), so the same orders always give the same
result. Each set of orders carries a hash of the sender's game. If two hashes ever differ, you get a warning instead of silently
playing different games. The write-once board is checked by `verification/LockstepBoard.tla`, and the sync is tested in
`tests/lockstep.test.mjs`, against a fake store and against the real elf-punch server.

How a game is kept private: a game is one namespace with a 16-character random name (about 82 bits) that only the invite links
contain, and the server will not list keys, so you can only read what you already know the name of. Nothing secret goes in it, and
a game you stop playing is deleted after 60 days with no writes.

Invite links: the code is the room name plus one digit for the seat. The game's settings (players, difficulty, size, seed) are in the
game's `meta` row in the store, so the link stays short. The code sits after the `#`, so browsers never send it to any web server.
Link previews (iMessage, Slack, and so on) fetch the page without the `#` and do not run scripts, so the preview is the same for
every invite: a title, a line of text and the picture from `j/invite.png`, set with OpenGraph tags in `j/index.html`.
Regenerate the pictures with `node tools/make-og.js` (needs Playwright and Chromium).

What this does not do: there are no accounts, so anyone who has a game's name can read it and write to it. That means friends only.
Everything read back is validated before use, a stranger's junk in a slot is ignored and replaced by the real owner, and orders have to
match their seat and turn, but a player who really wants to could post orders for someone else, and "only the host can skip" is a
convention in the game and not a server rule. If a game ever needs real protection, the next step is a write key per namespace on
the server. "Online" is only as good as the 45-second check-in: it is a hint for people, not something the game depends on.

Cost: while someone has a game page open, the server machine stays awake (it normally stops when idle), a few requests a minute per
player. The server's own limits apply (see `elf-punch/README.md`): about 100 orders per turn, 240 requests and 90 writes a minute per
game, 4 MB per game. This has only been tried in Chromium-based browsers, so if players use different browsers and get a desync
warning, say so.
