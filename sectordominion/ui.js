(function () {
  'use strict';
  const G = window.Game;
  const SAVE_KEY = 'sectordominion-save-v1';
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
    online: null,   // the game with friends, through the shared store (online.js)
    onlineMsg: '',
    onlineBusy: false,
    userView: false, // the player has panned or zoomed, so a resize should not refit the map
    notes: [],      // who came and went, and turns played: shown in the log, not saved
  };

  const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const meEmp = () => G.empire(ui.state, ui.me);
  const mem = () => ui.state.known[ui.me] || {};

  // ---------- save / load ----------

  function save() {
    try {
      if (ui.online) localStorage.setItem(ONLINE_KEY, JSON.stringify(ui.online));
      else localStorage.setItem(SAVE_KEY, JSON.stringify(ui.state));
    } catch (e) { /* storage blocked, fine */ }
  }
  function loadOnline() {
    try { return Online.Session.fromSaved(JSON.parse(localStorage.getItem(ONLINE_KEY))); } catch (e) { return null; }
  }
  function clearOnline() { try { localStorage.removeItem(ONLINE_KEY); } catch (e) { /* ignore */ } }
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
    renderTop(); renderOnline(); renderWorld(); renderEmpire(); renderLog(); draw();
    const s = ui.state, b = $('banner'), alive = meEmp().alive;
    if (s.over) {
      b.hidden = false;
      b.innerHTML = (s.winner === ui.me ? '<b class="good">Victory.</b><br>The sector is yours.' :
        s.winner ? '<b class="bad">Defeat.</b><br>' + esc(G.empire(s, s.winner).name) + ' won.' :
          '<b class="bad">Defeat.</b><br>Your empire is gone.') +
        (ui.online ? '' : '<br><button class="primary" id="b-again">New game</button>');
      if (!ui.online) $('b-again').onclick = openNew;
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
      end.disabled = end.disabled || ui.online.sent || ui.onlineBusy;
    } else end.textContent = 'End turn';
  }

  function shipLine(ships) {
    const parts = G.SHIP_ORDER.filter(t => ships[t]).map(t => ships[t] + ' ' + G.SHIPS[t].name + (ships[t] > 1 ? 's' : ''));
    return parts.length ? parts.join(', ') : 'none';
  }

  function ownerLabel(id) { return id ? esc(ui.state.empires[id - 1].name) + (id === ui.me ? ' (you)' : '') : 'Unclaimed'; }

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
          (ui.targeting ? 'Tap a world on the map...' : 'Choose destination') + '</button></div>';
        if (ui.targeting) h += '<p class="hint">' + (coarse ? 'Tap the button again to cancel.' : 'Esc to cancel.') + '</p>';
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
    if (ui.online) { toast('You are in a game with friends. Use Leave game in the Game with friends panel first.'); return; }
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

  // ---------- playing with friends (shared store) ----------

  const baseTitle = document.title;
  const note = (text, kind) => { ui.notes.unshift({ turn: ui.state ? ui.state.turn : 0, text, kind: kind || 'info' }); if (ui.notes.length > 40) ui.notes.length = 40; };
  const nameOf = seat => G.empire(ui.state, seat).name.split(' ')[0];

  function adoptSession() {
    const turnChanged = ui.state && ui.online.working.turn !== ui.state.turn;
    ui.state = ui.online.working;
    ui.me = ui.online.seat;
    if (ui.selected == null || !ui.state.worlds[ui.selected]) ui.selected = ui.state.worlds.find(w => w.owner === ui.me)?.id ?? null;
    if (turnChanged) resetSend();
  }

  function startOnline(session) {
    ui.online = session; ui.state = null; ui.selected = null; ui.notes = [];
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
    const before = ui.online.base.turn;
    try {
      const r = await ui.online.sync();
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
    const r = await ui.online.submit();
    ui.onlineBusy = false;
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
      const e = G.empire(s, seat);
      if (seat !== ui.me && e.human && e.alive) others.push(seat);
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
    h += '<p class="dim">Seat ' + o.seat + ', turn ' + s.turn + '. ' + (o.sent ? 'Your orders are in.' : 'Give your orders, then Send orders.') + '</p>';
    const line = summary(o, s);
    if (line) h += '<p>' + line + '</p>';
    h += '<div class="kv">';
    for (let seat = 1; seat <= g.humans; seat++) {
      const e = G.empire(s, seat), entry = o.entries && o.entries[seat];
      let status;
      if (!e.alive) status = 'eliminated';
      else if (!e.human) status = 'AI';
      else {
        const here = seat === ui.me ? '' : o.isOnline(seat) ? '<span class="good">● online</span>' : '<span class="dim">○ ' + (o.presence[seat] == null ? 'not joined yet' : 'last seen ' + ago(o.presence[seat])) + '</span>';
        const order = entry ? '<span class="good">' + (entry.skip ? 'skipped' : 'orders in') + '</span>' : 'waiting';
        status = (here ? here + ' · ' : '') + order;
      }
      h += '<div style="color:' + COLORS[seat] + '">' + (seat === ui.me ? 'You' : esc(nameOf(seat))) + '</div><div>' + status +
        (o.isHost && seat !== ui.me && e.human && e.alive && !entry ? ' <button class="small" data-act="skip" data-e="' + seat + '" title="Play the turn without them">skip</button> <button class="small" data-act="skip-ai" data-e="' + seat + '" title="Give this empire to the AI for good">AI</button>' : '') + '</div>';
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
      if (!confirm('Leave this game on this device? The game stays on the server. You can come back with your invite link.')) return;
      clearOnline(); ui.online = null; ui.notes = [];
      document.title = baseTitle;
      const solo = load();
      setState(solo || G.newGame({}));
      if (!solo) save();
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
      startOnline(session);
      $('d-online').close();
      openInvites(); // straight to "how do I get my friends in"
    } catch (err) { msg.textContent = err.message; }
  });

  // ----- invite links -----

  // Short on purpose: the page's own address, /j/, then the room and seat. The part after # is never sent to any server.
  const inviteLink = seat => new URL('../j/', location.href).href + '#' + Online.inviteCode(ui.online.game.room, seat);

  function openInvites() {
    if (!ui.online || !ui.online.isHost) return;
    const g = ui.online.game, list = $('invite-list');
    list.innerHTML = '';
    for (let seat = 2; seat <= g.humans; seat++) {
      const url = inviteLink(seat), row = document.createElement('div');
      row.className = 'invite';
      row.innerHTML = '<div class="who">Friend ' + (seat - 1) + ' <span class="dim">(' + esc(nameOf(seat)) + ')</span></div><input readonly aria-label="Invite link for friend ' + (seat - 1) + '"><div class="row"><button type="button" data-copy>Copy link</button></div>';
      const input = row.querySelector('input');
      input.value = url;
      input.addEventListener('focus', () => input.select());
      const btns = row.querySelector('.row');
      if (navigator.share) {
        const sh = document.createElement('button');
        sh.type = 'button'; sh.textContent = 'Share'; sh.className = 'primary';
        sh.onclick = () => navigator.share({ title: 'Sector Dominion', text: 'Join my game of Sector Dominion:', url }).catch(() => { /* closed the share sheet */ });
        btns.appendChild(sh);
      }
      row.querySelector('[data-copy]').onclick = async ev => {
        const b = ev.currentTarget;
        let ok = false;
        try { await navigator.clipboard.writeText(url); ok = true; } catch (err) { input.select(); try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ } }
        b.textContent = ok ? 'Copied' : 'Press and hold to copy';
        setTimeout(() => { b.textContent = 'Copy link'; }, 2000);
      };
      list.appendChild(row);
    }
    $('d-invite').showModal();
  }

  // Joining. A link opens the game page with #join=<code>. If this device is not in a game, that joins straight away.
  // If it is, ask first, because joining swaps the game on this device.
  async function joinGame(invite) {
    const msg = $('join-msg'), go = $('b-join-go'), close = $('b-join-close');
    const server = new URLSearchParams(location.search).get('server') || window.KV_URL || '';
    msg.textContent = 'Joining...'; go.hidden = true; close.textContent = 'Cancel';
    if (!$('d-join').open) $('d-join').showModal();
    try {
      const session = await Online.Session.join(invite, server);
      startOnline(session);
      $('d-join').close(); $('d-online').close();
    } catch (err) { msg.textContent = err.message; close.textContent = 'Close'; }
  }

  $('b-join-online').onclick = () => { $('d-online').close(); joinGame($('t-invite').value); };

  function handleHash() {
    const m = /^#join=(.+)$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search); // the code is not needed in the address bar any more
    const inv = Online.parseInvite(m[1]);
    if (ui.online && inv && inv.room === ui.online.game.room) return; // already in this game
    if (ui.online && inv) {
      $('join-msg').textContent = 'You are already in a game on this device. Joining this one replaces it here. The other game stays on the server, and its link still works.';
      $('b-join-go').hidden = false; $('b-join-close').textContent = 'Not now';
      $('b-join-go').onclick = () => joinGame(m[1]);
      $('d-join').showModal();
    } else joinGame(m[1]);
  }
  window.addEventListener('hashchange', handleHash);

  // ---------- boot ----------

  resize();
  const savedOnline = loadOnline();
  if (savedOnline) {
    ui.online = savedOnline; adoptSession(); fitView(); refresh();
    heartbeat();
    setTimeout(() => syncOnline(true), 0);
  } else {
    const saved = load();
    setState(saved || G.newGame({}));
    if (!saved) {
      save(); // a refresh must bring this same game back, not roll a new one
      try {
        if (!localStorage.getItem('sectordominion-help-seen') && !/^#join=/.test(location.hash)) {
          $('d-help').showModal();
          localStorage.setItem('sectordominion-help-seen', '1');
        }
      } catch (e) { /* storage blocked: skip the intro */ }
    }
  }
  handleHash();
  // phones can drop a page without warning, so write the game down whenever the page is hidden or closed
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
})();
