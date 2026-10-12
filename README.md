# experiments

Games and toys. Mostly browser-only static files with no build step; [elf-punch/](elf-punch/) is the exception, a small Rust server.

- [sectordominion/](sectordominion/): space empire 4X.
- [warptraders/](warptraders/): space trading.
- [tankwars/](tankwars/): artillery duels. Hills, wind, shields, a shop between rounds, computer players.
- [hollowmere/](hollowmere/) and [gullrock/](gullrock/): two small adventures in the style of the old Sierra games. Walk, type commands, try not to die.
- [shared/](shared/): the client for the shared key/value store, serverless peer-to-peer play (WebRTC, used by Warp Traders' race), and the adventure engine.
- [elf-punch/](elf-punch/): multiplayer survival toy in Rust, also a small shared key/value store (`/kv`) the other experiments can use from the browser.
- [verification/](verification/) and [tests/](tests/): TLA+ model of online play, plus property and fuzz tests. `npm test`, `npm run tlc`.

Sector Dominion is played with friends through the key/value store in `elf-punch/`. Friends join from a short link, and turns play when everyone's orders are in, online or not, with a note of who is around. Warp Traders has a live race over a direct browser-to-browser connection (swap codes, no server) and shared challenge seeds.

Live once GitHub Pages is on (Settings > Pages > Source: GitHub Actions):
https://jroes.github.io/experiments/

Working on this repo: see [CLAUDE.md](CLAUDE.md) for the patterns, testing and ground rules.
