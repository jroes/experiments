'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../warptraders/game.js');

function driver(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clone = x => JSON.parse(JSON.stringify(x));
const isNat = n => Number.isInteger(n) && n >= 0;

const stock0Of = (p, g) => p.stock[g];

function check(s, where) {
  const fail = m => assert.fail(where + ': ' + m);
  if (!Number.isFinite(s.credits) || s.credits < 0) fail('credits ' + s.credits);
  if (s.turnsLeft < 0) fail('turnsLeft ' + s.turnsLeft);
  if (!isNat(s.holds) || !isNat(s.fighters)) fail('holds/fighters');
  for (const g of W.GOODS) {
    if (!isNat(s.cargo[g])) fail('cargo ' + g + ' = ' + s.cargo[g]);
    if (!Number.isFinite(s.paid[g]) || s.paid[g] < -1e-6) fail('paid ' + g);
    if (s.cargo[g] === 0 && s.paid[g] > 1e-6) fail('cost basis without cargo');
  }
  if (W.cargoUsed(s) > s.holds) fail('over capacity');
  for (const sec of s.sectors) {
    if (!sec.port) continue;
    for (const g of W.GOODS) {
      const st = sec.port.stock[g], mx = sec.port.max[g];
      if (!Number.isFinite(st) || st < -1e-9 || st > mx + 1e-9) fail('stock out of range ' + st + '/' + mx);
    }
  }
  if (!s.sectors[s.sector]) fail('sector');
  if (s.over && s.encounter) fail('encounter after game over');
}

const junkNums = [undefined, null, NaN, Infinity, -Infinity, -5, 0, 0.5, 1, 7, 1e9, '3', 'x', {}, []];

function step(s, rnd) {
  const here = s.sectors[s.sector], r = rnd();
  const g = W.GOODS[(rnd() * 3) | 0];
  if (s.encounter) return W.resolve(s, ['fight', 'pay', 'flee', 'x'][(rnd() * 4) | 0]);
  if (r < 0.35) return W.warp(s, here.warps[(rnd() * here.warps.length) | 0]);
  if (r < 0.4) return W.warp(s, (rnd() * s.sectors.length) | 0); // mostly illegal
  if (r < 0.55) return W.trade(s, g, junkNums[(rnd() * junkNums.length) | 0], rnd() < 0.5);
  if (r < 0.75) return W.trade(s, g, W.maxQty(s, g, true), true);
  if (r < 0.9) return W.trade(s, g, W.maxQty(s, g, false), false);
  if (r < 0.93) return W.buyHolds(s);
  if (r < 0.96) return W.buyFighters(s, junkNums[(rnd() * junkNums.length) | 0]);
  if (r < 0.98) return W.travel(s, (rnd() * s.sectors.length) | 0);
  return null;
}

test('random play keeps every invariant (150 games)', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const rnd = driver(seed * 31);
    const s = W.newGame({ seed });
    for (let i = 0; i < 4000 && !s.over; i++) { step(s, rnd); check(s, 'seed ' + seed + ' step ' + i); }
  }
});

test('the galaxy is connected and Stardock has no port', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = W.newGame({ seed });
    const seen = new Set([0]);
    for (const q = [0]; q.length;) for (const n of s.sectors[q.shift()].warps) if (!seen.has(n)) { seen.add(n); q.push(n); }
    assert.equal(seen.size, s.sectors.length, 'seed ' + seed + ' is disconnected');
    assert.equal(s.sectors[0].port, null);
    for (const sec of s.sectors) for (const w of sec.warps) assert.ok(s.sectors[w].warps.includes(sec.id), 'one-way lane');
  }
});

test('every port both buys and sells something', () => {
  for (let seed = 1; seed <= 50; seed++) for (const sec of W.newGame({ seed }).sectors) if (sec.port) {
    const modes = new Set(Object.values(sec.port.mode));
    assert.ok(modes.has('buy') && modes.has('sell'));
  }
});

