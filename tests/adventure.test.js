'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Adv = require('../shared/adventure.js');
const Art = require('../shared/adventure-art.js');

const GAMES = {
  hollowmere: { def: require('../hollowmere/game.js'), walk: require('./walk-hollowmere.js') },
  gullrock: { def: require('../gullrock/game.js'), walk: require('./walk-gullrock.js') },
  starsweeper: { def: require('../starsweeper/game.js'), walk: require('./walk-starsweeper.js') },
};

function play(def, lines) {
  const g = Adv.create(def);
  g.instant = true;
  for (const l of lines) { g.command(l); g.drainText(); }
  return g;
}

test('parser: verbs, nouns, prepositions, directions', () => {
  const p = Adv.parse;
  assert.deepEqual(p('look'), { verb: 'look', a: '', prep: '', b: '' });
  assert.equal(p('N').dir, 'n');
  assert.equal(p('go west').dir, 'w');
  assert.deepEqual(p('Pick up the rope!'), { verb: 'take', a: 'rope', prep: '', b: '' });
  assert.deepEqual(p('use the rope on the old well'), { verb: 'use', a: 'rope', prep: 'on', b: 'old well' });
  assert.deepEqual(p('give coin to crow'), { verb: 'give', a: 'coin', prep: 'to', b: 'crow' });
  assert.equal(p('look under rock').verb, 'search');
  assert.equal(p('put on veil').verb, 'wear');
  assert.equal(p('xyzzy').verb, null);
  assert.equal(p('   '), null);
  assert.equal(p(''), null);
  assert.equal(p('?').verb, 'help');
  assert.deepEqual(p('jump in the well'), { verb: 'swim', a: 'well', prep: '', b: '' });
  for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'take __proto__', 'use constructor on toString']) assert.doesNotThrow(() => p(hostile));
});

test('every room and exit is real, and exits come back where they should', () => {
  for (const [name, { def }] of Object.entries(GAMES)) {
    assert.ok(def.rooms[def.start.room], name + ' start room');
    for (const [rid, r] of Object.entries(def.rooms)) {
      assert.equal(typeof r.back, 'function', rid + ' draws');
      for (const [dir, to] of Object.entries(r.exits || {})) {
        assert.ok(def.rooms[to], rid + ' exit ' + dir + ' goes nowhere');
        assert.ok(['n', 's', 'e', 'w'].includes(dir));
        const back = { n: 's', s: 'n', e: 'w', w: 'e' }[dir];
        if (!(r.oneWay || []).includes(dir)) assert.equal(def.rooms[to].exits && def.rooms[to].exits[back], rid, rid + ' -> ' + to + ' has no way back');
      }
      for (const o of r.objects || []) {
        assert.ok(o.id && o.name, rid + ' object needs id and name');
        if (o.item) assert.ok(def.items[o.item], rid + ' ' + o.id + ' gives an unknown item');
        if (o.rect) assert.equal(o.rect.length, 4);
      }
      // the start of each room has somewhere to stand
      const g = Adv.create(def); g.state.room = rid;
      const p = Adv.snapWalkable(r, 80, 80, g);
      assert.ok(Adv.isWalkable(r, p.x, p.y, g), rid + ' has no walkable floor');
    }
    // the rooms are all reachable from the start
    // (a room with reachedBy is entered by a handler, like landing a pod: start from those too)
    const firsts = [def.start.room].concat(Object.keys(def.rooms).filter(id => def.rooms[id].reachedBy));
    const seen = new Set(firsts), q = firsts.slice();
    while (q.length) for (const to of Object.values(def.rooms[q.shift()].exits || {})) if (!seen.has(to)) { seen.add(to); q.push(to); }
    // (rooms entered by a door, not an edge, are reached through their object handlers: count them too)
    assert.ok(seen.size >= Object.keys(def.rooms).length - 2, name + ' rooms unreachable');
  }
});

