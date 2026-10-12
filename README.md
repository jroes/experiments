# experiments

Games and toys. Mostly browser-only static files with no build step; [elf-punch/](elf-punch/) is the exception, a small Rust server.

- [sectordominion/](sectordominion/): space empire 4X.
- [warptraders/](warptraders/): space trading.
- [shared/](shared/): the client for the shared key/value store, and serverless peer-to-peer play (WebRTC, used by Warp Traders' race).
- [elf-punch/](elf-punch/): multiplayer survival toy in Rust, also a small shared key/value store (`/kv`) the other experiments can use from the browser.
- [verification/](verification/) and [tests/](tests/): TLA+ model of online play, plus property and fuzz tests. `npm test`, `npm run tlc`.

Sector Dominion is played with friends through the key/value store in `elf-punch/`. Friends join from a short link, and turns play when everyone's orders are in, online or not, with a note of who is around. Warp Traders has a shared universe (one server-run galaxy for everybody, with other traders in it), a live race over a direct browser-to-browser connection (swap codes, no server) and shared challenge seeds.

Live once GitHub Pages is on (Settings > Pages > Source: GitHub Actions):
https://jroes.github.io/experiments/

Working on this repo: see [CLAUDE.md](CLAUDE.md) for the patterns, testing and ground rules.
