# Sector Dominion

A turn-based space empire game that runs entirely in the browser. Original code and art, inspired by classic 4X space strategy games.

Play: open `index.html`, or visit the GitHub Pages URL. No build step, no server, no dependencies.

- `game.js`: game rules, AI, combat. No DOM, runs under node too.
- `ui.js`: canvas map and sidebar.
- `games.js`: the list of games on this device (no rules in it, tested under node).
- Your current game is saved to `localStorage` as soon as it starts, so a refresh brings it back. Solo play sends nothing anywhere.
- Sound: short effects when friends join or leave, turns play, you build or launch, worlds fall, and the game ends, plus a very quiet space ambience that is off until you turn it on (the Sound button). Made in the browser, no files.
- Works on phones: the map pans with one finger and zooms with a pinch, and End turn stays at the bottom of the screen.
- `intro.mp4` is a 90-second intro video, made by `tools/video/sectordominion.js` (see `CLAUDE.md`). The Help button has a link to it.
- Help (the Help button) has a first-turns walkthrough and a table of what each ship is for. A short tip also shows in the world panel for the first turns.
- You can set a name. It is saved on this device and friends see it next to "online".
- `../j/index.html` is the invite landing page, and `../tools/` makes the link-preview images.

## Several games at once

The **Games** button lists every game on this device, solo and with friends, and you can start as many as you like (up to 24) and switch between them.
A game with friends that is waiting on you shows a "your move" tag, and a count on the button for the ones you are not looking at. Games you are not in are
looked at every 30 seconds while the page is open, and again when you open the list. Only the game on screen checks in as "online" and polls quickly.

Each game is saved under its own key (`games.js` keeps the index), so one game cannot damage another. Games from the older single-game version are kept: they
become entries in the list the first time the page loads. Opening a link for a game you are already in just switches to it. Deleting a game with friends only
removes it from this device. It stays on the server, and the link still works.

## Fights and exports

A world's defense (fortification plus population divided by 25) counts as one unit with attack 2 and hull 8 per point, so unarmed ships cannot hurt it. Battle reports list both sides.
While you pick a target, the tooltip says whether the fight looks like a win, a close one or a loss, and sending a fleet that would lose asks first. **Export game** (side panel) gives
the game as a file or text; `tools/review.js` reads it.

## Updates

When a new version is deployed, a bar at the top says so, with Refresh and Later. Nothing reloads on its own. Your games are saved after every action, when the page is hidden or closed,
and every 20 seconds, and Refresh saves once more before it reloads. A game that a newer version cannot read is kept in the list as "Could not be read" and never deleted.

## Friends online

The chip in the top bar (`● 2 online`) counts the friends who are around right now, over every game with friends you are in. The Games list shows who, with a button to open
the game. When a friend hops on you hear it and see a small notice wherever you are, even in a solo game or a different game, and in a hidden tab the tab title says so too
(a hidden page keeps checking in the background, slowly). Being on the page is what makes you online in all your games, not only the one that is open.

## Link another device

The **Link another device** button (bottom of the side panel) shows a QR code and a private link. Opening it on your phone (or another computer) links that device to this one, a bit like signing in without an account:

- Your name comes along.
- Every game with friends you are in shows up there, in the same seat, and games you start or join on either device later show up on both. Each device checks the shared list once a minute. Both devices can be open at once: orders from either count, and the first to send wins the turn.
- Solo games are copied once when the link is shown. After that the two copies go on separately, so pick one to keep playing.
- Removing a game on purpose on one device stops it coming back there. It stays on the other device.
- Opening the same link again adds nothing twice.

How it works: the link is `d-` plus a random 16-character name for a small shared record in the store. It holds `games` (a list of `{ room, seat }`, added to with a compare-and-set so two devices adding at once never lose one), `profile` (the name) and `solo-<n>` (the solo copies, stored as text because the server may change the last digit of a stored decimal). Everything read from it is checked before use (`Online.Link.open`, `Game.validState`). It expires after 60 days without writes like any game, and showing the link again refreshes it.

Anyone who has the link gets all your games, so keep it private, same as an invite. There are no accounts, so this is the whole identity story.

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
convention in the game and not a server rule. A seat can be handed to the AI by the host. After that its link no longer works, it is left out of the invite list, and the player's page says what happened. `Session.seatState` is the one place that decides who plays a seat, and `verification/SeatRoster.tla` checks the rules around it.

If a game ever needs real protection, the next step is a write key per namespace on
the server. "Online" is only as good as the 45-second check-in: it is a hint for people, not something the game depends on.

Cost: while someone has a game page open, the server machine stays awake (it normally stops when idle), a few requests a minute per
player. The server's own limits apply (see `elf-punch/README.md`): about 100 orders per turn, 240 requests and 90 writes a minute per
game, 4 MB per game. This has only been tried in Chromium-based browsers, so if players use different browsers and get a desync
warning, say so.