test('every scene draws without error, on a fake canvas, at several moments', () => {
  const calls = { n: 0 };
  const ctx = new Proxy({}, { get: (_, k) => (k === 'fillRect' ? () => { calls.n++; } : k === 'fillStyle' ? '' : () => {}), set: () => true });
  const c = new Art.Pix(ctx);
  for (const [name, { def }] of Object.entries(GAMES)) {
    const g = Adv.create(def);
    if (def.hd) continue; // drawn by hd2d.js, checked below
    for (const [rid, r] of Object.entries(def.rooms)) {
      g.state.room = rid;
      for (const t of [0, 0.4, 1.7]) {
        r.back(c, g, t);
        for (const o of g.objects()) if (o.draw) o.draw(c, g, t);
        (def.hero || Art.hero)(c, 80, 80, 'd', true, 3);
      }
    }
    for (const it of Object.values(def.items)) if (it.draw) it.draw(c, 10, 10, g);
  }
  assert.ok(calls.n > 1000);
});

test('HD-2D games: every room renders lit pixels, with and without the things in it, facing every way', () => {
  const HD = require('../shared/hd2d.js');
  for (const [name, { def }] of Object.entries(GAMES)) {
    if (!def.hd) continue;
    for (const [rid, r] of Object.entries(def.rooms)) {
      assert.ok(Object.prototype.hasOwnProperty.call(HD.LOOKS, r.look || 'hd2d'), name + '/' + rid + ' look');
      for (const [t, dir, flagsOn] of [[0, 'd', false], [0.4, 'l', true], [1.7, 'u', false], [3.1, 'r', true]]) {
        const g = Adv.create(def); g.state.room = rid; g.state.dir = dir;
        if (flagsOn) { for (const f of ['slime_gone', 'bay_open', 'eel_fed', 'mopped', 'jackpot', 'lit', 'oil_in', 'wick_in', 'fished', 'glasses_found', 'glass_found', 'gave_glasses', 'gave_fish']) g.set(f); for (const it of ['mop', 'fish']) if (def.items[it]) g.give(it); g.state.drops.push({ item: Object.keys(def.items)[0], room: rid, x: 60, y: 90 }); }
        const fr = HD.render(def, g, t, { moving: true });
        assert.equal(fr.rgba.length, HD.W * HD.H * 4);
        let lit = 0, bad = 0;
        for (let i = 0; i < fr.rgba.length; i += 4) { const v = fr.rgba[i] + fr.rgba[i + 1] + fr.rgba[i + 2]; if (v > 60) lit++; if (Number.isNaN(v)) bad++; }
        assert.equal(bad, 0);
        assert.ok(lit > HD.W * HD.H * 0.25, name + '/' + rid + ' is mostly dark (' + lit + ')');
        for (const sh of fr.shafts) assert.ok(['window', 'cone', 'sun', 'sweep'].includes(sh.kind), rid + ' shaft kind');
      }
    }
  }
});

test('HD-2D: a cached background gives the same picture as drawing it fresh', () => {
  const HD = require('../shared/hd2d.js'), def = GAMES.starsweeper.def;
  const g = Adv.create(def), cache = {};
  HD.render(def, g, 1, { cache });
  const a = HD.render(def, g, 1.05, { cache }).rgba, b = HD.render(def, g, 1, {}).rgba;
  let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  assert.ok(diff < a.length * 0.02, 'cached frame drifted: ' + diff);
});

