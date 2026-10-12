// Warp Traders: the universe. A screen and a keyboard for the server's game: nothing here decides anything.
(function () {
  const $ = (id) => document.getElementById(id);
  const SERVER = ((new URLSearchParams(location.search)).get('server') || window.KV_URL || '').replace(/\/$/, '');
  const GAME = SERVER + '/lab/warptraders';
  const KEY = 'wtu:' + SERVER;
  const GOODS = ['fuel', 'organics', 'equipment'];
  const LABEL = { fuel: 'Fuel ore', organics: 'Organics', equipment: 'Equipment' };

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* private window: play without saving */ }
  let token = saved && typeof saved.token === 'string' ? saved.token : null;
  let view = null, viewAt = 0, busy = false, offline = false;
  const logLines = [];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n).toLocaleString('en-US');

  async function api(method, path, body) {
    const r = await fetch(GAME + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, json: j, retry: r.headers.get('Retry-After') };
  }

  function log(text, cls) {
    logLines.unshift({ text, cls });
    logLines.length = Math.min(logLines.length, 60);
    $('log').innerHTML = logLines.map((l) => `<li class="${l.cls || ''}">${esc(l.text)}</li>`).join('');
  }

  // ---- talking to the server ----
  async function refresh() {
    if (!token || busy) return;
    try {
      const r = await api('GET', '/me');
      if (r.status === 401) { forget(); return; }
      if (r.status !== 200) throw new Error('status ' + r.status);
      setView(r.json);
      offline = false;
    } catch (e) {
      if (!offline) log('Cannot reach the server. Trying again.', 'bad');
      offline = true;
    }
  }

  async function act(a) {
    if (busy) return;
    busy = true;
    try {
      const r = await api('POST', '/act', a);
      if (r.status === 200) { log(r.json.msg, /^Victory|Bought|Sold/.test(r.json.msg) ? 'good' : ''); setView(r.json.view); }
      else if (r.status === 429) log('Slow down a little.', 'bad');
      else if (r.status === 401) forget();
      else log(r.json.message || 'Refused.', 'bad');
    } catch (e) { log('Cannot reach the server.', 'bad'); }
    busy = false;
  }

  function forget() {
    token = null; view = null;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    askJoin('The server does not know that key any more (it may have been reset). Pick a name to start again.');
  }

  function setView(v) {
    const prevInbox = view ? view.inbox.length : v.inbox.length;
    view = v; viewAt = Date.now();
    if (v.inbox.length > prevInbox) log('New message in your inbox.', 'battle');
    render();
  }

  // ---- drawing ----
  function render() {
    if (!view) return;
    const y = view.you;
    $('s-turns').textContent = y.turns + '/' + y.turns_cap;
    $('s-credits').textContent = num(y.credits);
    $('s-holds').textContent = Object.values(y.cargo).reduce((a, b) => a + b, 0) + '/' + y.holds;
    $('s-fighters').textContent = num(y.fighters);
    $('s-rank').textContent = y.rank + ' of ' + y.players;
    tickTimer();
    renderHere(); renderPort(); renderShip(); renderInbox();
    $('news').innerHTML = view.news.map((n) => `<li>${esc(n.ago)} ago: ${esc(n.text)}</li>`).join('') || '<li>Nothing yet.</li>';
    drawMap();
  }

  function tickTimer() {
    if (!view) return;
    const y = view.you;
    if (y.turns >= y.turns_cap) { $('s-next').textContent = ' (full)'; return; }
    const left = Math.max(0, y.next_turn_in - Math.floor((Date.now() - viewAt) / 1000));
    $('s-next').textContent = ' (+1 in ' + left + 's)';
  }

  function renderHere() {
    const s = view.sector, y = view.you;
    let h = `<h2>Sector ${s.id + 1}${s.dock ? ' <small>Stardock</small>' : ''}</h2>`;
    if (y.protected_secs > 0) h += `<p class="pill">Protected for ${Math.ceil(y.protected_secs / 60)} more minutes. Attacking ends it.</p>`;
    h += '<div class="warps">' + s.warps.map((w) => `<button class="small" data-warp="${w}">to ${w + 1}</button>`).join('') + '</div>';
    if (s.here.length) {
      h += '<h3>Traders here</h3>' + s.here.map((o) =>
        `<div class="player-row"><span class="dot ${o.online ? 'on' : ''}"></span><b>${esc(o.name)}</b>` +
        `<span class="dim">${esc(o.fighters)} fighters${o.loaded ? ', loaded' : ''}${o.protected ? ', protected' : ''}</span>` +
        `<button class="small" data-say="${esc(o.name)}">Message</button>` +
        (s.dock || o.protected ? '' : `<button class="small" data-attack="${esc(o.name)}">Attack</button>`) + '</div>').join('');
    } else h += '<p class="dim">Nobody else is here.</p>';
    $('p-here').innerHTML = h;
  }

  function renderPort() {
    const s = view.sector, y = view.you, el = $('p-port');
    if (s.dock) {
      el.innerHTML = `<h3>Stardock</h3><p class="dim">Buy holds and fighters. Nobody fights here.</p><div class="btns">` +
        `<button data-holds="1">+5 holds (${num(view.costs.hold)})</button>` +
        [1, 10, 25].map((n) => `<button data-fighters="${n}">+${n} fighters (${num(n * view.costs.fighter)})</button>`).join('') + '</div>';
      return;
    }
    if (!s.port) { el.innerHTML = '<h3>No port</h3><p class="dim">Empty space. Keep going.</p>'; return; }
    let h = '<h3>Port</h3><table class="port-table"><tr><th>Good</th><th></th><th class="num">Stock</th><th class="num">Price</th><th class="num">You have</th></tr>';
    for (const g of s.port.goods) {
      h += `<tr><td>${esc(g.label)}</td><td>${g.mode === 'sell' ? 'sells' : 'buys'}</td><td class="num">${num(g.stock)}</td><td class="num">${g.price}</td><td class="num">${y.cargo[g.good]}${y.cargo[g.good] ? ` <span class="dim">(${y.avg_paid[g.good]})</span>` : ''}</td></tr>`;
    }
    h += '</table>';
    for (const g of s.port.goods) {
      h += `<div class="trade-row"><span style="width:84px">${esc(g.label)}</span><input type="number" min="1" inputmode="numeric" placeholder="qty" data-qty="${g.good}">` +
        `<button class="small" data-${g.mode === 'sell' ? 'buy' : 'sell'}="${g.good}">${g.mode === 'sell' ? 'Buy' : 'Sell'}</button>` +
        `<button class="small" data-${g.mode === 'sell' ? 'buy' : 'sell'}-max="${g.good}">Max</button></div>`;
    }
    el.innerHTML = h;
  }

  function renderShip() {
    const y = view.you;
    $('p-ship').innerHTML = `<h3>Your ship</h3><div class="kv"><div>Net worth</div><div>${num(y.net_worth)}</div><div>Kills</div><div>${y.kills}</div><div>Times destroyed</div><div>${y.deaths}</div></div>`;
  }

  function renderInbox() {
    const el = $('p-inbox');
    if (!view.inbox.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<h3>Inbox</h3><ul id="inbox-list">' + view.inbox.map((m) => `<li><b>${esc(m.from)}</b> ${esc(m.ago)} ago: ${esc(m.text)}</li>`).join('') + '</ul>';
  }

  // ---- map ----
  const cv = $('map'), ctx = cv.getContext('2d');
  let fit = null;
  function drawMap() {
    if (!view) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const m = view.map;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const s of m) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); }
    const pad = 24, sc = Math.min((w - pad * 2) / Math.max(x1 - x0, 20), (h - pad * 2) / Math.max(y1 - y0, 20));
    const ox = (w - (x1 - x0) * sc) / 2 - x0 * sc, oy = (h - (y1 - y0) * sc) / 2 - y0 * sc;
    fit = { sc, ox, oy };
    const by = new Map(m.map((s) => [s.id, s]));
    ctx.lineWidth = 1; ctx.strokeStyle = '#1c2a44';
    for (const s of m) for (const t of s.warps) { const o = by.get(t); if (!o || t < s.id) continue; ctx.beginPath(); ctx.moveTo(s.x * sc + ox, s.y * sc + oy); ctx.lineTo(o.x * sc + ox, o.y * sc + oy); ctx.stroke(); }
    for (const s of m) {
      const px = s.x * sc + ox, py = s.y * sc + oy, here = s.id === view.sector.id;
      ctx.fillStyle = s.dock ? '#ffd34e' : s.port ? '#5ee0b0' : s.visited ? '#6b7a94' : '#2a3a5c';
      ctx.beginPath(); ctx.arc(px, py, s.dock ? 6 : s.port ? 4.5 : 3, 0, 7); ctx.fill();
      if (here) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.stroke(); }
    }
  }
  function pick(ev) {
    if (!fit || !view) return null;
    const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    let best = null, bd = 22 * 22;
    for (const s of view.map) { const dx = s.x * fit.sc + fit.ox - x, dy = s.y * fit.sc + fit.oy - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = s; } }
    return best;
  }
  cv.addEventListener('click', (ev) => {
    const s = pick(ev);
    if (s && s.id !== view.sector.id) act({ do: 'travel', to: s.id });
  });
  cv.addEventListener('mousemove', (ev) => {
    const s = pick(ev), tip = $('tip');
    if (!s) { tip.hidden = true; return; }
    let t = 'Sector ' + (s.id + 1) + (s.dock ? ' (Stardock)' : '');
    if (s.port) t += '\n' + s.port.goods.map((g) => `${LABEL[g.good]} ${g.mode === 'sell' ? 'sells' : 'buys'} ${g.price}`).join(', ') + ' (' + s.port.ago + ' ago)';
    tip.textContent = t; tip.style.whiteSpace = 'pre'; tip.hidden = false;
    tip.style.left = Math.min(ev.offsetX + 12, cv.clientWidth - 220) + 'px'; tip.style.top = ev.offsetY + 12 + 'px';
  });
  cv.addEventListener('mouseleave', () => { $('tip').hidden = true; });
  window.addEventListener('resize', drawMap);

  // ---- buttons ----
  const qtyOf = (good) => { const el = document.querySelector(`[data-qty="${good}"]`); const n = parseInt(el && el.value, 10); return n > 0 ? n : 1; };
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !view) return;
    const d = b.dataset;
    if (d.warp !== undefined) act({ do: 'warp', to: +d.warp });
    else if (d.buy) act({ do: 'buy', good: d.buy, qty: qtyOf(d.buy) });
    else if (d.sell) act({ do: 'sell', good: d.sell, qty: qtyOf(d.sell) });
    else if (d.buyMax) act({ do: 'buy', good: d.buyMax, qty: 'max' });
    else if (d.sellMax) act({ do: 'sell', good: d.sellMax, qty: 'max' });
    else if (d.holds) act({ do: 'holds' });
    else if (d.fighters) act({ do: 'fighters', qty: +d.fighters });
    else if (d.attack) {
      const o = view.sector.here.find((p) => p.name === d.attack);
      if (confirm('Attack ' + d.attack + '? It costs ' + view.costs.attack_turns + ' turns and a loss sends you back to Stardock with no fighters or cargo.' + (o ? ' They have ' + o.fighters + ' fighters.' : ''))) act({ do: 'attack', target: d.attack });
    } else if (d.say) { sayTo = d.say; $('say-title').textContent = 'Message to ' + d.say; $('in-say').value = ''; $('d-say').showModal(); }
  });
  let sayTo = null;
  $('f-say').addEventListener('submit', (ev) => {
    if (ev.submitter && ev.submitter.value === 'send' && $('in-say').value.trim()) act({ do: 'say', to: sayTo, text: $('in-say').value });
  });
  $('b-help').onclick = () => $('d-help').showModal();
  $('b-board').onclick = async () => {
    $('board-table').innerHTML = '<tr><td class="dim">Loading…</td></tr>';
    $('d-board').showModal();
    try {
      const r = await api('GET', '/board');
      const b = r.json;
      $('board-sum').textContent = b.players + ' traders, ' + b.online + ' online, ' + b.sectors + ' sectors.';
      $('board-table').innerHTML = '<tr><th>#</th><th>Trader</th><th class="num">Net worth</th><th class="num">Kills</th></tr>' +
        b.top.map((t) => `<tr><td>${t.rank}</td><td>${t.online ? '● ' : ''}${esc(t.name)}</td><td class="num">${num(t.net_worth)}</td><td class="num">${t.kills}</td></tr>`).join('');
    } catch (e) { $('board-table').innerHTML = '<tr><td class="bad">Cannot reach the server.</td></tr>'; }
  };

  // ---- joining ----
  function askJoin(msg) {
    $('join-err').textContent = msg || '';
    if (!$('d-join').open) $('d-join').showModal();
    $('in-name').focus();
  }
  $('f-join').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = $('in-name').value.trim();
    $('join-err').textContent = 'Joining…';
    try {
      const r = await api('POST', '/join', { name });
      if (r.status === 201) {
        token = r.json.token;
        try { localStorage.setItem(KEY, JSON.stringify({ token, name: r.json.name })); } catch (e) { $('join-err').textContent = ''; log('This browser cannot save your key. Do not close the page.', 'bad'); }
        $('d-join').close();
        $('d-help').showModal();
        refresh();
      } else if (r.status === 429) $('join-err').textContent = 'Too many new traders from this address. Try later.';
      else $('join-err').textContent = r.json.message || 'Could not join.';
    } catch (e) { $('join-err').textContent = 'Cannot reach the server.'; }
  });

  // ---- running ----
  setInterval(tickTimer, 1000);
  setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  if (token) refresh(); else askJoin();
})();
