/*
 * Online play without a game server (lockstep).
 *
 * Every player's browser keeps its own copy of the game. During a turn you give orders on your copy and send them to
 * the relay (a write-once message board). When everyone's orders for the turn are on the board, every browser plays the
 * turn itself. The game is deterministic, so all copies stay identical. After each turn every browser posts a hash of its
 * state; if two disagree you get a warning and can rebuild by replaying the board from turn 1.
 *
 * The relay is the source of truth. localStorage is only a cache, so a new device can join with the same invite code.
 */
(function (root) {
  'use strict';
  const G = root.Game || require('./game.js');
  const R = root.Relay || require('../shared/relay.js');

  const clone = x => JSON.parse(JSON.stringify(x));
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
  const ROOM_RE = /^[a-z0-9]{12,32}$/;

  // ----- invite codes: everything a friend needs to join, in one string -----

  function encodeInvite(g) {
    return 'SDO-' + b64(JSON.stringify({
      v: 1, rules: g.rules, relay: g.relay, room: g.room, seat: g.seat, token: g.token,
      humans: g.humans, difficulty: g.difficulty, worlds: g.worlds, seed: g.seed,
    }));
  }

  function decodeInvite(code) {
    try {
      code = String(code).trim().replace(/\s+/g, '');
      if (!code.startsWith('SDO-')) return null;
      const o = JSON.parse(unb64(code.slice(4)));
      const relay = R.cleanBase(o.relay);
      if (!o || o.v !== 1 || !relay || !ROOM_RE.test(o.room) || !TOKEN_RE.test(o.token)) return null;
      if (!Number.isInteger(o.humans) || o.humans < 2 || o.humans > 4) return null;
      if (!Number.isInteger(o.seat) || o.seat < 1 || o.seat > o.humans) return null;
      if (!G.has(G.DIFFICULTY, o.difficulty) || !Number.isInteger(o.worlds) || o.worlds < 24 || o.worlds > 80) return null;
      if (!Number.isInteger(o.seed) || Math.abs(o.seed) > 2147483647) return null;
      if (!Number.isInteger(o.rules)) return null;
      return { relay, room: o.room, seat: o.seat, token: o.token, humans: o.humans, difficulty: o.difficulty, worlds: o.worlds, seed: o.seed, rules: o.rules };
    } catch (e) { return null; }
  }

  // plain-English messages for what the relay can say
  const WORDS = {
    too_many_rooms_from_your_address: 'You have started a lot of games from this connection lately. Try again in a while.',
    daily_room_limit: 'The relay has hit its daily limit for new games. Try again tomorrow.',
    room_rate_limited: 'Too many requests for this game right now. It will catch up in a minute.',
    room_write_rate_limited: 'Too many updates for this game right now. Try again in a minute.',
    rate_limited: 'The relay is busy. Try again in a minute.',
    room_full: 'This game has used up its storage on the relay.',
    too_big: 'That was too big for the relay. Send fewer orders at once.',
    no_such_room: 'The relay does not know this game (it may have expired).',
    turn_not_open: 'That turn is not open yet.',
    bad_token: 'The relay did not accept your seat key.',
  };
  function friendly(r) {
    const code = r && r.data && r.data.error;
    if (code && WORDS[code]) return WORDS[code];
    if (r && r.status === 429) return 'The relay is busy. Try again in a minute.';
    if (r && r.status === 413) return WORDS.too_big;
    return 'The relay said ' + (code || (r && r.status)) + '.';
  }

  const freshBase = g => G.newGame({ seed: g.seed, humans: g.humans, difficulty: g.difficulty, worlds: g.worlds });

  class Session {
    constructor(game, saved) {
      this.game = game;
      this.base = saved ? saved.base : freshBase(game); // the game at the start of the current turn
      this.cmds = saved ? saved.cmds : [];               // my orders so far this turn
      this.sent = saved ? !!saved.sent : false;
      this.desync = saved ? !!saved.desync : false;
      this.waiting = [];                                 // seats we still wait for
      this.entries = {};                                 // orders on the board for this turn
      this.error = null;
      this.working = null;
      this.rebuildWorking();
    }

    get seat() { return this.game.seat; }
    get isHost() { return this.game.seat === 1; }

    toJSON() { return { v: 1, game: this.game, base: this.base, cmds: this.cmds, sent: this.sent, desync: this.desync }; }
    static fromSaved(o) {
      if (!o || o.v !== 1 || !o.game || !o.base || !Array.isArray(o.cmds)) return null;
      const game = decodeInvite(encodeInvite(o.game)); // re-validate
      if (!game) return null;
      game.invites = Array.isArray(o.game.invites) ? o.game.invites.filter(x => typeof x === 'string').slice(0, 4) : undefined;
      if (game.rules !== G.RULES) return null;
      return new Session(game, o);
    }

    // the screen state: the turn start plus my orders so far
    rebuildWorking() {
      this.working = clone(this.base);
      for (const c of this.cmds) G.apply(this.working, this.seat, { ...c, turn: this.working.turn });
      G.refreshKnown(this.working);
    }

    act(cmd) {
      if (this.sent) return { ok: false, msg: 'Orders already sent for this turn.' };
      if (!cmd || cmd.op === 'ready' || cmd.op === 'unready') return { ok: false, msg: 'Use Send orders.' };
      const res = G.apply(this.working, this.seat, { ...cmd, turn: this.working.turn });
      if (res.ok) {
        const c = { ...cmd }; delete c.turn;
        this.cmds.push(c);
        G.refreshKnown(this.working);
      }
      return res;
    }

    // ----- talking to the relay -----

    async submit() {
      if (this.sent) return { ok: true };
      const e = G.empire(this.base, this.seat);
      if (!e.human || !e.alive) return { ok: false, msg: 'You are not an active player.' };
      const code = G.encodeOrders({ v: 1, seat: this.seat, turn: this.base.turn, cmds: this.cmds });
      if (code.length > R.LIMIT_CODE) return { ok: false, msg: 'Too many orders for one turn (the relay takes about 100). Send some next turn.' };
      const g = this.game;
      const r = await R.putOrders(g.relay, g.room, this.base.turn, this.seat, g.token, { code });
      if (r.status === 201 || r.status === 200) { this.sent = true; await this.sync(); return { ok: true }; }
      await this.sync();
      if (r.status === 409) return { ok: false, msg: 'Your orders for this turn were not accepted. The host may have skipped you.' };
      return { ok: false, msg: friendly(r) };
    }

    async hostSkip(seat, ai) {
      if (!this.isHost) return { ok: false, msg: 'Only the host can skip a player.' };
      const g = this.game;
      const r = await R.skip(g.relay, g.room, this.base.turn, seat, g.token, !!ai);
      await this.sync();
      if (r.status === 201 || r.status === 200) return { ok: true };
      return { ok: false, msg: r.status === 409 ? 'They already sent orders.' : friendly(r) };
    }

    // Reads the board and plays every turn that is complete. Safe to call as often as you like.
    async sync() {
      const g = this.game;
      let advanced = 0;
      this.error = null;
      try {
        for (let guard = 0; guard < 500; guard++) {
          const turn = this.base.turn;
          const r = await R.sync(g.relay, g.room, turn);
          if (r.status !== 200) { this.error = friendly(r); break; }
          const { orders, hashes } = r.data;

          const mine = G.hashState(this.base);
          for (const [seat, h] of Object.entries(hashes)) if (+seat !== this.seat && h !== mine) this.desync = true;
          if (!hashes[this.seat]) await R.putHash(g.relay, g.room, turn, this.seat, g.token, mine);

          if (orders[this.seat] && !this.sent) { // I already sent these (another tab or device): adopt them
            this.sent = true;
            const o = orders[this.seat].code ? G.decodeOrders(orders[this.seat].code) : null;
            if (o && o.seat === this.seat && o.turn === turn) { this.cmds = o.cmds; this.rebuildWorking(); }
          }
          this.entries = orders;
          this.waiting = G.missingSeats(this.base, orders);
          if (this.base.over || this.waiting.length) break;

          const next = clone(this.base);
          const res = G.advanceWith(next, orders);
          if (!res.ok || !res.advanced) { this.error = 'Could not play the turn.'; this.desync = true; break; }
          this.base = next; this.cmds = []; this.sent = false; this.rebuildWorking();
          advanced++;
        }
      } catch (e) {
        this.error = e.message || 'Could not reach the relay.';
      }
      return { advanced, waiting: this.waiting, error: this.error };
    }

    // Rebuild the whole game from turn 1 by replaying the board. Used to join, and to recover from a desync.
    async rebuild() {
      const g = this.game;
      this.base = freshBase(g); this.cmds = []; this.sent = false; this.desync = false;
      let from = 1;
      try {
        for (let guard = 0; guard < 400; guard++) {
          const r = await R.range(g.relay, g.room, from, from + 29);
          if (r.status !== 200) { this.error = friendly(r); break; }
          const { orders, hashes } = r.data;
          let stopped = false;
          for (let t = from; t < from + 30; t++) {
            if (this.base.turn !== t) { stopped = true; break; }
            const entries = orders[t] || {};
            if (G.missingSeats(this.base, entries).length) { stopped = true; break; }
            const seen = hashes[t] || {}, mine = G.hashState(this.base);
            for (const h of Object.values(seen)) if (h !== mine) this.desync = true;
            const next = clone(this.base);
            const res = G.advanceWith(next, entries);
            if (!res.ok || !res.advanced) { this.desync = true; stopped = true; break; }
            this.base = next;
          }
          if (stopped || this.base.over || this.base.turn < from + 30) break;
          from += 30;
        }
      } catch (e) { this.error = e.message; }
      this.rebuildWorking();
      await this.sync();
      return { error: this.error, turn: this.base.turn };
    }

    // ----- creating and joining -----

    static async create(opts) {
      const relay = R.cleanBase(opts.relay);
      if (!relay) throw new Error('The relay address must start with https:// (or http://localhost).');
      const humans = opts.humans;
      const room = R.randomId(16), tokens = {}, hashes = {};
      for (let s = 1; s <= humans; s++) { tokens[s] = R.randomId(24, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'); hashes[s] = await R.sha256hex(tokens[s]); }
      const r = await R.create(relay, room, humans, hashes);
      if (r.status !== 201) throw new Error(friendly(r));
      const seed = (R.randomId(6, '0123456789') | 0) * 1000 + (R.randomId(3, '0123456789') | 0);
      const base = { relay, room, humans, difficulty: opts.difficulty, worlds: opts.worlds, seed, rules: G.RULES };
      const game = { ...base, seat: 1, token: tokens[1] };
      game.invites = [];
      for (let s = 2; s <= humans; s++) game.invites.push(encodeInvite({ ...base, seat: s, token: tokens[s] }));
      const session = new Session(game);
      await session.sync();
      return session;
    }

    static async join(code) {
      const game = decodeInvite(code);
      if (!game) throw new Error('That does not look like an invite code. Copy it again in full.');
      if (game.rules !== G.RULES) throw new Error('That game was made with a different version of the rules.');
      const m = await R.meta(game.relay, game.room);
      if (m.status !== 200) throw new Error(m.status === 404 ? 'No game found for that code (it may have expired).' : 'Could not reach the relay.');
      if (m.data.humans !== game.humans) throw new Error('That invite does not match its game.');
      const session = new Session(game);
      await session.rebuild();
      return session;
    }
  }

  const api = { Session, encodeInvite, decodeInvite };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Online = api;
})(typeof window !== 'undefined' ? window : globalThis);
