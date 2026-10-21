/*
 * Jetfall connections. Browser only.
 *
 * Everyone first connects to the relay on the elf-punch server (WebSocket, `/jetfall`): it finds rooms, passes
 * WebRTC offers and answers along, and carries game packets until a direct connection is up. Then the game
 * switches to two WebRTC data channels per guest: one unreliable (snapshots and inputs: a late packet is useless)
 * and one reliable (chat, roster, welcome). If WebRTC never connects (strict networks), the relay keeps carrying it all.
 */
(function (root) {
  'use strict';

  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];

  function relayUrl() {
    const q = new URLSearchParams(location.search).get('relay');
    if (q && /^wss?:\/\//.test(q)) return q;
    const base = root.KV_URL || 'https://elf-castle-wood-puncher.fly.dev';
    return base.replace(/^http/, 'ws') + '/jetfall';
  }

  function emitter() {
    const subs = {};
    return { on(ev, fn) { (subs[ev] = subs[ev] || []).push(fn); }, emit(ev, ...a) { (subs[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } }); } };
  }

  // A connection to the relay. role: null until host() or join().
  function connect(url) {
    url = url || relayUrl();
    const ev = emitter();
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const link = {
      role: null, room: null, id: null, on: ev.on, peers: new Map(), rtcHost: null, closed: false,
      ready: new Promise((res, rej) => {
        ws.onopen = () => res();
        ws.onerror = () => rej(new Error('Could not reach the game server.'));
        setTimeout(() => rej(new Error('The game server did not answer.')), 9000);
      }),
    };
    let waiting = null;
    const ask = (msg, want) => new Promise((res, rej) => {
      waiting = { want, res, rej };
      ws.send(JSON.stringify(msg));
      setTimeout(() => { if (waiting && waiting.want === want) { waiting = null; rej(new Error('The game server did not answer.')); } }, 8000);
    });
    const ping = setInterval(() => { if (ws.readyState === 1) ws.send('{"t":"ping"}'); }, 15000);
    ws.onclose = () => { clearInterval(ping); link.closed = true; ev.emit('closed', link.closeWhy || 'lost'); };
    ws.onmessage = m => {
      if (typeof m.data !== 'string') {
        const u = new Uint8Array(m.data);
        if (u.length < 2) return;
        const from = (u[0] << 8) | u[1];
        ev.emit('data', from, u.subarray(2));
        return;
      }
      let msg; try { msg = JSON.parse(m.data); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (waiting && (msg.t === waiting.want || msg.t === 'error')) {
        const w = waiting; waiting = null;
        if (msg.t === 'error') { const err = new Error(errorText(msg.why)); err.why = String(msg.why || ''); w.rej(err); } else w.res(msg);
        return;
      }
      if (msg.t === 'peer') { ev.emit('peer', msg.id | 0, String(msg.name || '')); if (link.role === 'host') startRtc(msg.id | 0); }
      else if (msg.t === 'left') { dropRtc(msg.id | 0); ev.emit('left', msg.id | 0); }
      else if (msg.t === 'closed') { link.closeWhy = 'host-left'; }
      else if (msg.t === 'error' && msg.why === 'kicked') { link.closeWhy = 'kicked'; }
      else if (msg.t === 'sig') onSig(msg.from | 0, msg.d);
    };

    // ---- raw relay send ----
    function relaySend(to, bytes) {
      if (ws.readyState !== 1) return;
      const out = new Uint8Array(bytes.length + 2);
      out[0] = to >> 8; out[1] = to & 255; out.set(bytes, 2);
      ws.send(out);
    }

    // ---- WebRTC ----
    // peer record: { pc, u, r, open }
    function wireChannel(peerId, rec, dc) {
      dc.binaryType = 'arraybuffer';
      dc.onopen = () => { rec[dc.label] = dc; rec.open = !!(rec.u && rec.r && rec.u.readyState === 'open' && rec.r.readyState === 'open'); if (rec.open) ev.emit('rtc', peerId, true); };
      dc.onclose = () => { if (rec.open) { rec.open = false; ev.emit('rtc', peerId, false); } };
      dc.onmessage = e => ev.emit('data', peerId, new Uint8Array(e.data));
    }
    function newPc(peerId) {
      if (typeof RTCPeerConnection === 'undefined') return null;
      const pc = new RTCPeerConnection({ iceServers: root.JF_ICE || ICE });
      const rec = { pc, u: null, r: null, open: false };
      pc.onicecandidate = e => { if (e.candidate) ws.send(JSON.stringify({ t: 'sig', to: peerId, d: { ice: e.candidate.toJSON() } })); };
      pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && rec.open) { rec.open = false; ev.emit('rtc', peerId, false); } };
      link.peers.set(peerId, rec);
      return rec;
    }
    async function startRtc(peerId) {
      if (root.JF_NO_RTC) return;
      const rec = newPc(peerId); if (!rec) return;
      wireChannel(peerId, rec, rec.pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
      wireChannel(peerId, rec, rec.pc.createDataChannel('r', { ordered: true }));
      try {
        await rec.pc.setLocalDescription(await rec.pc.createOffer());
        ws.send(JSON.stringify({ t: 'sig', to: peerId, d: { sdp: rec.pc.localDescription.toJSON() } }));
      } catch (e) { /* stay on the relay */ }
    }
    async function onSig(from, d) {
      if (!d || typeof d !== 'object' || root.JF_NO_RTC) return;
      let rec = link.peers.get(from);
      try {
        if (d.sdp && typeof d.sdp === 'object' && typeof d.sdp.sdp === 'string') {
          if (d.sdp.type === 'offer' && link.role === 'guest') {
            if (rec) try { rec.pc.close(); } catch (e) { /* ignore */ }
            rec = newPc(from); if (!rec) return;
            rec.pc.ondatachannel = e => wireChannel(from, rec, e.channel);
            await rec.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp.sdp });
            await rec.pc.setLocalDescription(await rec.pc.createAnswer());
            ws.send(JSON.stringify({ t: 'sig', to: from, d: { sdp: rec.pc.localDescription.toJSON() } }));
            for (const c of rec.early || []) await rec.pc.addIceCandidate(c);
          } else if (d.sdp.type === 'answer' && rec && link.role === 'host') {
            await rec.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp.sdp });
          }
        } else if (d.ice && typeof d.ice === 'object') {
          if (!rec) { rec = { early: [] }; link.peers.set(from, rec); }
          if (rec.pc && rec.pc.remoteDescription) await rec.pc.addIceCandidate(d.ice);
          else (rec.early = rec.early || []).push(d.ice);
        }
      } catch (e) { /* a bad signal: stay on the relay */ }
    }
    function dropRtc(peerId) {
      const rec = link.peers.get(peerId);
      if (rec && rec.pc) try { rec.pc.close(); } catch (e) { /* ignore */ }
      link.peers.delete(peerId);
    }

    link.send = (to, bytes, reliable) => {
      const rec = link.peers.get(to);
      if (rec && rec.open) {
        const dc = reliable ? rec.r : rec.u;
        try {
          // a full unreliable buffer means the line is slow: drop rather than queue old snapshots
          if (!reliable && dc.bufferedAmount > 64000) return;
          dc.send(bytes); return;
        } catch (e) { /* fall back to the relay */ }
      }
      relaySend(to, bytes);
    };
    link.direct = to => { const rec = link.peers.get(to); return !!(rec && rec.open); };
    link.list = async () => { await link.ready; const r = await ask({ t: 'list' }, 'rooms'); return Array.isArray(r.rooms) ? r.rooms : []; };
    // room: a fixed server's code to claim it (the relay says 'taken' if someone already has)
    link.host = async (name, info, room) => {
      await link.ready;
      const r = await ask(room ? { t: 'host', name, info, room } : { t: 'host', name, info }, 'hosted');
      link.role = 'host'; link.room = String(r.room); link.id = 0;
      return r;
    };
    link.join = async (room, name) => {
      await link.ready;
      const r = await ask({ t: 'join', room: String(room).toUpperCase(), name }, 'joined');
      link.role = 'guest'; link.room = String(r.room); link.id = r.id | 0;
      return r;
    };
    link.info = info => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'info', info })); };
    link.kick = id => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'kick', id })); };
    link.close = () => { link.closeWhy = 'closed'; for (const id of [...link.peers.keys()]) dropRtc(id); try { ws.close(); } catch (e) { /* ignore */ } };
    return link;
  }

  function errorText(why) {
    return ({ 'no-room': 'No game with that code. It may have ended.', full: 'That game is full.', taken: 'Someone just started that server.', idle: 'Nobody is on that server yet.', busy: 'The server is busy. Try again in a bit.', kicked: 'The host removed you.', already: 'Already in a game.', 'bad-info': 'Bad game info.' })[why] || 'The game server said no (' + String(why).slice(0, 30) + ').';
  }

  // people a room holds: the host plus the relay's guest limit (JF_ROOM_MAX, 15 by default)
  const SEATS = 16;

  root.JFLink = { connect, relayUrl, errorText, SEATS };
})(window);
