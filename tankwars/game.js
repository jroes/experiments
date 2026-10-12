/*
 * Tank Wars: rules. Original artillery duel game, no DOM here so it runs in node too.
 * State is plain JSON for localStorage saves. All randomness comes from the state (rand), and only
 * exactly-rounded arithmetic is used (+ - * / sqrt), so a seed gives the same hills and the same shots everywhere.
 */
(function (root) {
  'use strict';

  const H = 180;                    // the world is s.w columns of ground and H high. y goes up.
  const DEFAULT_W = 480, MIN_W = 240, MAX_W = 800;
  const SIZES = { small: 320, normal: 480, wide: 640 };
  const GRAV = 0.08, SPEED = 0.06;  // per step; a shell leaves at power * speed, and speed grows with the width so every map can be crossed
  const WIND_PUSH = 0.0008;         // sideways push per wind point
  const MAX_STEPS = 6000;
  const START_MONEY = 1000;
  const SHIELD_HP = 60;
  const COLORS = ['#ff6b6b', '#5ee0b0', '#ffd24a', '#7aa8ff'];
  const NAMES = ['Red', 'Green', 'Gold', 'Blue'];

  const WEAPONS = {
    shell:  { name: 'Shell',      cost: 0,   r: 14, dmg: 45,  shots: 1, blurb: 'Free. Always have one.' },
    big:    { name: 'Big shell',  cost: 200, r: 26, dmg: 80,  shots: 1, blurb: 'Bigger hole, more damage.' },
    triple: { name: 'Triple',     cost: 300, r: 12, dmg: 40,  shots: 3, blurb: 'Three shells, fanned out a few degrees.' },
    nuke:   { name: 'Nuke',       cost: 900, r: 50, dmg: 130, shots: 1, blurb: 'Huge. Keep your distance.' },
    dirt:   { name: 'Dirt bomb',  cost: 100, r: 24, dmg: 0,   shots: 1, blurb: 'Piles up dirt. Bury a tank or build a wall.' },
  };
  const ITEMS = { ...Object.fromEntries(Object.keys(WEAPONS).filter(k => k !== 'shell').map(k => [k, WEAPONS[k]])), shield: { name: 'Shield', cost: 250, blurb: 'Soaks up ' + SHIELD_HP + ' damage next round.' } };
  const ITEM_KEYS = Object.keys(ITEMS);
  const AI_LEVELS = { 1: { name: 'Easy', errA: 9, errP: 14 }, 2: { name: 'Medium', errA: 2, errP: 4 }, 3: { name: 'Hard', errA: 0.6, errP: 1.2 } };

  // all in-game randomness comes from the state, so a game can be replayed exactly
  function rand(s) {
    const a = (s.rng = (s.rng + 0x6D2B79F5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const randInt = (s, lo, hi) => lo + Math.floor(rand(s) * (hi - lo + 1)); // lo..hi inclusive
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); // never o[userKey]: 'constructor' is a key too

  // sine of an angle in degrees using a plain series: Math.sin may differ in the last bit between browsers
  function sinD(deg) {
    let d = deg % 360; if (d < 0) d += 360;
    let sign = 1;
    if (d > 180) { d = 360 - d; sign = -1; }
    if (d > 90) d = 180 - d;
    const x = d * 0.017453292519943295, x2 = x * x;
    let term = x, sum = x;
    for (let k = 1; k <= 7; k++) { term = -term * x2 / ((2 * k) * (2 * k + 1)); sum += term; }
    return sign * sum;
  }
  const cosD = deg => sinD(90 - deg);

  // ---------- the hills ----------
  const TERRAINS = ['rolling', 'mountains', 'valley', 'plateaus', 'mounds'];

  // smooth curve through control points spread over the whole width. sharp = steeper steps between them.
  function curve(pts, w, sharp) {
    const n = pts.length - 1, out = new Array(w);
    for (let x = 0; x < w; x++) {
      const f = x / (w - 1) * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
      let u = t * t * (3 - 2 * t); // smoothstep, no trig
      if (sharp) u = u * u * (3 - 2 * u);
      out[x] = pts[i] * (1 - u) + pts[i + 1] * u;
    }
    return out;
  }

  // Each round picks one of several kinds of land at random, so no angle and power keeps working from round to round.
  function makeHeights(s) {
    const w = s.w, k = w / 320, kind = TERRAINS[randInt(s, 0, TERRAINS.length - 1)];
    const rnd = (lo, hi) => randInt(s, lo, hi);
    const points = (count, lo, hi) => Array.from({ length: Math.max(3, Math.round(count * k)) + 1 }, () => rnd(lo, hi));
    let h, jitter = 3;
    if (kind === 'rolling') h = curve(points(rnd(5, 8), 30, 120), w, false);
    else if (kind === 'mountains') { h = curve(points(rnd(8, 13), 20, 140), w, false); jitter = 6; }
    else if (kind === 'valley') {
      const rim = rnd(80, 130), floor = rnd(12, 40), wob = curve(points(rnd(5, 7), -14, 14), w, false);
      h = wob.map((v, x) => { const d = (x / (w - 1)) * 2 - 1; return floor + (rim - floor) * d * d + v; });
    } else if (kind === 'plateaus') {
      const levels = [rnd(25, 45), rnd(60, 85), rnd(95, 125)];
      h = curve(Array.from({ length: Math.max(3, Math.round(rnd(4, 7) * k)) + 1 }, () => levels[rnd(0, 2)]), w, true);
    } else { // mounds: a low plain with a few hills sticking up
      const base = rnd(30, 55);
      h = new Array(w).fill(base);
      for (let m = rnd(3, 5) + (k > 1.4 ? 2 : 0); m > 0; m--) {
        const cx = rnd(0, w - 1), wd = rnd(28, 70) * k, ht = rnd(25, 85);
        for (let x = Math.max(0, Math.floor(cx - wd)); x <= Math.min(w - 1, Math.ceil(cx + wd)); x++) { const u = 1 - Math.abs(x - cx) / wd; h[x] += ht * u * u * (3 - 2 * u); }
      }
    }
    h = h.map(v => Math.round(v + (rand(s) - 0.5) * jitter));
    // smooth the jitter so slopes stay climbable
    for (let pass = 0; pass < 2; pass++) for (let x = 1; x < w - 1; x++) h[x] = Math.round((h[x - 1] + h[x] * 2 + h[x + 1]) / 4);
    s.terrain = kind;
    return h.map(v => clamp(v, 8, H - 40));
  }

  // Tanks go anywhere on the map, as long as they are not too close together, so the distance between them changes every round.
  function placeTanks(s) {
    const n = s.players.length, w = s.w, margin = 24;
    const gap = Math.max(36, Math.floor(w * 0.55 / n));
    let xs = null;
    for (let tries = 0; tries < 300 && !xs; tries++) {
      const c = Array.from({ length: n }, () => randInt(s, margin, w - margin));
      if (c.every((x, i) => c.every((y, j) => i === j || Math.abs(x - y) >= gap))) xs = c;
    }
    if (!xs) xs = Array.from({ length: n }, (_, i) => Math.round(margin + (w - 2 * margin) * (i + 0.5) / n));
    s.players.forEach((p, i) => {
      const x = xs[i];
      p.x = x; p.y = s.heights[x];
      for (let k = x - 6; k <= x + 6; k++) s.heights[k] = p.y; // a flat spot to sit on
    });
  }

  // ---------- setting up ----------
  function newGame(opts) {
    opts = opts || {};
    const seed = (opts.seed === undefined ? Math.floor(Math.random() * 1e9) : opts.seed) | 0; // the one allowed random: the default seed
    const w = clamp(Math.round(Number(opts.width)) || DEFAULT_W, MIN_W, MAX_W);
    const specs = (opts.players && opts.players.length ? opts.players : [{}, { ai: 2 }]).slice(0, 4);
    const s = {
      version: 1, seed, rng: seed ^ 0x51ed270b, w, speed: SPEED * Math.sqrt(w / 320), shots: 0, terrain: 'rolling', round: 1, rounds: clamp(opts.rounds | 0 || 5, 1, 15),
      wind: 0, turn: 0, phase: 'aim', heights: [],
      players: specs.map((p, i) => ({
        id: i, name: String(p.name || NAMES[i]).slice(0, 12), ai: AI_LEVELS[p.ai] ? p.ai : 0, color: COLORS[i],
        x: 0, y: 0, hp: 100, angle: 90, power: 50, weapon: 'shell', shield: 0,
        inv: { big: 0, triple: 0, nuke: 0, dirt: 0, shield: 0 }, money: START_MONEY, wins: 0, alive: true, lastRoundGain: 0,
      })),
      log: [], over: false,
    };
    startRound(s);
    return s;
  }

  function log(s, text, kind) {
    s.log.unshift({ round: s.round, text, kind: kind || 'info' });
    if (s.log.length > 60) s.log.length = 60;
  }

  function startRound(s) {
    s.heights = makeHeights(s);
    for (const p of s.players) {
      p.hp = 100; p.alive = true; p.weapon = 'shell'; p.lastRoundGain = 0;
      p.shield = 0;
      if (p.inv.shield > 0) { p.inv.shield--; p.shield = SHIELD_HP; }
    }
    placeTanks(s);
    for (const p of s.players) { p.angle = randInt(s, 25, 155); p.power = randInt(s, 30, 80); } // a different starting aim every round
    s.wind = randInt(s, -9, 9);
    s.turn = randInt(s, 0, s.players.length - 1);
    s.phase = 'aim';
    log(s, 'Round ' + s.round + ' of ' + s.rounds + '.', 'info');
  }

  // ---------- flying ----------
  function barrelStart(p, angle) { return { x: p.x + cosD(angle) * 7, y: p.y + 5 + sinD(angle) * 7 }; }

  function tankAt(s, x, y, ignore) {
    for (const t of s.players) {
      if (!t.alive || t.id === ignore) continue;
      if (Math.abs(x - t.x) <= 5 && y >= t.y - 1 && y <= t.y + 7) return t;
    }
    return null;
  }

  // One shell, step by step. Pure: it only reads the state. Returns the path and where it came down.
  function flight(s, shooter, angle, power) {
    const p = s.players[shooter], st = barrelStart(p, angle);
    let x = st.x, y = st.y;
    const v = power * s.speed;
    let vx = cosD(angle) * v, vy = sinD(angle) * v;
    const ax = s.wind * WIND_PUSH;
    const path = [{ x, y }];
    for (let i = 0; i < MAX_STEPS; i++) {
      x += vx; y += vy; vy -= GRAV; vx += ax;
      path.push({ x, y });
      if (x < 0 || x >= s.w) return { path, hit: { kind: 'out', x, y } };
      const t = tankAt(s, x, y, -1);
      if (t) return { path, hit: { kind: 'tank', x, y, tank: t.id } };
      if (y <= s.heights[Math.floor(x)]) return { path, hit: { kind: 'ground', x, y: s.heights[Math.floor(x)] } };
      if (y < -50) return { path, hit: { kind: 'out', x, y } };
    }
    return { path, hit: { kind: 'out', x, y } };
  }

  function crater(s, cx, cy, r) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(s.w - 1, Math.ceil(cx + r)); x++) {
      const dx = x - cx;
      if (Math.abs(dx) > r) continue;
      const d = Math.sqrt(r * r - dx * dx), bottom = cy - d, top = cy + d;
      if (s.heights[x] <= bottom) continue;
      s.heights[x] = s.heights[x] <= top ? Math.max(0, Math.floor(bottom)) : Math.max(0, Math.floor(s.heights[x] - 2 * d));
    }
  }
  function mound(s, cx, r) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(s.w - 1, Math.ceil(cx + r)); x++) {
      const dx = x - cx;
      if (Math.abs(dx) > r) continue;
      s.heights[x] = Math.min(H - 10, s.heights[x] + Math.floor(Math.sqrt(r * r - dx * dx)));
    }
  }

  const alive = s => s.players.filter(p => p.alive);

  function hurt(s, victim, amount, by, events) {
    if (amount <= 0 || !victim.alive) return 0;
    let a = amount;
    if (victim.shield > 0) { const soak = Math.min(victim.shield, a); victim.shield -= soak; a -= soak; }
    a = Math.min(a, victim.hp);
    victim.hp -= a;
    events.damage.push({ player: victim.id, amount: a, by });
    if (by !== undefined && by !== victim.id && a > 0) s.players[by].money += a * 4;
    if (victim.hp <= 0) {
      victim.alive = false;
      events.killed.push(victim.id);
      if (by !== undefined && by !== victim.id) { s.players[by].money += 300; log(s, s.players[by].name + ' destroyed ' + victim.name + '.', 'good'); }
      else log(s, victim.name + ' blew themselves up.', 'bad');
    }
    return a;
  }

  function settle(s, events) { // after the ground changes: tanks drop or rise to meet it
    for (const t of s.players) {
      if (!t.alive) continue;
      const ground = s.heights[t.x];
      if (ground < t.y) {
        const drop = t.y - ground;
        t.y = ground;
        events.falls.push({ player: t.id, from: t.y + drop, to: ground });
        if (drop > 6) hurt(s, t, Math.floor((drop - 6) / 2) + 1, t.id, events);
      } else t.y = ground;
    }
  }

  // The current player fires. Returns what happened so the page can show it.
  function fire(s) {
    if (s.phase !== 'aim' || s.over) return null;
    const p = s.players[s.turn];
    let wname = p.weapon;
    if (wname !== 'shell' && !(has(WEAPONS, wname) && p.inv[wname] > 0)) wname = 'shell';
    if (wname !== 'shell') p.inv[wname]--;
    p.weapon = p.inv[wname] > 0 || wname === 'shell' ? wname : 'shell';
    s.shots++;
    const w = WEAPONS[wname];
    const events = { shooter: p.id, weapon: wname, shots: [], blasts: [], damage: [], falls: [], killed: [] };
    const angles = w.shots === 3 ? [p.angle - 6, p.angle, p.angle + 6] : [p.angle];
    for (const ang of angles) {
      const f = flight(s, p.id, clamp(ang, 0, 180), p.power);
      const shot = { path: f.path, hit: f.hit, blast: null };
      events.shots.push(shot);
      if (f.hit.kind === 'out') continue;
      const cx = f.hit.x, cy = f.hit.y;
      if (wname === 'dirt') { mound(s, cx, w.r); shot.blast = { x: cx, y: cy, r: w.r, kind: 'dirt' }; events.blasts.push(shot.blast); }
      else {
        shot.blast = { x: cx, y: cy, r: w.r, kind: wname };
        events.blasts.push(shot.blast);
        for (const t of s.players) {
          if (!t.alive) continue;
          const dx = t.x - cx, dy = t.y + 3 - cy, d = Math.sqrt(dx * dx + dy * dy);
          if (d <= w.r + 4) hurt(s, t, Math.max(1, Math.round(w.dmg * (1 - d / (w.r + 4)))), p.id, events);
        }
        crater(s, cx, cy, w.r);
      }
      settle(s, events);
    }
    if (!events.shots.some(sh => sh.hit.kind !== 'out')) log(s, p.name + ' missed the whole map.', 'info');
    advance(s);
    return events;
  }

  function advance(s) {
    const left = alive(s);
    if (left.length <= 1) {
      s.phase = 'roundover';
      if (left.length === 1) {
        left[0].wins++; left[0].money += 600; left[0].lastRoundGain += 600;
        log(s, left[0].name + ' wins round ' + s.round + '.', 'good');
      } else log(s, 'Round ' + s.round + ' is a draw.', 'info');
      return;
    }
    let n = s.turn;
    do { n = (n + 1) % s.players.length; } while (!s.players[n].alive);
    s.turn = n;
    s.wind = clamp(s.wind + randInt(s, -2, 2), -10, 10);
  }

  // Between rounds. Returns false when the game is over.
  function nextRound(s) {
    if (s.phase !== 'roundover') return s.phase !== 'over';
    if (s.round >= s.rounds) { s.phase = 'over'; s.over = true; return false; }
    for (const p of s.players) if (p.ai) aiShop(s, p);
    s.round++;
    s.phase = 'shop';
    return true;
  }
  function beginRound(s) { if (s.phase === 'shop') startRound(s); }

  function buy(s, pi, item) {
    const p = s.players[pi], it = has(ITEMS, item) ? ITEMS[item] : null;
    if (!p || !it || s.phase !== 'shop' || p.money < it.cost) return false;
    p.money -= it.cost; p.inv[item]++;
    return true;
  }

  // ---------- the computer players ----------
  function aiShop(s, p) {
    // spend most of it: a shield, then something big, then the rest
    const plan = p.ai === 1 ? ['big', 'shield', 'dirt'] : p.ai === 2 ? ['shield', 'big', 'triple', 'big'] : ['shield', 'nuke', 'big', 'triple', 'big', 'shield'];
    for (const item of plan) if (p.money - ITEMS[item].cost >= 150 && p.inv[item] < 3) { p.money -= ITEMS[item].cost; p.inv[item]++; }
  }

  // Tries every angle and power on the real flight code and keeps the one that lands nearest the target.
  function aiAim(s) {
    const me = s.players[s.turn], lvl = AI_LEVELS[me.ai] || AI_LEVELS[2];
    const foes = alive(s).filter(t => t.id !== me.id);
    if (!foes.length) return null;
    foes.sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x) || a.id - b.id);
    const target = foes[0];
    let best = null;
    const tx = target.x, ty = target.y + 3;
    const score = (angle, power) => {
      const f = flight(s, me.id, angle, power);
      if (f.hit.kind === 'out') return null;
      let d = f.hit.kind === 'tank' && f.hit.tank === target.id ? 0 : Math.sqrt((f.hit.x - tx) * (f.hit.x - tx) + (f.hit.y - ty) * (f.hit.y - ty));
      if (f.hit.kind === 'tank' && f.hit.tank === me.id) d += 1000;
      const mx = f.hit.x - me.x, my = f.hit.y - (me.y + 3);
      if (Math.sqrt(mx * mx + my * my) < 24) d += 500; // too close to myself
      return d;
    };
    const consider = (angle, power) => {
      const d = score(angle, power);
      if (d !== null && (!best || d < best.d)) best = { d, angle, power };
    };
    for (let angle = 5; angle <= 175; angle += 1) for (let power = 12; power <= 100; power += 2) consider(angle, power);
    if (best) { // then look closely around the best one
      const c = best;
      for (let angle = Math.max(0, c.angle - 1); angle <= Math.min(180, c.angle + 1); angle++) for (let power = Math.max(1, c.power - 2); power <= Math.min(100, c.power + 2); power++) consider(angle, power);
    }
    if (!best) return null;
    const angle = clamp(Math.round(best.angle + (rand(s) - 0.5) * 2 * lvl.errA), 0, 180);
    const power = clamp(Math.round(best.power + (rand(s) - 0.5) * 2 * lvl.errP), 1, 100);
    let weapon = 'shell';
    const far = Math.abs(target.x - me.x);
    if (me.inv.nuke > 0 && far > 90) weapon = 'nuke';
    else if (me.inv.big > 0) weapon = 'big';
    else if (me.inv.triple > 0) weapon = 'triple';
    return { angle, power, weapon, target: target.id };
  }
  function aiPlay(s) { // aim for the current computer player; the page fires after showing the aim
    const a = aiAim(s), p = s.players[s.turn];
    if (!a) return null;
    p.angle = a.angle; p.power = a.power; p.weapon = a.weapon;
    return a;
  }

  // ---------- helpers for the page and the tests ----------
  const standings = s => s.players.slice().sort((a, b) => b.money - a.money || b.wins - a.wins || a.id - b.id);

  // Anything read back from localStorage goes through here first.
  function validState(o) {
    const isInt = n => Number.isInteger(n);
    if (!o || typeof o !== 'object' || o.version !== 1) return null;
    // games saved before the maps got wider have no width, speed, shot count or terrain: they were 320 wide
    if (o.w === undefined) { o.w = 320; o.speed = SPEED; o.shots = 0; o.terrain = 'rolling'; }
    if (!isInt(o.w) || o.w < MIN_W || o.w > MAX_W || typeof o.speed !== 'number' || !(o.speed > 0.02 && o.speed < 0.3) || !isInt(o.shots) || o.shots < 0 || !TERRAINS.includes(o.terrain)) return null;
    if (!isInt(o.seed) || !isInt(o.rng) || !isInt(o.round) || !isInt(o.rounds) || o.round < 1 || o.rounds < 1 || o.round > o.rounds) return null;
    if (!Array.isArray(o.heights) || o.heights.length !== o.w || !o.heights.every(v => isInt(v) && v >= 0 && v <= H)) return null;
    if (!Array.isArray(o.players) || o.players.length < 2 || o.players.length > 4) return null;
    if (!isInt(o.wind) || Math.abs(o.wind) > 10 || !isInt(o.turn) || o.turn < 0 || o.turn >= o.players.length) return null;
    if (!['aim', 'roundover', 'shop', 'over'].includes(o.phase)) return null;
    for (const [i, p] of o.players.entries()) {
      if (!p || p.id !== i || typeof p.name !== 'string' || p.name.length > 12) return null;
      if (![0, 1, 2, 3].includes(p.ai)) return null;
      if (![p.x, p.y, p.hp, p.angle, p.power, p.shield, p.money, p.wins, p.lastRoundGain].every(isInt)) return null;
      if (p.x < 6 || p.x > o.w - 7 || p.y < 0 || p.y > H || p.hp < 0 || p.hp > 100 || p.angle < 0 || p.angle > 180 || p.power < 1 || p.power > 100) return null;
      if (p.money < 0 || p.wins < 0 || p.shield < 0 || typeof p.alive !== 'boolean' || typeof p.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.color)) return null;
      if (!has(WEAPONS, p.weapon)) return null;
      if (!p.inv || typeof p.inv !== 'object') return null;
      for (const k of ITEM_KEYS) if (!isInt(p.inv[k]) || p.inv[k] < 0 || p.inv[k] > 99) return null;
    }
    if (!Array.isArray(o.log)) o.log = [];
    o.log = o.log.filter(l => l && typeof l.text === 'string').slice(0, 60).map(l => ({ round: isInt(l.round) ? l.round : 1, text: l.text.slice(0, 120), kind: ['info', 'good', 'bad'].includes(l.kind) ? l.kind : 'info' }));
    o.over = o.phase === 'over';
    return o;
  }

  // A short fingerprint of everything that matters (not the log), so two copies of an online game can tell if they have drifted apart.
  function hashState(s) {
    const text = JSON.stringify(s, (k, v) => (k === 'log' ? undefined : v));
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b + c, 0x5bd1e995) ^ (b >>> 13); }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }

  const api = { H, DEFAULT_W, MIN_W, MAX_W, SIZES, TERRAINS, GRAV, SPEED, hashState, WEAPONS, ITEMS, ITEM_KEYS, AI_LEVELS, COLORS, NAMES, START_MONEY, SHIELD_HP,
    newGame, startRound, flight, fire, advance, nextRound, beginRound, buy, aiAim, aiPlay, aiShop, standings, validState, sinD, cosD, rand, alive, crater, mound, barrelStart };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TW = api;
})(typeof window !== 'undefined' ? window : globalThis);
