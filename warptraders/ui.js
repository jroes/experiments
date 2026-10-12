(function () {
  'use strict';
  const G = window.WT;
  const KEY = 'warptraders-save-v1', BEST = 'warptraders-best-v1';
  const $ = id => document.getElementById(id);
  const canvas = $('map'), ctx = canvas.getContext('2d');
  let s, view = { sc: 1, ox: 0, oy: 0 }, hover = null, qty = {};
  let net = null, race = null; // race: { me, players: {id: {name, credits, turnsLeft, done}} }
  Sound.load().mount($('b-sound'));
  let wasOver = null, wasEncounter = null; // what the last sound was for

  const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function save() { if (race) return; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  function load() {
    try { const o = JSON.parse(localStorage.getItem(KEY)); return o && o.version === 2 ? o : null; } catch (e) { return null; }
  }
  function best() { try { return +localStorage.getItem(BEST) || 0; } catch (e) { return 0; } }

  const num = n => Math.floor(n).toLocaleString();
  const here = () => s.sectors[s.sector];
  const known = id => s.visited.includes(id) || s.visited.some(v => s.sectors[v].warps.includes(id));

  function refresh() {
    // sounds follow what changes: pirates showing up, the run ending
    if (wasEncounter === false && s.encounter) Sound.play('alarm');
    if (wasOver === false && s.over) Sound.play('win');
    wasEncounter = !!s.encounter; wasOver = !!s.over;
    $('s-turns').textContent = s.turnsLeft;
    $('s-credits').textContent = num(s.credits);
    $('s-holds').textContent = G.cargoUsed(s) + '/' + s.holds;
    $('s-fighters').textContent = s.fighters;
    $('s-seed').textContent = s.seed;
    renderSector(); renderLog(); draw();
    const b = $('banner');
    if (s.over) {
      let hi = best();
      if (s.score > hi) { hi = s.score; try { localStorage.setItem(BEST, String(hi)); } catch (e) { /* ignore */ } }
      b.hidden = false;
      b.innerHTML = '<b class="good">Run over</b><br>Final credits ' + num(s.score) + '<br><span class="dim">Best ' + num(hi) +
        '</span><br><button id="b-share">Copy result to share</button> <button class="primary" id="b-again">New game</button>';
      $('b-again').onclick = newGame;
      $('b-share').onclick = async () => {
        const text = 'Warp Traders, seed ' + s.seed + ': ' + num(s.score) + ' credits. Same galaxy, beat it: ' +
          location.origin + location.pathname + ' (New game, seed ' + s.seed + ')';
        try { await navigator.clipboard.writeText(text); $('b-share').textContent = 'Copied'; } catch (e) { prompt('Copy this:', text); }
      };
    } else b.hidden = true;
    if (!race) save();
    sendScore();
  }

  function renderSector() {
    const sec = here(), el = $('p-sector');
    let h = '<h2>Sector ' + (sec.id + 1) + (sec.id === 0 ? '<small>Stardock</small>' : '') + '</h2>';

    if (s.encounter) {
      const e = s.encounter;
      h += '<div class="enc"><b class="bad">Pirates!</b> Strength ' + e.strength + '. You have ' + s.fighters + ' fighters.<div class="btns">' +
        '<button data-act="fight" ' + (s.fighters ? '' : 'disabled') + '>Fight</button>' +
        '<button data-act="pay" ' + (s.credits >= e.strength * 25 ? '' : 'disabled') + '>Pay ' + e.strength * 25 + '</button>' +
        '<button data-act="flee">Flee (1 turn)</button></div></div>';
      el.innerHTML = h; return;
    }

    if (sec.port) {
      h += '<table class="port-table"><tr><th></th><th>Price</th><th>Stock</th><th>You</th><th></th></tr>';
      for (const g of G.GOODS) {
        const p = sec.port, selling = p.mode[g] === 'sell';
        const price = G.unitPrice(g, p.stock[g], p.max[g]);
        const avg = s.cargo[g] ? s.paid[g] / s.cargo[g] : 0;
        const q = Math.max(0, Math.floor(qty[g] ?? 0));
        h += '<tr><td>' + G.LABEL[g] + '<br><small class="dim">' + (selling ? 'port sells' : 'port buys') + '</small></td>' +
          '<td>' + price.toFixed(1) + '</td><td>' + Math.floor(p.stock[g]) + '</td>' +
          '<td>' + s.cargo[g] + (avg ? '<br><small class="dim">avg ' + avg.toFixed(1) + '</small>' : '') + '</td>' +
          '<td><input type="number" min="0" data-g="' + g + '" value="' + (qty[g] ?? '') + '" placeholder="qty">' +
          '<div class="btns"><button class="small" data-act="' + (selling ? 'buy' : 'sell') + '" data-g="' + g + '">' + (selling ? 'Buy' : 'Sell') + '</button>' +
          '<button class="small" data-act="max" data-g="' + g + '">max</button></div></td></tr>';
      }
      h += '</table>';
    } else if (sec.id !== 0) h += '<p class="dim">No port here.</p>';

    if (sec.id === 0) {
      h += '<h3>Shipyard</h3><div class="btns">' +
        '<button data-act="holds" ' + (s.credits >= G.holdCost(s) ? '' : 'disabled') + '>+5 holds (' + G.holdCost(s) + ')</button>' +
        '<button data-act="fighters1" ' + (s.credits >= G.FIGHTER_COST ? '' : 'disabled') + '>+1 fighter (' + G.FIGHTER_COST + ')</button>' +
        '<button data-act="fighters10" ' + (s.credits >= 10 * G.FIGHTER_COST ? '' : 'disabled') + '>+10 fighters (' + 10 * G.FIGHTER_COST + ')</button></div>';
    }

    h += '<h3>Warp lanes</h3><div class="warps">' +
      sec.warps.map(w => '<button data-act="warp" data-to="' + w + '">' + (w + 1) + (s.visited.includes(w) ? '' : '?') + '</button>').join('') + '</div>';
    el.innerHTML = h;
  }

  function renderLog() {
    $('log').innerHTML = s.log.slice(0, 50).map(l => '<li class="' + esc(l.kind) + '"><b>T' + l.turn + '</b>' + esc(l.text) + '</li>').join('');
  }

  function msg(r) { if (r && !r.ok && r.msg) { s.log.unshift({ turn: G.START_TURNS - s.turnsLeft, text: r.msg, kind: 'bad' }); } }

  $('side').addEventListener('input', e => {
    if (e.target.dataset.g) qty[e.target.dataset.g] = e.target.value;
  });
  $('side').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const a = b.dataset.act, g = b.dataset.g;
    let r;
    if (a === 'buy') r = G.trade(s, g, +qty[g] || 0, true);
    else if (a === 'sell') r = G.trade(s, g, +qty[g] || 0, false);
    else if (a === 'max') { qty[g] = G.maxQty(s, g, here().port.mode[g] === 'sell'); }
    else if (a === 'warp') { r = G.warp(s, +b.dataset.to); qty = {}; }
    else if (a === 'holds') r = G.buyHolds(s);
    else if (a === 'fighters1') r = G.buyFighters(s, 1);
    else if (a === 'fighters10') r = G.buyFighters(s, 10);
    else if (a === 'fight' || a === 'pay' || a === 'flee') { r = G.resolve(s, a); qty = {}; }
    msg(r);
    if (r && !r.ok) Sound.play('nope');
    else if (a === 'warp') Sound.play('warp');
    else if (a === 'buy' || a === 'sell') Sound.play('coin');
    else if (a === 'fight') Sound.play('battle');
    else if (a === 'pay' || a === 'holds' || a === 'fighters1' || a === 'fighters10') Sound.play('build');
    else if (a === 'flee') Sound.play('warp');
    else Sound.play('tick');
    refresh();
  });

  // ---------- map ----------

  function fit() {
    const r = canvas.getBoundingClientRect();
    view.sc = Math.min(r.width / (G.W + 4), r.height / (G.H + 4));
    view.ox = (r.width - G.W * view.sc) / 2; view.oy = (r.height - G.H * view.sc) / 2;
  }
  function resize() {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (s) { fit(); draw(); }
  }
  const X = x => view.ox + x * view.sc, Y = y => view.oy + y * view.sc;

  function draw() {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    // lanes between known sectors
    ctx.strokeStyle = '#1c2a44'; ctx.lineWidth = 1;
    for (const sec of s.sectors) {
      if (!known(sec.id)) continue;
      for (const w of sec.warps) {
        if (w < sec.id || !known(w)) continue;
        const o = s.sectors[w], seen = s.visited.includes(sec.id) || s.visited.includes(w);
        if (!seen) continue;
        ctx.beginPath(); ctx.moveTo(X(sec.x), Y(sec.y)); ctx.lineTo(X(o.x), Y(o.y)); ctx.stroke();
      }
    }
    ctx.textAlign = 'center'; ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    for (const sec of s.sectors) {
      if (!known(sec.id)) continue;
      const vis = s.visited.includes(sec.id), x = X(sec.x), y = Y(sec.y);
      const snap = s.seen[sec.id];
      ctx.fillStyle = sec.id === 0 ? '#ffb454' : !vis ? '#2a3a5c' : snap ? '#5ee0b0' : '#6b7a94';
      ctx.beginPath(); ctx.arc(x, y, vis ? 5 : 3.5, 0, 7); ctx.fill();
      ctx.fillStyle = vis ? '#cfe3ff' : '#4a5a7c';
      ctx.fillText(sec.id + 1, x, y - 9);
      if (sec.id === s.sector) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke(); }
      else if (hover === sec.id) { ctx.strokeStyle = '#ffb454'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke(); }
    }
  }

  function sectorAt(px, py) {
    let best = null, bd = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 26 : 16;
    for (const sec of s.sectors) {
      if (!known(sec.id)) continue;
      const d = Math.hypot(X(sec.x) - px, Y(sec.y) - py);
      if (d < bd) { bd = d; best = sec.id; }
    }
    return best;
  }

  function tipText(id) {
    const sec = s.sectors[id], snap = s.seen[id];
    let t = 'Sector ' + (id + 1);
    if (id === 0) t += ' (Stardock)';
    else if (!s.visited.includes(id)) t += ' (unexplored)';
    else if (!snap) t += ' (no port)';
    else {
      t += ' - ' + G.GOODS.map(g => (snap.port.mode[g] === 'sell' ? 'sells ' : 'buys ') + g[0].toUpperCase() +
        ' @' + G.unitPrice(g, snap.port.stock[g], snap.port.max[g]).toFixed(0)).join(', ') + ' (T' + snap.turn + ')';
    }
    return t;
  }

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const id = sectorAt(px, py);
    if (id !== hover) { hover = id; draw(); }
    const tip = $('tip');
    if (id == null) tip.hidden = true;
    else { tip.hidden = false; tip.textContent = tipText(id); tip.style.left = (px + 14) + 'px'; tip.style.top = (py + 14) + 'px'; }
  });
  canvas.addEventListener('pointerleave', () => { hover = null; $('tip').hidden = true; draw(); });
  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect(), id = sectorAt(e.clientX - r.left, e.clientY - r.top);
    if (id == null || id === s.sector) return;
    const t = G.travel(s, id); msg(t); Sound.play(t.ok ? 'warp' : 'nope'); qty = {}; refresh();
  });


  // ---------- race mode (friends over P2P) ----------

  function standing() {
    return Object.entries(race.players).map(([id, p]) => ({ id: +id, ...p })).sort((a, b) => b.credits - a.credits);
  }

  function renderRace() {
    const el = $('p-race');
    el.hidden = !race;
    if (!race) return;
    const rows = standing(), allDone = rows.every(r => r.done || r.left);
    el.innerHTML = '<h3>Race' + (allDone ? ' - final' : '') + '</h3><table class="port-table">' +
      '<tr><th>#</th><th>Player</th><th>Credits</th><th>Turns</th></tr>' +
      rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + (r.id === race.me ? ' (you)' : '') + (r.left ? ' <span class="dim">left</span>' : '') +
        '</td><td>' + num(r.credits) + '</td><td>' + (r.done ? 'done' : r.turnsLeft) + '</td></tr>').join('') + '</table>';
  }

  let lastSent = '';
  function sendScore() {
    if (!race || !net) return;
    race.players[race.me] = { ...race.players[race.me], credits: Math.floor(s.credits), turnsLeft: s.turnsLeft, done: s.over };
    const m = { t: 'score', credits: Math.floor(s.credits), turnsLeft: s.turnsLeft, done: s.over };
    const key = JSON.stringify(m);
    if (key !== lastSent) {
      lastSent = key;
      if (net.role === 'host') net.broadcast({ t: 'scores', players: race.players });
      else net.send(m);
    }
    renderRace();
  }

  function startRace(seed, me, players) {
    race = { me, players };
    s = G.newGame({ seed });
    qty = {}; lastSent = '';
    fit(); refresh();
  }

  function hostRace() {
    net = P2P.host({ maxGuests: 3 });
    const names = {};
    net.on('message', (id, m) => {
      if (!race || !m || m.t !== 'score') return;
      const p = race.players[id + 1];
      if (!p) return;
      if (Number.isFinite(m.credits)) p.credits = Math.floor(m.credits);
      if (Number.isFinite(m.turnsLeft)) p.turnsLeft = m.turnsLeft;
      p.done = !!m.done;
      net.broadcast({ t: 'scores', players: race.players });
      renderRace();
    });
    net.on('close', id => {
      if (race && race.players[id + 1]) { race.players[id + 1].left = true; net.broadcast({ t: 'scores', players: race.players }); renderRace(); }
    });
    Lobby.showHost(net, {
      title: 'Host a race', startLabel: 'Start race',
      onStart() {
        const open = [...net.peers.values()].filter(p => p.state === 'open');
        const seed = (Math.random() * 1e9) | 0;
        const players = { 1: { name: 'Host', credits: 1000, turnsLeft: G.START_TURNS, done: false } };
        for (const p of open) players[p.id + 1] = { name: 'Friend ' + p.id, credits: 1000, turnsLeft: G.START_TURNS, done: false };
        startRace(seed, 1, players);
        for (const p of open) net.send(p.id, { t: 'start', seed, me: p.id + 1, players });
      },
    });
  }

  function joinRace() {
    net = P2P.guest();
    net.on('message', m => {
      if (!m) return;
      if (m.t === 'start' && Number.isInteger(m.seed) && Number.isInteger(m.me) && m.players && typeof m.players === 'object') {
        startRace(m.seed, m.me, m.players);
        document.querySelectorAll('dialog.lobby').forEach(d => d.close());
      } else if (m.t === 'scores' && race && m.players && typeof m.players === 'object') {
        for (const [id, p] of Object.entries(m.players)) {
          if (+id === race.me) continue;
          if (p && typeof p.name === 'string') race.players[id] = { name: p.name.slice(0, 20), credits: +p.credits || 0, turnsLeft: +p.turnsLeft || 0, done: !!p.done, left: !!p.left };
        }
        renderRace();
      }
    });
    net.on('close', () => { if (race) { for (const p of Object.values(race.players)) p.left = p.left || false; renderRace(); } });
    Lobby.showJoin(net, { title: 'Join a race' });
  }

  $('b-mp').onclick = () => $('d-mp').showModal();
  $('f-mp').addEventListener('submit', e => {
    const v = e.submitter && e.submitter.value;
    if (v === 'host') hostRace(); else if (v === 'join') joinRace();
  });

  function newGame() {
    const raw = prompt('Galaxy seed (a number). Friends who use the same seed get the same galaxy, so you can compare scores. Leave blank for a random one.', '');
    if (raw === null) return;
    const n = raw.trim() === '' ? undefined : Math.floor(Number(raw));
    if (n !== undefined && (!Number.isFinite(n) || Math.abs(n) > 2147483647)) { alert('Seed must be a whole number.'); return; }
    s = G.newGame({ seed: n }); qty = {}; fit(); refresh();
  }
  $('b-new').onclick = () => { if (race) { alert('Reload the page to leave the race.'); return; } if (s.over || confirm('Start a new game? Current run is lost.')) newGame(); };
  $('b-retire').onclick = () => { if (!s.over && confirm('Retire and bank your credits?')) { G.retire(s); refresh(); } };
  $('b-help').onclick = () => $('d-help').showModal();
  $('b-intro').onclick = () => { $('d-help').close(); $('d-intro').showModal(); $('v-intro').play().catch(() => { /* the player's own button works */ }); };
  $('d-intro').addEventListener('close', () => $('v-intro').pause());
  window.addEventListener('resize', resize);

  resize();
  s = load() || G.newGame({});
  fit(); refresh();
  try {
    if (!localStorage.getItem('warptraders-help-seen')) { $('d-help').showModal(); localStorage.setItem('warptraders-help-seen', '1'); }
  } catch (e) { /* ignore */ }
})();
