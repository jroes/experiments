(function () {
  'use strict';
  const G = window.Game;
  const SAVE_KEY = 'sectordominion-save-v1';
  const MAIL_KEY = 'sectordominion-mail-v1';
  const ONLINE_KEY = 'sectordominion-online-v1';
  const COLORS = ['#6b7a94', '#5ee0b0', '#ffb454', '#ff6b6b', '#b48cff'];

  const $ = id => document.getElementById(id);
  const canvas = $('map'), ctx = canvas.getContext('2d');

  const ui = {
    state: null,
    vis: new Set(),
    selected: null,
    hover: null,
    view: { scale: 1, ox: 0, oy: 0 },
    send: G.SHIP_ORDER.reduce((o, t) => (o[t] = 0, o), {}),
    targeting: false,
    me: G.PLAYER,   // which empire this browser controls
    net: null,      // P2P link when playing with friends
    seats: {},      // host only: peer id -> empire id
    started: false, // multiplayer game running
    online: null,   // async session through the shared store (online.js)
    onlineMsg: '',
    mailMsg: '',    // last message in the mail panel
    mail: null,     // play-by-mail session: { role: 'host'|'guest', cmds: [], sent: bool }
  };

  const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isGuest = () => !!ui.net && ui.net.role === 'guest';
  const multi = () => !!ui.net;
  const meEmp = () => G.empire(ui.state, ui.me);
  const mem = () => ui.state.known[ui.me] || {};

  // ---------- save / load (single player only) ----------

  function save() {
    if (multi()) return;
    try {
      if (ui.online) localStorage.setItem(ONLINE_KEY, JSON.stringify(ui.online));
      else if (ui.mail) localStorage.setItem(MAIL_KEY, JSON.stringify({ v: 1, mail: ui.mail, me: ui.me, state: ui.state }));
      else localStorage.setItem(SAVE_KEY, JSON.stringify(ui.state));
    } catch (e) { /* storage blocked, fine */ }
  }
  function loadMail() {
    try {
      const o = JSON.parse(localStorage.getItem(MAIL_KEY));
      return o && o.v === 1 && validState(o.state, o.me) && o.mail && (o.mail.role === 'host' || o.mail.role === 'guest') ? o : null;
    } catch (e) { return null; }
  }
  function loadOnline() {
    try { return Online.Session.fromSaved(JSON.parse(localStorage.getItem(ONLINE_KEY))); } catch (e) { return null; }
  }
  function clearOnline() { try { localStorage.removeItem(ONLINE_KEY); } catch (e) { /* ignore */ } }
  function clearMail() { try { localStorage.removeItem(MAIL_KEY); } catch (e) { /* ignore */ } }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.version === 2 ? s : null;
    } catch (e) { return null; }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- state ----------

  function setState(s, seat) {
    ui.state = s;
    ui.me = seat || G.PLAYER;
    ui.selected = s.worlds.find(w => w.owner === ui.me)?.id ?? null;
    ui.targeting = false;
    canvas.classList.remove('targeting');
    resetSend();
    fitView();
    refresh();
  }

  function resetSend() { for (const t of G.SHIP_ORDER) ui.send[t] = 0; }

  function refresh() {
    ui.vis = G.visibleWorlds(ui.state, ui.me);
    renderTop(); renderMail(); renderWorld(); renderEmpire(); renderLog(); draw();
    const s = ui.state, b = $('banner'), alive = meEmp().alive;
    if (s.over) {
      b.hidden = false;
      b.innerHTML = (s.winner === ui.me ? '<b class="good">Victory.</b><br>The sector is yours.' :
        s.winner ? '<b class="bad">Defeat.</b><br>' + esc(G.empire(s, s.winner).name) + ' won.' :
          '<b class="bad">Defeat.</b><br>Your empire is gone.') +
        (multi() ? '' : '<br><button class="primary" id="b-again">New game</button>');
      if (!multi()) $('b-again').onclick = openNew;
    } else if (!alive) {
      b.hidden = false;
      b.innerHTML = '<b class="bad">Your empire is gone.</b><br><span class="dim">Spectating until the game ends.</span>';
    } else b.hidden = true;
  }

  // what this player is allowed to know about a world
  function info(w) {
    if (w.owner === ui.me || ui.vis.has(w.id)) return { live: true, owner: w.owner, pop: Math.floor(w.pop), fort: w.fort, natives: w.natives };
    const k = mem()[w.id];
    return k ? { live: false, owner: k.owner, pop: k.pop, fort: k.fort, natives: k.natives, seen: k.seen } : null;
  }

  const fleetVisible = f => G.fleetVisibleTo(ui.state, ui.me, f);

  // ---------- orders: local apply for solo/host, message to host for guests ----------

  function act(cmd) {
    const s = ui.state;
    if (ui.online) {
      const r = ui.online.act(cmd);
      if (r.ok) save();
      return r;
    }
    cmd = { ...cmd, turn: s.turn };
    if (ui.mail && ui.mail.role === 'guest') {
      if (ui.mail.sent) return { ok: false, msg: 'Orders already sent. Load the next turn file.' };
      const r = G.apply(s, ui.me, cmd);
      if (r.ok) { G.refreshKnown(s); ui.mail.cmds.push(stripTurn(cmd)); save(); }
      return r;
    }
    if (isGuest()) {
      if (!ui.net.send({ t: 'cmd', cmd })) return { ok: false, msg: 'Not connected to the host.' };
      return { ok: true, pending: true };
    }
    const res = G.apply(s, ui.me, cmd);
    if (res.ok && cmd.op !== 'unready') G.refreshKnown(s);
    if (res.ok && ui.net) broadcastState();
    save();
    return res;
  }

  const stripTurn = c => { const o = { ...c }; delete o.turn; return o; };

  function broadcastState() {
    ui.net.broadcast({ t: 'state', state: ui.state });
  }

  // ---------- top bar / panels ----------

  function renderTop() {
    const s = ui.state, e = meEmp();
    $('s-turn').textContent = s.turn;
    $('s-credits').textContent = Math.floor(e.credits);
    $('s-income').textContent = '+' + G.empireIncome(s, ui.me) + '/turn';
    $('s-tech').textContent = e.tech;
    $('s-worlds').textContent = s.worlds.filter(w => w.owner === ui.me).length;
    const end = $('b-end');
    end.disabled = !!s.over || !e.alive;
    if (multi() && !s.over && e.alive) {
      const people = s.empires.filter(x => x.human && x.alive);
      const ready = people.filter(x => s.ready[x.id]).length;
      end.textContent = s.ready[ui.me] ? 'Waiting (' + ready + '/' + people.length + ')' : 'End turn (' + ready + '/' + people.length + ')';
    } else if (ui.online) {
      end.textContent = ui.online.sent ? 'Orders sent' : 'Send orders';
      end.disabled = end.disabled || ui.online.sent || !!ui.onlineBusy;
    } else if (ui.mail && ui.mail.role === 'guest') {
      end.textContent = ui.mail.sent ? 'Orders sent' : 'Send orders';
      end.disabled = end.disabled || ui.mail.sent;
    } else if (ui.mail) {
      const people = s.empires.filter(x => x.human && x.alive), ready = people.filter(x => s.ready[x.id]).length;
      end.textContent = s.ready[ui.me] ? 'Ready (' + ready + '/' + people.length + ')' : 'End turn (' + ready + '/' + people.length + ')';
    } else end.textContent = 'End turn';
  }

  function shipLine(ships) {
    const parts = G.SHIP_ORDER.filter(t => ships[t]).map(t => ships[t] + ' ' + G.SHIPS[t].name + (ships[t] > 1 ? 's' : ''));
    return parts.length ? parts.join(', ') : 'none';
  }

  function ownerLabel(id) { return id ? esc(ui.state.empires[id - 1].name) + (id === ui.me ? ' (you)' : '') : 'Unclaimed'; }

  function renderWorld() {
    const el = $('p-world'), s = ui.state;
    if (ui.selected == null) { el.innerHTML = '<h3>No world selected</h3><p class="dim">Click a world on the map.</p>'; return; }
    const w = s.worlds[ui.selected], i = info(w);
    if (!i) { el.innerHTML = '<h3>Unexplored</h3>'; return; }
    const type = G.WORLD_TYPES[w.type].label, mine = w.owner === ui.me, frozen = s.over || !meEmp().alive;
    let h = '<h2>' + esc(w.name) + '<small>' + type + '</small></h2><div class="kv">';
    h += '<div>Owner</div><div style="color:' + COLORS[i.owner] + '">' + (i.natives && !i.owner ? 'Natives' : ownerLabel(i.owner)) + '</div>';
    h += '<div>Population</div><div>' + i.pop + ' / ' + w.cap + '</div>';
    h += '<div>Defense</div><div>' + (i.live || mine ? G.worldDefense(w) : '~' + (i.fort + Math.floor(i.pop / 25))) + '</div>';
    if (!i.live) h += '<div>Intel</div><div class="dim">Last seen turn ' + i.seen + '</div>';
    if (i.live && w.owner) h += '<div>Troops</div><div>' + w.troops + '</div>';
    if (mine) h += '<div>Income</div><div class="good">+' + Math.floor(G.worldIncome(s, w)) + '</div>';
    h += '</div>';

    if (i.live && !mine && w.garrison && G.shipCount(w.garrison)) {
      h += '<p>Garrison: ' + shipLine(w.garrison) + '</p>';
    }

    if (mine) {
      const e = meEmp();
      h += '<p>Garrison: ' + shipLine(w.garrison) + '</p>';
      if (w.queue.length) h += '<p class="dim">Building: ' + shipLine(w.queue.reduce((o, t) => (o[t] = (o[t] || 0) + 1, o), {})) + '</p>';
      h += '<h3>Build</h3><div class="btns">';
      for (const t of G.SHIP_ORDER) {
        const sh = G.SHIPS[t];
        h += '<button data-act="build" data-t="' + t + '" ' + (e.credits < sh.cost || frozen ? 'disabled' : '') +
          ' title="atk ' + sh.atk + ' hp ' + sh.hp + ' speed ' + sh.speed + '">' + sh.name + ' ' + sh.cost + '</button>';
      }
      h += '</div><div class="btns"><button data-act="fortify" ' + (w.fort >= 5 || e.credits < G.fortifyCost(w) || frozen ? 'disabled' : '') + '>' +
        (w.fort >= 5 ? 'Fully fortified' : 'Fortify ' + G.fortifyCost(w)) + '</button></div>';

      if (G.shipCount(w.garrison)) {
        h += '<h3>Dispatch fleet</h3>';
        for (const t of G.SHIP_ORDER) {
          if (!w.garrison[t]) continue;
          ui.send[t] = Math.min(ui.send[t], w.garrison[t]);
          h += '<div class="send-row"><span class="nm">' + G.SHIPS[t].name + '</span>' +
            '<button class="small" data-act="dec" data-t="' + t + '">-</button><span class="n">' + ui.send[t] + '</span>' +
            '<button class="small" data-act="inc" data-t="' + t + '">+</button>' +
            '<button class="small" data-act="all" data-t="' + t + '">all</button></div>';
        }
        const n = G.shipCount(ui.send);
        h += '<div class="btns"><button class="primary" data-act="target" ' + (n && !frozen ? '' : 'disabled') + '>' +
          (ui.targeting ? 'Click a world on the map...' : 'Choose destination') + '</button></div>';
        if (ui.targeting) h += '<p class="hint">Esc to cancel.</p>';
      }
    } else if (ui.vis.size) {
      const near = s.worlds.filter(x => x.owner === ui.me).sort((a, b) => G.dist(a, w) - G.dist(b, w))[0];
      if (near) h += '<p class="dim">' + Math.round(G.dist(near, w)) + ' units from ' + esc(near.name) + '.</p>';
    }
    el.innerHTML = h;
  }

  function renderEmpire() {
    const s = ui.state, e = meEmp(), el = $('p-empire');
    const cost = G.researchCost(s, ui.me), frozen = s.over || !e.alive;
    let h = '<h3>Empire</h3><div class="btns"><button data-act="research" ' +
      (e.tech >= G.MAX_TECH || e.credits < cost || frozen ? 'disabled' : '') + '>' +
      (e.tech >= G.MAX_TECH ? 'Tech maxed' : 'Research tech ' + (e.tech + 1) + ' (' + cost + ')') + '</button></div>';
    h += '<div class="kv">';
    for (const r of s.empires) {
      if (r.id === ui.me) continue;
      const tag = r.human ? 'player' : 'AI';
      const state = !r.alive ? 'eliminated' : (r.human && s.ready[r.id] ? 'ready' : 'active');
      h += '<div style="color:' + COLORS[r.id] + '">' + esc(r.name.split(' ')[0]) + '</div><div>' + tag + ', ' + state +
        (r.human && r.alive && ui.net && ui.net.role === 'host' ? ' <button class="small" data-act="drop" data-e="' + r.id + '" title="Hand this empire to the AI">drop</button>' : '') + '</div>';
    }
    h += '</div>';
    const mine = s.fleets.filter(f => f.owner === ui.me);
    if (mine.length) {
      h += '<h3 style="margin-top:8px">Fleets in transit</h3>';
      for (const f of mine) {
        h += '<div class="dim">' + G.shipCount(f.ships) + ' ships to ' + esc(s.worlds[f.to].name) + ', ' + G.eta(s, f) + ' turn' + (G.eta(s, f) > 1 ? 's' : '') + '</div>';
      }
    }
    el.innerHTML = h;
  }

  function renderLog() {
    $('log').innerHTML = ui.state.log.filter(l => !l.to || l.to.includes(ui.me)).slice(0, 60).map(l =>
      '<li class="' + esc(l.kind) + '"><b>T' + l.turn + '</b>' + esc(l.text) + '</li>').join('');
  }

  // ---------- map ----------

  function fitView() {
    const r = canvas.getBoundingClientRect();
    const s = ui.state;
    const scale = Math.min(r.width / (s.width + 6), r.height / (s.height + 6));
    ui.view.scale = scale;
    ui.view.ox = (r.width - s.width * scale) / 2;
    ui.view.oy = (r.height - s.height * scale) / 2;
  }

  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ui.state) { fitView(); draw(); }
  }

  const sx = x => ui.view.ox + x * ui.view.scale;
  const sy = y => ui.view.oy + y * ui.view.scale;

  function draw() {
    const s = ui.state;
    if (!s) return;
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    const sc = ui.view.scale;

    ctx.strokeStyle = '#142038'; ctx.lineWidth = 1;
    ctx.strokeRect(sx(0), sy(0), s.width * sc, s.height * sc);
    ctx.strokeStyle = '#0c1526';
    for (let x = 10; x < s.width; x += 10) { ctx.beginPath(); ctx.moveTo(sx(x), sy(0)); ctx.lineTo(sx(x), sy(s.height)); ctx.stroke(); }
    for (let y = 10; y < s.height; y += 10) { ctx.beginPath(); ctx.moveTo(sx(0), sy(y)); ctx.lineTo(sx(s.width), sy(y)); ctx.stroke(); }

    ctx.fillStyle = 'rgba(94,224,176,0.04)';
    for (const w of s.worlds) if (w.owner === ui.me) { ctx.beginPath(); ctx.arc(sx(w.x), sy(w.y), 30 * sc, 0, 7); ctx.fill(); }
    for (const f of s.fleets) if (f.owner === ui.me) { ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), 20 * sc, 0, 7); ctx.fill(); }

    for (const f of s.fleets) {
      if (!fleetVisible(f)) continue;
      const t = s.worlds[f.to];
      ctx.strokeStyle = COLORS[f.owner]; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx(f.x), sy(f.y)); ctx.lineTo(sx(t.x), sy(t.y)); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    ctx.textAlign = 'center';
    ctx.font = Math.max(10, Math.min(13, sc * 1.3)) + 'px ui-monospace, Menlo, Consolas, monospace';
    for (const w of s.worlds) {
      const i = info(w);
      if (!i) continue;
      const rad = 3 + (w.cap / 100) * 5 * Math.min(1.6, sc / 6 + 0.5);
      const x = sx(w.x), y = sy(w.y);
      ctx.globalAlpha = i.live ? 1 : 0.5;
      ctx.fillStyle = COLORS[i.owner];
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      if (i.natives && !i.owner) { ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rad + 2, 0, 7); ctx.stroke(); }
      if (i.live && G.shipCount(w.garrison)) { ctx.fillStyle = '#cfe3ff'; ctx.fillRect(x - 2, y - rad - 6, 4, 3); }
      ctx.fillStyle = i.live ? '#cfe3ff' : '#7d90b0';
      ctx.fillText(w.name, x, y + rad + 12);
      ctx.globalAlpha = 1;
      if (w.id === ui.selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, rad + 5, 0, 7); ctx.stroke(); }
      if (ui.hover === w.id && ui.targeting) { ctx.strokeStyle = '#ffb454'; ctx.beginPath(); ctx.arc(x, y, rad + 8, 0, 7); ctx.stroke(); }
    }

    for (const f of s.fleets) {
      if (!fleetVisible(f)) continue;
      const t = s.worlds[f.to], a = Math.atan2(t.y - f.y, t.x - f.x), x = sx(f.x), y = sy(f.y);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = COLORS[f.owner];
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, 4); ctx.lineTo(-5, -4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function worldAt(px, py) {
    let best = null, bd = 18;
    for (const w of ui.state.worlds) {
      if (!info(w)) continue;
      const d = Math.hypot(sx(w.x) - px, sy(w.y) - py);
      if (d < bd) { bd = d; best = w.id; }
    }
    return best;
  }

  // pointer: drag to pan, click to select/target
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, ox: ui.view.ox, oy: ui.view.oy, moved: false };
  });
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { ui.view.ox = drag.ox + dx; ui.view.oy = drag.oy + dy; canvas.classList.add('dragging'); draw(); }
      return;
    }
    const id = worldAt(px, py);
    if (id !== ui.hover) { ui.hover = id; draw(); }
    const tip = $('tip');
    if (id == null) tip.hidden = true;
    else {
      const w = ui.state.worlds[id], i = info(w);
      tip.hidden = false;
      tip.textContent = w.name + ' - ' + (i.natives && !i.owner ? 'Natives' : i.owner ? ui.state.empires[i.owner - 1].name : 'Unclaimed') + ', pop ' + i.pop;
      tip.style.left = (px + 14) + 'px'; tip.style.top = (py + 14) + 'px';
    }
  });
  canvas.addEventListener('pointerup', e => {
    const r = canvas.getBoundingClientRect();
    const wasDrag = drag && drag.moved;
    drag = null;
    canvas.classList.remove('dragging');
    if (wasDrag) return;
    const id = worldAt(e.clientX - r.left, e.clientY - r.top);
    if (ui.targeting) {
      if (id != null) dispatchTo(id);
      return;
    }
    if (id != null) { ui.selected = id; resetSend(); refresh(); }
  });
  canvas.addEventListener('pointerleave', () => { $('tip').hidden = true; ui.hover = null; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15, v = ui.view;
    const ns = Math.max(3, Math.min(30, v.scale * k)), f = ns / v.scale;
    v.ox = px - (px - v.ox) * f; v.oy = py - (py - v.oy) * f; v.scale = ns;
    draw();
  }, { passive: false });

  function toast(msg) {
    ui.state.log.unshift({ turn: ui.state.turn, text: msg, kind: 'bad', to: [ui.me] });
    renderLog();
  }

  function dispatchTo(toId) {
    if (toId === ui.selected) { toast('Pick a different world.'); return; }
    const res = act({ op: 'send', from: ui.selected, to: toId, ships: { ...ui.send } });
    if (!res.ok) { toast(res.msg); return; }
    if (res.eta) ui.state.log.unshift({ turn: ui.state.turn, text: 'Fleet sent to ' + ui.state.worlds[toId].name + ', ' + res.eta + ' turn' + (res.eta > 1 ? 's' : '') + '.', kind: 'info', to: [ui.me] });
    ui.targeting = false; canvas.classList.remove('targeting'); resetSend(); refresh();
  }

  // ---------- sidebar actions ----------

  $('side').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b || ui.state.over) return;
    const s = ui.state, a = b.dataset.act, t = b.dataset.t, w = s.worlds[ui.selected];
    let res = { ok: true };
    if (a === 'drop') {
      if (ui.net && ui.net.role === 'host') {
        const id = +b.dataset.e;
        G.dropPlayer(s, id); G.refreshKnown(s);
        for (const [pid, seat] of Object.entries(ui.seats)) if (seat === id) ui.net.kick(+pid);
        broadcastState(); refresh();
      }
      return;
    }
    if (a === 'build') res = act({ op: 'build', world: w.id, type: t });
    else if (a === 'fortify') res = act({ op: 'fortify', world: w.id });
    else if (a === 'research') res = act({ op: 'research' });
    else if (a === 'inc') ui.send[t] = Math.min(w.garrison[t], ui.send[t] + 1);
    else if (a === 'dec') ui.send[t] = Math.max(0, ui.send[t] - 1);
    else if (a === 'all') ui.send[t] = w.garrison[t];
    else if (a === 'target') ui.targeting = !ui.targeting;
    canvas.classList.toggle('targeting', ui.targeting);
    if (!res.ok) toast(res.msg);
    refresh();
  });

  // ---------- turn / new game ----------

  function endTurn() {
    const s = ui.state;
    if (s.over || !meEmp().alive) return;
    ui.targeting = false;
    canvas.classList.remove('targeting');
    if (ui.online) { sendOnline(); return; }
    if (ui.mail && ui.mail.role === 'guest') { if (!ui.mail.sent) showOrders(); return; }
    if (ui.mail && s.ready[ui.me]) { return; }
    if (multi() && s.ready[ui.me]) { const r = act({ op: 'unready' }); if (!r.ok) toast(r.msg); refresh(); return; }
    const turnBefore = s.turn;
    const r = act({ op: 'ready' });
    if (!r.ok) toast(r.msg);
    if (ui.mail && s.turn !== turnBefore) mailAdvanced();
    refresh();
  }

  function openNew() {
    if (multi()) { toast('Leave the multiplayer game first (reload the page).'); return; }
    if (ui.online) { toast('You are in an online game. Use Leave game in the Online panel first.'); return; }
    if (ui.mail) { toast('You are in a mail game. Use Leave mail game in the Mail panel first.'); return; }
    $('d-new').showModal();
  }

  $('b-end').onclick = endTurn;
  $('b-help').onclick = () => $('d-help').showModal();
  $('b-new').onclick = openNew;
  $('f-new').addEventListener('submit', e => {
    if (e.submitter && e.submitter.value !== 'ok') return;
    const fd = new FormData($('f-new'));
    const seedRaw = String(fd.get('seed') || '').trim();
    const seed = seedRaw && !isNaN(+seedRaw) ? +seedRaw : undefined;
    const s = G.newGame({ difficulty: fd.get('difficulty'), worlds: +fd.get('worlds'), seed });
    clearSave(); setState(s); save();
  });

  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('dialog')) return;
    if (e.key === 'e' || e.key === 'E') endTurn();
    else if (e.key === 'Escape' && ui.targeting) { ui.targeting = false; canvas.classList.remove('targeting'); refresh(); }
  });
  window.addEventListener('resize', resize);

  // ---------- multiplayer ----------

  function validState(s, seat) {
    return s && s.version === 2 && G.has(G.DIFFICULTY, s.difficulty) && Array.isArray(s.worlds) && Array.isArray(s.empires) && s.empires.length === 4 &&
      Number.isInteger(seat) && seat >= 1 && seat <= 4 && s.empires[seat - 1] && s.known && s.ready && Array.isArray(s.log) && Array.isArray(s.fleets);
  }

  function startHosting() {
    const fd = new FormData($('f-mp'));
    const opts = { difficulty: fd.get('difficulty'), worlds: +fd.get('worlds') };
    const net = P2P.host({ maxGuests: 3 });
    ui.net = net;
    net.on('close', id => {
      const seat = ui.seats[id];
      if (seat && ui.started) { G.dropPlayer(ui.state, seat); G.refreshKnown(ui.state); broadcastState(); refresh(); }
    });
    net.on('message', (id, m) => {
      const seat = ui.seats[id];
      if (!seat || !m || m.t !== 'cmd') return;
      const res = G.apply(ui.state, seat, m.cmd);
      if (res.ok) G.refreshKnown(ui.state);
      net.send(id, { t: 'ack', ok: !!res.ok, msg: res.msg || null });
      if (res.ok) { broadcastState(); refresh(); }
    });
    Lobby.showHost(net, {
      title: 'Host a game', startLabel: 'Start game',
      onStart() {
        const open = [...net.peers.values()].filter(p => p.state === 'open');
        const s = G.newGame({ ...opts, humans: 1 + open.length });
        open.forEach((p, i) => { ui.seats[p.id] = i + 2; s.empires[i + 1].player = 'Friend ' + p.id; });
        ui.started = true;
        setState(s, 1);
        for (const p of open) net.send(p.id, { t: 'start', seat: ui.seats[p.id], state: s });
        toast('Game started with ' + (open.length + 1) + ' players. The rest are AI.');
      },
    });
  }

  function joinGame() {
    const net = P2P.guest();
    ui.net = net;
    net.on('message', m => {
      if (!m) return;
      if (m.t === 'start' || m.t === 'state') {
        const seat = m.t === 'start' ? m.seat : ui.me;
        if (!validState(m.state, seat)) return;
        if (m.t === 'start') { ui.started = true; setState(m.state, seat); document.querySelectorAll('dialog.lobby').forEach(d => d.close()); }
        else { ui.state = m.state; if (ui.selected == null || !ui.state.worlds[ui.selected]) ui.selected = ui.state.worlds.find(w => w.owner === ui.me)?.id ?? null; refresh(); }
      } else if (m.t === 'ack' && !m.ok && m.msg) toast(String(m.msg).slice(0, 80));
    });
    net.on('close', () => { if (ui.started) toast('Lost connection to the host.'); });
    Lobby.showJoin(net, { title: 'Join a game' });
  }

  $('b-mp').onclick = () => $('d-mp').showModal();
  $('f-mp').addEventListener('submit', e => {
    const v = e.submitter && e.submitter.value;
    if (v === 'host') startHosting();
    else if (v === 'join') joinGame();
  });


  // ---------- play by mail ----------

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function turnFile(seat) {
    return JSON.stringify({ v: 1, kind: 'sector-dominion-turn', seat, state: ui.state });
  }

  function mailAdvanced() {
    ui.state.log.unshift({ turn: ui.state.turn, text: 'Turn ' + ui.state.turn + ' is ready. Download a turn file for each friend (Mail panel).', kind: 'good', to: [ui.me] });
    save();
  }

  function renderMail() {
    const el = $('p-mail');
    if (ui.online) { renderOnline(el); return; }
    el.hidden = !ui.mail;
    if (!ui.mail) return;
    const s = ui.state;
    let h = '<h3>Mail game</h3>';
    if (ui.mail.role === 'host') {
      h += '<p class="dim">You are the host. Turn ' + s.turn + '. Friends send you orders codes; paste them here.</p><div class="kv">';
      for (const e of s.empires) {
        if (!e.human || e.id === ui.me) continue;
        h += '<div style="color:' + COLORS[e.id] + '">Seat ' + e.id + '</div><div>' +
          (!e.alive ? 'eliminated' : s.ready[e.id] ? '<span class="good">orders in</span>' : 'waiting') +
          ' <button class="small" data-act="dl" data-e="' + e.id + '">turn file</button></div>';
      }
      h += '</div><textarea id="mail-in" rows="3" placeholder="Paste an orders code (SDO1...)" style="width:100%;margin-top:6px;background:#060b16;color:inherit;border:1px solid var(--line);border-radius:4px;font:11px monospace"></textarea>' +
        '<div class="btns"><button data-act="import">Add orders</button>' +
        '<button data-act="force" title="Play the turn now. Anyone who has not sent orders does nothing this turn.">Play turn without waiting</button>' +
        '<button data-act="leave">Leave mail game</button></div><p class="hint" id="mail-msg2">' + esc(ui.mailMsg || '') + '</p>';
    } else {
      h += '<p class="dim">Seat ' + ui.me + ', turn ' + s.turn + '. Give your orders as usual, then Send orders.</p>';
      if (ui.mail.sent) {
        h += '<p class="good">Orders sent for this turn.</p>' + ordersBox();
      } else h += '<p>' + ui.mail.cmds.length + ' order' + (ui.mail.cmds.length === 1 ? '' : 's') + ' so far.</p>';
      h += '<div class="btns"><button data-act="send-orders" ' + (ui.mail.sent ? 'disabled' : '') + '>Send orders</button>' +
        '<button data-act="load-turn">Load next turn file</button><button data-act="leave">Leave mail game</button></div>' +
        '<input type="file" id="i-next" accept=".json,application/json" hidden>';
    }
    el.innerHTML = h;
  }

  function ordersCode() {
    return G.encodeOrders({ v: 1, seat: ui.me, turn: ui.state.turn, cmds: ui.mail.cmds });
  }

  function ordersBox() {
    return '<textarea readonly rows="3" id="mail-out" style="width:100%;background:#060b16;color:inherit;border:1px solid var(--line);border-radius:4px;font:11px monospace">' +
      esc(ordersCode()) + '</textarea><div class="btns"><button data-act="copy-orders">Copy code</button></div>';
  }

  function showOrders() {
    ui.mail.sent = true; save(); refresh();
  }

  $('p-mail').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b || !ui.mail) return;
    const a = b.dataset.act, s = ui.state, say = t => { ui.mailMsg = t; const m = $('mail-msg2'); if (m) m.textContent = t; };
    if (a === 'dl') download('sector-dominion-seat' + b.dataset.e + '-turn' + s.turn + '.json', turnFile(+b.dataset.e));
    else if (a === 'import') {
      const o = G.decodeOrders($('mail-in').value);
      if (!o) return say('That does not look like an orders code. Copy it again in full.');
      const turnBefore = s.turn, r = G.applyOrders(s, o);
      if (!r.ok) return say(r.msg);
      G.refreshKnown(s);
      say('Orders from seat ' + o.seat + ': ' + r.applied + ' applied' + (r.rejected.length ? ', ' + r.rejected.length + ' refused (' + r.rejected[0] + ')' : '') + '.');
      if (s.turn !== turnBefore) mailAdvanced();
      save(); refresh();
    } else if (a === 'force') {
      if (!confirm('Play the turn now? Anyone who has not sent orders does nothing this turn.')) return;
      const turnBefore = s.turn;
      for (const x of s.empires) if (x.human && x.alive && !s.ready[x.id]) G.apply(s, x.id, { op: 'ready', turn: s.turn });
      G.refreshKnown(s);
      if (s.turn !== turnBefore) mailAdvanced();
      save(); refresh();
    } else if (a === 'send-orders') showOrders();
    else if (a === 'copy-orders') {
      const t = $('mail-out');
      try { await navigator.clipboard.writeText(t.value); b.textContent = 'Copied'; } catch (err) { t.select(); }
    } else if (a === 'load-turn') $('i-next').click();
    else if (a === 'leave') {
      if (!confirm('Leave this mail game? Your saved copy in this browser is deleted. The host still has the game.')) return;
      clearMail(); ui.mail = null;
      const solo = load();
      setState(solo || G.newGame({}));
    }
  });
  $('p-mail').addEventListener('change', e => {
    if (e.target.id === 'i-next' && e.target.files[0]) readTurnFile(e.target.files[0], false);
  });

  function readTurnFile(file, fromDialog) {
    const say = t => { const m = $('mail-msg'); if (m && fromDialog) m.textContent = t; else toast(t); };
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(r.result);
        if (!o || o.v !== 1 || o.kind !== 'sector-dominion-turn' || !validState(o.state, o.seat)) throw new Error('bad file');
        if (ui.mail && ui.mail.role === 'guest' && o.seat !== ui.me) return say('That file is for seat ' + o.seat + ', you are seat ' + ui.me + '.');
        if (ui.mail && ui.mail.role === 'guest' && o.state.turn <= ui.state.turn && !ui.mail.sent) return say('That is not a newer turn than the one you are on.');
        ui.mail = { role: 'guest', cmds: [], sent: false };
        setState(o.state, o.seat); save();
        const d = $('d-mail'); if (d.open) d.close();
      } catch (err) { say('Could not read that file.'); }
    };
    r.readAsText(file);
  }

  $('b-mail').onclick = () => { $('d-mp').close(); $('d-mail').showModal(); };
  $('i-turnfile').addEventListener('change', e => { if (e.target.files[0]) readTurnFile(e.target.files[0], true); });
  $('f-mail').addEventListener('submit', e => {
    if (!e.submitter || e.submitter.value !== 'start') return;
    const fd = new FormData($('f-mail'));
    const s = G.newGame({ difficulty: fd.get('difficulty'), worlds: +fd.get('worlds'), humans: +fd.get('humans') });
    ui.mail = { role: 'host' };
    setState(s, 1); save();
    toast('Mail game started. Download a turn file for each friend from the Mail panel.');
  });

  // ---------- online (shared store) ----------

  function adoptSession() {
    const turnChanged = ui.state && ui.online.working.turn !== ui.state.turn;
    ui.state = ui.online.working;
    ui.me = ui.online.seat;
    if (ui.selected == null || !ui.state.worlds[ui.selected]) ui.selected = ui.state.worlds.find(w => w.owner === ui.me)?.id ?? null;
    if (turnChanged) resetSend();
  }

  function startOnline(session) {
    ui.online = session; ui.mail = null; ui.net = null;
    ui.state = null; ui.selected = null;
    adoptSession();
    ui.targeting = false; canvas.classList.remove('targeting');
    fitView(); save(); refresh();
  }

  let polling = false;
  async function syncOnline(quiet) {
    if (!ui.online || polling) return;
    polling = true;
    const before = ui.online.base.turn;
    try {
      const r = await ui.online.sync();
      adoptSession();
      if (r.advanced) ui.state.log.unshift({ turn: ui.state.turn, text: 'Everyone is in. Turn ' + before + ' was played. It is now turn ' + ui.online.base.turn + '.', kind: 'good', to: [ui.me] });
      if (!quiet && r.error) ui.onlineMsg = r.error; else if (!r.error) ui.onlineMsg = '';
      save();
    } finally { polling = false; }
    refresh();
  }

  async function sendOnline() {
    if (!ui.online || ui.online.sent) return;
    ui.onlineBusy = true; refresh();
    const r = await ui.online.submit();
    ui.onlineBusy = false;
    ui.onlineMsg = '';
    adoptSession();
    if (!r.ok) toast(r.msg);
    save(); refresh();
  }

  function renderOnline(el) {
    el.hidden = false;
    const o = ui.online, s = ui.state, g = o.game;
    let h = '<h3>Online game</h3>';
    if (o.desync) h += '<p class="bad">This copy of the game has drifted from someone else\'s. Try Rebuild. If it keeps happening, make sure everyone uses the same browser type.</p>';
    h += '<p class="dim">Seat ' + o.seat + ', turn ' + s.turn + '. ' + (o.sent ? 'Your orders are in.' : 'Give your orders, then Send orders.') + '</p><div class="kv">';
    for (const e of s.empires) {
      if (!e.human && !g.invites) continue;
      if (e.id > g.humans) continue;
      const entry = o.entries && o.entries[e.id];
      const status = !e.alive ? 'eliminated' : !e.human ? 'AI' : entry ? '<span class="good">' + (entry.skip ? 'skipped' : 'orders in') + '</span>' : 'waiting';
      h += '<div style="color:' + COLORS[e.id] + '">' + (e.id === ui.me ? 'You' : 'Seat ' + e.id) + '</div><div>' + status +
        (o.isHost && e.id !== ui.me && e.human && e.alive && !entry ? ' <button class="small" data-act="skip" data-e="' + e.id + '" title="Play the turn without them">skip</button> <button class="small" data-act="skip-ai" data-e="' + e.id + '" title="Give this empire to the AI for good">AI</button>' : '') + '</div>';
    }
    h += '</div><div class="btns"><button data-act="osync">Check for news</button><button data-act="orebuild" title="Replay the whole game from its log">Rebuild</button>';
    if (o.isHost && g.invites) h += '<button data-act="oinvites">Invite codes</button>';
    h += '<button data-act="oleave">Leave game</button></div>';
    if (ui.showInvites && g.invites) {
      h += g.invites.map((c, i) => '<p class="dim">Seat ' + (i + 2) + '</p><textarea readonly rows="3" style="width:100%;background:#060b16;color:inherit;border:1px solid var(--line);border-radius:4px;font:11px monospace">' + esc(c) + '</textarea>').join('');
      h += '<p class="fine">Each code is for one friend. Anyone holding a code can play that seat, so send it privately.</p>';
    }
    if (ui.onlineMsg) h += '<p class="hint">' + esc(ui.onlineMsg) + '</p>';
    el.innerHTML = h;
  }

  $('p-mail').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b || !ui.online) return;
    const a = b.dataset.act, o = ui.online;
    if (a === 'osync') { ui.onlineMsg = 'Checking...'; refresh(); await syncOnline(false); refresh(); }
    else if (a === 'orebuild') { ui.onlineMsg = 'Rebuilding...'; refresh(); const r = await o.rebuild(); adoptSession(); ui.onlineMsg = r.error || 'Rebuilt from the log. Turn ' + r.turn + '.'; save(); refresh(); }
    else if (a === 'oinvites') { ui.showInvites = !ui.showInvites; refresh(); }
    else if (a === 'skip' || a === 'skip-ai') {
      const ai = a === 'skip-ai';
      if (ai && !confirm('Give this empire to the AI for the rest of the game?')) return;
      const r = await o.hostSkip(+b.dataset.e, ai);
      adoptSession(); ui.onlineMsg = r.ok ? '' : r.msg; save(); refresh();
    } else if (a === 'oleave') {
      if (!confirm('Leave this game on this device? The game stays on the server. You can come back with your invite code.')) return;
      clearOnline(); ui.online = null; ui.showInvites = false;
      const solo = load();
      setState(solo || G.newGame({}));
    }
  });

  // Poll while waiting on others. Slow down after a while so a forgotten tab costs the server almost nothing.
  let lastPoll = 0, waitStart = 0;
  setInterval(() => {
    const o = ui.online;
    if (!o || document.hidden) { waitStart = 0; return; }
    const me = G.empire(o.base, o.seat), waiting = o.sent || !me.human || !me.alive;
    if (!waiting) { waitStart = 0; return; }
    if (!waitStart) waitStart = Date.now();
    const every = Date.now() - waitStart > 20 * 60e3 ? 60e3 : 15e3;
    if (Date.now() - lastPoll >= every - 500) { lastPoll = Date.now(); syncOnline(true); }
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.online) syncOnline(true); });

  $('b-online').onclick = () => {
    $('d-mp').close();
    const f = $('f-online');
    // the storage server is not shown: it comes from shared/config.js, or from ?server=... when testing against another one
    f.server.value = new URLSearchParams(location.search).get('server') || window.KV_URL || '';
    $('online-msg').textContent = '';
    $('d-online').showModal();
  };
  $('f-online').addEventListener('submit', async e => {
    if (!e.submitter || e.submitter.value !== 'create') return;
    const fd = new FormData($('f-online')), msg = $('online-msg');
    // the form dialog closes itself on submit; reopen to show progress or errors
    setTimeout(() => $('d-online').open || $('d-online').showModal(), 0);
    msg.textContent = 'Creating...';
    try {
      const server = String(fd.get('server') || '').trim();
      const session = await Online.Session.create({ server, humans: +fd.get('humans'), difficulty: fd.get('difficulty'), worlds: +fd.get('worlds') });
      ui.showInvites = true;
      startOnline(session);
      $('d-online').close();
    } catch (err) { msg.textContent = err.message; }
  });
  $('b-join-online').onclick = async () => {
    const msg = $('online-msg');
    msg.textContent = 'Joining...';
    try {
      const session = await Online.Session.join($('t-invite').value);
      ui.showInvites = false;
      startOnline(session);
      $('d-online').close();
    } catch (err) { msg.textContent = err.message; }
  };

  // ---------- boot ----------

  resize();
  const savedOnline = loadOnline();
  if (savedOnline) { ui.online = savedOnline; adoptSession(); fitView(); refresh(); setTimeout(() => syncOnline(true), 0); }
  const savedMail = savedOnline ? null : loadMail();
  if (savedMail) { ui.mail = savedMail.mail; setState(savedMail.state, savedMail.me); }
  const saved = savedMail || savedOnline ? null : load();
  if (!savedMail && !savedOnline) setState(saved || G.newGame({}));
  if (!saved && !savedMail && !savedOnline) {
    try {
      if (!localStorage.getItem('sectordominion-help-seen')) {
        $('d-help').showModal();
        localStorage.setItem('sectordominion-help-seen', '1');
      }
    } catch (e) { $('d-help').showModal(); }
  }
})();
