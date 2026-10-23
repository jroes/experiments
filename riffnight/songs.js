/*
 * The songs. All original: words, tunes, chords. No DOM, runs under node.
 *
 * A song is sections. Each section names its chords (one per bar, looped to fill it; `D.A` is two in one bar) and how each part plays:
 *  gtr:   chug (palm-muted eighths), drive (open eighths), ring (one long chord per change), stab, riff:<name>, lead:<name>, rest
 *  bass:  eighths, pulse (quarters), walk (root fifth octave fifth), long, riff:<name> (the riff an octave down), rest
 *  drums: rock, punk, half, four, build, hits, rest. A fill ends each section unless `fill: false`, and a crash starts it.
 *  vox:   [tune name, words]. Words fill the tune's notes in order; `-` joins syllables of one word ("ra- di- o").
 *
 * Riffs and tunes are tokens `pitch/beats`: `E2/.5`, a chord `E2+B2/1`, a rest `r/1`. In tunes `|` ends a sung line.
 * The audio and every chart are worked out from this, so what you hear is what you play.
 */
(function (root) {
  'use strict';

  const SONGS = [
    {
      id: 'static-heart', title: 'Static Heart', bpm: 118, blurb: 'A riff in A minor and a big chorus. A good first song.',
      tunes: {
        verse: 'r/.5 E4/.5 E4/.5 E4/.5 D4/.5 C4/.5 D4/.5 E4/.5 E4/.5 C4/1 A3/2 r/.5 | ' +
          'r/.5 E4/.5 G4/.5 E4/.5 D4/.5 C4/.5 D4/.5 E4/.5 G4/.5 A4/1 G4/2 r/.5 | ' +
          'r/.5 A4/.5 G4/.5 E4/.5 G4/1 E4/.5 D4/.5 C4/1 D4/1 E4/1.5 r/.5 | ' +
          'r/.5 E4/.5 D4/.5 C4/.5 D4/.5 E4/.5 E4/.5 D4/.5 C4/.5 B3/1 A3/2 r/.5 |',
        chorus: 'G4/.5 G4/.5 E4/2 r/1 G4/.5 A4/.5 B4/2.5 r/.5 | ' +
          'r/.5 A4/.5 A4/.5 C5/1 B4/.5 A4/.5 G4/1 A4/2 r/1.5 | ' +
          'G4/.5 G4/.5 E4/2 r/.5 E4/.5 G4/.5 A4/1 B4/2 r/.5 | ' +
          'r/.5 A4/.5 C5/.5 B4/1 A4/.5 G4/1 A4/3 r/1 |',
        bridge: 'r/.5 C4/.5 F4/.5 F4/1 E4/.5 F4/1 G4/.5 A4/.5 B4/1 G4/1.5 r/.5 | ' +
          'A4/1 G4/.5 E4/2 r/.5 A4/1 G4/.5 E4/2 r/.5 | ' +
          'r/.5 C5/.5 C5/.5 A4/1 A4/.5 C5/1 B4/.5 G4/3 r/.5 | ' +
          'r/.5 B4/1 G#4/.5 B4/.5 G#4/.5 E4/4 r/1 |',
      },
      riffs: {
        main: 'A2/.75 A2/.25 C3/.5 A2/.5 D3/.5 D#3/.25 E3/.75 r/.5 G3/.5 E3/.5 D3/.5 C3/.5 A2/1 G2/.5 A2/.5',
      },
      sections: [
        { name: 'Intro', bars: 2, chords: 'Am', gtr: 'riff:main', bass: 'rest', drums: 'rest', fill: false },
        { name: 'Intro', bars: 2, chords: 'Am', gtr: 'riff:main', bass: 'riff:main', drums: 'rock' },
        { name: 'Verse 1', bars: 8, chords: 'Am', gtr: 'riff:main', bass: 'riff:main', drums: 'rock',
          vox: ['verse', 'Sat in the car with the ra- di- o on, noth- ing but hiss where the mu- sic had gone, turn- ing the dial with my cold- est hand, look- ing for a voice I can un- der- stand'] },
        { name: 'Chorus', bars: 8, chords: 'C G Am F', gtr: 'drive', bass: 'eighths', drums: 'rock',
          vox: ['chorus', 'Stat- ic heart, stat- ic heart, I can hear you com- ing through. Stat- ic heart, don\'t fall a- part, I\'m still tuned in to you.'] },
        { name: 'Verse 2', bars: 8, chords: 'Am', gtr: 'riff:main', bass: 'riff:main', drums: 'rock',
          vox: ['verse', 'Pic- ture of you taped up on the dash- board, all of the head- lights a- cross the back- yard, crack- le and buzz on a- no- ther song, some- bo- dy some- where is sing- ing a- long'] },
        { name: 'Chorus', bars: 8, chords: 'C G Am F', gtr: 'drive', bass: 'eighths', drums: 'rock',
          vox: ['chorus', 'Stat- ic heart, stat- ic heart, I can hear you com- ing through. Stat- ic heart, don\'t fall a- part, I\'m still tuned in to you.'] },
        { name: 'Bridge', bars: 8, chords: 'F G Am Am F G E E', gtr: 'ring', bass: 'long', drums: 'half',
          vox: ['bridge', 'And all the miles of road be- tween us turn to noise, turn to noise, but I keep the vol- ume up, wait- ing on your voice'] },
        { name: 'Chorus', bars: 8, chords: 'C G Am F', gtr: 'drive', bass: 'eighths', drums: 'rock',
          vox: ['chorus', 'Stat- ic heart, stat- ic heart, I can hear you com- ing through. Stat- ic heart, don\'t fall a- part, I\'m still tuned in to you.'] },
        { name: 'Outro', bars: 4, chords: 'Am', gtr: 'riff:main', bass: 'riff:main', drums: 'rock' },
        { name: 'End', bars: 1, chords: 'Am', gtr: 'ring', bass: 'long', drums: 'hits', fill: false },
      ],
    },

    {
      id: 'night-bus', title: 'Night Bus', bpm: 96, blurb: 'Slow and heavy, with a bluesy riff and a guitar solo.',
      tunes: {
        verse: 'r/.5 E4/.5 E4/.5 G4/.5 A4/1 G4/.5 E4/.5 G4/1 E4/2 r/1 | ' +
          'r/.5 A4/.5 A4/.5 C5/.5 A4/.5 G4/.5 A4/.5 G4/1 E4/1 E4/2 r/.5 | ' +
          'r/.5 B4/.5 B4/.5 A4/.5 G4/1 E4/.5 G4/.5 A4/1 B4/2 r/1 | ' +
          'r/.5 C5/.5 B4/.5 A4/.5 G4/1 A4/.5 G4/.5 F#4/1 E4/2 r/1 |',
        chorus: 'G4/1 G4/.5 E4/.5 G4/1.5 A4/.5 A4/1 F#4/2 r/1 | ' +
          'G4/1 G4/.5 B4/.5 B4/.5 B4/1 A4/.5 G4/3 r/1 | ' +
          'E5/1.5 D5/.5 C5/.5 B4/.5 A4/1 A4/3 r/1 | ' +
          'D#5/1.5 B4/.5 B4/1 A4/.5 F#4/3.5 r/1 |',
      },
      riffs: {
        verse: 'E2/.5 E2/.25 E2/.25 G2/.5 E2/.5 A2/.5 A#2/.25 B2/.75 D3/.5 ' +
          'E2/.5 E2/.25 E2/.25 G2/.5 E2/.5 A2/.5 A#2/.25 B2/.75 D3/.5 ' +
          'A2/.5 A2/.25 A2/.25 C3/.5 A2/.5 D3/.5 D#3/.25 E3/.75 G3/.5 ' +
          'E2/.5 E2/.25 E2/.25 G2/.5 E2/.5 A2/.5 A#2/.25 B2/.75 D3/.5',
        solo: 'E4/.5 G4/.5 A4/.5 B4/.5 D5/1 B4/1 E5/.75 D5/.25 B4/.5 A4/.5 G4/2 ' +
          'A4/.5 C5/.5 E5/.5 A5/.5 G5/1 E5/1 D5/.5 E5/.5 D5/.5 C5/.5 A4/2 ' +
          'B4/.25 D5/.25 E5/.5 G5/1 E5/.5 D5/.5 B4/1 G4/.5 A4/.5 B4/.5 G4/.5 E4/2 ' +
          'F#4/.5 A4/.5 B4/.5 D#5/.5 F#5/2 F#5/.5 E5/.5 D#5/.5 B4/.5 F#4/1 B3/1',
      },
      sections: [
        { name: 'Intro', bars: 4, chords: 'Em Em Am Em', gtr: 'riff:verse', bass: 'rest', drums: 'half' },
        { name: 'Verse 1', bars: 8, chords: 'Em Em Am Em', gtr: 'riff:verse', bass: 'riff:verse', drums: 'half',
          vox: ['verse', 'Last bus home and the win- dows sweat, driv- er hum- ming a song I for- get, ci- ty lights in a slow pa- rade, ev- ery stop is a choice I made'] },
        { name: 'Chorus', bars: 8, chords: 'C D Em Em C D B B', gtr: 'drive', bass: 'pulse', drums: 'rock',
          vox: ['chorus', 'Take me a- cross the ri- ver, take me where the lights don\'t end. Wake me when we get there, wake me up a- gain.'] },
        { name: 'Verse 2', bars: 8, chords: 'Em Em Am Em', gtr: 'riff:verse', bass: 'riff:verse', drums: 'half',
          vox: ['verse', 'Rain on the glass, gum on the seat, some- bo- dy laugh- ing two rows from me, ne- on signs spell- ing words I know, ev- ery- where is a place to go'] },
        { name: 'Chorus', bars: 8, chords: 'C D Em Em C D B B', gtr: 'drive', bass: 'pulse', drums: 'rock',
          vox: ['chorus', 'Take me a- cross the ri- ver, take me where the lights don\'t end. Wake me when we get there, wake me up a- gain.'] },
        { name: 'Solo', bars: 8, chords: 'Em Em Am Am Em Em B B', gtr: 'lead:solo', bass: 'walk', drums: 'rock' },
        { name: 'Outro', bars: 4, chords: 'Em Em Am Em', gtr: 'riff:verse', bass: 'riff:verse', drums: 'half' },
        { name: 'End', bars: 1, chords: 'Em', gtr: 'ring', bass: 'long', drums: 'hits', fill: false },
      ],
    },

    {
      id: 'parking-lot', title: 'Parking Lot Anthem', bpm: 150, blurb: 'Fast and happy, four chords all the way through.',
      tunes: {
        verse: 'r/.5 B3/.5 E4/.5 E4/1 E4/.5 F#4/.5 G#4/1 F#4/.5 F#4/1 D#4/1.5 r/.5 | ' +
          'r/.5 E4/.5 E4/.5 G#4/1 G#4/.5 F#4/.5 E4/1 C#4/1 C#4/2 r/.5 | ' +
          'r/.5 B3/.5 E4/.5 G#4/1 E4/.5 F#4/.5 G#4/1 F#4/1 D#4/2 r/.5 | ' +
          'r/.5 C#4/.5 E4/.5 G#4/1 B4/.5 G#4/.5 F#4/1 E4/1 E4/2 r/.5 |',
        chorus: 'C#5/1.5 C#5/1.5 B4/.5 C#5/1 B4/1 B4/2 r/.5 | ' +
          'r/.5 B4/.5 B4/.5 G#4/1 E4/.5 E4/.5 G#4/1 G#4/1 E4/2 r/.5 | ' +
          'C#5/1.5 C#5/1.5 B4/.5 C#5/1 E5/1 D#5/2 r/.5 | ' +
          'r/.5 B4/.5 B4/.5 B4/1 G#4/.5 F#4/.5 G#4/1 F#4/1 E4/2 r/.5 |',
      },
      riffs: {
        solo: 'C#5/.5 B4/.5 G#4/.5 E4/.5 G#4/1 B4/1 C#5/.5 E5/.5 C#5/.5 B4/.5 A4/2 ' +
          'G#4/.5 B4/.5 E5/1 B4/.5 G#4/.5 E4/1 F#4/.5 G#4/.5 B4/.5 D#5/.5 F#5/2 ' +
          'E5/.5 C#5/.5 G#4/.5 C#5/.5 E5/.5 C#5/.5 G#4/1 A4/.5 C#5/.5 E5/.5 A5/.5 G#5/1 E5/1 ' +
          'B4/.25 C#5/.25 B4/.5 G#4/.5 E4/.5 G#4/.5 B4/.5 E5/1 D#5/1 F#5/1 B5/2',
      },
      sections: [
        { name: 'Intro', bars: 4, chords: 'E B C#m A', gtr: 'drive', bass: 'eighths', drums: 'rock' },
        { name: 'Verse 1', bars: 8, chords: 'E B C#m A', gtr: 'chug', bass: 'eighths', drums: 'rock',
          vox: ['verse', 'Twelve o- clock and the lot is emp- ty one street- light buzz- ing like a bee bor- rowed amp and a bro- ken string turn it up and we\'ll make it sing'] },
        { name: 'Chorus', bars: 8, chords: 'A B E C#m A B E E', gtr: 'drive', bass: 'eighths', drums: 'punk',
          vox: ['chorus', 'Hey, hey, we\'re loud to- night, park- ing lot in the yel- low light. Hey, hey, we don\'t know why, turn it up till the cops drive by.'] },
        { name: 'Verse 2', bars: 8, chords: 'E B C#m A', gtr: 'chug', bass: 'eighths', drums: 'rock',
          vox: ['verse', 'Mi- key\'s van with the slid- ing back door, drum kit stacked on the dir- ty floor, three of us and a can of gas, nev- er learned how to play this fast'] },
        { name: 'Chorus', bars: 8, chords: 'A B E C#m A B E E', gtr: 'drive', bass: 'eighths', drums: 'punk',
          vox: ['chorus', 'Hey, hey, we\'re loud to- night, park- ing lot in the yel- low light. Hey, hey, we don\'t know why, turn it up till the cops drive by.'] },
        { name: 'Solo', bars: 8, chords: 'C#m A E B', gtr: 'lead:solo', bass: 'eighths', drums: 'rock' },
        { name: 'Chorus', bars: 8, chords: 'A B E C#m A B E E', gtr: 'drive', bass: 'eighths', drums: 'punk',
          vox: ['chorus', 'Hey, hey, we\'re loud to- night, park- ing lot in the yel- low light. Hey, hey, we don\'t know why, turn it up till the cops drive by.'] },
        { name: 'End', bars: 2, chords: 'E', gtr: 'ring', bass: 'long', drums: 'hits', fill: false },
      ],
    },

    {
      id: 'fast-lane', title: 'Fast Lane Fever', bpm: 172, blurb: 'Very fast punk. Hold on.',
      tunes: {
        verse: 'r/.5 A4/.5 A4/.5 A4/.5 F#4/.5 D4/.5 F#4/.5 A4/.5 A4/.5 B4/1 A4/2 r/.5 | ' +
          'r/.5 B4/.5 B4/.5 B4/.5 G4/.5 B4/.5 D5/.5 C#5/.5 B4/.5 A4/1 A4/2 r/.5 | ' +
          'r/.5 F#4/.5 F#4/.5 F#4/.5 A4/1 F#4/.5 E4/.5 D4/1 E4/1 F#4/1.5 r/.5 | ' +
          'r/.5 G4/.5 A4/.5 B4/1 D5/1 B4/.5 A4/.5 A4/3 r/.5 |',
        chorus: 'D5/.5 r/.5 D5/1 B4/1 A4/3 r/2 | ' +
          'F#4/1 A4/1 D5/1 C#5/1 B4/3 r/1 | ' +
          'D5/.5 r/.5 D5/1 B4/1 A4/3 r/2 | ' +
          'F#4/1 A4/1 D5/1 E5/1 D5/3 r/1 |',
        bridge: 'r/1 B4/.5 B4/.5 D5/1 C#5/1 B4/3 r/1 | ' +
          'r/1 A4/.5 A4/.5 D5/1 C#5/1 A4/3 r/1 | ' +
          'r/1 B4/.5 B4/.5 D5/1 C#5/1 B4/3 r/1 | ' +
          'r/1 A4/.5 A4/.5 F#5/1 E5/1 E5/3 r/1 |',
      },
      riffs: {
        intro: 'D3/.5 D3/.5 F#3/.5 A3/.5 G3/.5 F#3/.5 E3/.5 A2/.5',
      },
      sections: [
        { name: 'Intro', bars: 4, chords: 'D', gtr: 'riff:intro', bass: 'eighths', drums: 'punk' },
        { name: 'Verse 1', bars: 8, chords: 'D D G A', gtr: 'chug', bass: 'eighths', drums: 'punk',
          vox: ['verse', 'Foot on the gas and the ra- di- o\'s loud, we\'re on- ly kids but we\'re draw- ing a crowd, sev- en- ty miles to the next big town, no- bo- dy\'s slow- ing us down'] },
        { name: 'Chorus', bars: 8, chords: 'G A D Bm G A D D', gtr: 'drive', bass: 'eighths', drums: 'punk',
          vox: ['chorus', 'Fast lane fe- ver, burn- ing up the night. Fast lane fe- ver, hold on, hold on tight.'] },
        { name: 'Verse 2', bars: 8, chords: 'D D G A', gtr: 'chug', bass: 'eighths', drums: 'punk',
          vox: ['verse', 'Map on the floor and it\'s com- ing a- part, ev- ery- one sing- ing the songs that we start, gas sta- tion cof- fee and one more mile, stay- ing up just for a while'] },
        { name: 'Chorus', bars: 8, chords: 'G A D Bm G A D D', gtr: 'drive', bass: 'eighths', drums: 'punk',
          vox: ['chorus', 'Fast lane fe- ver, burn- ing up the night. Fast lane fe- ver, hold on, hold on tight.'] },
        { name: 'Bridge', bars: 8, chords: 'Bm G D A', gtr: 'stab', bass: 'pulse', drums: 'half',
          vox: ['bridge', 'When the en- gine dies we will push it home. When the ra- dio\'s gone we will sing a- lone.'] },
        { name: 'Chorus', bars: 8, chords: 'G A D Bm G A D D', gtr: 'drive', bass: 'eighths', drums: 'punk',
          vox: ['chorus', 'Fast lane fe- ver, burn- ing up the night. Fast lane fe- ver, hold on, hold on tight.'] },
        { name: 'Outro', bars: 2, chords: 'G A', gtr: 'drive', bass: 'eighths', drums: 'build' },
        { name: 'End', bars: 1, chords: 'D', gtr: 'ring', bass: 'long', drums: 'hits', fill: false },
      ],
    },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = SONGS;
  else root.RN_SONGS = SONGS;
})(typeof window !== 'undefined' ? window : globalThis);
