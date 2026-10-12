'use strict';
// A full playthrough of The Lamp at Gullrock, and a few ways to die. Used by tests/adventure.test.js.
const win = [
  'talk to granny',
  'e', 'take bucket', 'search seaweed', 'take spectacles',
  's', 'use bucket on pool',
  'e', 'dig sand',
  'n', 'talk to barnaby', 'give fish to barnaby',
  'w', 'w', 'give glass to granny',
  'n', 'talk to hermit', 'give spectacles to hermit',
  'e', 'open door', 'use oil on lamp', 'use wick on lamp', 'light lamp',
];
const deaths = [
  { name: 'the crab, by hand', lines: ['e', 's', 'take fish'] },
  { name: 'pick up the crab', lines: ['e', 's', 'take crab'] },
  { name: 'swim in the sea', lines: ['e', 'swim in sea'] },
  { name: 'off the cliff', lines: ['n', 'jump off cliff'] },
  { name: 'row into the storm', lines: ['e', 'e', 'enter boat'] },
  { name: 'out of the window', lines: ['n', 'e', 'open door', 'climb window'] },
  { name: 'drink the lamp oil', lines: ['e', 'take bucket', 's', 'use bucket on pool', 'e', 'n', 'give fish to barnaby', 'drink oil'] },
];
module.exports = { win, deaths };
