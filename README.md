# experiments

Browser-only games. Static files, no build step. Original code, inspired by old classics.

- [sectordominion/](sectordominion/): space empire 4X.
- [warptraders/](warptraders/): space trading.
- [shared/](shared/): serverless peer-to-peer play (WebRTC) and the relay client used by the games.
- [relay/](relay/): optional tiny message board (Cloudflare Worker, or Node on Fly.io) for playing online across time zones.
- [verification/](verification/) and [tests/](tests/): TLA+ model of the multiplayer turn handshake, plus property and fuzz tests. `npm test`, `npm run tlc`.

Both games can be played with friends, browser to browser, with no server. Sector Dominion also has play by mail (take turns whenever, saved in your browser), and Warp Traders has shared challenge seeds. With a relay deployed (free, see `relay/README.md`), Sector Dominion can also be played online with everyone's turns arriving whenever. The host sends each friend an invite code and they send a reply code back.

Live once GitHub Pages is on (Settings > Pages > Source: GitHub Actions):
https://jroes.github.io/experiments/
