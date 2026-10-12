'use strict';
// A full playthrough of The Crown of Hollowmere, and a few ways to die. Used by tests/adventure.test.js.
const win = [
  'talk to steward', 'e',
  'look under rock', 'take flute',
  's', 'take rope', 'use rope on well', 'pull windlass', 'take coin',
  'open door', 'talk to marta', 'take lamp', 'take veil', 'open drawer', 'take tinderbox', 's',
  'wear veil', 'light lamp',
  'n', 'n', 'give coin to crow', 'take ruby', 'take honey',
  's', 'e', 'play flute', 'e', 'take ladle', 'w', 'w',
  's', 'e', 'e', 'give honey to bear', 'take banner',
  'w', 'w', 'n', 'w',
  'give ruby to steward', 'give ladle to steward', 'give banner to steward',
];
const deaths = [
  { name: 'climb the oak', lines: ['e', 'n', 'climb tree'] },
  { name: 'honey without a veil', lines: ['e', 'n', 'take honey'] },
  { name: 'the troll', lines: ['e', 'e', 'e'] },
  { name: 'the river', lines: ['e', 'e', 'swim in river'] },
  { name: 'the well', lines: ['e', 's', 'jump in well'] },
  { name: 'the dark cave', lines: ['e', 's', 'e', 'e'] },
  { name: 'red mushrooms', lines: ['e', 's', 'e', 'eat mushrooms'] },
  { name: 'the bear', lines: ['e', 's', 'open door', 'take lamp', 'open drawer', 'take tinderbox', 's', 'light lamp', 'e', 'e', 'take banner'] },
];
module.exports = { win, deaths };
