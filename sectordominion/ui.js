(function () {
  'use strict';
  const G = window.Game;
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
    online: null,   // the game with friends, through the shared store (online.js)
    onlineMsg: '',
    onlineBusy: false,
    name: null,     // what this player likes to be called (saved on this device)
    userView: false, // the player has panned or zoomed, so a resize should not refit the map
    notes: [],      // who came and went, and turns played: shown in the log, not saved
  };

  // what each ship is for, in plain words (the numbers next to them come from the rules in game.js)
  const SHIP_ROLE = {
    scout: 'Fast and cheap, but weak. Sends back a view of far-off worlds. Use it to explore.',
    frigate: 'Light warship. Your everyday fighter early on.',
    cruiser: 'Heavy warship. Slower and pricey, but takes much more damage.',
    transport: 'Has no guns. Settles an empty world, or lands 5 troops to take a defended one. Used up when it lands.',
  };
  const SHIP_SHORT = {
    scout: 'explorer, weak',
    frigate: 'light warship',
    cruiser: 'heavy warship, slow',
    transport: 'settles worlds, 5 troops',
  };

  const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const meEmp = () => G.empire(ui.state, ui.me);
  const mem = () => ui.state.known[ui.me] || {};

  function fillHelp() {
    $('help-ships').innerHTML = '<table class="shiptable"><tr><th>Ship</th><th>Cost</th><th>Attack</th><th>Hull</th><th>Speed</th></tr>' +
      G.SHIP_ORDER.map(t => { const x = G.SHIPS[t]; return '<tr><td><b>' + x.name + '</b></td><td>' + x.cost + '</td><td>' + x.atk + '</td><td>' + x.hp + '</td><td>' + x.speed + '</td></tr><tr><td colspan="5" class="dim">' + SHIP_ROLE[t] + '</td></tr>'; }).join('') + '</table>';
  }
  fillHelp();
  function openHelp(id) {
    const d = $('d-help');
    if (id) { d.querySelectorAll('details').forEach(x => { x.open = x.id === id; }); }
    d.showModal();
    if (id) { const el = $(id); if (el) el.scrollIntoView({ block: 'start' }); }
  }

  // ---------- save / load ----------

  // Every game on this device (solo and with friends) lives in the library; see games.js.
  const memoryStore = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; })();
  const lib = new Games.Library((() => { try { localStorage.getItem('x'); return localStorage; } catch (e) { return memoryStore; } })()).load();
  const sessions = new Map(); // game id -> its Session, for the games with friends this page has loaded

  function save() {
    if (lib.active) lib.write(lib.active, ui.online ? ui.online : ui.state);
  }
  const idOf = session => { for (const [id, s] of sessions) if (s === session) return id; return null; };
  function persist(session) { const id = idOf(session); if (id) lib.write(id, session); }

  // the Session for a game with friends, loaded from storage the first time it is needed
  function sessionFor(id) {
    if (sessions.has(id)) return sessions.get(id);
    if (lib.kind(id) !== 'online') return null;
    const s = Online.Session.fromSaved(lib.read(id));
    if (s) { if (ui.name) s.setName(ui.name); sessions.set(id, s); }
    return s;
  }

  const NAME_KEY = 'sectordominion-name-v1', ASKED_KEY = 'sectordominion-name-asked';
  function loadName() { try { return Online.cleanName(localStorage.getItem(NAME_KEY)); } catch (e) { return null; } }
  ui.name = loadName();
  const serverUrl = () => new URLSearchParams(location.search).get('server') || window.KV_URL || '';

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
    renderTop(); renderOnline(); renderDevice(); renderGamesBadge(); renderWorld(); renderEmpire(); renderLog(); draw();
    const s = ui.state, b = $('banner'), alive = meEmp().alive;
    if (s.over) {
      b.hidden = false;
      b.innerHTML = (s.winner === ui.me ? '<b class="good">Victory.</b><br>The sector is yours.' :
        s.winner ? '<b class="bad">Defeat.</b><br>' + esc(G.empire(s, s.winner).name) + ' won.' :
          '<b class="bad">Defeat.</b><br>Your empire is gone.') +
        (ui.online ? '' : '<br><button class="primary" id="b-again">New game</button>');
      if (!ui.online) $('b-again').onclick = openNew;
    } else if (ui.online && alive && ui.online.seatState(ui.me) !== 'human') {
      b.hidden = false;
      b.innerHTML = '<b class="bad">The AI runs your empire now.</b><br><span class="dim">The host handed it over. You are watching.</span>';
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

  // ---------- orders ----------

  function act(cmd) {
    if (ui.online) {
      const r = ui.online.act(cmd);
      if (r.ok) save();
      return r;
    }
    const res = G.apply(ui.state, ui.me, { ...cmd, turn: ui.state.turn });
    if (res.ok) G.refreshKnown(ui.state);
    save();
    return res;
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
    if (ui.online) {
      end.textContent = ui.online.sent ? 'Orders sent' : 'Send orders';
      end.disabled = end.disabled || ui.online.sent || ui.onlineBusy || ui.online.seatState(ui.me) !== 'human';
    } else end.textContent = 'End turn';
  }

  function shipLine(ships) {
    const parts = G.SHIP_ORDER.filter(t => ships[t]).map(t => ships[t] + ' ' + G.SHIPS[t].name + (ships[t] > 1 ? 's' : ''));
    return parts.length ? parts.join(', ') : 'none';
  }

  function ownerLabel(id) { return id ? esc(ui.state.empires[id - 1].name) + (id === ui.me ? ' (you)' : '') : 'Unclaimed'; }

  // one short suggestion for what to do next, for the first few turns. It only reads the game, so it cannot change anything.
  function tipHtml() {
    const s = ui.state, e = meEmp();
    if (s.over || !e.alive || s.turn > 12) return '';
    const mine = s.worlds.filter(w => w.owner === ui.me);
    const inGarrison = t => mine.reduce((n, w) => n + w.garrison[t], 0);
    const queued = t => mine.reduce((n, w) => n + w.queue.filter(x => x === t).length, 0);
    const flying = s.fleets.some(f => f.owner === ui.me);
    let msg = '';
    if (ui.targeting) msg = 'Now ' + (coarse ? 'tap' : 'click') + ' the world on the map you want to send them to.';
    else if (!inGarrison('transport') && !queued('transport') && !flying && mine.length <= 1) msg = 'Build a Transport (and a Scout) on your world, then end your turn. A Transport can settle an empty world.';
    else if (!inGarrison('transport') && queued('transport')) msg = 'Your ship is being built. End your turn and it will be ready.';
    else if (inGarrison('transport') && !flying) msg = 'Select your world, pick the Transport under Dispatch fleet, press Choose destination, then pick an empty world (no red ring).';
    else if (e.credits >= G.researchCost(s, ui.me) && e.tech < G.MAX_TECH && s.turn > 3) msg = 'You can afford Research. It makes your ships stronger and your income higher.';
    return msg ? '<div class="tip"><b>Tip:</b> ' + esc(msg) + '</div>' : '';
  }

  function renderWorld() {
    const el = $('p-world'), s = ui.state;
    if (ui.selected == null) { el.innerHTML = '<h3>No world selected</h3><p class="dim">Tap a world on the map.</p>'; return; }
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
      h += '<h3>Build <button class="linkish" data-do="help-ships">what do these do?</button></h3>';
      for (const t of G.SHIP_ORDER) {
        const sh = G.SHIPS[t];
        h += '<div class="ship-row"><button data-act="build" data-t="' + t + '" ' + (e.credits < sh.cost || frozen ? 'disabled' : '') +
          ' title="' + esc(SHIP_ROLE[t]) + '">' + sh.name + ' ' + sh.cost + '</button><span class="why">' + SHIP_SHORT[t] + '<br>atk ' + sh.atk + ', hull ' + sh.hp + ', speed ' + sh.speed + '</span></div>';
      }
      h += '<div class="btns"><button data-act="fortify" ' + (w.fort >= 5 || e.credits < G.fortifyCost(w) || frozen ? 'disabled' : '') + '>' +
        (w.fort >= 5 ? 'Fully fortified' : 'Fortify ' + G.fortifyCost(w)) + '</button><span class="why dim">permanent defense</span></div>';

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
          (ui.targeting ? 'Tap a world on the map...' : 'Choose destination') + '</button></div>';
        if (ui.targeting) h += '<p class="hint">' + (coarse ? 'Tap the button again to cancel.' : 'Esc to cancel.') + '</p>';
      }
    } else if (ui.vis.size) {
      const near = s.worlds.filter(x => x.owner === ui.me).sort((a, b) => G.dist(a, w) - G.dist(b, w))[0];
      if (near) h += '<p class="dim">' + Math.round(G.dist(near, w)) + ' units from ' + esc(near.name) + '.</p>';
    }
    el.innerHTML = tipHtml() + h;
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
      h += '<div style="color:' + COLORS[r.id] + '">' + esc(ui.online ? nameOf(r.id) : r.name.split(' ')[0]) + '</div><div>' + tag + ', ' + state +
        '</div>';
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
    const own = ui.state.log.filter(l => !l.to || l.to.includes(ui.me));
    $('log').innerHTML = ui.notes.concat(own).slice(0, 60).map(l =>
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
    ui.userView = false;
  }

  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ui.state) { if (!ui.userView) fitView(); draw(); }
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
    let best = null, bd = coarse ? 28 : 18;
    for (const w of ui.state.worlds) {
      if (!info(w)) continue;
      const d = Math.hypot(sx(w.x) - px, sy(w.y) - py);
      if (d < bd) { bd = d; best = w.id; }
    }
    return best;
  }

  // pointer: one finger or the mouse drags to pan and taps/clicks to select or target; two fingers pinch to zoom
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const pts = new Map();
  let drag = null, pinch = null;
  const MIN_SCALE = 2, MAX_SCALE = 30;

  function zoomAt(px, py, ns) {
    const v = ui.view;
    ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, ns));
    const f = ns / v.scale;
    v.ox = px - (px - v.ox) * f; v.oy = py - (py - v.oy) * f; v.scale = ns;
    ui.userView = true;
  }
  const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: ui.view.scale, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ox: ui.view.ox, oy: ui.view.oy };
      drag = null;
    } else if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, ox: ui.view.ox, oy: ui.view.oy, moved: false };
  });
  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    if (pts.has(e.pointerId)) {
      pts.set(e.pointerId, p);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        // keep the spot that was between the fingers when the pinch began between them now, at the new scale
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinch.scale * d / pinch.d)), f = ns / pinch.scale;
        ui.view.scale = ns; ui.view.ox = mx - (pinch.mx - pinch.ox) * f; ui.view.oy = my - (pinch.my - pinch.oy) * f;
        ui.userView = true;
        draw();
        return;
      }
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > (coarse ? 8 : 4)) drag.moved = true;
      if (drag.moved) { ui.view.ox = drag.ox + dx; ui.view.oy = drag.oy + dy; ui.userView = true; canvas.classList.add('dragging'); draw(); }
      return;
    }
    if (e.pointerType === 'touch') return;
    const id = worldAt(p.x, p.y);
    if (id !== ui.hover) { ui.hover = id; draw(); }
    const tip = $('tip');
    if (id == null) tip.hidden = true;
    else {
      const w = ui.state.worlds[id], i = info(w);
      tip.hidden = false;
      tip.textContent = w.name + ' - ' + (i.natives && !i.owner ? 'Natives' : i.owner ? ui.state.empires[i.owner - 1].name : 'Unclaimed') + ', pop ' + i.pop;
      tip.style.left = (p.x + 14) + 'px'; tip.style.top = (p.y + 14) + 'px';
    }
  });
  canvas.addEventListener('pointerup', e => {
    const wasPinch = !!pinch;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (wasPinch) { // a finger is still down: carry on panning from where it is, without a jump
      const rest = [...pts.entries()][0];
      drag = rest ? { x: rest[1].x + canvas.getBoundingClientRect().left, y: rest[1].y + canvas.getBoundingClientRect().top, ox: ui.view.ox, oy: ui.view.oy, moved: true } : null;
      canvas.classList.remove('dragging');
      return;
    }
    const wasDrag = drag && drag.moved;
    drag = null;
    canvas.classList.remove('dragging');
    if (wasDrag) return;
    const p = local(e), id = worldAt(p.x, p.y);
    if (ui.targeting) {
      if (id != null) dispatchTo(id);
      return;
    }
    if (id != null) { ui.selected = id; resetSend(); refresh(); }
  });
  canvas.addEventListener('pointercancel', e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; canvas.classList.remove('dragging'); });
  canvas.addEventListener('pointerleave', () => { $('tip').hidden = true; ui.hover = null; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, ui.view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    draw();
  }, { passive: false });
  $('b-fit').onclick = () => { fitView(); draw(); };

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
    const hb = e.target.closest('button[data-do="help-ships"]');
    if (hb) { openHelp('h-ships'); return; }
    const b = e.target.closest('button[data-act]');
    if (!b || ui.state.over) return;
    const s = ui.state, a = b.dataset.act, t = b.dataset.t, w = s.worlds[ui.selected];
    let res = { ok: true };
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
    const r = act({ op: 'ready' });
    if (!r.ok) toast(r.msg);
    refresh();
  }

  function openNew() {
    if (lib.full) { toast('You are in ' + Games.MAX_GAMES + ' games. Delete one first.'); return; }
    $('d-new').showModal();
  }

  // starts a solo game next to the ones already there
  function newSolo(opts) {
    if (ui.state) save();
    lib.add('solo');
    ui.online = null; ui.notes = []; document.title = baseTitle;
    setState(G.newGame(opts || {}));
    save();
  }

  $('b-end').onclick = endTurn;
  $('b-help').onclick = () => openHelp();
  $('b-new').onclick = openGames;
  $('f-new').addEventListener('submit', e => {
    if (e.submitter && e.submitter.value !== 'ok') return;
    const fd = new FormData($('f-new'));
    const seedRaw = String(fd.get('seed') || '').trim();
    const seed = seedRaw && !isNaN(+seedRaw) ? +seedRaw : undefined;
    newSolo({ difficulty: fd.get('difficulty'), worlds: +fd.get('worlds'), seed });
  });

  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('dialog')) return;
    if (e.key === 'e' || e.key === 'E') endTurn();
    else if (e.key === 'Escape' && ui.targeting) { ui.targeting = false; canvas.classList.remove('targeting'); refresh(); }
  });
  window.addEventListener('resize', resize);

  // ---------- playing with friends (shared store) ----------

  const baseTitle = document.title;
  const note = (text, kind) => { ui.notes.unshift({ turn: ui.state ? ui.state.turn : 0, text, kind: kind || 'info' }); if (ui.notes.length > 40) ui.notes.length = 40; };
  const nameOf = seat => (ui.online && ui.online.names[seat]) || G.empire(ui.state, seat).name.split(' ')[0];

  function adoptSession() {
    const turnChanged = ui.state && ui.online.working.turn !== ui.state.turn;
    ui.state = ui.online.working;
    ui.me = ui.online.seat;
    if (ui.selected == null || !ui.state.worlds[ui.selected]) ui.selected = ui.state.worlds.find(w => w.owner === ui.me)?.id ?? null;
    if (turnChanged) resetSend();
  }

  function startOnline(session) {
    ui.online = session; ui.state = null; ui.selected = null; ui.notes = [];
    // my name goes with my heartbeat. If I have none here but did on another device, take it from there.
    if (ui.name) session.setName(ui.name);
    else if (session.names[session.seat]) { ui.name = session.names[session.seat]; try { localStorage.setItem(NAME_KEY, ui.name); } catch (e) { /* ignore */ } }
    adoptSession();
    ui.targeting = false; canvas.classList.remove('targeting');
    fitView(); save(); refresh();
    heartbeat();
  }

  // Tell the other players this page is open. Their pages show "online" for 45 s after the last one.
  let lastBeat = 0;
  function heartbeat() { lastBeat = Date.now(); if (ui.online) ui.online.beat(); }

  let polling = false;
  async function syncOnline(quiet) {
    if (!ui.online || polling) return;
    polling = true;
    const o = ui.online, before = o.base.turn;
    try {
      const r = await o.sync();
      if (ui.online !== o) { persist(o); return; } // switched to another game while this was in flight
      adoptSession();
      if (r.advanced) {
        note('Everyone is in. Turn ' + before + ' was played. It is now turn ' + ui.online.base.turn + '.', 'good');
        if (document.hidden) document.title = '(new turn) ' + baseTitle;
      }
      // who came and went since the last look, in plain words
      for (const ev of ui.online.takeEvents()) {
        const n = nameOf(ev.seat);
        if (ev.kind === 'online') note(n + ' is online.', 'good');
        else note(n + ' went offline. The game keeps going, and their orders count whenever they send them.', 'info');
      }
      if (!quiet && r.error) ui.onlineMsg = r.error; else if (!r.error) ui.onlineMsg = '';
      save();
    } finally { polling = false; }
    refresh();
  }

  async function sendOnline() {
    if (!ui.online || ui.online.sent) return;
    ui.onlineBusy = true; refresh();
    const o = ui.online, r = await o.submit();
    ui.onlineBusy = false;
    if (ui.online !== o) { persist(o); return; }
    ui.onlineMsg = '';
    adoptSession();
    if (!r.ok) toast(r.msg);
    save(); refresh();
  }

  function ago(secs) {
    if (secs === null || secs === undefined) return 'not joined yet';
    if (secs < 100) return 'a minute ago'; // offline means at least 45 s, so "just now" would read oddly
    const m = Math.round(secs / 60);
    if (m < 90) return m + ' min ago';
    const h = Math.round(secs / 3600);
    if (h < 36) return h + ' h ago';
    return Math.round(secs / 86400) + ' days ago';
  }

  const list = names => names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];

  // one sentence that says what is going on and that the game does not need anybody to stay
  function summary(o, s) {
    if (s.over) return '';
    const others = [];
    for (let seat = 1; seat <= o.game.humans; seat++) {
      if (seat !== ui.me && o.seatState(seat) === 'human') others.push(seat);
    }
    if (!others.length) return 'Everyone else is the AI now, so a turn plays as soon as you send orders.';
    const away = others.filter(seat => !o.isOnline(seat));
    if (!o.sent) {
      if (!away.length) return 'Everyone is here. A turn plays as soon as all orders are in.';
      return esc(list(away.map(nameOf))) + (away.length > 1 ? ' are' : ' is') + ' away. That is fine: the game keeps going, and the turn plays whenever everyone has sent orders.';
    }
    const missing = o.waiting.filter(seat => seat !== ui.me);
    if (!missing.length) return 'Playing the turn...';
    const parts = missing.map(seat => esc(nameOf(seat)) + (o.isOnline(seat) ? ' (online now)' : o.presence[seat] == null ? ' (has not joined yet)' : ' (offline, last seen ' + ago(o.presence[seat]) + ')'));
    const allAway = missing.every(seat => !o.isOnline(seat));
    return 'Waiting for ' + parts.join(', ') + '.' + (allAway ? ' The game is saved, so you can close this page and come back: you will see the new turn when you return.' : '');
  }

  function renderOnline() {
    const el = $('p-online');
    el.hidden = !ui.online;
    if (!ui.online) return;
    const o = ui.online, s = ui.state, g = o.game;
    let h = '<h3>Game with friends</h3>';
    if (o.desync) h += '<p class="bad">This copy of the game has drifted from someone else\'s. Try Rebuild. If it keeps happening, make sure everyone uses the same browser type.</p>';
    if (o.seatState(ui.me) === 'ai' || o.seatState(ui.me) === 'ai-pending') h += '<p class="bad">The host handed your empire to the AI. You are watching.</p>';
    h += '<p class="dim">Seat ' + o.seat + ', turn ' + s.turn + '. ' + (o.sent ? 'Your orders are in.' : 'Give your orders, then Send orders.') + '</p>';
    const line = summary(o, s);
    if (line) h += '<p>' + line + '</p>';
    h += '<div class="kv">';
    for (let seat = 1; seat <= g.humans; seat++) {
      const st = o.seatState(seat), entry = o.entries && o.entries[seat];
      let status;
      if (st === 'out') status = 'eliminated';
      else if (st === 'ai') status = 'AI';
      else if (st === 'ai-pending') status = 'AI from next turn';
      else {
        const here = seat === ui.me ? '' : o.isOnline(seat) ? '<span class="good">● online</span>' : '<span class="dim">○ ' + (o.presence[seat] == null ? 'not joined yet' : 'last seen ' + ago(o.presence[seat])) + '</span>';
        const order = entry ? '<span class="good">' + (entry.skip ? 'skipped' : 'orders in') + '</span>' : 'waiting';
        status = (here ? here + ' · ' : '') + order;
      }
      h += '<div style="color:' + COLORS[seat] + '">' + (seat === ui.me ? 'You' : esc(nameOf(seat))) + '</div><div>' + status +
        (o.isHost && seat !== ui.me && st === 'human' && !entry ? ' <button class="small" data-act="skip" data-e="' + seat + '" title="Play the turn without them">skip</button> <button class="small" data-act="skip-ai" data-e="' + seat + '" title="Give this empire to the AI for good">AI</button>' : '') + '</div>';
    }
    h += '</div><div class="btns"><button data-act="osync">Refresh</button><button data-act="orebuild" title="Replay the whole game from its log">Rebuild</button>';
    if (o.isHost) h += '<button data-act="oinvites">Invite links</button>';
    h += '<button data-act="oleave">Leave game</button></div>';
    if (ui.onlineMsg) h += '<p class="hint">' + esc(ui.onlineMsg) + '</p>';
    el.innerHTML = h;
  }

  $('p-online').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b || !ui.online) return;
    const a = b.dataset.act, o = ui.online;
    if (a === 'osync') { ui.onlineMsg = 'Checking...'; refresh(); await syncOnline(false); refresh(); }
    else if (a === 'orebuild') { ui.onlineMsg = 'Rebuilding...'; refresh(); const r = await o.rebuild(); adoptSession(); ui.onlineMsg = r.error || 'Rebuilt from the log. Turn ' + r.turn + '.'; save(); refresh(); }
    else if (a === 'oinvites') openInvites();
    else if (a === 'skip' || a === 'skip-ai') {
      const ai = a === 'skip-ai';
      if (ai && !confirm('Give this empire to the AI for the rest of the game?')) return;
      const r = await o.hostSkip(+b.dataset.e, ai);
      adoptSession(); ui.onlineMsg = r.ok ? '' : r.msg; save(); refresh();
    } else if (a === 'oleave') {
      deleteGame(lib.active);
    }
  });

  // Keep in touch. Check in every 15 s while the page is visible. How often to look at the game depends on what is going on:
  //   waiting, and somebody else is online -> every 3 s, so a turn plays almost at once
  //   waiting, nobody online               -> every 15 s, and every minute after 20 minutes (a forgotten tab costs almost nothing)
  //   still giving orders                  -> every 15 s, which keeps the who-is-online list fresh
  let lastSync = 0, waitStart = 0;
  setInterval(() => {
    const o = ui.online;
    if (!o || document.hidden || o.base.over) { waitStart = 0; return; }
    const now = Date.now();
    if (now - lastBeat >= 15000) heartbeat();
    const me = G.empire(o.base, o.seat), waiting = o.sent || !me.human || !me.alive;
    let every = 15000;
    if (waiting) {
      if (!waitStart) waitStart = now;
      every = o.anyoneOnline() ? 3000 : (now - waitStart > 20 * 60e3 ? 60e3 : 15000);
    } else waitStart = 0;
    if (now - lastSync >= every - 400 && !polling) { lastSync = now; syncOnline(true); }
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    document.title = baseTitle;
    if (ui.online) { heartbeat(); syncOnline(true); }
  });

  // the friends button opens the dialog directly: one place for starting and joining
  $('b-friends').onclick = () => {
    const f = $('f-online');
    // the storage server is not shown: it comes from shared/config.js, or from ?server=... when testing against another one
    f.server.value = serverUrl();
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
      if (lib.full) throw new Error('You are in ' + Games.MAX_GAMES + ' games. Delete one first.');
      const server = String(fd.get('server') || '').trim();
      const session = await Online.Session.create({ server, humans: +fd.get('humans'), difficulty: fd.get('difficulty'), worlds: +fd.get('worlds') });
      addOnline(session);
      $('d-online').close();
      openInvites(); // straight to "how do I get my friends in"
    } catch (err) { msg.textContent = err.message; }
  });

  // ----- invite links -----

  // Short on purpose: the page's own address, /j/, then the room and seat. The part after # is never sent to any server.
  const inviteLink = seat => new URL('../j/', location.href).href + '#' + Online.inviteCode(ui.online.game.room, seat);

  function addCopyShare(btns, copyBtn, input, url, text) {
    btns.querySelectorAll('.share').forEach(x => x.remove());
    if (navigator.share) {
      const sh = document.createElement('button');
      sh.type = 'button'; sh.textContent = 'Share'; sh.className = 'primary share';
      sh.onclick = () => navigator.share({ title: 'Sector Dominion', text, url }).catch(() => { /* closed the share sheet */ });
      btns.appendChild(sh);
    }
    copyBtn.onclick = async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; } catch (err) { input.select(); try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ } }
      copyBtn.textContent = ok ? 'Copied' : 'Press and hold to copy';
      setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
    };
  }

  function openInvites() {
    if (!ui.online || !ui.online.isHost) return;
    const list = $('invite-list');
    list.innerHTML = '';
    // only seats a person can still take: never one the AI plays or is about to play
    const seats = ui.online.invitable();
    if (!seats.length) list.innerHTML = '<p class="dim">Nobody is left to invite. Everyone else is the AI or has been wiped out.</p>';
    for (const seat of seats) {
      const url = inviteLink(seat), row = document.createElement('div');
      row.className = 'invite';
      row.innerHTML = '<div class="who"><b>' + esc(nameOf(seat)) + '</b> <span class="dim">(seat ' + seat + ')</span></div><input readonly aria-label="Invite link for seat ' + seat + '"><div class="row"><button type="button" data-copy>Copy link</button></div>';
      const input = row.querySelector('input');
      input.value = url;
      input.addEventListener('focus', () => input.select());
      addCopyShare(row.querySelector('.row'), row.querySelector('[data-copy]'), input, url, 'Join my game of Sector Dominion:');
      list.appendChild(row);
    }
    $('d-invite').showModal();
  }

  // A game with friends is added next to the others on this device. If this seat of this game is already here, that one opens.
  function findOnline(room, seat) {
    for (const g of lib.list) {
      if (g.kind !== 'online') continue;
      const s = sessionFor(g.id);
      if (s && s.game.room === room && s.seat === seat) return g.id;
    }
    return null;
  }
  function addOnline(session) {
    if (ui.state) save();
    const id = lib.add('online');
    sessions.set(id, session);
    ui.notes = [];
    startOnline(session);
  }

  // Joining. A link opens the game page with #join=<code>, and that joins straight away.
  async function joinGame(invite) {
    const msg = $('join-msg'), go = $('b-join-go'), close = $('b-join-close');
    const server = serverUrl();
    msg.textContent = 'Joining...'; go.hidden = true; close.textContent = 'Cancel';
    if (!$('d-join').open) $('d-join').showModal();
    try {
      if (lib.full) throw new Error('You are in ' + Games.MAX_GAMES + ' games. Delete one first.');
      const session = await Online.Session.join(invite, server);
      const there = findOnline(session.game.room, session.seat);
      if (there) openGame(there); else addOnline(session);
      $('d-join').close(); $('d-online').close();
      // Someone arriving by a link sees the game first. Only if the game did not already know their name do we ask, and then once.
      await ensureName();
    } catch (err) { msg.textContent = err.message; close.textContent = 'Close'; }
  }

  $('b-join-online').onclick = () => { $('d-online').close(); joinGame($('t-invite').value); };

  // ----- name -----

  function askName() {
    return new Promise(resolve => {
      const d = $('d-name');
      $('f-name').elements.name.value = ui.name || '';
      try { localStorage.setItem(ASKED_KEY, '1'); } catch (e) { /* ignore */ }
      d.addEventListener('close', () => resolve(), { once: true });
      d.showModal();
    });
  }
  $('f-name').addEventListener('submit', e => {
    if (!e.submitter || e.submitter.value !== 'save') return;
    ui.name = Online.cleanName($('f-name').elements.name.value);
    try { if (ui.name) localStorage.setItem(NAME_KEY, ui.name); else localStorage.removeItem(NAME_KEY); } catch (err) { /* ignore */ }
    if (ui.online) { ui.online.setName(ui.name); heartbeat(); save(); }
    refresh();
  });
  async function ensureName() {
    let asked = false;
    try { asked = !!localStorage.getItem(ASKED_KEY); } catch (e) { asked = true; }
    if (!ui.name && !asked) await askName();
  }

  // ----- play on another device -----

  function renderDevice() {
    $('p-device').innerHTML = '<h3>You</h3><p class="who dim">Playing as <b>' + esc(ui.name || 'no name yet') + '</b></p>' +
      '<div class="btns"><button data-do="name">' + (ui.name ? 'Change name' : 'Set name') + '</button><button data-do="device">Play on another device</button></div>';
  }
  $('p-device').addEventListener('click', e => {
    const b = e.target.closest('button[data-do]');
    if (!b) return;
    if (b.dataset.do === 'name') askName(); else openDevice();
  });

  async function openDevice() {
    const lead = $('device-lead'), note = $('device-note'), msg = $('device-msg'), link = $('device-link'), qr = $('device-qr');
    msg.textContent = ''; qr.innerHTML = ''; link.value = ''; note.textContent = '';
    $('device-btns').hidden = true;
    $('d-device').showModal();
    let code;
    if (ui.online) {
      code = Online.inviteCode(ui.online.game.room, ui.online.seat);
      lead.textContent = 'Scan this with your phone camera, or send yourself the link. Opening it on another device puts you back in this game, in your seat.';
      note.textContent = 'The link is for your seat only, so keep it private. Both devices can stay open: orders from either one count, and the first to send wins the turn.';
    } else {
      lead.textContent = 'Making a private link to a copy of this game...';
      try { code = await Online.shareSolo(ui.state, serverUrl()); } catch (err) { lead.textContent = ''; msg.textContent = err.message; return; }
      lead.textContent = 'Scan this with your phone camera, or send yourself the link. Opening it on another device carries this game over, as it is right now.';
      note.textContent = 'This is a copy. From now on the game here and the one on the other device go on separately, so pick one to keep playing. The link works for 60 days, and anyone who has it can open your game, so keep it private.';
    }
    const url = new URL('../j/', location.href).href + '#' + code;
    link.value = url;
    link.onfocus = () => link.select();
    try {
      const q = qrcode(0, 'M'); q.addData(url); q.make();
      qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
    } catch (err) { qr.innerHTML = ''; }
    $('device-btns').hidden = false;
    addCopyShare($('device-btns'), $('b-device-copy'), link, url, 'Pick up my Sector Dominion game here:');
  }

  // A link made by "Play on another device" for a solo game: fetch the copy and make it this device's game.
  async function receiveSolo(invite) {
    const msg = $('join-msg'), go = $('b-join-go'), close = $('b-join-close');
    msg.textContent = 'Opening your game...'; go.hidden = true; close.textContent = 'Cancel';
    if (!$('d-join').open) $('d-join').showModal();
    let state;
    try { state = await Online.fetchSolo(invite, serverUrl()); } catch (err) { msg.textContent = err.message; close.textContent = 'Close'; return; }
    // a solo game on this device that has barely started is not worth keeping next to this one
    if (!ui.online && ui.state.turn <= 1 && lib.kind(lib.active) === 'solo') lib.remove(lib.active);
    else if (lib.full) { msg.textContent = 'You are in ' + Games.MAX_GAMES + ' games. Delete one first.'; close.textContent = 'Close'; return; }
    else save();
    lib.add('solo');
    ui.online = null; ui.notes = []; document.title = baseTitle;
    setState(state); save();
    $('d-join').close();
  }

  function handleHash() {
    const m = /^#join=(.+)$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search); // the code is not needed in the address bar any more
    if (Online.parseTransfer(m[1])) { receiveSolo(m[1]); return; }
    const inv = Online.parseInvite(m[1]);
    const there = inv && findOnline(inv.room, inv.seat);
    if (there) { openGame(there); return; } // already in this game
    joinGame(m[1]);
  }
  window.addEventListener('hashchange', handleHash);

  // ---------- several games at once ----------

  function dropBroken(id) { sessions.delete(id); lib.remove(id); }

  // Opens a game on this device: the one on screen is saved first. Returns false (and forgets the game) if its data is unusable.
  function openGame(id) {
    if (!lib.has(id)) return false;
    if (ui.state && lib.active && lib.active !== id) save();
    lib.setActive(id);
    ui.notes = []; ui.onlineMsg = ''; document.title = baseTitle;
    if (lib.kind(id) === 'online') {
      const s = sessionFor(id);
      if (!s) { dropBroken(id); return false; }
      startOnline(s);
      setTimeout(() => syncOnline(true), 0);
      return true;
    }
    const st = lib.read(id);
    if (!st || st.version !== 2) { dropBroken(id); return false; }
    ui.online = null;
    setState(st);
    return true;
  }

  function openFirst() {
    while (lib.list.length) {
      const id = lib.active && lib.has(lib.active) ? lib.active : lib.list[lib.list.length - 1].id;
      if (openGame(id)) return true;
    }
    return false;
  }

  function deleteGame(id) {
    const online = lib.kind(id) === 'online';
    if (!confirm(online ? 'Remove this game from this device? It stays on the server, and you can come back with your invite link.' : 'Delete this game? This cannot be undone.')) return;
    const wasOpen = id === lib.active;
    sessions.delete(id);
    lib.remove(id);
    if (wasOpen) {
      ui.state = null; ui.online = null; // the deleted game must not be saved under another id
      if (!openFirst()) newSolo();
    }
    renderGames(); renderGamesBadge();
  }

  const needsMe = s => !s.base.over && s.seatState(s.seat) === 'human' && !s.sent;

  function describe(id) {
    const open = id === lib.active;
    if (lib.kind(id) === 'online') {
      const s = open ? ui.online : sessionFor(id);
      if (!s) return { title: 'Game with friends', detail: 'Could not be read.', need: false };
      const others = [];
      for (let seat = 1; seat <= s.game.humans; seat++) if (seat !== s.seat && s.seatState(seat) === 'human') others.push(s.names[seat] || G.empire(s.base, seat).name.split(' ')[0]);
      let detail = 'Seat ' + s.seat + ', turn ' + s.base.turn + '. ';
      const role = s.seatState(s.seat);
      if (s.base.over) detail += 'Finished.';
      else if (role === 'ai' || role === 'ai-pending') detail += 'The host handed your empire to the AI.';
      else if (role === 'out') detail += 'Your empire is gone.';
      else if (s.sent) detail += 'Orders are in. Waiting for ' + (s.waiting.filter(x => x !== s.seat).map(x => s.names[x] || G.empire(s.base, x).name.split(' ')[0]).join(', ') || 'the turn to play') + '.';
      else detail += 'Your move.';
      return { title: 'With friends' + (others.length ? ': ' + others.join(', ') : ''), detail, need: needsMe(s) };
    }
    const st = open ? ui.state : lib.read(id);
    if (!st || st.version !== 2) return { title: 'Solo game', detail: 'Could not be read.', need: false };
    return { title: 'Solo game', detail: 'Turn ' + st.turn + ', ' + st.difficulty + ', ' + st.worlds.length + ' worlds.' + (st.over ? ' Finished.' : ''), need: false };
  }

  function renderGames() {
    const el = $('games-list');
    el.innerHTML = lib.list.slice().reverse().map(g => {
      const d = describe(g.id), open = g.id === lib.active;
      return '<div class="gamerow' + (open ? ' open' : '') + '"><div><b>' + esc(d.title) + '</b>' + (open ? ' <span class="dim">(open now)</span>' : '') +
        (d.need && !open ? ' <span class="badge">your move</span>' : '') + '</div><div class="dim">' + esc(d.detail) + '</div>' +
        '<div class="row">' + (open ? '' : '<button data-g="open" data-id="' + g.id + '" class="primary">Open</button>') + '<button data-g="del" data-id="' + g.id + '">' + (g.kind === 'online' ? 'Remove' : 'Delete') + '</button></div></div>';
    }).join('') || '<p class="dim">No games yet.</p>';
  }

  function renderGamesBadge() {
    let n = 0;
    for (const [id, s] of sessions) if (id !== lib.active && lib.has(id) && needsMe(s)) n++;
    $('b-new').innerHTML = 'Games' + (n ? ' <span class="badge">' + n + '</span>' : '');
  }

  function openGames() {
    renderGames();
    $('d-games').showModal();
    // look at the other games with friends, so the list says whose move it is
    Promise.all([...sessions].filter(([id, s]) => id !== lib.active && lib.has(id) && !s.base.over).map(([, s]) => s.sync().then(() => persist(s)))).then(() => {
      if ($('d-games').open) renderGames();
      renderGamesBadge();
    });
  }
  $('games-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-g]');
    if (!b) return;
    if (b.dataset.g === 'open') { $('d-games').close(); openGame(b.dataset.id); } else deleteGame(b.dataset.id);
  });
  $('b-games-new').onclick = () => { $('d-games').close(); openNew(); };
  $('b-games-friends').onclick = () => { $('d-games').close(); $('b-friends').click(); };

  // The games that are not open get a look every 30 s while the page is visible, so the badge on Games stays true.
  setInterval(async () => {
    if (document.hidden) return;
    for (const [id, s] of sessions) {
      if (s === ui.online || !lib.has(id) || s.base.over) continue;
      await s.sync(); persist(s);
    }
    renderGamesBadge();
    if ($('d-games').open) renderGames();
  }, 30000);

  // ---------- boot ----------

  resize();
  let firstRun = false;
  if (!lib.active || !openGame(lib.active)) {
    if (!openFirst()) { newSolo(); firstRun = true; } // nothing usable on this device: a fresh game, saved at once so a refresh keeps it
  }
  setTimeout(() => { for (const g of lib.list) if (g.kind === 'online') sessionFor(g.id); renderGamesBadge(); }, 0);
  // first visit: ask for a name once, then show the intro. A link is handled after that.
  (async () => {
    const viaLink = /^#join=/.test(location.hash);
    if (!viaLink) await ensureName(); // a link goes straight to the game: the name is asked after, and only if still needed
    if (firstRun && !viaLink) {
      try {
        if (!localStorage.getItem('sectordominion-help-seen')) { localStorage.setItem('sectordominion-help-seen', '1'); $('d-help').showModal(); }
      } catch (e) { /* storage blocked: skip the intro */ }
    }
    handleHash();
  })();
  // phones can drop a page without warning, so write the game down whenever the page is hidden or closed
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
})();
