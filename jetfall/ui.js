/*
 * Jetfall page: menus, input, camera, effects, HUD. The rules are in sim.js, the networking in net.js and link.js,
 * drawing in render.js and models.js. Nothing here decides anything about the game: it shows what the client knows
 * and sends what the player presses.
 */
(function () {
  'use strict';
  const JF = window.JF, Net = window.JFNet, Link = window.JFLink, R = window.JFRender, Models = window.JFModels, Audio = window.JFAudio;
  const { B, ARMORS, WEAPONS, PACKS, TEAMS, TICK } = JF;
  const $ = id => document.getElementById(id);

  // ---------- saved things ----------
  const KEY = 'jetfall-v1';
  function loadPrefs() {
    let o = {};
    try { o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { o = {}; }
    const num = (v, lo, hi, d) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
    return {
      v: 1,
      name: typeof o.name === 'string' ? JF.cleanName(o.name) : '',
      loadout: JF.cleanLoadout(o.loadout) || JSON.parse(JSON.stringify(JF.DEFAULT_LOADOUT)),
      sens: num(o.sens, 0.2, 3, 1), invert: o.invert === true, fov: num(o.fov, 70, 110, 90),
      quality: ['low', 'mid', 'high'].includes(o.quality) ? o.quality : null,
      fps: o.fps === true, skiHold: o.skiHold !== false, third: o.third === true, speak: o.speak !== false,
      host: o.host && typeof o.host === 'object' ? o.host : {},
    };
  }
  const prefs = loadPrefs();
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ } };
  const isTouch = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  if (!prefs.quality) prefs.quality = isTouch ? 'low' : 'mid';
  if (isTouch) document.body.classList.add('touch');

  // ---------- renderer ----------
  let renderer = null;
  try { renderer = new R.Renderer($('view')); } catch (e) {
    $('menuMsg').textContent = 'This browser cannot draw the game (no WebGL2). Try a recent Chrome, Firefox or Safari.';
    console.error(e);
  }
  function applyQuality() {
    if (!renderer) return;
    renderer.scale = prefs.quality === 'low' ? 0.6 : prefs.quality === 'mid' ? 0.85 : 1;
    renderer.shadowsOn = prefs.quality !== 'low';
  }
  applyQuality();

  // ---------- session ----------
  let S = null; // { client, host, link, isHost, room, public, roomName }
  const PUBLIC_INFO_MS = 5000;

  function mkClient(send) {
    return new Net.Client({ send, name: prefs.name || 'player', loadout: prefs.loadout });
  }

  // the host's game runs in a worker (host-worker.js); this is its handle on the page
  function startLocal(settings, online) {
    const s = { isHost: true, online: !!online };
    const worker = new Worker('host-worker.js');
    s.host = {
      worker, state: { settings, listing: {}, players: [] },
      receive(peer, bytes) { const b = bytes.slice(); worker.postMessage({ t: 'recv', peer, bytes: b }, [b.buffer]); },
      leave(peer) { worker.postMessage({ t: 'leave', peer }); },
      stop() { worker.terminate(); },
    };
    worker.onmessage = e => {
      const m = e.data;
      if (m.t === 'send') { if (m.peer === 0) { if (s.client) s.client.receive(m.bytes); } else if (s.link) s.link.send(m.peer, m.bytes, m.reliable); }
      else if (m.t === 'kick') { if (s.link) s.link.kick(m.peer); }
      else if (m.t === 'state') s.host.state = m;
    };
    worker.onerror = e => { console.error(e); toast('The game stopped with an error. Leave and start again.'); };
    worker.postMessage({ t: 'start', settings, room: online ? online.room : null });
    s.client = mkClient(bytes => s.host.receive(0, bytes));
    return s;
  }

  async function playBots() {
    if (!renderer) return;
    Audio.start();
    const settings = Object.assign({ map: prefs.host.map || 'highland', bots: 4, skill: 0.5, caps: 5, minutes: 20 }, prefs.host.solo || {});
    S = startLocal(settings, null);
    S.client.hello(0);
    enterGame();
  }

  async function hostOnline(opts) {
    if (!renderer) return;
    Audio.start();
    setMenuMsg('Starting…');
    let link;
    try {
      link = Link.connect();
      const settings = { map: opts.map, bots: opts.bots, skill: opts.skill, caps: opts.caps, minutes: opts.minutes, rotate: opts.rotate !== false };
      const r = await link.host(opts.name, { public: opts.public, map: opts.map, v: Net.PROTO, n: 1 }, opts.room);
      S = startLocal(settings, { room: r.room });
      S.link = link; S.room = r.room; S.public = opts.public; S.roomName = opts.name; S.fixed = !!opts.room;
      link.on('data', (id, bytes) => S && S.host && S.host.receive(id, bytes));
      link.on('left', id => S && S.host && S.host.leave(id));
      link.on('closed', () => { if (S && S.link === link) toast('Lost the connection to the game server. Friends can no longer join, but you can keep playing.'); });
      link.on('rtc', () => {});
      S.client.hello(0);
      S.infoT = setInterval(() => { if (S && S.link) S.link.info(Object.assign({ public: S.public, name: S.roomName }, S.host.state.listing)); }, PUBLIC_INFO_MS);
      setMenuMsg('');
      enterGame();
      history.replaceState(null, '', '#' + r.room);
    } catch (e) {
      if (link) link.close();
      if (opts.room && e.why === 'taken') return 'taken';
      setMenuMsg(e.message || String(e));
    }
  }

  // The always-there servers: the relay keeps their names and codes. Picking an empty one makes this browser its host
  // (with the slot's map and bots); if someone got there first, we join them instead.
  const fixedSlots = new Map(); // code -> { name, info } from the last server list
  function slotSettings(code) {
    const sl = fixedSlots.get(code) || { name: code, info: {} }, i = sl.info || {};
    const int = (v, lo, hi, d) => (Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : d);
    return { name: JF.cleanName(sl.name), map: JF.has(JF.MAPS, i.map) ? i.map : 'highland', bots: int(i.bots, 0, 8, 3), skill: typeof i.skill === 'number' && i.skill >= 0 && i.skill <= 1 ? i.skill : 0.5,
      caps: 5, minutes: 20, public: true, rotate: i.rotate === true, room: code };
  }
  async function playFixed(code) {
    setMenuMsg('Starting ' + (fixedSlots.has(code) ? fixedSlots.get(code).name : code) + '…');
    const r = await hostOnline(slotSettings(code));
    if (r === 'taken') return join(code, true);
  }

  async function join(code, noClaim) {
    if (!renderer) return;
    code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { setMenuMsg('A game code is 6 letters and numbers.'); return; }
    Audio.start();
    setMenuMsg('Joining ' + code + '…');
    let link;
    try {
      link = Link.connect();
      const r = await link.join(code, prefs.name || 'player');
      const s = { isHost: false, online: true, link, room: r.room, fixed: fixedSlots.has(r.room) };
      s.client = mkClient((bytes, reliable) => link.send(0, bytes, reliable));
      link.on('data', (from, bytes) => { if (from === 0) s.client.receive(bytes); });
      link.on('closed', why => {
        if (S !== s) return;
        // on an always-there server the game goes on: someone still here picks it back up (the first to claim hosts, the rest join)
        if (why === 'host-left' && s.fixed) { leave('The host left. Picking the game back up…'); setTimeout(() => { if (!S) playFixed(s.room); }, 200 + Math.random() * 1200); return; }
        leave(why === 'kicked' ? 'The host removed you from the game.' : why === 'host-left' ? 'The host left, so the game ended.' : 'Lost the connection to the game.');
      });
      S = s;
      s.client.hello();
      // the welcome must come back over the relay or WebRTC
      const t0 = performance.now();
      await new Promise((res, rej) => {
        const chk = () => {
          if (s.client.status === 'playing') return res();
          if (s.client.status === 'refused') return rej(new Error(s.client.refused === 'version' ? 'The host is on a different version. One of you should refresh the page.' : 'The game is full.'));
          if (performance.now() - t0 > 10000) return rej(new Error('The host did not answer.'));
          setTimeout(chk, 50);
        };
        chk();
      });
      setMenuMsg('');
      history.replaceState(null, '', '#' + r.room);
      enterGame();
    } catch (e) {
      if (link) link.close();
      S = null;
      if (e.why === 'idle' && !noClaim) return playFixed(code);
      setMenuMsg(e.message || String(e));
    }
  }

  function leave(msg) {
    if (!S) return;
    const s = S; S = null;
    if (s.infoT) clearInterval(s.infoT);
    if (s.link) s.link.close();
    if (s.host) s.host.stop();
    document.exitPointerLock && document.exitPointerLock();
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    $('hud').hidden = true; $('touch').hidden = true; $('over').hidden = true; $('scores').hidden = true; $('bigmap').hidden = true;
    $('menu').hidden = false;
    history.replaceState(null, '', location.pathname + location.search);
    setMenuMsg(msg || '');
    if (Audio.ctx) Audio.update(false, 0, 0);
    refreshRooms();
  }

  function enterGame() {
    $('menu').hidden = true;
    $('hud').hidden = false;
    $('touch').hidden = !isTouch;
    resetView();
    if (!isTouch) lockPointer();
  }

  // ---------- menu ----------
  function setMenuMsg(t) { $('menuMsg').textContent = t; }
  $('name').value = prefs.name;
  $('name').addEventListener('input', () => { prefs.name = JF.cleanName($('name').value); savePrefs(); });
  const needName = () => {
    if (!$('name').value.trim()) { $('name').focus(); setMenuMsg('Pick a name first.'); return false; }
    prefs.name = JF.cleanName($('name').value); savePrefs(); return true;
  };
  $('playBots').onclick = () => { if (needName()) playBots(); };
  $('joinBtn').onclick = () => { if (needName()) join($('code').value); };
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter' && needName()) join($('code').value); });
  for (const sel of ['hMap', 'gMap']) for (const k of JF.MAP_KEYS) { const o = document.createElement('option'); o.value = k; o.textContent = JF.MAPS[k].name + ' - ' + JF.MAPS[k].blurb; $(sel).appendChild(o); }
  $('hostBtn').onclick = () => {
    if (!needName()) return;
    const h = prefs.host;
    $('hName').value = h.name || (prefs.name + "'s game");
    $('hMap').value = h.map || 'highland';
    $('hBots').value = String(h.bots != null ? h.bots : 3);
    $('hSkill').value = String(h.skill != null ? h.skill : 0.5);
    $('hCaps').value = String(h.caps || 5);
    $('hMins').value = String(h.minutes || 20);
    $('hPublic').checked = h.public !== false;
    $('hostDlg').showModal();
  };
  $('hCancel').onclick = () => $('hostDlg').close();
  $('hGo').onclick = () => {
    const opts = { name: JF.cleanName($('hName').value), map: $('hMap').value, bots: +$('hBots').value, skill: +$('hSkill').value, caps: +$('hCaps').value, minutes: +$('hMins').value, public: $('hPublic').checked };
    prefs.host = Object.assign({}, prefs.host, opts); savePrefs();
    $('hostDlg').close();
    hostOnline(opts);
  };

  let roomsBusy = false;
  // The server list is the front page: it fills in on its own every few seconds while the menu is showing.
  let roomsShown = false;
  async function refreshRooms() {
    if (roomsBusy) return;
    roomsBusy = true;
    const box = $('rooms');
    if (!roomsShown) box.innerHTML = '<span class="dim">Looking…</span>';
    let link;
    try {
      link = Link.connect();
      const all = (await link.list()).filter(r => r && r.info && typeof r.info === 'object' && typeof r.room === 'string');
      for (const r of all) if (r.fixed === true) fixedSlots.set(r.room, { name: String(r.name || r.room), info: r.info });
      const idle = r => r.fixed === true && r.info.idle === true;
      const rooms = all.filter(r => idle(r) || r.info.v === Net.PROTO);
      const people = r => (idle(r) ? 0 : Number.isInteger(r.info.n) && r.info.n > 0 ? Math.min(r.info.n, 64) : (r.n | 0) + 1);
      rooms.sort((a, b) => people(b) - people(a) || (b.fixed === true) - (a.fixed === true));
      box.innerHTML = '';
      roomsShown = true;
      const live = rooms.filter(r => !idle(r)).length;
      $('roomsNote').textContent = live ? live + ' with people' : '';
      if (!rooms.length) box.innerHTML = '<span class="dim">No servers up right now. Start one: your browser runs it and bots play until people join. Or practice offline.</span>';
      for (const r of rooms) {
        const div = document.createElement('div'); div.className = 'room';
        const map = JF.has(JF.MAPS, r.info.map) ? JF.MAPS[r.info.map].name : '?';
        const n = people(r), bots = Number.isInteger(r.info.bots) ? Math.max(0, Math.min(r.info.bots, 64)) : 0;
        const sc = Array.isArray(r.info.score) ? (r.info.score[0] | 0) + ':' + (r.info.score[1] | 0) : '';
        const cell = (cls, text) => { const c = document.createElement('span'); c.className = cls; c.textContent = text; return c; };
        const btn = document.createElement('button'); btn.textContent = idle(r) ? 'Play' : 'Join'; btn.className = 'primary';
        div.append(cell('nm', String(r.name || 'server').slice(0, 24)), cell('mp', map + (sc && !idle(r) ? ' ' + sc : '')), cell('pl', idle(r) ? (bots ? bots + ' bots a side' : 'empty') : n + (bots ? ' + ' + bots + ' bots' : '')), btn);
        div.onclick = () => { if (!needName()) return; if (idle(r)) playFixed(r.room); else join(r.room); };
        box.appendChild(div);
      }
    } catch (e) {
      roomsShown = false;
      box.innerHTML = '<span class="dim">Could not reach the server list. You can still practice offline.</span>';
    } finally { if (link) link.close(); roomsBusy = false; }
  }
  setInterval(() => { if (!S && !$('menu').hidden && document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) refreshRooms(); }, 5000);
  $('refresh').onclick = refreshRooms;

  // ---------- dialogs ----------
  const anyDialog = () => !!document.querySelector('dialog[open]') || !$('chatbox').hidden;
  function openDlg(id) { document.exitPointerLock && document.exitPointerLock(); for (const d of document.querySelectorAll('dialog[open]')) if (d.id !== id) d.close(); $(id).showModal(); }
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', () => { if (S && !anyDialog() && !isTouch) setTimeout(() => { if (S && !anyDialog()) lockPointer(); }, 0); });

  // help
  $('wHelp').innerHTML = JF.WEAPON_KEYS.map(k => '<div class="wh"><b>' + WEAPONS[k].name + '</b>: ' + WEAPONS[k].blurb + '</div>').join('') +
    '<div class="wh"><b>Hand grenade</b> (G): bounces, blows up after two seconds.</div>';
  $('helpBtn').onclick = () => openDlg('helpDlg');
  $('helpDone').onclick = () => $('helpDlg').close();

  // settings
  function fillSettings() {
    $('sSens').value = prefs.sens; $('sInvert').checked = prefs.invert; $('sFov').value = prefs.fov; $('sFovN').textContent = prefs.fov + '°';
    $('sQual').value = prefs.quality; $('sVol').value = Audio.settings.volume; $('sSfx').checked = Audio.settings.sfx; $('sFps').checked = prefs.fps; $('sSkiHold').checked = prefs.skiHold; $('sSpeak').checked = prefs.speak;
  }
  $('settingsBtn').onclick = () => { fillSettings(); openDlg('setDlg'); };
  const readSettings = () => {
    prefs.sens = +$('sSens').value; prefs.invert = $('sInvert').checked; prefs.fov = +$('sFov').value; $('sFovN').textContent = prefs.fov + '°';
    prefs.quality = $('sQual').value; prefs.fps = $('sFps').checked; prefs.skiHold = $('sSkiHold').checked; prefs.speak = $('sSpeak').checked;
    Audio.set({ volume: +$('sVol').value, sfx: $('sSfx').checked });
    applyQuality(); savePrefs();
  };
  for (const id of ['sSens', 'sInvert', 'sFov', 'sQual', 'sVol', 'sSfx', 'sFps', 'sSkiHold', 'sSpeak']) $(id).addEventListener('input', readSettings);
  $('sDone').onclick = () => $('setDlg').close();

  // loadout
  function fillLoadout() {
    const L = prefs.loadout, A = ARMORS[L.armor];
    const opt = (title, sub, on, off, fn) => {
      const d = document.createElement('div'); d.className = 'opt' + (on ? ' on' : '') + (off ? ' off' : '');
      d.innerHTML = '<b></b><span></span>'; d.querySelector('b').textContent = title; d.querySelector('span').textContent = sub;
      if (!off) d.onclick = fn;
      return d;
    };
    $('armors').innerHTML = '';
    for (const k of JF.ARMOR_KEYS) {
      const a = ARMORS[k];
      $('armors').appendChild(opt(a.name, a.hp + ' health · ' + a.slots + ' weapons · run ' + a.run + ' m/s' + (JF.NOT_FOR[k].length ? ' · no ' + JF.NOT_FOR[k].map(w => WEAPONS[w].name.toLowerCase()).join(', ') : ''), L.armor === k, false, () => {
        L.armor = k; prefs.loadout = JF.cleanLoadout(L); fillLoadout(); sendLoadout();
      }));
    }
    $('slots').textContent = L.weapons.length + ' of ' + A.slots;
    $('wlist').innerHTML = '';
    for (const k of JF.WEAPON_KEYS) {
      const banned = JF.NOT_FOR[L.armor].includes(k);
      const on = L.weapons.includes(k);
      $('wlist').appendChild(opt(WEAPONS[k].name, banned ? 'not for ' + A.name.toLowerCase() + ' armor' : WEAPONS[k].blurb, on, banned, () => {
        if (on) L.weapons = L.weapons.filter(w => w !== k);
        else { if (L.weapons.length >= A.slots) L.weapons.shift(); L.weapons.push(k); }
        prefs.loadout = JF.cleanLoadout(L); fillLoadout(); sendLoadout();
      }));
    }
    $('packs').innerHTML = '';
    for (const k of JF.PACK_KEYS) {
      $('packs').appendChild(opt(PACKS[k].name, PACKS[k].blurb, L.pack === k, false, () => { L.pack = k; prefs.loadout = JF.cleanLoadout(L); fillLoadout(); sendLoadout(); }));
    }
  }
  function sendLoadout() { savePrefs(); if (S) S.client.ctrl({ t: 'loadout', loadout: prefs.loadout }); }
  $('lDone').onclick = () => $('loadDlg').close();

  // pause
  function openPause() {
    if (!S) return;
    closeVgs();
    $('pRoom').textContent = S.room ? 'game ' + S.room : 'practice';
    $('pInvite').hidden = !S.room;
    if (S.room) { $('pCode').textContent = S.room; $('pLink').value = location.origin + location.pathname + '#' + S.room; }
    $('pHostSet').hidden = !S.isHost;
    openDlg('pauseDlg');
  }
  $('pResume').onclick = () => $('pauseDlg').close();
  $('pLoadout').onclick = () => { fillLoadout(); openDlg('loadDlg'); };
  $('pTeam').onclick = () => { const me = myView(); if (me) S.client.ctrl({ t: 'team', team: 1 - me.team }); $('pauseDlg').close(); };
  $('pSettings').onclick = () => { fillSettings(); openDlg('setDlg'); };
  $('pHelp').onclick = () => openDlg('helpDlg');
  $('pLeave').onclick = () => leave('');
  $('pCopy').onclick = async () => { try { await navigator.clipboard.writeText($('pLink').value); $('pCopy').textContent = 'Copied'; setTimeout(() => ($('pCopy').textContent = 'Copy'), 1500); } catch (e) { $('pLink').select(); } };
  $('tmenu').onclick = openPause;
  // host settings
  $('pHostSet').onclick = () => {
    const st = S.host.state.settings;
    $('gMap').value = st.map; $('gBots').value = String(st.bots); $('gSkill').value = String(st.skill); $('gCaps').value = String(st.caps); $('gMins').value = String(st.minutes);
    const box = $('gPlayers'); box.innerHTML = '';
    for (const p of S.host.state.players) {
      if (p.bot) continue;
      const d = document.createElement('div'); d.className = 'pl';
      const nm = document.createElement('span'); nm.textContent = p.name + ' (' + TEAMS[p.team].name + ')'; nm.style.color = TEAMS[p.team].color;
      d.appendChild(nm);
      if (p.peer > 0) { const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Remove'; b.onclick = () => { S.client.ctrl({ t: 'host', cmd: 'kick', pid: p.id }); d.remove(); }; d.appendChild(b); }
      box.appendChild(d);
    }
    openDlg('hostSetDlg');
  };
  const hostSettingsFromDlg = () => ({ map: $('gMap').value, bots: +$('gBots').value, skill: +$('gSkill').value, caps: +$('gCaps').value, minutes: +$('gMins').value });
  $('gApply').onclick = () => { S.client.ctrl({ t: 'host', cmd: 'settings', settings: hostSettingsFromDlg(), restart: false }); $('hostSetDlg').close(); };
  $('gRestart').onclick = () => { S.client.ctrl({ t: 'host', cmd: 'settings', settings: hostSettingsFromDlg(), restart: true }); S.client.ctrl({ t: 'host', cmd: 'restart' }); $('hostSetDlg').close(); };
  $('gCancel').onclick = () => $('hostSetDlg').close();

  // ---------- input ----------
  const keys = {};
  const mouse = { l: false, r: false };
  const touch = { fire: false, jet: false, ski: false, mx: 0, mz: 0 };
  let yaw = 0, pitch = 0, wantW = 255, jumpPulse = false;
  let thirdPerson = prefs.third;
  let tabDown = false, mapDown = false;

  function lockPointer() {
    const c = $('view');
    if (document.pointerLockElement !== c && c.requestPointerLock) { try { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* needs a click */ } }
  }
  $('view').addEventListener('mousedown', e => {
    Audio.start();
    if (!S) return;
    if (document.pointerLockElement !== $('view')) { lockPointer(); return; }
    if (e.button === 0) mouse.l = true;
    if (e.button === 2) mouse.r = true;
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
  addEventListener('contextmenu', e => { if (S) e.preventDefault(); });
  addEventListener('mousemove', e => {
    if (!S || document.pointerLockElement !== $('view')) return;
    const k = 0.0022 * prefs.sens;
    yaw -= e.movementX * k;
    pitch -= e.movementY * k * (prefs.invert ? -1 : 1);
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
  });
  document.addEventListener('pointerlockchange', () => {
    if (S && document.pointerLockElement !== $('view') && !anyDialog() && !isTouch) { mouse.l = mouse.r = false; openPause(); }
  });
  addEventListener('wheel', e => { if (!S || anyDialog()) return; cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });

  function cycleWeapon(d) {
    const me = S && S.client.me; if (!me || !me.weapons.length) return;
    const cur = wantW !== 255 && wantW < me.weapons.length ? wantW : me.wi;
    wantW = (cur + d + me.weapons.length) % me.weapons.length;
    Audio.play('switch');
  }
  let lastW = 0;
  addEventListener('keydown', e => {
    if (!S) return;
    if (!$('chatbox').hidden) return; // typing
    if (document.querySelector('dialog[open]')) { if (e.code === 'KeyI' && $('loadDlg').open) $('loadDlg').close(); return; }
    if (e.code === 'Tab') { e.preventDefault(); tabDown = true; }
    if (e.repeat) { keys[e.code] = true; return; }
    keys[e.code] = true;
    if (e.code === 'Space') { e.preventDefault(); jumpPulse = true; }
    if (vgsOpen() && e.code !== 'KeyV') { vgsKey(e); return; }
    if (/^Digit[1-5]$/.test(e.code)) { const i = +e.code.slice(5) - 1; const me = S.client.me; if (me && i < me.weapons.length) { lastW = me.wi; wantW = i; Audio.play('switch'); } }
    if (e.code === 'KeyQ') { const me = S.client.me; if (me) { const t = lastW; lastW = me.wi; wantW = t; } }
    if (vgsOpen()) { vgsKey(e); return; }
    if (e.code === 'KeyF') { thirdPerson = !thirdPerson; prefs.third = thirdPerson; savePrefs(); }
    if (e.code === 'KeyV') { openVgs(); return; }
    if (e.code === 'KeyI') { fillLoadout(); openDlg('loadDlg'); }
    if (e.code === 'KeyT' || e.code === 'KeyY' || e.code === 'Enter') { e.preventDefault(); openChat(e.code === 'KeyY'); }
    if (e.code === 'KeyK') S.client.ctrl({ t: 'kill' });
    if (e.code === 'KeyM') mapDown = true;
  });
  addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') tabDown = false; if (e.code === 'KeyM') mapDown = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; tabDown = mapDown = false; });

  // chat
  let chatTeam = false;
  function openChat(team) {
    chatTeam = team;
    $('chatto').textContent = team ? 'team:' : 'say:';
    $('chatbox').hidden = false;
    document.exitPointerLock && document.exitPointerLock();
    for (const k in keys) keys[k] = false;
    setTimeout(() => $('chatin').focus(), 0);
  }
  $('chatin').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { const t = $('chatin').value.trim(); if (t && S) S.client.ctrl({ t: 'chat', text: t, team: chatTeam }); closeChat(); }
    if (e.key === 'Escape') closeChat();
  });
  function closeChat() { $('chatin').value = ''; $('chatbox').hidden = true; if (S && !isTouch) lockPointer(); }

  // touch: left stick moves, a drag elsewhere looks
  if (isTouch) {
    const stick = $('stick'), knob = stick.querySelector('i');
    let sid = null, sx = 0, sy = 0;
    stick.addEventListener('touchstart', e => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; e.preventDefault(); Audio.start(); }, { passive: false });
    stick.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) if (t.identifier === sid) {
        let dx = (t.clientX - sx) / 50, dy = (t.clientY - sy) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        touch.mx = dx; touch.mz = -dy; knob.style.transform = 'translate(' + dx * 40 + 'px,' + dy * 40 + 'px)';
      }
      e.preventDefault();
    }, { passive: false });
    const endStick = e => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; touch.mx = touch.mz = 0; knob.style.transform = ''; } };
    stick.addEventListener('touchend', endStick); stick.addEventListener('touchcancel', endStick);
    let lid = null, lx = 0, ly = 0;
    $('view').addEventListener('touchstart', e => { const t = e.changedTouches[0]; if (lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } Audio.start(); e.preventDefault(); }, { passive: false });
    $('view').addEventListener('touchmove', e => {
      for (const t of e.changedTouches) if (t.identifier === lid) {
        const k = 0.006 * prefs.sens; yaw -= (t.clientX - lx) * k; pitch -= (t.clientY - ly) * k * (prefs.invert ? -1 : 1); pitch = Math.max(-1.5, Math.min(1.5, pitch)); lx = t.clientX; ly = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const endLook = e => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; };
    $('view').addEventListener('touchend', endLook); $('view').addEventListener('touchcancel', endLook);
    for (const b of document.querySelectorAll('#tbtns button')) {
      const k = b.dataset.b;
      const down = e => {
        e.preventDefault(); b.classList.add('down'); Audio.start();
        if (k === 'fire' || k === 'jet' || k === 'ski') touch[k] = true;
        if (k === 'next') cycleWeapon(1);
        if (k === 'say') { if (vgsOpen()) closeVgs(); else openVgs(); }
        if (k === 'gren') keys.KeyG = true;
        if (k === 'pack') keys.KeyR = true;
        if (k === 'ski') jumpPulse = true;
        // a drag that starts on fire or jet also looks around
        if ((k === 'fire' || k === 'jet') && lid === null) { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; }
      };
      const up = e => {
        e.preventDefault(); b.classList.remove('down');
        if (k === 'fire' || k === 'jet' || k === 'ski') touch[k] = false;
        if (k === 'gren') keys.KeyG = false;
        if (k === 'pack') keys.KeyR = false;
        for (const t of e.changedTouches) if (t.identifier === lid) lid = null;
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchmove', e => {
        for (const t of e.changedTouches) if (t.identifier === lid) { const kk = 0.006 * prefs.sens; yaw -= (t.clientX - lx) * kk; pitch -= (t.clientY - ly) * kk; pitch = Math.max(-1.5, Math.min(1.5, pitch)); lx = t.clientX; ly = t.clientY; }
        e.preventDefault();
      }, { passive: false });
      b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    }
  }

  function controls() {
    const c = { b: 0, mx: 0, mz: 0, yaw, pitch, w: wantW, redundancy: S && S.link && !S.isHost && !S.link.direct(0) ? 6 : 4, sendEvery: S && S.link && !S.isHost && !S.link.direct(0) ? 2 : 1 };
    if (anyDialog()) { c.b = 0; return c; }
    if (mouse.l || touch.fire) c.b |= B.FIRE;
    if (mouse.r || keys.KeyE || touch.jet) c.b |= B.JET;
    const skiKey = prefs.skiHold ? keys.Space : (keys.ShiftLeft || keys.ShiftRight);
    if (skiKey || touch.ski || jumpPulse) c.b |= B.JUMP;
    if (keys.KeyR) c.b |= B.PACK;
    if (keys.KeyG) c.b |= B.GREN;
    c.mz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touch.mz;
    c.mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touch.mx;
    return c;
  }

  // ---------- effects ----------
  const parts = new R.Batch(4096), beams = new R.Batch(512);
  let fx = [];         // particles: { p:[x,y,z], v:[..], life, max, s0, s1, c:[r,g,b], a, kind, blend, drag, g, rot, vr, seed }
  let fxBeams = [];    // { a, b, w, c, life, max }
  let fxLights = [];   // { x,y,z, r, c, life, max }
  let debris = [];     // boxes flying: { p, v, rot, vr, s, c, life }
  let localProj = [];  // my own shots, flying ahead of the host's copy
  let shake = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function puff(x, y, z, o) {
    if (fx.length > 3500) fx.splice(0, 300);
    fx.push({ p: [x, y, z], v: o.v || [0, 0, 0], life: o.life, max: o.life, s0: o.s0, s1: o.s1 == null ? o.s0 : o.s1, c: o.c, a: o.a == null ? 1 : o.a,
      kind: o.kind || 0, blend: o.blend || 0, drag: o.drag || 0, g: o.g || 0, rot: Math.random() * 6.28, vr: o.vr || 0, seed: Math.random() * 10 });
  }
  function light(x, y, z, r, c, life) { fxLights.push({ x, y, z, r, c, life, max: life }); }

  const BOOM_STYLE = {
    disc:   { r: 7.5, fire: [0.6, 0.8, 1.6], core: [2.5, 2.8, 3.2], smoke: 0.45, n: 14, light: [1.2, 1.5, 2.5], sound: 'boom' },
    gl:     { r: 8, fire: [2.2, 1.0, 0.3], core: [3, 2, 1], smoke: 0.35, n: 16, light: [2.5, 1.4, 0.5], sound: 'boom' },
    hgren:  { r: 9, fire: [2.2, 1.0, 0.3], core: [3, 2, 1], smoke: 0.35, n: 16, light: [2.5, 1.4, 0.5], sound: 'boom' },
    mortar: { r: 18, fire: [2.5, 1.4, 0.4], core: [3, 2.5, 1.5], smoke: 0.3, n: 30, light: [3, 2, 0.8], sound: 'boom' },
    plasma: { r: 3.5, fire: [2.5, 0.9, 0.2], core: [3, 1.8, 0.6], smoke: 0.5, n: 8, light: [2.5, 1.0, 0.3], sound: 'small' },
    tbolt:  { r: 3.5, fire: [2.5, 0.9, 0.2], core: [3, 1.8, 0.6], smoke: 0.5, n: 8, light: [2.5, 1.0, 0.3], sound: 'small' },
    blaster:{ r: 1.2, fire: [2.5, 0.5, 0.3], core: [3, 1, 0.8], smoke: 0, n: 0, light: [2, 0.4, 0.2], sound: 'spark' },
    chain:  { r: 0.6, fire: [2, 1.6, 0.8], core: [2, 1.8, 1], smoke: 0, n: 0, light: null, sound: 'spark' },
  };
  function explosion(x, y, z, kind, dud) {
    const st = BOOM_STYLE[kind] || BOOM_STYLE.disc;
    const g = client() && client().world ? client().world.terrain.height(x, z) : -1e9;
    const onGround = y - g < 2;
    const dust = client() && client().world ? client().world.def.look.mid : [0.5, 0.45, 0.4];
    if (dud) { puff(x, y, z, { life: 0.6, s0: 1, s1: 3, c: [0.5, 0.5, 0.5], kind: 1, blend: 1, a: 0.6 }); return; }
    const R0 = st.r;
    if (kind === 'chain') {
      puff(x, y, z, { life: 0.12, s0: 0.5, s1: 0.2, c: st.core });
      for (let i = 0; i < 3; i++) puff(x, y, z, { life: 0.3, s0: 0.08, s1: 0.02, c: [3, 2, 1], v: [rnd(-6, 6), rnd(2, 8), rnd(-6, 6)], g: 20, kind: 2 });
      if (onGround) puff(x, y, z, { life: 0.6, s0: 0.3, s1: 1.2, c: dust, kind: 1, blend: 1, a: 0.5, v: [0, 1, 0] });
      return;
    }
    puff(x, y, z, { life: 0.12, s0: R0 * 0.6, s1: R0 * 1.4, c: st.core, a: 1 });
    for (let i = 0; i < st.n; i++) {
      const d = [rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)];
      const sp = rnd(2, 6) * R0 / 6;
      puff(x, y, z, { life: rnd(0.25, 0.5), s0: R0 * rnd(0.25, 0.45), s1: R0 * rnd(0.5, 0.8), c: st.fire, v: [d[0] * sp, d[1] * sp, d[2] * sp], drag: 3 });
    }
    for (let i = 0; i < st.n * 0.8; i++) {
      const d = [rnd(-1, 1), rnd(0, 1), rnd(-1, 1)];
      puff(x, y, z, { life: rnd(0.5, 1.2), s0: 0.1, s1: 0.03, c: [3, 2.2, 1.2], v: [d[0] * rnd(8, 25), d[1] * rnd(8, 25), d[2] * rnd(8, 25)], g: 18, kind: 2, drag: 0.5 });
    }
    if (st.smoke) for (let i = 0; i < st.n * 0.7; i++) {
      puff(x + rnd(-1, 1) * R0 * 0.3, y + rnd(0, 1) * R0 * 0.2, z + rnd(-1, 1) * R0 * 0.3, { life: rnd(1.5, 3.2), s0: R0 * 0.3, s1: R0 * rnd(0.7, 1.1), c: [st.smoke, st.smoke * 0.95, st.smoke * 0.9], kind: 1, blend: 1, a: 0.7, v: [rnd(-1, 1), rnd(1, 3), rnd(-1, 1)], drag: 0.8, vr: rnd(-0.5, 0.5) });
    }
    if (onGround && st.smoke) for (let i = 0; i < 6; i++) puff(x, y, z, { life: rnd(1, 2), s0: R0 * 0.3, s1: R0 * 0.9, c: dust, kind: 1, blend: 1, a: 0.6, v: [rnd(-8, 8), rnd(1, 4), rnd(-8, 8)], drag: 2 });
    if (st.light) light(x, y + 1, z, R0 * 4, st.light, 0.35);
    const cam = camPos;
    if (cam) { const d = Math.hypot(cam[0] - x, cam[1] - y, cam[2] - z); shake = Math.max(shake, Math.min(1, R0 * 2 / (d + 5)) * 0.8); }
  }

  function tracer(from, to, col, w, life) { fxBeams.push({ a: from, b: to, w: w || 0.06, c: col, life: life || 0.06, max: life || 0.06 }); }

  // spark burst and bits of armor when someone dies
  function deathBurst(x, y, z, team) {
    const c = TEAMS[team].rgb;
    for (let i = 0; i < 8; i++) debris.push({ p: [x, y + 1, z], v: [rnd(-6, 6), rnd(4, 12), rnd(-6, 6)], rot: [Math.random() * 6, Math.random() * 6], vr: [rnd(-8, 8), rnd(-8, 8)], s: [rnd(0.15, 0.4), rnd(0.15, 0.4), rnd(0.15, 0.4)], c: i % 2 ? c : [0.2, 0.2, 0.22], life: rnd(2, 4) });
    explosion(x, y + 1, z, 'plasma');
  }

  function stepFx(dt) {
    for (const f of fx) {
      f.life -= dt;
      const k = Math.max(0, 1 - f.drag * dt);
      f.v[0] *= k; f.v[1] = f.v[1] * k - f.g * dt; f.v[2] *= k;
      f.p[0] += f.v[0] * dt; f.p[1] += f.v[1] * dt; f.p[2] += f.v[2] * dt;
      f.rot += f.vr * dt;
    }
    fx = fx.filter(f => f.life > 0);
    for (const b of fxBeams) b.life -= dt;
    fxBeams = fxBeams.filter(b => b.life > 0);
    for (const l of fxLights) l.life -= dt;
    fxLights = fxLights.filter(l => l.life > 0);
    const w = client() && client().world;
    for (const d of debris) {
      d.life -= dt; d.v[1] -= 20 * dt;
      d.p[0] += d.v[0] * dt; d.p[1] += d.v[1] * dt; d.p[2] += d.v[2] * dt;
      d.rot[0] += d.vr[0] * dt; d.rot[1] += d.vr[1] * dt;
      if (w) { const g = w.terrain.height(d.p[0], d.p[2]); if (d.p[1] < g + d.s[1] / 2) { d.p[1] = g + d.s[1] / 2; d.v[1] = Math.abs(d.v[1]) * 0.3; d.v[0] *= 0.6; d.v[2] *= 0.6; d.vr[0] *= 0.5; d.vr[1] *= 0.5; } }
    }
    debris = debris.filter(d => d.life > 0);
  }

  // my own shots: fly them here so they leave the gun the moment I click
  function stepLocalProj(dt) {
    const w = client() && client().world;
    if (!w) return;
    const keep = [];
    for (const q of localProj) {
      const W = JF.PROJ[q.kind];
      q.age += dt;
      if (W.grav) q.vel[1] -= JF.GRAV * dt;
      const to = [q.pos[0] + q.vel[0] * dt, q.pos[1] + q.vel[1] * dt, q.pos[2] + q.vel[2] * dt];
      const hit = w.traceProj({ pos: q.pos, kind: q.kind, owner: -99, age: 9 }, to, -1);
      if (hit) {
        if (W.bounce) {
          const n = w.surfaceNormal(hit);
          const vn = q.vel[0] * n[0] + q.vel[1] * n[1] + q.vel[2] * n[2];
          q.vel = [(q.vel[0] - 2 * vn * n[0]) * W.bounce, (q.vel[1] - 2 * vn * n[1]) * W.bounce, (q.vel[2] - 2 * vn * n[2]) * W.bounce];
          q.pos = [hit.pos[0] + n[0] * 0.08, hit.pos[1] + n[1] * 0.08, hit.pos[2] + n[2] * 0.08];
        } else if (q.kind !== 'chain') {
          q.done = true; recentLocalBooms.push({ pos: hit.pos, t: now(), kind: q.kind });
          explosion(hit.pos[0], hit.pos[1], hit.pos[2], q.kind, W.arm && q.age < W.arm);
          Audio.play(BOOM_STYLE[q.kind] ? BOOM_STYLE[q.kind].sound : 'boom', hit.pos);
          continue;
        } else continue;
      } else q.pos = to;
      if (q.age >= W.life) {
        if (W.fuse || W.grav) { recentLocalBooms.push({ pos: q.pos, t: now(), kind: q.kind }); explosion(q.pos[0], q.pos[1], q.pos[2], q.kind); Audio.play('boom', q.pos); }
        continue;
      }
      keep.push(q);
    }
    localProj = keep;
  }
  let recentLocalBooms = [];
  const now = () => performance.now() / 1000;

  // ---------- view state ----------
  const client = () => S && S.client;
  let camPos = null;
  const anims = new Map();
  let feed = [], chat = [], centerMsg = { text: '', sub: '', until: 0, color: '' };
  let hitT = 0, hitKill = false, dmgDirs = [], hurtFlash = 0;
  let wasAlive = false, deathInfo = null;
  let mapCanvasFor = null;
  let lastFrame = performance.now(), fpsN = 0, fpsT = 0, fpsShow = 0;
  let recoil = 0, bob = 0, swayX = 0, swayY = 0, lastYaw = 0, lastPitch = 0, fireGlow = 0;
  let overShown = false;
  let debugCam = null; // set from the console or tests: { pos, yaw, pitch }

  function resetView() {
    fx = []; fxBeams = []; fxLights = []; debris = []; localProj = []; anims.clear(); feed = []; chat = [];
    wasAlive = false; deathInfo = null; overShown = false; wantW = 255; replay = null; replayWant = null;
    $('over').hidden = true;
  }
  function myView() {
    const c = client(); if (!c || !c.snaps.length) return null;
    const last = c.snaps[c.snaps.length - 1];
    return last.players.find(p => p.id === last.you) || null;
  }
  const nameOf = id => {
    const c = client(); if (!c) return '?';
    const r = c.roster.find(x => x.id === id);
    return r ? r.name : id < 0 ? 'turret' : '?';
  };
  const teamOf = id => { const c = client(); const r = c && c.roster.find(x => x.id === id); return r ? r.team : -1; };
  function addFeed(html) { feed.push({ html, t: now() }); if (feed.length > 6) feed.shift(); }
  function addChat(html) { chat.push({ html, t: now() }); if (chat.length > 8) chat.shift(); }
  function center(text, sub, color, secs) { centerMsg = { text, sub: sub || '', color: color || '#fff', until: now() + (secs || 3) }; }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const teamSpan = (id, name) => { const t = teamOf(id); return '<span style="color:' + (t >= 0 ? TEAMS[t].color : '#ccc') + '">' + esc(name) + '</span>'; };

  function handleEvents(view) {
    const c = client();
    const me = c.me;
    const myId = view ? view.you : -1;
    const myTeam = me ? me.team : 0;
    const pAt = id => { const p = view && view.players.find(x => x.id === id); return p ? [p.pos[0], p.pos[1] + 1.4, p.pos[2]] : null; };
    for (const e of c.takeEvents()) {
      switch (e.k) {
        case 'map':
          renderer.setMap(c.world); resetView(); mapCanvasFor = null;
          center(JF.MAPS[e.map].name, JF.MAPS[e.map].blurb, '#fff', 4);
          break;
        case 'fire': {
          if (e.id === myId && e.w !== 'hgren' && e.w !== 'laser') break; // shown when I fired it
          const p = view && view.players.find(x => x.id === e.id);
          if (!p) break;
          const eye = [p.pos[0], p.pos[1] + ARMORS[p.armor].h - 0.25, p.pos[2]];
          const f = JF.aimDir(p.yaw, p.pitch), rr = JF.rightDir(p.yaw);
          const mz = [eye[0] + f[0] * 1.1 + rr[0] * 0.35, eye[1] + f[1] * 1.1 - 0.25, eye[2] + f[2] * 1.1 + rr[2] * 0.35];
          if (e.w === 'chain') {
            const end = traceLocal(mz, f, 380);
            tracer(mz, end, [2.5, 2.0, 1.0], 0.05, 0.08);
          }
          if (e.w !== 'hgren') puff(mz[0], mz[1], mz[2], { life: 0.06, s0: 0.5, c: [3, 2, 1] });
          Audio.play(e.w === 'hgren' ? 'hgren' : e.w, eye);
          break;
        }
        case 'tfire': { const o = c.world.objects[e.id]; if (o) Audio.play('tfire', o.c); break; }
        case 'boom': {
          if (e.w === 'chain') { explosion(e.x, e.y, e.z, 'chain'); if (Math.random() < 0.3) Audio.play('spark', [e.x, e.y, e.z]); break; }
          if (e.o === myId && JF.WEAPONS[e.w]) {
            // my own shot: the local copy may already have gone off near here
            let near = -1, nd = 15;
            localProj.forEach((q, i) => { const d = Math.hypot(q.pos[0] - e.x, q.pos[1] - e.y, q.pos[2] - e.z); if (q.kind === e.w && d < nd) { nd = d; near = i; } });
            if (near >= 0) localProj.splice(near, 1);
            const t = now();
            const already = recentLocalBooms.some(b => b.kind === e.w && t - b.t < 1.5 && Math.hypot(b.pos[0] - e.x, b.pos[1] - e.y, b.pos[2] - e.z) < 8);
            if (already && e.what !== 'player') break;
          }
          explosion(e.x, e.y, e.z, e.w, e.dud);
          Audio.play(BOOM_STYLE[e.w] ? BOOM_STYLE[e.w].sound : 'boom', [e.x, e.y, e.z]);
          break;
        }
        case 'bounce': Audio.play('bounce', [e.x, e.y, e.z]); break;
        case 'laser': {
          tracer([e.x0, e.y0, e.z0], [e.x, e.y, e.z], [0.4, 3, 0.8], 0.12, 0.35);
          puff(e.x, e.y, e.z, { life: 0.2, s0: 0.8, c: [0.5, 3, 1] });
          Audio.play('laser', [e.x0, e.y0, e.z0]);
          break;
        }
        case 'hit': {
          hitFlash.set(e.id, now());
          const at = pAt(e.id);
          if (at && e.id !== myId) sparks(at, e.d);
          if (e.by === myId) { hitT = now(); hitKill = false; Audio.play('hit', null, 0, e.d); myPlayerHit.set(e.id, now()); }
          if (e.id === myId) {
            hurtFlash = Math.min(0.6, hurtFlash + e.d / 60);
            const from = pAt(e.by);
            if (from && me) dmgDirs.push({ ang: Math.atan2(from[0] - me.pos[0], from[2] - me.pos[2]), t: now() });
            Audio.play('hurt');
          }
          break;
        }
        case 'ohit': {
          const o = c.world.objects[e.id]; if (!o) break;
          objHit.set(e.id, now());
          sparks([o.c[0] + rnd(-0.6, 0.6), o.c[1] + rnd(-0.3, 0.6), o.c[2] + rnd(-0.6, 0.6)], e.d);
          if (e.by === myId) { hitT = now(); hitKill = false; Audio.play('hit'); myObjHit.set(e.id, now()); }
          break;
        }
        case 'shield': { const at = pAt(e.id); if (at) { Audio.play('shield', at); shieldFlash.set(e.id, now()); } break; }
        case 'kill': {
          const wname = e.w === 'fall' ? 'fell' : e.w === 'lava' ? 'burned in the lava' : e.w === 'tbolt' ? 'turret' : e.w === 'suicide' ? 'gave up' : e.w === 'team' ? 'switched team' : e.w === 'stuck' ? 'got stuck' : JF.has(JF.PROJ, e.w) ? JF.PROJ[e.w].name : e.w === 'laser-head' ? 'Laser Rifle (head)' : String(e.w);
          if (e.by >= 0) addFeed(teamSpan(e.by, nameOf(e.by)) + ' <span class="dim">[' + esc(wname) + ']</span> ' + teamSpan(e.id, nameOf(e.id)));
          else addFeed(teamSpan(e.id, nameOf(e.id)) + ' <span class="dim">' + esc(wname === 'turret' ? 'was shot by a turret' : wname) + '</span>');
          deathBurst(e.x, e.y, e.z, Math.max(0, teamOf(e.id)));
          if (e.by === myId && e.id !== myId) { hitT = now(); hitKill = true; Audio.play('kill'); center(e.mid ? 'Midair!' : '', 'You took out ' + nameOf(e.id), '#fff', 2); }
          if (e.id === myId) {
            deathInfo = { by: e.by, w: wname, at: [e.x, e.y, e.z], t: now() }; Audio.play('die');
            if (e.mid && e.by >= 0) replayWant = { tick: e.t, by: e.by, me: myId, at: [e.x, e.y, e.z], start: now() + 0.9 };
          }
          break;
        }
        case 'flag': {
          const ours = e.team === myTeam;
          const who = nameOf(e.id), tn = TEAMS[e.team].name;
          if (e.a === 'take') {
            if (e.id === myId) { center('You have the ' + tn + ' flag!', 'Take it home to your own flag', TEAMS[e.team].color, 4); Audio.play('flagTake'); }
            else if (ours) { center('Your flag was taken!', who + ' has it', TEAMS[1 - myTeam].color, 4); Audio.play('flagOurs'); }
            else { center(who + ' took the ' + tn + ' flag', '', TEAMS[myTeam].color, 3); Audio.play('flagTake'); }
            addFeed(teamSpan(e.id, who) + ' took the <span style="color:' + TEAMS[e.team].color + '">' + tn + '</span> flag');
          } else if (e.a === 'cap') {
            const mine = !ours;
            center(mine ? 'Captured!' : 'They captured your flag', who + ' scored for ' + TEAMS[1 - e.team].name, TEAMS[1 - e.team].color, 4);
            Audio.play(mine ? 'cap' : 'capLost');
            addFeed(teamSpan(e.id, who) + ' <b>captured</b> the ' + tn + ' flag');
          } else if (e.a === 'return') {
            if (ours) center('Your flag is back home', e.id >= 0 ? 'returned by ' + who : '', TEAMS[myTeam].color, 2.5);
            Audio.play('ret');
            addFeed('The <span style="color:' + TEAMS[e.team].color + '">' + tn + '</span> flag went home');
          } else if (e.a === 'drop') {
            if (!e.quiet) center(ours ? 'Your flag is on the ground' : 'The ' + tn + ' flag was dropped', ours ? 'touch it to send it home' : 'grab it', TEAMS[e.team].color, 2.5);
            Audio.play('drop');
          }
          break;
        }
        case 'obj': {
          const o = c.world.objects[e.id]; if (!o) break;
          const ours = o.team === myTeam, nm = JF.OBJ[o.kind].name;
          if (e.up) { addFeed('<span style="color:' + TEAMS[o.team].color + '">' + TEAMS[o.team].name + ' ' + nm.toLowerCase() + '</span> is working again'); if (o.kind === 'gen') { Audio.play('genup', o.c); if (ours) center('Generator fixed', 'stations and turrets have power', TEAMS[myTeam].color, 2.5); } }
          else {
            addFeed((e.by >= 0 ? teamSpan(e.by, nameOf(e.by)) + ' destroyed the ' : 'The ') + '<span style="color:' + TEAMS[o.team].color + '">' + TEAMS[o.team].name + ' ' + nm.toLowerCase() + '</span>');
            if (o.kind === 'gen') { Audio.play('gendown', o.c, 2000); if (ours) center('Your generator is down!', 'no stations or turrets until someone repairs it', '#ff6b6b', 4); else center('Their generator is down', '', TEAMS[myTeam].color, 2.5); }
            explosion(o.c[0], o.c[1], o.c[2], 'mortar');
          }
          break;
        }
        case 'station': if (e.id === myId) { Audio.play('station'); center('', 'Loadout on', '#5ee0b0', 1.5); } break;
        case 'spawn':
          if (e.id === myId) {
            const base = c.world.bases[myTeam];
            yaw = base ? (base.o.face > 0 ? -Math.PI / 2 : Math.PI / 2) : yaw; pitch = 0; deathInfo = null; wantW = 255; localProj = [];
            Audio.play('spawn');
          }
          break;
        case 'dry': if (e.id === myId) Audio.play('dry'); break;
        case 'join': addFeed(teamSpan(e.id, e.name) + ' <span class="dim">joined ' + TEAMS[e.team].name + '</span>'); break;
        case 'leave': addFeed('<span class="dim">' + esc(e.name) + ' left</span>'); break;
        case 'team': addFeed(teamSpan(e.id, nameOf(e.id)) + ' <span class="dim">switched to ' + TEAMS[e.team].name + '</span>'); break;
        case 'chat':
          addChat((e.team != null ? '<span class="dim">[team]</span> ' : '') + teamSpan(e.id, e.name) + ': ' + (e.vgs ? '<b>' + esc(e.text) + '</b>' : esc(e.text)));
          if (e.vgs && prefs.speak) { if (e.id !== myId) speak(e.text, e.id); } // mine was said when I picked it
          else Audio.play('chat');
          break;
        case 'over':
          Audio.play(e.winner === myTeam ? 'win' : e.winner < 0 ? 'ret' : 'lose');
          break;
      }
    }
  }
  const shieldFlash = new Map(), hitFlash = new Map(), objHit = new Map(), myObjHit = new Map(), myPlayerHit = new Map();

  // little bright bits flying off whatever got hit, more for a harder hit
  function sparks(at, dmg) {
    const n = Math.min(14, 3 + Math.round((dmg || 5) / 6));
    puff(at[0], at[1], at[2], { life: 0.12, s0: 0.5 + Math.min(1.5, (dmg || 5) / 30), s1: 0.2, c: [3, 2.4, 1.6] });
    for (let i = 0; i < n; i++) puff(at[0], at[1], at[2], { life: rnd(0.25, 0.5), s0: 0.08, s1: 0.02, c: [3, 2.2, 1.2], v: [rnd(-7, 7), rnd(1, 9), rnd(-7, 7)], g: 20, kind: 2 });
  }

  // quick chat read out loud, a different voice pitch for each player.
  // Chrome quirks: speak() right after cancel() is often dropped, an utterance nothing holds on to can be thrown away
  // before it plays, and the queue can get stuck paused. So: hold the utterance, resume, and speak a moment after a cancel.
  let voice = null, utter = null, speakT = 0;
  function pickVoice() {
    try {
      const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
      voice = vs.find(v => /^en[-_]US/i.test(v.lang) && v.localService) || vs.find(v => /^en/i.test(v.lang)) || null;
    } catch (e) { voice = null; }
  }
  if (window.speechSynthesis) { pickVoice(); try { speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch (e) { /* old browsers */ } }
  function speak(text, id) {
    try {
      if (!window.speechSynthesis || !Audio.settings.sfx) return;
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : 'en-US';
      u.pitch = 0.6 + ((id * 37) % 9) / 10; u.rate = 1.1; u.volume = Math.min(1, Audio.settings.volume * 1.6);
      utter = u;
      const go = () => { speechSynthesis.resume(); speechSynthesis.speak(u); };
      clearTimeout(speakT);
      if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); speakT = setTimeout(go, 60); } else go();
    } catch (e) { /* no voices: the text is in the chat anyway */ }
  }

  // ---------- quick chat menu (V) ----------
  let vgsPath = null; // null = closed, '' = top level, 'G' = in a group
  const vgsOpen = () => vgsPath !== null;
  function openVgs() { vgsPath = ''; drawVgs(); }
  function closeVgs() { vgsPath = null; $('vgs').hidden = true; }
  function drawVgs() {
    const T = window.JFVGS.TREE;
    let h = '';
    if (vgsPath === '') { h = '<b>Quick chat</b>'; for (const [k, g] of Object.entries(T)) h += '<div data-k="' + k + '"><i>' + k + '</i> ' + esc(g.name) + (g.team ? ' <span class="dim">team</span>' : '') + '</div>'; }
    else { const g = T[vgsPath]; h = '<b>' + esc(g.name) + '</b>'; for (const [k, t] of Object.entries(g.lines)) h += '<div data-k="' + k + '"><i>' + k + '</i> ' + esc(t) + '</div>'; }
    h += '<div class="dim" data-k="Escape"><i>esc</i> close</div>';
    $('vgs').innerHTML = h; $('vgs').hidden = false;
  }
  function vgsPick(k) {
    const T = window.JFVGS.TREE;
    if (k === 'Escape' || k === 'V' && vgsPath === '') return closeVgs();
    if (vgsPath === '') { if (JF.has(T, k)) { vgsPath = k; drawVgs(); } return; }
    if (JF.has(T[vgsPath].lines, k)) {
      // say it now, inside the key press: some browsers only let a page speak in answer to one
      if (S) { S.client.ctrl({ t: 'chat', vgs: vgsPath + k }); if (prefs.speak) speak(T[vgsPath].lines[k], S.client.me ? S.client.me.id : 0); }
      closeVgs();
    }
  }
  function vgsKey(e) {
    e.preventDefault();
    keys[e.code] = false;
    if (e.code === 'Escape' || e.code === 'Backspace') return closeVgs();
    const m = /^(?:Key|Digit)(\w)$/.exec(e.code);
    if (m) vgsPick(m[1]);
  }
  $('vgs').addEventListener('click', e => { const d = e.target.closest('[data-k]'); if (d) vgsPick(d.dataset.k); });

  // where a straight line from `from` along `dir` meets land or a wall, for tracers
  function traceLocal(from, dir, dist) {
    const w = client().world;
    const to = [from[0] + dir[0] * dist, from[1] + dir[1] * dist, from[2] + dir[2] * dist];
    const hit = w.traceProj({ pos: from, kind: 'chain', owner: -99, age: 9 }, to, -1);
    return hit ? hit.pos : to;
  }

  // ---------- replay of a midair disc that killed me ----------
  // The client keeps the last few seconds of snapshots and events. Shortly after the death they are played back,
  // the camera riding behind the disc and slowing down around the hit. Only a picture: nothing in the game changes.
  let replay = null, replayWant = null;
  function startReplay(c, k) {
    const snaps = c.hist.slice(), evs = c.histEv.slice();
    if (snaps.length < 10) return null;
    const first = snaps[0].tick, last = snaps[snaps.length - 1].tick;
    // the disc that did it: the killer's disc closest to me in the last snapshot before the kill that has one
    let disc = -1;
    for (let i = snaps.length - 1; i >= 0 && disc < 0; i--) {
      const sn = snaps[i];
      if (sn.tick >= k.tick) continue;
      if (sn.tick < k.tick - 120) break;
      const mine = sn.players.find(p => p.id === k.me);
      let best = 1e9;
      if (mine) for (const q of sn.proj) {
        if (q.owner !== k.by || q.kind !== 'disc') continue;
        const d = Math.hypot(q.pos[0] - mine.pos[0], q.pos[1] - mine.pos[1], q.pos[2] - mine.pos[2]);
        if (d < best) { best = d; disc = q.id; }
      }
    }
    let fired = k.tick - 60;
    if (disc >= 0) { const s0 = snaps.find(sn => sn.proj.some(q => q.id === disc)); if (s0) fired = s0.tick; }
    const t0 = Math.max(first, Math.min(fired - 40, k.tick - 60), k.tick - 200); // short enough to finish before the automatic respawn
    const t1 = Math.min(last, k.tick + 50);
    if (t1 - t0 < 30) return null;
    return { snaps, evs, k, disc, fired, t0, t1, tick: t0, cam: null, look: null };
  }
  // one replay frame: moves the replay clock and camera, sets off its explosions, returns the view to draw
  function replayFrame(c, dt) {
    if (replayWant && now() >= replayWant.start) { replay = startReplay(c, replayWant); replayWant = null; }
    if (!replay) return null;
    const r = replay, k = r.k, prev = r.tick;
    const slow = r.tick > k.tick - 20 && r.tick < k.tick + 14;
    r.tick += dt * 60 * (slow ? 0.25 : 1);
    if (r.tick >= r.t1) { replay = null; return null; }
    const v = c.viewAt(r.tick, r.snaps);
    if (!v) { replay = null; return null; }
    v.you = -1; // draw me as everyone else saw me
    for (const e of r.evs) {
      if (e.t <= prev || e.t > r.tick) continue;
      if (e.k === 'boom' && e.w !== 'chain') { explosion(e.x, e.y, e.z, e.w, e.dud); Audio.play(BOOM_STYLE[e.w] ? BOOM_STYLE[e.w].sound : 'boom', [e.x, e.y, e.z]); }
      else if (e.k === 'kill') deathBurst(e.x, e.y, e.z, Math.max(0, teamOf(e.id)));
    }
    // the camera: over the killer's shoulder, then behind the disc, then holding on the hit
    const victim = v.players.find(p => p.id === k.me && p.alive);
    const vp = victim ? [victim.pos[0], victim.pos[1] + 1.1, victim.pos[2]] : k.at;
    const killer = v.players.find(p => p.id === k.by && p.alive);
    const d = r.disc >= 0 ? v.proj.find(q => q.id === r.disc) : null;
    let want = null;
    if (d) {
      const l = Math.hypot(d.vel[0], d.vel[1], d.vel[2]) || 1;
      want = [d.pos[0] - d.vel[0] / l * 4, d.pos[1] - d.vel[1] / l * 4 + 0.8, d.pos[2] - d.vel[2] / l * 4];
    } else if (r.tick < r.fired && killer) {
      const dx = vp[0] - killer.pos[0], dz = vp[2] - killer.pos[2], l = Math.hypot(dx, dz) || 1;
      want = [killer.pos[0] - dx / l * 4 + dz / l * 1.2, killer.pos[1] + 2.8, killer.pos[2] - dz / l * 4 - dx / l * 1.2];
    } else if (!r.cam) {
      want = [vp[0] + 10, vp[1] + 4, vp[2] + 10];
    }
    if (!r.cam) { r.cam = (want || vp).slice(); r.look = vp.slice(); }
    const kp = 1 - Math.exp(-dt * (slow ? 3 : 8)), kl = 1 - Math.exp(-dt * 6);
    if (want) for (let i = 0; i < 3; i++) r.cam[i] += (want[i] - r.cam[i]) * kp;
    for (let i = 0; i < 3; i++) r.look[i] += (vp[i] - r.look[i]) * kl;
    const gh = c.world.terrain.height(r.cam[0], r.cam[2]) + 1;
    if (r.cam[1] < gh) r.cam[1] = gh;
    // something solid between the camera and what it watches: draw from in front of it instead
    let eye = r.cam;
    const block = c.world.traceProj({ pos: r.look, kind: 'chain', owner: -99, age: 9 }, r.cam, -1);
    if (block && block.what !== 'player') {
      const bx = r.look[0] - block.pos[0], by = r.look[1] - block.pos[1], bz = r.look[2] - block.pos[2], bl = Math.hypot(bx, by, bz) || 1;
      eye = [block.pos[0] + bx / bl * 0.6, block.pos[1] + by / bl * 0.6, block.pos[2] + bz / bl * 0.6];
    }
    r.eye = eye;
    const lx = r.look[0] - eye[0], ly = r.look[1] - eye[1], lz = r.look[2] - eye[2];
    r.yaw = Math.atan2(-lx, -lz); r.pitch = Math.atan2(ly, Math.hypot(lx, lz));
    return v;
  }

  // ---------- the frame ----------
  function frame() {
    requestAnimationFrame(frame);
    const t = performance.now();
    const dt = Math.min(0.1, (t - lastFrame) / 1000);
    lastFrame = t;
    if (!S || !renderer) { if (renderer && renderer.terrain && !S) idleScene(dt); return; }
    const c = S.client;
    const ctl = controls();
    jumpPulse = false;
    c.update(dt, ctl);
    if (!c.world || !renderer) return;
    if (renderer.mapKey !== c.world.mapKey || renderer.world !== c.world) { renderer.setMap(c.world); mapCanvasFor = null; }
    const view = c.view();
    handleEvents(view);
    for (const sh of c.takeShots()) {
      const W = JF.WEAPONS[sh.kind];
      const f = JF.aimDir(sh.yaw, sh.pitch), rr = JF.rightDir(sh.yaw);
      const mz = [sh.pos[0] + f[0] * 0.9 + rr[0] * 0.35, sh.pos[1] + f[1] * 0.9 - 0.25, sh.pos[2] + f[2] * 0.9 + rr[2] * 0.35];
      if (sh.kind === 'chain') { tracer(mz, traceLocal(mz, f, 380), [2.5, 2.0, 1.0], 0.05, 0.08); }
      else localProj.push({ kind: sh.kind, pos: mz, vel: [f[0] * W.speed + sh.vel[0] * W.inherit, f[1] * W.speed + sh.vel[1] * W.inherit, f[2] * W.speed + sh.vel[2] * W.inherit], age: 0 });
      recoil = Math.min(0.25, recoil + (sh.kind === 'chain' ? 0.03 : sh.kind === 'mortar' ? 0.22 : 0.12));
      fireGlow = 1;
      Audio.play(sh.kind);
    }
    recentLocalBooms = recentLocalBooms.filter(b => now() - b.t < 2);
    stepLocalProj(dt);
    stepFx(dt);
    if (!view) return;
    const me = c.me;
    const alive = !!(me && me.alive);
    if (alive && !wasAlive) { deathInfo = null; }
    if (alive) { replay = null; replayWant = null; }
    wasAlive = alive;
    const rv = replayFrame(c, dt);
    document.body.classList.toggle('replay', !!rv);
    buildScene(rv || view, dt);
    hud(view, dt);
    // sound listener
    if (camPos) { Audio.listener.pos = camPos; Audio.listener.yaw = yaw; }
    if (me && alive) Audio.update(me.jetting, Math.hypot(me.vel[0], me.vel[1], me.vel[2]), me.energy / ARMORS[me.armor].energy);
    else Audio.update(false, 0, 0);
    fpsN++; fpsT += dt; if (fpsT > 0.5) { fpsShow = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
    frameMs = frameMs * 0.95 + (performance.now() - t) * 0.05;
  }
  let frameMs = 0;

  // the menu shows the last map, slowly turning
  let idleYaw = 0;
  function idleScene(dt) {
    idleYaw += dt * 0.05;
    const w = renderer.world, b = w.bases[0].o;
    const d = 140, pos = [b.x + Math.sin(idleYaw) * d, w.terrain.padH + 50, b.z + Math.cos(idleYaw) * d];
    renderer.beginInstances();
    for (const o of w.objects) Models.object(renderer, o, null, performance.now() / 1000);
    for (const f of w.flags) Models.flag(renderer, f, performance.now() / 1000);
    renderer.frame({ cam: { pos, yaw: idleYaw, pitch: -0.25, fov: 1.3 }, time: performance.now() / 1000 });
  }

  function animFor(p, dt) {
    let a = anims.get(p.id);
    if (!a) { a = { phase: 0, last: p.pos.slice(), speed: 0 }; anims.set(p.id, a); }
    const d = Math.hypot(p.pos[0] - a.last[0], p.pos[2] - a.last[2]);
    a.speed = a.speed * 0.8 + (dt > 0 ? d / dt : 0) * 0.2;
    a.phase += d * 1.6;
    a.last = p.pos.slice();
    // a splash going into the water
    const wh = client().world.terrain.waterH;
    if (wh != null) {
      const under = p.pos[1] < wh;
      if (under && !a.under && a.seen) {
        for (let i = 0; i < 14; i++) puff(p.pos[0], wh + 0.2, p.pos[2], { life: rnd(0.5, 1), s0: 0.4, s1: 1.6, c: [0.85, 0.9, 0.95], kind: 1, blend: 1, a: 0.6, v: [rnd(-4, 4), rnd(4, 10), rnd(-4, 4)], g: 14, drag: 1 });
        Audio.play('splash', [p.pos[0], wh, p.pos[2]]);
      }
      if (under && a.speed > 3 && Math.random() < 0.3) puff(p.pos[0], wh + 0.1, p.pos[2], { life: 0.8, s0: 0.3, s1: 1.2, c: [0.8, 0.85, 0.9], kind: 1, blend: 1, a: 0.35, v: [0, 1, 0] });
      a.under = under;
    }
    a.seen = true;
    return a;
  }

  // weather around the camera: rain, snow, ash or dust, from the map's look
  let weatherPts = null;
  function weather(eye, dt, time) {
    const kind = client().world.def.weather;
    if (!kind || prefs.quality === 'low') return;
    const n = kind === 'rain' ? 500 : kind === 'snow' ? 450 : kind === 'ash' ? 300 : 120, R = 45;
    if (!weatherPts || weatherPts.kind !== kind) {
      weatherPts = { kind, p: [] };
      for (let i = 0; i < n; i++) weatherPts.p.push([eye[0] + rnd(-R, R), eye[1] + rnd(-R, R), eye[2] + rnd(-R, R), Math.random()]);
    }
    const fall = kind === 'rain' ? 26 : kind === 'snow' ? 2.2 : kind === 'ash' ? 1.4 : 0.4;
    for (const q of weatherPts.p) {
      q[1] -= fall * dt * (0.8 + q[3] * 0.4);
      q[0] += Math.sin(time * 0.5 + q[3] * 9) * dt * (kind === 'dust' ? 3 : 0.8) + (kind === 'dust' ? 4 * dt : 0);
      // keep the cloud of drops centred on the camera
      for (let k = 0; k < 3; k++) { if (q[k] < eye[k] - R) q[k] += 2 * R; else if (q[k] > eye[k] + R) q[k] -= 2 * R; }
      if (kind === 'rain') beams.beam(q[0], q[1], q[2], 0.012, q[0] + 0.3, q[1] + 1.2, q[2], 0.012, 0.35, 0.4, 0.45, 0.5);
      else if (kind === 'snow') parts.part(q[0], q[1], q[2], 0.07, 1.6, 1.65, 1.7, 0.8, 0);
      else if (kind === 'ash') parts.part(q[0], q[1], q[2], 0.06, q[3] < 0.15 ? 3 : 0.25, q[3] < 0.15 ? 0.9 : 0.22, q[3] < 0.15 ? 0.2 : 0.22, 0.7, 0);
      else parts.part(q[0], q[1], q[2], 1.2, 0.75, 0.6, 0.45, 0.06, 1, 0, q[3] * 9, 1);
    }
  }

  function buildScene(view, dt) {
    const c = client(), me = c.me, w = c.world;
    const time = performance.now() / 1000;
    const myId = view.you;
    const alive = !!(me && me.alive);
    renderer.beginInstances();
    parts.reset(); beams.reset();
    const lights = [];
    const glass = [];
    // camera
    let eye, camYaw = yaw, camPitch = pitch, firstPerson = alive && !thirdPerson;
    if (alive) {
      const mp = c.myPos();
      eye = [mp[0], mp[1] + ARMORS[me.armor].h - 0.25, mp[2]];
      if (!firstPerson) {
        const f = JF.aimDir(yaw, pitch);
        let back = 6;
        const want = [eye[0] - f[0] * back, eye[1] - f[1] * back + 1.2, eye[2] - f[2] * back];
        const hit = w.traceProj({ pos: [eye[0], eye[1] + 1.2, eye[2]], kind: 'chain', owner: -99, age: 9 }, want, -1);
        eye = hit ? [hit.pos[0] + f[0] * 0.4, hit.pos[1] + f[1] * 0.4, hit.pos[2] + f[2] * 0.4] : want;
      }
    } else {
      // dead: look at where it happened, from above
      const at = deathInfo ? deathInfo.at : (me ? me.pos : [w.bases[0].o.x, w.terrain.padH, w.bases[0].o.z]);
      const k = (deathInfo ? now() - deathInfo.t : 0) * 0.15;
      eye = [at[0] + Math.sin(yaw + k) * 14, at[1] + 7, at[2] + Math.cos(yaw + k) * 14];
      camYaw = yaw + k; camPitch = -0.4;
    }
    if (replay && replay.eye) { eye = replay.eye.slice(); camYaw = replay.yaw; camPitch = replay.pitch; firstPerson = false; }
    if (debugCam && debugCam.follow != null) {
      const fp = view.players.find(p => p.id === debugCam.follow);
      if (fp) { const f = JF.aimDir(fp.yaw + (debugCam.turn || 0), -0.15); const d = debugCam.dist || 5; eye = [fp.pos[0] - f[0] * d, fp.pos[1] + 2.2 - f[1] * d, fp.pos[2] - f[2] * d]; camYaw = fp.yaw + (debugCam.turn || 0); camPitch = -0.15; firstPerson = false; }
    } else if (debugCam) { eye = debugCam.pos; camYaw = debugCam.yaw; camPitch = debugCam.pitch; firstPerson = false; }
    // shake
    if (shake > 0.01) { camYaw += (Math.random() - 0.5) * shake * 0.04; camPitch += (Math.random() - 0.5) * shake * 0.04; shake *= Math.exp(-dt * 6); }
    camPos = eye;

    // players
    const flagOf = new Map();
    view.flags.forEach((f, i) => { if (f.state === 'carried') flagOf.set(f.carrier, i); });
    for (const p of view.players) {
      if (!p.alive) { anims.delete(p.id); continue; }
      let q = p;
      if (p.id === myId) {
        if (firstPerson) continue;
        const mp = c.myPos();
        q = Object.assign({}, p, { pos: mp, yaw, pitch, jetting: me.jetting, skiing: me.skiing, ground: me.ground, weapon: me.weapons[me.wi] });
      }
      const an = animFor(q, dt);
      const sf = shieldFlash.get(p.id);
      const hf = hitFlash.get(p.id);
      Models.player(renderer, q, an, { flagTeam: flagOf.has(p.id) ? flagOf.get(p.id) : null, time, flash: hf ? Math.max(0, 1 - (now() - hf) / 0.22) : 0, fireGlow: p.firing ? 1 : 0 });
      // jets
      if (q.jetting) {
        const rr = JF.rightDir(q.yaw), back = [Math.sin(q.yaw) * 0.35, 0, Math.cos(q.yaw) * 0.35];
        const s = ARMORS[q.armor].h / 2;
        for (const side of [-1, 1]) {
          const x = q.pos[0] + rr[0] * side * 0.15 * s + back[0], y = q.pos[1] + 0.9 * s, z = q.pos[2] + rr[2] * side * 0.15 * s + back[2];
          const v = [p.vel[0] * 0.5, -14, p.vel[2] * 0.5];
          const jc = TEAMS[q.team].rgb;
          puff(x, y, z, { life: 0.18, s0: 0.35, s1: 0.1, c: [0.5 + jc[0] * 2.4, 0.5 + jc[1] * 2.4, 0.5 + jc[2] * 2.4], v, kind: 0 });
          if (Math.random() < 0.3) puff(x, y - 0.5, z, { life: 0.8, s0: 0.3, s1: 1.2, c: [0.6, 0.62, 0.65], v: [v[0] * 0.3, -4, v[2] * 0.3], kind: 1, blend: 1, a: 0.3, drag: 2 });
        }
        if (lights.length < 4) lights.push({ x: q.pos[0], y: q.pos[1] + 0.5, z: q.pos[2], r: 7, c: TEAMS[q.team].rgb.map(v => 0.3 + v * 1.3) });
      }
      // skiing kicks up the ground
      if (q.skiing && q.ground) {
        const sp = Math.hypot(p.vel[0], p.vel[2]);
        if (sp > 10 && Math.random() < 0.5) puff(q.pos[0], q.pos[1] + 0.1, q.pos[2], { life: 0.7, s0: 0.3, s1: 1.4, c: w.def.look.low.map(v => v * 1.1 + 0.15), kind: 1, blend: 1, a: 0.4, v: [rnd(-2, 2), 1.5, rnd(-2, 2)], drag: 3 });
      }
      // shields
      if (p.shieldOn || (sf && now() - sf < 0.3)) glass.push({ x: q.pos[0], y: q.pos[1] + ARMORS[q.armor].h / 2, z: q.pos[2], s: ARMORS[q.armor].h * 1.05, c: [0.3, 0.6, 1.4], a: sf && now() - sf < 0.3 ? 0.35 : 0.1 });
      // ELF and repair beams
      if (p.elfT >= 0) {
        const tg = view.players.find(x => x.id === p.elfT);
        if (tg) {
          const a = [q.pos[0], q.pos[1] + 1.5, q.pos[2]], b = [tg.pos[0], tg.pos[1] + 1.2, tg.pos[2]];
          for (let k = 0; k < 6; k++) {
            const t0 = k / 6, t1 = (k + 1) / 6;
            const o0 = Math.sin(time * 30 + k * 2) * 0.4 * Math.sin(Math.PI * t0), o1 = Math.sin(time * 30 + k * 2 + 2) * 0.4 * Math.sin(Math.PI * t1);
            beams.beam(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 + o0, a[2] + (b[2] - a[2]) * t0, 0.15, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1 + o1, a[2] + (b[2] - a[2]) * t1, 0.15, 0.6, 0.7, 2.5, 1);
          }
        }
      }
      if (p.repairing > 0) {
        let tgt = null;
        if (p.repairing >= 200) { const o = w.objects[p.repairing - 200]; if (o) tgt = o.c; }
        else { const tp = view.players.find(x => x.id === p.repairing - 1); if (tp && tp.id !== p.id) tgt = [tp.pos[0], tp.pos[1] + 1, tp.pos[2]]; }
        if (tgt) beams.beam(q.pos[0], q.pos[1] + 1.4, q.pos[2], 0.08, tgt[0], tgt[1], tgt[2], 0.2, 0.4, 2.2, 0.8, 0.8 + 0.2 * Math.sin(time * 20));
      }
    }
    weather(eye, dt, time);
    // dropped and home flags
    view.flags.forEach((f, i) => {
      if (f.state === 'carried') return;
      Models.flag(renderer, { team: i, pos: f.pos }, time);
      const tc = TEAMS[i].rgb;
      parts.part(f.pos[0], f.pos[1] + 2.4, f.pos[2], 2.2, tc[0] * 1.5, tc[1] * 1.5, tc[2] * 1.5, 0.5, 0);
      lights.push({ x: f.pos[0], y: f.pos[1] + 2, z: f.pos[2], r: 10, c: tc.map(v => v * 1.2) });
    });
    // base things
    w.objects.forEach((o, i) => {
      const so = view.objects[i];
      Models.object(renderer, o, so, time);
      if (so && !so.up && Math.random() < 0.25) {
        puff(o.c[0] + rnd(-1, 1), o.b[4], o.c[2] + rnd(-1, 1), { life: 2.5, s0: 0.6, s1: 2.5, c: [0.12, 0.12, 0.12], kind: 1, blend: 1, a: 0.6, v: [rnd(-0.5, 0.5), 3, rnd(-0.5, 0.5)], drag: 0.3 });
        if (Math.random() < 0.2) puff(o.c[0], o.c[1], o.c[2], { life: 0.4, s0: 0.08, c: [3, 2.5, 1.5], v: [rnd(-5, 5), rnd(2, 6), rnd(-5, 5)], g: 15, kind: 2 });
      }
      if (o.kind === 'gen' && so && so.up) lights.push({ x: o.c[0], y: o.c[1], z: o.c[2], r: 9, c: TEAMS[o.team].rgb.map(v => v * 1.2) });
    });
    // projectiles from the host (my own are drawn from the local copies)
    for (const q of view.proj) {
      if (q.owner === myId && JF.WEAPONS[q.kind]) continue;
      drawProj(q, time, lights);
    }
    for (const q of localProj) drawProj(q, time, lights);
    // debris
    for (const d of debris) renderer.put('box', d.p[0], d.p[1], d.p[2], d.rot[0], d.rot[1], d.s[0], d.s[1], d.s[2], d.c, [0, 0, 0, 0.5]);
    // particles and beams
    for (const f of fx) {
      const k = 1 - f.life / f.max;
      const s = f.s0 + (f.s1 - f.s0) * k;
      const a = f.a * (f.blend ? (1 - k) * Math.min(1, k * 8 + 0.2) : (1 - k * k));
      parts.part(f.p[0], f.p[1], f.p[2], s, f.c[0], f.c[1], f.c[2], a, f.kind, f.rot, f.seed, f.blend);
    }
    for (const b of fxBeams) { const k = b.life / b.max; beams.beam(b.a[0], b.a[1], b.a[2], b.w, b.b[0], b.b[1], b.b[2], b.w, b.c[0], b.c[1], b.c[2], k); }
    for (const l of fxLights) lights.push({ x: l.x, y: l.y, z: l.z, r: l.r, c: l.c.map(v => v * l.life / l.max) });
    // nearest lights win
    lights.sort((a, b) => Math.hypot(a.x - eye[0], a.y - eye[1], a.z - eye[2]) - Math.hypot(b.x - eye[0], b.y - eye[1], b.z - eye[2]));

    // first-person weapon
    let vm = null;
    if (firstPerson && me.weapons[me.wi]) {
      const sp = Math.hypot(me.vel[0], me.vel[2]);
      if (me.ground && !me.skiing) bob += dt * Math.min(sp, 12) * 0.9;
      const dyaw = ((yaw - lastYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI, dp = pitch - lastPitch;
      lastYaw = yaw; lastPitch = pitch;
      swayX = swayX * Math.exp(-dt * 10) + dyaw * 0.4; swayY = swayY * Math.exp(-dt * 10) - dp * 0.4;
      swayX = Math.max(-0.08, Math.min(0.08, swayX)); swayY = Math.max(-0.08, Math.min(0.08, swayY));
      recoil *= Math.exp(-dt * 12); fireGlow *= Math.exp(-dt * 8);
      const bobY = me.ground && !me.skiing ? Math.abs(Math.sin(bob)) * 0.025 * Math.min(1, sp / 8) : 0;
      const spinning = me.weapons[me.wi] === 'chain' ? time * (me.spin > 0 ? 30 * me.spin : 0) : 0;
      vm = Models.viewModel(eye, yaw, pitch, me.weapons[me.wi], me.team, { recoil: recoil, bobY, swayX: swayX + Math.sin(bob * 0.5) * 0.01 * Math.min(1, sp / 8), swayY, tilt: me.skiing ? 0.1 : 0, roll: me.skiing ? 0.15 : 0, glow: fireGlow * 2, spin: spinning });
    }
    renderer.frame({
      cam: { pos: eye, yaw: camYaw, pitch: camPitch, fov: vfov() },
      time, lights, parts, beams, glass, viewModel: vm,
    });
  }

  // the setting is the side-to-side angle; the camera wants the up-and-down one
  function vfov() {
    const h = prefs.fov * Math.PI / 180, asp = Math.max(0.4, innerWidth / Math.max(1, innerHeight));
    return Math.min(1.75, Math.max(0.8, 2 * Math.atan(Math.tan(h / 2) / asp)));
  }

  function drawProj(q, time, lights) {
    Models.projectile(renderer, q, time);
    const p = q.pos;
    const v = q.vel, sp = Math.hypot(v[0], v[1], v[2]) || 1;
    const back = [p[0] - v[0] / sp * 2.5, p[1] - v[1] / sp * 2.5, p[2] - v[2] / sp * 2.5];
    switch (q.kind) {
      case 'disc':
        parts.part(p[0], p[1], p[2], 1.1, 0.8, 1.2, 2.4, 0.9, 0);
        beams.beam(back[0], back[1], back[2], 0.02, p[0], p[1], p[2], 0.22, 0.4, 0.7, 1.6, 0.8);
        if (Math.random() < 0.5) puff(p[0], p[1], p[2], { life: 0.35, s0: 0.25, s1: 0.05, c: [0.6, 0.9, 2], kind: 0 });
        if (lights.length < 7) lights.push({ x: p[0], y: p[1], z: p[2], r: 6, c: [0.6, 0.9, 1.8] });
        break;
      case 'plasma': case 'tbolt': {
        const c = q.kind === 'tbolt' ? [2.6, 0.7, 0.3] : [2.8, 1.2, 0.3];
        parts.part(p[0], p[1], p[2], 1.0, c[0], c[1], c[2], 1, 0);
        parts.part(p[0], p[1], p[2], 0.45, 3, 2.6, 1.6, 1, 0);
        beams.beam(back[0], back[1], back[2], 0.05, p[0], p[1], p[2], 0.4, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0.7);
        if (Math.random() < 0.6) puff(p[0], p[1], p[2], { life: 0.4, s0: 0.4, s1: 0.05, c, kind: 0, v: [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)] });
        if (lights.length < 7) lights.push({ x: p[0], y: p[1], z: p[2], r: 9, c: c.map(x => x * 0.7) });
        break;
      }
      case 'blaster':
        beams.beam(back[0], back[1], back[2], 0.03, p[0], p[1], p[2], 0.12, 3, 0.5, 0.3, 1);
        parts.part(p[0], p[1], p[2], 0.4, 3, 0.8, 0.5, 1, 0);
        break;
      case 'gl': case 'hgren':
        if (Math.random() < 0.6) puff(p[0], p[1], p[2], { life: 0.9, s0: 0.15, s1: 0.6, c: [0.55, 0.55, 0.55], kind: 1, blend: 1, a: 0.5, drag: 1 });
        parts.part(p[0], p[1], p[2], 0.35, 2, 1.2, 0.4, 0.6, 0);
        break;
      case 'mortar':
        puff(p[0], p[1], p[2], { life: 1.6, s0: 0.4, s1: 1.6, c: [0.5, 0.52, 0.5], kind: 1, blend: 1, a: 0.6, drag: 0.5 });
        parts.part(p[0], p[1], p[2], 1.0, 1.4, 2.2, 0.6, 0.8, 0);
        if (lights.length < 7) lights.push({ x: p[0], y: p[1], z: p[2], r: 8, c: [0.6, 1.2, 0.3] });
        break;
    }
  }

  // ---------- HUD ----------
  const textCache = new Map();
  function setText(id, t) { if (textCache.get(id) !== t) { textCache.set(id, t); $(id).textContent = t; } }
  function setHtml(id, h) { const k = id + ':h'; if (textCache.get(k) !== h) { textCache.set(k, h); $(id).innerHTML = h; } }
  const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  function hud(view, dt) {
    const c = client(), me = c.me, w = c.world;
    const myId = view.you;
    const alive = !!(me && me.alive);
    const myTeam = me ? me.team : 0;
    // top: score, clock, flags
    for (let t = 0; t < 2; t++) {
      setText('s' + t, String(view.score[t]));
      const f = view.flags[t];
      const el = $('f' + t);
      const st = f.state === 'home' ? 'home' : f.state === 'carried' ? 'TAKEN' : 'DROPPED ' + (f.returnIn || '');
      setText('f' + t, st);
      el.className = 'fl' + (f.state !== 'home' ? ' away' : '');
    }
    document.querySelector('.t0 .tname').textContent = TEAMS[0].name + (myTeam === 0 ? ' (you)' : '');
    document.querySelector('.t1 .tname').textContent = TEAMS[1].name + (myTeam === 1 ? ' (you)' : '');
    setText('clock', mmss(view.timeLeft));
    // bars
    if (me) {
      const A = ARMORS[me.armor];
      const hpF = Math.max(0, me.hp / A.hp), enF = Math.max(0, me.energy / A.energy);
      $('hp').style.width = (hpF * 100).toFixed(1) + '%'; $('hp').className = hpF < 0.3 ? 'low' : '';
      $('en').style.width = (enF * 100).toFixed(1) + '%';
      setText('hpn', String(Math.ceil(me.hp))); setText('enn', String(Math.floor(me.energy)));
      const sp = Math.hypot(me.vel[0], me.vel[1], me.vel[2]) * 3.6;
      setText('spd', String(Math.round(sp)));
      setText('alt', alive ? Math.round(me.pos[1] - w.terrain.height(me.pos[0], me.pos[2])) + ' m up' : '');
      // weapons
      let wh = '';
      me.weapons.forEach((k, i) => {
        const W = WEAPONS[k];
        const ammo = W.ammo ? me.ammo[k] : '∞';
        wh += '<div class="' + (i === me.wi ? 'on' : '') + (W.ammo && !me.ammo[k] ? ' empty' : '') + '">' + (i + 1) + ' ' + W.name + ' <span class="dim">' + ammo + '</span></div>';
      });
      wh += '<div class="pk">' + ARMORS[me.armor].name + ' · ' + PACKS[me.pack].name + (me.pack === 'shield' ? (me.shieldOn ? ' ON' : ' off') : '') + ' · grenades ' + me.grenades + '</div>';
      setHtml('weapons', wh);
      // station
      const stEl = $('station');
      if (alive && me.stationId !== -1) {
        stEl.style.display = 'block';
        if (me.stationId >= 0) { setText('sttext', 'Putting on your loadout…'); $('stbar').style.width = Math.min(100, me.stationT / JF.STATION_S * 100) + '%'; }
        else if (me.stationId === -2) { setText('sttext', 'This station has no power. Repair the generator.'); $('stbar').style.width = '0'; }
        else { setText('sttext', 'Station recharging'); $('stbar').style.width = '0'; }
      } else stEl.style.display = 'none';
      // dead
      $('dead').hidden = alive;
      if (!alive) {
        const ready = me.deadT >= JF.RESPAWN_S;
        $('dead').querySelector('b').textContent = replay ? 'Midair!' : deathInfo ? 'You died' : 'Get ready';
        let txt = replay ? 'Replay: ' + nameOf(replay.k.by) + '\u2019s disc' : deathInfo ? (deathInfo.by >= 0 && deathInfo.by !== myId ? 'by ' + nameOf(deathInfo.by) + ' (' + deathInfo.w + ')' : deathInfo.w) : '';
        txt += ' · ' + (ready ? (isTouch ? 'tap FIRE to respawn' : 'click to respawn') : 'respawn in ' + Math.ceil(JF.RESPAWN_S - me.deadT));
        setText('deadtxt', ' ' + txt);
      }
    }
    // crosshair hit marker
    const hm = $('hitmark');
    hm.className = now() - hitT < 0.15 ? 'on' + (hitKill ? ' kill' : '') : (hitKill ? 'kill' : '');
    // damage directions
    dmgDirs = dmgDirs.filter(d => now() - d.t < 1);
    let dh = '';
    for (const d of dmgDirs) {
      const rel = d.ang - (yaw + Math.PI);
      dh += '<i style="transform:rotate(' + (-rel).toFixed(2) + 'rad);opacity:' + (1 - (now() - d.t)).toFixed(2) + '"></i>';
    }
    setHtml('dmgdir', dh);
    hurtFlash *= Math.exp(-dt * 3);
    $('view').style.filter = hurtFlash > 0.02 ? 'saturate(' + (1 + hurtFlash) + ') brightness(' + (1 + hurtFlash * 0.3) + ') hue-rotate(-' + (hurtFlash * 20).toFixed(0) + 'deg)' : '';
    // center
    const cm = centerMsg;
    const on = now() < cm.until;
    $('center').style.opacity = on ? 1 : 0; $('sub').style.opacity = on ? 1 : 0;
    if (on) { setText('center', cm.text); $('center').style.color = cm.color; setText('sub', cm.sub); }
    // feed and chat
    feed = feed.filter(f => now() - f.t < 8);
    setHtml('feed', feed.map(f => '<div>' + f.html + '</div>').join(''));
    chat = chat.filter(f => now() - f.t < 14);
    setHtml('chatlog', chat.map(f => '<div>' + f.html + '</div>').join(''));
    // room and network
    setText('roomtag', S.room ? 'game ' + S.room + (S.isHost ? ' · you are hosting' : '') : 'practice with bots');
    const late = c.lastSnapAt && performance.now() - c.lastSnapAt > 1500;
    let net = late ? 'Waiting for the host…' : '';
    if (!S.isHost && S.link && !S.link.direct(0) && !late) net = 'via relay';
    setText('net', net);
    const myR = c.roster.find(x => x.id === myId);
    setText('fps', prefs.fps ? fpsShow + ' fps' + (myR && !S.isHost ? ' · ' + myR.ping + ' ms' : '') : '');
    // markers on screen
    $('markers').style.display = replay ? 'none' : '';
    if (!replay) markers(view);
    radar(view);
    // scoreboard, map, end screen
    $('scores').hidden = !tabDown;
    if (tabDown) setHtml('scores', board(view));
    $('bigmap').hidden = !mapDown;
    if (mapDown) bigMap(view);
    if (view.over > -2) {
      $('over').hidden = false;
      const win = view.over;
      const title = win < 0 ? 'A draw' : (win === myTeam ? 'You win!' : TEAMS[win].name + ' wins');
      setHtml('over', '<h2 style="color:' + (win >= 0 ? TEAMS[win].color : '#fff') + '">' + title + '</h2>' + board(view) + (view.extra ? '<p class="dim">Next: ' + esc(view.extra.next) + ' in ' + view.extra.overIn + ' s</p>' : ''));
      overShown = true;
    } else if (overShown) { $('over').hidden = true; overShown = false; }
  }

  function board(view) {
    const c = client();
    const myId = view.you;
    let h = '<div class="sc">';
    for (let t = 0; t < 2; t++) {
      const list = c.roster.filter(p => p.team === t).sort((a, b) => b.s - a.s);
      h += '<div><h3 style="color:' + TEAMS[t].color + '">' + TEAMS[t].name + ' <span>' + view.score[t] + '</span></h3><table><tr><th>name</th><th>score</th><th>kills</th><th>deaths</th><th>caps</th><th>ping</th></tr>';
      for (const p of list) h += '<tr class="' + (p.id === myId ? 'me' : '') + '"><td>' + esc(p.name) + (p.bot ? ' <span class="dim">bot</span>' : '') + '</td><td>' + p.s + '</td><td>' + p.k + '</td><td>' + p.d + '</td><td>' + p.c + '</td><td>' + (p.bot ? '' : p.ping) + '</td></tr>';
      h += '</table></div>';
    }
    return h + '</div>';
  }

  const markerEls = [];
  function markers(view) {
    const c = client(), me = c.me, w = c.world;
    const myId = view.you, myTeam = me ? me.team : 0;
    const list = [];
    const W = innerWidth, H = innerHeight;
    const dist = p => camPos ? Math.hypot(p[0] - camPos[0], p[1] - camPos[1], p[2] - camPos[2]) : 0;
    // flags
    view.flags.forEach((f, i) => {
      const pos = [f.pos[0], f.pos[1] + 3.2, f.pos[2]];
      const lbl = i === myTeam ? (f.state === 'home' ? 'our flag' : f.state === 'carried' ? 'OUR FLAG' : 'our flag (dropped)') : (f.state === 'carried' && f.carrier === myId ? '' : 'their flag');
      if (lbl) list.push({ pos, cls: 'mk flag', color: TEAMS[i].color, text: lbl + ' ' + Math.round(dist(pos)) + 'm', clamp: true });
    });
    // teammates' names; enemies only near the crosshair and in sight
    for (const p of view.players) {
      if (!p.alive || p.id === myId) continue;
      const pos = [p.pos[0], p.pos[1] + ARMORS[p.armor].h + 0.5, p.pos[2]];
      const d = dist(pos);
      // a small arrow over everyone you can see, in their team colour; names for friends, and for enemies under the crosshair
      if (p.team === myTeam) { if (d < 500) list.push({ pos, cls: 'mk mate', color: TEAMS[p.team].color, text: nameOf(p.id) + (p.hasFlag ? ' ⚑' : ''), tri: true, bar: d < 120 && p.hpF < 0.99 ? p.hpF : null }); }
      else if (d < 400 && !w.blocked(camPos, [p.pos[0], p.pos[1] + 1, p.pos[2]])) {
        const sp = renderer.project(pos);
        const aimed = sp && Math.hypot(sp.x - W / 2, sp.y - H / 2) < 80;
        const hitRecently = myPlayerHit.has(p.id) && now() - myPlayerHit.get(p.id) < 3;
        list.push({ pos, cls: 'mk foe', color: TEAMS[p.team].color, text: aimed || hitRecently ? nameOf(p.id) + ' ' + Math.round(d) + 'm' : '', tri: true, bar: aimed || hitRecently ? p.hpF : null });
      }
    }
    // base things near the crosshair or that I just hit: name and health
    for (const o of w.objects) {
      const so = view.objects[o.id]; if (!so) continue;
      const top = [o.c[0], o.b[4] + 0.9, o.c[2]];
      const d = dist(top);
      if (d > 160) continue;
      const mine = myObjHit.get(o.id), recent = mine && now() - mine < 2.5;
      const sp = renderer.project(top);
      if (!sp) continue;
      if (!recent && Math.hypot(sp.x - W / 2, sp.y - H / 2) > 70) continue;
      if (!recent && w.blocked(camPos, [o.c[0], o.c[1], o.c[2]])) continue;
      const pct = Math.round(so.hpF * 100);
      list.push({ pos: top, cls: 'mk obj', color: o.team === myTeam ? TEAMS[o.team].color : '#ff8a6a', text: JF.OBJ[o.kind].name + (so.up ? ' ' + pct + '%' : ' destroyed'), bar: so.hpF });
    }
    // our generator when it is down
    for (const o of w.objects) {
      const so = view.objects[o.id];
      if (o.kind === 'gen' && o.team === myTeam && so && !so.up) list.push({ pos: [o.c[0], o.b[4] + 1, o.c[2]], cls: 'mk', color: '#ff6b6b', text: 'generator down ' + Math.round(dist(o.c)) + 'm', clamp: true });
    }
    const box = $('markers');
    while (markerEls.length < list.length) { const d = document.createElement('div'); box.appendChild(d); markerEls.push(d); }
    markerEls.forEach((el, i) => {
      const m = list[i];
      if (!m) { el.style.display = 'none'; return; }
      let sp = renderer.project(m.pos);
      if (!sp && !m.clamp) { el.style.display = 'none'; return; }
      let x, y;
      if (!sp) {
        // behind the camera: pin to the bottom edge on the right side
        const f = JF.aimDir(yaw, 0), rr = JF.rightDir(yaw);
        const dx = m.pos[0] - camPos[0], dz = m.pos[2] - camPos[2];
        const side = dx * rr[0] + dz * rr[2];
        void f;
        x = side > 0 ? W - 40 : 40; y = H - 140;
      } else { x = sp.x; y = sp.y; }
      if (m.clamp) { x = Math.max(40, Math.min(W - 40, x)); y = Math.max(70, Math.min(H - 120, y)); }
      el.style.display = 'block';
      el.className = m.cls;
      el.style.left = x.toFixed(0) + 'px'; el.style.top = y.toFixed(0) + 'px';
      el.style.color = m.color || '';
      const html = (m.tri ? '<div class="tri"></div>' : '') + (m.cls.includes('flag') || m.cls === 'mk' ? '<div class="ic"></div><br>' : '') + esc(m.text) + (m.bar != null ? '<div class="hb"><i style="width:' + Math.round(m.bar * 100) + '%;background:hsl(' + Math.round(m.bar * 120) + ',85%,52%)"></i></div>' : '');
      if (el._h !== html) { el._h = html; el.innerHTML = html; }
    });
  }

  function radar(view) {
    const cv = $('radar'), g = cv.getContext('2d');
    const c = client(), me = c.me, w = c.world;
    const S_ = cv.width, R_ = S_ / 2 - 4, range = 320;
    const myTeam = me ? me.team : 0;
    const at = camPos || [0, 0, 0];
    g.clearRect(0, 0, S_, S_);
    g.save();
    g.translate(S_ / 2, S_ / 2);
    g.beginPath(); g.arc(0, 0, R_, 0, Math.PI * 2); g.fillStyle = 'rgba(5,10,20,0.55)'; g.fill();
    g.strokeStyle = 'rgba(150,180,220,0.35)'; g.lineWidth = 1.5; g.stroke();
    g.beginPath(); g.arc(0, 0, R_ / 2, 0, Math.PI * 2); g.strokeStyle = 'rgba(150,180,220,0.15)'; g.stroke();
    g.clip();
    // world to radar: forward is up
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const toR = p => {
      const dx = p[0] - at[0], dz = p[2] - at[2];
      const rx = dx * cy - dz * sy, fz = -dx * sy - dz * cy;
      return [rx / range * R_, -fz / range * R_];
    };
    const clampR = v => { const l = Math.hypot(v[0], v[1]); return l > R_ - 6 ? [v[0] / l * (R_ - 6), v[1] / l * (R_ - 6)] : v; };
    // bases
    for (const b of w.bases) {
      const v = clampR(toR([b.o.x, 0, b.o.z]));
      g.fillStyle = TEAMS[b.team].color; g.globalAlpha = 0.6; g.fillRect(v[0] - 5, v[1] - 5, 10, 10); g.globalAlpha = 1;
    }
    // players
    const sensorUp = view.objects.some((so, i) => so && so.up && w.objects[i].kind === 'sensor' && w.objects[i].team === myTeam);
    for (const p of view.players) {
      if (!p.alive || p.id === view.you) continue;
      const d = Math.hypot(p.pos[0] - at[0], p.pos[2] - at[2]);
      if (p.team !== myTeam) {
        const nearBase = Math.hypot(p.pos[0] - w.bases[myTeam].o.x, p.pos[2] - w.bases[myTeam].o.z) < 350;
        if (!(d < 90 || p.hasFlag || (sensorUp && nearBase))) continue;
      }
      const v = toR(p.pos);
      if (Math.hypot(v[0], v[1]) > R_) continue;
      g.fillStyle = p.team === myTeam ? TEAMS[p.team].color : '#ff4a3a';
      g.beginPath(); g.arc(v[0], v[1], p.hasFlag ? 4.5 : 3, 0, Math.PI * 2); g.fill();
    }
    // flags
    view.flags.forEach((f, i) => {
      const v = clampR(toR(f.pos));
      g.fillStyle = TEAMS[i].color; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(v[0] - 3, v[1] + 6); g.lineTo(v[0] - 3, v[1] - 7); g.lineTo(v[0] + 6, v[1] - 4); g.lineTo(v[0] - 3, v[1] - 1); g.closePath(); g.fill(); g.stroke();
    });
    g.restore();
    // me
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(S_ / 2, S_ / 2 - 7); g.lineTo(S_ / 2 + 5, S_ / 2 + 5); g.lineTo(S_ / 2 - 5, S_ / 2 + 5); g.closePath(); g.fill();
    g.fillStyle = 'rgba(220,235,255,0.8)'; g.font = 'bold 12px monospace'; g.textAlign = 'center'; g.fillText('N', S_ / 2 + Math.sin(-yaw + Math.PI) * (R_ - 10) * -1, S_ / 2 + Math.cos(-yaw + Math.PI) * (R_ - 10) + 4);
  }

  // the M map: the land shaded from above, once per map
  let mapImg = null;
  function bigMap(view) {
    const cv = $('mapc'), g = cv.getContext('2d'), w = client().world, Wd = cv.width;
    if (mapCanvasFor !== w) {
      mapCanvasFor = w;
      const img = g.createImageData(Wd, Wd);
      const look = w.def.look, sun = R.norm(look.sun);
      let lo = Infinity, hi = -Infinity;
      for (const h of w.terrain.h) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
      for (let y = 0; y < Wd; y++) for (let x = 0; x < Wd; x++) {
        const wx = x / Wd * JF.SIZE, wz = y / Wd * JF.SIZE;
        const h = w.terrain.height(wx, wz), n = w.terrain.normal(wx, wz);
        const k = (h - lo) / (hi - lo);
        const base = k < 0.4 ? look.low : k < 0.75 ? look.mid : look.high;
        const l = 0.45 + 0.75 * Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]);
        const inside = wx > JF.AREA_MIN && wx < JF.AREA_MAX && wz > JF.AREA_MIN && wz < JF.AREA_MAX;
        const o = (y * Wd + x) * 4;
        img.data[o] = Math.min(255, base[0] * l * 255 * (inside ? 1 : 0.5)); img.data[o + 1] = Math.min(255, base[1] * l * 255 * (inside ? 1 : 0.5)); img.data[o + 2] = Math.min(255, base[2] * l * 255 * (inside ? 1 : 0.5)); img.data[o + 3] = 255;
      }
      mapImg = img;
    }
    g.putImageData(mapImg, 0, 0);
    const toM = p => [p[0] / JF.SIZE * Wd, p[2] / JF.SIZE * Wd];
    const myTeam = client().me ? client().me.team : 0;
    for (const b of w.bases) { const v = toM([b.o.x, 0, b.o.z]); g.strokeStyle = TEAMS[b.team].color; g.lineWidth = 3; g.strokeRect(v[0] - 8, v[1] - 8, 16, 16); }
    for (const p of view.players) {
      if (!p.alive || (p.team !== myTeam && !p.hasFlag)) continue;
      const v = toM(p.pos); g.fillStyle = p.id === view.you ? '#fff' : TEAMS[p.team].color;
      g.beginPath(); g.arc(v[0], v[1], p.id === view.you ? 5 : 3.5, 0, Math.PI * 2); g.fill();
    }
    view.flags.forEach((f, i) => { const v = toM(f.pos); g.fillStyle = TEAMS[i].color; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(v[0], v[1]); g.lineTo(v[0], v[1] - 14); g.lineTo(v[0] + 10, v[1] - 10); g.lineTo(v[0], v[1] - 6); g.fill(); g.stroke(); });
    if (camPos) { const v = toM(camPos), f = JF.aimDir(yaw, 0); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(v[0], v[1]); g.lineTo(v[0] + f[0] * 18, v[1] + f[2] * 18); g.stroke(); }
  }

  function toast(t) { addChat('<span class="warn">' + esc(t) + '</span>'); }

  // ---------- start ----------
  if (window.Update) window.Update.start({ url: '../version.json' });
  // a map behind the menu
  if (renderer) {
    const w = new JF.World({ map: prefs.host.map || 'highland' });
    renderer.setMap(w);
  }
  requestAnimationFrame(frame);
  refreshRooms();
  const hash = location.hash.replace('#', '').trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(hash)) {
    $('code').value = hash;
    if (prefs.name) join(hash); else { setMenuMsg('Pick a name, then press Join to play in game ' + hash + '.'); $('name').focus(); }
  }
  // for tests and debugging
  window.JFGame = { get session() { return S; }, prefs, renderer, playBots, join, leave, hostOnline, get yaw() { return yaw; }, set yaw(v) { yaw = v; }, get pitch() { return pitch; }, set pitch(v) { pitch = v; }, keys, mouse, get frameMs() { return frameMs; }, set cam(v) { debugCam = v; }, get cam() { return debugCam; }, get replay() { return replay; } };
})();
