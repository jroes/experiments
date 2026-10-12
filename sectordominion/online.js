/*
 * Online play without a game server (lockstep).
 *
 * Every player's browser keeps its own copy of the game. During a turn you give orders on your copy and send them to the
 * shared key/value store (elf-punch/). When everyone's orders for the turn are in, every browser plays the turn itself. The
 * game is deterministic, so all copies stay identical. Each set of orders carries a hash of the sender's game, so if two copies
 * ever disagree you get a warning and can rebuild by replaying the log from turn 1.
 *
 * The store is the source of truth. localStorage is only a cache, so a new device can join with the same invite link.
 * Each game is one namespace with a long random name, and the store will not list keys, so only people holding an invite link can
 * find it. There are no accounts, so anyone who has the name can write to it: this is for friends.
 */
(function (root) {
  'use strict';
  const G = root.Game || require('./game.js');
  const S = root.GameStore || require('../shared/store.js');

  const clone = x => JSON.parse(JSON.stringify(x));
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  // A player counts as online if their page checked in within this many seconds. Pages check in every 15 s while visible.
  const ONLINE_SECS = 45;
  const NAME_MAX = 16;
  const ROOM_RE = /^[a-z0-9]{16,32}$/;
  const HASH_RE = /^[0-9a-f]{16}$/;

  // ----- invite codes -----
  // An invite is just the game's room name plus the seat it is for: 16 letters and digits, then one digit. Everything else
  // (rules, size, difficulty, seed) lives in the game's meta row in the store, so the code can be short enough for a text.

  const ROOM_LEN = 16; // 16 letters and digits is about 82 bits: nobody can guess one, and the server will not list them

  const inviteCode = (room, seat) => room + seat;

  // Accepts a bare code or a whole invite link (anything after the last #, with or without join=).
  function parseInvite(text) {
    const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    const code = t.slice(t.lastIndexOf('#') + 1).replace(/^join=/, '');
    const m = /^([a-z0-9]{16,32})([1-4])$/.exec(code);
    return m ? { room: m[1], seat: +m[2] } : null;
  }

  // Moving a solo game to another device: a copy of the game goes into the store under a fresh random name, and the code for it is
  // 't-' plus that name. There is no seat: the game is yours alone, so whoever has the link has your game.
  function parseTransfer(text) {
    const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    const m = /^t-([a-z0-9]{16})$/.exec(t.slice(t.lastIndexOf('#') + 1).replace(/^join=/, ''));
    return m ? m[1] : null;
  }
  const MAX_SNAPSHOT = 60000; // the store takes 64 KB per value

  async function shareSolo(state, server) {
    const base = S.cleanBase(server);
    if (!base) throw new Error('The server address must start with https:// (or http://localhost).');
    if (!G.validState(state)) throw new Error('This game cannot be moved.');
    // Stored as text, not as JSON numbers: the server may round-trip a decimal number differently (the last digit of a float),
    // and one changed digit in the random-number state would make the copy play differently.
    const text = JSON.stringify({ ...state, log: state.log.slice(0, 60) });
    if (text.length > MAX_SNAPSHOT) throw new Error('This game is too big to move.');
    const room = S.randomId(ROOM_LEN);
    const r = await S.call(base, 'PUT', '/kv/' + S.nsName(room) + '/snap', { body: { v: 1, game: text }, ifNoneMatch: true });
    if (r.status !== 201) throw new Error(friendly(r));
    return 't-' + room;
  }

  async function fetchSolo(text, server) {
    const room = parseTransfer(text);
    if (!room) throw new Error('That does not look like a link to a game.');
    const base = S.cleanBase(server);
    if (!base) throw new Error('The server address must start with https:// (or http://localhost).');
    const r = await S.call(base, 'GET', '/kv/' + S.nsName(room) + '/snap');
    if (r.status !== 200) throw new Error(friendly(r));
    const v = r.data && r.data.value;
    let game = null;
    try { game = v && v.v === 1 && typeof v.game === 'string' && v.game.length <= MAX_SNAPSHOT ? JSON.parse(v.game) : null; } catch (e) { /* not JSON */ }
    if (!G.validState(game)) throw new Error('That link does not hold a game this page can play.');
    return game;
  }

  // Everything about a game that must be valid before we play it. Used for saved games and for meta read from the store.
  function cleanGame(o) {
    try {
      const server = S.cleanBase(o.server);
      if (!o || !server || typeof o.room !== 'string' || !ROOM_RE.test(o.room)) return null;
      if (!Number.isInteger(o.humans) || o.humans < 2 || o.humans > 4) return null;
      if (!Number.isInteger(o.seat) || o.seat < 1 || o.seat > o.humans) return null;
      if (!G.has(G.DIFFICULTY, o.difficulty) || !Number.isInteger(o.worlds) || o.worlds < 24 || o.worlds > 80) return null;
      if (!Number.isInteger(o.seed) || Math.abs(o.seed) > 2147483647 || !Number.isInteger(o.rules)) return null;
      return { server, room: o.room, seat: o.seat, humans: o.humans, difficulty: o.difficulty, worlds: o.worlds, seed: o.seed, rules: o.rules };
    } catch (e) { return null; }
  }

  // A player's display name. It comes from other people's browsers, so keep it short, plain text with no markup characters.
  function cleanName(x) {
    if (typeof x !== 'string') return null;
    const t = Array.from(x.replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).join('').trim();
    return t || null;
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
      this.presence = {};                                // seat -> seconds since that player's page last checked in
      this.names = {};                                   // seat -> what that player likes to be called
      this.myName = null;
      if (saved && saved.names && typeof saved.names === 'object') for (const [k, v] of Object.entries(saved.names)) { const n = cleanName(v); if (n && /^[1-4]$/.test(k)) this.names[+k] = n; }
      this.events = [];                                  // who came online or went offline since the page last looked
      this._was = null;                                  // seat -> was online at the last look (null until the first look)
      this.entries = {};                                 // orders in the store for this turn
      this.error = null;
      this.working = null;
      this.rebuildWorking();
    }

    get seat() { return this.game.seat; }
    get isHost() { return this.game.seat === 1; }

    toJSON() { return { v: 2, game: this.game, base: this.base, cmds: this.cmds, sent: this.sent, desync: this.desync, names: this.names }; }
    static fromSaved(o) {
      if (!o || o.v !== 2 || !o.game || !o.base || !Array.isArray(o.cmds)) return null;
      const game = cleanGame(o.game); // re-validate everything that came out of localStorage
      if (!game || game.rules !== G.RULES) return null;
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
      const role = this.seatState(this.seat);
      if (role === 'ai' || role === 'ai-pending') return { ok: false, msg: 'The host handed your empire to the AI, so there is nothing to send.' };
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
      if (!Number.isInteger(seat) || seat === this.seat || this.seatState(seat) !== 'human') return { ok: false, msg: 'That seat is not an active player.' };
      const g = this.game;
      let r;
      try { r = await S.putOnce(g.server, g.room, S.orderKey(this.base.turn, seat), ai ? { skip: true, ai: true } : { skip: true }, isEntry); }
      catch (err) { return { ok: false, msg: err.message }; }
      await this.sync();
      if (r.status === 201 || r.status === 200) return { ok: true };
      return { ok: false, msg: r.status === 409 ? 'They already sent orders.' : friendly(r) };
    }

    // ----- who plays which seat -----

    setName(name) { this.myName = cleanName(name); if (this.myName) this.names[this.seat] = this.myName; }

    // What a seat is right now. The answer comes from the game plus the board, never from how the game started:
    //   human      someone plays it
    //   ai-pending the host has handed it to the AI, and the turn that makes it final has not been played yet
    //   ai         the AI plays it
    //   out        a person's empire that has been wiped out
    seatState(seat) {
      const e = G.empire(this.base, seat);
      if (!e) return null;
      if (!e.human) return 'ai';
      if (!e.alive) return 'out';
      const entry = this.entries && this.entries[seat];
      return entry && entry.skip && entry.ai ? 'ai-pending' : 'human';
    }

    // Seats a friend can still be invited to: other people who are in the game right now.
    invitable() {
      const out = [];
      for (let seat = 1; seat <= this.game.humans; seat++) if (seat !== this.seat && this.seatState(seat) === 'human') out.push(seat);
      return out;
    }

    // ----- who is around -----

    // Works out how long ago each other player checked in, and remembers who just came online or went offline.
    noticePresence(r) {
      const g = this.game, seen = {};
      for (let seat = 1; seat <= g.humans; seat++) {
        const raw = r.values[S.presenceKey(seat)];
        const nm = raw && raw.value && typeof raw.value === 'object' ? cleanName(raw.value.name) : null;
        if (nm && (seat !== this.seat || !this.myName)) this.names[seat] = nm; // my own name from another device, until I set one here
        if (seat === this.seat) continue;
        if (!raw || raw.t === null || r.now === null) { this.presence[seat] = null; seen[seat] = false; continue; }
        const age = Math.max(0, r.now - raw.t);
        this.presence[seat] = age;
        seen[seat] = age <= ONLINE_SECS;
      }
      if (this._was) {
        for (const [seat, on] of Object.entries(seen)) {
          const e = G.empire(this.base, +seat);
          if (!e.human || !e.alive) continue;
          if (on !== this._was[seat]) this.events.push({ seat: +seat, kind: on ? 'online' : 'offline' });
        }
      }
      this._was = seen;
    }

    isOnline(seat) { const a = this.presence[seat]; return a !== undefined && a !== null && a <= ONLINE_SECS; }
    anyoneOnline() { return Object.keys(this.presence).some(seat => this.isOnline(+seat)); }
    takeEvents() { const e = this.events; this.events = []; return e; }

    // Tell the others this page is open. Never throws: a missed heartbeat only makes you look away for a moment.
    async beat() {
      const e = G.empire(this.base, this.seat);
      if (this.base.over || !e.human) return;
      try { await S.beat(this.game.server, this.game.room, this.seat, this.myName); } catch (err) { /* offline: nothing to do */ }
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
          for (let seat = 1; seat <= g.humans; seat++) keys.push(S.presenceKey(seat)); // same request, so presence costs nothing extra
          const r = await S.readKeys(g.server, g.room, keys);
          if (r.status !== 200) { this.error = friendly(r); break; }
          if (guard === 0) this.noticePresence(r);
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
      const room = S.randomId(ROOM_LEN);
      const seed = (S.randomId(6, '0123456789') | 0) * 1000 + (S.randomId(3, '0123456789') | 0);
      const game = cleanGame({ server, room, seat: 1, humans: opts.humans, difficulty: opts.difficulty, worlds: opts.worlds, seed, rules: G.RULES });
      if (!game) throw new Error('Those game settings are not allowed.');
      const meta = { v: 2, humans: game.humans, rules: game.rules, difficulty: game.difficulty, worlds: game.worlds, seed: game.seed };
      const r = await S.createGame(server, room, meta);
      if (r.status !== 201) throw new Error(friendly(r));
      const session = new Session(game);
      await session.sync();
      return session;
    }

    // `invite` is a code or a link; `server` is where games live (the same one for everybody).
    static async join(invite, server) {
      const inv = parseInvite(invite);
      if (!inv) throw new Error('That does not look like an invite. Open the link your friend sent you.');
      const base = S.cleanBase(server);
      if (!base) throw new Error('The server address must start with https:// (or http://localhost).');
      const m = await S.readMeta(base, inv.room);
      if (m.status !== 200) throw new Error(friendly(m));
      const v = m.value && typeof m.value === 'object' ? m.value : {};
      if (v.v !== 2) throw new Error('That game was made by an older version and cannot be joined from here.');
      const game = cleanGame({ server: base, room: inv.room, seat: inv.seat, humans: v.humans, difficulty: v.difficulty, worlds: v.worlds, seed: v.seed, rules: v.rules });
      if (!game) throw new Error('That invite does not match a game this page can play.');
      if (game.rules !== G.RULES) throw new Error('That game was made with a different version of the rules.');
      const session = new Session(game);
      await session.rebuild();
      const role = session.seatState(game.seat);
      if (role === 'ai' || role === 'ai-pending') throw new Error('The host gave that seat to the AI, so there is nothing to join. Ask them for a new game.');
      return session;
    }
  }

  const api = { Session, shareSolo, fetchSolo, parseTransfer, inviteCode, parseInvite, cleanGame, cleanEntry, cleanName, NAME_MAX, ONLINE_SECS, ROOM_LEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Online = api;
})(typeof window !== 'undefined' ? window : globalThis);
