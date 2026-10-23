# Riff Night

A band game for phones, in the spirit of the plastic-guitar games. Notes slide down a highway and you hit them as they cross the line.
Original songs, words and sounds, all made in the browser.

- **Parts**: guitar, bass, drums, vocals.
- **Ways to play**: tap the lanes (guitar, bass, drums), sing into the mic (vocals), or play a real guitar or bass into the mic.
- **Alone or as a band**: one phone each. One person starts a band and shares a six-letter code, link or QR. Everyone picks a part
  and level on their own phone, and the leader starts the song. All phones start together.
- **Same room**: each phone plays only its own part (the leader's phone plays the parts nobody has), like a real band.
- Four levels. Streaks raise the multiplier, misses quiet your part and drop the crowd meter. Glowing notes charge Boost, which
  doubles points and brings back a bandmate who dropped out.
- **Your music**: play any song out loud near the phone and it finds the beat and makes notes as it goes (guitar, bass, drums).
  With Spotify set up you can search and start a song on a speaker from the game, and the set ends with the song.
- A tuner, a tap timing test and a mic timing test are in the menu.

## Setting up Spotify

Once, by someone with Spotify Premium:

1. Make an app at developer.spotify.com. Tick Web API.
2. Add `https://jroes.github.io/experiments/riffnight/` as a redirect URI (and `http://127.0.0.1:8099/riffnight/` for testing locally).
3. Put the client ID in `CLIENT_ID` in `spotify.js` (it is not a secret), or paste it in Settings on each phone.
4. Add each friend's Spotify email under User Management. Spotify allows four besides the owner while the app is in development mode.

Spotify no longer gives apps a song's beats or audio, so the notes always come from the mic. Pick a speaker or another device to play on.

## Files

| File | What |
| --- | --- |
| `songs.js` | The songs as data: sections with chords, how each part plays, riffs, sung tunes and words |
| `game.js` | No DOM. Songs into notes (`arrange`), notes into charts per part and level (`chart`), scoring (`TapPlay`, `RealPlay`, `VoxPlay`), notes for your own music (`Jam`), the band mix (`partGains`), cleaning what other phones send |
| `dsp.js` | No DOM. Pitch (YIN), which notes are sounding (chroma, for chords), strums (onsets), and the beat of music it hears (`BeatTracker`) |
| `audio.js` | The synth (drums, bass, distorted guitar, a guide voice, a quiet pad), the clock, the mic |
| `band.js` | Bands over the elf-punch relay: rooms, clock sync, start time, live scores |
| `spotify.js` | Spotify as a remote: login (PKCE), search, devices, play, knowing when the song ends |
| `ui.js` | Menus, lobby, the highway, the singing view, the tab view, input, timing tests, the tuner |

Tests: `tests/riffnight.test.js`. Add `?demo` to the page and it plays itself.
