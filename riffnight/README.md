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
- A tuner, a tap timing test and a mic timing test are in the menu.

## Files

| File | What |
| --- | --- |
| `songs.js` | The songs as data: sections with chords, how each part plays, riffs, sung tunes and words |
| `game.js` | No DOM. Songs into notes (`arrange`), notes into charts per part and level (`chart`), scoring (`TapPlay`, `RealPlay`, `VoxPlay`), the band mix (`partGains`), cleaning what other phones send |
| `dsp.js` | No DOM. Pitch (YIN), which notes are sounding (chroma, for chords) and strums (onsets) |
| `audio.js` | The synth (drums, bass, distorted guitar, a guide voice, a quiet pad), the clock, the mic |
| `band.js` | Bands over the elf-punch relay: rooms, clock sync, start time, live scores |
| `ui.js` | Menus, lobby, the highway, the singing view, the tab view, input, timing tests, the tuner |

Tests: `tests/riffnight.test.js`. Add `?demo` to the page and it plays itself.
