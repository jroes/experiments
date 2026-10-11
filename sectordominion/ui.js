(function () {
  'use strict';
  const G = window.Game;
  const SAVE_KEY = 'sectordominion-save-v1';
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
  };

  // ---------- save / load ----------

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(ui.state)); } catch (e) { /* storage blocked, fine */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.version === 1 ? s : null;
    } catch (e) { return null; }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- state ----------

  function setState(s) {
    ui.state = s;
    ui.vis = G.visibleWorlds(s, G.PLAYER);
    ui.selected = s.worlds.find(w => w.owner === G.PLAYER)?.id ?? null;
    ui.targeting = false;
    resetSend();
    fitView();
    refresh();
  }

  function resetSend() { for (const t of G.SHIP_ORDER) ui.send[t] = 0; }

  function refresh() {
    ui.vis = G.visibleWorlds(ui.state, G.PLAYER);
    renderTop(); renderWorld(); renderEmpire(); renderLog(); draw();
    const b = $('banner');
    if (ui.state.over) {
      b.hidden = false;
      b.innerHTML = (ui.state.over === 'won' ? '<b class="good">Victory.</b><br>The sector is yours.' :
        '<b class="bad">Defeat.</b><br>Your empire is gone.') +
        '<br><button class="primary" id="b-again">New game</button>';
      $('b-again').onclick = openNew;
    } else b.hidden = true;
  }

  // what the player is allowed to know about a world
  function info(w) {
    if (w.owner === G.PLAYER || ui.vis.has(w.id)) return { live: true, owner: w.owner, pop: Math.floor(w.pop), fort: w.fort, natives: w.natives };
    const k = ui.state.known[w.id];
    return k ? { live: false, owner: k.owner, pop: k.pop, fort: k.fort, natives: k.natives, seen: k.seen } : null;
  }

  function fleetVisible(f) {
    if (f.owner === G.PLAYER) return true;
    const s = ui.state;
    return s.worlds.some(w => w.owner === G.PLAYER && G.dist(w, f) <= 30) ||
      s.fleets.some(g => g.owner === G.PLAYER && G.dist(g, f) <= 20);
  }

  // ---------- top bar / panels ----------

  function renderTop() {
    const s = ui.state, e = s.empires[0];
    $('s-turn').textContent = s.turn;
    $('s-credits').textContent = Math.floor(e.credits);
    $('s-income').textContent = '+' + G.empireIncome(s, G.PLAYER) + '/turn';
    $('s-tech').textContent = e.tech;
    $('s-worlds').textContent = s.worlds.filter(w => w.owner === G.PLAYER).length;
    $('b-end').disabled = !!s.over;
  }

  function shipLine(ships) {
    const parts = G.SHIP_ORDER.filter(t => ships[t]).map(t => ships[t] + ' ' + G.SHIPS[t].name + (ships[t] > 1 ? 's' : ''));
    return parts.length ? parts.join(', ') : 'none';
  }

  function ownerLabel(id) { return id ? ui.state.empires[id - 1].name : 'Unclaimed'; }

  function renderWorld() {
    const el = $('p-world'), s = ui.state;
    if (ui.selected == null) { el.innerHTML = '<h3>No world selected</h3><p class="dim">Click a world on the map.</p>'; return; }
    const w = s.worlds[ui.selected], i = info(w);
    if (!i) { el.innerHTML = '<h3>Unexplored</h3>'; return; }
    const type = G.WORLD_TYPES[w.type].label;
    let h = '<h2>' + w.name + '<small>' + type + '</small></h2><div class="kv">';
    h += '<div>Owner</div><div style="color:' + COLORS[i.owner] + '">' + (i.natives && !i.owner ? 'Natives' : ownerLabel(i.owner)) + '</div>';
    h += '<div>Population</div><div>' + i.pop + ' / ' + w.cap + '</div>';
    h += '<div>Defense</div><div>' + (i.live || i.owner === G.PLAYER ? G.worldDefense(w) : '~' + (i.fort + Math.floor(i.pop / 25))) + '</div>';
    if (!i.live) h += '<div>Intel</div><div class="dim">Last seen turn ' + i.seen + '</div>';
    if (i.live && w.owner) h += '<div>Troops</div><div>' + w.troops + '</div>';
    if (w.owner === G.PLAYER) h += '<div>Income</div><div class="good">+' + Math.floor(G.worldIncome(s, w)) + '</div>';
    h += '</div>';

    if (i.live && w.owner !== G.PLAYER && w.garrison && G.shipCount(w.garrison)) {
      h += '<p>Garrison: ' + shipLine(w.garrison) + '</p>';
    }

    if (w.owner === G.PLAYER) {
      const e = s.empires[0];
      h += '<p>Garrison: ' + shipLine(w.garrison) + '</p>';
      if (w.queue.length) h += '<p class="dim">Building: ' + shipLine(w.queue.reduce((o, t) => (o[t] = (o[t] || 0) + 1, o), {})) + '</p>';
      h += '<h3>Build</h3><div class="btns">';
      for (const t of G.SHIP_ORDER) {
        const sh = G.SHIPS[t];
        h += '<button data-act="build" data-t="' + t + '" ' + (e.credits < sh.cost || s.over ? 'disabled' : '') +
          ' title="atk ' + sh.atk + ' hp ' + sh.hp + ' speed ' + sh.speed + '">' + sh.name + ' ' + sh.cost + '</button>';
      }
      h += '</div><div class="btns"><button data-act="fortify" ' + (w.fort >= 5 || e.credits < G.fortifyCost(w) || s.over ? 'disabled' : '') + '>' +
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
        h += '<div class="btns"><button class="primary" data-act="target" ' + (n && !s.over ? '' : 'disabled') + '>' +
          (ui.targeting ? 'Click a world on the map...' : 'Choose destination') + '</button></div>';
        if (ui.targeting) h += '<p class="hint">Esc to cancel.</p>';
      }
    } else if (ui.vis.size) {
      const near = s.worlds.filter(x => x.owner === G.PLAYER).sort((a, b) => G.dist(a, w) - G.dist(b, w))[0];
      if (near) h += '<p class="dim">' + Math.round(G.dist(near, w)) + ' units from ' + near.name + '.</p>';
    }
    el.innerHTML = h;
  }

  function renderEmpire() {
    const s = ui.state, e = s.empires[0], el = $('p-empire');
    const cost = G.researchCost(s, G.PLAYER);
    let h = '<h3>Empire</h3><div class="btns"><button data-act="research" ' +
      (e.tech >= G.MAX_TECH || e.credits < cost || s.over ? 'disabled' : '') + '>' +
      (e.tech >= G.MAX_TECH ? 'Tech maxed' : 'Research tech ' + (e.tech + 1) + ' (' + cost + ')') + '</button></div>';
    h += '<div class="kv">';
    for (const r of s.empires.slice(1)) {
      h += '<div style="color:' + COLORS[r.id] + '">' + r.name.split(' ')[0] + '</div><div>' + (r.alive ? 'active' : 'eliminated') + '</div>';
    }
    h += '</div>';
    const mine = s.fleets.filter(f => f.owner === G.PLAYER);
    if (mine.length) {
      h += '<h3 style="margin-top:8px">Fleets in transit</h3>';
      for (const f of mine) {
        h += '<div class="dim">' + G.shipCount(f.ships) + ' ships to ' + s.worlds[f.to].name + ', ' + G.eta(s, f) + ' turn' + (G.eta(s, f) > 1 ? 's' : '') + '</div>';
      }
    }
    el.innerHTML = h;
  }

  function renderLog() {
    $('log').innerHTML = ui.state.log.slice(0, 60).map(l =>
      '<li class="' + l.kind + '"><b>T' + l.turn + '</b>' + l.text + '</li>').join('');
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

    // map bounds
    ctx.strokeStyle = '#142038'; ctx.lineWidth = 1;
    ctx.strokeRect(sx(0), sy(0), s.width * sc, s.height * sc);
    ctx.strokeStyle = '#0c1526';
    for (let x = 10; x < s.width; x += 10) { ctx.beginPath(); ctx.moveTo(sx(x), sy(0)); ctx.lineTo(sx(x), sy(s.height)); ctx.stroke(); }
    for (let y = 10; y < s.height; y += 10) { ctx.beginPath(); ctx.moveTo(sx(0), sy(y)); ctx.lineTo(sx(s.width), sy(y)); ctx.stroke(); }

    // sight radii
    ctx.fillStyle = 'rgba(94,224,176,0.04)';
    for (const w of s.worlds) if (w.owner === G.PLAYER) { ctx.beginPath(); ctx.arc(sx(w.x), sy(w.y), 30 * sc, 0, 7); ctx.fill(); }
    for (const f of s.fleets) if (f.owner === G.PLAYER) { ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), 20 * sc, 0, 7); ctx.fill(); }

    // fleet routes
    for (const f of s.fleets) {
      if (!fleetVisible(f)) continue;
      const t = s.worlds[f.to];
      ctx.strokeStyle = COLORS[f.owner]; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx(f.x), sy(f.y)); ctx.lineTo(sx(t.x), sy(t.y)); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // worlds
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
      if (i.owner && i.live || i.owner === G.PLAYER) {
        const f = G.shipCount(w.garrison);
        if (f && (w.owner === G.PLAYER || ui.vis.has(w.id))) {
          ctx.fillStyle = '#cfe3ff'; ctx.fillRect(x - 2, y - rad - 6, 4, 3);
        }
      }
      ctx.fillStyle = i.live ? '#cfe3ff' : '#7d90b0';
      ctx.fillText(w.name, x, y + rad + 12);
      ctx.globalAlpha = 1;
      if (w.id === ui.selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, rad + 5, 0, 7); ctx.stroke(); }
      if (ui.hover === w.id && ui.targeting) { ctx.strokeStyle = '#ffb454'; ctx.beginPath(); ctx.arc(x, y, rad + 8, 0, 7); ctx.stroke(); }
    }

    // fleets
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
      tip.textContent = w.name + ' - ' + (i.natives && !i.owner ? 'Natives' : ownerLabel(i.owner)) + ', pop ' + i.pop;
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

  function dispatchTo(toId) {
    const s = ui.state;
    if (toId === ui.selected) { toast('Pick a different world.'); return; }
    const res = G.sendFleet(s, G.PLAYER, ui.selected, toId, ui.send);
    if (!res.ok) { toast(res.msg); return; }
    G.refreshKnown(s);
    s.log.unshift({ turn: s.turn, text: 'Fleet sent to ' + s.worlds[toId].name + ', ' + res.eta + ' turn' + (res.eta > 1 ? 's' : '') + '.', kind: 'info' });
    ui.targeting = false; resetSend(); save(); refresh();
  }

  function toast(msg) {
    const s = ui.state;
    s.log.unshift({ turn: s.turn, text: msg, kind: 'bad' });
    renderLog();
  }

  // ---------- sidebar actions ----------

  $('side').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b || ui.state.over) return;
    const s = ui.state, act = b.dataset.act, t = b.dataset.t, w = s.worlds[ui.selected];
    let res = { ok: true };
    if (act === 'build') res = G.build(s, w.id, t);
    else if (act === 'fortify') res = G.fortify(s, w.id);
    else if (act === 'research') res = G.research(s, G.PLAYER);
    else if (act === 'inc') ui.send[t] = Math.min(w.garrison[t], ui.send[t] + 1);
    else if (act === 'dec') ui.send[t] = Math.max(0, ui.send[t] - 1);
    else if (act === 'all') ui.send[t] = w.garrison[t];
    else if (act === 'target') ui.targeting = !ui.targeting;
    canvas.classList.toggle('targeting', ui.targeting);
    if (!res.ok) toast(res.msg);
    if (act === 'build' || act === 'fortify' || act === 'research') save();
    refresh();
  });

  // ---------- turn / new game ----------

  function endTurn() {
    if (ui.state.over) return;
    ui.targeting = false;
    canvas.classList.remove('targeting');
    G.endTurn(ui.state);
    save();
    refresh();
  }

  function openNew() { $('d-new').showModal(); }

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

  // ---------- boot ----------

  resize();
  const saved = load();
  setState(saved || G.newGame({}));
  if (!saved) {
    try {
      if (!localStorage.getItem('sectordominion-help-seen')) {
        $('d-help').showModal();
        localStorage.setItem('sectordominion-help-seen', '1');
      }
    } catch (e) { $('d-help').showModal(); }
  }
})();
