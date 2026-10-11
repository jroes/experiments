(function () {
  'use strict';
  const G = window.WT;
  const KEY = 'warptraders-save-v1', BEST = 'warptraders-best-v1';
  const $ = id => document.getElementById(id);
  const canvas = $('map'), ctx = canvas.getContext('2d');
  let s, view = { sc: 1, ox: 0, oy: 0 }, hover = null, qty = {};

  function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  function load() {
    try { const o = JSON.parse(localStorage.getItem(KEY)); return o && o.version === 1 ? o : null; } catch (e) { return null; }
  }
  function best() { try { return +localStorage.getItem(BEST) || 0; } catch (e) { return 0; } }

  const num = n => Math.floor(n).toLocaleString();
  const here = () => s.sectors[s.sector];
  const known = id => s.visited.includes(id) || s.visited.some(v => s.sectors[v].warps.includes(id));

  function refresh() {
    $('s-turns').textContent = s.turnsLeft;
    $('s-credits').textContent = num(s.credits);
    $('s-holds').textContent = G.cargoUsed(s) + '/' + s.holds;
    $('s-fighters').textContent = s.fighters;
    renderSector(); renderLog(); draw();
    const b = $('banner');
    if (s.over) {
      let hi = best();
      if (s.score > hi) { hi = s.score; try { localStorage.setItem(BEST, String(hi)); } catch (e) { /* ignore */ } }
      b.hidden = false;
      b.innerHTML = '<b class="good">Run over</b><br>Final credits ' + num(s.score) + '<br><span class="dim">Best ' + num(hi) +
        '</span><br><button class="primary" id="b-again">New game</button>';
      $('b-again').onclick = newGame;
    } else b.hidden = true;
    save();
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
    $('log').innerHTML = s.log.slice(0, 50).map(l => '<li class="' + l.kind + '"><b>T' + l.turn + '</b>' + l.text + '</li>').join('');
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
    msg(r); refresh();
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
    let best = null, bd = 16;
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
    msg(G.travel(s, id)); qty = {}; refresh();
  });

  function newGame() { s = G.newGame({}); qty = {}; fit(); refresh(); }
  $('b-new').onclick = () => { if (s.over || confirm('Start a new game? Current run is lost.')) newGame(); };
  $('b-retire').onclick = () => { if (!s.over && confirm('Retire and bank your credits?')) { G.retire(s); refresh(); } };
  $('b-help').onclick = () => $('d-help').showModal();
  window.addEventListener('resize', resize);

  resize();
  s = load() || G.newGame({});
  fit(); refresh();
  try {
    if (!localStorage.getItem('warptraders-help-seen')) { $('d-help').showModal(); localStorage.setItem('warptraders-help-seen', '1'); }
  } catch (e) { /* ignore */ }
})();
