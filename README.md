# experiments

Games and toys. Mostly browser-only static files with no build step; [elf-punch/](elf-punch/) is the exception, a small Rust server.

- [sectordominion/](sectordominion/): space empire 4X.
- [warptraders/](warptraders/): space trading.
- [shared/](shared/): serverless peer-to-peer play (WebRTC) and the client for the shared key/value store.
- [elf-punch/](elf-punch/): multiplayer survival toy in Rust, also a small shared key/value store (`/kv`) the other experiments can use from the browser.
- [verification/](verification/) and [tests/](tests/): TLA+ model of the multiplayer turn handshake, plus property and fuzz tests. `npm test`, `npm run tlc`.

Both games can be played with friends, browser to browser, with no server. Sector Dominion also has play by mail (take turns whenever, saved in your browser), and Warp Traders has shared challenge seeds. Sector Dominion can also be played online with everyone's turns arriving whenever, through the key/value store in `elf-punch/` (nothing to deploy). The host sends each friend an invite code and they send a reply code back.

Live once GitHub Pages is on (Settings > Pages > Source: GitHub Actions):
https://jroes.github.io/experiments/
