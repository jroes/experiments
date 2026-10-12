/*
 * Tank Wars with friends, without a game server (lockstep), the same way Sector Dominion does it.
 *
 * Every player's browser keeps its own copy of the game. The rules are deterministic (seeded, exact arithmetic), so if everyone
 * plays the same shots in the same order, every copy ends up identical. The shared key/value store (elf-punch/) carries the shots:
 *
 *   meta            create-only. Seed, map width, rounds and who sits where. Everything else follows from it.
 *   m-<n>-<seat>    create-only. Shot number n, by that seat: angle, power, weapon, and a hash of the shooter's game.
 *                   Or { ai: 1 }: "the computer plays this seat's turn" (when a friend has gone quiet).
 *   b-<round>-<seat> create-only. What that seat bought in the shop before the round.
 *   p-<seat>        overwritten every 15 s: "I am here".
 *
 * Seats in keys and invites are numbered from 1; inside the game they count from 0.
 * Computer players need no entries: every copy works out their shots itself, the same way.
 * The store is the source of truth: a new device (or a refresh) rebuilds the whole game by replaying the shots.
 * There are no accounts, so anyone who has the room name can write to it. This is for friends.
 */
(function (root) {
  'use strict';
  const T = root.TW || require('./game.js');
  const S = root.GameStore || require('../shared/store.js');

  const RULES = 1;                 // bump if a change would make an old game replay differently
  const ONLINE_SECS = 45;          // a seat counts as online if its page checked in this recently
  const WINDOW = 14;               // how many shots ahead to look for in one read (when replaying a long game)
  const HASH_RE = /^[0-9a-f]{16}$/;
  const isInt = Number.isInteger;
  const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); // never o[userKey]

  const moveKey = (shot, seat) => 'm-' + shot + '-' + (seat + 1);
  const shopKey = (round, seat) => 'b-' + round + '-' + (seat + 1);
  const presenceKey = seat => 'p-' + (seat + 1);

  // ----- everything read back from the store is untrusted -----
  function cleanMeta(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || raw.game !== 'tankwars' || raw.rules !== RULES) return null;
    if (!isInt(raw.seed) || !isInt(raw.width) || raw.width < T.MIN_W || raw.width > T.MAX_W || !isInt(raw.rounds) || raw.rounds < 1 || raw.rounds > 15) return null;
    if (!Array.isArray(raw.players) || raw.players.length < 2 || raw.players.length > 4) return null;
    const players = [];
    for (const p of raw.players) {
      if (!p || typeof p !== 'object' || !isInt(p.ai) || p.ai < 0 || p.ai > 3 || typeof p.name !== 'string' || p.name.length > 12) return null;
      players.push({ name: p.name, ai: p.ai });
    }
    if (players.filter(p => p.ai === 0).length < 2) return null; // an online game has at least two people
    return { v: 1, game: 'tankwars', rules: RULES, seed: raw.seed, width: raw.width, rounds: raw.rounds, players };
  }

  function cleanMove(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
    const h = typeof raw.h === 'string' && HASH_RE.test(raw.h) ? raw.h : null;
    if (raw.ai === 1) return { ai: true, h: null };
    if (!isInt(raw.a) || raw.a < 0 || raw.a > 180 || !isInt(raw.p) || raw.p < 1 || raw.p > 100) return null;
    if (typeof raw.w !== 'string' || !(raw.w === 'shell' || has(T.WEAPONS, raw.w))) return null;
    return { ai: false, a: raw.a, p: raw.p, w: raw.w, h };
  }

  function cleanShop(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.buy) || raw.buy.length > 30) return null;
    for (const it of raw.buy) if (!has(T.ITEMS, it)) return null;
    return { buy: raw.buy.slice() };
  }

  // An invite is the room plus the seat's number: 16 letters and digits, then one digit. Accepts a whole link too.
  const inviteCode = (room, seat) => room + (seat + 1);
  function parseInvite(text) {
    const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    const code = t.slice(t.lastIndexOf('#') + 1).replace(/^join=/, '');
    const m = /^([a-z0-9]{16})([1-4])$/.exec(code);
    return m ? { room: m[1], seat: +m[2] - 1 } : null;
  }

  const snapshot = s => ({ heights: s.heights.slice(), players: s.players.map(p => ({ ...p })) });

  class Session {
    constructor(o) {
      this.server = o.server; this.room = o.room; this.seat = o.seat; this.meta = o.meta;
      this.s = T.newGame({ seed: o.meta.seed, width: o.meta.width, rounds: o.meta.rounds, players: o.meta.players });
      this.cache = new Map();       // key -> a checked entry, kept for good (entries never change once written)
      this.presence = {};           // seat -> server time of its last check-in
      this.now = null;              // the server's clock at the last read
      this.desync = false;          // two copies disagreed about the game
      this._readFor = null;
      this._chain = Promise.resolve();
    }

    static async create(o) {
      const seed = isInt(o.seed) ? o.seed : Math.floor(Math.random() * 1e9);
      const meta = cleanMeta({ v: 1, game: 'tankwars', rules: RULES, seed, width: o.width === undefined ? T.DEFAULT_W : o.width, rounds: o.rounds === undefined ? 5 : o.rounds, players: o.players });
      if (!meta) throw new Error('That game cannot be played online. It needs at least two people.');
      const room = S.randomId(16);
      const r = await S.createGame(o.server, room, meta);
      if (r.status !== 201) throw new Error(r.status === 429 ? 'Too many games were started. Try again in a little while.' : 'Could not start the game on the server.');
      return new Session({ server: o.server, room, seat: 0, meta });
    }

    static async join(o) {
      const r = await S.readMeta(o.server, o.room);
      const meta = cleanMeta(r.value);
      if (!meta) throw new Error(r.status === 404 ? 'That game was not found. Games are kept for 60 days after the last move.' : 'Could not read that game.');
      if (!isInt(o.seat) || o.seat < 0 || o.seat >= meta.players.length || meta.players[o.seat].ai !== 0) throw new Error('That link is not for a person in this game.');
      return new Session({ server: o.server, room: o.room, seat: o.seat, meta });
    }

    // one thing at a time: a poll and a shot must never run over each other
    _lock(fn) { const run = this._chain.then(fn, fn); this._chain = run.catch(() => {}); return run; }

    invite(seat) { return inviteCode(this.room, seat); }
    humanSeats() { return this.meta.players.map((p, i) => (p.ai === 0 ? i : -1)).filter(i => i >= 0); }

    // ----- reading -----
    async _read() {
      const s = this.s, keys = [];
      for (const seat of this.humanSeats()) {
        keys.push(presenceKey(seat));
        if (s.phase === 'aim') for (let n = s.shots; n <= s.shots + WINDOW; n++) { const k = moveKey(n, seat); if (!this.cache.has(k)) keys.push(k); }
        if (s.phase === 'shop') { const k = shopKey(s.round, seat); if (!this.cache.has(k)) keys.push(k); }
      }
      const r = await S.readKeys(this.server, this.room, keys);
      if (r.status !== 200) throw new Error('Could not reach the game server.');
      if (Number.isFinite(r.now)) this.now = r.now;
      for (const [k, v] of Object.entries(r.values)) {
        if (k.startsWith('m-')) { const e = cleanMove(v.value); if (e) this.cache.set(k, e); }
        else if (k.startsWith('b-')) { const e = cleanShop(v.value); if (e) this.cache.set(k, e); }
        else if (k.startsWith('p-') && Number.isFinite(v.t)) this.presence[k] = v.t;
      }
    }

    // Looks for a key we need. Reads from the store at most once for each place the game has got to.
    async _find(key) {
      if (this.cache.has(key)) return this.cache.get(key);
      const s = this.s, stamp = s.phase + ':' + s.shots + ':' + s.round;
      if (this._readFor !== stamp) { this._readFor = stamp; await this._read(); }
      return this.cache.get(key) || null;
    }

    // ----- playing -----
    _play(entry) {
      const s = this.s, seat = s.turn, p = s.players[seat];
      const auto = !entry || entry.ai;
      if (auto) { if (!T.aiPlay(s)) p.angle = 90; }
      else {
        p.angle = entry.a; p.power = entry.p; p.weapon = entry.w;
        if (entry.h && entry.h !== T.hashState(s)) this.desync = true; // the shooter's game is not the same as ours
      }
      const aim = { angle: p.angle, power: p.power, weapon: p.weapon };
      const before = snapshot(s); // the ground and tanks as the shell leaves, barrel pointing where it fires
      const ev = T.fire(s);
      return { type: 'shot', seat, ev, before, after: snapshot(s), aim, auto: !!auto };
    }

    _shopApply() {
      const s = this.s;
      for (const seat of this.humanSeats()) for (const it of this.cache.get(shopKey(s.round, seat)).buy) T.buy(s, seat, it);
      T.beginRound(s);
    }

    // Plays everything that can be played now. Returns what happened, in order, so the page can show it.
    //   { type: 'shot', seat, ev, before, after, aim, auto }   a shot (before and after are pictures of the ground and tanks around it)
    //   { type: 'round' }                                the shop closed and a new round began
    //   { type: 'roundover' }                            a round just ended (stops here until nextRound(), unless skipRoundOver)
    // opts.skipRoundOver: carry on through round ends. For rebuilding a game that is already part-way, where there is nobody to show the banner to.
    sync(opts) {
      return this._lock(async () => {
        this._readFor = null;
        await this._read();
        this._readFor = this.s.phase + ':' + this.s.shots + ':' + this.s.round;
        const events = [];
        for (let guard = 0; guard < 2000; guard++) {
          const s = this.s;
          if (s.phase === 'over') break;
          if (s.phase === 'roundover') { events.push({ type: 'roundover' }); if (!(opts && opts.skipRoundOver)) break; T.nextRound(s); continue; }
          if (s.phase === 'aim') {
            const p = s.players[s.turn];
            if (p.ai > 0) { events.push(this._play(null)); continue; }
            const e = await this._find(moveKey(s.shots, s.turn));
            if (!e) break;
            events.push(this._play(e));
            continue;
          }
          if (s.phase === 'shop') {
            let all = true;
            for (const seat of this.humanSeats()) if (!(await this._find(shopKey(s.round, seat)))) all = false;
            if (!all) break;
            this._shopApply();
            events.push({ type: 'round' });
            continue;
          }
          break;
        }
        return events;
      });
    }

    // My shot. Returns { ok: true, event } when it went in, { ok: false } when the slot was already taken
    // (a friend let the computer play it): the next sync() brings that shot in.
    submit(angle, power, weapon) {
      return this._lock(async () => {
        const s = this.s;
        if (s.phase !== 'aim' || s.turn !== this.seat) throw new Error('It is not your turn.');
        const p = s.players[this.seat];
        const a = Math.max(0, Math.min(180, Math.round(Number(angle)))), pw = Math.max(1, Math.min(100, Math.round(Number(power))));
        const w = weapon === 'shell' || (has(T.WEAPONS, weapon) && p.inv[weapon] > 0) ? weapon : 'shell';
        p.angle = a; p.power = pw; p.weapon = w; // the hash is of the game as it will be when the shot is played
        const raw = { v: 1, a, p: pw, w, h: T.hashState(s) };
        const key = moveKey(s.shots, this.seat);
        const r = await S.putOnce(this.server, this.room, key, raw, v => !!cleanMove(v));
        if (r.status === 201 || r.status === 200) { const e = cleanMove(raw); this.cache.set(key, e); return { ok: true, event: this._play(e) }; }
        if (r.status === 409) return { ok: false };
        throw new Error('Could not send your shot. Check the connection and try again.');
      });
    }

    // "The computer plays that turn": for a friend who has gone quiet. Anyone may press it.
    takeOver() {
      return this._lock(async () => {
        const s = this.s;
        if (s.phase !== 'aim' || s.players[s.turn].ai > 0) return false;
        const r = await S.putOnce(this.server, this.room, moveKey(s.shots, s.turn), { v: 1, ai: 1 }, v => !!cleanMove(v));
        return r.status === 201 || r.status === 200 || r.status === 409;
      });
    }

    // What I bought before the round (a list of item names). Nothing changes until everyone's list is in.
    submitShop(items) {
      return this._lock(async () => {
        const s = this.s;
        if (s.phase !== 'shop') throw new Error('The shop is not open.');
        const buy = (Array.isArray(items) ? items : []).filter(it => has(T.ITEMS, it)).slice(0, 30);
        const key = shopKey(s.round, this.seat);
        const r = await S.putOnce(this.server, this.room, key, { v: 1, buy }, v => !!cleanShop(v));
        if (r.status === 201 || r.status === 200) { this.cache.set(key, { buy }); return true; }
        if (r.status === 409) return false; // already sent (maybe from another device)
        throw new Error('Could not send your shopping. Check the connection and try again.');
      });
    }

    // Someone is slow in the shop: shop for them with nothing, so the round can start.
    skipShopper(seat) {
      return this._lock(async () => {
        const s = this.s;
        if (s.phase !== 'shop' || !this.humanSeats().includes(seat)) return false;
        const r = await S.putOnce(this.server, this.room, shopKey(s.round, seat), { v: 1, buy: [] }, v => !!cleanShop(v));
        return r.status === 201 || r.status === 200 || r.status === 409;
      });
    }

    // The round is over and the page has shown it: AI players shop, and the shop opens.
    nextRound() { return this._lock(async () => (this.s.phase === 'roundover' ? T.nextRound(this.s) : this.s.phase !== 'over')); }

    shopped(seat) { return this.cache.has(shopKey(this.s.round, seat)); }

    // ----- who is around -----
    beat() { return S.beat(this.server, this.room, this.seat + 1, this.s.players[this.seat].name).catch(() => null); }
    isOnline(seat) {
      if (seat === this.seat) return true;
      const t = this.presence[presenceKey(seat)];
      return Number.isFinite(t) && this.now !== null && this.now - t <= ONLINE_SECS;
    }
    // Who the game is waiting for: { kind: 'move', seat } or { kind: 'shop', seats: [...] }, or null
    waiting() {
      const s = this.s;
      if (s.phase === 'aim' && s.players[s.turn].ai === 0) return { kind: 'move', seat: s.turn };
      if (s.phase === 'shop') { const seats = this.humanSeats().filter(seat => !this.cache.has(shopKey(s.round, seat))); return seats.length ? { kind: 'shop', seats } : null; }
      return null;
    }
  }

  const api = { RULES, ONLINE_SECS, Session, cleanMeta, cleanMove, cleanShop, parseInvite, inviteCode, moveKey, shopKey, presenceKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TWOnline = api;
})(typeof window !== 'undefined' ? window : globalThis);
