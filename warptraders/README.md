# Warp Traders

Browser-only space trading game. Fly between sectors, buy low, sell high, dodge pirates, beat the turn limit. Original code and text, inspired by the classic BBS trading games. No build step.

- `game.js`: rules, no DOM, runs under node.
- `ui.js`: canvas map and side panel.
- Saves to `localStorage` only.

## Race friends

Click Race friends, then Host. Everyone gets the same galaxy and turn count and a live scoreboard. Same browser-to-browser connection as Sector Dominion (see `../shared/`). Scores come from each player's own browser, so it is friends-only.

## Challenge seeds (play on your own time)

Starting a new game asks for a seed. Everyone who uses the same seed gets the same galaxy and the same starting markets, so you can play whenever you like and compare scores. When a run ends, Copy result to share gives you a one-line result to post. Runs are deterministic: the same seed and the same moves always give the same outcome.

`intro.mp4` is a one-minute intro video, made by `tools/video/warptraders.js` (see `CLAUDE.md`). The Help button has a link to it.

The Sound button turns effects (warps, trades, pirates) and a very quiet space ambience on or off. The ambience is off until you turn it on.

When a new version is deployed, a bar at the top says so. Refresh saves your run first.