test('no free money at a single port: buying then selling the same amount never profits', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const s = W.newGame({ seed });
    for (const sec of s.sectors) {
      if (!sec.port) continue;
      for (const g of W.GOODS) for (const q of [1, 5, 20, 100, 500]) {
        if (q > stock0Of(sec.port, g)) continue; // the game never sells more than the port holds
        const p = sec.port, stock0 = p.stock[g];
        const buy = W.quote(p, g, q, true);
        p.stock[g] = stock0 - q;
        const back = W.quote(p, g, q, false);
        p.stock[g] = stock0;
        assert.ok(back <= buy, 'arbitrage in sector ' + sec.id + ' ' + g + ' q=' + q + ': paid ' + buy + ' got ' + back);
      }
    }
  }
});

test('price stays inside its band', () => {
  for (const g of W.GOODS) for (let r = 0; r <= 1.0001; r += 0.05) {
    const p = W.unitPrice(g, r * 100, 100);
    assert.ok(p >= W.BASE[g] * 0.75 - 1e-9 && p <= W.BASE[g] * 1.25 + 1e-9);
  }
});

test('maxQty is the exact largest affordable amount', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = W.newGame({ seed });
    const rnd = driver(seed);
    const dock = s.sectors[0];
    // visit ports by teleporting (test only)
    for (const sec of s.sectors) {
      if (!sec.port) continue;
      s.sector = sec.id; s.credits = Math.floor(rnd() * 3000); s.holds = 5 + ((rnd() * 60) | 0);
      for (const g of W.GOODS) {
        if (sec.port.mode[g] !== 'sell') continue;
        const q = W.maxQty(s, g, true);
        const limit = Math.min(Math.floor(sec.port.stock[g]), s.holds - W.cargoUsed(s));
        if (q > 0) assert.ok(W.quote(sec.port, g, q, true) <= s.credits);
        if (q < limit) assert.ok(W.quote(sec.port, g, q + 1, true) > s.credits, 'maxQty too small');
      }
    }
    assert.ok(dock);
  }
});

test('bad quantities never corrupt the ledger', () => {
  const s = W.newGame({ seed: 2 });
  const port = s.sectors.find(x => x.port);
  s.sector = port.id;
  for (const g of W.GOODS) for (const q of junkNums) for (const buying of [true, false]) {
    const before = clone(s);
    const r = W.trade(s, g, q, buying);
    if (!r.ok) assert.deepEqual(s, before, 'rejected trade changed state');
    check(s, 'junk qty ' + String(q));
  }
});

test('same seed and same moves give the identical run, even through JSON', () => {
  function run(seed, roundTrip) {
    const rnd = driver(seed);
    let s = W.newGame({ seed });
    for (let i = 0; i < 1500 && !s.over; i++) { if (roundTrip && i === 700) s = clone(s); step(s, rnd); }
    return s;
  }
  for (let seed = 1; seed <= 15; seed++) {
    assert.deepEqual(run(seed, false), run(seed, false));
    assert.deepEqual(run(seed, true), run(seed, false));
  }
});

test('turns never go below zero, including while fleeing pirates on the last turn', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = W.newGame({ seed });
    s.turnsLeft = 1;
    const rnd = driver(seed);
    for (let i = 0; i < 20 && !s.over; i++) step(s, rnd);
    assert.ok(s.turnsLeft >= 0, 'seed ' + seed + ' turnsLeft ' + s.turnsLeft);
  }
});

test('goods, choices and sectors taken from input are never read from inherited properties', () => {
  const keys = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
  const s = W.newGame({ seed: 2 });
  s.sector = s.sectors.find(x => x.port).id;
  const before = JSON.stringify(s);
  for (const g of keys) for (const buying of [true, false]) {
    assert.equal(W.trade(s, g, 5, buying).ok, false, g);
    assert.equal(W.maxQty(s, g, buying), 0, g);
  }
  for (const to of keys) assert.equal(W.warp(s, to).ok, false);
  assert.equal(JSON.stringify(s), before);
  const e = W.newGame({ seed: 2 });
  e.encounter = { strength: 5 };
  for (const c of keys) assert.equal(W.resolve(e, c).ok, false);
  assert.ok(e.encounter);
});
