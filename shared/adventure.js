/*
 * A small engine for one-screen-at-a-time adventure games with a typed parser, in the spirit of the old Sierra games.
 * No DOM here, so games can be played under node in tests. The page (adventure-ui.js) draws it and feeds it text and clicks.
 *
 * A game is plain data (see hollowmere/game.js): items, rooms, objects in rooms, and small handler functions.
 * The state is plain JSON (room, where you stand, what you carry, flags). Everything read back from storage goes through cleanState.
 * Nothing in here uses randomness, so the same commands always play out the same way.
 */
(function (root) {
  'use strict';

  const SW = 160, SH = 100;          // the picture is 160 x 100 "pixels"
  const CELL = 4;                    // walking grid: 40 x 25 cells
  const GW = SW / CELL, GH = SH / CELL;
  const SPEED = 30;                  // pixels per second when walking

  const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); // never o[userKey]
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const isStr = (v, max) => typeof v === 'string' && v.length <= max;

  // ---------- the words ----------
  const VERBS = {
    look: ['look', 'l', 'examine', 'x', 'inspect', 'check', 'view', 'read', 'watch', 'study', 'peek'],
    search: ['search', 'rummage', 'explore', 'feel'],
    take: ['take', 'get', 'grab', 'pick', 'steal', 'collect', 'snatch', 'fetch', 'pluck', 'gather'],
    drop: ['drop', 'discard', 'toss', 'release', 'ditch'],
    open: ['open', 'unlock', 'unlatch'],
    close: ['close', 'shut', 'lock'],
    use: ['use', 'apply', 'put', 'place', 'insert', 'fill', 'pour', 'throw', 'hang', 'attach', 'wave', 'show'],
    give: ['give', 'offer', 'hand', 'feed', 'trade', 'pay', 'sell', 'bribe'],
    talk: ['talk', 'speak', 'ask', 'greet', 'hello', 'hi', 'say', 'shout', 'yell', 'call', 'chat', 'tell', 'sing'],
    push: ['push', 'shove', 'press', 'move', 'shift', 'roll', 'ring', 'knock', 'tap', 'turn'],
    pull: ['pull', 'yank', 'tug', 'drag', 'lift', 'raise', 'crank', 'wind', 'haul'],
    climb: ['climb', 'scale', 'ascend', 'descend'],
    enter: ['enter', 'go', 'walk', 'run', 'head', 'travel', 'cross', 'leave', 'exit', 'visit'],
    swim: ['swim', 'wade', 'dive', 'jump', 'leap', 'splash'],
    eat: ['eat', 'taste', 'bite', 'swallow', 'devour', 'lick', 'munch'],
    drink: ['drink', 'sip', 'gulp', 'slurp'],
    wear: ['wear', 'don', 'equip'],
    light: ['light', 'ignite', 'kindle', 'burn'],
    play: ['play', 'blow', 'toot', 'whistle', 'strum'],
    attack: ['attack', 'hit', 'kill', 'fight', 'punch', 'kick', 'stab', 'slash', 'smash', 'break', 'slay', 'shoot'],
    cut: ['cut', 'chop', 'slice', 'saw', 'snip', 'carve'],
    kiss: ['kiss', 'hug', 'pet', 'pat', 'tickle', 'scratch', 'stroke'],
    smell: ['smell', 'sniff'],
    listen: ['listen', 'hear'],
    wait: ['wait', 'rest', 'sleep', 'z', 'nap', 'sit', 'stand', 'dance', 'pray', 'think', 'hide', 'wish'],
    inventory: ['inventory', 'i', 'inv', 'items', 'pockets', 'stuff'],
    help: ['help', 'hint', '?', 'commands', 'verbs'],
    score: ['score', 'points'],
    save: ['save'],
    restore: ['restore', 'load'],
    restart: ['restart', 'quit'],
    tie: ['tie', 'bind', 'fasten', 'knot'],
    dig: ['dig', 'shovel'],
  };
  const VERB_OF = {};
  for (const [canon, list] of Object.entries(VERBS)) for (const w of list) if (!has(VERB_OF, w)) VERB_OF[w] = canon;
  const DIRS = { n: 'n', north: 'n', s: 's', south: 's', e: 'e', east: 'e', w: 'w', west: 'w', u: 'n', up: 'n', d: 's', down: 's' };
  const DIR_WORD = { n: 'north', s: 'south', e: 'east', w: 'west' };
  // verbs where the thing acted on comes first ("cut rope with knife"); the others act on the second ("use key on door")
  const TARGET_FIRST = new Set(['open', 'close', 'attack', 'light', 'search', 'look', 'dig', 'cut', 'play']);
  const FILLER = new Set(['the', 'a', 'an', 'my', 'some', 'that', 'this', 'please', 'those', 'these', 'your', 'at', 'of', 'around', 'out', 'over']);
  const PREPS = new Set(['on', 'with', 'to', 'in', 'into', 'onto', 'from', 'under', 'behind', 'inside', 'against', 'across', 'for']);

  const norm = text => String(text).toLowerCase().replace(/[^a-z0-9\s'?]/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();

  // text -> { verb, a, prep, b } where a and b are noun phrases (maybe empty)
  function parse(text) {
    let w = norm(text).split(' ').filter(Boolean);
    if (!w.length) return null;
    if (w.length === 1 && has(DIRS, w[0]) && !['u', 'd', 'up', 'down'].includes(w[0])) return { verb: 'enter', a: '', prep: '', b: '', dir: DIRS[w[0]] };
    let verb = null;
    const two = w.slice(0, 2).join(' ');
    if (two === 'pick up' || two === 'look at' || two === 'look in' || two === 'put on' || two === 'put down' || two === 'turn on' || two === 'talk to' || two === 'speak to' || two === 'go to' || two === 'walk to' || two === 'climb up' || two === 'climb down' || two === 'climb on') {
      if (two === 'put on') verb = 'wear';
      else if (two === 'put down') verb = 'drop';
      else if (two === 'turn on') verb = 'light';
      else if (two === 'look in') { verb = 'search'; }
      else verb = VERB_OF[w[0]];
      w = w.slice(2);
    } else if (has(VERB_OF, w[0])) { verb = VERB_OF[w[0]]; w = w.slice(1); }
    else return { verb: null, word: w[0], a: '', prep: '', b: '' };
    // "look under X" and "look behind X" are searches
    if (verb === 'look' && w.length && (w[0] === 'under' || w[0] === 'behind' || w[0] === 'inside')) { verb = 'search'; w = w.slice(1); }
    if (verb === 'enter' && w.length === 1 && has(DIRS, w[0]) && !['u', 'd', 'up', 'down'].includes(w[0])) return { verb, a: '', prep: '', b: '', dir: DIRS[w[0]] };
    if (verb === 'climb' && w.length === 1 && (w[0] === 'up' || w[0] === 'down')) w = [];
    w = w.filter(x => !FILLER.has(x));
    const pi = w.findIndex(x => PREPS.has(x));
    if (pi < 0) return { verb, a: w.join(' '), prep: '', b: '' };
    const before = w.slice(0, pi).join(' '), after = w.slice(pi + 1).filter(x => !FILLER.has(x)).join(' ');
    // "swim in river", "jump into well": the preposition leads, the thing follows
    if (!before && after) return { verb, a: after, prep: '', b: '' };
    return { verb, a: before, prep: w[pi], b: after };
  }

  // how well does a phrase name something? 0 = not at all
  function nameScore(phrase, names) {
    if (!phrase) return 0;
    const pw = phrase.split(' ');
    let best = 0;
    for (const n of names) {
      const nw = norm(n).split(' ');
      if (nw.join(' ') === phrase) best = Math.max(best, 4);
      else if (pw.every(p => nw.includes(p))) best = Math.max(best, 3);
      else if (nw.every(p => pw.includes(p))) best = Math.max(best, 2);
      else if (pw[pw.length - 1] === nw[nw.length - 1]) best = Math.max(best, 1);
    }
    return best;
  }

  // ---------- making a game ----------
  function create(def, saved) {
    const g = {
      def, state: null, checkpoint: null, out: [], events: [],
      path: null, pending: null, instant: false, t: 0, step: 0,
    };

    function fresh() {
      const st = def.start;
      return { v: 1, room: st.room, x: st.x, y: st.y, dir: 'd', inv: [], flags: Object.create(null), drops: [], points: 0, moves: 0, dead: null, won: null };
    }
    g.state = fresh();
    if (saved) {
      const ok = cleanState(def, saved.state);
      if (ok) { g.state = ok; g.checkpoint = saved.checkpoint ? cleanState(def, saved.checkpoint) : null; }
    }
    if (!saved || !g.checkpoint) g.checkpoint = JSON.parse(JSON.stringify(g.state));

    const S = () => g.state;
    const room = () => def.rooms[S().room];
    g.room = room;

    // ----- things handlers can call -----
    g.say = text => { g.out.push(String(text)); if (g.out.length > 300) g.out.splice(0, g.out.length - 300); };
    g.emit = name => g.events.push(name);
    g.flag = k => S().flags[k];
    g.set = (k, v) => { S().flags[k] = v === undefined ? true : v; };
    g.has = id => S().inv.includes(id);
    g.give = id => { if (has(def.items, id) && !g.has(id)) S().inv.push(id); };
    g.lose = id => { S().inv = S().inv.filter(x => x !== id); };
    g.remove = id => { S().flags['gone:' + id] = true; };       // an object in a room is gone for good
    g.restoreObj = id => { delete S().flags['gone:' + id]; };
    g.gone = id => !!S().flags['gone:' + id];
    g.score = (n, key) => {
      const k = 'sc:' + key;
      if (S().flags[k]) return false;
      S().flags[k] = true; S().points += n; g.emit('score'); g.snap();
      return true;
    };
    g.die = msg => { if (S().dead || S().won) return; S().dead = String(msg); g.path = null; g.pending = null; g.emit('die'); };
    g.win = msg => { if (S().dead || S().won) return; S().won = String(msg); g.path = null; g.pending = null; g.emit('win'); };
    g.snap = () => { if (!S().dead && !S().won) g.checkpoint = JSON.parse(JSON.stringify(S())); };
    g.goto = (roomId, x, y) => {
      if (!has(def.rooms, roomId)) return;
      g.snap();  // the saved point is the room you leave, so a death in the new room puts you back outside it
      S().room = roomId; g.path = null; g.pending = null;
      const r = def.rooms[roomId];
      const p = snapWalkable(r, x === undefined ? S().x : x, y === undefined ? S().y : y, g);
      S().x = p.x; S().y = p.y;
      g.emit('room');
      if (r.onEnter) r.onEnter(g);
    };

    // ----- what is in the room -----
    function objShown(o, id) {
      if (g.gone(o.id || id)) return false;
      if (o.show && !o.show(g)) return false;
      if (o.hidden && (typeof o.hidden === 'function' ? o.hidden(g) : o.hidden)) return false;
      return true;
    }
    g.objects = () => {
      const r = room(), out = [];
      for (const o of r.objects || []) if (objShown(o)) out.push(o);
      S().drops.forEach((d, i) => {
        if (d.room !== S().room) return;
        const it = def.items[d.item];
        out.push({ id: 'drop:' + i, item: d.item, name: it.name, aliases: it.aliases || [], rect: [d.x - 3, d.y - 4, 7, 5], at: [d.x, d.y], desc: it.desc, drop: i, base: d.y,
          draw: (c) => { if (it.draw) it.draw(c, d.x, d.y, g); else { c.rect(d.x - 1, d.y - 2, 3, 3, 14); c.px(d.x, d.y - 3, 15); } } });
      });
      return out;
    };
    g.objectById = id => g.objects().find(o => o.id === id) || null;
    const namesOf = o => [o.name].concat(o.aliases || []);

    function resolve(phrase) {
      if (!phrase) return null;
      let best = null, bs = 0;
      for (const id of S().inv) { const it = def.items[id], sc = nameScore(phrase, namesOf(it)); if (sc > bs) { bs = sc; best = { kind: 'item', id, def: it }; } }
      for (const o of g.objects()) { const sc = nameScore(phrase, namesOf(o)); if (sc > bs) { bs = sc; best = { kind: o.item ? 'ground' : 'obj', id: o.id, def: o }; } }
      return best;
    }
    function known(phrase) { // is it a word the game knows at all (anywhere)?
      for (const it of Object.values(def.items)) if (nameScore(phrase, namesOf(it)) > 1) return true;
      for (const r of Object.values(def.rooms)) for (const o of r.objects || []) if (nameScore(phrase, namesOf(o)) > 1) return true;
      return false;
    }

    // where to stand to reach an object
    g.standPoint = o => {
      if (o.at) return { x: o.at[0], y: o.at[1] };
      const rc = o.rect || [S().x, S().y, 0, 0];
      return snapWalkable(room(), rc[0] + rc[2] / 2, rc[1] + rc[3] + 2, g);
    };
    const NEAR = 14;
    const nearObj = o => { const p = g.standPoint(o), dx = S().x - p.x, dy = S().y - p.y; return dx * dx + dy * dy <= NEAR * NEAR; };

    // ----- the walking grid -----
    g.walkable = (x, y) => isWalkable(room(), x, y, g);

    function findPath(x0, y0, x1, y1) {
      const r = room();
      const c0 = [clamp(Math.floor(x0 / CELL), 0, GW - 1), clamp(Math.floor(y0 / CELL), 0, GH - 1)];
      let c1 = [clamp(Math.floor(x1 / CELL), 0, GW - 1), clamp(Math.floor(y1 / CELL), 0, GH - 1)];
      const ok = (cx, cy) => isWalkable(r, cx * CELL + CELL / 2, cy * CELL + CELL / 2, g);
      if (!ok(c1[0], c1[1])) { // nearest walkable cell to where they clicked
        let best = null;
        for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) if (ok(cx, cy)) { const d = (cx - c1[0]) * (cx - c1[0]) + (cy - c1[1]) * (cy - c1[1]); if (!best || d < best.d) best = { d, cx, cy }; }
        if (!best) return null;
        c1 = [best.cx, best.cy];
      }
      const seen = new Int32Array(GW * GH).fill(-1), q = [c0[1] * GW + c0[0]];
      seen[q[0]] = q[0];
      for (let qi = 0; qi < q.length; qi++) {
        const cur = q[qi], cx = cur % GW, cy = (cur - cx) / GW;
        if (cx === c1[0] && cy === c1[1]) break;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || seen[ny * GW + nx] >= 0 || !ok(nx, ny)) continue;
          if (dx && dy && !(ok(cx + dx, cy) && ok(cx, cy + dy))) continue; // no squeezing between two corners
          seen[ny * GW + nx] = cur; q.push(ny * GW + nx);
        }
      }
      const end = c1[1] * GW + c1[0];
      if (seen[end] < 0) return null;
      const cells = [];
      for (let cur = end; cur !== c0[1] * GW + c0[0]; cur = seen[cur]) cells.push(cur);
      cells.reverse();
      const pts = cells.map(cur => { const cx = cur % GW; return { x: cx * CELL + CELL / 2, y: ((cur - cx) / GW) * CELL + CELL / 2 }; });
      // the last step goes to the exact spot asked for, if that spot is walkable
      if (isWalkable(r, x1, y1, g)) pts.push({ x: x1, y: y1 });
      return pts;
    }

    g.walkTo = (x, y, then) => {
      const p = findPath(S().x, S().y, x, y);
      if (!p) { g.path = null; g.pending = null; return false; }
      g.path = p; g.pending = then || null;
      return true;
    };
    g.stop = () => { g.path = null; g.pending = null; };

    function face(dx, dy) { S().dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'l' : 'r') : (dy < 0 ? 'u' : 'd'); }

    // Moves the hero along the path (and runs what was waiting for them to arrive).
    g.update = dt => {
      g.t += dt;
      if (S().dead || S().won) return;
      if (!g.path || !g.path.length) return;
      let left = SPEED * dt;
      while (left > 0 && g.path && g.path.length) {
        const tgt = g.path[0], dx = tgt.x - S().x, dy = tgt.y - S().y, d = Math.sqrt(dx * dx + dy * dy);
        if (d <= left) { S().x = tgt.x; S().y = tgt.y; left -= d; g.path.shift(); if (d > 0.01) face(dx, dy); }
        else { S().x += dx / d * left; S().y += dy / d * left; face(dx, dy); left = 0; }
      }
      g.step++;
      if (checkEdges()) return;
      if (!g.path || !g.path.length) { g.path = null; const p = g.pending; g.pending = null; if (p) p(); }
    };

    // arrow keys: move a little in a direction
    g.nudge = (dx, dy, dt) => {
      if (S().dead || S().won) return;
      g.path = null; g.pending = null;
      const k = SPEED * dt;
      const nx = S().x + dx * k, ny = S().y + dy * k;
      face(dx, dy);
      if (isWalkable(room(), nx, ny, g)) { S().x = nx; S().y = ny; g.step++; }
      else if (dx && isWalkable(room(), nx, S().y, g)) { S().x = nx; g.step++; }
      else if (dy && isWalkable(room(), S().x, ny, g)) { S().y = ny; g.step++; }
      else if (dx || dy) edgePush(dx, dy);
      checkEdges();
    };

    // trying to walk off the picture
    function edgePush(dx, dy) {
      const r = room();
      if (dx > 0 && S().x >= SW - 4) tryExit('e');
      if (dx < 0 && S().x <= 3) tryExit('w');
      if (dy > 0 && S().y >= SH - 3) tryExit('s');
      if (dy < 0 && S().y <= (r.horizon || 40) + 1) tryExit('n');
    }
    function checkEdges() {
      const r = room(), x = S().x, y = S().y;
      if (x >= SW - 3) return tryExit('e');
      if (x <= 2.5) return tryExit('w');
      if (y >= SH - 1.5) return tryExit('s');
      if (y <= (r.horizon || 40) + 0.5 && r.exits && r.exits.n) return tryExit('n');
      return false;
    }
    function tryExit(dir) {
      const r = room();
      if (!r.exits || !has(r.exits, dir)) return false;
      const zone = r.exitZones && r.exitZones[dir];
      if (zone && (dir === 'n' || dir === 's' ? (S().x < zone[0] || S().x > zone[1]) : (S().y < zone[0] || S().y > zone[1]))) return false;
      return g.exit(dir);
    }

    // go through an exit (the room can say no)
    g.exit = dir => {
      const r = room();
      if (!r.exits || !has(r.exits, dir)) { g.say("You can't go that way."); return false; }
      if (r.exitCheck) { const res = r.exitCheck(g, dir); if (res) { if (typeof res === 'string') g.say(res); g.path = null; g.pending = null; pushBack(dir); return false; } }
      const to = r.exits[dir], tr = def.rooms[to];
      pushBack(dir); // so that a saved point made here is not standing on the edge it left through
      const x = S().x, y = S().y;
      let nx = x, ny = y;
      if (dir === 'e') nx = 6; else if (dir === 'w') nx = SW - 6; else if (dir === 's') ny = (tr.horizon || 40) + 3; else ny = SH - 4;
      if (r.exitAt && has(r.exitAt, dir)) { nx = r.exitAt[dir][0]; ny = r.exitAt[dir][1]; }
      S().moves++;
      g.goto(to, nx, ny);
      return true;
    };
    function pushBack(dir) {
      if (dir === 'e') S().x = SW - 7; else if (dir === 'w') S().x = 7; else if (dir === 's') S().y = SH - 4; else S().y = (room().horizon || 40) + 3;
      const p = snapWalkable(room(), S().x, S().y, g); S().x = p.x; S().y = p.y;
    }

    // ----- commands -----
    const DEFAULTS = {
      look: o => "You don't see anything special.",
      search: () => 'You find nothing of interest.',
      take: () => "You can't take that.",
      open: () => "It doesn't open.", close: () => "It doesn't close.",
      use: () => "That doesn't work.",
      give: () => 'No, thank you.',
      talk: () => 'There is no answer.',
      push: () => 'Nothing happens.', pull: () => 'Nothing happens.',
      climb: () => "You can't climb that.",
      enter: () => 'You walk up to it.',
      swim: () => 'That is not a good idea.',
      eat: () => "You can't eat that.", drink: () => "You can't drink that.",
      wear: () => "You can't wear that.", light: () => "You can't light that.", play: () => 'It makes no sound.',
      attack: () => 'Violence is not the answer here.', kiss: () => 'That is a little silly.',
      smell: () => 'It smells like what it is.', listen: () => 'You hear nothing special.',
      tie: () => "That doesn't work.", cut: () => 'You have nothing to cut that with.', dig: () => 'You dig around and find nothing.',
      drop: () => 'Dropped.',
    };
    const NEEDS_NEAR = new Set(['cut', 'dig', 'take', 'open', 'close', 'push', 'pull', 'climb', 'talk', 'give', 'use', 'search', 'eat', 'drink', 'kiss', 'attack', 'tie', 'light', 'swim', 'enter', 'play', 'smell']);

    function call(h, ...rest) { if (typeof h === 'function') h(g, ...rest); else if (typeof h === 'string') g.say(h); }

    function describe(o) {
      const d = o.def && o.def.desc;
      if (d === undefined) return null;
      return typeof d === 'function' ? d(g) : d;
    }

    function runVerb(verb, A, B) {
      const r = room();
      if (r.hook && r.hook(g, verb, A ? A.id : null, B ? B.id : null) === true) return;
      // two things: the handler lives on the thing acted upon, keyed by what is used on it
      if (A && B) {
        const targetFirst = TARGET_FIRST.has(verb);
        const target = targetFirst ? A : B, thing = targetFirst ? B : A;
        const tv = target.def.verbs || {};
        const tryVerbs = verb === 'tie' || verb === 'attach' ? ['tie', 'use'] : [verb, 'use'];
        for (const vv of tryVerbs) {
          const m = tv[vv];
          if (typeof m === 'function') return call(m, thing);
          if (m && typeof m === 'object' && has(m, thing.id)) return call(m[thing.id], thing);
          if (m && typeof m === 'object' && has(m, '*')) return call(m['*'], thing);
        }
        if (verb === 'give') return g.say(target.kind === 'obj' && target.def.giveNo ? target.def.giveNo : DEFAULTS.give());
        return g.say(DEFAULTS.use());
      }
      const t = A;
      const v = t && t.def.verbs && has(t.def.verbs, verb) ? t.def.verbs[verb] : undefined;
      if (v !== undefined && typeof v !== 'object') return call(v, t);
      if (v && typeof v === 'object' && has(v, '*')) return call(v['*'], t);
      // generic behaviours
      switch (verb) {
        case 'look': { const d = describe(t); return g.say(d === null ? DEFAULTS.look() : d); }
        case 'take':
          if (t.kind === 'item') return g.say('You already have that.');
          if (t.def.item) {
            if (t.def.drop !== undefined) { S().drops.splice(t.def.drop, 1); } else g.remove(t.def.id);
            g.give(t.def.item); g.emit('take');
            if (t.def.points) g.score(t.def.points, 'take:' + t.def.item);
            return g.say(t.def.takeMsg || 'You take the ' + def.items[t.def.item].name + '.');
          }
          return g.say(t.def.noTake || DEFAULTS.take());
        case 'drop':
          if (t.kind !== 'item') return g.say("You aren't carrying that.");
          g.lose(t.id); S().drops.push({ item: t.id, room: S().room, x: Math.round(S().x), y: Math.round(S().y) });
          return g.say(DEFAULTS.drop());
        case 'eat': case 'drink':
          if (t.kind === 'item' && t.def.food) { g.lose(t.id); return g.say(t.def.food); }
          return g.say(DEFAULTS[verb]());
        case 'give': return g.say("Give it to whom? Try 'give <thing> to <someone>'.");
        case 'use':
          if (t.kind === 'item' || t.kind === 'ground') for (const alt of ['light', 'wear', 'play', 'eat', 'drink']) if (t.def.verbs && has(t.def.verbs, alt)) return call(t.def.verbs[alt], t);
          if (t.kind === 'item') return g.say('Use it on what? Try "use ' + t.def.name + ' on <something>".');
          return g.say(DEFAULTS.use());
        default: return g.say(DEFAULTS[verb] ? DEFAULTS[verb](t) : 'Nothing happens.');
      }
    }

    // the player typed something
    g.command = (text, opts) => {
      if (S().dead || S().won) return false;
      const instant = !!(opts && opts.instant) || g.instant;
      g.pending = null; g.path = null;
      const p = parse(text);
      if (!p) return false;
      g.say('> ' + String(text).trim());
      S().moves++;
      if (!p.verb) { g.say("I don't know how to \"" + p.word + '".'); return false; }
      const v = p.verb;
      // things with no noun
      if (p.dir) return g.walkExit(p.dir, instant);
      if (v === 'inventory') { g.say(S().inv.length ? 'You are carrying: ' + S().inv.map(i => def.items[i].name).join(', ') + '.' : 'You are not carrying anything.'); return true; }
      if (v === 'score') { g.say('You have ' + S().points + ' of ' + def.maxScore + ' points.'); return true; }
      if (v === 'help') { g.say(def.help || 'Try: look, take, open, use X on Y, give X to Y, talk to, climb, push, pull, eat. Walk with the arrow keys or click. Type "inventory" to see what you carry.'); return true; }
      if (v === 'save' || v === 'restore' || v === 'restart') { g.events.push('cmd:' + v); return true; }
      if (v === 'wait') { g.say(def.waitText || 'Time passes.'); return true; }
      if (v === 'listen' && !p.a) { g.say(room().listen || 'You hear nothing special.'); return true; }
      if (v === 'smell' && !p.a) { g.say(room().smell || 'The air smells fresh.'); return true; }
      if (v === 'swim' && !p.a) { return runVerbWith(v, room().self ? { kind: 'obj', id: 'room', def: room().self } : null, null); }
      if (v === 'look' && !p.a) { const d = room().desc; g.say(typeof d === 'function' ? d(g) : d || 'You look around.'); return true; }
      if (v === 'enter' && !p.a) { g.say('Which way? Try north, south, east or west.'); return true; }
      if (v === 'search' && !p.a) { return runVerbWith('search', { kind: 'obj', id: 'room', def: room().self || {} }, null); }
      if (v === 'talk' && !p.a) { return runVerbWith('talk', { kind: 'obj', id: 'room', def: room().self || {} }, null); }
      if (!p.a) {
        if (v === 'climb') return runVerbWith('climb', { kind: 'obj', id: 'room', def: room().self || {} }, null);
        if (v === 'use' || v === 'take' || v === 'give' || v === 'open' || v === 'close') { g.say(v === 'take' ? 'Take what?' : 'What do you want to ' + v + '?'); return false; }
        g.say(DEFAULTS[v] ? DEFAULTS[v]() : 'What?');
        return false;
      }
      let A = resolve(p.a), B = p.b ? resolve(p.b) : null;
      // "give troll flute": no word between the two things
      if (!p.prep && (v === 'give' || v === 'use' || v === 'tie') && p.a.includes(' ')) {
        const w = p.a.split(' ');
        for (let i = 1; i < w.length; i++) {
          const x = resolve(w.slice(0, i).join(' ')), y = resolve(w.slice(i).join(' '));
          if (x && y && x.id !== y.id) { if (v === 'give') { A = y; B = x; } else { A = x; B = y; } break; }
        }
      }
      if (!A) { g.say(known(p.a) ? "You don't see that here." : 'I see no "' + p.a + '" here.'); return false; }
      if (p.prep && p.b && !B) { g.say(known(p.b) ? "You don't see that here." : 'I see no "' + p.b + '" here.'); return false; }
      if (p.prep && !p.b) { g.say(v + ' it ' + p.prep + ' what?'); return false; }
      return runVerbWith(v, A, B, instant);
    };

    function runVerbWith(v, A, B, instant) {
      if (instant === undefined) instant = g.instant;
      if (v === 'enter' && A && A.kind === 'obj' && A.def.exit) { // "enter cottage": a door that is an exit
        return g.walkExit(A.def.exit, instant);
      }
      const target = B && !TARGET_FIRST.has(v) ? B : A;
      const go = () => { runVerb(v, A, B); g.afterCommand(); };
      // things you carry never need walking to; things in the room do, for most verbs
      const reach = target && target.kind !== 'item' && NEEDS_NEAR.has(v) && (target.def.rect || target.def.at);
      if (reach) {
        if (instant) { const sp = g.standPoint(target.def); S().x = sp.x; S().y = sp.y; }
        else if (!nearObj(target.def)) {
          const sp = g.standPoint(target.def);
          if (!g.walkTo(sp.x, sp.y, go)) { g.say("You can't get there."); return false; }
          return true;
        }
      }
      go(); return true;
    }

    g.act = (verb, id) => { const o = g.objectById(id); if (o) runVerb(verb, { kind: o.item ? 'ground' : 'obj', id, def: o }, null); };
    g.afterCommand = () => { const r = room(); if (r.after) r.after(g); if (def.after) def.after(g); };

    // "go north" while standing somewhere: walk to that edge
    g.walkExit = (dir, instant) => {
      const r = room();
      if (!r.exits || !has(r.exits, dir)) { g.say("You can't go that way."); return false; }
      if (instant) return g.exit(dir);
      const zone = r.exitZones && r.exitZones[dir];
      const mid = zone ? (zone[0] + zone[1]) / 2 : null;
      const tx = dir === 'e' ? SW - 2 : dir === 'w' ? 2 : mid !== null ? mid : S().x;
      const ty = dir === 's' ? SH - 1 : dir === 'n' ? (r.horizon || 40) + 0.2 : mid !== null ? mid : S().y;
      if (!g.walkTo(tx, ty, () => { g.exit(dir); })) { g.say("You can't get there."); return false; }
      return true;
    };

    // clicking the picture: on a thing runs the verb on it, otherwise walks there
    g.click = (x, y) => {
      if (S().dead || S().won) return null;
      const objs = g.objects();
      for (let i = objs.length - 1; i >= 0; i--) { const o = objs[i], rc = o.rect; if (rc && x >= rc[0] && x < rc[0] + rc[2] && y >= rc[1] && y < rc[1] + rc[3]) return o; }
      g.walkTo(x, y);
      return null;
    };

    g.save = () => JSON.parse(JSON.stringify({ state: S(), checkpoint: g.checkpoint }));
    g.restore = () => {
      g.state = cleanState(def, g.checkpoint) || fresh();
      g.path = null; g.pending = null; g.emit('room');
    };
    g.restart = () => { g.state = fresh(); g.checkpoint = JSON.parse(JSON.stringify(g.state)); g.path = null; g.pending = null; g.out = []; if (def.onStart) def.onStart(g); g.emit('room'); };
    g.drain = () => { const e = g.events; g.events = []; return e; };
    g.drainText = () => { const o = g.out; g.out = []; return o; };

    if (!saved && def.onStart) def.onStart(g);
    return g;
  }

  // ---------- walking rules ----------
  function isWalkable(r, x, y, g) {
    if (x < 1 || y < 1 || x > SW - 1 || y > SH - 0.5) return false;
    if (y < (r.horizon || 40)) return false;
    for (const b of r.blocks || []) {
      const rect = typeof b === 'function' ? b(g) : b;
      if (rect && x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3]) return false;
    }
    if (r.walkOk && !r.walkOk(x, y, g)) return false;
    return true;
  }
  function snapWalkable(r, x, y, g) {
    x = clamp(x, 3, SW - 3); y = clamp(y, (r.horizon || 40) + 1, SH - 2);
    if (isWalkable(r, x, y, g)) return { x, y };
    let best = null;
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      const px = cx * CELL + CELL / 2, py = cy * CELL + CELL / 2;
      if (!isWalkable(r, px, py, g)) continue;
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (!best || d < best.d) best = { d, x: px, y: py };
    }
    return best ? { x: best.x, y: best.y } : { x, y };
  }

  // ---------- saved games ----------
  const FLAG_KEY = /^[a-zA-Z0-9_:.-]{1,60}$/;
  function cleanState(def, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return null;
    if (!has(def.rooms, raw.room)) return null;
    if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
    if (!['l', 'r', 'u', 'd'].includes(raw.dir)) return null;
    if (!Array.isArray(raw.inv) || raw.inv.length > 60) return null;
    const inv = [];
    for (const id of raw.inv) { if (!has(def.items, id) || inv.includes(id)) return null; inv.push(id); }
    if (!raw.flags || typeof raw.flags !== 'object' || Array.isArray(raw.flags)) return null;
    const keys = Object.keys(raw.flags);
    if (keys.length > 400) return null;
    const flags = Object.create(null);
    for (const k of keys) {
      const v = raw.flags[k];
      if (!FLAG_KEY.test(k) || k === '__proto__') return null;
      if (!(typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6) || isStr(v, 80))) return null;
      flags[k] = v;
    }
    if (!Array.isArray(raw.drops) || raw.drops.length > 40) return null;
    const drops = [];
    for (const d of raw.drops) {
      if (!d || !has(def.items, d.item) || !has(def.rooms, d.room) || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;
      drops.push({ item: d.item, room: d.room, x: clamp(Math.round(d.x), 2, SW - 2), y: clamp(Math.round(d.y), 2, SH - 1) });
    }
    if (!Number.isInteger(raw.points) || raw.points < 0 || raw.points > def.maxScore) return null;
    if (!Number.isInteger(raw.moves) || raw.moves < 0 || raw.moves > 1e7) return null;
    if (raw.dead !== null && !isStr(raw.dead, 400)) return null;
    if (raw.won !== null && !isStr(raw.won, 400)) return null;
    return { v: 1, room: raw.room, x: clamp(raw.x, 1, SW - 1), y: clamp(raw.y, 1, SH - 1), dir: raw.dir, inv, flags, drops, points: raw.points, moves: raw.moves, dead: raw.dead, won: raw.won };
  }

  const api = { SW, SH, CELL, parse, norm, create, cleanState, nameScore, isWalkable, snapWalkable, VERBS, has };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Adventure = api;
})(typeof window !== 'undefined' ? window : globalThis);
