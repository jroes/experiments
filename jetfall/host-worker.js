/*
 * The host's game runs here, off the page's main thread, on its own clock. So a slow frame, or the host
 * switching to another tab, does not slow the game down for everyone else.
 *
 * In:  { t: 'start', settings, room } · { t: 'recv', peer, bytes } · { t: 'leave', peer }
 * Out: { t: 'send', peer, bytes, reliable } · { t: 'kick', peer } · { t: 'state', settings, listing, players }
 */
/* global importScripts, JFNet */
importScripts('sim.js', 'bots.js', 'vgs.js', 'net.js');

let host = null, last = 0, stateT = 0;

function send(peer, bytes, reliable) {
  const b = bytes.slice(); // the same packet can go to several peers, so each gets its own copy to hand over
  postMessage({ t: 'send', peer, bytes: b, reliable }, [b.buffer]);
}

function state() {
  const players = [...host.world.players.values()].map(p => {
    let peer = -1;
    for (const pe of host.peers.values()) if (pe.pid === p.id) peer = pe.id;
    return { id: p.id, name: p.name, team: p.team, bot: p.bot, peer };
  });
  postMessage({ t: 'state', settings: host.settings, listing: host.listing(), players });
}

onmessage = e => {
  const m = e.data;
  if (m.t === 'start') {
    host = new JFNet.Host({ settings: m.settings, room: m.room, send, kick: peer => postMessage({ t: 'kick', peer }) });
    last = performance.now();
    setInterval(() => {
      const t = performance.now();
      host.update((t - last) / 1000);
      last = t;
      if (t - stateT > 1000) { stateT = t; state(); }
    }, 8);
    state();
  } else if (!host) return;
  else if (m.t === 'recv') host.receive(m.peer, m.bytes);
  else if (m.t === 'leave') host.leave(m.peer);
};
