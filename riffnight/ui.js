/*
 * Riff Night page: menus, the band lobby, the stage (note highway, singing, tab), input, calibration and the tuner.
 * Rules live in game.js, sound in audio.js, the band connection in band.js.
 */
(function () {
  'use strict';
  const RN = window.RN, A = window.RNAudio, $ = id => document.getElementById(id);
  const DEMO = /[?&]demo\b/.test(location.search); // plays itself: for screenshots and checks

  // ---------- saved settings ----------
  let save = RN.cleanSaved((() => { try { return localStorage.getItem(RN.SAVE_KEY); } catch (e) { return null; } })());
  const persist = () => { try { localStorage.setItem(RN.SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode */ } };

  // ---------- audio ----------
  let ctx = null, master = null, clock = null;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC({ latencyHint: 'interactive' });
      master = ctx.createGain(); master.gain.value = save.volume; master.connect(ctx.destination);
      clock = new A.Clock(ctx);
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => { /* needs a tap */ });
    return ctx;
  }
  // iPhones: play even with the ring switch on silent, and keep the speaker when the mic is on
  const session = type => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) { /* not supported */ } };

  // one open mic, kept between songs so the browser does not ask again
  let micHeld = null;
  async function getMic(kind) {
    if (micHeld && micHeld.kind === kind) return micHeld;
    dropMic();
    audio();
    session('play-and-record');
    micHeld = await A.Mic.open(ctx, kind);
    if (ctx.state !== 'running') ctx.resume().catch(() => { /* ignore */ });
    return micHeld;
  }
  function dropMic() { if (micHeld) { micHeld.close(); micHeld = null; session('playback'); } }
  const micKind = pick => pick.part === 'vocals' ? 'vocals' : pick.part;

  // ---------- arrangements, made once per song ----------
  const ARR = new Map();
  const arrOf = id => { if (!ARR.has(id)) ARR.set(id, RN.arrange(RN.songById(id))); return ARR.get(id); };
  const TIERS = new Map();
  const tiersOf = id => { if (!TIERS.has(id)) TIERS.set(id, RN.PARTS.map(p => RN.tier(arrOf(id), p))); return TIERS.get(id); };

  // ---------- screens ----------
  const S = { band: null, pick: save.pick, song: save.song, ready: false };
  let G = null; // the song being played
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    S.screen = id;
  }
  function message(title, text) {
    $('msg-title').textContent = title; $('msg-text').textContent = text;
    if (!$('d-msg').open) $('d-msg').showModal();
  }
  const closeDialogs = () => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const dots = n => '●'.repeat(n) + '○'.repeat(5 - n);
  const starText = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  const INPUT_NAME = { tap: 'Tap the screen', real: 'Real one, through the mic', mic: 'Sing into the mic' };
  const DIFF_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
  const myName = () => save.name || 'You';

  // ---------- home ----------
  $('name').value = save.name;
  $('name').addEventListener('change', () => { save.name = $('name').value.trim() ? RN.cleanName($('name').value) : ''; $('name').value = save.name; persist(); });
  function needName() {
    if (save.name) return true;
    const v = $('name').value.trim();
    if (v) { save.name = RN.cleanName(v); persist(); return true; }
    $('home-msg').textContent = 'Pick a name first, so your band knows who you are.';
    $('name').focus();
    return false;
  }
  $('b-solo').onclick = () => { audio(); session('playback'); S.band = null; openSetup(); };
  $('b-lead').onclick = async () => {
    if (!needName()) return;
    audio(); session('playback');
    $('home-msg').textContent = 'Starting a band...';
    try {
      const b = await window.RNBand.lead(save.name, S.pick);
      $('home-msg').textContent = '';
      S.band = b; wireBand(b); b.setSong(S.song); openSetup();
    } catch (e) { $('home-msg').textContent = e.message || 'Could not start a band.'; }
  };
  $('f-join').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('join-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { $('home-msg').textContent = 'A band code is six letters and numbers.'; return; }
    if (!needName()) return;
    audio(); session('playback');
    $('home-msg').textContent = 'Joining...';
    try {
      const b = await window.RNBand.join(code, save.name, S.pick);
      $('home-msg').textContent = '';
      S.band = b; S.ready = false; wireBand(b); openSetup();
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    } catch (err) { $('home-msg').textContent = err.message || 'Could not join.'; }
  });
  $('b-help').onclick = () => $('d-help').showModal();

  // a link like riffnight/#K7Q2MX fills in the code
  const hashCode = (location.hash || '').slice(1).toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(hashCode)) {
    $('join-code').value = hashCode;
    $('home-msg').textContent = save.name ? 'Tap Join a band to join ' + hashCode + '.' : 'Pick a name, then tap Join a band.';
    $('home-msg').className = 'good';
  }

  // ---------- setup and the band lobby ----------
  function openSetup() { renderSetup(); show('setup'); }
  function renderSetup() {
    const b = S.band, leader = !b || b.leader;
    if (b) S.song = b.song;
    $('setup-title').textContent = !b ? 'Pick a song' : b.leader ? 'Your band' : 'In a band';
    $('band-box').hidden = !b;
    $('same-row').hidden = !b;
    if (b) {
      $('band-code').textContent = b.code;
      $('same').checked = b.same; $('same').disabled = !b.leader;
      const ul = $('members'); ul.textContent = '';
      for (const m of b.members.values()) {
        const li = el('li');
        li.append(el('span', 'n', m.name + (m.id === b.id ? ' (you)' : '') + (m.id === 0 ? ' ★' : '')));
        li.append(el('span', 'p', RN.PART_NAME[m.pick.part] + (m.pick.input === 'real' ? ' (real)' : '') + ', ' + DIFF_NAME[m.pick.diff]));
        li.append(el('span', 'r ' + (m.waiting ? 'dim' : m.ready ? 'good' : 'dim'), m.waiting ? 'next song' : m.ready ? 'ready' : 'picking'));
        ul.append(li);
      }
      $('band-msg').textContent = b.leader
        ? (b.members.size < 2 ? 'Send the code or link to your friends. You can start any time.' : 'Pick the song, then start when everyone is ready.')
        : b.state === 'playing' ? 'A song is on. You will be in the next one.' : 'The band leader picks the song and starts it.';
    }
    // songs
    const box = $('songs'); box.textContent = '';
    for (const song of RN.SONGS) {
      const a = arrOf(song.id), tiers = tiersOf(song.id);
      const card = el('button', 'song' + (song.id === S.song ? ' on' : ''));
      card.type = 'button';
      card.disabled = !leader && song.id !== S.song;
      card.append(el('span', 't', song.title));
      const mins = Math.floor(a.beats * a.spb / 60), secs = Math.round(a.beats * a.spb % 60);
      card.append(el('span', 'm', mins + ':' + String(secs).padStart(2, '0') + ' · ' + song.bpm + ' bpm'));
      card.append(el('span', 'b', song.blurb));
      const tr = el('span', 'tiers');
      RN.PARTS.forEach((p, i) => { const s = el('span', '', RN.PART_NAME[p] + ' '); s.append(el('b', '', dots(tiers[i]))); tr.append(s); });
      card.append(tr);
      const best = save.best[RN.bestKey(song.id, S.pick)];
      if (best) card.append(el('span', 'best', 'Best ' + best.score.toLocaleString() + ' ' + starText(best.stars)));
      card.onclick = () => {
        if (!leader) return;
        S.song = song.id; save.song = song.id; persist();
        if (b) b.setSong(song.id);
        renderSetup();
      };
      box.append(card);
    }
    // part, input, level
    const seg = (id, items, cur, fn) => {
      const e = $(id); e.textContent = '';
      for (const [v, label, sub] of items) {
        const btn = el('button', v === cur ? 'on' : '', label);
        btn.type = 'button';
        if (sub) btn.append(el('small', '', sub));
        btn.onclick = () => fn(v);
        e.append(btn);
      }
    };
    seg('parts', RN.PARTS.map(p => [p, RN.PART_NAME[p]]), S.pick.part, v => setPick({ part: v, input: RN.INPUTS[v][0] }));
    seg('inputs', RN.INPUTS[S.pick.part].map(i => [i, i === 'real' ? 'Real ' + S.pick.part : i === 'mic' ? 'Microphone' : 'Tap', INPUT_NAME[i]]), S.pick.input, v => setPick({ input: v }));
    seg('diffs', RN.DIFFS.map(d => [d, DIFF_NAME[d]]), S.pick.diff, v => setPick({ diff: v }));
    $('nofail').checked = save.noFail;
    const go = $('b-go');
    if (!b) { go.textContent = 'Play'; go.disabled = false; }
    else if (b.leader) { go.textContent = b.state === 'playing' ? 'Song is on...' : 'Start the song'; go.disabled = b.state === 'playing'; }
    else {
      const me = b.members.get(b.id);
      S.ready = !!(me && me.ready);
      go.textContent = b.state === 'playing' ? 'Waiting for the next song' : S.ready ? 'Ready! (tap to change)' : 'I\'m ready';
      go.disabled = b.state === 'playing';
    }
  }
  S.waiting = () => { const b = S.band; const m = b && b.members.get(b.id); return !!(m && m.waiting); };
  function setPick(patch) {
    S.pick = RN.cleanPick({ ...S.pick, ...patch });
    save.pick = S.pick; persist();
    if (S.band) { S.band.setPick(S.pick); S.ready = false; }
    if (S.pick.input === 'tap') dropMic();
    renderSetup();
  }
  $('nofail').onchange = () => { save.noFail = $('nofail').checked; persist(); };
  $('same').onchange = () => { if (S.band && S.band.leader) S.band.setSame($('same').checked); };
  $('b-back').onclick = () => {
    if (S.band) {
      if (!confirm(S.band.leader ? 'End the band? Everyone gets dropped.' : 'Leave the band?')) return;
      S.band.leave(); S.band = null;
    }
    dropMic();
    show('home');
  };
  $('b-copy').onclick = async () => {
    const url = inviteUrl();
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Riff Night', text: 'Join my band', url });
      else { await navigator.clipboard.writeText(url); $('b-copy').textContent = 'Copied'; setTimeout(() => { $('b-copy').textContent = 'Copy link'; }, 1500); }
    } catch (e) { prompt('Copy this link', url); }
  };
  $('b-qr').onclick = () => {
    const q = $('qr');
    q.hidden = !q.hidden;
    if (!q.hidden) {
      try { const c = qrcode(0, 'M'); c.addData(inviteUrl()); c.make(); q.innerHTML = c.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { q.textContent = inviteUrl(); }
    }
  };
  const inviteUrl = () => location.origin + location.pathname + location.search + '#' + (S.band ? S.band.code : '');

  $('b-go').onclick = async () => {
    audio();
    const b = S.band;
    // ask for the mic now, while there is a tap, so the song does not wait on the question
    if (S.pick.input !== 'tap') {
      try { await getMic(micKind(S.pick)); } catch (e) { message('No mic', micError(e)); return; }
    }
    if (!b) { startSong({ song: S.song, at: null, same: false }); return; }
    if (b.leader) b.start();
    else { S.ready = !S.ready; b.setReady(S.ready); }
  };
  const micError = e => (e && e.name === 'NotAllowedError') ? 'The browser was not allowed to use the mic. Allow it in the site settings, or pick Tap.' : 'Could not open the mic: ' + ((e && e.message) || 'unknown error') + '.';

  function wireBand(b) {
    b.on('roster', () => {
      if (S.screen === 'setup') renderSetup();
      if (S.screen === 'results') renderResults();
    });
    b.on('go', g => { closeDialogs(); startSong({ song: g.song, at: g.at, same: g.same }); });
    b.on('band', () => { if (S.screen === 'results') renderResults(); });
    b.on('revive', by => {
      if (!G || G.ended || !G.play.failed) return;
      if (G.play.revive(G.t)) {
        const m = b.members.get(by);
        popup((m ? m.name : 'A bandmate') + ' brought you back!', '#8fe9ff');
      }
    });
    b.on('stop', () => {
      if (G && !G.ended) { endSong(); openSetup(); message('Song stopped', 'The band leader stopped the song.'); }
      else if (S.screen === 'setup') renderSetup();
    });
    b.on('out', () => { if (G && !G.ended) finish('out'); });
    b.on('closed', why => {
      if (S.band !== b) return;
      S.band = null;
      if (G && !G.ended) { G.band = null; G.lost = why; return; }
      dropMic();
      show('home');
      message('Band', window.RNBand.closedText(why));
    });
  }

  // ---------- playing a song ----------
  let wake = null;
  async function startSong(o) {
    endSong();
    const c = audio();
    if (!c) { message('No sound', 'This browser cannot play sound.'); return; }
    S.song = o.song;
    const arr = arrOf(o.song), pick = S.pick, ch = RN.chart(arr, pick.part, pick.diff, pick.input);
    let mic = null;
    if (pick.input !== 'tap') {
      try { mic = await getMic(micKind(pick)); } catch (e) { message('No mic', micError(e)); openSetup(); return; }
    } else session('playback');
    const mixer = new A.Mixer(c, master), player = new A.SongPlayer(mixer, arr);
    clock.reset(); clock.sample();
    const start = o.at === null ? c.currentTime + 0.5 + 4 * arr.spb : clock.at(o.at);
    G = {
      arr, ch, pick, song: o.song, play: RN.makePlay(ch, { noFail: save.noFail }), mixer, player, start, mic, band: S.band, same: !!o.same,
      t: -10, ended: false, paused: false, down: [0, 0, 0, 0, 0, 0], touches: new Map(), flames: [], misses: [], pops: [], trail: [], demoHold: [],
      look: ({ easy: 2.0, medium: 1.75, hard: 1.5, expert: 1.3 })[pick.diff] / save.speed, section: -1, outAt: null,
    };
    if (mic) mic.onsets.last = -Infinity;
    player.begin(start);
    G.pump = setInterval(() => { if (G && !G.paused) G.player.pump(ctx.currentTime); }, 80);
    show('stage');
    resize();
    $('b-boost').hidden = true;
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; }
    requestAnimationFrame(loop);
  }

  // stop the sound and the clock, keep nothing running
  function endSong() {
    if (!G) return;
    G.ended = true;
    clearInterval(G.pump);
    G.mixer.close();
    if (wake) { wake.release().catch(() => { /* gone */ }); wake = null; }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });
  }

  function songT(perfMs) { return clock.at(perfMs) - G.start; }
  const evTime = e => (e.timeStamp > 0 && Math.abs(e.timeStamp - performance.now()) < 1000) ? e.timeStamp : performance.now();

  function loop() {
    if (!G || G.ended) return;
    requestAnimationFrame(loop);
    if (G.paused) { draw(G.t); return; }
    clock.sample();
    G.player.pump(ctx.currentTime);
    const t = clock.now() - G.start;
    G.t = t;
    const play = G.play;
    if (G.mic) {
      const ft = t - save.micOffset - G.mic.lag;
      const fr = DEMO ? demoFrame(ft) : G.mic.read(ft);
      play.frame(fr);
      if (G.pick.part === 'vocals') {
        G.trail.push({ t: ft, m: play.pitch ? play.pitch.m : null });
        while (G.trail.length && G.trail[0].t < ft - 2) G.trail.shift();
      }
      play.update(ft);
    } else {
      if (DEMO) demoTaps(t);
      play.update(t - save.tapOffset);
    }
    effects(t);
    gains();
    if (G.band) G.band.status(status());
    const can = play.canBoost();
    if ($('b-boost').hidden === can) $('b-boost').hidden = !can;
    draw(t);
    if (t > G.ch.len + 1.2) finish('end');
    else if (play.failed && (!G.band || G.band.members.size < 2)) {
      if (G.outAt === null) G.outAt = t;
      if (t - G.outAt > 1.6) finish('out');
    }
  }
  const status = () => ({ ...G.play.status(), done: G.ended });

  // what just happened: flashes, popups and the missed-note clunk
  function effects(t) {
    for (const f of G.play.fx) {
      if (f.k === 'hit' && f.lane !== undefined) G.flames[f.lane] = t;
      else if (f.k === 'miss' && f.lane !== undefined) G.misses[f.lane] = t;
      else if (f.k === 'stray') {
        G.misses[f.lane] = t;
        if (G.pick.part === 'drums') G.mixer.drum(['kick', 'snare', 'tom2', 'hat'][f.lane] || 'snare', ctx.currentTime + 0.003);
        else G.mixer.clunk();
      } else if (f.k === 'energy') popup('Energy!', '#8fe9ff');
      else if (f.k === 'boost') popup('BOOST!', '#3fd7ff');
      else if (f.k === 'phrase') popup(f.rating + '!', { Awesome: '#5ef09a', Strong: '#b6f05e', Good: '#ffd23f', OK: '#ff9a3c', Messy: '#ff6b6b' }[f.rating]);
      else if (f.k === 'fail') popup('OUT!', '#ff6b6b');
      else if (f.k === 'revive') { G.outAt = null; }
    }
    G.play.fx.length = 0;
    // a new section's name
    const secs = G.ch.sections;
    let si = -1;
    for (let i = 0; i < secs.length; i++) if (secs[i].t <= t) si = i;
    if (si !== G.section) { G.section = si; if (si >= 0) G.banner = { text: secs[si].name, t }; }
  }
  function popup(text, color) { if (G) G.pops.push({ text, color: color || '#fff', t: G.t }); }

  function members() {
    if (!G.band) return [{ id: 0, name: myName(), part: G.pick.part, input: G.pick.input, diff: G.pick.diff, st: G.play.status() }];
    const out = [];
    for (const m of G.band.members.values()) {
      if (m.waiting) continue;
      out.push({ id: m.id, name: m.name, part: m.pick.part, input: m.pick.input, diff: m.pick.diff, st: m.id === G.band.id ? G.play.status() : m.st });
    }
    return out;
  }
  function gains() {
    const g = RN.partGains(members(), G.band ? G.band.id : 0, { sameRoom: G.same, leader: !G.band || G.band.leader });
    for (const p of ['drums', 'bass', 'guitar', 'vocals', 'keys']) G.mixer.setPart(p, g[p]);
  }

  function boost() {
    if (!G || G.ended || G.paused) return;
    if (G.play.boost(G.t) && G.band) G.band.boost();
  }
  $('b-boost').addEventListener('pointerdown', e => { e.preventDefault(); boost(); });

  function finish(why) {
    if (!G || G.ended) return;
    G.why = why;
    const st = { ...G.play.status(), done: true };
    endSong();
    if (G.band) G.band.status(st, true);
    const key = RN.bestKey(G.song, G.pick), old = save.best[key];
    G.newBest = false;
    if (!old || st.score > old.score) {
      save.best[key] = { score: st.score, stars: st.stars, acc: st.total ? st.hits / st.total : 0 };
      persist(); G.newBest = st.score > 0;
    }
    G.final = st;
    renderResults();
    show('results');
  }

  function renderResults() {
    if (!G || !G.final) return;
    const song = RN.songById(G.song);
    const list = G.band || G.bandWas ? members() : null;
    if (G.band) G.bandWas = true;
    const rows = list ? list.filter(m => m.st).map(m => ({ ...m, st: m.id === (G.band ? G.band.id : -1) ? G.final : m.st })) : [{ name: myName(), part: G.pick.part, input: G.pick.input, diff: G.pick.diff, st: G.final }];
    rows.sort((a, b) => b.st.score - a.st.score);
    const total = rows.reduce((s, r) => s + r.st.score, 0);
    const failed = G.why === 'out';
    $('res-title').textContent = failed ? (rows.length > 1 ? 'Booed off stage' : 'The crowd booed you off') : G.final.stars >= 5 ? 'What a show!' : G.final.stars >= 3 ? 'Nice set' : 'Song over';
    $('res-song').textContent = song.title + (G.newBest ? ' · new best!' : '');
    $('res-band').textContent = rows.length > 1 ? 'Band score ' + total.toLocaleString() : '';
    const ul = $('res-list'); ul.textContent = '';
    for (const r of rows) {
      const li = el('li');
      li.append(el('span', 'n', r.name));
      li.append(el('span', 's', r.st.score.toLocaleString()));
      li.append(el('span', 'st', starText(r.st.stars)));
      li.append(el('span', 'dim', r.st.done ? '' : 'still playing'));
      const acc = r.st.total ? Math.round(100 * r.st.hits / r.st.total) : 0;
      const what = r.part === 'vocals' ? acc + '% of lines' : acc + '% of notes';
      li.append(el('span', 'd', RN.PART_NAME[r.part] + (r.input === 'real' ? ' (real)' : '') + ', ' + DIFF_NAME[r.diff] + ' · ' + what + ' · best streak ' + r.st.best + (r.st.failed ? ' · dropped out' : '')));
      ul.append(li);
    }
    $('res-msg').textContent = G.lost ? window.RNBand.closedText(G.lost) : '';
    const inBand = !!S.band;
    $('b-again').textContent = inBand ? 'Back to the band' : 'Play again';
    $('b-menu').textContent = inBand ? 'Leave the band' : 'Pick another song';
  }
  $('b-again').onclick = () => {
    if (S.band) { openSetup(); return; }
    startSong({ song: G.song, at: null, same: false });
  };
  $('b-menu').onclick = () => {
    if (S.band) { if (!confirm('Leave the band?')) return; S.band.leave(); S.band = null; dropMic(); show('home'); return; }
    openSetup();
  };

  // pause (alone) or leave (in a band)
  $('b-pause').onclick = () => {
    if (!G || G.ended) return;
    if (G.band) { $('l-leave').textContent = G.band.leader ? 'Stop for everyone' : 'Leave'; $('d-leave').showModal(); return; }
    pause();
  };
  function pause() {
    if (!G || G.ended || G.paused || G.band) return;
    G.paused = true;
    for (const [, lane] of G.touches) { G.down[lane] = 0; G.play.release(lane, G.t); }
    G.touches.clear();
    ctx.suspend().catch(() => { /* ignore */ });
    $('d-pause').showModal();
  }
  function resume() {
    $('d-pause').close();
    if (!G || !G.paused) return;
    ctx.resume().then(() => { clock.reset(); if (G) G.paused = false; }).catch(() => { if (G) G.paused = false; });
  }
  $('p-resume').onclick = resume;
  $('d-pause').addEventListener('cancel', e => { e.preventDefault(); resume(); });
  $('p-restart').onclick = () => { $('d-pause').close(); const s = G.song; endSong(); startSong({ song: s, at: null, same: false }); };
  $('p-quit').onclick = () => { $('d-pause').close(); endSong(); openSetup(); };
  $('l-stay').onclick = () => $('d-leave').close();
  $('l-leave').onclick = () => {
    $('d-leave').close();
    if (!G || !G.band) return;
    if (G.band.leader) { G.band.stop(); return; }
    G.play.failed = true;
    finish('left');
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && G && !G.ended && !G.band) pause(); });

  // ---------- input ----------
  const cv = $('cv'), g2 = cv.getContext('2d');
  function laneAt(x) {
    const lanes = G.ch.lanes, left = L.cx - L.botW / 2;
    return Math.max(0, Math.min(lanes - 1, Math.floor((x - left) / (L.botW / lanes))));
  }
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!G || G.ended || G.paused || G.ch.input !== 'tap' || DEMO) return;
    const lane = laneAt(e.clientX);
    G.touches.set(e.pointerId, lane);
    G.down[lane]++;
    G.play.press(lane, songT(evTime(e)) - save.tapOffset);
    if (navigator.vibrate && G.pick.part === 'drums') navigator.vibrate(8);
  });
  const lift = e => {
    if (!G || !G.touches.has(e.pointerId)) return;
    const lane = G.touches.get(e.pointerId);
    G.touches.delete(e.pointerId);
    G.down[lane] = Math.max(0, G.down[lane] - 1);
    if (!G.down[lane]) G.play.release(lane, songT(evTime(e)) - save.tapOffset);
  };
  cv.addEventListener('pointerup', lift);
  cv.addEventListener('pointercancel', lift);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  const KEYS = { a: 0, s: 1, d: 2, f: 3, g: 4, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 };
  window.addEventListener('keydown', e => {
    if (!G || G.ended || S.screen !== 'stage') return;
    if (e.key === ' ') { e.preventDefault(); boost(); return; }
    if (e.key === 'Escape') { $('b-pause').click(); return; }
    const k = e.key.toLowerCase();
    if (e.repeat || !(k in KEYS) || G.paused || G.ch.input !== 'tap') return;
    const lane = KEYS[k];
    if (lane >= G.ch.lanes) return;
    G.down[lane]++;
    G.play.press(lane, songT(evTime(e)) - save.tapOffset);
  });
  window.addEventListener('keyup', e => {
    if (!G || G.ended) return;
    const k = e.key.toLowerCase();
    if (!(k in KEYS) || G.ch.input !== 'tap') return;
    const lane = KEYS[k];
    if (lane >= G.ch.lanes) return;
    G.down[lane] = Math.max(0, G.down[lane] - 1);
    if (!G.down[lane]) G.play.release(lane, songT(evTime(e)) - save.tapOffset);
  });

  // ---------- demo: the game plays itself (?demo) ----------
  function demoTaps(t) {
    const p = G.play;
    for (let i = p.next; i < p.notes.length && p.notes[i].t <= t; i++) {
      const n = p.notes[i];
      if (n.done || (i * 7919) % 23 === 0) continue; // misses a few, so the screen shows misses too
      p.press(n.lane, n.t + 0.004);
      G.flames[n.lane] = t; G.down[n.lane] = n.d > 0 ? 1 : 0;
      if (n.d > 0) G.demoHold.push(n);
    }
    for (const n of G.demoHold) if (t >= n.t + n.d) { p.release(n.lane, t); G.down[n.lane] = 0; n.released = true; }
    G.demoHold = G.demoHold.filter(n => !n.released);
    if (p.canBoost()) boost();
  }
  function demoFrame(t) {
    const p = G.play, ns = G.ch.notes;
    let n = null;
    for (const x of ns) if (x.t <= t && t < x.t + Math.max(x.d, 0.12)) n = x;
    if (!n) return { t, f: 0, conf: 0, chroma: null, onset: false };
    const midi = G.pick.part === 'vocals' ? n.p - 12 + 0.25 * Math.sin(t * 9) : n.p[0];
    const chroma = new Float32Array(12);
    if (n.pcs) for (const pc of n.pcs) chroma[pc] = 1 / n.pcs.length;
    if (p.canBoost()) boost();
    return { t, f: RN.hz(midi), conf: 0.95, chroma, onset: t - n.t < 0.03 };
  }

  // ---------- drawing ----------
  const L = {};
  let safe = { t: 0, b: 0 };
  function readSafe() {
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden';
    document.body.append(p);
    const cs = getComputedStyle(p);
    safe = { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    p.remove();
  }
  let W = 0, H = 0, DPR = 1;
  function resize() {
    if (S.screen !== 'stage') return;
    readSafe();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    g2.setTransform(DPR, 0, 0, DPR, 0, 0);
    L.top = safe.t + 64 + (G && G.band ? 30 : 0);
    L.strike = H - safe.b - Math.max(96, Math.min(150, H * 0.16));
    L.botW = Math.min(W - 64, 560);
    L.cx = W / 2;
    L.K = 2.4;
    // the vanishing point sits above the top so the far end of the highway lands on L.top
    L.yV = (L.top * (1 + L.K) - L.strike) / L.K;
  }
  window.addEventListener('resize', resize);
  const sOf = z => 1 / (1 + L.K * z);
  const yOf = z => L.yV + (L.strike - L.yV) * sOf(z);
  const wOf = z => L.botW * sOf(z);
  const xOf = (z, lane, lanes) => L.cx + (lane + 0.5 - lanes / 2) * wOf(z) / lanes;

  const COLORS5 = ['#3ee07a', '#ff4d5e', '#ffd23f', '#3fa7ff', '#ff9a3c'];
  const DRUM_COLORS = ['#ff9a3c', '#ff4d5e', '#ffd23f', '#3fd7ff'];
  const STRING_COLORS = ['#ff4d5e', '#ffd23f', '#3fa7ff', '#ff9a3c', '#3ee07a', '#c36bff'];
  const laneColor = lane => G.pick.part === 'drums' ? DRUM_COLORS[lane] : G.ch.input === 'real' ? STRING_COLORS[lane] : COLORS5[lane];

  function draw(t) {
    if (!W) resize();
    g2.clearRect(0, 0, W, H);
    background(t);
    if (G.pick.part === 'vocals') drawVox(t); else drawHighway(t);
    hud(t);
  }

  function background(t) {
    const p = G.play, bg = g2.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, p.boosting ? '#06233a' : '#170a26'); bg.addColorStop(1, '#05030a');
    g2.fillStyle = bg; g2.fillRect(0, 0, W, H);
    // stage lights that pulse on the beat
    const beat = Math.max(0, t) / G.arr.spb, pulse = 0.5 + 0.5 * Math.cos((beat % 1) * Math.PI * 2);
    for (const [x, c] of [[W * 0.1, p.boosting ? '63,215,255' : '255,79,163'], [W * 0.9, '63,215,255']]) {
      const r = g2.createRadialGradient(x, 0, 0, x, 0, H * 0.7);
      r.addColorStop(0, 'rgba(' + c + ',' + (0.14 + 0.1 * pulse * (t > 0 ? 1 : 0)) + ')');
      r.addColorStop(1, 'rgba(' + c + ',0)');
      g2.fillStyle = r; g2.fillRect(0, 0, W, H);
    }
  }

  function drawHighway(t) {
    const ch = G.ch, lanes = ch.lanes, look = G.look, real = ch.input === 'real';
    const zLo = -0.14;
    // the surface
    g2.beginPath();
    g2.moveTo(L.cx - wOf(1) / 2, yOf(1)); g2.lineTo(L.cx + wOf(1) / 2, yOf(1));
    g2.lineTo(L.cx + wOf(zLo) / 2, yOf(zLo)); g2.lineTo(L.cx - wOf(zLo) / 2, yOf(zLo)); g2.closePath();
    const sg = g2.createLinearGradient(0, yOf(1), 0, yOf(zLo));
    sg.addColorStop(0, 'rgba(30,20,50,0.2)'); sg.addColorStop(0.5, 'rgba(26,16,44,0.92)'); sg.addColorStop(1, 'rgba(14,8,26,0.97)');
    g2.fillStyle = sg; g2.fill();
    // lanes (strings for a real instrument)
    for (let i = 0; i <= lanes; i++) {
      const edge = i === 0 || i === lanes;
      if (real && edge) continue;
      g2.strokeStyle = edge ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.09)'; g2.lineWidth = edge ? 2 : 1;
      g2.beginPath();
      const f = i / lanes - 0.5;
      g2.moveTo(L.cx + f * wOf(1), yOf(1)); g2.lineTo(L.cx + f * wOf(zLo), yOf(zLo)); g2.stroke();
    }
    if (real) for (let i = 0; i < lanes; i++) {
      g2.strokeStyle = STRING_COLORS[i]; g2.globalAlpha = 0.35; g2.lineWidth = 1 + (lanes - i) * 0.35;
      g2.beginPath(); g2.moveTo(xOf(1, i, lanes), yOf(1)); g2.lineTo(xOf(zLo, i, lanes), yOf(zLo)); g2.stroke();
      g2.globalAlpha = 1;
    }
    // beat lines
    const spb = G.arr.spb;
    for (let b = Math.floor((t - 0.4) / spb); b * spb < t + look; b++) {
      const z = (b * spb - t) / look;
      if (z < zLo || z > 1) continue;
      g2.strokeStyle = b % 4 === 0 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.1)';
      g2.lineWidth = b % 4 === 0 ? 2 : 1;
      g2.beginPath(); g2.moveTo(L.cx - wOf(z) / 2, yOf(z)); g2.lineTo(L.cx + wOf(z) / 2, yOf(z)); g2.stroke();
    }
    // the strike line and its targets
    const ys = yOf(0), lw = L.botW / lanes;
    g2.fillStyle = 'rgba(255,255,255,0.85)'; g2.fillRect(L.cx - L.botW / 2, ys - 2, L.botW, 4);
    for (let i = 0; i < lanes; i++) {
      const x = xOf(0, i, lanes), c = laneColor(i), lit = G.down[i] > 0;
      const missed = G.misses[i] !== undefined && t - G.misses[i] < 0.18;
      g2.beginPath(); g2.ellipse(x, ys, lw * 0.36, lw * 0.2, 0, 0, Math.PI * 2);
      g2.fillStyle = missed ? 'rgba(255,60,60,0.55)' : lit ? c : 'rgba(10,6,20,0.9)'; g2.fill();
      g2.lineWidth = 3; g2.strokeStyle = c; g2.stroke();
      const label = real ? ch.strings[i] : G.pick.part === 'drums' ? ['Kick', 'Snare', 'Tom', 'Cymbal'][i] : null;
      if (label) {
        g2.fillStyle = real ? '#fff' : 'rgba(255,255,255,0.6)'; g2.font = (real ? 'bold 14px' : '12px') + ' system-ui'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
        g2.fillText(label, x, ys + lw * 0.2 + 16);
      }
    }
    // notes, far ones first so near ones draw on top
    const ns = G.play.notes, vis = [];
    for (let i = Math.max(0, G.play.next - 40); i < ns.length; i++) {
      const n = ns[i];
      if (n.t - t > look) break;
      if ((n.t + n.d - t) / look < zLo) continue;
      vis.push(n);
    }
    for (let k = vis.length - 1; k >= 0; k--) drawNote(vis[k], t, look, lanes, real);
    // chord names for a real guitar: on the left, level with each chord
    if (real) {
      g2.textAlign = 'right'; g2.textBaseline = 'middle';
      let lastName = null;
      for (const n of vis) {
        const z = (n.t - t) / look;
        if (z < 0.04 || n.name === lastName) continue;
        lastName = n.name;
        g2.font = 'bold ' + Math.round(11 + 9 * sOf(z)) + 'px system-ui';
        g2.fillStyle = 'rgba(255,255,255,' + (0.4 + 0.6 * sOf(z)) + ')';
        g2.fillText(n.name, L.cx - wOf(z) / 2 - 6, yOf(z));
      }
      const h = G.play.heard, y = L.strike + (H - safe.b - L.strike) * 0.62;
      g2.textAlign = 'center'; g2.font = 'bold 16px system-ui';
      g2.fillStyle = h ? '#fff' : 'rgba(255,255,255,0.4)';
      g2.fillText(h ? 'Hearing ' + h.name + (Math.abs(h.cents) > 15 ? (h.cents > 0 ? ' (sharp)' : ' (flat)') : '') : G.mic && G.mic.level < 0.003 ? 'Play a note...' : 'Listening', L.cx, y);
      const lvl = G.mic ? Math.min(1, G.mic.level * 12) : 0;
      g2.fillStyle = 'rgba(255,255,255,0.15)'; g2.fillRect(L.cx - 60, y + 14, 120, 5);
      g2.fillStyle = '#5ef09a'; g2.fillRect(L.cx - 60, y + 14, 120 * lvl, 5);
    }
    // hit flames
    for (let i = 0; i < lanes; i++) {
      const f = G.flames[i];
      if (f === undefined || t - f > 0.16) continue;
      const a = 1 - (t - f) / 0.16, x = xOf(0, i, lanes);
      const r = g2.createRadialGradient(x, ys, 0, x, ys, lw * 0.8);
      r.addColorStop(0, 'rgba(255,255,255,' + a + ')'); r.addColorStop(0.4, hexA(laneColor(i), a * 0.8)); r.addColorStop(1, hexA(laneColor(i), 0));
      g2.fillStyle = r; g2.fillRect(x - lw, ys - lw, lw * 2, lw * 2);
    }
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, a)) + ')';
  }

  function drawNote(n, t, look, lanes, real) {
    const p = G.play, boosting = p.boosting;
    const z = (n.t - t) / look;
    const gems = real ? n.tab.map(x => ({ lane: x.s, fret: x.f })) : [{ lane: n.lane }];
    const missed = n.done && !n.hit;
    // a hold's tail
    if (n.d > 0 && !real) {
      const z1 = Math.min(1, (n.t + n.d - t) / look);
      const held = p.holds && p.holds.some(h => h.n === n);
      const z0 = held ? 0 : Math.max(-0.14, z);
      if (z1 > z0 && !(n.hit && !held)) {
        const c = laneColor(n.lane), steps = 10;
        g2.beginPath();
        for (let k = 0; k <= steps; k++) { const zz = z0 + (z1 - z0) * k / steps; g2.lineTo(xOf(zz, n.lane, lanes) - wOf(zz) / lanes * 0.12, yOf(zz)); }
        for (let k = steps; k >= 0; k--) { const zz = z0 + (z1 - z0) * k / steps; g2.lineTo(xOf(zz, n.lane, lanes) + wOf(zz) / lanes * 0.12, yOf(zz)); }
        g2.closePath();
        g2.fillStyle = missed ? 'rgba(120,120,120,0.35)' : held ? hexA(c, 0.95) : hexA(c, 0.55);
        g2.fill();
      }
    }
    if (n.hit) return;
    if (z < -0.14) return;
    const y = yOf(z), lw = wOf(z) / lanes;
    if (real && gems.length > 1) { // chord: a bar joins its notes
      const xs = gems.map(gm => xOf(z, gm.lane, lanes));
      g2.strokeStyle = missed ? 'rgba(140,140,140,0.5)' : 'rgba(255,255,255,0.75)'; g2.lineWidth = Math.max(2, lw * 0.12);
      g2.beginPath(); g2.moveTo(Math.min(...xs), y); g2.lineTo(Math.max(...xs), y); g2.stroke();
    }
    for (const gm of gems) {
      const x = xOf(z, gm.lane, lanes), c = missed ? '#666' : (boosting && !real) ? '#7fe3ff' : laneColor(gm.lane);
      const rx = lw * (real ? 0.32 : 0.36), ry = rx * (real ? 0.62 : 0.55);
      if (n.glow && !missed) {
        g2.beginPath(); g2.ellipse(x, y, rx * 1.25, ry * 1.4, 0, 0, Math.PI * 2);
        g2.fillStyle = 'rgba(200,245,255,0.35)'; g2.fill();
      }
      g2.beginPath(); g2.ellipse(x, y + ry * 0.25, rx, ry, 0, 0, Math.PI * 2);
      g2.fillStyle = 'rgba(0,0,0,0.5)'; g2.fill();
      g2.beginPath(); g2.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      const gr = g2.createLinearGradient(0, y - ry, 0, y + ry);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, c); gr.addColorStop(1, shade(c));
      g2.fillStyle = gr; g2.fill();
      g2.lineWidth = Math.max(1, rx * 0.12); g2.strokeStyle = n.glow && !missed ? '#e8fbff' : 'rgba(0,0,0,0.6)'; g2.stroke();
      if (real) {
        g2.fillStyle = '#111'; g2.font = 'bold ' + Math.max(9, Math.round(ry * 1.25)) + 'px system-ui';
        g2.textAlign = 'center'; g2.textBaseline = 'middle';
        g2.fillText(String(gm.fret), x, y + 1);
      } else if (G.pick.part !== 'drums') {
        g2.beginPath(); g2.ellipse(x, y, rx * 0.42, ry * 0.42, 0, 0, Math.PI * 2);
        g2.fillStyle = 'rgba(255,255,255,0.85)'; g2.fill();
      }
    }
  }
  function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgb(' + ((n >> 16) * 0.45 | 0) + ',' + (((n >> 8) & 255) * 0.45 | 0) + ',' + ((n & 255) * 0.45 | 0) + ')';
  }

  // singing: notes scroll right to left past the line; your voice is the arrow
  function drawVox(t) {
    const ch = G.ch, p = G.play, tol = ch.cfg.tol;
    const top = L.top + 6, bot = Math.max(top + 160, H * 0.6), nowX = W * 0.22, pps = (W - nowX) / (2.8 / save.speed);
    const lo = ch.range[0] - 3, hi = ch.range[1] + 3, yP = m => bot - (m - lo) / (hi - lo) * (bot - top);
    const ft = t - save.micOffset - (G.mic ? G.mic.lag : 0);
    const xT = tt => nowX + (tt - ft) * pps;
    g2.fillStyle = 'rgba(20,12,34,0.85)'; g2.fillRect(0, top, W, bot - top);
    for (let m = Math.ceil(lo); m <= hi; m++) {
      if (m % 2) continue;
      g2.fillStyle = m % 12 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
      g2.fillRect(0, yP(m), W, 1);
    }
    // line ends
    for (const ph of p.phrases) {
      const x = xT(ph.end + 0.1);
      if (x < 0 || x > W) continue;
      g2.fillStyle = 'rgba(255,255,255,0.12)'; g2.fillRect(x, top, 2, bot - top);
    }
    // the notes, as tubes as tall as what counts as on pitch
    const semi = (bot - top) / (hi - lo), thick = Math.max(10, Math.min(28, semi * tol * 1.6));
    for (const n of p.notes) {
      const x0 = xT(n.t), x1 = xT(n.t + n.d);
      if (x1 < 0) continue;
      if (x0 > W) break;
      const y = yP(n.p), gl = isGlowNote(n);
      const sung = n.t + n.d < ft ? Math.min(1, n.good / n.d) : null;
      const fill = sung === null ? (gl ? '#9fe8ff' : '#c48bff') : sung > 0.5 ? '#5ef09a' : sung > 0.2 ? '#ffd23f' : '#6a5a80';
      roundRect(x0, y - thick / 2, Math.max(thick, x1 - x0 - 3), thick, thick / 2);
      g2.fillStyle = hexA(fill, sung === null ? 0.8 : 0.6); g2.fill();
      if (gl) { g2.lineWidth = 2; g2.strokeStyle = '#e8fbff'; g2.stroke(); }
    }
    // now line, and where your voice has been
    g2.fillStyle = 'rgba(255,255,255,0.7)'; g2.fillRect(nowX - 1, top, 2, bot - top);
    g2.lineWidth = 3; g2.strokeStyle = 'rgba(255,255,255,0.7)'; g2.beginPath();
    let pen = false;
    for (const s of G.trail) {
      if (s.m === null) { pen = false; continue; }
      const x = xT(s.t), y = yP(Math.max(lo, Math.min(hi, s.m)));
      if (!pen) { g2.moveTo(x, y); pen = true; } else g2.lineTo(x, y);
    }
    g2.stroke();
    if (p.pitch) {
      const y = yP(Math.max(lo, Math.min(hi, p.pitch.m))), on = p.pitch.off !== null && Math.abs(p.pitch.off) <= tol;
      g2.beginPath(); g2.moveTo(nowX + 10, y); g2.lineTo(nowX - 14, y - 11); g2.lineTo(nowX - 14, y + 11); g2.closePath();
      g2.fillStyle = on ? '#5ef09a' : '#ff9a3c'; g2.fill();
      g2.lineWidth = 2; g2.strokeStyle = '#fff'; g2.stroke();
    }
    // the words: the line being sung, then the next one
    const cur = p.phrases.findIndex(ph => ph.end + 0.15 >= ft);
    const ly = bot + 44;
    if (cur >= 0) {
      lyricLine(p.phrases[cur], ft, ly, 1);
      if (p.phrases[cur + 1]) lyricLine(p.phrases[cur + 1], -Infinity, ly + 40, 0.45);
    }
    if (G.mic) {
      const lvl = Math.min(1, G.mic.level * 14);
      g2.fillStyle = 'rgba(255,255,255,0.15)'; g2.fillRect(W / 2 - 60, ly + 76, 120, 5);
      g2.fillStyle = '#5ef09a'; g2.fillRect(W / 2 - 60, ly + 76, 120 * lvl, 5);
    }
  }
  function isGlowNote(n) { return G.play.phrases.some(ph => ph.glow && n.t >= ph.t - 1e-6 && n.t < ph.end); }
  function roundRect(x, y, w, h, r) {
    g2.beginPath(); g2.moveTo(x + r, y); g2.arcTo(x + w, y, x + w, y + h, r); g2.arcTo(x + w, y + h, x, y + h, r);
    g2.arcTo(x, y + h, x, y, r); g2.arcTo(x, y, x + w, y, r); g2.closePath();
  }
  function lyricLine(ph, ft, y, alpha) {
    const ns = ph.notes.map(i => G.play.notes[i]);
    const parts = ns.map((n, i) => /-$/.test(n.syl) ? n.syl.slice(0, -1) : n.syl + (i < ns.length - 1 ? ' ' : ''));
    let size = 26;
    g2.font = 'bold ' + size + 'px system-ui';
    let w = g2.measureText(parts.join('')).width;
    if (w > W - 60) { size = Math.floor(size * (W - 60) / w); g2.font = 'bold ' + size + 'px system-ui'; w = g2.measureText(parts.join('')).width; }
    let x = (W - w) / 2;
    g2.textAlign = 'left'; g2.textBaseline = 'middle';
    parts.forEach((s, i) => {
      const n = ns[i], now = ft >= n.t && ft < n.t + n.d, past = ft >= n.t + n.d;
      g2.fillStyle = now ? '#fff' : past ? '#ff8cc6' : 'rgba(241,234,255,' + (0.75 * alpha) + ')';
      if (alpha < 1) g2.fillStyle = 'rgba(241,234,255,' + alpha + ')';
      g2.fillText(s, x, y);
      x += g2.measureText(s).width;
    });
  }

  function hud(t) {
    const p = G.play, st = p.status();
    // score, streak, multiplier
    g2.textBaseline = 'alphabetic'; g2.textAlign = 'left'; g2.fillStyle = '#fff';
    g2.font = '900 28px Impact, "Arial Black", system-ui';
    g2.fillText(st.score.toLocaleString(), 62, safe.t + 34);
    g2.font = '13px system-ui'; g2.fillStyle = 'rgba(241,234,255,0.7)';
    g2.fillText(p.streak > 1 ? p.streak + (G.pick.part === 'vocals' ? ' line streak' : ' note streak') : RN.songById(G.song).title, 62, safe.t + 52);
    const mx = W - 40, my = safe.t + 32, mult = p.mult;
    g2.beginPath(); g2.arc(mx, my, 22, 0, Math.PI * 2);
    g2.fillStyle = p.boosting ? '#1d8fd6' : ['#2a2040', '#2a2040', '#c76b1f', '#2a9a52', '#8a3fd1', '#c22f6b', '#d9a400'][mult] || '#2a2040'; g2.fill();
    g2.lineWidth = 3; g2.strokeStyle = '#fff'; g2.stroke();
    g2.fillStyle = '#fff'; g2.font = '900 18px Impact, "Arial Black", system-ui'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillText('x' + (mult * (p.boosting ? 2 : 1)), mx, my + 1);
    // progress toward the next multiplier
    if (G.pick.part !== 'vocals' && mult < p.maxMult) {
      g2.beginPath(); g2.arc(mx, my, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p.streak % 10) / 10);
      g2.strokeStyle = '#ffd23f'; g2.lineWidth = 3; g2.stroke();
    }
    // crowd meter on the left, energy on the right
    const m0 = L.top + 10, m1 = L.strike;
    bar(8, m0, 10, m1 - m0, p.meter, p.meter < 0.25 ? '#ff4d5e' : p.meter < 0.5 ? '#ffd23f' : '#5ef09a');
    bar(W - 18, m0, 10, m1 - m0, p.energy, p.energy >= 0.5 ? '#8fe9ff' : '#3fa7ff');
    // the band
    if (G.band) {
      const ms = members(), y = safe.t + 62, w = Math.min(120, (W - 16) / ms.length - 6);
      ms.forEach((m, i) => {
        const x = 8 + i * (w + 6), s = m.st;
        g2.fillStyle = 'rgba(20,12,36,0.85)'; roundRect(x, y, w, 24, 6); g2.fill();
        g2.fillStyle = !s ? '#555' : s.failed ? '#ff4d5e' : s.meter < 0.25 ? '#ff4d5e' : s.meter < 0.5 ? '#ffd23f' : '#5ef09a';
        g2.fillRect(x, y + 20, w * (s ? s.meter : 0), 4);
        g2.fillStyle = '#fff'; g2.font = 'bold 11px system-ui'; g2.textAlign = 'left'; g2.textBaseline = 'middle';
        const label = RN.PART_NAME[m.part][0] + ' ' + m.name;
        g2.fillText(label.length > 11 ? label.slice(0, 10) + '…' : label, x + 5, y + 9);
        g2.textAlign = 'right'; g2.fillStyle = s && s.failed ? '#ff6b6b' : 'rgba(255,255,255,0.75)';
        if (w > 70) g2.fillText(s ? (s.failed ? 'OUT' : String(s.score)) : '', x + w - 4, y + 9);
      });
    }
    // count-in, section names, popups
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    const mid = (L.top + L.strike) / 2;
    if (t < 0) {
      const beats = Math.ceil(-t / G.arr.spb);
      g2.font = '900 ' + (beats <= 4 ? 84 : 30) + 'px Impact, "Arial Black", system-ui';
      g2.fillStyle = 'rgba(255,255,255,0.9)';
      g2.fillText(beats <= 4 ? String(beats) : 'Get ready', W / 2, mid);
    }
    if (G.banner && t - G.banner.t < 1.6 && t >= 0) {
      const a = Math.min(1, 1.6 - (t - G.banner.t));
      g2.font = 'bold 20px system-ui'; g2.fillStyle = 'rgba(255,255,255,' + a * 0.85 + ')';
      g2.fillText(G.banner.text, W / 2, L.top + 18);
    }
    G.pops = G.pops.filter(pp => t - pp.t < 0.9);
    G.pops.forEach((pp, i) => {
      const k = (t - pp.t) / 0.9;
      g2.globalAlpha = 1 - k;
      g2.font = '900 34px Impact, "Arial Black", system-ui'; g2.fillStyle = pp.color;
      g2.fillText(pp.text, W / 2, (G.pick.part === 'vocals' ? H * 0.32 : L.strike - 70) - k * 40 - i * 36);
      g2.globalAlpha = 1;
    });
    if (p.failed) {
      g2.fillStyle = 'rgba(10,0,10,0.55)'; g2.fillRect(0, L.top, W, L.strike - L.top);
      g2.font = '900 64px Impact, "Arial Black", system-ui'; g2.fillStyle = '#ff4d5e';
      g2.fillText('OUT!', W / 2, mid - 20);
      g2.font = '15px system-ui'; g2.fillStyle = '#fff';
      g2.fillText(G.band && G.band.members.size > 1 ? 'A bandmate\'s boost brings you back' : 'The crowd has had enough', W / 2, mid + 30);
    }
  }
  function bar(x, y, w, h, v, color) {
    g2.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(x, y, w, h, w / 2); g2.fill();
    const fh = h * Math.max(0, Math.min(1, v));
    if (fh > 1) { g2.fillStyle = color; roundRect(x, y + h - fh, w, fh, w / 2); g2.fill(); }
  }

  // ---------- settings and timing tests ----------
  function paintSettings() {
    $('s-speed').value = Math.round(save.speed * 100);
    $('s-vol').value = Math.round(save.volume * 100);
    $('s-tap').textContent = Math.round(save.tapOffset * 1000) + ' ms';
    $('s-mic').textContent = Math.round(save.micOffset * 1000) + ' ms';
  }
  $('b-settings').onclick = () => { paintSettings(); $('cal-box').hidden = true; $('d-settings').showModal(); };
  $('s-done').onclick = () => $('d-settings').close();
  $('s-speed').oninput = () => { save.speed = $('s-speed').value / 100; persist(); };
  $('s-vol').oninput = () => { save.volume = $('s-vol').value / 100; persist(); if (master) master.gain.setTargetAtTime(save.volume, ctx.currentTime, 0.05); };
  $('s-reset').onclick = () => { save.tapOffset = 0; save.micOffset = RN.cleanSaved({}).micOffset; persist(); paintSettings(); };

  let calRun = null;
  const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
  $('s-tap-test').onclick = () => {
    const c = audio();
    if (!c || calRun) return;
    const m = new A.Mixer(c, master), n = 16, gap = 0.6;
    clock.reset(); clock.sample();
    const start = c.currentTime + 1;
    for (let i = 0; i < n; i++) m.click(start + i * gap, i % 4 === 0);
    const taps = [];
    $('cal-box').hidden = false; $('cal-pad').hidden = false;
    $('cal-text').textContent = 'Tap the pad on every click.';
    $('cal-pad').onpointerdown = e => { e.preventDefault(); taps.push(clock.at(evTime(e)) - start); $('cal-pad').classList.add('flash'); setTimeout(() => $('cal-pad').classList.remove('flash'), 80); };
    calRun = true;
    const tick = () => { if (calRun) { clock.sample(); requestAnimationFrame(tick); } };
    tick();
    setTimeout(() => {
      calRun = null; m.close(); $('cal-pad').onpointerdown = null;
      const offs = taps.map(x => { const k = Math.round(x / gap); return k >= 3 && k < n ? x - k * gap : null; }).filter(x => x !== null && Math.abs(x) < 0.3);
      if (offs.length < 6) { $('cal-text').textContent = 'Not enough taps. Try again.'; return; }
      save.tapOffset = Math.max(-0.4, Math.min(0.4, median(offs))); persist(); paintSettings();
      $('cal-text').textContent = 'Done. Your taps land ' + Math.abs(Math.round(save.tapOffset * 1000)) + ' ms ' + (save.tapOffset >= 0 ? 'after' : 'before') + ' the sound. The game allows for that now.';
    }, (n * gap + 1.6) * 1000);
  };
  $('s-mic-test').onclick = async () => {
    const c = audio();
    if (!c || calRun) return;
    $('cal-box').hidden = false; $('cal-pad').hidden = true;
    $('cal-text').textContent = 'Asking for the mic...';
    let mic;
    try { mic = await getMic('guitar'); } catch (e) { $('cal-text').textContent = micError(e); return; }
    $('cal-text').textContent = 'Listening. Keep quiet for a few seconds, and no headphones.';
    const m = new A.Mixer(c, master), n = 10, gap = 0.5;
    clock.reset(); clock.sample();
    const start = c.currentTime + 0.8;
    for (let i = 0; i < n; i++) m.drum('snare', start + i * gap);
    const hits = [];
    calRun = true;
    const tick = () => {
      if (!calRun) return;
      clock.sample();
      const fr = mic.read(clock.now() - start - mic.lag);
      if (fr.onset) hits.push(fr.t);
      requestAnimationFrame(tick);
    };
    tick();
    setTimeout(() => {
      calRun = null; m.close();
      if (S.pick.input === 'tap' || micKind(S.pick) !== 'guitar') dropMic();
      const offs = hits.map(x => { const k = Math.round(x / gap); return k >= 1 && k < n ? x - k * gap : null; }).filter(x => x !== null && x > -0.1 && x < 0.5);
      if (offs.length < 5) { $('cal-text').textContent = 'The mic did not hear the clicks well. Turn the volume up and try again.'; return; }
      save.micOffset = Math.max(-0.2, Math.min(0.6, median(offs))); persist(); paintSettings();
      $('cal-text').textContent = 'Done. The mic hears things ' + Math.round(save.micOffset * 1000) + ' ms late, and the game allows for that now.';
    }, (n * gap + 1.4) * 1000);
  };

  // ---------- tuner ----------
  let tunerKind = 'guitar', tunerOn = false;
  async function tunerStart() {
    $('t-note').textContent = '-'; $('t-hz').textContent = 'Asking for the mic...';
    $('t-strings').textContent = tunerKind === 'bass' ? 'Strings, thick to thin: E A D G' : 'Strings, thick to thin: E A D G B E';
    let mic;
    try { mic = await getMic(tunerKind); } catch (e) { $('t-hz').textContent = micError(e); return; }
    $('t-hz').textContent = 'Play one string at a time.';
    tunerOn = true;
    let shown = 0;
    const tick = () => {
      if (!tunerOn || !$('d-tuner').open) { tunerOn = false; return; }
      const fr = mic.read(0);
      if (fr.f > 0 && fr.conf > 0.75) {
        const m = RN.midiOf(fr.f), cents = Math.round((m - Math.round(m)) * 100);
        $('t-note').textContent = RN.noteName(m);
        $('t-note').className = Math.abs(cents) <= 5 ? 'good' : '';
        $('t-needle').style.left = 'calc(' + (50 + cents) + '% - 2px)';
        $('t-hz').textContent = fr.f.toFixed(1) + ' Hz, ' + (cents === 0 ? 'in tune' : Math.abs(cents) + ' cents ' + (cents > 0 ? 'sharp' : 'flat'));
        shown = performance.now();
      } else if (performance.now() - shown > 1500) { $('t-note').textContent = '-'; $('t-note').className = ''; }
      requestAnimationFrame(tick);
    };
    tick();
  }
  $('b-tuner').onclick = () => { audio(); $('d-tuner').showModal(); tunerStart(); };
  $('t-done').onclick = () => $('d-tuner').close();
  $('d-tuner').addEventListener('close', () => { tunerOn = false; dropMic(); });
  for (const btn of $('t-kind').querySelectorAll('button')) {
    btn.onclick = () => {
      tunerKind = btn.dataset.k; tunerOn = false;
      for (const x of $('t-kind').querySelectorAll('button')) x.classList.toggle('on', x === btn);
      tunerStart();
    };
  }

  if (window.Updater) window.Updater.start({ url: '../version.json' });
  window.RNPage = { get G() { return G; }, get S() { return S; }, save: () => save, startSong, finish };
  show('home');
})();
