'use strict';
// Seeds and lockstep play only work if every browser builds the same world. Engines differ in the order they call a sort
// comparator, in rounding of Math.hypot/Math.pow and so on. These tests make sure the rules don't depend on that.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../sectordominion/game.js');
const W = require('../warptraders/game.js');

// a stable merge sort that visits the comparator in a different order than the built-in one
function withOtherSort(fn) {
  const native = Array.prototype.sort;
  Array.prototype.sort = function (cmp) {
    const a = Array.from(this);
    const msort = arr => {
      if (arr.length < 2) return arr;
      const mid = arr.length >> 1, l = msort(arr.slice(0, mid)), r = msort(arr.slice(mid));
      const out = []; let i = l.length - 1, j = r.length - 1;
      // merge from the back: the opposite comparison order to a front-to-back merge
      const tmp = [];
      while (i >= 0 || j >= 0) {
        if (j < 0 || (i >= 0 && cmp(l[i], r[j]) > 0)) tmp.push(l[i--]); else tmp.push(r[j--]);
      }
      while (tmp.length) out.push(tmp.pop());
      return out;
    };
    const sorted = cmp ? msort(a) : native.call(a);
    for (let k = 0; k < sorted.length; k++) this[k] = sorted[k];
    return this;
  };
  try { return fn(); } finally { Array.prototype.sort = native; }
}

test('Sector Dominion: the same seed builds the same world whatever the sort algorithm', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const a = JSON.stringify(G.newGame({ seed, humans: 3 }));
    const b = withOtherSort(() => JSON.stringify(G.newGame({ seed, humans: 3 })));
    assert.equal(a, b, 'seed ' + seed);
  }
});

test('Warp Traders: the same seed builds the same galaxy whatever the sort algorithm', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const a = JSON.stringify(W.newGame({ seed }));
    const b = withOtherSort(() => JSON.stringify(W.newGame({ seed })));
    assert.equal(a, b, 'seed ' + seed);
  }
});

test('Sector Dominion: whole games replay the same whatever the sort algorithm', () => {
  function play() {
    const s = G.newGame({ seed: 9, humans: 2, worlds: 36 });
    for (let t = 0; t < 40 && !s.over; t++) for (const e of s.empires) if (e.human && e.alive) G.apply(s, e.id, { op: 'ready', turn: s.turn });
    return G.hashState(s);
  }
  assert.equal(play(), withOtherSort(play));
});

test('the rules only use exactly-rounded arithmetic', () => {
  // Math.hypot, Math.pow, Math.exp, trig and friends may differ in the last bit between engines
  const banned = /Math\.(hypot|pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|cbrt|random)\b|\*\*/;
  for (const file of ['../sectordominion/game.js', '../warptraders/game.js']) {
    const lines = fs.readFileSync(path.join(__dirname, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const code = line.replace(/\/\/.*$/, '');
      const m = code.match(banned);
      // the one allowed Math.random is the default seed when the player did not pick one
      if (m && !(m[0] === 'Math.random' && /opts\.seed/.test(code))) assert.fail(file + ':' + (i + 1) + ' uses ' + m[0]);
    });
  }
});

test('hashState ignores the log but sees everything else', () => {
  const s = G.newGame({ seed: 4, humans: 2 });
  const h = G.hashState(s);
  s.log.unshift({ turn: 1, text: 'hi', kind: 'info' });
  assert.equal(G.hashState(s), h);
  for (const mutate of [x => { x.empires[0].credits++; }, x => { x.worlds[3].pop += 0.001; }, x => { x.rng++; }, x => { x.turn++; },
    x => { const k = Object.keys(x.known[1])[0]; x.known[1][k].owner = 3; }, x => { x.worlds[0].garrison.scout++; }, x => { x.ready[1] = true; }]) {
    const c = JSON.parse(JSON.stringify(s));
    mutate(c);
    assert.notEqual(G.hashState(c), h);
  }
});