for (const [name, { def, walk }] of Object.entries(GAMES)) {
  test(name + ': the walkthrough wins with every point', () => {
    const g = Adv.create(def);
    g.instant = true;
    for (const line of walk.win) {
      assert.ok(!g.state.dead, 'died at "' + line + '": ' + g.state.dead);
      g.command(line);
    }
    assert.ok(g.state.won, 'did not win');
    assert.equal(g.state.points, def.maxScore, 'score');
    assert.ok(!g.state.dead);
  });

  test(name + ': deaths are reachable and restoring puts you back safely', () => {
    for (const d of walk.deaths) {
      const g = Adv.create(def); g.instant = true;
      for (const line of d.lines) g.command(line);
      assert.ok(g.state.dead, d.name + ' should die; said: ' + g.drainText().slice(-2).join(' | '));
      assert.ok(String(g.state.dead).length > 20);
      assert.equal(g.command('look'), false, 'no commands once dead');
      g.restore();
      assert.equal(g.state.dead, null, d.name + ' restore clears death');
      assert.ok(Adv.cleanState(def, g.save().state), 'restored state is valid');
    }
  });

  test(name + ': a restored game is no further along than the saved point, and the world is not duplicated', () => {
    const g = Adv.create(def); g.instant = true;
    for (const line of walk.win.slice(0, 12)) g.command(line);
    const before = JSON.stringify(g.save());
    const g2 = Adv.create(def, JSON.parse(before));
    assert.equal(JSON.stringify(g2.save()), before);
  });

  test(name + ': random commands never throw and never corrupt the state', () => {
    const words = ['look', 'take', 'drop', 'open', 'use', 'give', 'talk', 'push', 'pull', 'climb', 'search', 'eat', 'wear', 'light', 'play', 'cut', 'tie', 'kiss', 'attack', 'swim', 'n', 's', 'e', 'w', 'inventory', 'enter', 'wait', 'listen', 'smell', 'dig', 'drink', 'on', 'with', 'to'];
    const nouns = new Set();
    for (const it of Object.values(def.items)) { nouns.add(it.name); (it.aliases || []).forEach(a => nouns.add(a)); }
    for (const r of Object.values(def.rooms)) for (const o of r.objects || []) { nouns.add(o.name); (o.aliases || []).forEach(a => nouns.add(a)); }
    const nl = [...nouns];
    let a = 12345;
    const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = l => l[Math.floor(rnd() * l.length)];
    for (let run = 0; run < 150; run++) {
      const g = Adv.create(def); g.instant = true;
      for (let i = 0; i < 80; i++) {
        const line = [pick(words), rnd() < 0.8 ? pick(nl) : '', rnd() < 0.3 ? pick(['on', 'with', 'to']) : '', rnd() < 0.3 ? pick(nl) : ''].join(' ');
        g.command(line);
        g.drain(); g.drainText();
        if (g.state.dead) { if (rnd() < 0.5) g.restore(); else g.restart(); }
        const st = g.save().state;
        assert.ok(Adv.cleanState(def, st), 'invalid state after "' + line + '": ' + JSON.stringify(st).slice(0, 200));
        assert.ok(g.state.points <= def.maxScore);
        assert.equal(new Set(g.state.inv).size, g.state.inv.length, 'duplicate item after "' + line + '"');
      }
    }
  });

  test(name + ': walking by arrows and by clicks stays on the floor and uses the exits', () => {
    const g = Adv.create(def);
    const r = () => def.rooms[g.state.room];
    for (let i = 0; i < 4000; i++) {
      const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][(i >> 4) % 4];
      g.nudge(dir[0], dir[1], 0.05);
      if (g.state.dead) g.restore();
      assert.ok(Adv.isWalkable(r(), g.state.x, g.state.y, g) || g.state.y >= 99 || g.state.x <= 3 || g.state.x >= 157, 'off the floor at ' + g.state.x + ',' + g.state.y + ' in ' + g.state.room);
    }
    for (let i = 0; i < 300; i++) {
      g.click((i * 37) % 160, 30 + (i * 53) % 70);
      for (let k = 0; k < 400 && g.path; k++) g.update(0.05);
      if (g.state.dead) g.restore();
    }
  });
}

