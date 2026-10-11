/*
 * Serverless peer-to-peer links over WebRTC data channels.
 * No signaling server: the host and each friend swap one short code by hand (chat, text, whatever).
 * The only outside help is a public STUN server so browsers can find each other across NAT.
 * Star topology: the host holds a channel to every guest.
 */
(function (root) {
  'use strict';

  const CHUNK = 16000;
  const ICE_WAIT_MS = 5000;

  // ---------- invite codes ----------

  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function pipe(bytes, stream) {
    const w = stream.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }

  async function pack(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'undefined') return 'r.' + b64url(bytes);
    return 'z.' + b64url(await pipe(bytes, new CompressionStream('deflate-raw')));
  }

  async function unpack(code) {
    try {
      code = String(code).trim().replace(/\s+/g, '');
      const kind = code.slice(0, 2), body = unb64url(code.slice(2));
      let bytes;
      if (kind === 'r.') bytes = body;
      else if (kind === 'z.') bytes = await pipe(body, new DecompressionStream('deflate-raw'));
      else throw new Error('bad prefix');
      const obj = JSON.parse(new TextDecoder().decode(bytes));
      if (!obj || obj.v !== 1 || typeof obj.sdp !== 'string' || !['offer', 'answer'].includes(obj.type)) throw new Error('bad shape');
      return obj;
    } catch (e) {
      throw new Error('That code does not look right. Copy it again in full.');
    }
  }

  // ---------- connections ----------

  function makePC() {
    const ice = root.P2P_ICE || [{ urls: 'stun:stun.l.google.com:19302' }];
    return new RTCPeerConnection({ iceServers: ice });
  }

  function gathered(pc) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(done, ICE_WAIT_MS);
    });
  }

  // Wraps a data channel: JSON messages, chunked so big game states fit.
  function wire(dc, emit) {
    let buf = null, nextId = 1;
    dc.onopen = () => emit('open');
    dc.onclose = () => emit('close');
    dc.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && m.$c) {
        if (!buf || buf.id !== m.id) buf = { id: m.id, parts: [] };
        buf.parts[m.i] = m.d;
        if (buf.parts.length === m.n && buf.parts.every(p => p !== undefined)) {
          const whole = buf.parts.join(''); buf = null;
          try { emit('message', JSON.parse(whole)); } catch (e) { /* drop garbage */ }
        }
      } else emit('message', m);
    };
    return msg => {
      if (dc.readyState !== 'open') return false;
      const text = JSON.stringify(msg);
      if (text.length <= CHUNK) { dc.send(text); return true; }
      const id = nextId++, n = Math.ceil(text.length / CHUNK);
      for (let i = 0; i < n; i++) dc.send(JSON.stringify({ $c: 1, id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
      return true;
    };
  }

  function emitter() {
    const subs = {};
    return {
      on(ev, fn) { (subs[ev] = subs[ev] || []).push(fn); return this; },
      emit(ev, ...a) { (subs[ev] || []).forEach(fn => fn(...a)); },
    };
  }

  // ---------- host ----------

  function host(opts) {
    const maxGuests = (opts && opts.maxGuests) || 3;
    const ev = emitter(), peers = new Map();
    let nextId = 1;

    const net = {
      role: 'host', maxGuests, on: ev.on.bind(ev),
      peers,
      async invite() {
        const open = [...peers.values()].filter(p => p.state !== 'closed').length;
        if (open >= maxGuests) throw new Error('Room is full.');
        const id = nextId++, pc = makePC(), dc = pc.createDataChannel('game');
        const peer = { id, pc, dc, state: 'inviting', send: null };
        peers.set(id, peer);
        peer.send = wire(dc, (e, m) => {
          if (e === 'open') { peer.state = 'open'; ev.emit('open', id); }
          else if (e === 'close') { if (peer.state !== 'closed') { peer.state = 'closed'; ev.emit('close', id); } }
          else ev.emit('message', id, m);
        });
        pc.onconnectionstatechange = () => {
          if (['failed', 'closed'].includes(pc.connectionState) && peer.state !== 'closed') { peer.state = 'closed'; ev.emit('close', id); }
        };
        await pc.setLocalDescription(await pc.createOffer());
        await gathered(pc);
        return { id, code: await pack({ v: 1, type: 'offer', sdp: pc.localDescription.sdp }) };
      },
      async accept(id, code) {
        const peer = peers.get(id);
        if (!peer) throw new Error('Unknown invite.');
        const a = await unpack(code);
        if (a.type !== 'answer') throw new Error('That is an invite, not a reply. Paste the friend\'s reply code.');
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
      },
      send(id, msg) { const p = peers.get(id); return p && p.state === 'open' ? p.send(msg) : false; },
      broadcast(msg) { for (const p of peers.values()) if (p.state === 'open') p.send(msg); },
      kick(id) { const p = peers.get(id); if (p) { try { p.pc.close(); } catch (e) { /* ignore */ } if (p.state !== 'closed') { p.state = 'closed'; ev.emit('close', id); } } },
      close() { for (const id of [...peers.keys()]) net.kick(id); },
    };
    return net;
  }

  // ---------- guest ----------

  function guest() {
    const ev = emitter();
    let pc = null, send = null, state = 'new';
    const net = {
      role: 'guest', on: ev.on.bind(ev),
      get state() { return state; },
      async join(code) {
        const o = await unpack(code);
        if (o.type !== 'offer') throw new Error('That is a reply, not an invite. Paste the host\'s invite code.');
        pc = makePC();
        pc.ondatachannel = e => {
          send = wire(e.channel, (t, m) => {
            if (t === 'open') { state = 'open'; ev.emit('open'); }
            else if (t === 'close') { if (state !== 'closed') { state = 'closed'; ev.emit('close'); } }
            else ev.emit('message', m);
          });
        };
        pc.onconnectionstatechange = () => {
          if (['failed', 'closed'].includes(pc.connectionState) && state !== 'closed') { state = 'closed'; ev.emit('close'); }
        };
        await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        return pack({ v: 1, type: 'answer', sdp: pc.localDescription.sdp });
      },
      send(msg) { return send ? send(msg) : false; },
      close() { if (pc) try { pc.close(); } catch (e) { /* ignore */ } },
    };
    return net;
  }

  root.P2P = { host, guest, pack, unpack };
})(typeof window !== 'undefined' ? window : globalThis);
