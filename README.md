# experiments

Browser-only games. Static files, no build step. Original code, inspired by old classics.

- [sectordominion/](sectordominion/): space empire 4X.
- [warptraders/](warptraders/): space trading.
- [shared/](shared/): serverless peer-to-peer play (WebRTC) used by both games.
- [verification/](verification/) and [tests/](tests/): TLA+ model of the multiplayer turn handshake, plus property and fuzz tests. `npm test`, `npm run tlc`.

Both games can be played with friends, browser to browser, with no server. Sector Dominion also has play by mail (take turns whenever, saved in your browser), and Warp Traders has shared challenge seeds. The host sends each friend an invite code and they send a reply code back.

Live once GitHub Pages is on (Settings > Pages > Source: GitHub Actions):
https://jroes.github.io/experiments/