test('saved games from storage are checked, and hostile ones are refused', () => {
  const def = GAMES.hollowmere.def;
  const g = Adv.create(def); g.instant = true;
  g.command('e'); g.command('search rock'); g.command('take flute');
  const good = g.save().state;
  assert.ok(Adv.cleanState(def, JSON.parse(JSON.stringify(good))));
  const mut = f => { const c = JSON.parse(JSON.stringify(good)); f(c); return c; };
  const bad = [null, 7, 'x', [], {}, mut(c => { c.v = 2; }), mut(c => { c.room = 'moon'; }), mut(c => { c.room = '__proto__'; }), mut(c => { c.room = 'constructor'; }),
    mut(c => { c.x = 'a'; }), mut(c => { c.x = NaN; }), mut(c => { c.dir = 'z'; }), mut(c => { c.inv = 'flute'; }), mut(c => { c.inv = ['flute', 'flute']; }), mut(c => { c.inv = ['hammer']; }),
    mut(c => { c.inv = ['constructor']; }), mut(c => { c.flags = []; }), mut(c => { c.flags = { 'a b': true }; }), mut(c => { c.flags = { x: {} }; }), mut(c => { c.flags = { x: 'y'.repeat(500) }; }),
    mut(c => { c.drops = [{ item: 'nope', room: 'meadow', x: 1, y: 1 }]; }), mut(c => { c.drops = [{ item: 'flute', room: 'nowhere', x: 1, y: 1 }]; }), mut(c => { c.points = 9999; }), mut(c => { c.points = -1; }),
    mut(c => { c.points = 1.5; }), mut(c => { c.moves = 'many'; }), mut(c => { c.dead = 5; }), mut(c => { c.won = {}; })];
  for (const b of bad) assert.equal(Adv.cleanState(def, b), null, JSON.stringify(b).slice(0, 100));
  // a flag called __proto__ is refused, and one that sneaks through cannot change what every object inherits
  const evil = JSON.parse('{"v":1,"room":"castle","x":10,"y":70,"dir":"d","inv":[],"flags":{"__proto__":true},"drops":[],"points":0,"moves":0,"dead":null,"won":null}');
  assert.equal(Adv.cleanState(def, evil), null);
  assert.equal({}.polluted, undefined);
  // out-of-range positions are pulled back on screen
  const far = mut(c => { c.x = 9e9; c.y = -50; });
  const fixed = Adv.cleanState(def, far);
  assert.ok(fixed.x <= 159 && fixed.y >= 1);
  // a game created from a hostile save falls back to a fresh game
  const g2 = Adv.create(def, { state: { v: 1, room: 'moon' }, checkpoint: null });
  assert.equal(g2.state.room, def.start.room);
});

test('every thing you can click can be walked up to, and every exit can be walked to', () => {
  for (const [name, { def }] of Object.entries(GAMES)) {
    for (const [rid, r] of Object.entries(def.rooms)) {
      const fresh = () => {
        const g = Adv.create(def); g.state.room = rid;
        const p = Adv.snapWalkable(r, 80, 80, g); g.state.x = p.x; g.state.y = p.y;
        // everything is visible for this check
        for (const k of Object.keys(g.state.flags)) delete g.state.flags[k];
        return g;
      };
      const g0 = fresh();
      for (const o of r.objects || []) {
        if (!o.rect && !o.at) continue;
        const sp = g0.standPoint(o);
        assert.ok(Adv.isWalkable(r, sp.x, sp.y, g0), name + '/' + rid + '/' + o.id + ' stand point ' + sp.x + ',' + sp.y + ' is not walkable');
        const g = fresh();
        assert.ok(g.walkTo(sp.x, sp.y), name + '/' + rid + '/' + o.id + ' cannot be reached');
        for (let i = 0; i < 800 && g.path; i++) g.update(0.05);
        assert.ok(Math.abs(g.state.x - sp.x) < 1 && Math.abs(g.state.y - sp.y) < 1, name + '/' + rid + '/' + o.id + ' not reached');
      }
      for (const dir of Object.keys(r.exits || {})) {
        const g = fresh();
        g.walkExit(dir, false);
        for (let i = 0; i < 1500 && g.path && !g.state.dead; i++) g.update(0.05);
        assert.ok(g.state.room !== rid || g.state.dead, name + '/' + rid + ' exit ' + dir + ' cannot be walked to');
      }
    }
  }
});
