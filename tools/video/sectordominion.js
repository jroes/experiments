'use strict';
// node tools/video/sectordominion.js  ->  sectordominion/intro.mp4 (+ intro.jpg)
const path = require('path');
const { Recorder, sleep } = require('./lib');
const { route, ROOT } = require('./common');

(async () => {
  const rec = new Recorder({
    url: 'https://jroes.github.io/experiments/sectordominion/',
    route: route(process.env.KV_PORT || 8135),
    musicSeed: 3,
    poster: path.join(ROOT, 'sectordominion', 'intro.jpg'), posterAt: 12,
    init: `try { if (!localStorage.getItem('sd-vo')) { localStorage.setItem('sd-vo','1'); localStorage.setItem('sectordominion-help-seen','1'); localStorage.setItem('sectordominion-name-asked','1'); localStorage.setItem('sectordominion-name-v1','Ada'); } } catch (e) {}`,
  });
  const page = await rec.start();
  await rec.capAt('31%', '56%');
  const K = 0.72; // pace: captions stay up this fraction of the time first planned
  const say = (t, ms) => rec.cap(t, ms && Math.round(ms * K));
  const state = () => page.evaluate(() => { const i = JSON.parse(localStorage.getItem('sectordominion-games-v2')); return JSON.parse(localStorage.getItem('sectordominion-g-' + i.active)); });

  // map click: the same fit the game uses (no pan or zoom yet)
  const worldXY = async name => {
    const s = await state();
    const w = s.worlds.find(x => x.name === name);
    const r = await page.locator('#map').boundingBox();
    const sc = Math.min(r.width / (s.width + 6), r.height / (s.height + 6));
    return { x: r.x + (r.width - s.width * sc) / 2 + w.x * sc, y: r.y + (r.height - s.height * sc) / 2 + w.y * sc };
  };
  const clickWorld = async name => { const p = await worldXY(name); await rec.clickAt(p.x, p.y); };
  const ringWorld = async (name, ms, r) => { const p = await worldXY(name); await rec.hi({ x: p.x - (r || 26), y: p.y - (r || 26), w: 2 * (r || 26), h: 2 * (r || 26) }, ms, 4); };
  const endTurn = async () => { await rec.click('#b-end'); await sleep(500); };

  // ---- title card, with the seeded game set up underneath ----
  await rec.card({ kick: 'A SPACE EMPIRE GAME', title: 'SECTOR<br>DOMINION', line: 'Build an empire. Take the sector.', seed: 11 }, 300);
  await page.evaluate(() => {
    document.getElementById('b-new').click();
    document.getElementById('b-games-new').click();
    const f = document.getElementById('f-new');
    f.elements.seed.value = '10';
    f.querySelector('button[value=ok]').click();
  });
  await sleep(4200);
  await rec.cardOff();
  await sleep(400);

  // ---- the goal ----
  await say('You run a small star empire. <b>Grow it, then take the sector.</b>', 3600);
  await rec.hi('#map', 0, 0);
  await say('Win by wiping out the <b>3 rival empires</b> or holding <b>70% of the worlds</b>.', 4200);
  await rec.unhi();

  // ---- the top bar ----
  const topStats = await page.evaluate(() => { const st = document.querySelectorAll('#topbar .stat'); const a = st[0].getBoundingClientRect(), b = st[3].getBoundingClientRect(); return { x: a.left, y: a.top, w: b.right - a.left, h: a.height }; });
  await rec.hi(topStats, 0, 8);
  await say('<b>Credits</b> come in every turn from your worlds. Spend them on ships and research.', 4600);
  await rec.unhi();

  // ---- select your world ----
  const cap = (await state()).worlds.find(w => w.owner === 1).name;
  await clickWorld(cap);
  await rec.hi('#p-world', 0, 6);
  await say('<b>Tap a world</b> to see it. This is your capital.', 3800);
  await rec.unhi();

  // ---- build ----
  const buildBox = await page.evaluate(() => { const h = [...document.querySelectorAll('#p-world h3')].find(x => /Build/.test(x.textContent)); const rows = document.querySelectorAll('#p-world .ship-row'); const a = h.getBoundingClientRect(), b = rows[rows.length - 1].getBoundingClientRect(); return { x: a.left, y: a.top, w: a.width, h: b.bottom - a.top }; });
  await rec.hi(buildBox, 0, 8);
  await say('<b>Build ships.</b> Warships fight. <b>Transports</b> settle worlds. <b>Scouts</b> see far.', 5200);
  await rec.click('button[data-act=build][data-t=frigate]');
  await rec.click('button[data-act=build][data-t=frigate]');
  await rec.click('button[data-act=build][data-t=transport]');
  await rec.unhi();
  await say('New ships show up <b>next turn</b>.', 2600);

  // ---- dispatch ----
  const dispatchBox = await page.evaluate(() => { const h = [...document.querySelectorAll('#p-world h3')].find(x => /Dispatch/.test(x.textContent)); const t = document.querySelector('#p-world button[data-act=target]'); const a = h.getBoundingClientRect(), b = t.getBoundingClientRect(); return { x: a.left, y: a.top, w: a.width, h: b.bottom - a.top }; });
  await rec.hi(dispatchBox, 0, 8);
  await say('To send ships: pick how many, then <b>Choose destination</b>.', 3600);
  await rec.click('button[data-act=inc][data-t=transport]');
  await rec.click('button[data-act=inc][data-t=scout]');
  await rec.click('button[data-act=target]');
  await rec.unhi();
  await say('Pick an <b>empty world</b>. A Transport settles it.', 2200);
  await ringWorld('Kalus', 0, 30);
  await sleep(1400);
  await rec.unhi();
  await clickWorld('Kalus');
  await sleep(500);
  await endTurn();
  await say('<b>End turn.</b> Ships fly at their own speed.', 2600);
  await endTurn(); await sleep(600);
  await endTurn(); await sleep(900);
  await rec.mark('good');
  await rec.hi('#log', 0, 6);
  await say('<b>Kalus settled.</b> Every world earns credits.', 3600);
  await rec.unhi();

  // ---- ships ----
  await rec.click('#b-help');
  await sleep(500);
  await page.evaluate(() => { document.querySelectorAll('#d-help details').forEach(d => { d.open = d.id === 'h-ships'; }); document.getElementById('h-ships').scrollIntoView({ block: 'start' }); });
  await sleep(500);
  await say('Know your ships. <b>Frigates</b> and <b>Cruisers</b> fight. <b>Transports</b> carry 5 troops.', 5600);
  await page.evaluate(() => document.querySelector('#d-help').close());
  await rec.uncap();
  await sleep(500);

  // ---- conquest ----
  await clickWorld(cap);
  await sleep(300);
  await ringWorld('Wynion', 0, 30);
  await say('A <b>red ring</b> means natives. Send <b>warships first</b>, then <b>troops</b>.', 4600);
  await rec.unhi();
  await rec.click('button[data-act=all][data-t=frigate]');
  await rec.click('button[data-act=all][data-t=transport]');
  await rec.click('button[data-act=target]');
  await clickWorld('Wynion');
  await say('Warships clear the defenders. Transports land more troops than the world has, and it is yours.', 4800);
  await rec.click('button[data-act=research]');
  await rec.hi('#p-empire', 0, 6);
  await say('<b>Research</b> makes your ships stronger and your income higher.', 3800);
  await rec.unhi();
  await endTurn(); await endTurn();
  await say('Ships fly...', 1500);
  await endTurn(); await sleep(900);
  await rec.mark('good');
  await rec.hi('#log', 0, 6);
  await say('<b>Wynion captured.</b> Keep going until the sector is yours.', 3800);
  await rec.unhi();
  await rec.uncap();

  // ---- friends ----
  await rec.click('#b-friends');
  await sleep(700);
  await say('Play with friends. Pick the settings and <b>create a game</b>.', 3200);
  await page.selectOption('#f-online select[name=humans]', '3');
  await rec.click('#f-online button[value=create]');
  await page.waitForSelector('#d-invite[open]', { timeout: 20000 });
  await sleep(600);
  await rec.uncap();
  await say('One <b>link per friend</b>. They tap it and they are in. Nothing to type.', 5200);
  await rec.hi('#invite-list .invite:first-child input', 0, 8);
  await sleep(1800);
  await rec.unhi();
  await rec.uncap();
  await page.evaluate(() => document.querySelector('#d-invite').close());
  await sleep(500);

  // ---- link another device, several games ----
  await rec.click('#p-device button[data-do=device]');
  await page.waitForSelector('#device-qr svg', { timeout: 20000 });
  await sleep(500);
  await say('<b>Link your phone.</b> Scan the code and all your games follow you.', 4800);
  await page.evaluate(() => document.querySelector('#d-device').close());
  await rec.uncap();
  await sleep(400);
  await rec.click('#b-new');
  await sleep(700);
  await say('Run <b>as many games as you like</b>, solo or with friends.', 4200);
  await page.evaluate(() => document.querySelector('#d-games').close());
  await rec.uncap();
  await sleep(300);

  // ---- end card ----
  await rec.card({ kick: 'FREE · IN YOUR BROWSER', title: 'SECTOR<br>DOMINION', line: 'Nothing to install. Play alone or with friends.', pill: 'jroes.github.io/experiments', seed: 5 }, 5200);

  const out = await rec.finish(path.join(ROOT, 'sectordominion', 'intro.mp4'));
  console.log(out);
})().catch(e => { console.error(e); process.exit(1); });
