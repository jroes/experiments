/*
 * Jetfall networking: packets, the host loop and the client view. No DOM here (the transports live in link.js).
 *
 * One browser hosts: it runs the World and sends each player a snapshot 20 times a second.
 * Every player (the host's own player too, over a loopback) is a Client: it sends its inputs 60 times a second,
 * moves its own player right away (prediction) and redoes those moves when a snapshot says where the host put it.
 * Everyone else is drawn a little in the past, smoothly, between two snapshots.
 *
 * Everything a client sends is untrusted: decoders check sizes and ranges, and throw on junk, which the host drops.
 */
(function (root) {
  'use strict';
  const JF = root.JF || require('./sim.js');
  const Bots = root.JFBots || require('./bots.js');
  const { B, TICK, ARMORS, ARMOR_KEYS, WEAPONS, WEAPON_KEYS, PACK_KEYS, PROJ, PROJ_BY_CODE, clamp, has } = JF;

  const PROTO = 1;
  const SNAP_EVERY = 3;           // ticks between snapshots (20 a second)
  const INTERP_TICKS = 7;         // draw others this far in the past
  const MAX_PLAYERS = 32;
  const T = { CTRL: 0, INPUT: 1, SNAP: 2 };

  // ---------- bytes ----------
  class Writer {
    constructor(n) { this.b = new Uint8Array(n || 1024); this.v = new DataView(this.b.buffer); this.o = 0; }
    need(n) {
      if (this.o + n <= this.b.length) return;
      let m = this.b.length * 2; while (m < this.o + n) m *= 2;
      const nb = new Uint8Array(m); nb.set(this.b); this.b = nb; this.v = new DataView(nb.buffer);
    }
    u8(x) { this.need(1); this.v.setUint8(this.o, x); this.o += 1; }
    i8(x) { this.need(1); this.v.setInt8(this.o, x); this.o += 1; }
    u16(x) { this.need(2); this.v.setUint16(this.o, x); this.o += 2; }
    i16(x) { this.need(2); this.v.setInt16(this.o, x); this.o += 2; }
    u32(x) { this.need(4); this.v.setUint32(this.o, x >>> 0); this.o += 4; }
    f32(x) { this.need(4); this.v.setFloat32(this.o, x); this.o += 4; }
    bytes(u) { this.need(u.length); this.b.set(u, this.o); this.o += u.length; }
    str(s) { const u = enc.encode(s); this.u16(u.length); this.bytes(u); }
    done() { return this.b.slice(0, this.o); }
  }
  class Reader {
    constructor(u8) { this.b = u8; this.v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.o = 0; }
    chk(n) { if (this.o + n > this.b.length) throw new Error('short'); }
    u8() { this.chk(1); return this.v.getUint8(this.o++); }
    i8() { this.chk(1); return this.v.getInt8(this.o++); }
    u16() { this.chk(2); const x = this.v.getUint16(this.o); this.o += 2; return x; }
    i16() { this.chk(2); const x = this.v.getInt16(this.o); this.o += 2; return x; }
    u32() { this.chk(4); const x = this.v.getUint32(this.o); this.o += 4; return x; }
    f32() { this.chk(4); const x = this.v.getFloat32(this.o); this.o += 4; if (!Number.isFinite(x)) throw new Error('nan'); return x; }
    str() { const n = this.u16(); this.chk(n); const s = dec.decode(this.b.subarray(this.o, this.o + n)); this.o += n; return s; }
  }
  const enc = new TextEncoder(), dec = new TextDecoder();

  // ---------- control messages (rare, reliable): JSON ----------
  function encodeCtrl(obj) { const w = new Writer(256); w.u8(T.CTRL); w.str(JSON.stringify(obj)); return w.done(); }
  function decodeCtrl(r) { const o = JSON.parse(r.str()); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('ctrl'); return o; }

  // ---------- inputs ----------
  // An input is quantized before the client uses it, so client and host run exactly the same numbers.
  const YAW_Q = 65536 / (Math.PI * 2), PITCH_Q = 32767 / (Math.PI / 2);
  function quantize(inp) {
    let yaw = inp.yaw % (Math.PI * 2); if (yaw < 0) yaw += Math.PI * 2;
    const qy = Math.round(yaw * YAW_Q) & 0xffff;
    const qp = Math.round(clamp(inp.pitch, -1.55, 1.55) * PITCH_Q);
    return {
      seq: inp.seq >>> 0, b: inp.b & 63,
      mx: Math.round(clamp(inp.mx, -1, 1) * 127) / 127, mz: Math.round(clamp(inp.mz, -1, 1) * 127) / 127,
      yaw: qy / YAW_Q, pitch: qp / PITCH_Q, w: inp.w == null ? 255 : inp.w & 255,
    };
  }
  function writeInput(w, q) {
    w.u32(q.seq); w.u8(q.b); w.i8(Math.round(q.mx * 127)); w.i8(Math.round(q.mz * 127));
    w.u16(Math.round(q.yaw * YAW_Q) & 0xffff); w.i16(Math.round(q.pitch * PITCH_Q)); w.u8(q.w);
  }
  function readInput(r) {
    const seq = r.u32(), b = r.u8() & 63, mx = clamp(r.i8(), -127, 127) / 127, mz = clamp(r.i8(), -127, 127) / 127;
    const yaw = r.u16() / YAW_Q, pitch = clamp(r.i16() / PITCH_Q, -1.55, 1.55), wsel = r.u8();
    return { seq, b, mx, mz, yaw, pitch, w: wsel };
  }
  // inputs go with the last few before them, so a lost packet costs nothing
  function encodeInputs(list, ackEv, ackSnap) {
    const w = new Writer(128); w.u8(T.INPUT); w.u32(ackEv); w.u32(ackSnap); w.u8(list.length);
    for (const q of list) writeInput(w, q);
    return w.done();
  }
  function decodeInputs(r) {
    const ackEv = r.u32(), ackSnap = r.u32(), n = r.u8();
    if (n > 16) throw new Error('too many');
    const list = [];
    for (let i = 0; i < n; i++) list.push(readInput(r));
    return { ackEv, ackSnap, list };
  }

  // ---------- snapshots ----------
  const ST = { home: 0, carried: 1, dropped: 2 };
  const ST_NAMES = ['home', 'carried', 'dropped'];
  const round2 = x => Math.round(x * 100) / 100;

  function encodeSnap(world, forId, ackSeq, evFrom, extra) {
    const w = new Writer(2048);
    w.u8(T.SNAP); w.u32(world.tick); w.u32(Math.max(0, ackSeq) >>> 0); w.u8(forId & 255);
    w.u8(world.score[0]); w.u8(world.score[1]);
    w.u16(Math.max(0, Math.ceil(world.timeLeft != null ? world.timeLeft : world.timeLimit - world.time)));
    w.i8(world.over ? world.over.winner : -2);
    const ps = [...world.players.values()];
    w.u8(ps.length);
    for (const p of ps) {
      const A = ARMORS[p.armor];
      const flags = (p.alive ? 1 : 0) | (p.team ? 2 : 0) | (p.jetting ? 4 : 0) | (p.skiing ? 8 : 0) | (p.firing ? 16 : 0) | (p.shieldOn ? 32 : 0) | (p.ground ? 64 : 0) | (p.flag >= 0 ? 128 : 0);
      w.u8(p.id); w.u8(flags);
      const wk = p.weapons[p.wi];
      w.u8(ARMOR_KEYS.indexOf(p.armor) | ((wk ? WEAPON_KEYS.indexOf(wk) + 1 : 0) << 2));
      w.f32(p.pos[0]); w.f32(p.pos[1]); w.f32(p.pos[2]);
      w.i16(clamp(Math.round(p.vel[0] * 40), -32767, 32767)); w.i16(clamp(Math.round(p.vel[1] * 40), -32767, 32767)); w.i16(clamp(Math.round(p.vel[2] * 40), -32767, 32767));
      w.u16(Math.round(((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * YAW_Q) & 0xffff); w.i16(Math.round(clamp(p.pitch, -1.57, 1.57) * PITCH_Q));
      w.u8(clamp(Math.round(p.hp / A.hp * 255), 0, 255)); w.u8(clamp(Math.round(p.energy / A.energy * 255), 0, 255));
      w.u8(p.elfT >= 0 ? p.elfT + 1 : 0); w.u8(p.repairing >= 0 ? (p.repairing >= 1000 ? 200 + (p.repairing - 1000) : p.repairing + 1) : 0);
      w.u8(p.shots & 255);
    }
    // the full movement state of the player this snapshot is for, for prediction
    const me = world.players.get(forId);
    w.u8(me ? 1 : 0);
    if (me) {
      w.f32(me.vel[0]); w.f32(me.vel[1]); w.f32(me.vel[2]);
      w.f32(me.energy); w.f32(me.hp); w.u8(me.prevB & 63);
      w.u8((me.ground ? 1 : 0) | (me.wasJet ? 2 : 0) | (me.shieldOn ? 4 : 0) | (me.wantSpawn ? 8 : 0));
      w.f32(me.kick); w.f32(me.gn[0]); w.f32(me.gn[1]); w.f32(me.gn[2]);
      w.u8(PACK_KEYS.indexOf(me.pack));
      w.u8(me.weapons.length);
      for (const k of me.weapons) { w.u8(WEAPON_KEYS.indexOf(k)); w.u16(me.ammo[k] | 0); }
      w.u8(me.wi); w.u8(me.grenades);
      w.f32(me.stationT); w.i8(clamp(me.stationId, -3, 127)); w.f32(me.deadT); w.f32(me.fireCd); w.f32(me.spin);
      w.u8(me.flag + 1);
      const L = me.loadout;
      w.u8(ARMOR_KEYS.indexOf(L.armor)); w.u8(PACK_KEYS.indexOf(L.pack)); w.u8(L.weapons.length); for (const k of L.weapons) w.u8(WEAPON_KEYS.indexOf(k));
    }
    // projectiles (chaingun bullets are drawn from the fire events instead: too many, too fast)
    const pr = world.proj.filter(q => !PROJ[q.kind].quiet).slice(0, 250);
    w.u8(pr.length);
    for (const q of pr) {
      w.u16(q.id); w.u8(PROJ[q.kind].code); w.u8(q.owner >= 0 ? q.owner + 1 : 0); w.u8(q.shot & 255);
      w.f32(q.pos[0]); w.f32(q.pos[1]); w.f32(q.pos[2]); w.f32(q.vel[0]); w.f32(q.vel[1]); w.f32(q.vel[2]);
    }
    for (const f of world.flags) {
      w.u8(ST[f.state]); w.u8(f.carrier >= 0 ? f.carrier + 1 : 0);
      w.f32(f.pos[0]); w.f32(f.pos[1]); w.f32(f.pos[2]);
      w.u16(f.state === 'dropped' ? clamp(Math.ceil(f.returnAt - world.time), 0, 999) : 0);
    }
    w.u8(world.objects.length);
    for (const o of world.objects) {
      w.u8(clamp(Math.round(o.hp / o.max * 255), 0, 255));
      w.u8((o.up ? 1 : 0) | (world.power(o.team) ? 2 : 0));
      w.u16(Math.round(((o.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * YAW_Q) & 0xffff); w.i16(Math.round(clamp(o.pitch, -1.57, 1.57) * PITCH_Q));
      w.u8(o.target >= 0 ? o.target + 1 : 0);
    }
    // events this player has not acknowledged yet, up to a size
    const evs = [];
    let bytes = 0;
    for (let i = world.events.length - 1; i >= 0; i--) {
      const e = world.events[i];
      if (e.s <= evFrom) break;
      evs.push(e);
    }
    evs.reverse();
    const out = [];
    for (const e of evs) {
      if (e.k === 'chat' && e.team != null && me && e.team !== me.team) continue;
      const c = {};
      for (const k in e) c[k] = typeof e[k] === 'number' && !Number.isInteger(e[k]) ? round2(e[k]) : e[k];
      const s = JSON.stringify(c);
      if (bytes + s.length > 3000) break;
      bytes += s.length; out.push(s);
    }
    w.u8(out.length);
    for (const s of out) w.str(s);
    w.str(extra ? JSON.stringify(extra) : '');
    return w.done();
  }

  function decodeSnap(r) {
    const s = { tick: r.u32(), ack: r.u32(), you: r.u8(), score: [r.u8(), r.u8()], timeLeft: r.u16(), over: r.i8(), players: [], proj: [], flags: [], objects: [], events: [] };
    const np = r.u8();
    for (let i = 0; i < np; i++) {
      const id = r.u8(), f = r.u8(), aw = r.u8();
      const p = {
        id, alive: !!(f & 1), team: f & 2 ? 1 : 0, jetting: !!(f & 4), skiing: !!(f & 8), firing: !!(f & 16), shieldOn: !!(f & 32), ground: !!(f & 64), hasFlag: !!(f & 128),
        armor: ARMOR_KEYS[aw & 3] || 'light', weapon: WEAPON_KEYS[(aw >> 2) - 1] || null,
        pos: [r.f32(), r.f32(), r.f32()], vel: [r.i16() / 40, r.i16() / 40, r.i16() / 40],
        yaw: r.u16() / YAW_Q, pitch: r.i16() / PITCH_Q, hpF: r.u8() / 255, enF: r.u8() / 255,
        elfT: r.u8() - 1, repairing: r.u8(), shots: r.u8(),
      };
      s.players.push(p);
    }
    if (r.u8()) {
      const m = s.me = { vel: [r.f32(), r.f32(), r.f32()], energy: r.f32(), hp: r.f32(), prevB: r.u8() };
      const bits = r.u8();
      m.ground = !!(bits & 1); m.wasJet = !!(bits & 2); m.shieldOn = !!(bits & 4); m.wantSpawn = !!(bits & 8);
      m.kick = r.f32(); m.gn = [r.f32(), r.f32(), r.f32()];
      m.pack = PACK_KEYS[r.u8()] || 'none';
      const nw = r.u8(); m.weapons = []; m.ammo = {};
      for (let i = 0; i < nw; i++) { const k = WEAPON_KEYS[r.u8()] || 'blaster'; m.weapons.push(k); m.ammo[k] = r.u16(); }
      m.wi = r.u8(); m.grenades = r.u8();
      m.stationT = r.f32(); m.stationId = r.i8(); m.deadT = r.f32(); m.fireCd = r.f32(); m.spin = r.f32();
      m.flag = r.u8() - 1;
      const la = ARMOR_KEYS[r.u8()] || 'light', lp = PACK_KEYS[r.u8()] || 'none', lw = []; const n = r.u8();
      for (let i = 0; i < n; i++) lw.push(WEAPON_KEYS[r.u8()] || 'blaster');
      m.loadout = { armor: la, pack: lp, weapons: lw };
    }
    const npr = r.u8();
    for (let i = 0; i < npr; i++) {
      const q = { id: r.u16(), kind: PROJ_BY_CODE[r.u8()] || 'disc', owner: r.u8() - 1, shot: r.u8(), pos: [r.f32(), r.f32(), r.f32()], vel: [r.f32(), r.f32(), r.f32()] };
      s.proj.push(q);
    }
    for (let i = 0; i < 2; i++) s.flags.push({ state: ST_NAMES[r.u8()] || 'home', carrier: r.u8() - 1, pos: [r.f32(), r.f32(), r.f32()], returnIn: r.u16() });
    const no = r.u8();
    for (let i = 0; i < no; i++) { const hp = r.u8() / 255, b = r.u8(); s.objects.push({ hpF: hp, up: !!(b & 1), power: !!(b & 2), yaw: r.u16() / YAW_Q, pitch: r.i16() / PITCH_Q, target: r.u8() - 1 }); }
    const ne = r.u8();
    for (let i = 0; i < ne; i++) { try { s.events.push(JSON.parse(r.str())); } catch (e) { /* skip */ } }
    const ex = r.str();
    if (ex) try { s.extra = JSON.parse(ex); } catch (e) { /* skip */ }
    return s;
  }

  // ---------- host ----------
  // `send(peer, bytes, reliable)` is the transport. Peer 0 is the host's own client (loopback).
  class Host {
    constructor(opts) {
      this.opts = opts;
      this.send = opts.send;
      this.settings = cleanSettings(opts.settings || {});
      this.peers = new Map();   // peer id -> { pid, inputs: [], lastSeq, budget, ackEv, name, ... }
      this.nextPid = 1;
      this.bots = new Map();
      this.acc = 0;
      this.chatT = new Map();
      this.newWorld();
    }
    newWorld() {
      const s = this.settings;
      const old = this.world;
      this.world = new JF.World({ map: s.map, seed: (Math.random() * 1e9) | 0, capLimit: s.caps, timeLimit: s.minutes * 60 });
      this.world.evSeq = old ? old.evSeq + 10 : 0; // event numbers keep going up across maps
      this.overT = 0;
      this.bots.clear();
      if (old) {
        for (const p of old.players.values()) {
          const q = this.world.addPlayer({ id: p.id, name: p.name, team: p.team, bot: p.bot, loadout: p.loadout });
          if (p.bot) { q.skill = p.skill; q.botSlot = p.botSlot; }
        }
        this.world.events = [];
        for (const peer of this.peers.values()) { peer.inputs = []; peer.ackEv = this.world.evSeq; peer.lastSeq = -1; }
      }
      for (const peer of this.peers.values()) if (peer.welcomed) this.send(peer.id, encodeCtrl(this.welcome(peer)), true);
      this.fillBots();
    }
    welcome(peer) {
      return { t: 'welcome', v: PROTO, you: peer.pid, map: this.world.mapKey, settings: this.settings, ev: this.world.evSeq, room: this.opts.room || null };
    }
    freePid() {
      const used = new Set(this.world.players.keys());
      for (let i = 1; i < 250; i++) if (!used.has(i)) return i;
      return -1;
    }
    // a peer said hello: { t:'hello', v, name, loadout }
    join(peerId, hello) {
      if (!hello || hello.v !== PROTO) { this.send(peerId, encodeCtrl({ t: 'refused', why: 'version' }), true); return; }
      const humans = [...this.world.players.values()].filter(p => !p.bot).length;
      if (humans >= MAX_PLAYERS) { this.send(peerId, encodeCtrl({ t: 'refused', why: 'full' }), true); return; }
      this.dropBotFor(hello.team);
      const pid = this.freePid();
      if (pid < 0) { this.send(peerId, encodeCtrl({ t: 'refused', why: 'full' }), true); return; }
      const team = hello.team === 0 || hello.team === 1 ? hello.team : undefined;
      this.world.addPlayer({ id: pid, name: hello.name, loadout: hello.loadout, team });
      const peer = { id: peerId, pid, inputs: [], lastSeq: -1, budget: 4, ackEv: this.world.evSeq, ackSnap: 0, welcomed: true, joinedAt: this.world.time };
      this.peers.set(peerId, peer);
      this.send(peerId, encodeCtrl(this.welcome(peer)), true);
      this.fillBots();
      this.broadcastRoster();
    }
    leave(peerId) {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      this.peers.delete(peerId);
      this.world.removePlayer(peer.pid);
      this.fillBots();
      this.broadcastRoster();
    }
    // keep teams at the bot fill level: each team has at least `bots` players
    fillBots() {
      const want = this.settings.bots;
      for (let team = 0; team < 2; team++) {
        let n = [...this.world.players.values()].filter(p => p.team === team).length;
        while (n < want) {
          const pid = this.freePid(); if (pid < 0) break;
          const name = Bots.name(this.world, pid);
          const used = new Set([...this.world.players.values()].filter(q => q.bot && q.team === team).map(q => q.botSlot));
          let slot = 0; while (used.has(slot)) slot++;
          const p = this.world.addPlayer({ id: pid, name, team, bot: true, loadout: Bots.loadout(slot) });
          p.skill = this.settings.skill; p.botSlot = slot;
          this.bots.set(pid, Bots.create(p));
          n++;
        }
        // too many bots on this team: drop some
        let extra = n - want;
        for (const p of [...this.world.players.values()].filter(q => q.team === team && q.bot).sort((a, b) => b.botSlot - a.botSlot)) {
          if (extra <= 0) break;
          this.world.removePlayer(p.id); this.bots.delete(p.id); extra--;
        }
      }
      for (const p of this.world.players.values()) if (p.bot && !this.bots.has(p.id)) this.bots.set(p.id, Bots.create(p));
    }
    dropBotFor(team) {
      const t = team === 0 || team === 1 ? team : this.world.smallerTeam();
      const bots = [...this.world.players.values()].filter(p => p.bot && p.team === t).sort((a, b) => b.botSlot - a.botSlot);
      if (bots.length) { this.world.removePlayer(bots[0].id); this.bots.delete(bots[0].id); }
    }
    roster() {
      return [...this.world.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, bot: p.bot ? 1 : 0, k: p.kills, d: p.deaths, c: p.caps, s: p.score, ping: this.pingOf(p.id) }));
    }
    pingOf(pid) { for (const pe of this.peers.values()) if (pe.pid === pid) return pe.ping | 0; return 0; }
    broadcastRoster() {
      const msg = encodeCtrl({ t: 'roster', list: this.roster(), score: this.world.score });
      for (const peer of this.peers.values()) this.send(peer.id, msg, true);
    }

    // bytes from a peer
    receive(peerId, bytes) {
      let r;
      try {
        r = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        const type = r.u8();
        if (type === T.CTRL) return this.ctrl(peerId, decodeCtrl(r));
        if (type === T.INPUT) return this.inputs(peerId, decodeInputs(r));
      } catch (e) { /* junk: drop it */ }
    }
    inputs(peerId, m) {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      if (m.ackEv > peer.ackEv && m.ackEv <= this.world.evSeq) peer.ackEv = m.ackEv;
      if (m.ackSnap > peer.ackSnap && m.ackSnap <= this.world.tick) {
        peer.ackSnap = m.ackSnap;
        const sent = peer.sentAt && peer.sentAt.get(m.ackSnap);
        if (sent != null) peer.ping = Math.round((peer.ping || 0) * 0.8 + (this.now() - sent) * 0.2);
      }
      for (const q of m.list) {
        if (q.seq <= peer.lastSeq) continue;
        if (peer.lastSeq >= 0 && q.seq > peer.lastSeq + 120) { peer.lastSeq = q.seq - 1; peer.inputs = []; } // a jump: start over
        if (peer.inputs.length < 30 && (!peer.inputs.length || q.seq > peer.inputs[peer.inputs.length - 1].seq)) peer.inputs.push(q);
      }
    }
    now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
    ctrl(peerId, m) {
      if (m.t === 'hello') { if (!this.peers.has(peerId)) this.join(peerId, m); return; }
      const peer = this.peers.get(peerId);
      if (!peer) return;
      const p = this.world.players.get(peer.pid);
      if (!p) return;
      if (m.t === 'loadout') { const lo = JF.cleanLoadout(m.loadout); if (lo) p.loadout = lo; }
      else if (m.t === 'team') { if ((m.team === 0 || m.team === 1) && m.team !== p.team) { this.dropBotFor(m.team); this.world.setTeam(p.id, m.team); this.fillBots(); this.broadcastRoster(); } }
      else if (m.t === 'chat') {
        const text = String(m.text == null ? '' : m.text).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140);
        const last = this.chatT.get(peerId) || 0;
        if (!text || this.world.time - last < 0.6) return;
        this.chatT.set(peerId, this.world.time);
        this.world.ev({ k: 'chat', id: p.id, name: p.name, text, team: m.team ? p.team : null });
      } else if (m.t === 'kill') { if (p.alive) this.world.kill(p, null, 'suicide'); }
      else if (m.t === 'host' && peerId === 0) this.hostCmd(m);
    }
    // settings changes from the host's own menu
    hostCmd(m) {
      if (m.cmd === 'settings') {
        const s = cleanSettings(Object.assign({}, this.settings, m.settings));
        const remake = s.map !== this.settings.map || s.caps !== this.settings.caps || s.minutes !== this.settings.minutes;
        this.settings = s;
        if (remake && m.restart) this.newWorld();
        else { for (const p of this.world.players.values()) if (p.bot) p.skill = s.skill; this.fillBots(); this.broadcastRoster(); }
      } else if (m.cmd === 'restart') this.newWorld();
      else if (m.cmd === 'kick' && this.opts.kick) { for (const pe of this.peers.values()) if (pe.pid === m.pid && pe.id !== 0) this.opts.kick(pe.id); }
    }

    // real time passed: run whole ticks
    update(dt) {
      this.acc += Math.min(dt, 0.25);
      let n = 0;
      while (this.acc >= TICK && n < 8) { this.acc -= TICK; this.tickOnce(); n++; }
      if (n === 8) this.acc = 0;
    }
    tickOnce() {
      const w = this.world;
      // players' inputs: about one per tick each, a few more to catch up after a hiccup
      for (const peer of this.peers.values()) {
        const p = w.players.get(peer.pid);
        peer.budget = Math.min(peer.budget + 1, 10);
        let ran = 0;
        while (peer.inputs.length && peer.budget >= 1 && ran < 4) {
          const q = peer.inputs.shift();
          peer.lastSeq = q.seq;
          peer.budget--; ran++;
          if (p) { p.firing = (q.b & B.FIRE) !== 0 && p.alive; w.applyInput(p, q); }
        }
      }
      for (const [pid, bot] of this.bots) {
        const p = w.players.get(pid);
        if (!p) { this.bots.delete(pid); continue; }
        const q = Bots.think(bot, w, p);
        p.firing = (q.b & B.FIRE) !== 0 && p.alive;
        w.applyInput(p, q);
      }
      w.step();
      if (w.over) {
        this.overT += TICK;
        if (this.overT > 12) { this.settings.map = nextMap(this.settings); this.newWorld(); return; }
      }
      if (w.tick % SNAP_EVERY === 0) this.snapshots();
      if (w.tick % 60 === 0) this.broadcastRoster();
    }
    snapshots() {
      const w = this.world;
      const extra = w.over ? { overIn: Math.max(0, Math.ceil(12 - this.overT)), next: MAP_NAME(nextMap(this.settings)) } : null;
      for (const peer of this.peers.values()) {
        const bytes = encodeSnap(w, peer.pid, peer.lastSeq, peer.ackEv, extra);
        if (!peer.sentAt) peer.sentAt = new Map();
        peer.sentAt.set(w.tick, this.now());
        if (peer.sentAt.size > 40) peer.sentAt.delete(peer.sentAt.keys().next().value);
        this.send(peer.id, bytes, false);
      }
    }
    listing() {
      const humans = [...this.world.players.values()].filter(p => !p.bot).length;
      return { map: this.world.mapKey, n: humans, bots: this.world.players.size - humans, score: this.world.score, v: PROTO };
    }
  }
  const MAP_NAME = k => JF.MAPS[k].name;
  function nextMap(s) {
    if (!s.rotate) return s.map;
    const i = JF.MAP_KEYS.indexOf(s.map);
    return JF.MAP_KEYS[(i + 1) % JF.MAP_KEYS.length];
  }
  function cleanSettings(s) {
    return {
      map: has(JF.MAPS, s.map) ? s.map : 'highland',
      bots: clamp(Number.isInteger(s.bots) ? s.bots : 4, 0, 12),
      skill: clamp(Number.isFinite(s.skill) ? s.skill : 0.5, 0, 1),
      caps: clamp(Number.isInteger(s.caps) ? s.caps : 5, 1, 20),
      minutes: clamp(Number.isInteger(s.minutes) ? s.minutes : 20, 3, 60),
      rotate: s.rotate !== false,
    };
  }

  // ---------- client ----------
  // The client's own player is predicted; everything else comes from snapshots.
  class Client {
    constructor(opts) {
      this.send = opts.send;
      this.name = opts.name;
      this.loadout = opts.loadout;
      this.seq = 0;
      this.pending = [];
      this.snaps = [];           // recent snapshots, oldest first
      this.ackEv = 0; this.ackSnap = 0;
      this.events = [];          // new events for the page to show
      this.welcome = null;
      this.world = null;         // geometry for prediction (terrain + bases); no players
      this.me = null;            // predicted own player
      this.acc = 0;
      this.estTick = 0;
      this.roster = []; this.score = [0, 0];
      this.err = [0, 0, 0];      // visual correction that fades out
      this.sentList = [];
      this.status = 'connecting';
      this.lastSnapAt = 0;
      this.weaponWant = 255;
      this.localShots = [];
    }
    hello(team) { this.send(encodeCtrl({ t: 'hello', v: PROTO, name: this.name, loadout: this.loadout, team }), true); }
    ctrl(m) { this.send(encodeCtrl(m), true); }

    receive(bytes) {
      let r, type;
      try { r = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); type = r.u8(); } catch (e) { return; }
      try {
        if (type === T.CTRL) this.onCtrl(decodeCtrl(r));
        else if (type === T.SNAP) this.onSnap(decodeSnap(r));
      } catch (e) { /* drop a bad packet */ }
    }
    onCtrl(m) {
      if (m.t === 'welcome') {
        if (!has(JF.MAPS, m.map)) return;
        const fresh = !this.welcome || this.welcome.map !== m.map || !this.world || this.welcome.you !== m.you || m.ev !== this.welcome.ev;
        this.welcome = m;
        this.settings = m.settings;
        if (fresh) {
          this.world = new JF.World({ map: m.map });
          this.world.damage = null;
          this.snaps = []; this.pending = []; this.me = null;
          this.ackEv = m.ev | 0;
          this.events.push({ k: 'map', map: m.map });
        }
        this.status = 'playing';
      } else if (m.t === 'roster' && Array.isArray(m.list)) {
        this.roster = m.list.filter(x => x && typeof x === 'object').map(x => ({ id: x.id | 0, name: JF.cleanName(x.name), team: x.team ? 1 : 0, bot: !!x.bot, k: x.k | 0, d: x.d | 0, c: x.c | 0, s: x.s | 0, ping: x.ping | 0 }));
        if (Array.isArray(m.score)) this.score = [m.score[0] | 0, m.score[1] | 0];
      } else if (m.t === 'refused') { this.status = 'refused'; this.refused = String(m.why || ''); }
    }
    onSnap(s) {
      if (!this.welcome) return;
      if (this.snaps.length && s.tick <= this.snaps[this.snaps.length - 1].tick) return; // old or repeated
      this.snaps.push(s);
      while (this.snaps.length > 30) this.snaps.shift();
      this.ackSnap = s.tick;
      this.lastSnapAt = nowMs();
      // a smooth guess of the host's clock
      if (!this.estTick || Math.abs(this.estTick - s.tick) > 30) this.estTick = s.tick;
      else this.estTick += (s.tick - this.estTick) * 0.1;
      this.score = s.score;
      for (const e of s.events) {
        if (!e || typeof e.s !== 'number' || e.s <= this.ackEv) continue;
        this.ackEv = e.s;
        this.events.push(e);
      }
      this.reconcile(s);
    }
    // put my player where the host says, then redo the moves the host has not seen yet
    reconcile(s) {
      const sp = s.players.find(p => p.id === s.you);
      if (!sp || !s.me) { this.me = null; return; }
      const before = this.me && this.me.alive ? this.me.pos.slice() : null;
      const step = before && this.prevPos ? [before[0] - this.prevPos[0], before[1] - this.prevPos[1], before[2] - this.prevPos[2]] : [0, 0, 0];
      const m = this.me && this.me.id === s.you ? this.me : JF.newPlayer(s.you, this.name, sp.team, false);
      m.team = sp.team; m.alive = sp.alive; m.armor = sp.armor;
      m.pos = sp.pos.slice(); m.vel = s.me.vel.slice();
      m.energy = s.me.energy; m.hp = s.me.hp; m.prevB = s.me.prevB;
      m.ground = s.me.ground; m.wasJet = s.me.wasJet; m.shieldOn = s.me.shieldOn; m.kick = s.me.kick; m.gn = s.me.gn;
      m.pack = s.me.pack; m.weapons = s.me.weapons; m.ammo = s.me.ammo; m.wi = s.me.wi; m.grenades = s.me.grenades;
      m.stationT = s.me.stationT; m.stationId = s.me.stationId; m.deadT = s.me.deadT; m.fireCd = s.me.fireCd; m.spin = s.me.spin;
      m.flag = s.me.flag; m.loadout = s.me.loadout; m.wantSpawn = s.me.wantSpawn;
      m.yaw = sp.yaw; m.pitch = sp.pitch;
      this.pending = this.pending.filter(q => q.seq > s.ack);
      if (m.alive) for (const q of this.pending) JF.movePlayer(this.world, m, q, TICK), m.prevB = q.b;
      this.me = m;
      if (before && m.alive) {
        const d = [before[0] - m.pos[0] + this.err[0], before[1] - m.pos[1] + this.err[1], before[2] - m.pos[2] + this.err[2]];
        // small differences are smoothed away; a big one (teleport, respawn) is taken at once
        if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 16) this.err = d; else this.err = [0, 0, 0];
      } else this.err = [0, 0, 0];
      this.prevPos = [m.pos[0] - step[0], m.pos[1] - step[1], m.pos[2] - step[2]];
    }

    // called every frame with the controls; runs fixed ticks
    update(dt, controls) {
      if (!this.welcome) return;
      this.acc += Math.min(dt, 0.25);
      this.estTick += dt * 60;
      const k = Math.exp(-dt * 12);
      this.err = [this.err[0] * k, this.err[1] * k, this.err[2] * k];
      let n = 0;
      while (this.acc >= TICK && n < 8) {
        this.acc -= TICK; n++;
        const q = quantize({ seq: ++this.seq, b: controls.b, mx: controls.mx, mz: controls.mz, yaw: controls.yaw, pitch: controls.pitch, w: controls.w });
        this.pending.push(q);
        if (this.pending.length > 180) this.pending.shift();
        this.sentList.push(q);
        if (this.me && this.me.alive) {
          this.prevPos = this.me.pos.slice();
          JF.movePlayer(this.world, this.me, q, TICK);
          this.predictTools(this.me, q);
          this.me.prevB = q.b;
        } else if (this.me) { this.me.yaw = q.yaw; this.me.pitch = q.pitch; }
        // send every tick, with the last few inputs again in case one was lost
        const list = this.sentList.slice(-(controls.redundancy || 4));
        if (this.sentList.length > 16) this.sentList.splice(0, this.sentList.length - 16);
        if (n === 1 || this.seq % (controls.sendEvery || 1) === 0) this.send(encodeInputs(list, this.ackEv, this.ackSnap), false);
      }
      if (n === 8) this.acc = 0;
    }
    // what the page needs to show my own shots straight away (the host still decides what they hit)
    predictTools(p, q) {
      if (q.w !== 255 && q.w < p.weapons.length && q.w !== p.wi) { p.wi = q.w; p.switchT = 0.3; }
      if (p.fireCd > 0) p.fireCd -= TICK;
      if (p.switchT > 0) p.switchT -= TICK;
      const wk = p.weapons[p.wi], W = wk && WEAPONS[wk];
      const fire = (q.b & B.FIRE) !== 0;
      if (W && W.spin) p.spin = fire ? Math.min(W.spin, p.spin + TICK) : Math.max(0, p.spin - TICK * 0.6);
      if (W && fire && p.switchT <= 0 && p.fireCd <= 0 && W.kind === 'proj' && (!W.spin || p.spin >= W.spin)) {
        if (W.ammo > 0 && (p.ammo[wk] | 0) <= 0) return;
        if (W.energy && p.energy < W.energy) return;
        p.fireCd = W.cd;
        this.localShots.push({ kind: wk, pos: JF.eye(p), yaw: p.yaw, pitch: p.pitch, vel: p.vel.slice() });
      }
    }

    // the interpolated picture of the world for drawing
    view() {
      if (!this.snaps.length) return null;
      const t = this.estTick - INTERP_TICKS;
      let a = this.snaps[0], b = null;
      for (let i = this.snaps.length - 1; i >= 0; i--) {
        if (this.snaps[i].tick <= t) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
      }
      const last = this.snaps[this.snaps.length - 1];
      const f = b ? clamp((t - a.tick) / (b.tick - a.tick), 0, 1) : 0;
      const players = [];
      for (const pa of a.players) {
        const pb = b && b.players.find(x => x.id === pa.id);
        let pos = pa.pos, yaw = pa.yaw, pitch = pa.pitch;
        if (pb && pb.alive === pa.alive) {
          const dx = pb.pos[0] - pa.pos[0], dy = pb.pos[1] - pa.pos[1], dz = pb.pos[2] - pa.pos[2];
          if (dx * dx + dy * dy + dz * dz < 900) pos = [pa.pos[0] + dx * f, pa.pos[1] + dy * f, pa.pos[2] + dz * f];
          else pos = f < 0.5 ? pa.pos : pb.pos;
          let dyaw = pb.yaw - pa.yaw; if (dyaw > Math.PI) dyaw -= Math.PI * 2; if (dyaw < -Math.PI) dyaw += Math.PI * 2;
          yaw = pa.yaw + dyaw * f; pitch = pa.pitch + (pb.pitch - pa.pitch) * f;
        } else if (!b) {
          // no newer snapshot yet: carry on a little
          const ex = clamp(t - a.tick, 0, 6) * TICK;
          pos = [pa.pos[0] + pa.vel[0] * ex, pa.pos[1] + pa.vel[1] * ex, pa.pos[2] + pa.vel[2] * ex];
        }
        const src = pb && f > 0.5 ? pb : pa;
        players.push(Object.assign({}, src, { pos, yaw, pitch }));
      }
      // projectiles: between the two snapshots too, so they line up with the players
      const proj = [];
      for (const qa of a.proj) {
        const qb = b && b.proj.find(x => x.id === qa.id);
        const pos = qb ? [qa.pos[0] + (qb.pos[0] - qa.pos[0]) * f, qa.pos[1] + (qb.pos[1] - qa.pos[1]) * f, qa.pos[2] + (qb.pos[2] - qa.pos[2]) * f] : extrap(qa, (t - a.tick) * TICK);
        proj.push({ id: qa.id, kind: qa.kind, owner: qa.owner, shot: qa.shot, pos, vel: qa.vel });
      }
      const flags = a.flags.map((fa, i) => {
        const fb = b && b.flags[i];
        if (fb && fb.state === fa.state) return Object.assign({}, fa, { pos: [fa.pos[0] + (fb.pos[0] - fa.pos[0]) * f, fa.pos[1] + (fb.pos[1] - fa.pos[1]) * f, fa.pos[2] + (fb.pos[2] - fa.pos[2]) * f] });
        return fa;
      });
      return { tick: t, players, proj, flags, objects: last.objects, score: last.score, timeLeft: last.timeLeft, over: last.over, extra: last.extra, you: last.you };
    }
    // where my own player is drawn: predicted, with the last correction fading out
    // a = how far into the next tick we are (0..1), so the camera moves smoothly at any frame rate
    myPos(a) {
      if (!this.me) return null;
      const p = this.me.pos, q = this.prevPos || p;
      if (a == null) a = clamp(this.acc / TICK, 0, 1);
      return [q[0] + (p[0] - q[0]) * a + this.err[0], q[1] + (p[1] - q[1]) * a + this.err[1], q[2] + (p[2] - q[2]) * a + this.err[2]];
    }
    takeEvents() { const e = this.events; this.events = []; return e; }
    takeShots() { const s = this.localShots; this.localShots = []; return s; }
  }
  function extrap(q, dt) {
    const W = PROJ[q.kind];
    const g = W && W.grav ? JF.GRAV : 0;
    return [q.pos[0] + q.vel[0] * dt, q.pos[1] + q.vel[1] * dt - 0.5 * g * dt * dt, q.pos[2] + q.vel[2] * dt];
  }
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const api = { PROTO, T, SNAP_EVERY, INTERP_TICKS, MAX_PLAYERS, Writer, Reader, encodeCtrl, quantize, encodeInputs, decodeInputs, encodeSnap, decodeSnap, Host, Client, cleanSettings, nextMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JFNet = api;
})(typeof window !== 'undefined' ? window : globalThis);
