# Jetfall

Capture the flag with jetpacks and skiing, in the browser. In the spirit of the old Tribes games: original code, art and sounds.

- **Servers**: the game opens on a list of servers you can join. Click one to play.
- **Start a server**: your browser runs it, it shows in everyone's list (or not, if you untick it), and friends can also join with a 6-letter code or a link
  (`jetfall/#CODE`). Bots fill empty seats and step aside when people join. Keep the tab open: when you leave, the server goes away.
- **Practice offline**: just you and the bots, nothing on the network.

Two teams, two bunkers. The flag sits on the roof. Take theirs home to yours while yours is at home. Stations inside the bunker give you your loadout
(armor, weapons, pack); the generator powers them and the roof turrets, and can be blown up and repaired.

Keys: WASD, mouse, left click fire, right click or E jets, Space jump (hold to ski), 1 to 5 weapons, G grenade, R pack, I loadout, Tab scores, M map,
T chat, V quick chat (V G S is "Shazbot!"), F third person. Phones get on-screen sticks and buttons.

## How it works

- `sim.js` the rules: terrain, bases, armor, weapons, flags, turrets. No DOM; the tests run it in node.
- `net.js` binary packets, the host (runs the world, takes inputs, sends snapshots) and the client (prediction and interpolation).
- `host-worker.js` the host in a Web Worker. `link.js` the relay connection and WebRTC.
- `bots.js` computer players. `render.js`, `models.js` WebGL2 drawing. `audio.js` Web Audio sounds. `ui.js` the page.

The relay is `/jetfall` on the elf-punch server (see its README). Tests: `node --test tests/jetfall.test.js`, plus `elf-punch/test-relay.js`.

There are no accounts and the host's browser runs the game, so a host can change anything. Play with people you trust.
