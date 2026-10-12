/*
 * Star Sweeper: a small science-fiction adventure for the engine in shared/adventure.js.
 * You are the junior custodian on the research ship Pemberton. You slept through the evacuation. The crew took the pods, the reactor is
 * going bad, and there is one pod left. Get off the ship, cross a desert planet, and buy a ride home. Original story, text and art.
 *
 * Verb names used by handlers: look search take drop open close use give talk push pull climb enter swim eat drink wear light play attack cut kiss tie dig clean
 */
(function (root) {
  'use strict';
  const A = typeof require !== 'undefined' ? require('../shared/adventure-art.js') : root.AdvArt;
  const { K, BL, GR, CY, RD, MG, BR, LG, DG, LB, LGR, LC, LR, LM, YL, WH } = A;

  const FARE = 75;

  // ---- scenery pieces that only this game uses ----
  function stars(c, x, y, w, h, seed, t) {
    for (let i = 0; i < Math.round(w * h / 50); i++) {
      const sx = x + Math.floor(A.hash(i, seed, 1) * w), sy = y + Math.floor(A.hash(i, seed, 2) * h);
      const twinkle = Math.floor((t || 0) * 2 + i) % 7 === 0;
      c.px(sx, sy, A.hash(i, seed, 3) < 0.3 && !twinkle ? WH : LG);
    }
  }
  function planet(c, x, y, r, col, band) {
    c.ell(x, y, r, r, col);
    for (const dy of [-Math.round(r / 2), 1, Math.round(r / 2) + 1]) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); c.rect(x - w + 1, y + dy, 2 * w - 1, 1, band); }
    c.px(x - Math.round(r / 2), y - Math.round(r / 2) - 1, WH);
  }
  function panels(c, x, y, w, h, base, line) { c.rect(x, y, w, h, base); for (let i = x; i < x + w; i += 16) c.rect(i, y, 1, h, line); c.rect(x, y + Math.floor(h / 2), w, 1, line); }
  function siren(c, x, y, t) { const on = Math.floor((t || 0) * 2) % 2; c.rect(x - 2, y, 5, 3, on ? LR : RD); if (on) { c.px(x - 3, y + 1, RD); c.px(x + 3, y + 1, RD); } }
  function hazard(c, x, y, w) { for (let i = 0; i < w; i++) c.px(x + i, y, Math.floor(i / 3) % 2 ? YL : K); }
  function slime(c, x, y, t) {
    const b = Math.round(Math.sin((t || 0) * 2) * 1.5);
    c.ell(x, y - 6, 16 + b, 7 - b, GR); c.ell(x - 3, y - 8, 9, 5 + b, LGR);
    c.px(x - 6, y - 10, WH); c.px(x + 4, y - 9, WH); c.px(x - 6, y - 9, K); c.px(x + 4, y - 8, K);
    c.speck(x - 14, y - 12, 28, 10, LGR, 0.15, 3);
  }
  function mop(c, x, y) { c.line(x + 4, y - 32, x, y - 5, BR); c.rect(x - 4, y - 5, 9, 2, LG); for (let i = -4; i < 5; i += 2) c.rect(x + i, y - 3, 1, 3, WH); }
  function pod(c, x, y, lit) {
    c.ell(x, y - 14, 18, 14, LG); c.ell(x, y - 14, 16, 12, WH); c.dith(x - 16, y - 8, 32, 6, LG, WH, 0);
    c.ell(x - 4, y - 18, 7, 5, lit ? LC : CY); c.px(x - 7, y - 20, WH);
    c.rect(x - 18, y - 2, 36, 2, DG); c.rect(x + 8, y - 12, 3, 3, RD);
  }
  function suns(c) { A.sun(c, 26, 12, 6); c.ell(48, 22, 3, 3, WH); c.ell(48, 22, 2, 2, YL); }
  function dunes(c, y0, seed) {
    c.rect(0, y0, 160, 100 - y0, YL);
    for (let k = 0; k < 4; k++) for (let x = 0; x < 160; x++) {
      const yy = y0 + 8 + k * 12 + Math.round(Math.sin(x * 0.05 + k * 2 + (seed || 0)) * 3);
      c.px(x, yy, BR); if (x % 2) c.px(x, yy + 1, BR);
    }
    c.speck(0, y0, 160, 100 - y0, BR, 0.04, seed || 2); c.speck(0, y0, 160, 100 - y0, WH, 0.03, (seed || 2) + 4);
  }
  function rocket(c, x, y) {
    c.poly([[x, y - 30], [x + 26, y - 20], [x + 50, y - 18], [x + 54, y - 10], [x + 50, y - 2], [x, y - 2]], LG);
    c.rect(x + 4, y - 24, 40, 1, DG); c.rect(x + 2, y - 12, 50, 1, DG);
    c.rect(x + 38, y - 16, 8, 4, LC); c.rect(x + 12, y - 18, 3, 3, LC); c.rect(x + 20, y - 18, 3, 3, LC);
    c.poly([[x + 6, y - 2], [x + 2, y + 4], [x + 14, y + 4], [x + 16, y - 2]], DG); c.poly([[x + 34, y - 2], [x + 32, y + 4], [x + 44, y + 4], [x + 44, y - 2]], DG);
    c.rect(x - 6, y - 22, 6, 12, DG); c.rect(x - 7, y - 20, 1, 8, RD);
    c.rect(x + 22, y - 28, 10, 3, RD);
  }
  function robot(c, x, y, t) {
    c.rect(x - 5, y - 12, 11, 12, LG); c.rect(x - 4, y - 18, 9, 6, LG); c.rect(x - 3, y - 16, 7, 2, K);
    const e = Math.floor((t || 0) * 1.5) % 4 ? LC : LR; c.px(x - 2, y - 15, e); c.px(x + 2, y - 15, e);
    c.rect(x, y - 21, 1, 3, DG); c.px(x, y - 22, LR);
    c.rect(x - 8, y - 11, 3, 1, LG); c.rect(x + 6, y - 11, 3, 1, LG); c.rect(x - 8, y - 8, 3, 1, LG); c.rect(x + 6, y - 8, 3, 1, LG); // four arms
    c.rect(x - 3, y - 9, 7, 3, DG); c.px(x - 2, y - 8, LGR); c.px(x, y - 8, YL);
  }
  function alien(c, x, y, o) { // a person, but not from around here
    o = o || {};
    const skin = o.skin === undefined ? LGR : o.skin, coat = o.coat === undefined ? BR : o.coat;
    c.rect(x - 4, y - 9, 9, 9, coat); c.rect(x - 5, y - 2, 11, 2, coat);
    c.rect(x - 2, y - 15, 5, 6, skin); c.rect(x - 3, y - 14, 1, 2, skin); c.rect(x + 3, y - 14, 1, 2, skin);
    c.px(x - 1, y - 13, K); c.px(x + 1, y - 13, K); c.rect(x - 1, y - 10, 3, 1, o.mouth === undefined ? GR : o.mouth);
    if (o.horns) { c.px(x - 2, y - 17, WH); c.px(x + 2, y - 17, WH); c.px(x - 2, y - 16, WH); c.px(x + 2, y - 16, WH); }
    if (o.goggles) { c.rect(x - 2, y - 14, 5, 1, DG); c.px(x - 1, y - 13, LC); c.px(x + 1, y - 13, LC); }
  }

  // the hero, in a custodian's grey jumpsuit
  function spacer(c, x, y, dir, moving, step) {
    x = Math.round(x); y = Math.round(y);
    const f = moving ? (Math.floor(step / 4) & 1) : 0;
    c.rect(x - 2, y - 4, 2, f ? 3 : 4, CY); c.rect(x + 1, y - 4, 2, f ? 4 : 3, CY);
    c.rect(x - 2, y - 1 - (f ? 1 : 0), 2, 1, K); c.rect(x + 1, y - 1 - (f ? 0 : 1), 2, 1, K);
    c.rect(x - 3, y - 9, 7, 5, CY); c.rect(x - 3, y - 5, 7, 1, DG); c.rect(x, y - 9, 1, 4, DG);
    c.rect(x - 4, y - 9, 1, 4, CY); c.rect(x + 4, y - 9, 1, 4, CY); c.px(x - 4, y - 5, LR); c.px(x + 4, y - 5, LR);
    if (dir !== 'u') c.px(x - 2, y - 8, YL); // name patch
    c.rect(x - 2, y - 13, 5, 4, LR);
    c.rect(x - 2, y - 14, 5, 2, YL); c.px(x - 3, y - 13, YL); c.px(x + 3, y - 13, YL);
    if (dir === 'd') { c.px(x - 1, y - 11, K); c.px(x + 1, y - 11, K); }
    else if (dir === 'l') { c.px(x - 2, y - 11, K); c.rect(x + 1, y - 13, 2, 2, YL); }
    else if (dir === 'r') { c.px(x + 2, y - 11, K); c.rect(x - 2, y - 13, 2, 2, YL); }
    else c.rect(x - 2, y - 13, 5, 3, YL);
  }

  const cash = g => g.flag('cash') || 0;
  function earn(g, n) { g.set('cash', cash(g) + n); g.give('credits'); }
  // "mop the slime" or "clean slime with mop": a cleaning handler that wants the mop in hand
  const withMop = fn => (g, w) => {
    if (w && w.kind === 'item' && w.id !== 'mop') return g.say('That will not clean anything.');
    if (!g.has('mop')) return g.say('You would need your mop.');
    fn(g);
  };

  function feedEel(g) {
    if (g.flag('eel_fed')) return g.say('It is asleep. Let it sleep.');
    g.lose('brick'); g.set('eel_fed'); g.score(10, 'eel');
    g.say('You lob the Nutri-Brick at the mound. A huge mouth full of teeth comes up out of the sand, swallows the brick in one bite, and stops. It chews. It chews some more. It looks surprised, and then very full, and then it sinks into the sand with a long, happy sigh. Thirty days of nutrients. It will be asleep for a month.');
  }
  function playSlots(g) {
    if (g.flag('jackpot')) return g.say('The machine has paid out once already. It looks very sorry about it, and will not take any more tokens.');
    g.lose('token'); g.set('jackpot'); earn(g, 50); g.score(10, 'jackpot');
    g.say('You drop the token in and pull the lever. Clunk. Whirr. Moon. Moon. ... Moon. Bells ring. Lights flash. The machine spits out fifty credits, and the whole bar turns to look at you. The big alien grunts, in a way that might be impressed.');
  }

  const items = {
    mop: { name: 'mop', aliases: ['mop', 'trusty mop', 'mop handle'], desc: 'Your mop. Regulation issue, slightly bent, very absorbent. The handle says PROPERTY OF THE PEMBERTON. DO NOT LICK.',
      verbs: { drop: 'You would sooner leave your own arm behind.', eat: 'The handle says DO NOT LICK. You respect the handle.' } },
    keycard: { name: 'keycard', aliases: ['card', 'key card', 'captains keycard', 'captain keycard', 'pass'], desc: 'The captain\'s keycard. It has his photo on it. He is doing a thumbs up.' },
    brick: { name: 'Nutri-Brick', aliases: ['brick', 'nutri brick', 'nutribrick', 'ration', 'rations', 'food bar', 'food'], desc: 'An emergency Nutri-Brick. The wrapper says it holds all the nutrients a person needs for thirty days, and that it may be eaten or used as a doorstop.',
      verbs: { eat: 'You bite the Nutri-Brick. The Nutri-Brick wins. You put it away and check your teeth.' } },
    token: { name: 'slot token', aliases: ['token', 'coin', 'slot token', 'brass token'], desc: 'A brass token stamped THE DENTED MOON. ONE PLAY. NO REFUNDS.' },
    credits: { name: 'credits', aliases: ['credits', 'money', 'cash', 'chips', 'credit chips', 'fare'], desc: g => 'A little stack of credit chips. ' + cash(g) + ' credits, all told.', verbs: { drop: 'You hold on to your money. It took a lot of mopping.' } },
  };

  const rooms = {
    // ---------------------------------------------------------------- the closet
    closet: {
      name: 'Supply Closet', horizon: 56, exits: { e: 'corridor' },
      desc: 'The supply closet on deck 3, where you have been napping on a pile of rags. Shelves of cleaning fluid line the wall. A red light flashes over the door, which leads east to the corridor.',
      listen: 'A siren whoops, a long way off. A calm voice says something about the reactor.',
      smell: 'Lemon cleaner and old rags. Home.',
      back(c, g, t) {
        panels(c, 0, 0, 160, 56, DG, K);
        c.rect(0, 56, 160, 44, LG); c.speck(0, 56, 160, 44, DG, 0.08, 4); c.rect(0, 56, 160, 1, K);
        for (const sy of [18, 32, 46]) {
          c.rect(6, sy, 54, 2, BR);
          for (let i = 0; i < 6; i++) { const col = [LB, LGR, YL, LM, LC, LR][(i + sy) % 6]; c.rect(10 + i * 8, sy - 7, 4, 7, col); c.rect(11 + i * 8, sy - 9, 2, 2, WH); }
        }
        c.rect(144, 22, 16, 34, K); c.rect(146, 24, 14, 32, DG); c.dith(146, 24, 14, 32, DG, LG, 0);
        siren(c, 150, 16, t);
        c.ell(40, 80, 18, 5, BR); c.speck(22, 75, 36, 10, LG, 0.25, 6); // the rags
        A.bucket(c, 112, 72); c.rect(110, 68, 5, 1, LB);
      },
      objects: [
        { id: 'mop', item: 'mop', name: 'mop', aliases: ['trusty mop'], rect: [74, 34, 14, 40], at: [82, 80], base: 72, points: 5,
          draw(c) { mop(c, 80, 72); }, desc: 'Your mop, leaning where you left it. Good old mop.', takeMsg: 'You take your mop. You feel ready for anything, as long as anything is a spill.' },
        { id: 'rags', name: 'pile of rags', aliases: ['rags', 'pile', 'bed', 'rag'], rect: [22, 74, 36, 12], at: [40, 90],
          desc: 'Your bed, more or less. There is a mop-handle-shaped dent in it.', verbs: { search: 'Rags, a sock, and the wrapper from a snack you do not remember eating.', take: 'You have plenty of rags back home. Wherever that is.', wait: 'Not again.', climb: 'It is not time for a nap. Well, it is always time for a nap, but not today.' } },
        { id: 'shelves', name: 'shelves', aliases: ['shelf', 'bottles', 'cleaning fluid', 'fluid', 'cleaner', 'supplies', 'bottle'], rect: [6, 8, 56, 40], at: [34, 62],
          desc: 'Floor wax, glass cleaner, Gunk-B-Gone, and a bottle with a skull on it that you have always meant to ask about.',
          verbs: { take: 'You have everything you need. That is to say, a mop.', search: 'All the cleaners in the galaxy, and none of them for reactors.', drink: g => g.die('You drink the bottle with the skull on it. Now you know what it was for. The Pemberton loses its least important crew member, and does not notice.'), eat: 'No.' } },
        { id: 'bucket', name: 'bucket', aliases: ['pail', 'grey water', 'water'], rect: [106, 64, 14, 10], at: [112, 80],
          desc: 'Your bucket, full of grey water from Tuesday.', verbs: { take: 'It is heavy and it sloshes. The mop is all you need.', drink: 'It is from Tuesday.', kick: 'It sloshes.', search: 'You find a button in it. Not a useful one.' } },
        { id: 'light', name: 'red light', aliases: ['siren', 'alarm', 'light', 'lamp'], rect: [144, 12, 14, 8], at: [140, 70], desc: 'A red light, flashing. It only does that in drills. Or when it is not a drill.' },
      ],
    },

    // ---------------------------------------------------------------- the corridor
    corridor: {
      name: 'Corridor', horizon: 58, exits: { w: 'closet', e: 'bridge' },
      desc: g => 'A long corridor, empty, with the lights on red. A window shows stars and a dusty orange planet. The pod bay door is set in the north wall. ' +
        (g.flag('slime_gone') ? 'The floor by the bridge door, east, is spotless.' : 'A big green blob of slime has spread across the floor in front of the bridge door, to the east. It blinks at you.') + ' The closet is west.',
      listen: 'A calm voice: "Reactor stability is now... poor. Have a nice day."',
      exitCheck(g, dir) {
        if (dir === 'e' && !g.flag('slime_gone')) {
          g.die('You try to step over the slime. The slime does not let you. It is warm, and friendly, and it is eating your boots, and then your knees, and then everything else. The last thing you see is your name patch, floating inside it.');
          return true;
        }
        return false;
      },
      back(c, g, t) {
        panels(c, 0, 0, 160, 58, LG, DG);
        c.rect(0, 0, 160, 6, DG); for (let x = 8; x < 160; x += 32) c.rect(x, 2, 12, 2, (Math.floor((t || 0) * 2) % 2) ? LR : RD);
        // the window
        c.rect(16, 14, 48, 24, K); stars(c, 16, 14, 48, 24, 3, t); planet(c, 50, 30, 7, BR, YL); c.rect(16, 14, 48, 1, DG); c.rect(16, 37, 48, 1, DG); c.rect(40, 14, 1, 24, DG);
        // the pod bay door
        c.rect(94, 24, 28, 34, DG); c.rect(96, 26, 12, 32, LG); c.rect(108, 26, 12, 32, LG); c.rect(107, 26, 2, 32, K);
        hazard(c, 94, 24, 28); c.rect(124, 38, 4, 6, K); c.px(125, 40, g.flag('bay_open') ? LGR : LR);
        c.rect(98, 18, 20, 4, K); c.rect(100, 19, 16, 2, YL);
        // doors at each end
        c.rect(0, 20, 6, 38, DG); c.rect(154, 20, 6, 38, DG); c.rect(155, 24, 4, 34, LC);
        c.rect(0, 58, 160, 42, DG); c.speck(0, 58, 160, 42, LG, 0.06, 9); for (let x = 0; x < 160; x += 20) c.rect(x, 58, 1, 42, K);
        c.rect(0, 58, 160, 1, K);
      },
      objects: [
        { id: 'slime', name: 'slime', aliases: ['blob', 'green slime', 'goo', 'green blob', 'ooze', 'puddle', 'floor', 'specimen'], rect: [118, 62, 36, 22], at: [106, 78], base: 82,
          show: g => !g.flag('slime_gone'), draw(c, g, t) { slime(c, 136, 82, t); },
          desc: 'A blob of green slime as big as a bathtub, with two small eyes. It has a tag stuck to it: SPECIMEN 12. DO NOT FEED. It seems to be eating the floor, slowly. It hums.',
          verbs: {
            use: { mop: g => g.act('clean', 'slime'), keycard: 'The slime takes a good look at the keycard. You take it back, quickly.', '*': 'The slime absorbs your interest, and nearly your hand.' },
            clean: withMop(g => {
              g.set('slime_gone'); g.score(10, 'slime');
              g.say('You do what you were born to do. Long, even strokes. The slime is so surprised to be mopped that it squeaks, rolls itself into a ball, and slides off down a floor drain. The floor underneath is the cleanest it has ever been. You are proud of yourself, a little.');
            }),
            take: g => g.die('You try to pick up the slime. It tries to pick you up too, and it is better at it.'),
            eat: g => g.die('You take a bite of the slime. The slime takes a bite of you. It is a fair trade, for the slime.'),
            kiss: g => g.die('You kiss the slime. It is sweet about it, at first.'),
            attack: g => g.die('You kick the slime. Your foot goes in and stays there, and the rest of you follows it.'),
            talk: 'The slime hums at you. You hum back. It is a nice moment, but it does not move.', give: { '*': 'The tag says DO NOT FEED. You decide to believe it.' },
            smell: 'It smells like lime gelatin and despair.',
          } },
        { id: 'baydoor', name: 'pod bay door', aliases: ['door', 'pod bay', 'bay door', 'bay', 'reader', 'card reader', 'slot', 'sign'], rect: [92, 18, 38, 40], at: [108, 64],
          desc: g => (g.flag('bay_open') ? 'The pod bay door. The light on the card reader is green.' : 'A heavy door marked POD BAY. A card reader beside it blinks red. A sign says: COMMAND STAFF ONLY. ALSO NO MOPS.'),
          verbs: {
            open(g) {
              if (!g.flag('bay_open')) return g.say('It does not budge. The card reader blinks red at you, smugly.');
              g.say('The door hisses open, and you go through.'); g.goto('podbay', 80, 90);
            },
            use: {
              keycard(g) {
                if (!g.flag('bay_open')) { g.set('bay_open'); g.score(10, 'bay'); g.say('You swipe the captain\'s keycard. The reader thinks about it, beeps, and turns green. "Welcome, Captain," it says. "You look shorter." The door hisses open.'); }
                else g.say('The door hisses open.');
                g.goto('podbay', 80, 90);
              },
              mop: 'You poke the reader with the mop. It does not think you are the captain.', '*': 'The card reader wants a card.',
            },
            push: g => g.act('open', 'baydoor'), enter: g => g.act('open', 'baydoor'), attack: 'You kick the door. It has been kicked by better.', clean: 'You give the door a wipe. It is now a clean locked door.',
          } },
        { id: 'window', name: 'window', aliases: ['stars', 'planet', 'space', 'orange planet', 'porthole'], rect: [16, 14, 48, 24], at: [40, 64],
          desc: 'Stars, and a dusty orange planet with two suns. That will be Kesh, a desert with a spaceport on it. The pods will land there. Somewhere out there, the crew is having a nice time without you.',
          verbs: { open: 'It does not open, and you should be glad it does not.', attack: g => g.die('You hit the window with all you have. It cracks, and then it does what windows in spaceships do when they crack. You leave the ship quickly, and without the ship.'), clean: 'You polish the window until the stars sparkle. It does not help, but it looks nice.' } },
      ],
    },

    // ---------------------------------------------------------------- the bridge
    bridge: {
      name: 'Bridge', horizon: 60, exits: { w: 'corridor' },
      desc: 'The bridge of the Pemberton, with nobody on it. A wide window looks out on space. The computer\'s face glows on a screen. On the console is a big red button with a sign. The captain\'s chair is empty, and was left in a hurry.',
      listen: 'The computer hums a little tune to itself. It is a sad one.',
      blocks: [[70, 66, 20, 8]],
      back(c, g, t) {
        c.rect(0, 0, 160, 60, DG);
        c.rect(8, 4, 144, 30, K); stars(c, 8, 4, 144, 30, 7, t); planet(c, 118, 22, 10, BR, YL); c.rect(8, 4, 144, 1, LG); c.rect(8, 33, 144, 1, LG);
        for (const x of [44, 80, 116]) c.rect(x, 4, 2, 30, LG);
        c.poly([[0, 60], [10, 38], [150, 38], [160, 60]], LG); c.rect(10, 38, 140, 2, WH);
        for (let i = 0; i < 18; i++) c.rect(16 + i * 7, 46 + (i % 3) * 3, 3, 2, [LR, LGR, YL, LC][(i + Math.floor((t || 0) * 3)) % 4]);
        // the computer's face
        c.rect(66, 40, 28, 16, K); c.rect(67, 41, 26, 14, CY);
        c.rect(72, 45, 3, 3, WH); c.rect(85, 45, 3, 3, WH); const m = Math.floor((t || 0) * 3) % 3; c.rect(75, 51 - (m ? 0 : 1), 10, 1 + (m ? 0 : 1), K);
        // the red button
        c.rect(118, 44, 12, 6, DG); c.ell(124, 46, 4, 2, RD); c.px(123, 45, LR); c.rect(116, 52, 16, 4, WH); c.rect(118, 53, 12, 1, RD);
        c.rect(0, 60, 160, 40, LG); c.speck(0, 60, 160, 40, DG, 0.06, 2); c.rect(0, 60, 160, 1, K);
        // the chair
        c.rect(72, 58, 16, 10, BL); c.rect(72, 58, 16, 1, LB); c.rect(70, 66, 20, 4, BL); c.rect(79, 70, 2, 4, DG); c.rect(74, 73, 12, 1, DG);
      },
      objects: [
        { id: 'keycard', item: 'keycard', name: 'keycard', aliases: ['card', 'key card', 'captains keycard'], rect: [74, 62, 12, 8], at: [80, 82], base: 75, points: 5,
          draw(c) { c.rect(77, 65, 6, 3, WH); c.rect(77, 65, 6, 1, RD); c.px(78, 66, LR); }, desc: 'A keycard on the captain\'s chair.', takeMsg: 'You take the captain\'s keycard. You have never held one. It feels important. You do a small thumbs up, like the photo.' },
        { id: 'chair', name: 'captain\'s chair', aliases: ['chair', 'captains chair', 'seat', 'command chair'], rect: [68, 56, 24, 18], at: [96, 82],
          desc: g => 'The captain\'s chair, big and blue and still warm. ' + (g.has('keycard') ? '' : 'There is a keycard on the seat.'),
          verbs: { climb: 'You sit in the captain\'s chair. "Engage," you say, to nobody. It feels great. You get up again.', wait: 'You sit for a bit. Nothing engages.', search: g => (g.has('keycard') || g.flag('bay_open') ? g.say('Crumbs, and a hair the color of the captain.') : g.act('take', 'keycard')) } },
        { id: 'computer', name: 'computer', aliases: ['screen', 'face', 'ship computer', 'ai', 'console', 'terminal', 'nanny'], rect: [64, 38, 32, 20], at: [80, 82],
          desc: 'The ship\'s computer, NANNY, shown as a round blue face. It looks worried, which is new.',
          verbs: {
            talk(g) {
              if (!g.flag('met_nanny')) { g.set('met_nanny'); return g.say('"Oh! A person! Custodian, you missed the evacuation. Everyone left in the pods forty minutes ago. They had a cake. The reactor is going bad, and when it goes, so does the Pemberton. Pod 4 is still in the bay, and the pods land on Kesh. The bay is command staff only, so you will need the captain\'s keycard. I think he left it on his chair. And please, whatever you do, do not press the red button."'); }
              if (!g.flag('bay_open')) return g.say('"The captain\'s keycard opens the pod bay. It should be on his chair. Hurry, dear."');
              g.say('"Pod 4 is ready. Off you go. I will be fine. I have been meaning to read a book."');
            },
            clean: 'You wipe NANNY\'s screen. "Oh, that tickles," she says.', attack: '"Please do not," says NANNY. "I have enough going on."', kiss: 'You kiss the screen. NANNY goes a little pink.', push: 'You press some keys. NANNY sighs. "Those are the coffee settings."',
          } },
        { id: 'button', name: 'red button', aliases: ['button', 'big button', 'red', 'big red button', 'sign', 'label'], rect: [114, 42, 20, 16], at: [124, 82],
          desc: 'A big red button. The sign under it says: DO NOT PRESS. SERIOUSLY. Below that, smaller: THIS MEANS YOU, CUSTODIAN.',
          verbs: { push: g => g.die('You press the button. "Oh no," says NANNY. "That one makes the ship explode. It is in the manual." For a moment the Pemberton is the brightest thing for a long way. Then it is not.'), pull: 'It is a button. It does not pull.', clean: 'You polish the button, very carefully, without pressing it. You are sweating.', attack: g => g.act('push', 'button'), kiss: g => g.act('push', 'button') } },
        { id: 'viewport', name: 'viewport', aliases: ['window', 'stars', 'space', 'planet', 'kesh'], rect: [8, 4, 144, 30], at: [40, 82],
          desc: 'Space. A dusty orange planet hangs below with two suns over it. That is Kesh, where the pods go. You can see three little dots heading for it. That is the crew.' },
      ],
    },

    // ---------------------------------------------------------------- the pod bay
    podbay: {
      name: 'Pod Bay', horizon: 56, exits: { n: 'corridor' }, exitAt: { n: [108, 64] }, oneWay: ['n'],
      desc: 'The pod bay. Four cradles, three of them empty. In the last one sits escape pod 4, white and round, with its hatch open. A big airlock door is on the left, and a crew locker by it. The door to the corridor is behind you, north.',
      listen: 'The reactor makes a noise like a stomach that has eaten something it regrets.',
      back(c, g, t) {
        panels(c, 0, 0, 160, 56, DG, K);
        c.rect(0, 0, 160, 4, K);
        // the airlock
        c.ell(28, 34, 16, 18, LG); c.ell(28, 34, 13, 15, DG); c.ell(28, 34, 5, 5, LG); c.rect(14, 33, 28, 2, K);
        hazard(c, 10, 54, 36); c.rect(18, 8, 20, 4, RD); c.rect(20, 9, 16, 2, WH);
        // the locker
        c.rect(56, 24, 18, 32, LG); c.rect(57, 25, 16, 30, DG); c.rect(64, 25, 1, 30, K); c.rect(66, 38, 2, 3, YL);
        // cradles
        for (const x of [84, 104, 124]) { c.rect(x, 50, 16, 6, K); c.rect(x + 2, 52, 12, 2, DG); }
        siren(c, 80, 6, t); siren(c, 140, 6, t + 0.5);
        c.rect(0, 56, 160, 44, LG); c.speck(0, 56, 160, 44, DG, 0.08, 6); c.rect(0, 56, 160, 1, K);
        for (let x = 0; x < 160; x += 24) c.rect(x, 56, 1, 44, DG);
        pod(c, 132, 56, true); c.rect(124, 38, 10, 8, K);
      },
      objects: [
        { id: 'pod', name: 'escape pod', aliases: ['pod', 'pod 4', 'hatch', 'capsule', 'lifeboat', 'seat', 'launch button'], rect: [112, 28, 40, 30], at: [124, 66],
          desc: 'Escape pod 4. It has one seat, one big LAUNCH button and one small sticker that says ENJOY YOUR CRASH.',
          verbs: {
            enter(g) {
              g.score(10, 'launch');
              g.say('You climb into the pod, buckle up, and hit LAUNCH. The pod drops out of the Pemberton like a pea from a pod. Behind you, the ship gets smaller, and then, quite suddenly, brighter. Ahead, Kesh gets bigger, and bigger, and orange, and very close...');
              g.say('CRUNCH.');
              g.goto('crash', 82, 84);
            },
            open: g => g.act('enter', 'pod'), climb: g => g.act('enter', 'pod'), push: g => g.act('enter', 'pod'), use: { '*': g => g.act('enter', 'pod') },
            clean: 'You give the pod a quick wipe. Nobody wants to crash in a dirty pod.', search: 'One seat, a LAUNCH button, and a box under the seat marked EMERGENCY. You decide to look in it when there is an emergency.',
          } },
        { id: 'airlock', name: 'airlock', aliases: ['airlock door', 'outer door', 'round door', 'hatch door', 'lever'], rect: [10, 14, 36, 42], at: [30, 64],
          desc: 'The airlock. The sign over it says: SUIT UP FIRST. Next to it is a lever.',
          verbs: { open: g => g.die('You open the airlock. You did not suit up first. For a short time you are the fastest custodian in the galaxy.'), pull: g => g.act('open', 'airlock'), push: g => g.act('open', 'airlock'), enter: g => g.act('open', 'airlock'), clean: 'You wipe the window in the airlock door. There is nothing out there but out there.' } },
        { id: 'locker', name: 'locker', aliases: ['crew locker', 'cupboard', 'suit locker', 'suit', 'spacesuit'], rect: [54, 22, 22, 34], at: [66, 64],
          desc: 'A crew locker. The label says SPACE SUITS (12).', verbs: { open: 'Empty, apart from a coat hanger and a note: "Took the suits. Sorry. - The Crew."', search: 'Empty, apart from a coat hanger and a note: "Took the suits. Sorry. - The Crew."', clean: 'You give it a wipe. It is now the cleanest empty locker on a doomed ship.' } },
      ],
    },

    // ---------------------------------------------------------------- the crash site
    crash: {
      name: 'Crash Site', horizon: 50, exits: { e: 'dunes' }, reachedBy: 'the escape pod',
      desc: 'Kesh. Sand, sky the color of a dried apricot, and two suns, both of them too hot. Escape pod 4 sits nose down in the sand, smoking. A puddle of bright green coolant is leaking from it. Dunes roll away to the east.',
      listen: 'Wind and sand, and the pod going "tick, tick" as it cools.',
      smell: 'Hot sand and burnt pod.',
      back(c, g, t) {
        A.sky(c, 50, BR, YL); suns(c);
        A.hills(c, 52, BR, 3, 8);
        dunes(c, 50, 3);
        // the pod, nose down
        c.poly([[40, 76], [56, 54], [80, 58], [84, 78], [62, 84]], LG); c.poly([[44, 74], [58, 56], [76, 60], [78, 76], [62, 80]], WH);
        c.ell(64, 66, 6, 4, CY); c.rect(36, 80, 50, 4, BR); c.dith(36, 78, 50, 4, BR, YL, 0);
        for (let i = 0; i < 3; i++) { const p = ((t || 0) * 6 + i * 7) % 20; c.ell(66 + Math.round(Math.sin(p * 0.3) * 2), 52 - p, 2, 1, LG); }
        // coolant
        c.ell(104, 84, 12, 3, GR); c.ell(104, 84, 10, 2, LGR); if (Math.floor((t || 0) * 2) % 3 === 0) c.px(100, 83, WH);
        A.rock(c, 140, 70, 14, BR); A.rock(c, 20, 94, 10, BR);
      },
      objects: [
        { id: 'pod', name: 'escape pod', aliases: ['pod', 'pod 4', 'capsule', 'box', 'emergency box', 'seat', 'wreck'], rect: [36, 52, 50, 32], at: [82, 88],
          desc: g => 'Escape pod 4, nose down in the sand. It will not fly again. ' + (g.flag('brick_found') ? 'The emergency box is empty.' : 'There is a box under the seat marked EMERGENCY. This seems like an emergency.'),
          verbs: {
            search(g) {
              if (g.flag('brick_found')) return g.say('The box is empty, apart from a leaflet: SO YOU HAVE CRASHED.');
              g.set('brick_found'); g.give('brick'); g.score(5, 'brick'); g.emit('take');
              g.say('You open the EMERGENCY box under the seat. Inside is one Nutri-Brick, wrapped in foil, and a leaflet called SO YOU HAVE CRASHED. You take the brick. The leaflet just says "Oh dear" on every page.');
            },
            open: g => g.act('search', 'pod'), take: g => g.act('search', 'pod'), enter: 'You climb back in. It is hot, and it smells of burnt toast. You climb out.', climb: 'You climb on top of the pod and look around. Sand. More sand. Far to the east, a tower. You climb down.',
            push: 'The pod is stuck fast in the sand.', clean: 'You start to mop the pod and then you stop and think about your life.',
          } },
        { id: 'coolant', name: 'coolant', aliases: ['puddle', 'green puddle', 'green liquid', 'liquid', 'leak', 'goo'], rect: [90, 78, 28, 10], at: [104, 92],
          desc: 'A puddle of bright green coolant. It looks a bit like a fizzy drink. The label on the pod says COOLANT: DO NOT DRINK, EVEN IF THIRSTY.',
          verbs: { drink: g => g.die('You are thirsty, and it does look like a fizzy drink. It is not a fizzy drink. You glow for a while, and then you stop glowing, and then you stop.'), eat: g => g.act('drink', 'coolant'), clean: 'You mop up the coolant. The mop hisses, and you decide to stop.', take: 'You have nothing to carry it in, and you do not want it anyway.', swim: 'It is a puddle, and a nasty one.' } },
        { id: 'suns', name: 'suns', aliases: ['sun', 'sky', 'two suns'], rect: [16, 4, 40, 26], at: [40, 70], desc: 'Two suns. One would have been plenty.' },
      ],
    },

    // ---------------------------------------------------------------- the dunes
    dunes: {
      name: 'Dunes', horizon: 46, exits: { w: 'crash', e: 'spaceport' },
      desc: g => 'Rolling dunes. A skeleton in a tattered flight suit lies half buried in the sand. ' +
        (g.flag('eel_fed') ? 'Something large is asleep under the dunes, digesting.' : 'In the middle of the way east, a mound of sand is moving in slow circles, as if something under it is waiting for lunch.') + ' A tower shows on the horizon to the east.',
      listen: g => (g.flag('eel_fed') ? 'Something under the sand is snoring.' : 'A low hiss, like sand pouring, from the moving mound.'),
      exitCheck(g, dir) {
        if (dir === 'e' && !g.flag('eel_fed')) {
          g.die('You set off east across the dunes. The moving mound stops moving. Then the ground opens up under you, and it turns out to be a mouth. A sand eel of Kesh can go a year between meals. This one does not have to.');
          return true;
        }
        return false;
      },
      back(c, g, t) {
        A.sky(c, 46, BR, YL); suns(c);
        c.rect(126, 28, 3, 18, DG); c.rect(124, 26, 7, 3, DG); c.px(127, 24, LR);
        dunes(c, 46, 7);
        // the skeleton
        c.ell(36, 76, 10, 3, BR); c.rect(28, 72, 14, 3, BL); c.ell(26, 72, 3, 3, WH); c.px(25, 72, K); c.px(27, 72, K);
        for (let i = 0; i < 3; i++) c.rect(31 + i * 3, 71, 1, 4, WH); c.rect(42, 74, 5, 1, WH); c.rect(42, 76, 5, 1, WH);
        // the mound
        if (!g.flag('eel_fed')) {
          const p = (t || 0) * 1.4;
          c.ell(108, 70, 18, 6, BR); c.ell(108, 68, 14, 4, YL);
          for (let i = 0; i < 8; i++) { const a = p + i * 0.8; c.px(108 + Math.round(Math.cos(a) * 16), 70 + Math.round(Math.sin(a) * 5), BR); }
        } else { c.dith(92, 66, 32, 6, YL, BR, 0); c.px(108 + (Math.floor((t || 0) * 1.5) % 3), 66, WH); }
      },
      objects: [
        { id: 'skeleton', name: 'skeleton', aliases: ['bones', 'skull', 'body', 'flight suit', 'pilot', 'dead pilot', 'pocket', 'pockets'], rect: [20, 64, 30, 14], at: [36, 84], base: 78,
          desc: 'What is left of a pilot, in a flight suit with a lot of pockets. He looks as if he was in a hurry to go east.',
          verbs: {
            search(g) {
              if (g.flag('token_found')) return g.say('Just sand in the pockets now, and a lot of it.');
              g.set('token_found'); g.give('token'); g.score(5, 'token'); g.emit('take');
              g.say('You go through the pockets, apologising as you go. Sand, sand, a comb, sand, and a brass token from a bar called The Dented Moon. You take the token. He was not going to use it.');
            },
            take: g => g.act('search', 'skeleton'), open: g => g.act('search', 'skeleton'), talk: 'He has nothing to say. Well, he has one thing to say, and it is "do not go east without a plan."', kiss: 'No.', attack: 'He has had a bad enough day.', clean: 'You brush the sand off his face. He looks a little happier. Or the same.',
          } },
        { id: 'eel', name: 'sand mound', aliases: ['mound', 'eel', 'sand eel', 'worm', 'monster', 'circle', 'thing', 'moving sand'], rect: [88, 60, 40, 16], at: [80, 84],
          desc: g => (g.flag('eel_fed') ? 'A long bump under the sand, rising and falling, very slowly. It is asleep.' : 'A mound of sand going round in slow circles. Every now and then a small eye on a stalk comes up, has a look at you, and goes back down.'),
          verbs: {
            give: {
              brick: feedEel,
              mop: 'The eye looks at the mop. You pull the mop back before the mouth gets a look too.',
              '*': 'The eye has a look at it and goes back down. Not food. Not interesting.',
            },
            use: { brick: feedEel, '*': 'The eye looks at it and goes back down.' },
            attack: g => (g.flag('eel_fed') ? g.say('Let sleeping eels lie.') : g.die('You poke the mound. The mound pokes back with a lot of teeth.')),
            take: g => (g.flag('eel_fed') ? g.say('It is the size of a train.') : g.die('You reach into the moving sand. Something reaches back.')),
            enter: g => (g.flag('eel_fed') ? g.say('You walk around it, politely.') : g.die('You walk right into the middle of the moving mound. The mound is a mouth, and you have walked right into it.')),
            dig: g => (g.flag('eel_fed') ? g.say('You decide not to wake it.') : g.die('You dig into the mound. The mound digs back.')),
            talk: g => g.say(g.flag('eel_fed') ? 'It snores.' : 'A small eye on a stalk pops up and looks at you hungrily.'),
            kiss: g => (g.flag('eel_fed') ? g.say('It snores at you. That is sweet, in a way.') : g.die('You lean down to kiss the mound. It leans up to kiss you, with teeth.')),
          } },
        { id: 'tower', name: 'tower', aliases: ['horizon', 'spaceport', 'town'], rect: [118, 20, 18, 26], at: [80, 84], desc: 'A tower on the horizon to the east, with a light on top. A spaceport, maybe. Where there are spaceports, there are ways off planets.' },
      ],
    },

    // ---------------------------------------------------------------- the spaceport
    spaceport: {
      name: 'Spaceport', horizon: 58, exits: { w: 'dunes' },
      desc: 'A dusty little spaceport. A battered red and grey ship sits on the landing pad, its engine ticking. Across the way is a bar with a dented moon on its sign. The dunes are west.',
      listen: 'The ship\'s engine ticks. From the bar comes music, and a crash, and laughter.',
      back(c, g, t) {
        A.sky(c, 58, BR, YL); suns(c);
        c.rect(0, 58, 160, 42, YL); c.speck(0, 58, 160, 42, BR, 0.06, 11);
        c.rect(4, 54, 74, 6, DG); c.rect(4, 54, 74, 1, LG); hazard(c, 4, 59, 74);
        rocket(c, 18, 52);
        // the bar
        c.rect(90, 16, 66, 42, BR); c.speck(90, 16, 66, 42, DG, 0.08, 4); c.rect(88, 14, 70, 3, DG);
        c.rect(98, 4, 50, 10, K); c.ell(108, 9, 3, 3, (Math.floor((t || 0) * 2) % 3) ? YL : LG); c.px(109, 8, BR);
        for (let i = 0; i < 4; i++) c.rect(116 + i * 7, 7, 5, 4, (Math.floor((t || 0) * 2) + i) % 5 ? LM : MG);
        c.rect(116, 34, 16, 24, K); c.rect(117, 36, 14, 22, DG); c.px(129, 47, YL);
        c.rect(96, 26, 12, 10, YL); c.rect(140, 26, 12, 10, YL); c.rect(96, 26, 12, 1, DG); c.rect(140, 26, 12, 1, DG);
        A.rock(c, 82, 90, 10, BR);
      },
      objects: [
        { id: 'bardoor', name: 'bar door', aliases: ['door', 'bar', 'dented moon', 'the dented moon', 'sign', 'building'], rect: [114, 32, 20, 26], at: [124, 66],
          desc: 'The Dented Moon. The sign is a moon with a dent in it. The door has a lot of boot marks on it, at about the height of a boot.',
          verbs: { open: g => { g.say('You push the door open and go in.'); g.goto('bar', 80, 94); }, enter: g => g.act('open', 'bardoor'), push: g => g.act('open', 'bardoor'), pull: g => g.act('open', 'bardoor'), clean: 'You wipe a boot mark off the door. There are many more.' } },
        { id: 'ship', name: 'ship', aliases: ['rocket', 'spaceship', 'red ship', 'starship', 'landing pad', 'pad', 'hatch'], rect: [20, 20, 54, 36], at: [44, 66],
          desc: 'A battered red and grey ship, with RUSTY VELL on the side. It looks as if it has been in some fights, and lost some, and kept going anyway. The hatch is locked.',
          verbs: { open: 'Locked. Whoever owns it is not here.', enter: 'The hatch is locked. Whoever owns it is not here.', push: 'It weighs about as much as a building.', clean: 'You wipe a patch of the hull clean. Under the dirt is more dirt.', attack: 'You kick the ship. Something falls off it. You put it back.' } },
        { id: 'engine', name: 'engine', aliases: ['thruster', 'exhaust', 'nozzle', 'engines'], rect: [8, 26, 12, 18], at: [24, 66],
          desc: 'The ship\'s engine, ticking as it cools. A sticker says: CHECK FOR CREW BEFORE AUTO-WARMUP.',
          verbs: { enter: g => g.die('You crawl into the engine for a better look. You did not check the sticker. The ship\'s automatic warm-up checks it for you.'), climb: g => g.act('enter', 'engine'), search: g => g.act('enter', 'engine'), clean: 'You start mopping the engine and then you read the sticker and you stop.', push: 'It is very hot.', take: 'It is very hot and it is bolted on.' } },
      ],
    },

    // ---------------------------------------------------------------- the bar
    bar: {
      name: 'The Dented Moon', horizon: 60, exits: { s: 'spaceport' }, exitAt: { s: [124, 66] }, oneWay: ['s'],
      desc: g => 'The Dented Moon. Dark, loud and sticky. A robot with four arms tends the bar. A very large alien hunches on a stool. A lizard in a flight jacket sits at a table with her boots up. A slot machine glows in the corner. ' +
        (g.flag('mopped') ? 'The floor is clean. Nobody knows what to make of it.' : 'There is a big purple puddle in the middle of the floor.') + ' The door is south.',
      listen: 'A jukebox plays the one song it knows. The big alien grumbles at it.',
      smell: g => (g.flag('mopped') ? 'Fried things and spilled drinks, but less of the drinks.' : 'Fried things and spilled drinks. Mostly the purple one.'),
      back(c, g, t) {
        c.rect(0, 0, 160, 60, DG); c.speck(0, 0, 160, 60, K, 0.12, 5);
        // shelves of glowing bottles
        for (const sy of [14, 26]) { c.rect(46, sy, 70, 1, BR); for (let i = 0; i < 9; i++) c.rect(48 + i * 8, sy - 6, 3, 6, [LM, LC, LGR, YL, LR][(i + sy) % 5]); }
        c.rect(126, 6, 26, 14, K); c.rect(128, 8, 22, 10, (Math.floor((t || 0) * 2) % 2) ? MG : LM);
        // the jukebox
        c.rect(30, 30, 12, 26, MG); c.ell(36, 32, 6, 3, LM); c.rect(32, 36, 8, 10, YL); c.rect(33, 37 + (Math.floor((t || 0) * 4) % 8), 6, 1, LR);
        // the floor
        c.rect(0, 60, 160, 40, BR); for (let y = 62; y < 100; y += 6) c.rect(0, y, 160, 1, DG); c.rect(0, 60, 160, 1, K);
        // the slot machine
        c.rect(4, 30, 18, 30, RD); c.rect(6, 34, 14, 8, K);
        const s = g.flag('jackpot') ? [LR, LR, LR] : [YL, LGR, LC];
        for (let i = 0; i < 3; i++) c.rect(7 + i * 5, 36, 3, 4, s[i]);
        c.rect(22, 34, 2, 8, LG); c.ell(23, 33, 2, 2, LR); c.rect(8, 46, 10, 2, YL);
        if (g.flag('jackpot') && Math.floor((t || 0) * 3) % 2) c.rect(6, 28, 14, 2, YL);
      },
      objects: [
        { id: 'counter', name: 'bar counter', aliases: ['counter', 'bar', 'glasses', 'bottles', 'shelves'], rect: [40, 44, 88, 14], at: [100, 66], base: 59,
          draw(c) { c.rect(40, 44, 88, 14, BR); c.rect(40, 44, 88, 2, YL); c.rect(40, 57, 88, 1, K); c.rect(98, 40, 3, 4, LC); c.rect(60, 41, 3, 3, LGR); },
          desc: 'A long counter, sticky in places, with glowing bottles on the shelves behind it.', verbs: { clean: 'You give the counter a wipe. "That is my job," says the robot. "The floor is yours."', climb: '"Off the bar," says the robot, with two of its arms.' } },
        { id: 'bartender', name: 'bartender', aliases: ['robot', 'barkeep', 'droid', 'server', 'splash'], rect: [62, 26, 20, 18], at: [72, 66], base: 44,
          draw(c, g, t) { robot(c, 72, 46, t); },
          desc: 'A robot with four arms, cleaning four glasses with four cloths. Its name tag says SPLASH.',
          verbs: {
            talk(g) {
              if (g.flag('mopped')) return g.say('"Best-looking floor this side of the suns, custodian. You ever want a job, you know where I am."');
              if (!g.flag('met_splash')) { g.set('met_splash'); return g.say('"WE DON\'T SERVE YOUR KIND," says the robot. "What kind?" you ask. "Broke," it says. Then it looks at your jumpsuit, and at your mop. "Hold on. You clean? Somebody dropped a Purple Plasma Punch on my floor and nobody here has touched a mop since the war. Mop it up and I\'ll pay you twenty-five credits."'); }
              g.say('"Twenty-five credits to mop that puddle. Standing offer."');
            },
            give: { '*': '"I don\'t want that. I want my floor clean."' },
            attack: 'The robot catches your fist in one hand and keeps polishing glasses with the other three. You go back to what you were doing.',
            kiss: '"Not on duty," says the robot.', clean: 'You polish the bar. "That is my job," says the robot. "The floor is yours."',
          } },
        { id: 'puddle', name: 'puddle', aliases: ['purple puddle', 'floor', 'spill', 'drink', 'punch', 'plasma punch', 'mess', 'sticky floor'], rect: [70, 70, 30, 10], at: [86, 86], base: 72,
          show: g => !g.flag('mopped'), draw(c) { c.ell(84, 75, 12, 3, MG); c.ell(82, 74, 7, 2, LM); },
          desc: 'A big sticky puddle of Purple Plasma Punch. It is eating a little hole in the floor.',
          verbs: {
            use: { mop: g => g.act('clean', 'puddle'), '*': 'That will not mop anything.' },
            clean: withMop(g => {
              g.set('mopped'); earn(g, 25); g.score(10, 'mopped');
              g.say('You mop. You mop like you have never mopped before. The bar goes quiet to watch. When you are done, the floor shines, and somebody claps, once. The robot slides twenty-five credits across the counter. "Never thought I\'d see that floor again," it says.');
            }),
            drink: g => g.die('You get down on your knees and drink the Purple Plasma Punch off the floor. The whole bar goes quiet. It turns out it was on the floor for a good reason, and that reason was you.'),
            take: 'It is a puddle.', eat: g => g.act('drink', 'puddle'),
          } },
        { id: 'brute', name: 'big alien', aliases: ['alien', 'brute', 'big guy', 'monster', 'customer', 'large alien', 'stool', 'grub'], rect: [126, 30, 26, 32], at: [120, 74], base: 62,
          draw(c) { c.rect(134, 56, 2, 6, DG); c.rect(130, 61, 10, 1, DG); c.rect(130, 34, 20, 22, GR); c.rect(132, 24, 14, 12, GR); c.px(135, 28, LR); c.px(140, 28, LR); c.px(143, 28, LR); c.rect(134, 32, 10, 1, K); c.px(133, 22, WH); c.px(145, 22, WH); c.rect(124, 42, 8, 3, GR); },
          desc: 'A very large green alien with three red eyes and a drink the size of a bucket. He is not looking at you. You would like to keep it that way.',
          verbs: {
            talk: '"GRNNH," says the alien, without turning around. You decide that was the whole conversation.',
            attack: g => g.die('You tap the big alien on the shoulder and get ready to fight. He turns around. He keeps turning around for a while, because there is a lot of him. You do not get ready in time.'),
            kiss: g => g.die('You kiss the big alien on the cheek. All three of his eyes open very wide. In his culture this means you are now married, and in his culture marriage is short.'),
            take: g => g.die('You reach for the big alien\'s drink. His hand gets there first, and then it gets to you.'),
            give: { '*': 'He sniffs it, and then he looks at you with all three eyes. You put it away and back off slowly.' },
            clean: 'You start to mop around his stool. He growls. You mop somewhere else.',
          } },
        { id: 'vell', name: 'Vell', aliases: ['lizard', 'pilot', 'captain', 'woman', 'table', 'flight jacket', 'rusty vell', 'captain vell'], rect: [34, 62, 30, 26], at: [62, 92], base: 86,
          draw(c) { c.rect(34, 78, 22, 2, BR); c.rect(44, 80, 2, 6, BR); alien(c, 52, 82, { skin: LGR, coat: RD, goggles: true }); c.rect(56, 75, 6, 2, K); c.rect(38, 75, 3, 3, LC); },
          desc: 'A lizard in a red flight jacket and goggles, with her boots up on the table. She has the look of a pilot who owns a battered red and grey ship.',
          verbs: {
            talk(g) {
              if (!g.flag('met_vell')) { g.set('met_vell'); return g.say('"Ride off-world? Sure, kid. Rusty Vell will take anyone anywhere, for ' + FARE + ' credits. Cash. No, I don\'t take mops." She looks you up and down. "Pemberton, huh? Saw it blow up. Pretty. Your crew came through an hour ago, by the way. Had cake."'); }
              g.say(cash(g) >= FARE ? '"That looks like ' + FARE + ' credits to me. Hand it over, and we fly."' : '"' + FARE + ' credits, kid. ' + (cash(g) ? 'You\'ve got ' + cash(g) + '.' : 'You\'ve got nothing.') + ' Come back when you\'ve got the rest."');
            },
            give: {
              credits(g) {
                if (cash(g) < FARE) return g.say('Vell counts it. "That\'s ' + cash(g) + '. Fare\'s ' + FARE + '. I\'m a pilot, not a charity."');
                g.lose('credits'); g.set('cash', cash(g) - FARE); g.score(20, 'fare');
                g.win('Vell counts it twice, and grins with a lot of small teeth. "Welcome aboard, custodian." Her ship rattles, coughs, and lifts off into the orange sky, with the dunes falling away below and the big sand eel snoring under them. Vell puts on the autopilot and puts her boots up. "So. Where to?" You look at the stars and think about it. Then you notice the floor of her ship. It has not been mopped since the war. You get out your mop. It is going to be a long, happy trip.');
              },
              token: '"A slot token? Kid, I want credits. Go play it."', mop: '"I said no mops."', '*': '"Credits, kid. ' + FARE + ' of them."',
            },
            attack: 'Vell puts her boots down. You decide to be friends.', kiss: '"Ha! No."', clean: 'You give her table a wipe. "Thanks," she says. "Still ' + FARE + ' credits."',
          } },
        { id: 'slots', name: 'slot machine', aliases: ['slots', 'machine', 'slot', 'one armed bandit', 'lever', 'handle', 'gambling machine'], rect: [2, 26, 24, 34], at: [18, 66],
          desc: g => (g.flag('jackpot') ? 'The slot machine is still flashing JACKPOT, and looks rather sorry about it.' : 'A slot machine with three windows and a lever. It takes brass tokens. A sticker says: ONE PLAY PER CUSTOMER, AND NO HITTING.'),
          verbs: {
            use: {
              token: playSlots,
              '*': 'It only takes tokens.',
            },
            pull: g => (g.has('token') ? playSlots(g) : g.say(g.flag('jackpot') ? 'Nothing happens. The machine has done its one good deed.' : 'You pull the lever. Nothing happens. It wants a token first.')),
            play: g => g.act('pull', 'slots'), push: g => g.act('pull', 'slots'),
            attack: g => g.die('You give the slot machine a good kick, like you saw in a film. It gives you a good jolt, like nobody has ever seen. The sticker did say NO HITTING.'),
            clean: 'You wipe the glass. The three windows sparkle at you.', take: 'It is bolted to the floor, and to the wall, and to a chain.',
          } },
        { id: 'jukebox', name: 'jukebox', aliases: ['music', 'song', 'juke'], rect: [28, 26, 16, 30], at: [36, 64], desc: 'A jukebox that knows one song. Everyone here hates it, and nobody can turn it off.', verbs: { push: 'You press every button. It plays the same song.', attack: 'The big alien looks round at you, hopeful. You stop.', kiss: 'You are not that lonely yet.' } },
      ],
    },
  };

  const def = {
    id: 'starsweeper', title: 'Star Sweeper', maxScore: 100, music: 'space', hero: spacer,
    start: { room: 'closet', x: 96, y: 86 },
    intro: 'You are the junior custodian of the research ship Pemberton. You were having a short nap in the supply closet. It was longer than you meant. While you slept, the reactor started to go bad, the crew got into the escape pods, and somebody forgot to check the supply closet. Now the ship is empty, the sirens are going, and there is one pod left. All you have is a mop. That might be enough.',
    help: 'Walk with the arrow keys, or click where you want to go. Type what you want to do: look, look at the slime, take mop, talk to computer, mop slime, use keycard on door, give brick to eel, search skeleton. Say "inventory" to see what you carry. Talk to everyone and look at everything. A lot of things in space can kill you, and you can always try again.',
    waitText: 'You wait. Somewhere, a reactor does not.',
    items, rooms,
    onStart(g) { g.say('You wake up on a pile of rags with a mop-handle-shaped dent in your cheek. A siren is going. A calm voice says, "This is not a drill. Please proceed to the escape pods." That does not sound good.'); },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = def; else root.STARSWEEPER = def;
})(typeof window !== 'undefined' ? window : globalThis);
