'use strict';
// A full playthrough of Star Sweeper, and a few ways to die. Used by tests/adventure.test.js.
const win = [
  'talk to robot', 'w', 'take mop', 'e', 'e', 'mop slime', 'e',
  'talk to computer', 'take keycard', 'w',
  'use keycard on door', 'enter pod',
  'search pod', 'e', 'search skeleton', 'give brick to eel', 'e',
  'open door', 'talk to bartender', 'mop puddle', 'use token on slot machine',
  'talk to vell', 'give credits to vell',
];
const ship = ['w', 'take mop', 'e', 'e', 'mop slime', 'e'];
const toPlanet = ship.concat(['take keycard', 'w', 'use keycard on door', 'enter pod']);
const deaths = [
  { name: 'the bay doors', lines: ['pull lever'] },
  { name: 'the slime', lines: ['e', 'e'] },
  { name: 'eat the slime', lines: ['e', 'eat slime'] },
  { name: 'the skull bottle', lines: ['w', 'drink fluid'] },
  { name: 'the red button', lines: ship.concat(['push button']) },
  { name: 'the airlock', lines: ship.concat(['take keycard', 'w', 'use keycard on door', 'open airlock']) },
  { name: 'drink coolant', lines: toPlanet.concat(['drink coolant']) },
  { name: 'the sand eel', lines: toPlanet.concat(['e', 'e']) },
  { name: 'the engine', lines: toPlanet.concat(['search pod', 'e', 'give brick to eel', 'e', 'enter engine']) },
  { name: 'kick the slot machine', lines: toPlanet.concat(['search pod', 'e', 'give brick to eel', 'e', 'open door', 'kick slot machine']) },
  { name: 'kiss the big alien', lines: toPlanet.concat(['search pod', 'e', 'give brick to eel', 'e', 'open door', 'kiss alien']) },
];
module.exports = { win, deaths };
