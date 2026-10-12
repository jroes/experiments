/*
 * The page for an adventure game: draws the 160 x 100 picture, takes typed commands, arrow keys, clicks and taps,
 * shows the messages, the things you carry, and keeps the game saved. Rules live in adventure.js, art in adventure-art.js.
 */
(function (root) {
  'use strict';
  const Adv = root.Adventure, Art = root.AdvArt;
  const SW = Adv.SW, SH = Adv.SH;
  const $ = id => root.document.getElementById(id);
  const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function start(def) {
    const KEY = 'adv-' + def.id + '-save-v1', SLOT = 'adv-' + def.id + '-slot-v1', SEEN = 'adv-' + def.id + '-seen-v1';
    const store = {
      get(k) { try { return JSON.parse(root.localStorage.getItem(k)); } catch (e) { return null; } },
      set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
      del(k) { try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    };
    Sound.load().mount($('b-sound'), { music: def.music || 'storybook' });

    const canvas = $('pic'), ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const pix = new Art.Pix(ctx);
    const touch = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;

    let g = Adv.create(def, store.get(KEY) || undefined);
    let mode = null;        // a verb picked from the buttons, waiting for something to act on
    let first = null;       // the first thing of a two-thing command ("use rope", then "on well")
    let lastStep = -1, moving = false, last = 0, saveAt = 0;
    const keys = new Set();

    // ---------- text ----------
    const msgs = $('msgs');
    function addMsg(text) {
      const p = root.document.createElement('p');
      if (text.startsWith('> ')) { p.className = 'echo'; p.textContent = text; } else p.textContent = text;
      msgs.appendChild(p);
      while (msgs.children.length > 80) msgs.removeChild(msgs.firstChild);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function flush() {
      for (const t of g.drainText()) addMsg(t);
      for (const e of g.drain()) {
        if (e === 'score') { Sound.play('ding'); const s = $('s-score'); s.classList.add('flash'); setTimeout(() => s.classList.remove('flash'), 700); }
        else if (e === 'die') Sound.play('die');
        else if (e === 'win') Sound.play('win');
        else if (e === 'take') Sound.play('coin');
        else if (e === 'cmd:save') saveSlot();
        else if (e === 'cmd:restore') loadSlot();
        else if (e === 'cmd:restart') confirmRestart();
      }
      $('s-score').textContent = g.state.points + ' of ' + def.maxScore;
      $('s-room').textContent = g.room().name;
      paintInv();
      if (g.state.dead && !$('d-dead').open && !$('d-intro').open) showDead();
      if (g.state.won && !$('d-win').open) showWin();
    }

    function persist() { store.set(KEY, g.save()); }
    function saveSlot() { store.set(SLOT, g.save()); persist(); addMsg('Game saved.'); }
    function loadSlot() {
      const sv = store.get(SLOT);
      if (!sv || !Adv.cleanState(def, sv.state)) return addMsg('There is no saved game to restore.');
      g = Adv.create(def, sv); first = null; mode = null; persist(); addMsg('Game restored.'); paintVerbs(); flush();
    }
    function confirmRestart() { if (root.confirm('Start over from the beginning?')) restart(); }
    function restart() { g.restart(); store.del(KEY); first = null; mode = null; msgs.innerHTML = ''; persist(); flush(); paintVerbs(); }

    // ---------- the picture ----------
    function draw(t) {
      const r = g.room(), s = g.state;
      r.back(pix, g, t);
      const list = [];
      for (const o of g.objects()) if (o.draw) list.push({ base: o.base !== undefined ? o.base : (o.rect ? o.rect[1] + o.rect[3] : 0), f: () => o.draw(pix, g, t) });
      list.push({ base: s.y, f: () => (def.hero || Art.hero)(pix, s.x, s.y, s.dir, moving, g.step) });
      list.sort((a, b) => a.base - b.base);
      for (const l of list) l.f();
      if (r.front) r.front(pix, g, t);
    }

    function loop(now) {
      const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
      const modal = root.document.querySelector('dialog[open]');
      if (!modal && !g.state.dead && !g.state.won) {
        let dx = 0, dy = 0;
        if (keys.has('ArrowLeft')) dx -= 1; if (keys.has('ArrowRight')) dx += 1; if (keys.has('ArrowUp')) dy -= 1; if (keys.has('ArrowDown')) dy += 1;
        if (dx || dy) g.nudge(dx, dy, dt); else g.update(dt);
      }
      moving = g.step !== lastStep; lastStep = g.step;
      draw(now / 1000);
      flush();
      if (now - saveAt > 20000) { saveAt = now; persist(); }
      root.requestAnimationFrame(loop);
    }

    // ---------- doing things ----------
    function run(text) { g.command(text); persist(); flush(); }
    function noun(o) { return o.name; }

    // a tap on something (an object in the room, or something carried)
    function act(name, isItem) {
      if (mode && first) { run(first.verb + ' ' + first.name + ' ' + first.prep + ' ' + name); first = null; mode = null; paintVerbs(); return; }
      if (mode && (mode === 'use' || mode === 'give') && isItem) { first = { verb: mode, name, prep: mode === 'give' ? 'to' : 'on' }; paintVerbs(); return; }
      if (mode) { const v = mode; mode = null; paintVerbs(); run(v + ' ' + name); return; }
      run('look at ' + name);
    }

    canvas.addEventListener('pointerdown', e => {
      if (g.state.dead || g.state.won) return;
      const rc = canvas.getBoundingClientRect();
      const x = (e.clientX - rc.left) * SW / rc.width, y = (e.clientY - rc.top) * SH / rc.height;
      const hit = [...g.objects()].reverse().find(o => o.rect && x >= o.rect[0] && x < o.rect[0] + o.rect[2] && y >= o.rect[1] && y < o.rect[1] + o.rect[3]);
      if (hit && (mode || first)) return act(noun(hit), false);
      if (hit) { run('look at ' + noun(hit)); return; }
      mode = null; first = null; paintVerbs();
      g.click(x, y);
    });

    const VERBS = [['look', 'Look'], ['take', 'Take'], ['open', 'Open'], ['talk', 'Talk'], ['push', 'Push'], ['pull', 'Pull'], ['climb', 'Climb'], ['use', 'Use'], ['give', 'Give']];
    function paintVerbs() {
      $('verbs').innerHTML = VERBS.map(([v, l]) => '<button data-v="' + v + '" class="' + (mode === v ? 'primary' : '') + '">' + l + '</button>').join('');
      for (const b of $('verbs').querySelectorAll('button')) b.onclick = () => { mode = mode === b.dataset.v ? null : b.dataset.v; first = null; paintVerbs(); };
      $('hint').textContent = first ? first.verb + ' ' + first.name + ' ' + first.prep + ' ...' : mode ? mode + ' ...' : '';
    }
    let invKey = '';
    function paintInv() {
      const key = g.state.inv.join(',');
      if (key === invKey) return;
      invKey = key;
      const inv = $('inv');
      inv.innerHTML = g.state.inv.length ? g.state.inv.map(id => '<button data-i="' + esc(id) + '">' + esc(def.items[id].name) + '</button>').join('') : '<span class="dim">You carry nothing.</span>';
      for (const b of inv.querySelectorAll('button')) b.onclick = () => act(def.items[b.dataset.i].name, true);
    }

    $('f-cmd').addEventListener('submit', e => {
      e.preventDefault();
      const v = $('cmd').value.trim();
      $('cmd').value = '';
      if (v) { mode = null; first = null; paintVerbs(); run(v); }
    });

    root.addEventListener('keydown', e => {
      if (root.document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = e.target && e.target.id === 'cmd' && e.target.value !== '';
      if (e.key.startsWith('Arrow')) { if (typing) return; keys.add(e.key); e.preventDefault(); return; }
      if (e.target && e.target.tagName === 'BUTTON') return;
      if (e.key.length === 1 && root.document.activeElement !== $('cmd')) $('cmd').focus();
    });
    root.addEventListener('keyup', e => keys.delete(e.key));
    root.addEventListener('blur', () => keys.clear());

    // ---------- dialogs ----------
    function showDead() {
      $('dead-text').textContent = g.state.dead;
      $('d-dead').showModal();
    }
    function showWin() { $('win-text').textContent = g.state.won; $('win-score').textContent = g.state.points + ' of ' + def.maxScore; $('d-win').showModal(); }
    $('b-restore').onclick = () => { $('d-dead').close(); g.restore(); persist(); addMsg('You try again from where you were.'); flush(); };
    $('b-restart').onclick = () => { $('d-dead').close(); restart(); };
    $('b-again').onclick = () => { $('d-win').close(); restart(); };
    $('b-help').onclick = () => $('d-help').showModal();
    $('b-save').onclick = $('b-save2').onclick = saveSlot;
    $('b-load').onclick = $('b-load2').onclick = loadSlot;
    $('b-new').onclick = confirmRestart;
    $('help-text').textContent = def.help;
    $('intro-text').textContent = def.intro;
    $('b-go').onclick = () => { store.set(SEEN, true); };
    for (const d of root.document.querySelectorAll('dialog')) d.addEventListener('close', () => { if (!touch && !g.state.dead) $('cmd').focus(); });
    root.document.addEventListener('visibilitychange', () => { if (root.document.hidden) persist(); });
    root.addEventListener('pagehide', persist);

    // ---------- go ----------
    paintVerbs();
    if (!store.get(KEY) && !store.get(SEEN)) $('d-intro').showModal();
    flush();
    root.requestAnimationFrame(loop);
    root.__adv = { get g() { return g; }, run };
  }

  root.AdventureUI = { start };
})(window);
