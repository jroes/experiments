/*
 * Playing as a band, one phone each. Browser only.
 *
 * The band leader's page hosts a room on the elf-punch relay (the same `/jetfall` WebSocket relay Jetfall uses: a room
 * code, signaling, and packets passed along; see elf-punch/README.md). Friends join with the six-letter code. Messages are
 * small JSON packets through the relay or a direct WebRTC channel once one opens (jetfall/link.js does both).
 *
 * Every phone plays the whole song itself. Only the start has to line up: guests measure their clock against the leader's
 * (round trips, keeping the fastest), and the leader says "start at my time T". During the song each phone sends its score
 * and how it is doing about five times a second, and the leader passes the band's state to everyone.
 * Scores are whatever each phone says: friends only.
 */
(function (root) {
  'use strict';
  const RN = root.RN;
  const PROTO = 2, MAX = 6, ALL = 0xFFFF;
  const enc = new TextEncoder(), dec = new TextDecoder();

  function emitter() {
    const subs = {};
    return {
      on(ev, fn) { (subs[ev] = subs[ev] || []).push(fn); },
      emit(ev, ...a) { (subs[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } }); },
    };
  }

  const isId = x => Number.isInteger(x) && x >= 0 && x < 65535;

  class Band {
    constructor(link, leader, name, pick) {
      const ev = emitter();
      this.on = ev.on; this.emit = ev.emit;
      this.link = link; this.leader = leader; this.code = link.room;
      this.id = leader ? 0 : null;
      this.members = new Map();      // id -> { id, name, pick, ready, st, waiting }
      this.song = RN.SONGS[0].id;
      this.same = false;             // same room: each phone plays only its own part
      this.state = 'lobby';
      this.offset = 0;               // leader's performance.now() minus mine, in ms
      this.samples = [];
      this.closed = false;
      this.lastSent = 0;
      this.me = { name: RN.cleanName(name), pick: RN.cleanPick(pick) };
      link.on('data', (from, bytes) => {
        let msg;
        try { msg = JSON.parse(dec.decode(bytes)); } catch (e) { return; }
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
        if (leader) this.fromGuest(from, msg); else if (from === 0) this.fromLeader(msg);
      });
      link.on('closed', why => { if (!this.closed) { this.closed = true; this.emit('closed', this.why || why); } });
      if (leader) {
        this.members.set(0, { id: 0, name: this.me.name, pick: this.me.pick, ready: true, st: null });
        link.on('left', id => { if (this.members.delete(id)) { this.roster(); this.checkDone(); } });
        this.ticker = setInterval(() => this.tick(), 200);
      } else {
        this.send({ t: 'hi', v: PROTO, name: this.me.name, pick: this.me.pick });
      }
    }

    send(msg, to) {
      if (this.closed) return;
      const bytes = enc.encode(JSON.stringify(msg));
      if (this.leader) this.link.send(to === undefined ? ALL : to, bytes, true);
      else this.link.send(0, bytes, true);
    }

    // ---------- leader ----------
    fromGuest(id, m) {
      if (!isId(id) || id === 0) return;
      const mem = this.members.get(id);
      if (m.t === 'hi') {
        if (m.v !== PROTO) { this.send({ t: 'bye', why: 'refresh' }, id); setTimeout(() => this.link.kick(id), 300); return; }
        if (!mem && this.members.size >= MAX) { this.send({ t: 'bye', why: 'full' }, id); setTimeout(() => this.link.kick(id), 300); return; }
        this.members.set(id, { id, name: RN.cleanName(m.name), pick: RN.cleanPick(m.pick), ready: false, st: null, waiting: this.state === 'playing' });
        this.send({ t: 'welcome', id }, id);
        this.roster();
      } else if (!mem) {
        return;
      } else if (m.t === 'ping') {
        if (typeof m.c === 'number' && Number.isFinite(m.c)) this.send({ t: 'pong', c: m.c, h: performance.now() }, id);
      } else if (m.t === 'pick') {
        if (this.state !== 'lobby') return;
        mem.pick = RN.cleanPick(m.pick); mem.ready = false;
        this.roster();
      } else if (m.t === 'ready') {
        mem.ready = m.r === true; this.roster();
      } else if (m.t === 'st') {
        if (this.state !== 'playing' || mem.waiting) return;
        mem.st = RN.cleanStatus(m.s);
        this.checkDone();
      } else if (m.t === 'boost') {
        if (this.state !== 'playing') return;
        this.send({ t: 'revive', by: id });
        this.emit('revive', id);
      }
    }

    rosterList() {
      return [...this.members.values()].map(m => ({ id: m.id, name: m.name, pick: m.pick, ready: m.ready, waiting: !!m.waiting }));
    }
    roster() {
      if (!this.leader) return;
      this.send({ t: 'roster', m: this.rosterList(), song: this.song, same: this.same, state: this.state });
      this.emit('roster');
    }
    setSong(id) { if (this.leader && RN.validSong(id) && this.state === 'lobby') { this.song = id; this.roster(); } }
    setSame(v) { if (this.leader) { this.same = !!v; this.roster(); } }

    // everybody plays from the leader's time `at`, a few seconds from now so every phone can get ready
    start() {
      if (!this.leader || this.state !== 'lobby') return;
      this.state = 'playing';
      for (const m of this.members.values()) { m.st = null; m.waiting = false; m.ready = false; }
      const at = performance.now() + 3500;
      this.send({ t: 'go', song: this.song, at, same: this.same, m: this.rosterList() });
      this.emit('roster');
      this.emit('go', { song: this.song, at, same: this.same });
    }
    // your music has no end the phones know of: the leader's set ending ends everyone's
    endLive() {
      if (!this.leader || this.state !== 'playing') return;
      this.send({ t: 'end' });
    }
    stop() {
      if (!this.leader || this.state !== 'playing') return;
      this.state = 'lobby';
      this.send({ t: 'stop' });
      this.roster();
      this.emit('stop');
    }
    // the song is over for the band once every player says so, or when everyone is out
    checkDone() {
      if (!this.leader || this.state !== 'playing') return;
      const players = [...this.members.values()].filter(m => !m.waiting);
      const done = players.every(m => m.st && m.st.done);
      const out = players.length > 0 && players.every(m => m.st && m.st.failed);
      if (done || out) {
        this.sendBand();
        this.state = 'lobby';
        for (const m of this.members.values()) m.ready = m.id === 0;
        this.roster();
        if (out && !done) { this.send({ t: 'out' }); this.emit('out'); }
      }
    }
    sendBand() {
      const s = [];
      for (const m of this.members.values()) if (m.st) s.push([m.id, m.st]);
      this.send({ t: 'band', s });
      this.emit('band');
    }
    tick() {
      if (this.state === 'playing') this.sendBand();
    }

    // ---------- guest ----------
    fromLeader(m) {
      if (m.t === 'welcome') {
        if (!isId(m.id)) return;
        this.id = m.id;
        this.syncClock(8);
        this.syncer = setInterval(() => { if (this.state === 'lobby') this.syncClock(1); }, 2500);
        this.emit('welcome');
      } else if (m.t === 'pong') {
        if (typeof m.c !== 'number' || typeof m.h !== 'number' || !Number.isFinite(m.h)) return;
        const now = performance.now(), rtt = now - m.c;
        if (!(rtt >= 0 && rtt < 5000)) return;
        this.samples.push({ rtt, off: m.h - (m.c + rtt / 2) });
        if (this.samples.length > 16) this.samples.shift();
        const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = best.off; this.rtt = best.rtt;
      } else if (m.t === 'roster') {
        this.readRoster(m.m);
        if (RN.validSong(m.song)) this.song = m.song;
        this.same = m.same === true;
        if (m.state === 'lobby' || m.state === 'playing') this.state = m.state;
        this.emit('roster');
      } else if (m.t === 'go') {
        if (!RN.validSong(m.song) || typeof m.at !== 'number' || !Number.isFinite(m.at)) return;
        this.song = m.song; this.same = m.same === true; this.state = 'playing';
        this.readRoster(m.m);
        const mine = this.members.get(this.id);
        if (!mine || mine.waiting) return;
        for (const x of this.members.values()) x.st = null;
        this.emit('go', { song: m.song, at: m.at - this.offset, same: this.same });
      } else if (m.t === 'band') {
        if (!Array.isArray(m.s)) return;
        for (const row of m.s.slice(0, MAX * 2)) {
          if (!Array.isArray(row) || !isId(row[0]) || row[0] === this.id) continue;
          const x = this.members.get(row[0]);
          if (x) x.st = RN.cleanStatus(row[1]);
        }
        this.emit('band');
      } else if (m.t === 'revive') {
        if (isId(m.by)) this.emit('revive', m.by);
      } else if (m.t === 'stop') {
        this.state = 'lobby'; this.emit('stop');
      } else if (m.t === 'out') {
        this.emit('out');
      } else if (m.t === 'end') {
        this.emit('end');
      } else if (m.t === 'bye') {
        this.why = m.why === 'full' ? 'full' : m.why === 'refresh' ? 'refresh' : 'bye';
      }
    }
    readRoster(list) {
      if (!Array.isArray(list)) return;
      const keep = new Map();
      for (const r of list.slice(0, MAX)) {
        if (!r || typeof r !== 'object' || !isId(r.id) || keep.has(r.id)) continue;
        const old = this.members.get(r.id);
        keep.set(r.id, { id: r.id, name: RN.cleanName(r.name), pick: RN.cleanPick(r.pick), ready: r.ready === true, waiting: r.waiting === true, st: old ? old.st : null });
      }
      this.members = keep;
    }
    syncClock(n) {
      for (let i = 0; i < n; i++) setTimeout(() => this.send({ t: 'ping', c: performance.now() }), i * 120);
    }

    // ---------- both ----------
    setPick(pick) {
      this.me.pick = RN.cleanPick(pick);
      if (this.leader) { const m = this.members.get(0); m.pick = this.me.pick; this.roster(); }
      else this.send({ t: 'pick', pick: this.me.pick });
    }
    setReady(r) {
      if (this.leader) return;
      this.send({ t: 'ready', r: !!r });
    }
    // my status during a song: the leader keeps it, a guest sends it (at most five times a second, or now when it matters)
    status(st, force) {
      if (this.leader) {
        const m = this.members.get(0);
        if (m && this.state === 'playing') { m.st = RN.cleanStatus(st); this.checkDone(); }
        return;
      }
      const now = performance.now();
      if (!force && now - this.lastSent < 200) return;
      this.lastSent = now;
      this.send({ t: 'st', s: st });
      const m = this.members.get(this.id);
      if (m) m.st = RN.cleanStatus(st);
    }
    boost() {
      if (this.leader) { this.send({ t: 'revive', by: 0 }); this.emit('revive', 0); }
      else this.send({ t: 'boost' });
    }
    leave() {
      this.closed = true;
      clearInterval(this.ticker); clearInterval(this.syncer);
      try { this.link.close(); } catch (e) { /* gone */ }
    }
  }

  async function lead(name, pick) {
    const link = root.JFLink.connect();
    await link.host('Riff Night band', { g: 'riffnight' });
    return new Band(link, true, name, pick);
  }

  async function join(code, name, pick) {
    const link = root.JFLink.connect();
    await link.join(String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''), RN.cleanName(name));
    const band = new Band(link, false, name, pick);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('The band leader did not answer.')), 8000);
      band.on('welcome', () => { clearTimeout(t); res(); });
      band.on('closed', why => { clearTimeout(t); rej(new Error(closedText(why))); });
    });
    return band;
  }

  function closedText(why) {
    return ({ full: 'That band is full.', refresh: 'The band leader has a newer version. Refresh this page and join again.',
      'host-left': 'The band leader left.', kicked: 'The band leader removed you.' })[why] || 'Lost the connection to the band.';
  }

  root.RNBand = { lead, join, closedText, MAX, PROTO };
})(window);
