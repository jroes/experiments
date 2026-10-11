/*
 * Game logic for the browser space 4X.
 * No DOM in here, so it can be tested under node.
 * State is plain JSON so it can be saved to localStorage.
 */
(function (root) {
  'use strict';

  const PLAYER = 1;
  const MAX_TECH = 6;
  const TROOPS_PER_TRANSPORT = 5;
  const WIN_SHARE = 0.7;

  const SHIP_ORDER = ['scout', 'frigate', 'cruiser', 'transport'];
  const SHIPS = {
    scout:     { name: 'Scout',     cost: 20,  atk: 1,  hp: 4,  speed: 12 },
    frigate:   { name: 'Frigate',   cost: 50,  atk: 4,  hp: 12, speed: 8 },
    cruiser:   { name: 'Cruiser',   cost: 120, atk: 10, hp: 35, speed: 6 },
    transport: { name: 'Transport', cost: 40,  atk: 0,  hp: 8,  speed: 7 },
  };

  const WORLD_TYPES = {
    capital:      { label: 'Capital',      mult: 1.5 },
    industrial:   { label: 'Industrial',   mult: 1.3 },
    mining:       { label: 'Mining',       mult: 1.2 },
    agricultural: { label: 'Agricultural', mult: 1.0, growth: 1.5 },
    research:     { label: 'Research',     mult: 0.9 },
    barren:       { label: 'Barren',       mult: 0.6 },
  };

  const DIFFICULTY = {
    easy:   { income: 0.8,  attack: 2.0, range: 45 },
    normal: { income: 1.0,  attack: 1.5, range: 65 },
    hard:   { income: 1.25, attack: 1.2, range: 90 },
  };

  const EMPIRE_NAMES = ['Solar Dominion', 'Velari Concord', 'Hadrim League', 'Orzu Syndicate'];

  const SYL_A = ['Ar', 'Bel', 'Cor', 'Dra', 'Eri', 'Fen', 'Gal', 'Hel', 'Ion', 'Jor', 'Kal', 'Lor', 'Mir',
    'Nev', 'Or', 'Pol', 'Quar', 'Rig', 'Syl', 'Tor', 'Ul', 'Vek', 'Wyn', 'Xan', 'Yar', 'Zeph', 'Ast', 'Bor', 'Cyr', 'Del'];
  const SYL_B = ['a', 'on', 'is', 'ia', 'us', 'ar', 'ex', 'ion', 'ara', 'eth', 'os', 'um'];

  // ---------- helpers ----------

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function emptyShips() { return { scout: 0, frigate: 0, cruiser: 0, transport: 0 }; }
  function shipCount(s) { return SHIP_ORDER.reduce((n, t) => n + (s[t] || 0), 0); }
  function shipValue(s) { return SHIP_ORDER.reduce((n, t) => n + (s[t] || 0) * SHIPS[t].cost, 0); }
  function techMult(tech) { return 1 + 0.15 * (tech - 1); }
  function empire(state, id) { return state.empires.find(e => e.id === id); }
  function ownerTech(state, id) { const e = empire(state, id); return e ? e.tech : 1; }

  // game randomness comes from the state so a game can be replayed exactly
  function rand(state) {
    const a = (state.rng = (state.rng + 0x6D2B79F5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // `to` is a list of empire ids who may see the entry; omitted means everyone
  function log(state, text, kind, to) {
    const entry = { turn: state.turn, text, kind: kind || 'info' };
    if (to) entry.to = to;
    state.log.unshift(entry);
    if (state.log.length > 200) state.log.length = 200;
  }

  // ---------- world rules ----------

  function worldDefense(w) { return w.fort + Math.floor(w.pop / 25); }
  function maxTroops(w) { return 3 + Math.floor(w.pop / 15) + 2 * w.fort; }

  function worldIncome(state, w) {
    if (!w.owner) return 0;
    const e = empire(state, w.owner);
    let v = w.pop * 0.5 * WORLD_TYPES[w.type].mult * (1 + 0.1 * (e.tech - 1));
    if (!e.human) v *= DIFFICULTY[state.difficulty].income;
    return v;
  }

  function empireIncome(state, id) {
    let sum = 0;
    for (const w of state.worlds) if (w.owner === id) sum += worldIncome(state, w);
    return Math.floor(sum);
  }

  function researchCost(state, id) {
    const e = empire(state, id);
    const labs = state.worlds.filter(w => w.owner === id && w.type === 'research').length;
    const disc = Math.max(0.5, 1 - 0.1 * labs);
    return Math.round(150 * Math.pow(e.tech, 1.6) * disc);
  }

  function fortifyCost(w) { return 40 * (w.fort + 1); }

  // ---------- new game ----------

  function newGame(opts) {
    opts = opts || {};
    const seed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
    const difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal';
    const count = Math.max(24, Math.min(80, opts.worlds || 40));
    const rnd = mulberry32(seed);
    const humans = Math.max(1, Math.min(4, opts.humans || 1));
    const W = 120, H = 80, MIN_D = 9;

    const worlds = [];
    const names = new Set();
    let tries = 0;
    while (worlds.length < count && tries++ < 20000) {
      const p = { x: 5 + rnd() * (W - 10), y: 5 + rnd() * (H - 10) };
      if (worlds.some(w => dist(w, p) < MIN_D)) continue;
      let name;
      do { name = SYL_A[(rnd() * SYL_A.length) | 0] + SYL_B[(rnd() * SYL_B.length) | 0]; } while (names.has(name));
      names.add(name);
      const r = rnd();
      const type = r < 0.2 ? 'agricultural' : r < 0.4 ? 'mining' : r < 0.55 ? 'industrial'
        : r < 0.7 ? 'research' : 'barren';
      const cap = type === 'barren' ? 15 + Math.floor(rnd() * 25) : 25 + Math.floor(rnd() * 60);
      worlds.push({
        id: worlds.length, name, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        type, cap, pop: Math.max(3, Math.floor(cap * (0.1 + rnd() * 0.4))),
        owner: 0, fort: 0, troops: 0, natives: false, garrison: emptyShips(), queue: [],
      });
    }

    // spread capitals out (farthest-point sampling)
    const caps = [worlds[(rnd() * worlds.length) | 0]];
    while (caps.length < 4) {
      let best = null, bestD = -1;
      for (const w of worlds) {
        if (caps.includes(w)) continue;
        const d = Math.min(...caps.map(c => dist(c, w)));
        if (d > bestD) { bestD = d; best = w; }
      }
      caps.push(best);
    }
    caps.forEach((c, i) => {
      c.owner = i + 1; c.type = 'capital'; c.cap = 100; c.pop = 50; c.fort = 1;
      c.troops = maxTroops(c);
      c.garrison = { scout: 1, frigate: 3, cruiser: 0, transport: 2 };
      // make sure there's something peaceful to grab nearby
      worlds.filter(w => !w.owner).sort((a, b) => dist(a, c) - dist(b, c)).slice(0, 2)
        .forEach(w => { w.protected = true; });
    });
    for (const w of worlds) {
      if (!w.owner && !w.protected && rnd() < 0.3) {
        w.natives = true; w.fort = 1 + Math.floor(rnd() * 2); w.troops = maxTroops(w);
      }
      delete w.protected;
    }

    const empires = caps.map((c, i) => ({
      id: i + 1, name: EMPIRE_NAMES[i], human: i < humans, player: null, credits: 300, tech: 1, alive: true,
    }));

    const state = {
      version: 2, turn: 1, seed, rng: (seed ^ 0x9E3779B9) | 0, difficulty, width: W, height: H,
      worlds, fleets: [], empires, known: {}, ready: {}, log: [], nextFleetId: 1, over: false, winner: null,
    };
    for (const e of empires) if (e.human) {
      log(state, 'Your capital is ' + caps[e.id - 1].name + '. Expand, build, conquer.', 'good', [e.id]);
    }
    refreshKnown(state);
    return state;
  }

  // ---------- visibility ----------

  const WORLD_SIGHT = 30, FLEET_SIGHT = 20;

  function visibleWorlds(state, id) {
    const seen = new Set();
    const src = [];
    for (const w of state.worlds) if (w.owner === id) src.push([w, WORLD_SIGHT]);
    for (const f of state.fleets) if (f.owner === id) src.push([f, FLEET_SIGHT]);
    for (const w of state.worlds) {
      for (const [s, r] of src) if (dist(s, w) <= r) { seen.add(w.id); break; }
    }
    return seen;
  }

  // each human keeps their own memory of what they last saw
  function refreshKnown(state) {
    const out = {};
    for (const e of state.empires) {
      if (!e.human) continue;
      const vis = visibleWorlds(state, e.id), mem = state.known[e.id] || (state.known[e.id] = {});
      for (const id of vis) {
        const w = state.worlds[id];
        mem[id] = { owner: w.owner, pop: Math.floor(w.pop), fort: w.fort, natives: w.natives, seen: state.turn };
      }
      out[e.id] = vis;
    }
    return out;
  }

  function fleetVisibleTo(state, id, f) {
    if (f.owner === id) return true;
    return state.worlds.some(w => w.owner === id && dist(w, f) <= WORLD_SIGHT) ||
      state.fleets.some(g => g.owner === id && dist(g, f) <= FLEET_SIGHT);
  }

  // ---------- player/AI actions ----------

  function build(state, worldId, type) {
    const w = state.worlds[worldId];
    if (!w || !w.owner) return { ok: false, msg: 'Not your world.' };
    if (!SHIPS[type]) return { ok: false, msg: 'Unknown ship.' };
    const e = state.empires[w.owner - 1];
    const cost = SHIPS[type].cost;
    if (e.credits < cost) return { ok: false, msg: 'Not enough credits.' };
    e.credits -= cost;
    w.queue.push(type);
    return { ok: true };
  }

  function fortify(state, worldId) {
    const w = state.worlds[worldId];
    if (!w || !w.owner) return { ok: false, msg: 'Not your world.' };
    const e = state.empires[w.owner - 1];
    if (w.fort >= 5) return { ok: false, msg: 'Fully fortified.' };
    const cost = fortifyCost(w);
    if (e.credits < cost) return { ok: false, msg: 'Not enough credits.' };
    e.credits -= cost; w.fort++;
    return { ok: true };
  }

  function research(state, id) {
    const e = empire(state, id);
    if (e.tech >= MAX_TECH) return { ok: false, msg: 'Tech maxed.' };
    const cost = researchCost(state, id);
    if (e.credits < cost) return { ok: false, msg: 'Not enough credits.' };
    e.credits -= cost; e.tech++;
    return { ok: true };
  }

  function sendFleet(state, empId, fromId, toId, ships) {
    const from = state.worlds[fromId], to = state.worlds[toId];
    if (!from || !to) return { ok: false, msg: 'No such world.' };
    if (from.owner !== empId) return { ok: false, msg: 'Not your world.' };
    if (fromId === toId) return { ok: false, msg: 'Pick another world.' };
    const sent = emptyShips();
    for (const t of SHIP_ORDER) {
      const n = Math.floor(Number(ships && ships[t]));
      sent[t] = Number.isFinite(n) ? Math.max(0, Math.min(n, from.garrison[t])) : 0;
    }
    if (!shipCount(sent)) return { ok: false, msg: 'No ships selected.' };
    for (const t of SHIP_ORDER) from.garrison[t] -= sent[t];
    const speed = Math.min(...SHIP_ORDER.filter(t => sent[t]).map(t => SHIPS[t].speed));
    const f = {
      id: state.nextFleetId++, owner: empId, from: fromId, to: toId,
      x: from.x, y: from.y, ships: sent, speed,
    };
    state.fleets.push(f);
    return { ok: true, fleet: f, eta: Math.ceil(dist(from, to) / speed) };
  }

  function eta(state, f) { return Math.ceil(dist(f, state.worlds[f.to]) / f.speed); }

  // ---------- combat ----------

  function makeUnits(ships, tech) {
    const m = techMult(tech), units = [];
    for (const t of SHIP_ORDER) {
      for (let i = 0; i < (ships[t] || 0); i++) {
        units.push({ t, atk: SHIPS[t].atk * m, hp: SHIPS[t].hp * m });
      }
    }
    return units;
  }

  function sumAtk(units) { return units.reduce((n, u) => n + u.atk, 0); }

  function applyDamage(state, units, dmg) {
    while (dmg > 0 && units.length) {
      const i = (rand(state) * units.length) | 0, u = units[i];
      const dealt = Math.min(dmg, u.hp);
      u.hp -= dealt; dmg -= dealt;
      if (u.hp <= 1e-9) units.splice(i, 1);
    }
  }

  // returns when one side is dead or neither can hurt the other
  function battle(state, att, def) {
    for (let round = 0; round < 200 && att.length && def.length; round++) {
      const a = sumAtk(att), d = sumAtk(def);
      if (a <= 0 && d <= 0) break;
      const da = a * (0.8 + rand(state) * 0.4), dd = d * (0.8 + rand(state) * 0.4);
      applyDamage(state, def, da);
      applyDamage(state, att, dd);
    }
  }

  function countUnits(units) {
    const s = emptyShips();
    for (const u of units) if (u.t !== 'defense') s[u.t]++;
    return s;
  }

  function mergeInto(dst, src) { for (const t of SHIP_ORDER) dst[t] += src[t] || 0; }

  function ownerName(state, id) { return id ? empire(state, id).name : 'natives'; }

  // who gets told about something happening at world w involving fleet f
  function audience(state, f, w, vis) {
    const a = new Set([f.owner]);
    if (w.owner) a.add(w.owner);
    for (const id of Object.keys(vis)) if (vis[id].has(w.id)) a.add(+id);
    return [...a];
  }

  function returnHome(state, f) {
    let home = state.worlds[f.from];
    if (home.owner !== f.owner) {
      const own = state.worlds.filter(w => w.owner === f.owner).sort((a, b) => dist(a, f) - dist(b, f));
      if (!own.length) return false;
      home = own[0];
    }
    f.from = f.to; f.to = home.id;
    return true;
  }

  function arrive(state, f, vis) {
    const w = state.worlds[f.to];
    const aud = audience(state, f, w, vis);
    const who = ownerName(state, f.owner);

    if (w.owner === f.owner) {
      mergeInto(w.garrison, f.ships);
      log(state, 'Fleet arrived at ' + w.name + '.', 'info', [f.owner]);
      return true;
    }

    if (!w.owner && !w.natives) {
      // empty world: colonize if there's a transport, otherwise scouts just look and head home
      if (f.ships.transport > 0) {
        f.ships.transport--;
        w.owner = f.owner; w.pop = Math.max(w.pop, 4); w.troops = 2; w.fort = 0;
        mergeInto(w.garrison, f.ships);
        log(state, who + ' colonized ' + w.name + '.', 'good', aud);
        return true;
      }
      log(state, 'Fleet surveyed ' + w.name + ' (no transport, nothing colonized). Returning.', 'info', [f.owner]);
      return !returnHome(state, f);
    }

    // hostile world: fight
    const attTech = ownerTech(state, f.owner), defTech = ownerTech(state, w.owner);
    const att = makeUnits(f.ships, attTech);
    const def = makeUnits(w.garrison, defTech);
    const D = worldDefense(w);
    if (D > 0) def.push({ t: 'defense', atk: 2 * D * techMult(defTech), hp: 8 * D * techMult(defTech) });
    const startAtt = shipCount(f.ships), startDef = shipCount(w.garrison);

    battle(state, att, def);

    const attLeft = countUnits(att), defLeft = countUnits(def);
    const defenseUp = def.some(u => u.t === 'defense');
    w.garrison = defLeft;

    log(state, 'Battle at ' + w.name + ': ' + who + ' (' + startAtt + ' ships) vs ' + ownerName(state, w.owner) +
      ' (' + startDef + ' ships' + (D ? ', defense ' + D : '') + '). Attacker lost ' +
      (startAtt - shipCount(attLeft)) + ', defender lost ' + (startDef - shipCount(defLeft)) + '.', 'battle', aud);

    f.ships = attLeft;
    if (!att.length) return true; // fleet destroyed

    if (def.length || defenseUp) {
      // stalemate: neither side could finish the other
      return !returnHome(state, f);
    }

    // defenders are down; ground assault
    const T = attLeft.transport * TROOPS_PER_TRANSPORT;
    const G = w.troops;
    if (T > G) {
      const prev = w.owner;
      w.owner = f.owner; w.troops = Math.max(1, T - G); w.pop = Math.max(2, Math.ceil(w.pop * 0.8));
      w.fort = 0; w.queue = []; w.natives = false;
      attLeft.transport = 0;
      mergeInto(w.garrison, attLeft);
      log(state, who + ' captured ' + w.name + (prev ? ' from ' + ownerName(state, prev) : '') + '.', 'good', aud);
      return true;
    }
    w.troops = Math.max(0, G - T);
    attLeft.transport = 0;
    f.ships = attLeft;
    log(state, who + ' ground assault on ' + w.name + ' failed.', 'bad', aud);
    if (!shipCount(attLeft)) return true;
    return !returnHome(state, f);
  }

  // ---------- AI ----------

  function aiTurn(state, e) {
    const diff = DIFFICULTY[state.difficulty];
    const mine = state.worlds.filter(w => w.owner === e.id);
    if (!mine.length) return;

    if (e.credits > researchCost(state, e.id) + 150 && e.tech < MAX_TECH && rand(state) < 0.5) research(state, e.id);

    const targeted = new Set(state.fleets.filter(f => f.owner === e.id).map(f => f.to));
    const colonizable = state.worlds.filter(w => !w.owner && !w.natives && !targeted.has(w.id));
    const inFlightTransports = state.fleets.filter(f => f.owner === e.id)
      .reduce((n, f) => n + f.ships.transport, 0);

    // build
    mine.sort((a, b) => b.pop - a.pop);
    for (const w of mine) {
      if (e.credits < 40) break;
      const haveT = w.garrison.transport + w.queue.filter(t => t === 'transport').length + inFlightTransports;
      const r = rand(state);
      let type = 'frigate';
      if (e.wantTransports && haveT < 6 && r < 0.6) type = 'transport';
      else if (colonizable.length && haveT < 2 && r < 0.5) type = 'transport';
      else if (e.tech >= 2 && e.credits >= 160 && r < 0.65) type = 'cruiser';
      if (e.credits < SHIPS[type].cost) type = 'frigate';
      if (e.credits >= SHIPS[type].cost) build(state, w.id, type);
      if (w.type === 'capital' && w.fort < 3 && e.credits > 300) fortify(state, w.id);
    }

    // dispatch
    e.wantTransports = false;
    for (const w of mine) {
      const g = w.garrison, value = shipValue(g);
      if (value < 120) continue;

      // colonize
      if (g.transport >= 1) {
        const cands = colonizable.filter(c => !targeted.has(c.id) && dist(c, w) <= diff.range)
          .sort((a, b) => dist(a, w) - dist(b, w));
        if (cands.length) {
          const c = cands[0];
          const ships = { scout: 0, frigate: g.frigate > 1 ? 1 : 0, cruiser: 0, transport: 1 };
          if (sendFleet(state, e.id, w.id, c.id, ships).ok) { targeted.add(c.id); continue; }
        }
      }

      // attack
      const warValue = g.scout * SHIPS.scout.cost + g.frigate * SHIPS.frigate.cost + g.cruiser * SHIPS.cruiser.cost;
      if (warValue < 250) continue;
      let best = null, bestScore = Infinity;
      for (const t of state.worlds) {
        if (t.owner === e.id || (!t.owner && !t.natives)) continue;
        const d = dist(t, w);
        if (d > diff.range) continue;
        const defValue = shipValue(t.garrison) + worldDefense(t) * 60;
        const ratio = defValue / Math.max(1, warValue * 0.75);
        if (ratio * diff.attack > 1.5) continue;
        const score = ratio * 100 + d;
        if (score < bestScore) { bestScore = score; best = t; }
      }
      if (!best) continue;
      const need = Math.ceil((best.troops + 1) / TROOPS_PER_TRANSPORT);
      if (g.transport < need) { e.wantTransports = true; continue; }
      const ships = {
        scout: 0,
        frigate: Math.floor(g.frigate * 0.75),
        cruiser: Math.floor(g.cruiser * 0.75),
        transport: need,
      };
      if (ships.frigate + ships.cruiser === 0) continue;
      sendFleet(state, e.id, w.id, best.id, ships);
    }
  }

  // ---------- turn processing ----------

  const humans = state => state.empires.filter(e => e.human);

  function checkEnd(state) {
    for (const e of state.empires) {
      const hasWorld = state.worlds.some(w => w.owner === e.id);
      const hasFleet = state.fleets.some(f => f.owner === e.id);
      if (e.alive && !hasWorld && !hasFleet) {
        e.alive = false;
        log(state, e.name + ' has been eliminated.', e.human ? 'bad' : 'good');
      }
    }
    const people = humans(state).filter(e => e.alive);
    if (!people.length) { state.over = true; state.winner = null; return; }
    for (const e of people) {
      const share = state.worlds.filter(w => w.owner === e.id).length / state.worlds.length;
      if (share >= WIN_SHARE) { state.over = true; state.winner = e.id; return; }
    }
    const ai = state.empires.filter(e => !e.human && e.alive);
    if (!ai.length && people.length === 1) { state.over = true; state.winner = people[0].id; }
  }

  function endTurn(state) {
    if (state.over) return;
    const vis = refreshKnown(state);

    for (const e of state.empires) if (e.alive && !e.human) aiTurn(state, e);

    // movement and arrivals
    const arrived = [];
    for (const f of state.fleets) {
      const t = state.worlds[f.to], d = dist(f, t);
      if (d <= f.speed) { f.x = t.x; f.y = t.y; arrived.push(f); }
      else { f.x += (t.x - f.x) / d * f.speed; f.y += (t.y - f.y) / d * f.speed; }
    }
    for (const f of arrived) {
      if (arrive(state, f, vis)) state.fleets = state.fleets.filter(x => x !== f);
    }

    // economy
    for (const e of state.empires) {
      if (!e.alive) continue;
      e.credits += empireIncome(state, e.id);
    }
    for (const w of state.worlds) {
      if (w.owner) {
        const g = WORLD_TYPES[w.type].growth || 1;
        if (w.pop < w.cap) w.pop = Math.min(w.cap, w.pop + Math.max(0.8, w.pop * 0.07 * g));
        for (const t of w.queue) w.garrison[t]++;
        w.queue = [];
      }
      const mt = maxTroops(w);
      if ((w.owner || w.natives) && w.troops < mt) w.troops++;
    }

    state.turn++;
    state.ready = {};
    checkEnd(state);
    refreshKnown(state);
  }

  // Turn advances once every living human has said they are done.
  function maybeAdvance(state) {
    if (state.over) return false;
    const waiting = humans(state).filter(e => e.alive && !state.ready[e.id]);
    if (waiting.length) return false;
    endTurn(state);
    return true;
  }

  const isInt = n => Number.isInteger(n);

  // The single entry point for player orders. Everything a remote player can do goes through here,
  // so this is where ownership and input checks live.
  function apply(state, empId, cmd) {
    if (state.over) return { ok: false, msg: 'Game is over.' };
    const e = empire(state, empId);
    if (!e || !e.human) return { ok: false, msg: 'Not a player.' };
    if (!e.alive) return { ok: false, msg: 'You are eliminated.' };
    if (!cmd || typeof cmd !== 'object') return { ok: false, msg: 'Bad command.' };
    const own = id => isInt(id) && state.worlds[id] && state.worlds[id].owner === empId;
    // Orders carry the turn they were issued in. A message that arrives after the turn moved on is stale.
    // ready/unready must carry it; verification/TurnSync.tla shows why (a late ready would pre-ready the next turn).
    if (cmd.turn !== undefined && cmd.turn !== state.turn) return { ok: false, msg: 'Turn already moved on.', stale: true };
    if ((cmd.op === 'ready' || cmd.op === 'unready') && cmd.turn !== state.turn) return { ok: false, msg: 'Missing turn.', stale: true };
    switch (cmd.op) {
      case 'build':
        if (!own(cmd.world)) return { ok: false, msg: 'Not your world.' };
        return build(state, cmd.world, cmd.type);
      case 'fortify':
        if (!own(cmd.world)) return { ok: false, msg: 'Not your world.' };
        return fortify(state, cmd.world);
      case 'research':
        return research(state, empId);
      case 'send':
        if (!own(cmd.from) || !isInt(cmd.to) || !state.worlds[cmd.to]) return { ok: false, msg: 'Bad route.' };
        return sendFleet(state, empId, cmd.from, cmd.to, cmd.ships);
      case 'ready': {
        state.ready[empId] = true;
        const advanced = maybeAdvance(state);
        return { ok: true, advanced };
      }
      case 'unready':
        delete state.ready[empId];
        return { ok: true };
      default:
        return { ok: false, msg: 'Unknown command.' };
    }
  }

  // hand an empire over to the AI (player left or was dropped)
  function dropPlayer(state, empId) {
    const e = empire(state, empId);
    if (!e || !e.human) return false;
    e.human = false; e.player = null;
    delete state.ready[empId];
    log(state, e.name + ' is now run by the AI.', 'info');
    if (!state.over) {
      if (!humans(state).some(h => h.alive)) { state.over = true; state.winner = null; }
      else maybeAdvance(state);
    }
    return true;
  }

  const api = {
    PLAYER, MAX_TECH, TROOPS_PER_TRANSPORT, WIN_SHARE, SHIPS, SHIP_ORDER, WORLD_TYPES, DIFFICULTY,
    newGame, endTurn, apply, maybeAdvance, dropPlayer, build, fortify, research, sendFleet, eta,
    visibleWorlds, refreshKnown, fleetVisibleTo, worldDefense, maxTroops, worldIncome, empireIncome,
    researchCost, fortifyCost, techMult, shipCount, shipValue, dist, empire,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Game = api;
})(typeof window !== 'undefined' ? window : globalThis);
