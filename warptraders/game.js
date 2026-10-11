/*
 * Warp Traders: rules. Original space-trading game, no DOM here so it runs in node too.
 * State is plain JSON for localStorage saves.
 */
(function (root) {
  'use strict';

  const GOODS = ['fuel', 'organics', 'equipment'];
  const BASE = { fuel: 20, organics: 40, equipment: 80 };
  const LABEL = { fuel: 'Fuel ore', organics: 'Organics', equipment: 'Equipment' };
  const START_TURNS = 400;
  const W = 100, H = 70;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // all in-game randomness comes from the state, so a run can be replayed exactly
  function rand(s) {
    const a = (s.rng = (s.rng + 0x6D2B79F5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cargoUsed = s => GOODS.reduce((n, g) => n + s.cargo[g], 0);

  function log(s, text, kind) {
    s.log.unshift({ turn: START_TURNS - s.turnsLeft, text, kind: kind || 'info' });
    if (s.log.length > 100) s.log.length = 100;
  }

  // ---------- ports and prices ----------

  // price per unit at the current stock. Full stock is cheap, empty stock is dear.
  function unitPrice(good, stock, max) {
    return BASE[good] * (1.25 - 0.5 * Math.min(1, Math.max(0, stock / max)));
  }

  function quote(port, good, qty, buying) {
    // buying = player buys from port (port stock drops), else player sells (stock rises)
    let stock = port.stock[good], total = 0;
    // Each unit is priced on the stock edge it crosses, so buying a unit and selling it back cost the same.
    for (let i = 0; i < qty; i++) {
      total += unitPrice(good, buying ? stock - 1 : stock, port.max[good]);
      stock += buying ? -1 : 1;
    }
    // the player never gains from rounding: pay rounds up, receive rounds down
    return buying ? Math.ceil(total - 1e-6) : Math.floor(total + 1e-6);
  }

  function maxQty(s, good, buying) {
    const p = s.sectors[s.sector].port;
    if (!p || p.mode[good] !== (buying ? 'sell' : 'buy')) return 0;
    if (!buying) return Math.max(0, Math.min(s.cargo[good], Math.floor(p.max[good] - p.stock[good])));
    let hi = Math.max(0, Math.min(Math.floor(p.stock[good]), s.holds - cargoUsed(s))), lo = 0;
    while (lo < hi) { // largest q whose total price fits the budget (price rises with q, so this is monotonic)
      const mid = Math.ceil((lo + hi) / 2);
      if (quote(p, good, mid, true) <= s.credits) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function trade(s, good, qty, buying) {
    if (s.over || s.encounter) return { ok: false, msg: 'Not now.' };
    const p = s.sectors[s.sector].port;
    if (!p) return { ok: false, msg: 'No port here.' };
    if (p.mode[good] !== (buying ? 'sell' : 'buy')) return { ok: false, msg: 'Port will not ' + (buying ? 'sell' : 'buy') + ' that.' };
    if (typeof qty !== 'number' || !Number.isFinite(qty)) return { ok: false, msg: 'Bad quantity.' };
    qty = Math.floor(qty);
    if (qty < 1) return { ok: false, msg: 'Nothing to trade.' };
    if (buying) {
      if (qty > p.stock[good]) return { ok: false, msg: 'Port has only ' + Math.floor(p.stock[good]) + '.' };
      if (qty > s.holds - cargoUsed(s)) return { ok: false, msg: 'Not enough empty holds.' };
      const cost = quote(p, good, qty, true);
      if (cost > s.credits) return { ok: false, msg: 'Not enough credits.' };
      s.credits -= cost; p.stock[good] -= qty;
      s.paid[good] += cost; s.cargo[good] += qty;
      log(s, 'Bought ' + qty + ' ' + LABEL[good] + ' for ' + cost + '.');
    } else {
      if (qty > s.cargo[good]) return { ok: false, msg: 'You only have ' + s.cargo[good] + '.' };
      if (qty > p.max[good] - p.stock[good]) return { ok: false, msg: 'Port is full on that.' };
      const gain = quote(p, good, qty, false);
      const avg = s.cargo[good] ? s.paid[good] / s.cargo[good] : 0;
      s.paid[good] = Math.max(0, s.paid[good] - avg * qty);
      s.credits += gain; p.stock[good] += qty; s.cargo[good] -= qty;
      const profit = Math.round(gain - avg * qty);
      log(s, 'Sold ' + qty + ' ' + LABEL[good] + ' for ' + gain + ' (' + (profit >= 0 ? '+' : '') + profit + ').', profit >= 0 ? 'good' : 'bad');
    }
    snapshot(s);
    return { ok: true };
  }

  function snapshot(s) {
    const sec = s.sectors[s.sector];
    if (sec.port) s.seen[sec.id] = { turn: START_TURNS - s.turnsLeft, port: JSON.parse(JSON.stringify(sec.port)) };
  }

  function tick(s, n) {
    for (let i = 0; i < n; i++) {
      for (const sec of s.sectors) {
        const p = sec.port;
        if (!p) continue;
        for (const g of GOODS) {
          const d = p.max[g] * (0.006 + rand(s) * 0.006);
          p.stock[g] = p.mode[g] === 'sell' ? Math.min(p.max[g], p.stock[g] + d) : Math.max(0, p.stock[g] - d);
        }
      }
    }
  }

  // ---------- new game ----------

  function newGame(opts) {
    opts = opts || {};
    const seed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
    const rnd = mulberry32(seed);
    const N = 60, pts = [];
    let tries = 0;
    while (pts.length < N && tries++ < 20000) {
      const p = { x: 4 + rnd() * (W - 8), y: 4 + rnd() * (H - 8) };
      if (pts.every(q => dist(p, q) > 8)) pts.push(p);
    }
    // sector 0 (the Stardock) is the one nearest the middle
    pts.sort((a, b) => dist(a, { x: W / 2, y: H / 2 }) - dist(b, { x: W / 2, y: H / 2 }));
    const sectors = pts.map((p, i) => ({ id: i, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, warps: [], port: null }));

    // connect: spanning tree for guaranteed reach, plus each node's two nearest
    const edges = [];
    for (let i = 0; i < sectors.length; i++) for (let j = i + 1; j < sectors.length; j++) edges.push([dist(sectors[i], sectors[j]), i, j]);
    edges.sort((a, b) => a[0] - b[0]);
    const uf = sectors.map((_, i) => i);
    const find = x => uf[x] === x ? x : (uf[x] = find(uf[x]));
    const link = (a, b) => {
      if (!sectors[a].warps.includes(b)) sectors[a].warps.push(b);
      if (!sectors[b].warps.includes(a)) sectors[b].warps.push(a);
    };
    for (const [, a, b] of edges) if (find(a) !== find(b)) { uf[find(a)] = find(b); link(a, b); }
    for (const sec of sectors) {
      sectors.filter(o => o !== sec).sort((a, b) => dist(a, sec) - dist(b, sec)).slice(0, 2).forEach(o => link(sec.id, o.id));
    }
    for (const sec of sectors) sec.warps.sort((a, b) => a - b);

    // ports in ~65% of non-dock sectors
    for (const sec of sectors) {
      if (sec.id === 0 || rnd() > 0.65) continue;
      const mode = {}, stock = {}, max = {};
      const sells = 1 + (rnd() < 0.4 ? 1 : 0);
      const order = GOODS.slice().sort(() => rnd() - 0.5);
      order.forEach((g, i) => { mode[g] = i < sells ? 'sell' : 'buy'; });
      for (const g of GOODS) {
        max[g] = Math.round((600 + rnd() * 1400) * (g === 'equipment' ? 0.6 : 1));
        stock[g] = mode[g] === 'sell' ? max[g] * (0.5 + rnd() * 0.5) : max[g] * rnd() * 0.3;
      }
      sec.port = { mode, stock, max };
    }

    // hops from the dock, for pirate danger
    const hops = sectors.map(() => -1);
    hops[0] = 0;
    for (let q = [0]; q.length;) {
      const c = q.shift();
      for (const n of sectors[c].warps) if (hops[n] < 0) { hops[n] = hops[c] + 1; q.push(n); }
    }
    sectors.forEach((sec, i) => { sec.hops = hops[i]; });

    const s = {
      version: 2, seed, rng: (seed ^ 0x9E3779B9) | 0, sectors, sector: 0, prev: 0, turnsLeft: START_TURNS,
      credits: 1000, holds: 20, fighters: 0, cargo: { fuel: 0, organics: 0, equipment: 0 },
      paid: { fuel: 0, organics: 0, equipment: 0 }, visited: [0], seen: {}, log: [], encounter: null, over: false,
    };
    snapshot(s);
    log(s, 'You dock at Stardock with 1000 credits and a 20-hold freighter. Buy low, sell high.', 'good');
    return s;
  }

  // ---------- movement and encounters ----------

  function neighbors(s, id) { return s.sectors[id].warps; }

  function warp(s, to) {
    if (s.over || s.encounter) return { ok: false, msg: 'Not now.' };
    if (!neighbors(s, s.sector).includes(to)) return { ok: false, msg: 'No warp lane there.' };
    s.prev = s.sector; s.sector = to; s.turnsLeft--;
    if (!s.visited.includes(to)) s.visited.push(to);
    tick(s, 1);
    snapshot(s);
    const sec = s.sectors[to];
    if (to !== 0 && s.turnsLeft > 0 && rand(s) < 0.05 + 0.025 * sec.hops) {
      const strength = Math.round(4 + sec.hops * 3 + (START_TURNS - s.turnsLeft) / 25 + rand(s) * 6);
      s.encounter = { strength };
      log(s, 'Pirates ambush you in sector ' + (to + 1) + ' (strength ' + strength + ').', 'bad');
    }
    if (s.turnsLeft <= 0 && !s.encounter) finish(s);
    return { ok: true };
  }

  function path(s, from, to) {
    // shortest path over sectors the player has visited (plus the target)
    const ok = id => s.visited.includes(id) || id === to;
    const prev = { [from]: null };
    for (let q = [from]; q.length;) {
      const c = q.shift();
      if (c === to) break;
      for (const n of s.sectors[c].warps) if (!(n in prev) && ok(n)) { prev[n] = c; q.push(n); }
    }
    if (!(to in prev)) return null;
    const out = [];
    for (let c = to; c !== from; c = prev[c]) out.unshift(c);
    return out;
  }

  function travel(s, to) {
    const p = path(s, s.sector, to);
    if (!p) return { ok: false, msg: 'No known route.' };
    if (p.length > s.turnsLeft) return { ok: false, msg: 'Not enough turns.' };
    for (const step of p) {
      const r = warp(s, step);
      if (!r.ok || s.encounter || s.over) break;
    }
    return { ok: true };
  }

  function resolve(s, choice) {
    const e = s.encounter;
    if (!e) return { ok: false, msg: 'Nothing to resolve.' };
    if (!['fight', 'pay', 'flee'].includes(choice)) return { ok: false, msg: 'Unknown choice.' };
    const str = e.strength;
    if (choice === 'fight') {
      if (!s.fighters) return { ok: false, msg: 'You have no fighters.' };
      if (s.fighters * (0.7 + rand(s) * 0.6) >= str) {
        const lost = Math.min(s.fighters - 1, Math.ceil(str * 0.4));
        const loot = str * 30;
        s.fighters -= Math.max(0, lost); s.credits += loot;
        log(s, 'You beat the pirates. Lost ' + Math.max(0, lost) + ' fighters, salvaged ' + loot + ' credits.', 'good');
      } else {
        s.fighters = Math.max(0, s.fighters - Math.ceil(str * 0.8));
        const fine = Math.floor(s.credits * 0.1);
        s.credits -= fine;
        for (const g of GOODS) { const c = Math.floor(s.cargo[g] / 2); s.cargo[g] -= c; s.paid[g] *= 0.5; }
        log(s, 'The pirates win. You lose fighters, ' + fine + ' credits and half your cargo.', 'bad');
      }
    } else if (choice === 'pay') {
      const toll = str * 25;
      if (s.credits < toll) return { ok: false, msg: 'You cannot afford ' + toll + '.' };
      s.credits -= toll;
      log(s, 'You pay the pirates ' + toll + ' credits and they let you go.');
    } else if (choice === 'flee') {
      s.turnsLeft--;
      if (rand(s) < 0.5) {
        s.sector = s.prev;
        log(s, 'You slip away back to sector ' + (s.prev + 1) + '.');
      } else {
        for (const g of GOODS) { const c = Math.floor(s.cargo[g] / 3); s.cargo[g] -= c; s.paid[g] *= 2 / 3; }
        log(s, 'You are caught fleeing and lose a third of your cargo.', 'bad');
      }
    }
    s.encounter = null;
    snapshot(s);
    if (s.turnsLeft <= 0) finish(s);
    return { ok: true };
  }

  // ---------- Stardock shop ----------

  const holdCost = s => 150 + 15 * s.holds;
  const FIGHTER_COST = 40;

  function buyHolds(s) {
    if (s.sector !== 0 || s.encounter || s.over) return { ok: false, msg: 'Only at Stardock.' };
    const c = holdCost(s);
    if (s.credits < c) return { ok: false, msg: 'Not enough credits.' };
    s.credits -= c; s.holds += 5;
    log(s, 'Added 5 holds for ' + c + '.');
    return { ok: true };
  }

  function buyFighters(s, n) {
    if (s.sector !== 0 || s.encounter || s.over) return { ok: false, msg: 'Only at Stardock.' };
    if (!Number.isInteger(n) || n < 1 || n > 100000) return { ok: false, msg: 'Bad amount.' };
    const c = n * FIGHTER_COST;
    if (s.credits < c) return { ok: false, msg: 'Not enough credits.' };
    s.credits -= c; s.fighters += n;
    log(s, 'Bought ' + n + ' fighters for ' + c + '.');
    return { ok: true };
  }

  function finish(s) {
    s.over = true;
    s.encounter = null;
    s.score = Math.floor(s.credits);
    log(s, 'Out of turns. Final credits: ' + s.score + '.', 'good');
  }

  function retire(s) { if (!s.over) finish(s); }

  const api = {
    GOODS, BASE, LABEL, START_TURNS, W, H, newGame, warp, travel, path, resolve, trade, quote, maxQty,
    unitPrice, buyHolds, buyFighters, holdCost, FIGHTER_COST, retire, cargoUsed, dist,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WT = api;
})(typeof window !== 'undefined' ? window : globalThis);
