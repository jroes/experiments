# Sector Dominion

A turn-based space empire game that runs entirely in the browser. Original code and art, inspired by classic 4X space strategy games.

Play: open `index.html`, or visit the GitHub Pages URL. No build step, no server, no dependencies.

- `game.js`: game rules, AI, combat. No DOM, runs under node too.
- `ui.js`: canvas map and sidebar.
- Saves go to `localStorage` in your browser. Nothing is sent anywhere.

## Multiplayer

Up to 4 players, no server. Click Multiplayer, then Host. Add a friend, send them the invite code, paste their reply code back. Empires nobody takes stay AI. Everyone ends their turn and the host plays it. If a friend leaves, the host can drop them and the AI takes over.

Connection is WebRTC. It uses a public STUN server (Google's) so browsers can find each other; the game itself never goes through a server. Strict corporate networks or some mobile carriers may block direct connections.

The host holds the real game and checks every order from guests. The full state is sent to everyone, so this is for friends. It is not cheat-proof.

## Play by mail (come back later)

Live multiplayer needs everyone online together. Play by mail doesn't. Click Multiplayer, then Play by mail.

1. The host starts a game and downloads a turn file for each friend, then sends it over Discord, email, anything.
2. A friend loads the file (Multiplayer, Play by mail, load file), plays their turn as normal, hits Send orders, and sends the short orders code back.
3. The host pastes each code into the Mail panel. When everyone is in, the turn plays. The host can also play the turn without waiting, and anyone missing does nothing that turn.
4. The host downloads the next turn files and the cycle repeats.

Everything is saved in your browser, so you can close the tab and pick it up days later. The host's orders codes are replayed through the same rules as live play, so a friend can't give orders for someone else's worlds. Turn files hold the full game state, so it's friends-only.

## Play online, any time

This is the one for a group that can't all be online together. Nothing to set up: it keeps its state in the small shared key/value
store that runs with `elf-punch/` (https://elf-castle-wood-puncher.fly.dev).

1. One person picks Multiplayer, then Play online, chooses the number of players and clicks Create.
2. They get one invite code per friend. Each code is one seat. Send them privately.
3. Friends paste their code under Join. Everyone plays from their own browser, whenever they like.
4. You give your orders and click Send orders. When every player's orders are in, each browser plays the turn itself and you all
   see the same new turn. The panel shows who you are waiting for, and the page checks for news every 15 seconds while you wait.
5. If someone is gone, the host can skip them for a turn, or hand their empire to the AI for good.

Your copy is saved in your browser, and the store keeps the full log, so you can also join from another device with the same
invite code. Rebuild replays the whole game from the log.

How it stays in sync: the game is deterministic (seeded random numbers, exact arithmetic), so the same orders always give the same
result. Each set of orders carries a hash of the sender's game. If two hashes ever differ, you get a warning instead of silently
playing different games. The write-once board is checked by `verification/LockstepBoard.tla`, and the sync is tested in
`tests/lockstep.test.mjs`, against a fake store and against the real elf-punch server.

How a game is kept private: a game is one namespace with a 24-character random name (about 124 bits) that only the invite codes
contain, and the server will not list keys, so you can only read what you already know the name of. Nothing secret goes in it, and
a game you stop playing is deleted after 60 days with no writes.

What this does not do: there are no accounts, so anyone who has a game's name can read it and write to it. That means friends only.
Everything read back is validated before use, a stranger's junk in a slot is ignored and replaced by the real owner, and orders have to
match their seat and turn, but a player who really wants to could post orders for someone else, and "only the host can skip" is a
convention in the game and not a server rule. If a game ever needs real protection, the next step is a write key per namespace on
the server.

Limits (the server's, see `elf-punch/README.md`): about 100 orders per turn, 240 requests and 90 writes a minute per game, 4 MB per
game. This has only been tried in Chromium-based browsers, so if players use different browsers and get a desync warning, say so.
