/*
 * Online play without a game server (lockstep).
 *
 * Every player's browser keeps its own copy of the game. During a turn you give orders on your copy and send them to the
 * shared key/value store (elf-punch/). When everyone's orders for the turn are in, every browser plays the turn itself. The
 * game is deterministic, so all copies stay identical. Each set of orders carries a hash of the sender's game, so if two copies
 * ever disagree you get a warning and can rebuild by replaying the log from turn 1.
 *
 * The store is the source of truth. localStorage is only a cache, so a new device can join with the same invite code.
 * Each game is one namespace with a long random name, and the store will not list keys, so only people holding an invite can
 * find it. There are no accounts, so anyone who has the name can write to it: this is for friends.
 */
(function (root) {
  'use strict';
  const G = root.Game || require('./game.js');
  const S = root.GameStore || require('../shared/store.js');

  const clone = x => JSON.parse(JSON.stringify(x));
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  const ROOM_RE = /^[a-z0-9]{20,32}$/;
  const HASH_RE = /^[0-9a-f]{16}$/;

  // ----- invite codes: everything a friend needs to join, in one string -----

  function encodeInvite(g) {
    return 'SDO-' + b64(JSON.stringify({
      v: 2, rules: g.rules, server: g.server, room: g.room, seat: g.seat,
      humans: g.humans, difficulty: g.difficulty, worlds: g.worlds, seed: g.seed,
    }));
  }

  function decodeInvite(code) {
    try {
      code = String(code).trim().replace(/\s+/g, '');
      if (!code.startsWith('SDO-')) return null;
      const o = JSON.parse(unb64(code.slice(4)));
      const server = S.cleanBase(o.server);
      if (!o || o.v !== 2 || !server || typeof o.room !== 'string' || !ROOM_RE.test(o.room)) return null;
      if (!Number.isInteger(o.humans) || o.humans < 2 || o.humans > 4) return null;
      if (!Number.isInteger(o.seat) || o.seat < 1 || o.seat > o.humans) return null;
      if (!G.has(G.DIFFICULTY, o.difficulty) || !Number.isInteger(o.worlds) || o.worlds < 24 || o.worlds > 80) return null;
      if (!Number.isInteger(o.seed) || Math.abs(o.seed) > 2147483647 || !Number.isInteger(o.rules)) return null;
      return { server, room: o.room, seat: o.seat, humans: o.humans, difficulty: o.difficulty, worlds: o.worlds, seed: o.seed, rules: o.rules };
    } catch (e) { return null; }
  }

  // Anything read back from the store is untrusted. Keep only what has exactly the shape we write.
  function cleanEntry(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (v.skip === true) return v.ai === true ? { skip: true, ai: true } : { skip: true };
    if (typeof v.code !== 'string' || !v.code || v.code.length > S.LIMIT_CODE || !/^[A-Za-z0-9._-]+$/.test(v.code)) return null;
    return typeof v.h === 'string' && HASH_RE.test(v.h) ? { code: v.code, h: v.h } : { code: v.code };
  }
  const isEntry = v => cleanEntry(v) !== null;

  // plain-English messages for what the server can say
  function friendly(r) {
    if (!r) return 'Something went wrong.';
    const wait = r.retryAfter ? ' Try again in ' + (r.retryAfter > 90 ? Math.ceil(r.retryAfter / 60) + ' minutes.' : r.retryAfter + ' seconds.') : '';
    if (r.status === 429) {
      const e = String(r.data && r.data.error || '');
      if (/today/.test(e)) return 'The game server has hit its limit for new games today.' + wait;
      if (/new namespaces/.test(e)) return 'You have started a lot of games from this connection lately.' + wait;
      return 'The game server is busy.' + wait;
    }
    if (r.status === 413) return 'This game has used up its storage, or that was too big to send.';
    if (r.status === 507) return 'The game server is out of space right now.';
    if (r.status === 404) return 'The server does not know this game (it may have expired).';
    return 'The game server said ' + ((r.data && r.data.code) || r.status) + '.';
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
      this.entries = {};                                 // orders in the store for this turn
      this.error = null;
      this.working = null;
      this.rebuildWorking();
    }

    get seat() { return this.game.seat; }
    get isHost() { return this.game.seat === 1; }

    toJSON() { return { v: 2, game: this.game, base: this.base, cmds: this.cmds, sent: this.sent, desync: this.desync }; }
    static fromSaved(o) {
      if (!o || o.v !== 2 || !o.game || !o.base || !Array.isArray(o.cmds)) return null;
      const game = decodeInvite(encodeInvite(o.game)); // re-validate everything that came out of localStorage
      if (!game || game.rules !== G.RULES) return null;
      game.invites = Array.isArray(o.game.invites) ? o.game.invites.filter(x => typeof x === 'string').slice(0, 4) : undefined;
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

    // ----- talking to the store -----

    async submit() {
      if (this.sent) return { ok: true };
      const e = G.empire(this.base, this.seat);
      if (!e.human || !e.alive) return { ok: false, msg: 'You are not an active player.' };
      const code = G.encodeOrders({ v: 1, seat: this.seat, turn: this.base.turn, cmds: this.cmds });
      if (code.length > S.LIMIT_CODE) return { ok: false, msg: 'Too many orders for one turn (about 100 fit). Send some next turn.' };
      const g = this.game;
      // my orders carry a hash of my copy of the game, so everyone else can tell if their copy has drifted
      let r;
      try { r = await S.putOnce(g.server, g.room, S.orderKey(this.base.turn, this.seat), { code, h: G.hashState(this.base) }, isEntry); }
      catch (err) { return { ok: false, msg: err.message }; }
      if (r.status === 201 || r.status === 200) { this.sent = true; await this.sync(); return { ok: true }; }
      await this.sync();
      if (r.status === 409) return { ok: false, msg: 'Your orders for this turn were not accepted. The host may have skipped you.' };
      return { ok: false, msg: friendly(r) };
    }

    // Host only (by convention: the store has no accounts): play the turn without a player who has not answered.
    async hostSkip(seat, ai) {
      if (!this.isHost) return { ok: false, msg: 'Only the host can skip a player.' };
      const g = this.game;
      let r;
      try { r = await S.putOnce(g.server, g.room, S.orderKey(this.base.turn, seat), ai ? { skip: true, ai: true } : { skip: true }, isEntry); }
      catch (err) { return { ok: false, msg: err.message }; }
      await this.sync();
      if (r.status === 201 || r.status === 200) return { ok: true };
      return { ok: false, msg: r.status === 409 ? 'They already sent orders.' : friendly(r) };
    }

    // Reads the store and plays every turn that is complete. Safe to call as often as you like.
    async sync() {
      const g = this.game;
      let advanced = 0;
      this.error = null;
      try {
        for (let guard = 0; guard < 500; guard++) {
          const turn = this.base.turn;
          const keys = [];
          for (let seat = 1; seat <= g.humans; seat++) keys.push(S.orderKey(turn, seat));
          const r = await S.readKeys(g.server, g.room, keys);
          if (r.status !== 200) { this.error = friendly(r); break; }
          const orders = {};
          for (let seat = 1; seat <= g.humans; seat++) {
            const raw = r.values[S.orderKey(turn, seat)];
            const e = raw ? cleanEntry(raw.value) : null;
            if (e) orders[seat] = e;
          }

          // Compare with the hashes other players sent along with their orders for this turn. The warning follows the latest
          // evidence: it goes up when someone disagrees and clears once everyone who has spoken agrees again (after a Rebuild).
          const mine = G.hashState(this.base);
          const others = Object.entries(orders).filter(([seat, e]) => +seat !== this.seat && e.h);
          if (others.length) this.desync = others.some(([, e]) => e.h !== mine);

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
        this.error = e.message || 'Could not reach the game server.';
      }
      return { advanced, waiting: this.waiting, error: this.error };
    }

    // Rebuild the whole game from turn 1 by replaying the log. Used to join, and to recover from a desync.
    async rebuild() {
      const g = this.game;
      this.base = freshBase(g); this.cmds = []; this.sent = false; this.desync = false;
      const perRead = Math.max(1, Math.floor(S.KEYS_PER_READ / g.humans)); // turns per request
      let from = 1, replayDiffers = false;
      try {
        for (let guard = 0; guard < 600; guard++) {
          const keys = [];
          for (let t = from; t < from + perRead; t++) for (let seat = 1; seat <= g.humans; seat++) keys.push(S.orderKey(t, seat));
          const r = await S.readKeys(g.server, g.room, keys);
          if (r.status !== 200) { this.error = friendly(r); break; }
          let stopped = false;
          for (let t = from; t < from + perRead; t++) {
            if (this.base.turn !== t) { stopped = true; break; }
            const entries = {};
            for (let seat = 1; seat <= g.humans; seat++) {
              const raw = r.values[S.orderKey(t, seat)], e = raw ? cleanEntry(raw.value) : null;
              if (e) entries[seat] = e;
            }
            if (G.missingSeats(this.base, entries).length) { stopped = true; break; }
            // Past disagreements say little (the odd one out may have been someone else's broken copy). Only worry if most
            // of the players saw this turn differently from the way this replay does.
            const mine = G.hashState(this.base);
            const hs = Object.values(entries).filter(e => e.h).map(e => e.h);
            if (hs.filter(h => h !== mine).length > hs.filter(h => h === mine).length) replayDiffers = true;
            const next = clone(this.base);
            const res = G.advanceWith(next, entries);
            if (!res.ok || !res.advanced) { this.desync = true; stopped = true; break; }
            this.base = next;
          }
          if (stopped || this.base.over) break;
          from += perRead;
        }
      } catch (e) { this.error = e.message; }
      this.desync = replayDiffers;
      this.rebuildWorking();
      await this.sync();
      return { error: this.error, turn: this.base.turn };
    }

    // ----- creating and joining -----

    static async create(opts) {
      const server = S.cleanBase(opts.server);
      if (!server) throw new Error('The server address must start with https:// (or http://localhost).');
      const humans = opts.humans;
      const room = S.randomId(24); // 24 letters and digits: about 124 bits, so nobody can guess it
      const r = await S.createGame(server, room, { v: 1, humans, rules: G.RULES });
      if (r.status !== 201) throw new Error(friendly(r));
      const seed = (S.randomId(6, '0123456789') | 0) * 1000 + (S.randomId(3, '0123456789') | 0);
      const base = { server, room, humans, difficulty: opts.difficulty, worlds: opts.worlds, seed, rules: G.RULES };
      const game = { ...base, seat: 1 };
      game.invites = [];
      for (let s = 2; s <= humans; s++) game.invites.push(encodeInvite({ ...base, seat: s }));
      const session = new Session(game);
      await session.sync();
      return session;
    }

    static async join(code) {
      const game = decodeInvite(code);
      if (!game) throw new Error('That does not look like an invite code. Copy it again in full.');
      if (game.rules !== G.RULES) throw new Error('That game was made with a different version of the rules.');
      const m = await S.readMeta(game.server, game.room);
      if (m.status !== 200) throw new Error(friendly(m));
      if (!m.value || m.value.humans !== game.humans) throw new Error('That invite does not match its game.');
      const session = new Session(game);
      await session.rebuild();
      return session;
    }
  }

  const api = { Session, encodeInvite, decodeInvite, cleanEntry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Online = api;
})(typeof window !== 'undefined' ? window : globalThis);
