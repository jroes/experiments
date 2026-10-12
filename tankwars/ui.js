(function () {
  'use strict';
  const T = window.TW;
  const KEY = 'tankwars-save-v1';
  const $ = id => document.getElementById(id);
  const canvas = $('view'), ctx = canvas.getContext('2d');
  const W = T.W, H = T.H;
  let s = null;
  let shown = null;   // what the picture draws while a shell is in the air: the ground and tanks as they were before the shot
  let fx = null;      // shells and explosions being animated
  let busy = false;   // a shot is flying, or the computer is thinking
  let gen = 0;        // bumps on a new game so late timers do nothing
  let shopQueue = [];
  Sound.load().mount($('b-sound'));

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
  function windText() {
    const w = s.wind;
    return w === 0 ? 'calm' : (w < 0 ? '◀ ' : '▶ ') + Math.abs(w);
  }

  function refresh() {
    if (!s) return;
    $('s-round').textContent = s.round + '/' + s.rounds;
    $('s-wind').textContent = windText();
    const p = s.players[s.turn];
    const mine = s.phase === 'aim' && !p.ai && !busy;
    $('who').innerHTML = s.phase === 'aim'
      ? '<span class="swatch" style="background:' + p.color + '"></span><b>' + esc(p.name) + '</b>' + (p.ai ? ' <span class="dim">(' + T.AI_LEVELS[p.ai].name + ' computer)</span>' : '') + (p.shield > 0 ? ' <span class="good">shield ' + p.shield + '</span>' : '')
      : '<span class="dim">' + (s.over ? 'Game over' : 'Round over') + '</span>';
    $('v-angle').textContent = p.angle;
    $('v-power').textContent = p.power;
    const sel = $('sel-weapon');
    const opts = ['shell'].concat(T.ITEM_KEYS.filter(k => k !== 'shield' && p.inv[k] > 0));
    if (!opts.includes(p.weapon)) p.weapon = 'shell';
    sel.innerHTML = opts.map(k => '<option value="' + k + '">' + esc(T.WEAPONS[k].name) + (k === 'shell' ? '' : ' x' + p.inv[k]) + '</option>').join('');
    sel.value = p.weapon;
    for (const el of $('ctl').querySelectorAll('button, select')) el.disabled = !mine;
    $('score').innerHTML = s.players.map(q =>
      '<span class="' + (q.id === s.turn && s.phase === 'aim' ? 'me' : '') + '"><span class="swatch" style="background:' + q.color + '"></span>' + esc(q.name) +
      '<span class="hp"><i style="width:' + q.hp + '%"></i></span>' + money(q.money) + (q.wins ? ' &middot; ' + q.wins + ' win' + (q.wins > 1 ? 's' : '') : '') + '</span>').join('');
    draw();
  }

  // ---------- turns ----------
  function snapshot() { return { heights: s.heights.slice(), players: s.players.map(p => ({ ...p })) }; }

  function afterShot() {
    busy = false; shown = null; fx = null;
    save();
    refresh();
    if (s.phase === 'roundover') return roundOver();
    nextTurn();
  }

  function nextTurn() {
    if (s.phase !== 'aim') return;
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
    if (busy && s.players[s.turn].ai === 0) return;
    const prev = snapshot();
    const ev = T.fire(s);
    if (!ev) return;
    busy = true; shown = prev;
    Sound.play('shoot');
    fx = { shots: ev.shots.map(sh => ({ path: sh.path, hit: sh.hit, blast: sh.blast, i: 0, done: false })), blasts: [] };
    const g = gen;
    function frame() {
      if (g !== gen) return;
      let flying = false;
      for (const sh of fx.shots) {
        if (sh.done) continue;
        sh.i += 3;
        if (sh.i >= sh.path.length - 1) { sh.i = sh.path.length - 1; sh.done = true; if (sh.hit.kind !== 'out') startBlast(ev, sh); } else flying = true;
      }
      fx.blasts.forEach(b => b.t++);
      draw();
      if (flying || fx.blasts.some(b => b.t < 30) || fx.shots.some(sh => !sh.done)) requestAnimationFrame(frame);
      else afterShot();
    }
    function startBlast(ev, sh) {
      const b = sh.blast;
      if (!b) return;
      fx.blasts.push({ ...b, t: 0 });
      shown = null; // from here the picture shows the ground after the hit
      Sound.play(b.kind === 'dirt' ? 'thud' : 'boom');
      if (ev.killed.length && fx.blasts.length === 1) setTimeout(() => Sound.play('bad'), 200);
    }
    requestAnimationFrame(frame);
  }

  // ---------- rounds, shop, end ----------
  function roundOver() {
    const b = $('banner');
    const left = T.alive(s);
    const last = s.round >= s.rounds;
    b.hidden = false;
    b.innerHTML = '<b class="good">' + (left.length ? esc(left[0].name) + ' wins round ' + s.round : 'Round ' + s.round + ' is a draw') + '</b><br>' +
      '<button class="primary" id="b-next">' + (last ? 'See the result' : 'On to the shop') + '</button>';
    if (left.length) Sound.play(left[0].ai ? 'lose' : 'win');
    $('b-next').onclick = () => {
      b.hidden = true;
      if (!T.nextRound(s)) { save(); return gameOver(); }
      shopQueue = s.players.filter(p => !p.ai).map(p => p.id);
      save(); nextShop();
    };
  }

  function gameOver() {
    refresh();
    const st = T.standings(s), b = $('banner');
    b.hidden = false;
    b.innerHTML = '<b class="good">' + esc(st[0].name) + ' wins the game</b><br>' +
      st.map((p, i) => '<div>' + (i + 1) + '. <span class="swatch" style="background:' + p.color + '"></span>' + esc(p.name) + ' ' + money(p.money) + '</div>').join('') +
      '<button class="primary" id="b-again">New game</button>';
    Sound.play(st[0].ai ? 'lose' : 'win');
    $('b-again').onclick = () => { b.hidden = true; openNew(); };
  }

  function nextShop() {
    if (!shopQueue.length) { T.beginRound(s); save(); refresh(); nextTurn(); return; }
    const p = s.players[shopQueue[0]];
    const d = $('d-shop');
    function paint() {
      $('shop-title').innerHTML = '<span class="swatch" style="background:' + p.color + '"></span>' + esc(p.name) + ' &middot; ' + money(p.money);
      $('shop-items').innerHTML = T.ITEM_KEYS.map(k => {
        const it = T.ITEMS[k];
        return '<div class="shop-row"><div class="name">' + esc(it.name) + '<small>' + esc(it.blurb) + '</small></div><b>' + p.inv[k] + '</b><button data-k="' + k + '"' + (p.money < it.cost ? ' disabled' : '') + '>' + money(it.cost) + '</button></div>';
      }).join('');
      for (const btn of $('shop-items').querySelectorAll('button')) btn.onclick = () => { if (T.buy(s, p.id, btn.dataset.k)) { Sound.play('coin'); save(); paint(); } };
    }
    paint();
    d.onclose = () => { shopQueue.shift(); save(); nextShop(); };
    d.showModal();
  }

  // ---------- starting a game ----------
  function openNew() {
    const seats = $('seats');
    const opts = [['', 'None'], ['0', 'Human'], ['1', 'Easy'], ['2', 'Medium'], ['3', 'Hard']];
    const defs = ['0', '2', '', ''];
    seats.innerHTML = [0, 1, 2, 3].map(i =>
      '<div class="seat"><span class="swatch" style="background:' + T.COLORS[i] + '"></span><input maxlength="12" value="' + T.NAMES[i] + '" aria-label="Name ' + (i + 1) + '">' +
      '<select aria-label="Player ' + (i + 1) + '">' + opts.filter(o => i < 2 ? o[0] !== '' : true).map(o => '<option value="' + o[0] + '"' + (o[0] === defs[i] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>').join('');
    $('d-new').showModal();
  }

  function startFromDialog() {
    const players = [];
    for (const row of $('seats').querySelectorAll('.seat')) {
      const v = row.querySelector('select').value;
      if (v === '') continue;
      players.push({ name: row.querySelector('input').value.trim() || undefined, ai: +v });
    }
    if (players.length < 2) players.push({ ai: 2 });
    const seedText = $('n-seed').value.trim();
    startGame({ players, rounds: +$('n-rounds').value, seed: /^\d{1,9}$/.test(seedText) ? +seedText : undefined });
  }

  function startGame(opts) {
    gen++; busy = false; shown = null; fx = null; shopQueue = [];
    $('banner').hidden = true;
    s = T.newGame(opts);
    save(); refresh(); nextTurn();
    Sound.play('start');
  }

  $('f-new').addEventListener('submit', e => { if (e.submitter && e.submitter.value === 'go') startFromDialog(); });
  $('b-new').onclick = openNew;
  $('b-help').onclick = () => $('d-help').showModal();

  // ---------- controls ----------
  function human() { return s && s.phase === 'aim' && !busy && !s.players[s.turn].ai; }
  function nudge(key, d) {
    if (!human()) return;
    const p = s.players[s.turn];
    if (key === 'angle') p.angle = Math.max(0, Math.min(180, p.angle + d));
    else p.power = Math.max(1, Math.min(100, p.power + d));
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
  $('b-fire').onclick = () => { if (human()) doFire(); };

  window.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || !human() || e.metaKey || e.ctrlKey || e.altKey) return;
    const big = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') nudge('angle', big);        // left turns the barrel toward 180
    else if (e.key === 'ArrowRight') nudge('angle', -big);
    else if (e.key === 'ArrowUp') nudge('power', big);
    else if (e.key === 'ArrowDown') nudge('power', -big);
    else if (e.key === ' ' || e.key === 'Enter') { if (document.activeElement && document.activeElement.tagName === 'BUTTON') return; doFire(); }
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
    p.angle = Math.max(0, Math.min(180, ang));
    p.power = Math.max(1, Math.min(100, Math.round(Math.sqrt(dx * dx + dy * dy))));
    refresh();
  }
  let dragging = false;
  canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); aimFrom(e); });
  canvas.addEventListener('pointermove', e => { if (dragging) aimFrom(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; if (s) save(); });
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  document.addEventListener('visibilitychange', () => { if (document.hidden && s) save(); });
  window.addEventListener('pagehide', () => { if (s) save(); });

  // ---------- go ----------
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
  window.__tw = { get s() { return s; } };
})();
