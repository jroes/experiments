/*
 * The Lamp at Gullrock: a small seaside adventure for the engine in shared/adventure.js.
 * The lighthouse is dark, the keeper is ill in bed and a storm is coming, with the supper boat still out. You are the keeper's apprentice.
 * You need oil, a wick and a light. Original story, text and art.
 *
 * Verb names used by handlers: look search take drop open close use give talk push pull climb enter swim eat drink wear light play attack cut kiss tie dig
 */
(function (root) {
  'use strict';
  const A = typeof require !== 'undefined' ? require('../shared/adventure-art.js') : root.AdvArt;
  const { K, BL, GR, CY, RD, MG, BR, LG, DG, LB, LGR, LC, LR, LM, YL, WH } = A;

  const SAND = YL; // the closest EGA colour to sand; the dither with white and brown softens it

  // ---- scenery pieces that only this game uses ----
  function sea(c, y0, y1, t) {
    c.rect(0, y0, 160, y1 - y0, BL);
    c.dith(0, y0, 160, 3, CY, BL, 0);
    for (let y = y0 + 3; y < y1; y += 4) for (let x = 0; x < 160; x += 9) {
      const o = Math.round(Math.sin((t || 0) * 1.2 + x * 0.3 + y) * 2);
      c.rect(((x + y * 5) % 160 + 160 + o) % 160, y, 4, 1, LB);
    }
  }
  function sand(c, y0) { c.rect(0, y0, 160, 100 - y0, SAND); c.speck(0, y0, 160, 100 - y0, BR, 0.05, 5); c.speck(0, y0, 160, 100 - y0, WH, 0.06, 9); }
  function surf(c, y, t) { for (let x = 0; x < 160; x += 2) { const w = Math.round(Math.sin(x * 0.2 + (t || 0) * 1.5) * 1); c.rect(x, y + w, 2, 2, WH); } }
  function lighthouse(c, x, y, h, lit) {
    const w = 18;
    c.poly([[x - w / 2, y], [x + w / 2, y], [x + w / 2 - 3, y - h], [x - w / 2 + 3, y - h]], WH);
    for (let i = 0; i < 4; i++) {
      const ya = y - h + i * (h / 4) + 6, hh = h / 8;
      c.poly([[x - w / 2 + 3 - (i * 0.8), ya + hh + 3], [x + w / 2 - 3 + (i * 0.8), ya + hh + 3], [x + w / 2 - 2.5 + (i * 0.8), ya + hh * 2 + 3], [x - w / 2 + 2.5 - (i * 0.8), ya + hh * 2 + 3]], RD);
    }
    c.rect(x - w / 2 + 1, y - h - 2, w - 2, 3, DG);
    c.rect(x - 5, y - h - 10, 10, 8, lit ? YL : LC); c.rect(x - 5, y - h - 10, 10, 1, K); c.rect(x - 5, y - h - 3, 10, 1, K); c.rect(x, y - h - 10, 1, 8, K);
    c.poly([[x - 6, y - h - 10], [x, y - h - 16], [x + 6, y - h - 10]], RD);
    c.rect(x - 3, y - 10, 6, 10, BR); c.px(x + 2, y - 5, YL);
    c.rect(x - 1, y - h + 12, 3, 4, K);
  }
  function cottage(c, x, y, w, h, wall, roof) {
    A.house(c, x, y, w, h, roof, wall); A.door(c, x + Math.floor(w / 2) - 3, y, 7, 11, BR); A.window(c, x + 3, y - h + 5, 6, 5);
  }
  function gull(c, x, y, t) { const f = Math.floor((t || 0) * 3 + x) % 2; c.rect(x - 3, y + (f ? 0 : 1), 3, 1, WH); c.rect(x + 1, y + (f ? 0 : 1), 3, 1, WH); c.px(x, y + 1, WH); c.px(x - 4, y + (f ? 1 : 0), LG); c.px(x + 4, y + (f ? 1 : 0), LG); }
  function cat(c, x, y) { c.ell(x, y - 3, 4, 3, BR); c.ell(x + 4, y - 6, 2, 2, BR); c.px(x + 3, y - 9, BR); c.px(x + 5, y - 9, BR); c.px(x + 4, y - 6, YL); c.rect(x - 7, y - 4, 4, 1, BR); c.px(x - 8, y - 5, BR); }
  function crab(c, x, y, t) { c.ell(x, y - 2, 4, 2, RD); c.px(x - 2, y - 4, WH); c.px(x + 2, y - 4, WH); c.rect(x - 7, y - 4, 3, 2, RD); c.rect(x + 5, y - 4, 3, 2, RD); const f = Math.floor((t || 0) * 2) % 2; c.px(x - 4, y + f, RD); c.px(x + 4, y + (1 - f), RD); }
  function pier(c, x0, x1, y, h) {
    c.rect(x0, y, x1 - x0, h, BR);
    for (let x = x0; x < x1; x += 5) c.rect(x, y, 1, h, K);
    c.rect(x0, y, x1 - x0, 1, YL);
    for (let x = x0 + 2; x < x1; x += 16) c.rect(x, y + h, 3, 10, BR);
  }
  function boat(c, x, y) { c.poly([[x - 12, y - 6], [x + 12, y - 6], [x + 8, y], [x - 8, y]], BR); c.rect(x - 12, y - 6, 24, 1, YL); c.rect(x - 1, y - 14, 1, 8, BR); }
  function bucketFish(c, x, y) { A.bucket(c, x, y); }
  function bench(c, x, y) { c.rect(x - 9, y - 6, 18, 2, BR); c.rect(x - 9, y - 10, 18, 1, BR); c.rect(x - 8, y - 4, 2, 4, BR); c.rect(x + 6, y - 4, 2, 4, BR); }
  function bunting(c, x0, x1, y) { for (let x = x0; x < x1; x += 6) { c.px(x, y + Math.round(Math.sin((x - x0) * 0.2) * 2), BR); c.rect(x + 1, y + 1 + Math.round(Math.sin((x - x0) * 0.2) * 2), 3, 3, [RD, YL, LB, LGR][((x - x0) / 6) % 4 | 0]); } }

  const items = {
    bucket: { name: 'tin bucket', aliases: ['bucket', 'pail', 'tin bucket'], desc: g => (g.flag('bucket_wet') ? 'A dented tin bucket, wet inside.' : 'A dented tin bucket with a rope handle. It has a smell of old fish.') },
    fish: { name: 'flounder', aliases: ['fish', 'flounder', 'fresh fish'], desc: 'A fat, fresh flounder, flapping a little in the bucket.', food: 'You eat the whole flounder raw. It was rather good, but you suspect somebody was waiting for it.' },
    glasses: { name: 'spectacles', aliases: ['spectacles', 'glasses', 'specs', 'hermits spectacles', 'eyeglasses'], desc: 'A pair of small round spectacles with one cracked arm, held together with fishing line.' },
    glass: { name: 'blue sea glass', aliases: ['glass', 'sea glass', 'blue glass', 'bottle glass', 'shard'], desc: 'A piece of bottle glass worn smooth by the sea, blue as a summer sky.' },
    oil: { name: 'can of oil', aliases: ['oil', 'can', 'lamp oil', 'oil can', 'can of oil'], desc: 'A heavy tin can of lamp oil. It smells like fish.', verbs: { drink: g => g.die('You drink the lamp oil. It tastes like a candle that has been lying in a harbour. You do not recover.') } },
    wick: { name: 'braided wick', aliases: ['wick', 'braid', 'yarn', 'braided wick'], desc: 'A thick braided wick of cotton and wool, as long as your arm.' },
    matches: { name: 'box of matches', aliases: ['matches', 'match', 'matchbox', 'box', 'box of matches'], desc: 'A tin box of dry matches, with a picture of a ship on the lid.' },
  };

  const rooms = {
    // ---------------------------------------------------------------- the village
    village: {
      name: 'Gullrock Village', horizon: 44, exits: { e: 'beach', n: 'cliff' },
      desc: 'Gullrock, a handful of little cottages on a hill above the harbour, under a heavy grey sky. Granny Gull sits knitting on a bench. A notice is pinned to a board. The beach is east, the cliff path north.',
      listen: 'Wind, gulls, and the harbour bell ringing, over and over.',
      back(c, g, t) {
        A.sky(c, 36, DG, LG); A.cloud(c, 40, 10, LG); A.cloud(c, 110, 18, DG);
        A.hills(c, 46, GR, 4, 6);
        A.ground(c, 44, GR, LGR, 7);
        c.dith(0, 44, 160, 3, GR, DG, 0);
        cottage(c, 8, 62, 30, 20, YL, RD); cottage(c, 46, 56, 26, 18, LC, BL); cottage(c, 116, 60, 30, 20, LM, DG);
        c.dith(70, 60, 24, 40, BR, GR, 0); c.dith(0, 78, 160, 6, BR, GR, 1);
        bunting(c, 6, 150, 36);
        bench(c, 108, 82);
        // notice board
        c.rect(28, 66, 2, 12, BR); c.rect(46, 66, 2, 12, BR); c.rect(24, 56, 28, 12, BR); c.rect(26, 58, 24, 8, LG); c.rect(28, 60, 8, 1, K); c.rect(28, 62, 14, 1, K); c.rect(38, 59, 8, 5, WH);
        A.flowers(c, 0, 86, 100, 12, 3);
        gull(c, 70, 20, t); gull(c, 90, 28, t + 1);
      },
      objects: [
        { id: 'granny', name: 'Granny Gull', aliases: ['granny', 'gull', 'woman', 'old woman', 'old lady', 'granny gull', 'knitter'], rect: [98, 62, 22, 24], at: [100, 90], base: 86,
          draw(c) { A.person(c, 110, 86, { robe: LB, hat: WH, hair: WH, trim: WH }); c.rect(104, 78, 14, 3, RD); c.rect(116, 80, 2, 8, RD); },
          desc: 'Granny Gull, the oldest person in the village, knitting something very long and very red.',
          verbs: {
            talk(g) {
              if (g.flag('gave_glass')) return g.say('"Bless you, dear. Go and light that lamp."');
              if (!g.flag('met_granny')) { g.set('met_granny'); return g.say('"The lamp is out and the keeper\'s abed with the fever, the poor lamb. And the supper boat out there with the little ones aboard. You\'ll want a wick, dear. The old one rotted. I braid a good one, but I\'m out of the thing I use to tie the ends: a bit of blue glass. The sea washes it up in the cove, but I can\'t go down there with these knees."'); }
              g.say(g.has('glass') ? '"Is that blue glass? Give it here, dear!"' : '"A bit of blue sea glass from the cove, dear. Then I\'ll braid your wick."');
            },
            give: {
              glass(g) { g.lose('glass'); g.give('wick'); g.set('gave_glass'); g.score(15, 'wick'); g.say('"Oh, that\'s a lovely one." Her needles click and her fingers fly. In a minute there is a thick braided wick in your hand, as long as your arm. "Off you go now, dear. Quick as you can."'); },
              '*': '"No, dear. That\'s not what I need."',
            },
            attack: 'Granny Gull lifts a knitting needle. You lower your fist.', kiss: '"Oh, you cheeky thing." She pats your cheek, and drops a stitch.',
          } },
        { id: 'notice', name: 'notice board', aliases: ['notice', 'board', 'sign', 'poster', 'notices'], rect: [24, 56, 28, 12], at: [38, 80],
          desc: 'STORM WARNING. All boats to harbour by dark. SUPPER BOAT STILL OUT. KEEPER TAM ILL; APPRENTICE TO LIGHT THE LAMP. A smaller note says: Oil: ask Barnaby at the dock. Matches: the hermit has some.' },
        { id: 'cottages', name: 'cottages', aliases: ['cottage', 'houses', 'house', 'door', 'doors'], rect: [8, 42, 30, 22], at: [24, 70], desc: 'Everyone is down at the harbour. The doors are shut and the shutters are up.', verbs: { open: 'Locked. Everyone is at the harbour.', push: 'Locked. Everyone is at the harbour.', talk: 'Nobody answers.' } },
      ],
    },

    // ---------------------------------------------------------------- the cliff
    cliff: {
      name: 'Cliff Path', horizon: 42, exits: { s: 'village', e: 'lighthouse' },
      desc: 'A windy path along the top of a cliff. A hermit sits on a rock beside a tiny hut, peering at nothing. The lighthouse is east.',
      blocks: [[0, 42, 160, 8], [48, 62, 24, 12]],
      listen: 'The wind. The waves, a long way down.',
      back(c, g, t) {
        A.sky(c, 30, DG, LG); A.cloud(c, 30, 8, LG); A.cloud(c, 100, 14, DG);
        sea(c, 30, 46, t);
        c.rect(0, 46, 160, 54, GR); c.speck(0, 46, 160, 54, LGR, 0.1, 5);
        c.rect(0, 44, 160, 6, DG); c.dith(0, 44, 160, 6, DG, LG, 0); // the cliff edge
        c.dith(0, 74, 160, 4, BR, GR, 0);
        A.rock(c, 60, 72, 22, LG);
        // hermit hut
        A.house(c, 112, 70, 28, 16, BR, LG); A.door(c, 122, 70, 8, 11, DG); c.rect(130, 48, 4, 8, DG);
        A.bush(c, 10, 90, 1); A.bush(c, 150, 92, 1.2);
        gull(c, 40, 22, t); gull(c, 120, 18, t + 2);
      },
      objects: [
        { id: 'hermit', name: 'hermit', aliases: ['old man', 'man', 'beard', 'old hermit'], rect: [48, 50, 24, 24], at: [56, 82], base: 76,
          draw(c) { A.person(c, 60, 72, { robe: BR, hat: DG, hair: LG, beard: LG, trim: BR }); c.rect(54, 62, 4, 2, K); c.rect(64, 62, 4, 2, K); },
          desc: 'A hermit with a beard to his belt, squinting at the sea. He keeps looking at things a foot to the left of where they are.',
          verbs: {
            talk(g) {
              if (g.flag('gave_glasses')) return g.say('"Now I can see the sea. It is bigger than I remembered. Thank you."');
              if (!g.flag('met_hermit')) { g.set('met_hermit'); return g.say('"Who\'s that? You\'re a blur. Oh, the apprentice. You want matches? I have matches. I also have no spectacles. I lost them on the beach feeding the gulls, and without them I cannot find where I keep the matches. Bring me my spectacles and I\'ll give you a box."'); }
              g.say(g.has('glasses') ? '"Are those my spectacles? Hand them over, hand them over!"' : '"My spectacles. On the beach. Possibly under something."');
            },
            give: {
              glasses(g) { g.lose('glasses'); g.give('matches'); g.set('gave_glasses'); g.score(15, 'matches'); g.say('The hermit puts them on, and blinks, and sees you for the first time. "A child. Good heavens. And what a lot of sea!" He fumbles in his hut and presses a box of matches into your hand. "Don\'t waste them."'); },
              '*': '"That is not my spectacles."',
            },
            attack: 'The hermit does not see it coming, and you do not do it.', kiss: '"Ah! A gull." You back away.',
          } },
        { id: 'edge', name: 'cliff edge', aliases: ['edge', 'cliff', 'drop', 'sea', 'ocean', 'waves'], rect: [0, 42, 160, 10], at: [30, 60],
          desc: 'A very long way down to some very hard rocks.', verbs: { swim: g => g.die('You jump off the cliff. This is the sort of swimming that is better done from a beach. The rocks agree.'), climb: g => g.die('You climb down the cliff. It goes well for the first three feet.'), enter: g => g.die('You step off the cliff, and it turns out the sea is not in the mood.') } },
        { id: 'hut', name: 'hut', aliases: ['hermit hut', 'door', 'shed'], rect: [110, 52, 32, 20], at: [126, 78], desc: 'A tiny driftwood hut, the sort of thing one builds if one has not been to a village for a decade.', verbs: { open: 'The hermit mutters, "Not in there! I cannot see where anything is!"', enter: 'The hermit mutters, "Not in there! I cannot see where anything is!"', push: 'The hermit mutters, "Not in there! I cannot see where anything is!"' } },
      ],
    },

    // ---------------------------------------------------------------- the lighthouse
    lighthouse: {
      name: 'Lighthouse', horizon: 44, exits: { w: 'cliff', s: 'beach' }, exitZones: { s: [60, 104] },
      desc: 'The Gullrock lighthouse stands tall and cold, with its great lamp dark. The door at the bottom is not locked. The cliff path goes west, and a stairway of sandy steps runs south to the beach.',
      blocks: [[66, 40, 28, 22]],
      back(c, g, t) {
        A.sky(c, 32, DG, LG); A.cloud(c, 22, 10, LG); A.cloud(c, 130, 8, DG);
        sea(c, 32, 46, t);
        c.rect(0, 46, 160, 54, GR); c.speck(0, 46, 160, 54, LGR, 0.08, 7);
        c.dith(60, 62, 44, 38, YL, GR, 0); c.rect(66, 54, 28, 8, DG);
        lighthouse(c, 80, 62, 46, g.flag('lit'));
        A.rock(c, 30, 70, 14, LG); A.rock(c, 130, 66, 20, LG); A.bush(c, 20, 90, 1.1); A.bush(c, 148, 90, 1);
        gull(c, 30, 24, t);
      },
      objects: [
        { id: 'door', name: 'lighthouse door', aliases: ['door', 'wooden door', 'tower door', 'lighthouse', 'tower', 'stairs'], rect: [74, 48, 12, 14], at: [80, 68],
          desc: 'A round-topped wooden door at the foot of the tower. There are one hundred and twelve steps behind it. You know, you have counted.',
          verbs: { open: g => { g.say('You climb the one hundred and twelve steps, counting out loud. At the top, you stop, breathe, and look at the lamp.'); g.goto('lamproom', 80, 90); }, enter: g => g.act('open', 'door'), push: g => g.act('open', 'door'), climb: g => g.act('open', 'door') } },
        { id: 'tower', name: 'tower', aliases: ['white tower', 'striped tower'], rect: [66, 4, 28, 44], at: [80, 68], desc: 'A tall tower striped red and white. At the very top, the lamp room is dark.', verbs: { climb: g => g.act('open', 'door'), push: 'It does not budge. It has stood for two hundred years.' } },
      ],
    },

    // ---------------------------------------------------------------- the lamp room
    lamproom: {
      name: 'The Lamp Room', horizon: 52, exits: { s: 'lighthouse' }, exitAt: { s: [80, 70] }, oneWay: ['s'],
      desc: g => {
        const need = [];
        if (!g.flag('oil_in')) need.push('oil'); if (!g.flag('wick_in')) need.push('a wick'); if (!g.has('matches')) need.push('a light');
        return 'The lamp room at the top of the tower. A great glass lens as tall as you stands over an iron lamp. Out the windows is a grey sea and a storm coming in, and far away, a small boat. ' +
          (g.flag('lit') ? 'The lamp is burning.' : need.length ? 'The lamp needs ' + need.join(', ') + '.' : 'The lamp is ready to light.');
      },
      blocks: [[54, 52, 52, 22]],
      listen: 'The wind sings through the windows. It is a long way up.',
      back(c, g, t) {
        c.rect(0, 0, 160, 100, DG);
        // windows all around: grey sea and sky
        c.rect(0, 0, 160, 52, LG); c.dith(0, 0, 160, 30, LG, DG, 0); sea(c, 32, 52, t);
        for (let x = 0; x < 160; x += 40) c.rect(x, 0, 3, 52, K);
        c.rect(0, 50, 160, 4, K); c.rect(0, 54, 160, 46, DG); c.speck(0, 54, 160, 46, K, 0.1, 3);
        c.rect(0, 54, 160, 1, LG);
        // the boat out there
        boat(c, 130 + Math.round(Math.sin((t || 0) * 0.5) * 3), 44, 0);
        // the lens
        const lit = g.flag('lit');
        c.ell(80, 38, 20, 22, lit ? YL : LC); c.ell(80, 38, 15, 17, lit ? WH : LB); c.ell(80, 38, 8, 10, lit ? YL : LC);
        for (let r = -20; r <= 20; r += 10) c.rect(80 + r - 1, 16, 1, 44, lit ? WH : CY);
        c.rect(58, 60, 44, 4, DG); c.rect(54, 64, 52, 10, K); c.rect(54, 64, 52, 2, LG);
        if (g.flag('oil_in')) c.rect(60, 66, 40, 6, BR);
        if (g.flag('wick_in')) c.rect(79, 56, 3, 8, LG);
        if (lit) { c.rect(78, 52, 5, 6, YL); c.rect(79, 50, 3, 3, WH); for (let i = 0; i < 30; i++) c.px(((i * 37 + Math.floor((t || 0) * 40)) % 160), 20 + (i * 7) % 24, YL); }
      },
      objects: [
        { id: 'lamp', name: 'lamp', aliases: ['lantern', 'oil lamp', 'big lamp', 'iron lamp', 'lens', 'glass', 'wick holder', 'reservoir', 'tank', 'light'], rect: [54, 14, 52, 62], at: [80, 84],
          desc: g => {
            if (g.flag('lit')) return 'The lamp burns, and the lens turns it into a beam that sweeps over the sea.';
            const s = ['The great lamp of Gullrock, cold and dark. The oil reservoir is ' + (g.flag('oil_in') ? 'full' : 'empty') + ', and the wick holder is ' + (g.flag('wick_in') ? 'filled with a fresh braided wick.' : 'bare.')];
            return s.join('');
          },
          verbs: {
            use: {
              oil(g) { if (g.flag('oil_in')) return g.say('The reservoir is already full.'); g.lose('oil'); g.set('oil_in'); g.score(10, 'oil_in'); g.say('You pour the oil into the reservoir. It gurgles and glugs and settles, golden and strong-smelling.'); },
              wick(g) { if (g.flag('wick_in')) return g.say('There is a wick in there already.'); g.lose('wick'); g.set('wick_in'); g.score(10, 'wick_in'); g.say('You feed the braided wick up through the holder and trim it with your thumbnail. It sits just right.'); },
              matches(g) { g.act('light', 'lamp'); },
              fish: 'The lamp does not want a fish. It is that sort of lamp.',
              bucket: 'You stare at the bucket and at the lamp, and you can see no way these two are related.',
              '*': 'That does not go in the lamp.',
            },
            light(g) {
              if (g.flag('lit')) return g.say('It is already burning.');
              if (!g.has('matches')) return g.say('You have nothing to light it with.');
              if (!g.flag('oil_in')) return g.say('You strike a match and hold it to the wick, but the reservoir is empty and there is nothing to burn. The match goes out.');
              if (!g.flag('wick_in')) return g.say('You strike a match, but there is no wick. The flame has nothing to hold on to, and it burns your fingers.');
              g.set('lit'); g.score(15, 'lit');
              g.win('The wick catches. The flame grows. The great lens takes it, turns it, and throws a beam as bright as day out across the black water. Far out, a boat blows its whistle, once, twice, and turns for the harbour. When the supper boat bumps the quay, forty children and one very wet dog cheer so loudly you can hear them from the tower. The keeper, in his bed with the fever, hears it, and smiles, and goes to sleep.');
            },
            take: 'It weighs more than a horse.', push: 'It does not move. It is bolted to the floor.', drink: g => g.die('You drink from the oil reservoir. Why you thought this was a good idea is between you and the oil.'),
            climb: 'You climb on the lamp for a better look. The lamp is not at all keen on this, and you climb down.',
          } },
        { id: 'window', name: 'window', aliases: ['windows', 'sea', 'boat', 'storm', 'supper boat', 'ship'], rect: [0, 0, 160, 52], at: [80, 84],
          desc: 'Out in the grey sea, a small boat is being thrown about. That is the supper boat. It will not find the harbour in the dark without the light.', verbs: { open: 'The window is stuck shut with salt. The wind is shoving at it from the outside.', climb: g => g.die('You climb out of the window. It is a very, very long way down. At least the view is good.') } },
      ],
    },

    // ---------------------------------------------------------------- the beach
    beach: {
      name: 'Beach', horizon: 46, exits: { w: 'village', e: 'dock', s: 'tidepools', n: 'lighthouse' }, exitZones: { n: [60, 104] },
      desc: 'A grey beach under a darkening sky. A heap of seaweed lies by the rocks, and a tin bucket lies in the sand. A path goes up to the lighthouse. Beyond the beach, the sea goes on. The village is west, the dock is east, and tide pools lie to the south.',
      blocks: [[0, 46, 58, 4], [106, 46, 54, 4]],
      listen: 'The surf, and the harbour bell.',
      back(c, g, t) {
        A.sky(c, 24, DG, LG); A.cloud(c, 120, 8, LG);
        sea(c, 24, 48, t);
        sand(c, 48); surf(c, 47, t);
        c.rect(58, 24, 48, 24, GR); c.speck(58, 24, 48, 24, LGR, 0.2, 5); c.dith(60, 24, 44, 24, YL, GR, 0);
        c.rect(58, 24, 1, 24, BR); c.rect(105, 24, 1, 24, BR);
        lighthouse(c, 82, 28, 26, false);
        c.speck(0, 48, 160, 52, DG, 0.02, 9);
        A.rock(c, 20, 70, 16, DG); A.rock(c, 140, 88, 12, LG);
        gull(c, 30, 14, t);
      },
      objects: [
        { id: 'seaweed', name: 'seaweed', aliases: ['weed', 'kelp', 'pile', 'heap', 'seaweed pile', 'heap of seaweed'], rect: [100, 66, 24, 14], at: [106, 84], base: 82,
          draw(c) { c.ell(112, 78, 10, 4, GR); c.speck(102, 72, 20, 10, DG, 0.3, 4); c.speck(102, 72, 20, 10, LGR, 0.1, 6); },
          desc: g => (g.flag('glasses_found') ? 'A heap of stinking seaweed.' : 'A big heap of seaweed, with flies. Something small glints in it.'),
          verbs: {
            search(g) { if (g.flag('glasses_found')) return g.say('Nothing else but flies.'); g.set('glasses_found'); g.say('You dig through the seaweed with a stick. It is as bad as it sounds. In the middle lies a pair of small round spectacles with a cracked arm.'); },
            take(g) { g.act('search', 'seaweed'); }, eat: 'No. Absolutely not.', smell: 'It smells like a low tide that has gone off.', climb: 'You are not in the mood.',
          } },
        { id: 'glasses', item: 'glasses', name: 'spectacles', aliases: ['glasses', 'specs'], show: g => g.flag('glasses_found'), rect: [108, 74, 10, 6], at: [112, 86], base: 82,
          draw(c) { c.ell(108, 78, 2, 2, LC); c.ell(113, 78, 2, 2, LC); c.px(110, 78, K); }, desc: 'A pair of small round spectacles.', takeMsg: 'You pick up the spectacles and wipe them on your sleeve. They are a bit seaweedy.', points: 5 },
        { id: 'bucket', item: 'bucket', name: 'tin bucket', aliases: ['bucket', 'pail'], rect: [36, 80, 12, 10], at: [42, 92], base: 90,
          draw(c) { A.bucket(c, 42, 90); }, desc: 'A dented tin bucket, lying on its side.', takeMsg: 'You pick up the bucket and shake the sand out.', points: 3 },
        { id: 'sea', name: 'sea', aliases: ['water', 'ocean', 'waves', 'surf', 'tide'], rect: [0, 24, 160, 24], at: [30, 60],
          desc: 'The sea, grey and heaving. It does not look friendly today.', verbs: { swim: g => g.die('You wade in and start swimming. The sea takes you out much further than you meant to go. You were a very brave swimmer for about a minute.'), enter: g => g.die('You wade into the sea. The undertow wades back.'), drink: 'Salt. Blech.', climb: 'There is nothing to climb but water.' } },
      ],
    },

    // ---------------------------------------------------------------- the dock
    dock: {
      name: 'Dock', horizon: 48, exits: { w: 'beach', s: 'cove' },
      desc: 'A wooden dock with a fisherman sitting on a barrel, fiddling with a rod. A fat ginger cat is looking at him very carefully. A little rowboat rocks at the end of the dock. The beach is west and the cove is south.',
      blocks: [[20, 48, 140, 4], [20, 66, 140, 12]],
      listen: 'Ropes creaking, water slapping on the piles, and the harbour bell.',
      back(c, g, t) {
        A.sky(c, 30, DG, LG); A.cloud(c, 40, 12, LG); A.cloud(c, 120, 18, DG);
        sea(c, 30, 78, t);
        sand(c, 78); surf(c, 77, t);
        c.rect(0, 30, 20, 48, SAND); c.speck(0, 30, 20, 48, BR, 0.05, 5);
        pier(c, 20, 160, 52, 14);
        boat(c, 118, 76 + Math.round(Math.sin((t || 0) * 1.5)), 0);
        c.box(140, 44, 14, 16, BR, K); c.rect(140, 50, 14, 1, DG);
        gull(c, 80, 20, t + 1);
      },
      objects: [
        { id: 'barnaby', name: 'Barnaby', aliases: ['fisherman', 'man', 'old man', 'barnaby', 'angler'], rect: [38, 40, 22, 28], at: [50, 62], base: 64,
          draw(c) { c.box(40, 54, 14, 10, BR, K); A.person(c, 47, 54, { robe: BL, hat: YL, hair: LG, beard: LG, trim: YL }); c.line(54, 46, 76, 28, BR); c.line(76, 28, 76, 46, WH); },
          desc: 'Barnaby, the harbour fisherman, as wide as he is tall, with a hat that has seen things.',
          verbs: {
            talk(g) {
              if (g.flag('gave_fish')) return g.say('"Biscuit is delighted. She has not been this nice to me since Tuesday."');
              if (!g.flag('met_barnaby')) { g.set('met_barnaby'); return g.say('"Oil? For the lamp? Aye, I\'ve a can, and I\'ll gladly give it. But Biscuit there has had nothing but my old catch for a week and she\'s given me the look. She\'ll only eat a fresh one. The tide pools are full of flounder, but I can\'t get down those rocks with my knees. Bring me one fresh, and the oil is yours."'); }
              g.say(g.has('fish') ? '"That\'s a lovely fish, lad. Give it here!"' : '"A fresh flounder, lad. From the tide pools. Mind the crab."');
            },
            give: {
              fish(g) { g.lose('fish'); g.give('oil'); g.set('gave_fish'); g.score(15, 'oil'); g.say('Barnaby holds the flounder up. Biscuit leaps onto the barrel, takes it in one lunge and goes away to enjoy it behind a crate. "Aye, that did it." He hands you a heavy tin can of lamp oil. "Go on, lad. Be quick."'); },
              '*': '"No, lad, I want a fish."',
            },
            attack: 'Barnaby picks you up by the collar, puts you down again, and goes back to his rod.', kiss: '"Steady on, lad."',
          } },
        { id: 'cat', name: 'cat', aliases: ['biscuit', 'ginger cat', 'kitty', 'fat cat'], rect: [64, 50, 18, 14], at: [70, 64], base: 64,
          draw(c) { cat(c, 72, 62); },
          desc: 'A very large ginger cat called Biscuit. She is looking at the fisherman as if he owes her money.', verbs: { talk: 'Biscuit says "mrrp." You think it means: fish.', kiss: 'Biscuit allows this for about a second, then gives you a look.', attack: 'Biscuit shows you every claw she has. You decide not to.', take: 'Biscuit goes soft and then goes very hard, all at once, and you let go.', give: { fish: 'The cat looks at it with deep interest. Barnaby clears his throat. Perhaps it should go to him.', '*': 'Biscuit sniffs it and turns her back.' } } },
        { id: 'boat', name: 'rowboat', aliases: ['boat', 'little boat', 'skiff', 'dinghy'], rect: [104, 64, 28, 16], at: [108, 64],
          desc: 'A little rowboat, tied up with a rope. It looks as if it likes the shelter of the dock.', verbs: { enter: g => g.die('You climb into the rowboat and push off. The waves are bigger than they looked from the dock. You are not the first person to row out toward a storm, but you may be the last for this evening.'), climb: g => g.act('enter', 'boat'), take: 'It is too big to carry.', push: 'It does not need your help.', pull: 'It is tied to the dock, and that is how it likes it.' } },
        { id: 'crate', name: 'barrel', aliases: ['barrels', 'crate', 'crates'], rect: [138, 42, 16, 20], at: [146, 64], desc: 'Barrels of salt fish. They smell, and they are not for you.', verbs: { open: 'You lift the lid. A great wave of old fish rolls out. You close it again, quickly.', search: 'Only salt fish. Not fresh.' } },
      ],
    },

    // ---------------------------------------------------------------- the tide pools
    tidepools: {
      name: 'Tide Pools', horizon: 44, exits: { n: 'beach', e: 'cove' },
      desc: 'A shelf of black rock with tide pools full of little lives. The biggest pool has a fat flounder in it. A crab the size of a dinner plate sits at the edge of it, watching you.',
      blocks: [[48, 60, 54, 20]],
      listen: 'Dripping, trickling and the sea sighing on the rocks.',
      back(c, g, t) {
        A.sky(c, 22, DG, LG);
        sea(c, 22, 44, t);
        c.rect(0, 44, 160, 56, DG); c.speck(0, 44, 160, 56, K, 0.14, 3); c.speck(0, 44, 160, 56, LG, 0.04, 8);
        for (const [x, y, w, h] of [[10, 52, 22, 10], [120, 50, 30, 12], [20, 82, 30, 12], [118, 84, 30, 12]]) { c.ell(x + w / 2, y + h / 2, w / 2, h / 2, CY); c.ell(x + w / 2, y + h / 2, w / 2 - 2, h / 2 - 1, BL); }
        // the big pool
        c.ell(76, 70, 28, 10, LG); c.ell(76, 70, 25, 8, CY); c.ell(76, 70, 22, 6, BL);
        for (let i = 0; i < 6; i++) c.px(60 + i * 6, 68 + (i % 3), LB);
        if (!g.flag('fished')) A.fish(c, 76, 71, YL);
        A.rock(c, 24, 94, 14, LG); A.rock(c, 140, 96, 12, DG);
      },
      objects: [
        { id: 'pool', name: 'tide pool', aliases: ['pool', 'big pool', 'water', 'pools', 'rock pool', 'tidepool', 'flounder', 'fish'], rect: [48, 60, 56, 20], at: [76, 86],
          desc: g => (g.flag('fished') ? 'A tide pool, now fishless. Little shrimp dart about.' : 'A deep tide pool with a fat flounder swimming around. A big crab is guarding the near edge.'),
          verbs: {
            use: {
              bucket(g) {
                if (g.flag('fished')) return g.say('There are only shrimp left.');
                g.set('fished'); g.set('bucket_wet'); g.lose('bucket'); g.give('fish'); g.score(7, 'fish');
                g.say('You dip the bucket in at the far end, where the crab is not looking, and sweep it slowly toward the flounder. A flick of the tail, a splash, and the fish is in the bucket. You carry the lot off, bucket and flounder.');
              },
              '*': 'That does not catch fish.',
            },
            take: g => g.die('You reach into the pool to grab the flounder with your bare hand. The crab has been waiting all afternoon for exactly this.'),
            search: 'There is a fat flounder, some shrimp, and a very watchful crab.', drink: 'It is salt water. Do not.', swim: 'It is a puddle. You could not swim in it if you tried.',
            enter: 'You put a foot in. It is cold. You take it out again.', eat: 'You would have to catch something first.',
          } },
        { id: 'crab', name: 'crab', aliases: ['big crab', 'giant crab', 'red crab'], rect: [92, 62, 20, 12], at: [100, 86], base: 80,
          draw(c, g, t) { if (!g.flag('fished')) crab(c, 98, 74, t); }, show: g => !g.flag('fished'),
          desc: 'A crab as big as a dinner plate, with one claw bigger than the other, and a look of great and personal interest in your fingers.',
          verbs: { take: g => g.die('You pick up the crab. The crab picks up your finger, and then the rest of you goes along.'), attack: g => g.die('You attack the crab. The crab is delighted. It is the best afternoon it has had in years.'), kiss: g => g.die('You lean in to kiss the crab. The crab has views.'), talk: 'The crab clicks its claw. You think this means no.', give: { '*': 'The crab considers it, and takes it, and nothing else happens. That was close.' } } },
      ],
    },

    // ---------------------------------------------------------------- the cove
    cove: {
      name: 'Hidden Cove', horizon: 46, exits: { w: 'tidepools', n: 'dock' },
      desc: 'A small, hidden cove, sheltered from the wind, with a wrecked boat lying in the sand. A patch of wet sand glitters with bits of broken glass.',
      listen: 'The sea. The wind, from far away.',
      back(c, g, t) {
        A.sky(c, 22, DG, LG);
        sea(c, 22, 46, t);
        sand(c, 46); surf(c, 45, t);
        c.poly([[0, 14], [34, 14], [0, 46]], DG); c.poly([[160, 14], [126, 14], [160, 46]], DG); c.speck(0, 14, 34, 32, K, 0.1, 5); c.speck(126, 14, 34, 32, K, 0.1, 6);
        // the wreck
        c.poly([[90, 78], [130, 74], [124, 90], [96, 92]], BR); c.rect(92, 78, 36, 1, YL); c.rect(100, 56, 2, 22, BR); c.rect(112, 60, 1, 14, DG);
        c.line(100, 58, 112, 62, DG);
        // wet patch
        c.ell(52, 80, 22, 8, DG); c.ell(52, 80, 18, 6, YL); c.dith(36, 76, 32, 8, YL, DG, 0);
        for (let i = 0; i < 8; i++) if ((i + Math.floor((t || 0) * 2)) % 5 === 0) c.px(38 + i * 4, 78 + (i % 3), WH);
      },
      objects: [
        { id: 'sand', name: 'wet sand', aliases: ['sand', 'glass', 'patch', 'wet patch', 'shards', 'broken glass', 'beach'], rect: [32, 72, 40, 16], at: [52, 92],
          desc: g => (g.flag('glass_found') ? 'Wet sand with bits of glass in it. All the blue ones are gone.' : 'A patch of wet sand with little bits of glass glinting in it, green, brown, clear, and here and there, blue.'),
          verbs: {
            dig(g) {
              if (g.flag('glass_found')) return g.say('You dig and dig, and find no more blue glass.');
              g.set('glass_found'); g.give('glass'); g.score(5, 'glass'); g.emit('take');
              g.say('You dig through the wet sand with your fingers. Most of it is brown glass and bottle bits, but near the bottom there is a smooth blue piece, worn round as a coin. Perfect.');
            },
            search(g) { g.act('dig', 'sand'); }, take(g) { g.act('dig', 'sand'); }, eat: 'It is sand.',
          } },
        { id: 'wreck', name: 'wrecked boat', aliases: ['wreck', 'boat', 'hull', 'old boat', 'broken boat', 'wrecked rowboat'], rect: [88, 54, 44, 40], at: [84, 94],
          desc: 'An old boat, with a hole in its side big enough to crawl through. It has been here for years. There is nothing in it but sand and a crab shell.',
          verbs: { search: 'You poke about. Sand, and a crab shell, and a very old boot.', open: 'It is already open, in more ways than one.', enter: 'You climb in and out again. It is exactly as exciting as it looks.', climb: 'You climb in and out again. It is exactly as exciting as it looks.', take: 'It weighs as much as a house.' } },
        { id: 'water', name: 'sea', aliases: ['ocean', 'waves', 'surf', 'water'], rect: [20, 22, 120, 24], at: [60, 60], desc: 'The sea, kinder here, but still the sea.', verbs: { swim: g => g.die('You swim out from the cove. The cove is calm. The sea behind it is not. You are discovered by the gulls.'), enter: g => g.die('You wade out of the cove and the sea gets hold of you.') } },
      ],
    },
  };

  const def = {
    id: 'gullrock', title: 'The Lamp at Gullrock', maxScore: 100,
    start: { room: 'village', x: 60, y: 90 },
    intro: 'The lamp at Gullrock lighthouse is out. The keeper is in bed with a fever, and a storm is coming in off the sea. Out there, in the grey, is the supper boat with every child in the village on it. You are the keeper\'s apprentice, and you are the only one who can light the lamp. To light it, you need three things: oil, a wick, and a light. You have about one afternoon.',
    help: 'Walk with the arrow keys, or click where you want to go. Type what you want to do: look, look at the pool, take bucket, talk to Barnaby, give fish to Barnaby, use oil on lamp, dig sand, search seaweed. Say "inventory" to see what you carry. Talk to everyone, and look at everything. The sea is not friendly. Things here can kill you, and you can always try again.',
    items, rooms,
    onStart(g) { g.say('The harbour bell is ringing. The supper boat is still out. Talk to the people of Gullrock, and find what you need to light the lamp.'); },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = def; else root.GULLROCK = def;
})(typeof window !== 'undefined' ? window : globalThis);
