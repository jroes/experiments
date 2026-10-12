/*
 * The Crown of Hollowmere: a small fairy-tale adventure for the engine in shared/adventure.js.
 * The old king is gone and the three royal treasures are scattered. Bring them back to the steward.
 * Original story, text and art. Rooms, puzzles and handlers are all plain data and small functions.
 *
 * Verb names used by handlers: look search take drop open close use give talk push pull climb enter swim eat drink wear light play attack cut kiss tie
 * (see VERBS in the engine for the words that map to each).
 */
(function (root) {
  'use strict';
  const A = typeof require !== 'undefined' ? require('../shared/adventure-art.js') : root.AdvArt;
  const { K, BL, GR, CY, RD, MG, BR, LG, DG, LB, LGR, LC, LR, LM, YL, WH } = A;

  const lampLit = g => g.has('lamp') && g.flag('lamp_lit');

  const items = {
    flute: { name: 'wooden flute', aliases: ['flute', 'pipe', 'whistle'], desc: 'A small wooden flute, worn smooth. It has a soft, sleepy sound.',
      verbs: { play(g) {
        if (g.state.room === 'bridge' && !g.flag('troll_asleep')) {
          g.set('troll_asleep'); g.score(10, 'troll');
          g.say('You play a slow, slow tune. The troll\'s eyes droop. His club slips from his hand and he topples over, snoring like a landslide. The bridge is yours.');
        } else if (g.state.room === 'cave' && !g.flag('bear_gone')) g.say('The bear shifts in its sleep. You stop playing, very quickly.');
        else g.say('You play a little tune. Somewhere, a bird answers.');
      } } },
    rope: { name: 'coil of rope', aliases: ['rope', 'cord', 'coil'], desc: 'A sturdy coil of rope.' },
    coin: { name: 'silver coin', aliases: ['coin', 'silver', 'money'], desc: 'A bright silver coin. It is rather shiny.' },
    jewel: { name: 'ruby', aliases: ['ruby', 'jewel', 'gem', 'crown jewel', 'royal jewel'], desc: 'The Crown Jewel of Hollowmere, a ruby the size of a plum.' },
    lamp: { name: 'brass lamp', aliases: ['lamp', 'lantern', 'brass lamp', 'oil lamp'],
      desc: g => (g.flag('lamp_lit') ? 'A brass lamp, burning with a steady yellow flame.' : 'A brass oil lamp. It is not lit.'),
      verbs: { light(g) {
        if (g.flag('lamp_lit')) return g.say('It is already lit.');
        if (!g.has('tinderbox')) return g.say('You have nothing to light it with.');
        g.set('lamp_lit'); g.score(5, 'lamp'); g.say('You strike a spark. The lamp catches and glows warm and yellow.');
      } } },
    tinderbox: { name: 'tinderbox', aliases: ['tinder', 'flint', 'box', 'tinder box'], desc: 'A tin box with flint, steel and dry tinder.' },
    veil: { name: 'beekeeper\'s veil', aliases: ['veil', 'hat', 'net', 'beekeepers veil', 'bee veil'], desc: g => (g.flag('veil_on') ? 'You are wearing the veil. You feel a bit silly.' : 'A wide straw hat with a net veil hanging from the brim.'),
      verbs: { wear(g) { if (g.flag('veil_on')) return g.say('You are already wearing it.'); g.set('veil_on'); g.say('You put on the veil. The world looks like it is behind a screen door.'); },
        drop(g) { g.say('Dropped.'); } } },
    honey: { name: 'honeycomb', aliases: ['honey', 'comb', 'honeycomb'], desc: 'A dripping chunk of golden honeycomb. A few bees are still hanging on to it.', food: 'Delicious! But you suspect you needed that for something.' },
    ladle: { name: 'royal ladle', aliases: ['ladle', 'spoon', 'royal ladle', 'soup ladle'], desc: 'A heavy silver ladle with a crown stamped on the handle. The Royal Ladle of Hollowmere.' },
    banner: { name: 'royal banner', aliases: ['banner', 'flag', 'royal banner', 'cloth'], desc: 'A big crimson banner with a golden crown. It smells strongly of bear.' },
  };

  const treasures = { jewel: 'ruby', ladle: 'ladle', banner: 'banner' };

  function giveToSteward(id, text) {
    return g => {
      g.lose(id); g.set('gave_' + id); g.score(5, 'gave_' + id);
      const n = ['jewel', 'ladle', 'banner'].filter(t => g.flag('gave_' + t)).length;
      g.say(text);
      if (n === 3) {
        g.score(5, 'finish');
        g.win('The steward lays the ruby in the crown, hangs the banner on the wall and sets the ladle on the royal soup pot. The bells of Hollowmere ring all night long. At dawn they call you Your Majesty, and the first thing you do is have a very large bowl of soup.');
      } else g.say('"' + (3 - n) + ' to go," says the steward.');
    };
  }

  const rooms = {
    // ---------------------------------------------------------------- the castle
    castle: {
      name: 'Hollowmere Castle', horizon: 54, exits: { e: 'meadow' },
      desc: 'Hollowmere Castle. Its gate is shut, and the royal steward stands before it with his hands behind his back. The only open way is east, back to the meadow.',
      blocks: [[0, 0, 160, 54], [88, 60, 14, 8]],
      back(c, g, t) {
        A.sky(c, 40, LB, LC); A.cloud(c, 30, 12, WH); A.cloud(c, 120, 20, WH);
        A.hills(c, 44, GR, 1, 5);
        A.wall(c, 0, 24, 160, 34, LG);
        A.tower(c, 8, 58, 22, 56); A.tower(c, 130, 58, 22, 50);
        A.flag(c, 19, 2, RD); A.flag(c, 141, 8, RD);
        A.battlements(c, 30, 24, 100);
        c.rect(60, 28, 40, 30, DG); A.arch(c, 64, 58, 32, 30); c.rect(70, 36, 20, 22, BR); c.rect(79, 36, 2, 22, K);
        c.rect(0, 58, 160, 1, DG);
        A.ground(c, 59, GR, LGR, 11);
        c.dith(60, 59, 100, 6, BR, LG, 0);
        c.dith(0, 66, 160, 8, GR, BR, 0);
        A.bush(c, 18, 70, 1); A.bush(c, 148, 92, 1.3);
        A.flowers(c, 4, 80, 50, 18, 2);
      },
      objects: [
        { id: 'gate', name: 'castle gate', aliases: ['gate', 'door', 'castle', 'doors', 'portcullis'], rect: [60, 28, 40, 30], at: [80, 64],
          desc: 'A tall oak gate with iron bands. It is shut tight.',
          verbs: { open: 'The steward steps in front of you. "Not yet. The treasures first."', push: 'It will not budge. The steward coughs politely.', enter: 'The steward steps in front of you. "Not yet. The treasures first."', talk: 'Nobody is home but the steward.' } },
        { id: 'steward', name: 'steward', aliases: ['man', 'old man', 'royal steward', 'butler', 'guard'], rect: [102, 62, 12, 20], at: [96, 80], base: 82,
          draw(c) { A.person(c, 108, 82, { robe: MG, hat: MG, hair: WH, beard: WH, trim: YL }); },
          desc: 'The royal steward of Hollowmere, a very old man in a very purple robe. He has been waiting a long time.',
          verbs: {
            talk(g) {
              if (!g.flag('met_steward')) {
                g.set('met_steward');
                g.say('"Ah! At last, someone. The old king is gone and left no heir. The crown is in pieces: the Ruby from its band, the Royal Ladle, and the Royal Banner. A crow, a troll and a bear have them. Bring all three back and the crown is yours. Don\'t ask why the ladle matters. It is soup. It is always soup."');
              } else if (!g.has('jewel') && !g.flag('gave_jewel')) g.say('"The ruby? A crow took it. Crows love shiny things. Do you have anything shiny?"');
              else if (!g.flag('gave_ladle')) g.say('"The ladle was last seen across the river. Mind the troll."');
              else if (!g.flag('gave_banner')) g.say('"The banner. A bear sleeps on it, in the cave past the forest. It is dark in there. And bears like honey, I hear."');
              else g.say('"Wonderful. Wonderful!"');
            },
            attack: 'You raise a fist. The steward raises an eyebrow. You lower the fist.',
            kiss: 'The steward goes pink. "I am on duty."',
            give: {
              jewel: giveToSteward('jewel', 'The steward takes the ruby with both hands, and a tear runs into his moustache. "The Crown Jewel."'),
              ladle: giveToSteward('ladle', 'The steward polishes the ladle on his sleeve. "Oh, I have missed this."'),
              banner: giveToSteward('banner', 'The steward holds the banner at arm\'s length. "It smells of bear. That can be fixed."'),
              '*': 'The steward shakes his head. "That is not one of the royal treasures."',
            },
          } },
      ],
    },

    // ---------------------------------------------------------------- the meadow
    meadow: {
      name: 'Meadow', horizon: 42, exits: { w: 'castle', n: 'orchard', s: 'yard', e: 'bridge' },
      desc: 'A sunny meadow with a crossroads. The castle is west, an orchard is north, a cottage yard is south and a bridge is east. A big flat rock sits in the grass.',
      blocks: [[28, 70, 20, 10]],
      listen: 'Bees. Larks. A far-off river.',
      back(c, g, t) {
        A.sky(c, 36, LB, LC); A.sun(c, 128, 12, 6); A.cloud(c, 34, 12, WH); A.cloud(c, 84, 22, WH);
        A.mountain(c, 10, 42, 60, 22, DG, WH); A.mountain(c, 50, 42, 50, 16, LG, WH);
        A.hills(c, 44, GR, 3, 5);
        A.ground(c, 42, LGR, GR, 5);
        c.dith(0, 42, 160, 3, GR, LGR, 0);
        A.flowers(c, 4, 46, 150, 50, 7);
        c.dith(70, 42, 12, 58, BR, LGR, 0); c.dith(0, 66, 160, 8, BR, LGR, 1);
        A.tree(c, 142, 60, 1.1); A.bush(c, 12, 56, 1);
      },
      objects: [
        { id: 'rock', name: 'flat rock', aliases: ['rock', 'stone', 'boulder', 'big rock'], rect: [26, 64, 24, 14], at: [40, 82],
          draw(c) { A.rock(c, 38, 78, 22); },
          desc: g => (g.flag('flute_found') ? 'A big flat rock, tipped on its side.' : 'A flat grey rock, bigger than it looks. The grass under one edge is pressed down, as if something small hid there.'),
          verbs: {
            search(g) { if (g.flag('flute_found')) return g.say('Nothing else under it.'); g.set('flute_found'); g.say('You tip the rock over. Underneath, in a nest of dry grass, lies a little wooden flute.'); },
            push(g) { g.say('You shove, and the rock shifts. Something small rattles under it. Maybe look under it.'); },
            pull(g) { g.say('You heave the rock up on its side.'); if (!g.flag('flute_found')) { g.set('flute_found'); g.say('A little wooden flute lies in the grass underneath.'); } },
            climb: 'You climb on the rock and enjoy the view. Then you climb down.',
          } },
        { id: 'flute', item: 'flute', name: 'wooden flute', aliases: ['flute', 'pipe'], show: g => g.flag('flute_found'), rect: [40, 80, 8, 6], at: [44, 86], base: 86,
          draw(c) { c.rect(40, 83, 8, 2, BR); c.px(41, 83, YL); c.px(43, 83, YL); c.px(45, 83, YL); },
          desc: 'A small wooden flute.', takeMsg: 'You pick up the flute and brush the grass off. (Try "play flute" somewhere.)', points: 5 },
        { id: 'sign', name: 'signpost', aliases: ['sign', 'post', 'signs'], rect: [100, 54, 14, 18], at: [106, 76],
          draw(c) { A.sign(c, 106, 72); },
          desc: 'The signpost points four ways: WEST, Castle. NORTH, Orchard (Mind the Bees). SOUTH, Old Marta\'s Cottage. EAST, Troll Bridge (Pay the Toll, or Else).' },
      ],
    },

    // ---------------------------------------------------------------- the orchard
    orchard: {
      name: 'Orchard', horizon: 42, exits: { s: 'meadow' },
      desc: 'An orchard. A huge oak stands on the right with an untidy nest in the top. A beehive hangs from an apple tree on the left, humming.',
      blocks: [[96, 66, 10, 8], [32, 62, 10, 8]],
      back(c, g, t) {
        A.sky(c, 30, LB, LC); A.cloud(c, 60, 10, WH);
        A.hills(c, 44, GR, 9, 6);
        A.ground(c, 42, LGR, GR, 8);
        A.tree(c, 37, 68, 1.1); A.tree(c, 60, 54, 0.8); A.tree(c, 128, 52, 0.8);
        A.tree(c, 101, 74, 1.5);
        A.flowers(c, 4, 76, 150, 20, 4);
      },
      objects: [
        { id: 'tree', name: 'oak tree', aliases: ['tree', 'oak', 'big tree', 'trunk', 'nest'], rect: [90, 8, 24, 66], at: [96, 80], base: 80,
          desc: g => (g.flag('crow_paid') ? 'A huge old oak. The nest at the top is empty now.' : 'A huge old oak. Something red glints in the nest at the top, and a big black crow sits over it.'),
          verbs: {
            climb: g => g.die('You start up the oak. The crow lets you get all the way to the nest, then pecks you very, very hard. You fall a long way. The orchard goes quiet.'),
            take: 'It is a tree. You would need a bigger pocket.',
          } },
        { id: 'crow', name: 'crow', aliases: ['bird', 'black crow', 'big crow', 'raven'], rect: [95, 12, 14, 12], at: [96, 80], base: 80,
          draw(c, g, t) { if (!g.flag('crow_paid')) A.crow(c, 101, 18, t); },
          show: g => !g.flag('crow_paid'),
          desc: 'A big black crow sits over a nest. It is watching you with one bright eye, and the eye keeps drifting to anything shiny.',
          verbs: {
            talk: 'The crow says "CAW." It might mean something.', attack: 'You wave your arms. The crow lifts a wing and looks at you with great calm.', kiss: 'The crow looks insulted.',
            give: { coin(g) {
              g.lose('coin'); g.set('crow_paid'); g.score(15, 'crow');
              g.say('The crow snatches the coin, admires it, and swoops down to tuck it away somewhere. As it goes, something red tumbles out of the nest and thumps into the grass below the tree.');
            }, '*': 'The crow looks at it and turns away. Not shiny enough.' },
          } },
        { id: 'jewel', item: 'jewel', name: 'ruby', aliases: ['ruby', 'jewel', 'gem'], show: g => g.flag('crow_paid'), rect: [88, 70, 10, 8], at: [92, 80], base: 78,
          draw(c, g, t) { A.jewel(c, 92, 78, t); }, desc: 'The Crown Jewel, lying in the grass.', takeMsg: 'You pick up the ruby. It is warm, and it weighs almost nothing.' },
        { id: 'hive', name: 'beehive', aliases: ['hive', 'bees', 'bee', 'honey', 'honeycomb', 'comb', 'nest', 'apple tree'], rect: [30, 34, 14, 22], at: [46, 76], base: 76,
          draw(c, g, t) { c.ell(37, 46, 5, 7, YL); for (let i = 0; i < 5; i += 1) c.rect(33, 41 + i * 3, 9, 1, BR); A.bee(c, 30, 40, t); A.bee(c, 45, 44, t + 1); A.bee(c, 40, 34, t + 2); },
          show: g => !g.gone('hive'),
          desc: 'A wild beehive hangs from a branch, dripping honey. The bees are cross.',
          verbs: {
            take(g) {
              if (g.flag('veil_on')) {
                g.remove('hive'); g.give('honey'); g.score(7, 'honey'); g.emit('take');
                g.say('Behind the veil, you slowly cut a comb of honey from the hive. The bees buzz furiously, but nothing gets through. You back away with the honey and a very strong feeling of accomplishment.');
              } else g.die('You reach for the honey. The bees explain, in large numbers, that it is theirs. You are discovered much later, very puffy.');
            },
            attack: g => g.die('You poke the hive. The hive pokes back, several thousand times.'),
            push: g => g.die('You shove the hive. This was a bad idea, and it takes the bees about a second to tell you so.'),
            pull: g => g.die('You pull the hive. The hive comes with a great deal of company.'),
            climb: 'The branch is too thin, and the bees are watching.', search: 'You get close enough to hear the hive and then you get less close.',
          } },
      ],
    },

    // ---------------------------------------------------------------- the bridge
    bridge: {
      name: 'Troll Bridge', horizon: 40, exits: { w: 'meadow', e: 'farbank' },
      desc: g => (g.flag('troll_asleep') ? 'A river runs north to south under a wooden bridge. The troll lies on the east bank, snoring.' : 'A river runs north to south under a wooden bridge. A troll with a big club stands at the east end, blocking the way.'),
      blocks: [[58, 40, 44, 24], [58, 74, 44, 26]],
      exitCheck(g, dir) {
        if (dir === 'e' && !g.flag('troll_asleep')) {
          g.die('You step onto the bridge. "TOLL!" bellows the troll, and there is a moment of surprised silence, and then a club. You are very flat.');
          return true;
        }
        return false;
      },
      listen: g => (g.flag('troll_asleep') ? 'Snoring. Loud, gravelly snoring.' : 'The river hurries along. The troll mutters something about tolls.'),
      back(c, g, t) {
        A.sky(c, 30, LB, LC); A.cloud(c, 110, 12, WH);
        A.hills(c, 44, GR, 2, 6);
        A.ground(c, 42, LGR, GR, 15);
        A.water(c, 58, 40, 44, 60, t);
        c.rect(56, 40, 2, 60, BR); c.rect(102, 40, 2, 60, BR);
        c.dith(56, 40, 2, 60, BR, LGR, 0); c.dith(102, 40, 2, 60, BR, LGR, 0);
        // the planks
        c.rect(52, 62, 56, 12, BR); for (let x = 52; x < 108; x += 4) c.rect(x, 62, 1, 12, K);
        c.rect(52, 62, 56, 1, YL); c.rect(52, 73, 56, 1, DG);
        c.rect(52, 58, 56, 1, BR); c.rect(52, 76, 56, 1, BR);
        for (let x = 54; x < 108; x += 14) { c.rect(x, 56, 2, 6, BR); c.rect(x, 74, 2, 4, BR); }
        A.tree(c, 18, 56, 1); A.bush(c, 140, 50, 1); A.flowers(c, 0, 80, 54, 18, 3); A.flowers(c, 110, 80, 50, 18, 5);
        A.fish(c, 74, 52, 11); A.fish(c, 88, 86, 11);
      },
      objects: [
        { id: 'troll', name: 'troll', aliases: ['big troll', 'monster', 'ogre', 'giant'], rect: [108, 46, 24, 32], at: [96, 68], base: 80,
          draw(c, g, t) {
            if (g.flag('troll_asleep')) {
              c.ell(128, 76, 14, 6, GR); c.ell(138, 72, 6, 5, GR); c.px(140, 71, K); c.rect(120, 78, 3, 3, GR);
              c.rect(112, 80, 22, 2, BR); const z = Math.floor((t || 0) * 1.2) % 3; c.px(142, 62 - z * 3, WH); c.px(144, 58 - z * 3, WH);
            } else {
              c.rect(116, 62, 14, 16, GR); c.ell(123, 56, 8, 8, GR); c.rect(118, 52, 3, 3, K); c.rect(125, 52, 3, 3, K); c.rect(119, 60, 8, 2, K); c.rect(120, 60, 1, 2, WH); c.rect(125, 60, 1, 2, WH);
              c.rect(110, 62, 5, 14, BR); c.ell(112, 58, 5, 5, BR); c.rect(130, 66, 5, 10, GR); c.rect(116, 78, 5, 4, GR); c.rect(125, 78, 5, 4, GR);
              c.rect(116, 50, 3, 2, GR); c.rect(126, 50, 3, 2, GR);
            }
          },
          desc: g => (g.flag('troll_asleep') ? 'The troll is fast asleep, drooling slightly.' : 'A very large, very green troll. He looks tired and cross, in about equal measure.'),
          verbs: {
            talk(g) { g.say(g.flag('troll_asleep') ? 'He just snores.' : '"Toll! No toll, no crossing! And no loud noises, I have not slept in three weeks. Something soothing, perhaps, if you must do anything." He yawns hugely.'); },
            attack: g => (g.flag('troll_asleep') ? g.say('You decide not to push your luck.') : g.die('You attack the troll. It is the shortest fight in Hollowmere history.')),
            kiss: 'You decide you would rather not.',
            give: { coin: 'The troll bites the coin. "One coin? That is not a toll. That is an insult."', honey: 'The troll sniffs the honey. "Not enough." His stomach rumbles anyway.', flute: g => g.say('"What do I do with that?" says the troll. Maybe you should play it for him, not hand it over.'), '*': 'The troll shakes his head. "No."' },
          } },
        { id: 'river', name: 'river', aliases: ['water', 'stream', 'current'], rect: [58, 40, 44, 22], at: [80, 66],
          desc: 'A deep, quick river, much too cold to swim in.',
          verbs: { swim: g => g.die('You dive into the river. It is colder than you thought, and faster. You think about this for quite a long way.'), drink: 'The water is cold and clean.', enter: g => g.die('You wade in. The current takes your feet right away, and the rest of you soon afterwards.') } },
        { id: 'bridge', name: 'bridge', aliases: ['planks', 'wooden bridge'], rect: [52, 58, 56, 20], at: [80, 68],
          desc: 'A wooden bridge, sturdy enough. Someone has carved TOLLS UNPAID IS TROLLS FED into the rail.' },
      ],
    },

    // ---------------------------------------------------------------- across the river
    farbank: {
      name: 'Far Bank', horizon: 42, exits: { w: 'bridge' },
      desc: 'The far side of the river. A hollow stump stands in a field of daisies, and something silver winks from the top of it.',
      blocks: [[66, 64, 20, 10]],
      back(c, g, t) {
        A.sky(c, 34, LB, LC); A.cloud(c, 80, 14, WH); A.sun(c, 20, 14, 5);
        A.hills(c, 44, GR, 6, 7);
        A.ground(c, 42, LGR, GR, 22);
        A.pine(c, 130, 56, 1.2); A.pine(c, 148, 66, 1.4); A.pine(c, 14, 60, 1.1);
        A.flowers(c, 4, 46, 150, 52, 12);
        A.bush(c, 100, 90, 1);
      },
      objects: [
        { id: 'stump', name: 'stump', aliases: ['hollow stump', 'old stump', 'tree stump', 'log'], rect: [64, 58, 24, 18], at: [76, 80], base: 76,
          draw(c) { c.rect(66, 62, 20, 14, BR); c.speck(66, 62, 20, 14, K, 0.12, 4); c.ell(76, 62, 10, 3, YL); c.ell(76, 62, 6, 2, BR); },
          desc: g => (g.gone('ladle') ? 'An old hollow stump.' : 'An old hollow stump, wide as a table. A silver ladle lies across the top, glinting.'),
          verbs: { climb: 'You stand on the stump. It is not very comfortable. You get down.', search: g => g.say(g.gone('ladle') ? 'Just wood and beetles.' : 'It is hollow and full of beetles, and the ladle is lying right on top.') } },
        { id: 'ladle', item: 'ladle', name: 'royal ladle', aliases: ['ladle', 'spoon', 'silver ladle'], rect: [66, 56, 20, 7], at: [76, 80], base: 76,
          draw(c, g, t) { c.rect(70, 59, 10, 1, LG); c.ell(82, 59, 3, 2, LG); if (Math.floor((t || 0) * 3) % 4 === 0) c.px(83, 56, WH); },
          desc: 'The Royal Ladle of Hollowmere.', takeMsg: 'You lift the Royal Ladle. It is heavy, and it is definitely silver.', points: 5 },
        { id: 'daisies', name: 'daisies', aliases: ['flowers', 'daisy', 'flower', 'field'], rect: [0, 46, 60, 52], at: [30, 80],
          desc: 'Thousands of daisies.', verbs: { take: 'You pick a daisy. It wilts at once from the shame of being picked. You drop it.', eat: 'They taste like grass that thinks it is better than grass.' } },
      ],
    },

    // ---------------------------------------------------------------- Marta's yard
    yard: {
      name: 'Old Marta\'s Yard', horizon: 42, exits: { n: 'meadow', e: 'forest' },
      desc: 'A tidy yard in front of a small cottage with a green door. An old stone well stands on the left, with a barrel next to it.',
      blocks: [[96, 40, 52, 24], [20, 48, 30, 22]],
      back(c, g, t) {
        A.sky(c, 32, LB, LC); A.cloud(c, 70, 12, WH);
        A.hills(c, 42, GR, 4, 6);
        A.ground(c, 42, LGR, GR, 31);
        A.house(c, 98, 62, 50, 22, BR, YL);
        A.door(c, 114, 62, 12, 17, GR); A.window(c, 100, 48, 9, 8); A.window(c, 136, 48, 9, 8);
        c.rect(138, 30, 5, 8, DG); c.rect(138, 30, 5, 1, K);
        A.fence(c, 100, 158, 94); A.fence(c, 0, 18, 94);
        A.flowers(c, 4, 80, 50, 18, 6); A.flowers(c, 100, 66, 50, 10, 8);
        c.dith(112, 62, 16, 38, BR, LGR, 0);
        // the well
        c.rect(22, 56, 26, 14, LG); c.rect(22, 56, 26, 2, DG); for (let i = 0; i < 26; i += 6) c.rect(22 + i, 58, 1, 12, DG);
        c.rect(24, 44, 2, 14, BR); c.rect(44, 44, 2, 14, BR); c.rect(22, 42, 26, 3, BR); c.rect(24, 48, 22, 2, BR);
        if (g.flag('rope_tied')) { c.rect(35, 50, 1, 12, YL); if (!g.flag('bucket_up')) c.rect(33, 62, 5, 4, BR); else A.bucket(c, 35, 56); }
        A.tree(c, 80, 40, 0.6);
      },
      objects: [
        { id: 'well', name: 'well', aliases: ['old well', 'stone well', 'windlass', 'crank', 'winch', 'pit'], rect: [20, 40, 30, 32], at: [36, 76], base: 74,
          desc: g => {
            if (!g.flag('rope_tied')) return 'A stone well with a windlass. The rope is gone, and the bucket is a dark shape far below. Something shiny winks near it.';
            return g.flag('bucket_up') ? 'The bucket is at the top of the well.' : 'The rope is tied to the windlass and runs down to a bucket at the bottom.';
          },
          verbs: {
            use: { rope(g) { if (g.flag('rope_tied')) return g.say('It is already tied on.'); g.lose('rope'); g.set('rope_tied'); g.score(2, 'tie'); g.say('You tie the rope to the windlass and lower the free end down. There is a clink, and it feels as if the bucket has been caught.'); } },
            tie: { rope(g) { if (g.flag('rope_tied')) return g.say('It is already tied on.'); g.lose('rope'); g.set('rope_tied'); g.score(2, 'tie'); g.say('You tie the rope to the windlass and lower the free end down. There is a clink, and it feels as if the bucket has been caught.'); } },
            pull(g) {
              if (!g.flag('rope_tied')) return g.say('The windlass spins and nothing happens. There is no rope.');
              if (g.flag('bucket_up')) return g.say('The bucket is already up.');
              g.set('bucket_up'); g.say('You crank the windlass. The bucket comes up out of the dark, with a shiny silver coin lying in the bottom.');
            },
            push(g) { g.act('pull', 'well'); },
            climb: g => g.die('You climb into the well to look for the shiny thing. The well has opinions about that. It is a long drop and a very short stop.'),
            enter: g => g.die('You jump into the well. Why? Nobody knows. It is a long way down.'),
            swim: g => g.die('The well is too deep and too narrow for swimming, but it does a fine job of the other thing.'),
            drink: 'The water is down there somewhere. You cannot reach it.',
            search: 'You peer down. Something shiny winks from the bottom, next to the bucket.',
          } },
        { id: 'coin', item: 'coin', name: 'silver coin', aliases: ['coin', 'silver'], show: g => g.flag('bucket_up'), rect: [30, 52, 12, 10], at: [38, 76], base: 74,
          draw(c, g, t) { c.px(35, 55, WH); c.px(36, 55, LG); }, desc: 'A silver coin in the bucket.', takeMsg: 'You pick the coin out of the bucket. It is bright and cold.', points: 5 },
        { id: 'rope', item: 'rope', name: 'coil of rope', aliases: ['rope', 'cord', 'coil'], rect: [62, 82, 12, 10], at: [66, 94], base: 94,
          draw(c) { c.ell(68, 92, 5, 2, YL); c.ell(68, 92, 3, 1, BR); }, desc: 'A coil of good rope, left lying about.', takeMsg: 'You take the rope.', points: 3 },
        { id: 'cottage', name: 'cottage', aliases: ['house', 'home', 'green door', 'door', 'hut'], rect: [98, 44, 50, 36], at: [120, 68],
          desc: 'A snug little cottage with a green door and a smoking chimney. A hand-painted sign on the door says: OLD MARTA. KNOCK AND COME IN. NO BEARS.',
          verbs: {
            open: g => { g.say('You push the green door open and go in.'); g.goto('cottage', 80, 92); },
            enter: g => { g.say('You go in.'); g.goto('cottage', 80, 92); },
            push: g => { g.say('You push the green door open and go in.'); g.goto('cottage', 80, 92); },
            talk: 'You knock. A voice inside calls "It\'s open, dear!"',
          } },
        { id: 'barrel', name: 'barrel', aliases: ['rain barrel', 'cask', 'water barrel'], rect: [52, 66, 12, 14], at: [58, 84], base: 82,
          draw(c) { c.box(52, 68, 12, 14, BR, K); c.rect(52, 72, 12, 1, DG); c.rect(52, 77, 12, 1, DG); },
          desc: 'A rain barrel, half full of water.', verbs: { drink: 'It tastes of rain and slightly of barrel.', search: 'Just water and leaves.', climb: 'You are not a rain barrel person.' } },
      ],
    },

    // ---------------------------------------------------------------- the cottage
    cottage: {
      name: 'Marta\'s Cottage', horizon: 46, exits: { s: 'yard' }, exitAt: { s: [120, 66] }, oneWay: ['s'], // the way in is the door in the yard
      desc: 'A cosy one-room cottage. A fire crackles in the hearth, and Old Marta sits in a rocking chair, knitting a long, long scarf. A shelf, a hook by the door and a chest of drawers stand against the wall.',
      blocks: [[96, 58, 24, 14], [8, 46, 46, 14]],
      back(c, g, t) {
        c.rect(0, 0, 160, 46, BR); c.dith(0, 0, 160, 46, BR, DG, 0);
        for (let x = 0; x < 160; x += 10) c.rect(x, 0, 1, 46, K);
        c.rect(0, 46, 160, 54, BR); c.speck(0, 46, 160, 54, YL, 0.04, 5);
        for (let y = 50; y < 100; y += 10) c.rect(0, y, 160, 1, K);
        // hearth
        c.rect(118, 12, 30, 34, LG); c.rect(124, 26, 18, 20, K);
        const f = Math.floor((t || 0) * 8) % 3;
        c.poly([[127, 46], [133, 32 - f], [139, 46]], RD); c.poly([[130, 46], [133, 36 - f], [136, 46]], YL);
        c.rect(116, 10, 34, 3, DG);
        // window
        A.window(c, 70, 14, 16, 14);
        // rug
        c.ell(80, 84, 30, 8, RD); c.ell(80, 84, 24, 5, YL); c.ell(80, 84, 16, 3, RD);
        // door
                // table
        c.rect(98, 62, 20, 3, BR); c.rect(100, 65, 2, 8, BR); c.rect(114, 65, 2, 8, BR);
        // shelf, hook, drawers
        c.rect(14, 24, 36, 2, BR); c.rect(18, 26, 2, 4, BR); c.rect(44, 26, 2, 4, BR);
        c.rect(58, 14, 2, 8, DG);
        c.box(8, 50, 28, 14, BR, K); c.rect(8, 56, 28, 1, K); c.rect(21, 52, 2, 2, YL); c.rect(21, 58, 2, 2, YL);
      },
      objects: [
        { id: 'marta', name: 'Marta', aliases: ['woman', 'old woman', 'old marta', 'lady', 'granny', 'grandma'], rect: [92, 66, 22, 22], at: [100, 90], base: 88,
          draw(c, g, t) { c.ell(108, 80, 10, 8, MG); c.rect(104, 68, 9, 9, LB); A.person(c, 108, 84, { robe: LB, hair: LG, trim: WH, hat: LG }); c.rect(102, 82, 10, 1, WH); },
          desc: 'Old Marta. She is about a hundred, and she is knitting a scarf that goes out the window and around the well.',
          verbs: {
            talk(g) {
              if (!g.flag('met_marta')) { g.set('met_marta'); g.say('"Hello, dear! A knight, is it? Looking for the royal things? Take what you can use from my shelf, and the hooks, and the drawers. Nothing in here is any use to me. Mind: the honey is in the orchard, but the bees don\'t like folk. My old beekeeping veil is on the hook. And if you mean to go in the cave, bring a light!"'); }
              else g.say('"Take whatever you need, dear. There\'s a good soul."');
            },
            give: { '*': '"No, no. You keep it, dear. I have all I need."' }, attack: 'Marta swats you with the scarf. It is very long, and it reaches.', kiss: '"Oh, aren\'t you sweet."',
          } },
        { id: 'shelf', name: 'shelf', aliases: ['wooden shelf'], rect: [12, 20, 40, 12], at: [30, 64], base: 66,
          desc: g => (g.gone('lamp') ? 'A shelf with some dusty jars.' : 'A shelf with dusty jars and a brass oil lamp.'),
          verbs: { search: g => g.say(g.gone('lamp') ? 'Dusty jars.' : 'There is a brass oil lamp.') } },
        { id: 'lamp', item: 'lamp', name: 'brass lamp', aliases: ['lamp', 'lantern', 'oil lamp'], rect: [26, 14, 10, 10], at: [30, 64], base: 66,
          draw(c) { A.lamp(c, 31, 24, false); }, desc: 'A brass oil lamp, not lit.', takeMsg: 'You take the lamp. It is full of oil.', points: 3 },
        { id: 'hook', name: 'hook', aliases: ['wall hook', 'peg', 'wall'], rect: [54, 12, 10, 12], at: [60, 54], base: 56,
          desc: g => (g.gone('veil') ? 'A hook on the wall, with nothing on it.' : 'A hook with a big straw hat on it. A net veil hangs from its brim.') },
        { id: 'veil', item: 'veil', name: 'beekeeper\'s veil', aliases: ['veil', 'hat', 'straw hat', 'net'], rect: [52, 16, 14, 14], at: [60, 54], base: 56,
          draw(c) { c.ell(59, 20, 7, 2, YL); c.rect(56, 17, 6, 3, YL); c.rect(53, 22, 12, 8, LG); c.dith(53, 22, 12, 8, LG, 0, 0); }, desc: 'A straw hat with a net veil.', takeMsg: 'You take the beekeeper\'s veil.', points: 3 },
        { id: 'drawers', name: 'chest of drawers', aliases: ['drawers', 'drawer', 'chest', 'dresser', 'cabinet'], rect: [8, 50, 28, 14], at: [24, 68], base: 66,
          desc: g => (g.flag('drawer_open') ? 'A chest of drawers. The top drawer is open.' : 'A chest of drawers with a stiff top drawer.'),
          verbs: {
            open(g) { if (g.flag('drawer_open')) return g.say('It is already open.'); g.set('drawer_open'); g.say(g.gone('tinderbox') ? 'You open the top drawer. Empty.' : 'You tug open the stiff top drawer. A tin tinderbox sits inside.'); },
            close(g) { g.say('You leave it open.'); }, search(g) { g.act('open', 'drawers'); },
          } },
        { id: 'tinderbox', item: 'tinderbox', name: 'tinderbox', aliases: ['tinder', 'box', 'tin box', 'flint'], show: g => g.flag('drawer_open'), rect: [14, 50, 10, 6], at: [24, 68], base: 66,
          draw(c) { c.box(14, 52, 8, 4, LG, DG); }, desc: 'A tinderbox.', takeMsg: 'You take the tinderbox.', points: 2 },
        { id: 'fire', name: 'fire', aliases: ['hearth', 'fireplace', 'flames'], rect: [118, 12, 30, 34], at: [124, 52], desc: 'A friendly fire.',
          verbs: { take: 'Ow.', climb: 'Ow.', enter: g => g.die('You step into the fireplace. You are not the first to do this, but you are the first to do it on purpose. It is hot. Very.'), eat: 'It is fire.', light: 'It is already lit.' } },
        { id: 'scarf', name: 'scarf', aliases: ['knitting', 'wool'], rect: [90, 74, 22, 12], desc: 'The scarf goes out of the room and around the well, and probably on to the next village.', verbs: { take: 'You take the end of the scarf. Marta gently takes it back.' } },
      ],
    },

    // ---------------------------------------------------------------- the forest path
    forest: {
      name: 'Forest Path', horizon: 40, exits: { w: 'yard', e: 'cave' },
      desc: 'A dark pine forest. A cave mouth gapes in the rock to the east. A hand-painted sign nailed to a tree says: CAVE. BEAR. BRING A LIGHT.',
      blocks: [[28, 58, 8, 6], [60, 52, 8, 6], [110, 50, 8, 6]],
      exitCheck(g, dir) {
        if (dir === 'e' && !lampLit(g)) {
          g.die('You walk into the cave in the dark. The cave has a pit just inside the door. You have found it. You can tell from the way you are no longer standing.');
          return true;
        }
        return false;
      },
      listen: 'Wind in the pines. Something big snores, far off.',
      back(c, g, t) {
        A.sky(c, 44, DG, LG);
        A.ground(c, 44, GR, LGR, 40);
        c.dith(0, 44, 160, 6, GR, K, 0);
        c.rect(0, 70, 160, 14, BR); c.dith(0, 70, 160, 14, BR, GR, 0);
        // cave mouth in a rock face on the right
        c.poly([[110, 20], [160, 14], [160, 60], [110, 60]], DG); c.speck(110, 14, 50, 46, K, 0.1, 9);
        c.ell(146, 50, 14, 14, K); c.rect(132, 50, 28, 12, K);
        A.pine(c, 22, 54, 1.4); A.pine(c, 62, 46, 1.2); A.pine(c, 100, 48, 1.1); A.pine(c, 8, 70, 1.6);
        A.pine(c, 40, 96, 1.7); A.pine(c, 128, 98, 1.6);
        A.sign(c, 82, 66);
      },
      objects: [
        { id: 'cave', name: 'cave', aliases: ['cave mouth', 'cave entrance', 'entrance', 'opening', 'rock'], rect: [124, 30, 36, 34], at: [140, 66],
          desc: 'A black mouth in the rock. You hear slow, huge breathing. It is very dark inside.', verbs: { enter: g => g.exit('e') } },
        { id: 'sign', name: 'sign', aliases: ['signpost', 'wooden sign'], rect: [74, 50, 16, 18], at: [82, 70], desc: 'CAVE. BEAR. BRING A LIGHT. Someone has added, in smaller letters: bears like honey.' },
        { id: 'toadstools', name: 'red mushrooms', aliases: ['mushrooms', 'mushroom', 'toadstool', 'toadstools', 'red toadstools', 'red mushroom'], rect: [92, 84, 14, 8], at: [98, 94], base: 92,
          draw(c) { for (const [x, y] of [[94, 91], [99, 92], [103, 90]]) { c.rect(x, y - 2, 2, 3, WH); c.rect(x - 1, y - 4, 4, 2, RD); c.px(x, y - 4, WH); } },
          desc: 'A ring of shiny red mushrooms with white spots. Pretty. Probably not food.',
          verbs: {
            eat: g => g.die('You eat a red mushroom. It tastes fine for about ten seconds. Then the forest begins to sing, and then to hum, and then you lie down for a very long nap.'),
            take: 'You leave them where they are. They look like they have strong feelings about that.',
          } },
      ],
    },

    // ---------------------------------------------------------------- the cave
    cave: {
      name: 'Bear Cave', horizon: 36, exits: { w: 'forest' },
      desc: g => (g.flag('bear_gone') ? 'The lamp lights up a big, damp cave. The bear has left, and its bed is a pile of leaves.' : 'Your lamp lights up a big, damp cave. A huge brown bear sleeps in a heap in the middle, on something red.'),
      blocks: [[50, 56, 52, 24]],
      listen: g => (g.flag('bear_gone') ? 'Drips.' : 'Slow breathing. Very large breathing.'),
      back(c, g, t) {
        c.rect(0, 0, 160, 100, DG); c.speck(0, 0, 160, 100, K, 0.2, 7);
        c.poly([[0, 0], [160, 0], [160, 22], [140, 30], [110, 22], [80, 32], [50, 22], [20, 30], [0, 22]], K);
        for (const x of [20, 50, 80, 110, 140]) c.poly([[x - 4, 22], [x, 22 + 8 + ((x / 10) | 0) % 5], [x + 4, 22]], DG);
        c.rect(0, 36, 160, 64, DG); c.dith(0, 36, 160, 64, DG, K, 0);
        c.ell(80, 74, 70, 26, BR); c.speck(10, 50, 140, 48, DG, 0.12, 3);
        // lamp glow
        c.dith(0, 0, 8, 100, K, DG, 1); c.dith(152, 0, 8, 100, K, DG, 1);
      },
      objects: [
        { id: 'bear', name: 'bear', aliases: ['big bear', 'brown bear', 'grizzly', 'banner', 'red cloth', 'cloth', 'flag'], rect: [52, 46, 50, 30], at: [40, 82], base: 80,
          show: g => !g.flag('bear_gone'),
          draw(c, g, t) {
            c.ell(76, 68, 24, 10, RD);
            A.bear(c, 76, 76);
            const z = Math.floor((t || 0) * 1.1) % 3; c.px(92, 56 - z * 3, WH); c.px(94, 52 - z * 3, WH);
          },
          desc: 'A very big bear, sound asleep, with its head on its paws. It is snoring. It is lying on a crimson banner.',
          verbs: {
            talk: 'The bear snores. It does not seem to be in the mood for conversation.',
            attack: g => g.die('You attack the bear. It wakes up. You notice that it has a lot of teeth, and that you are not at all as fast as it is.'),
            push: g => g.die('You push the bear. It wakes up. It is not pleased, and it is a great deal bigger than you.'),
            pull: g => g.die('You pull the bear\'s ear. It wakes up. You learn something about bears.'),
            kiss: g => g.die('You give the bear a kiss on the nose. It wakes up, confused, and then hungry.'),
            take: g => g.die('You try to take the bear. The bear has other ideas.'),
            climb: g => g.die('You climb onto the sleeping bear. This is quite brave, and quite short.'),
            search: 'You peek under the bear. There is something red under it, but you would have to wake it to get it.',
            give: { honey(g) {
              g.lose('honey'); g.set('bear_gone'); g.score(10, 'bear');
              g.say('You hold the honeycomb under the bear\'s nose. Its nostrils twitch. One eye opens, then the other. It rises, takes the honey very gently, and ambles out of the cave with a happy grumble. A crimson banner lies where it slept.');
            }, '*': 'The bear sleeps through it.' },
          } },
        { id: 'banner', item: 'banner', name: 'royal banner', aliases: ['banner', 'flag', 'cloth'], show: g => g.flag('bear_gone'), rect: [50, 56, 52, 22], at: [76, 84], base: 80,
          draw(c) { c.rect(56, 72, 40, 8, RD); c.rect(56, 72, 40, 1, YL); c.rect(70, 74, 12, 4, YL); c.rect(72, 74, 2, 4, RD); c.rect(78, 74, 2, 4, RD); },
          desc: 'The Royal Banner of Hollowmere, crimson with a golden crown.', takeMsg: 'You pick up the banner. It is damp and fur-covered, but it is the Royal Banner.', points: 5 },
      ],
    },
  };

  const def = {
    id: 'hollowmere', title: 'The Crown of Hollowmere', maxScore: 100,
    start: { room: 'castle', x: 80, y: 80 },
    intro: 'The old king of Hollowmere is gone. He left no heir, but he left a crown, and the crown has been broken into three treasures that are lost in the kingdom: the Ruby, the Royal Ladle and the Royal Banner. Whoever brings them back to the steward may wear it. You have a good pair of boots and a feather in your cap. That will have to do.',
    help: 'Walk with the arrow keys, or click where you want to go. Type what you want to do: look, look at the well, take rope, open door, climb tree, talk to troll, give coin to crow, use rope on well. Say "inventory" to see what you carry. Look at everything. Some things in this kingdom will kill you. That is part of the fun.',
    items, rooms,
    onStart(g) { g.say('Welcome to the Kingdom of Hollowmere. Talk to the steward, and look at everything.'); },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = def; else root.HOLLOWMERE = def;
})(typeof window !== 'undefined' ? window : globalThis);
