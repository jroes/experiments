(function () {
  'use strict';
  const T = window.TW;
  const KEY = 'tankwars-save-v1';
  const $ = id => document.getElementById(id);
  const canvas = $('view'), ctx = canvas.getContext('2d');
  const H = T.H;
  let W = T.DEFAULT_W;  // the map's width, set from the game (they come in several sizes)
  let s = null;
  let shown = null;   // what the picture draws while a shell is in the air: the ground and tanks as they were before the shot
  let fx = null;      // shells and explosions being animated
  let busy = false;   // a shot is flying, or the computer is thinking
  let gen = 0;        // bumps on a new game so late timers do nothing
  let shopQueue = [];
  let net = null;     // set while playing online: { sess, ... }
  let queue = [];     // things that happened (shots, round changes) waiting to be shown
  Sound.load().mount($('b-sound'), { music: 'march' });

  const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + n.toLocaleString();

  function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  function load() {
    try { return T.validState(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return null; }
  }

  // ---------- drawing ----------
  const SKIES = [['#1a2a5a', '#6a8fd0'], ['#3a1f4a', '#e08a5a'], ['#0b1a2a', '#2a6a7a'], ['#2a2a3a', '#8a8aa0']];
  const GRASS = ['#3da35d', '#8aa23d', '#3da38a', '#6aa04a'];

  function drawSky() {
    const pal = SKIES[(s.round - 1 + (s.seed & 3)) & 3];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // a few stars that depend on the seed, so each map looks a little different
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    let a = s.seed | 0;
    for (let i = 0; i < 30; i++) {
      a = (Math.imul(a, 1103515245) + 12345) | 0;
      const x = (a >>> 8) % W, y = ((a >>> 4) % 90);
      ctx.fillRect(x, y, 1, 1);
    }
  }

  function drawGround(heights) {
    const grass = GRASS[(s.round - 1 + (s.seed & 3)) & 3];
    for (let x = 0; x < W; x++) {
      const h = heights[x], top = H - h;
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x, top, 1, h);
      ctx.fillStyle = '#4e351f'; ctx.fillRect(x, top + 14 + ((x * 7) % 5), 1, Math.max(0, h - 14));
      ctx.fillStyle = grass; ctx.fillRect(x, top, 1, 2);
    }
  }

  function drawTank(p, active) {
    const x = p.x, sy = H - p.y;
    if (!p.alive) {
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x - 5, sy - 3, 10, 3);
      ctx.fillStyle = '#444'; ctx.fillRect(x - 3, sy - 5, 5, 2);
      ctx.fillStyle = 'rgba(80,80,80,0.6)'; ctx.fillRect(x - 1, sy - 12, 2, 6); ctx.fillRect(x, sy - 16, 2, 3);
      return;
    }
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(x - 5, sy - 2, 10, 2);
    ctx.fillStyle = p.color; ctx.fillRect(x - 4, sy - 5, 8, 3); ctx.fillRect(x - 2, sy - 7, 4, 2);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6; ctx.beginPath();
    ctx.moveTo(x, sy - 6); ctx.lineTo(x + T.cosD(p.angle) * 7, sy - 6 - T.sinD(p.angle) * 7); ctx.stroke();
    if (p.shield > 0) { ctx.strokeStyle = 'rgba(140,220,255,' + (0.35 + 0.4 * (p.shield / T.SHIELD_HP)) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, sy - 4, 9, 0, 6.3); ctx.stroke(); }
    ctx.fillStyle = '#0008'; ctx.fillRect(x - 6, sy - 14, 12, 2);
    ctx.fillStyle = p.hp > 50 ? '#5ee0b0' : p.hp > 25 ? '#ffb454' : '#ff6b6b'; ctx.fillRect(x - 6, sy - 14, Math.round(12 * p.hp / 100), 2);
    if (active) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 3, sy - 21); ctx.lineTo(x + 3, sy - 21); ctx.lineTo(x, sy - 17); ctx.fill(); }
  }

  function draw() {
    if (!s) return;
    drawSky();
    const heights = shown ? shown.heights : s.heights;
    drawGround(heights);
    const players = shown ? shown.players : s.players;
    players.forEach(p => drawTank(p, s.phase === 'aim' && !busy && p.id === s.turn));
    if (fx) {
      for (const sh of fx.shots) {
        const n = Math.min(sh.i, sh.path.length - 1);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let k = Math.max(0, n - 14); k < n; k += 2) ctx.fillRect(Math.round(sh.path[k].x), Math.round(H - sh.path[k].y), 1, 1);
        if (!sh.done) { ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(sh.path[n].x) - 1, Math.round(H - sh.path[n].y) - 1, 2, 2); }
      }
      for (const b of fx.blasts) {
        const t = b.t / 22, r = b.r * Math.min(1, t * 1.6);
        if (t >= 1.4) continue;
        const a = t < 1 ? 1 : (1.4 - t) / 0.4;
        const g = ctx.createRadialGradient(b.x, H - b.y, 0, b.x, H - b.y, Math.max(1, r));
        if (b.kind === 'dirt') { g.addColorStop(0, 'rgba(160,110,60,' + a + ')'); g.addColorStop(1, 'rgba(100,70,40,0)'); }
        else { g.addColorStop(0, 'rgba(255,255,220,' + a + ')'); g.addColorStop(0.5, 'rgba(255,170,40,' + a * 0.9 + ')'); g.addColorStop(1, 'rgba(200,40,0,0)'); }
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, H - b.y, Math.max(1, r), 0, 6.3); ctx.fill();
      }
    }
  }

  // ---------- panels ----------
  const O = window.TWOnline;
  const ONLINE_KEY = 'tankwars-online-v1';
  const mySeat = () => (net ? net.sess.seat : -1);
  const serverUrl = () => new URLSearchParams(location.search).get('server') || window.KV_URL || '';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(ONLINE_KEY)); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(ONLINE_KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del() { try { localStorage.removeItem(ONLINE_KEY); } catch (e) { /* ignore */ } },
  };
  let bannerKind = '';

  function windText() {
    const w = s.wind;
    return w === 0 ? 'calm' : (w < 0 ? '◀ ' : '▶ ') + Math.abs(w);
  }

  // can the person at this screen aim and fire right now?
  function human() {
    return !!s && s.phase === 'aim' && !busy && !queue.length && (net ? s.turn === mySeat() : !s.players[s.turn].ai);
  }

  function refresh() {
    if (!s) return;
    if (W !== s.w || canvas.width !== s.w) { W = s.w; canvas.width = W; canvas.height = H; ctx.imageSmoothingEnabled = false; }
    $('s-round').textContent = s.round + '/' + s.rounds;
    $('s-wind').textContent = windText();
    const p = s.players[s.turn];
    const mine = human();
    $('who').innerHTML = s.phase === 'aim'
      ? '<span class="swatch" style="background:' + p.color + '"></span><b>' + esc(p.name) + '</b>' + (p.ai ? ' <span class="dim">(' + T.AI_LEVELS[p.ai].name + ' computer)</span>' : '') + (net && p.id === mySeat() ? ' <span class="good">(you)</span>' : '') + (p.shield > 0 ? ' <span class="good">shield ' + p.shield + '</span>' : '')
      : '<span class="dim">' + (s.over ? 'Game over' : 'Round over') + '</span>';
    $('v-angle').textContent = p.angle;
    $('v-power').textContent = p.power;
    const sel = $('sel-weapon');
    const opts = ['shell'].concat(T.ITEM_KEYS.filter(k => k !== 'shield' && p.inv[k] > 0));
    if (mine && !opts.includes(p.weapon)) p.weapon = 'shell';
    sel.innerHTML = opts.map(k => '<option value="' + k + '">' + esc(T.WEAPONS[k].name) + (k === 'shell' ? '' : ' x' + p.inv[k]) + '</option>').join('');
    sel.value = p.weapon;
    for (const el of $('ctl').querySelectorAll('button, select')) el.disabled = !mine;
    const view = shown || s; // while a shot is in the air the hit points are the ones from before it
    $('score').innerHTML = s.players.map(q => {
      const v = view.players[q.id];
      const dot = net && q.ai === 0 ? '<span class="dot ' + (net.sess.isOnline(q.id) ? 'on' : 'off') + '" title="' + (net.sess.isOnline(q.id) ? 'online' : 'not here') + '"></span>' : '';
      return '<span class="' + (q.id === s.turn && s.phase === 'aim' ? 'me' : '') + '">' + dot + '<span class="swatch" style="background:' + q.color + '"></span>' + esc(q.name) +
        '<span class="hp"><i style="width:' + v.hp + '%"></i></span>' + money(q.money) + (q.wins ? ' &middot; ' + q.wins + ' win' + (q.wins > 1 ? 's' : '') : '') + '</span>';
    }).join('');
    paintNet();
    draw();
  }

  // the line about the online game: who we are waiting for, and whether we are connected
  function paintNet() {
    const el = $('net');
    if (!net) { el.hidden = true; return; }
    el.hidden = false;
    const sess = net.sess, w = sess.waiting();
    let html = '<span class="good">Online</span>';
    if (net.err) html += ' &middot; <span class="bad">reconnecting&hellip;</span>';
    if (sess.desync) html += ' &middot; <span class="bad">this game no longer matches a friend\'s</span> <button id="b-rebuild">Rebuild</button>';
    let key = '';
    if (w && w.kind === 'move') {
      key = 'm' + s.shots;
      if (w.seat === sess.seat) html += ' &middot; your turn';
      else {
        html += ' &middot; waiting for ' + esc(s.players[w.seat].name) + (sess.isOnline(w.seat) ? '' : ' (not here)');
        if (Date.now() - net.waitSince > 40000 || !sess.isOnline(w.seat) && Date.now() - net.waitSince > 15000) html += ' <button id="b-takeover">Let the computer play</button>';
      }
    } else if (w && w.kind === 'shop') {
      key = 's' + s.round;
      html += ' &middot; waiting for ' + w.seats.map(i => esc(s.players[i].name)).join(', ') + ' to shop';
      if (Date.now() - net.waitSince > 30000) for (const i of w.seats) if (i !== sess.seat) html += ' <button class="skip" data-seat="' + i + '">Start without ' + esc(s.players[i].name) + '</button>';
    }
    if (key !== net.waitKey) { net.waitKey = key; net.waitSince = Date.now(); }
    el.innerHTML = html;
    const t = $('b-takeover'); if (t) t.onclick = async () => { t.disabled = true; try { await sess.takeOver(); } catch (e) { net.err = e.message; } netTick(); };
    for (const b of el.querySelectorAll('.skip')) b.onclick = async () => { b.disabled = true; try { await sess.skipShopper(+b.dataset.seat); } catch (e) { net.err = e.message; } netTick(); };
    const r = $('b-rebuild'); if (r) r.onclick = () => resumeOnline({ room: sess.room, seat: sess.seat });
  }

  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ---------- a shot, shown ----------
  function snapshot() { return { heights: s.heights.slice(), players: s.players.map(p => ({ ...p })) }; }

  // before and after are pictures of the ground and tanks either side of the shot; the game itself has already moved on
  function playShot(ev, before, after, delay, done) {
    busy = true; shown = before; fx = null;
    refresh();
    const g = gen;
    setTimeout(() => {
      if (g !== gen) return;
      Sound.play('shoot');
      fx = { shots: ev.shots.map(sh => ({ path: sh.path, hit: sh.hit, blast: sh.blast, i: 0, done: false })), blasts: [] };
      function frame() {
        if (g !== gen) return;
        let flying = false;
        for (const sh of fx.shots) {
          if (sh.done) continue;
          sh.i += 3;
          if (sh.i >= sh.path.length - 1) { sh.i = sh.path.length - 1; sh.done = true; if (sh.hit.kind !== 'out') startBlast(sh); } else flying = true;
        }
        fx.blasts.forEach(b => b.t++);
        draw();
        if (flying || fx.blasts.some(b => b.t < 30) || fx.shots.some(sh => !sh.done)) requestAnimationFrame(frame);
        else { busy = false; shown = null; fx = null; done(); }
      }
      function startBlast(sh) {
        const b = sh.blast;
        if (!b) return;
        fx.blasts.push({ ...b, t: 0 });
        shown = after; // from here the picture shows the ground after the hit
        Sound.play(b.kind === 'dirt' ? 'thud' : 'boom');
        if (ev.killed.length && fx.blasts.length === 1) setTimeout(() => Sound.play('bad'), 200);
      }
      requestAnimationFrame(frame);
    }, delay);
  }

  // ---------- one device ----------
  function save() { if (net) return; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  function load() {
    try { return T.validState(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return null; }
  }

  function afterShot() {
    save();
    refresh();
    if (s.phase === 'roundover') return roundOver();
    nextTurn();
  }

  function nextTurn() {
    if (net || s.phase !== 'aim') return;
    const p = s.players[s.turn];
    if (!p.ai) return;
    busy = true; refresh();
    const g = gen;
    setTimeout(() => {
      if (g !== gen) return;
      T.aiPlay(s); refresh();
      setTimeout(() => { if (g === gen) { busy = false; doFire(); } }, 800);
    }, 500);
  }

  function doFire() {
    const before = snapshot();
    const ev = T.fire(s);
    if (!ev) return;
    playShot(ev, before, snapshot(), 0, afterShot);
  }

  function fireNow() {
    if (!human()) return;
    if (net) fireOnline(); else doFire();
  }

  // ---------- the shop ----------
  // You pick things into a basket; nothing is bought until you press Done (online, everyone's baskets are applied together).
  function openShop(seat, onDone) {
    const p = s.players[seat], d = $('d-shop'), basket = [];
    function paint() {
      const spent = basket.reduce((n, k) => n + T.ITEMS[k].cost, 0), left = p.money - spent;
      $('shop-title').innerHTML = '<span class="swatch" style="background:' + p.color + '"></span>' + esc(p.name) + ' &middot; ' + money(left);
      $('shop-items').innerHTML = T.ITEM_KEYS.map(k => {
        const it = T.ITEMS[k], have = p.inv[k] + basket.filter(b => b === k).length;
        return '<div class="shop-row"><div class="name">' + esc(it.name) + '<small>' + esc(it.blurb) + '</small></div><b>' + have + '</b><button data-k="' + k + '"' + (left < it.cost ? ' disabled' : '') + '>' + money(it.cost) + '</button></div>';
      }).join('');
      for (const btn of $('shop-items').querySelectorAll('button')) btn.onclick = () => { basket.push(btn.dataset.k); Sound.play('coin'); paint(); };
      $('shop-undo').disabled = !basket.length;
    }
    $('shop-undo').onclick = () => { basket.pop(); paint(); };
    paint();
    d.onclose = () => onDone(basket);
    d.showModal();
  }

  function nextShop() {
    if (!shopQueue.length) { T.beginRound(s); save(); refresh(); nextTurn(); return; }
    const id = shopQueue[0];
    openShop(id, basket => { for (const k of basket) T.buy(s, id, k); shopQueue.shift(); save(); nextShop(); });
  }

  // ---------- rounds and the end ----------
  function roundOver() {
    const b = $('banner');
    const left = T.alive(s);
    const last = s.round >= s.rounds;
    bannerKind = 'roundover';
    b.hidden = false;
    b.innerHTML = '<b class="good">' + (left.length ? esc(left[0].name) + ' wins round ' + s.round : 'Round ' + s.round + ' is a draw') + '</b><br>' +
      '<button class="primary" id="b-next">' + (last ? 'See the result' : 'On to the shop') + '</button>';
    if (left.length) Sound.play(net ? (left[0].id === mySeat() ? 'win' : 'lose') : left[0].ai ? 'lose' : 'win');
    $('b-next').onclick = async () => {
      b.hidden = true; bannerKind = '';
      if (net) {
        try { await net.sess.nextRound(); } catch (e) { net.err = e.message; }
        refresh();
        return s.over || s.phase === 'over' ? gameOver() : ensureMyShop();
      }
      if (!T.nextRound(s)) { save(); return gameOver(); }
      shopQueue = s.players.filter(p => !p.ai).map(p => p.id);
      save(); nextShop();
    };
  }

  function gameOver() {
    refresh();
    const st = T.standings(s), b = $('banner');
    bannerKind = 'over';
    b.hidden = false;
    b.innerHTML = '<b class="good">' + esc(st[0].name) + ' wins the game</b><br>' +
      st.map((p, i) => '<div>' + (i + 1) + '. <span class="swatch" style="background:' + p.color + '"></span>' + esc(p.name) + ' ' + money(p.money) + '</div>').join('') +
      '<button class="primary" id="b-again">New game</button>';
    Sound.play(net ? (st[0].id === mySeat() ? 'win' : 'lose') : st[0].ai ? 'lose' : 'win');
    $('b-again').onclick = () => { b.hidden = true; bannerKind = ''; openNew(); };
  }

  // ---------- starting a game ----------
  function openNew() {
    const seats = $('seats');
    const opts = [['', 'None'], ['0', 'Human'], ['1', 'Easy'], ['2', 'Medium'], ['3', 'Hard']];
    const defs = ['0', '2', '', ''];
    seats.innerHTML = [0, 1, 2, 3].map(i =>
      '<div class="seat"><span class="swatch" style="background:' + T.COLORS[i] + '"></span><input maxlength="12" value="' + T.NAMES[i] + '" aria-label="Name ' + (i + 1) + '">' +
      '<select aria-label="Player ' + (i + 1) + '">' + opts.filter(o => i < 2 ? o[0] !== '' : true).map(o => '<option value="' + o[0] + '"' + (o[0] === defs[i] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>').join('');
    $('new-msg').textContent = '';
    $('d-new').showModal();
  }

  function seatsFromDialog() {
    const players = [];
    for (const row of $('seats').querySelectorAll('.seat')) {
      const v = row.querySelector('select').value;
      if (v === '') continue;
      players.push({ name: row.querySelector('input').value.trim() || undefined, ai: +v });
    }
    return players;
  }
  function optionsFromDialog() {
    const seedText = $('n-seed').value.trim();
    return { rounds: +$('n-rounds').value, width: T.SIZES[$('n-size').value], seed: /^\d{1,9}$/.test(seedText) ? +seedText : undefined };
  }

  function startFromDialog() {
    const players = seatsFromDialog();
    if (players.length < 2) players.push({ ai: 2 });
    startGame({ players, ...optionsFromDialog() });
  }

  function startGame(opts) {
    leaveOnline();
    gen++; busy = false; shown = null; fx = null; shopQueue = []; queue = [];
    $('banner').hidden = true; bannerKind = '';
    s = T.newGame(opts);
    save(); refresh(); nextTurn();
    Sound.play('start');
  }

  // ---------- with friends ----------
  async function startOnlineFromDialog() {
    const msg = $('new-msg'), go = $('b-play');
    const players = seatsFromDialog().map((p, i) => ({ name: p.name || T.NAMES[i], ai: p.ai }));
    if (players[0].ai !== 0) { msg.textContent = 'Seat 1 is you, so it has to be Human.'; return; }
    if (players.filter(p => p.ai === 0).length < 2) { msg.textContent = 'An online game needs at least two Humans: you, and a friend who joins from a link.'; return; }
    go.disabled = true; msg.textContent = 'Starting the game...';
    try {
      const sess = await O.Session.create({ server: serverUrl(), players, ...optionsFromDialog() });
      $('d-new').close();
      await enterOnline(sess);
      showInvite();
    } catch (e) { msg.textContent = e.message; }
    go.disabled = false;
  }

  function inviteLink(seat) {
    const server = new URLSearchParams(location.search).get('server');
    return location.origin + location.pathname + (server ? '?server=' + encodeURIComponent(server) : '') + '#' + net.sess.invite(seat);
  }

  function showInvite() {
    if (!net) return;
    const rows = net.sess.humanSeats().filter(i => i !== net.sess.seat).map(i => {
      const p = s.players[i];
      return '<div class="invite"><div><span class="swatch" style="background:' + p.color + '"></span><b>' + esc(p.name) + '</b></div><input readonly value="' + esc(inviteLink(i)) + '" aria-label="Link for ' + esc(p.name) + '">' +
        '<div class="row"><button data-copy="' + i + '">Copy link</button>' + (navigator.share ? '<button data-share="' + i + '">Share</button>' : '') + '</div></div>';
    }).join('');
    $('invite-list').innerHTML = rows;
    for (const b of $('invite-list').querySelectorAll('[data-copy]')) b.onclick = async () => { const link = inviteLink(+b.dataset.copy); try { await navigator.clipboard.writeText(link); b.textContent = 'Copied'; } catch (e) { prompt('Copy this link:', link); } };
    for (const b of $('invite-list').querySelectorAll('[data-share]')) b.onclick = () => navigator.share({ title: 'Tank Wars', text: 'Join my Tank Wars game', url: inviteLink(+b.dataset.share) }).catch(() => {});
    $('d-invite').showModal();
  }

  function leaveOnline() {
    if (!net) return;
    clearTimeout(net.timer); clearInterval(net.beatTimer);
    net = null; queue = [];
    store.del();
    $('b-invite').hidden = true;
    document.title = 'Tank Wars';
  }

  async function enterOnline(sess) {
    leaveOnline();
    gen++; busy = false; shown = null; fx = null; shopQueue = []; queue = [];
    $('banner').hidden = true; bannerKind = '';
    const my = net = { sess, ticking: false, err: null, waitKey: '', waitSince: Date.now(), wasMine: null, timer: 0, beatTimer: 0, shopOpen: false };
    s = sess.s;
    store.set({ room: sess.room, seat: sess.seat });
    $('b-invite').hidden = sess.humanSeats().length < 2;
    refresh();
    const poll = () => {
      if (net !== my) return;
      netTick();
      const w = my.sess.waiting();
      my.timer = setTimeout(poll, document.hidden ? 20000 : w && w.kind === 'move' && w.seat !== my.sess.seat && my.sess.isOnline(w.seat) ? 1200 : 2500);
    };
    my.timer = setTimeout(poll, 1500);
    my.beatTimer = setInterval(() => { if (net === my && !document.hidden) my.sess.beat(); }, 15000);
    my.sess.beat();
    await netTick(true);
  }

  // join from a link, or come back to the game this browser was in
  async function resumeOnline(inv) {
    const b = $('banner');
    bannerKind = 'connecting'; b.hidden = false; b.innerHTML = 'Connecting&hellip;';
    try {
      const sess = await O.Session.join({ server: serverUrl(), room: inv.room, seat: inv.seat });
      await enterOnline(sess);
      b.hidden = true; bannerKind = '';
    } catch (e) {
      bannerKind = 'error';
      b.innerHTML = '<div class="bad">' + esc(e.message) + '</div><button class="primary" id="b-retry">Try again</button> <button id="b-solo">Play on my own</button>';
      $('b-retry').onclick = () => resumeOnline(inv);
      $('b-solo').onclick = () => { store.del(); b.hidden = true; bannerKind = ''; startGame({ players: [{}, { ai: 2 }] }); };
    }
  }

  // Looks at the store, and shows whatever has happened. Skips a turn when a shot is still on its way across the screen.
  async function netTick(initial) {
    const my = net;
    if (!my || my.ticking || (!initial && (busy || queue.length))) return;
    my.ticking = true;
    const g = gen;
    try {
      const events = await my.sess.sync(initial ? { skipRoundOver: true } : undefined);
      if (net !== my || g !== gen) return;
      my.err = null;
      if (!initial) for (const e of events) if (e.type !== 'roundover') queue.push(e);
    } catch (e) { if (net === my) my.err = e.message; }
    if (net === my) my.ticking = false;
    pump();
  }

  // shows the next thing that happened, then the next, and when none is left looks at where the game stands
  function pump() {
    if (!net || busy) return;
    const e = queue.shift();
    if (!e) return settle();
    if (e.type === 'shot') return playShot(e.ev, e.before, e.after, e.auto ? 900 : 350, pump);
    if (e.type === 'round') { $('banner').hidden = true; bannerKind = ''; $('d-shop').open && $('d-shop').close(); net.shopOpen = false; refresh(); }
    pump();
  }

  function settle() {
    refresh();
    if (s.phase === 'roundover') { if (bannerKind !== 'roundover') roundOver(); }
    else if (s.phase === 'over') { if (bannerKind !== 'over') gameOver(); }
    else if (s.phase === 'shop') ensureMyShop();
    else if (s.phase === 'aim') {
      const mine = s.turn === mySeat();
      if (net.wasMine === false && mine) { Sound.play('yourmove'); if (document.hidden) document.title = '● Your turn - Tank Wars'; }
      net.wasMine = mine;
      if (!document.hidden) document.title = 'Tank Wars';
    }
  }

  function ensureMyShop() {
    if (!net || net.shopOpen || s.phase !== 'shop' || net.sess.shopped(mySeat())) return;
    net.shopOpen = true;
    const my = net;
    openShop(mySeat(), async basket => {
      my.shopOpen = false;
      if (net !== my) return;
      try { await my.sess.submitShop(basket); } catch (e) { my.err = e.message; my.shopOpen = false; }
      netTick();
    });
  }

  async function fireOnline() {
    const p = s.players[s.turn], my = net;
    busy = true; refresh();
    try {
      const r = await my.sess.submit(p.angle, p.power, p.weapon);
      busy = false;
      if (net !== my) return;
      if (r.ok) { queue.push(r.event); pump(); }
      else { toast('The computer already played that turn.'); netTick(); }
    } catch (e) { busy = false; my.err = e.message; toast(e.message); refresh(); }
  }

  // ---------- controls ----------
  $('f-new').addEventListener('submit', e => {
    if (!e.submitter || e.submitter.value !== 'go') return;
    if ($('n-online').checked) { e.preventDefault(); startOnlineFromDialog(); return; }
    startFromDialog();
  });
  $('b-new').onclick = () => { if (net && !confirm('Leave this online game? Your friends can carry on without you, and your link still works.')) return; openNew(); };
  $('b-help').onclick = () => $('d-help').showModal();
  $('b-invite').onclick = showInvite;

  function nudge(key, d) {
    if (!human()) return;
    const p = s.players[s.turn];
    const before = key === 'angle' ? p.angle : p.power;
    if (key === 'angle') p.angle = Math.max(0, Math.min(180, p.angle + d));
    else p.power = Math.max(1, Math.min(100, p.power + d));
    if ((key === 'angle' ? p.angle : p.power) !== before) Sound.play('adjust', key === 'angle' ? p.angle / 180 : p.power / 100);
    refresh();
  }
  for (const b of document.querySelectorAll('.rep')) {
    let timer = 0;
    const stop = () => { clearInterval(timer); timer = 0; save(); };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      nudge(b.dataset.k, +b.dataset.d);
      let n = 0;
      timer = setInterval(() => nudge(b.dataset.k, +b.dataset.d * (++n > 12 ? 3 : 1)), 90);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nudge(b.dataset.k, +b.dataset.d); } });
  }
  $('sel-weapon').onchange = e => { if (human()) { s.players[s.turn].weapon = e.target.value; save(); refresh(); } };
  $('b-fire').onclick = fireNow;

  window.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || !human() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const big = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') nudge('angle', big);        // left turns the barrel toward 180
    else if (e.key === 'ArrowRight') nudge('angle', -big);
    else if (e.key === 'ArrowUp') nudge('power', big);
    else if (e.key === 'ArrowDown') nudge('power', -big);
    else if (e.key === ' ' || e.key === 'Enter') { if (document.activeElement && document.activeElement.tagName === 'BUTTON') return; fireNow(); }
    else if (e.key === 'Tab') {
      const sel = $('sel-weapon'), i = (sel.selectedIndex + 1) % sel.options.length;
      sel.selectedIndex = i; s.players[s.turn].weapon = sel.value; refresh();
    } else return;
    e.preventDefault();
  });

  // drag on the picture to aim from the tank
  function aimFrom(e) {
    if (!human()) return;
    const r = canvas.getBoundingClientRect(), p = s.players[s.turn];
    const lx = (e.clientX - r.left) * W / r.width, ly = H - (e.clientY - r.top) * H / r.height;
    const dx = lx - p.x, dy = ly - (p.y + 5);
    let ang = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
    if (ang < 0) ang = dx >= 0 ? 0 : 180;
    const was = p.angle * 1000 + p.power;
    p.angle = Math.max(0, Math.min(180, ang));
    p.power = Math.max(1, Math.min(100, Math.round(Math.sqrt(dx * dx + dy * dy))));
    if (p.angle * 1000 + p.power !== was) Sound.play('adjust', p.angle / 180);
    refresh();
  }
  let dragging = false;
  canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); aimFrom(e); });
  canvas.addEventListener('pointermove', e => { if (dragging) aimFrom(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; if (s) save(); });
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (s) save(); return; }
    if (net) { document.title = 'Tank Wars'; net.sess.beat(); netTick(); }
  });
  window.addEventListener('pagehide', () => { if (s) save(); });

  // ---------- go ----------
  const invite = O.parseInvite(location.hash);
  const back = store.get();
  if (invite) {
    history.replaceState(null, '', location.pathname + location.search);
    resumeOnline(invite);
  } else if (back && typeof back.room === 'string' && Number.isInteger(back.seat)) {
    resumeOnline({ room: back.room, seat: back.seat });
  } else {
    s = load();
    if (s) {
      refresh();
      if (s.phase === 'roundover') roundOver();
      else if (s.phase === 'over') gameOver();
      else if (s.phase === 'shop') { shopQueue = s.players.filter(p => !p.ai).map(p => p.id); nextShop(); }
      else nextTurn();
    } else {
      startGame({ players: [{}, { ai: 2 }], rounds: 5 });
      $('d-help').showModal();
    }
  }
  window.__tw = { get s() { return s; }, get net() { return net; }, start: startGame };
})();
