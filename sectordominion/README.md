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
