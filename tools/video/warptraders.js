'use strict';
// node tools/video/warptraders.js  ->  warptraders/intro.mp4 (+ intro.jpg)
// Seed 112 was picked by searching seeds for a short loop with no pirates and a big first profit (see CLAUDE.md).
const path = require('path');
const { Recorder, sleep } = require('./lib');
const { route, ROOT } = require('./common');

const SEED = '112';

(async () => {
  const rec = new Recorder({
    url: 'https://jroes.github.io/experiments/warptraders/',
    route: route(process.env.KV_PORT || 8135),
    promptAnswer: SEED,
    musicSeed: 9, zoom: 1.05,
    poster: path.join(ROOT, 'warptraders', 'intro.jpg'), posterAt: 12,
    init: `try { if (!localStorage.getItem('wt-vo')) { localStorage.setItem('wt-vo','1'); localStorage.setItem('warptraders-help-seen','1'); } } catch (e) {}`,
  });
  const page = await rec.start();
  await rec.capAt('31%', '56%');
  const K = 0.72; // pace: captions stay up this fraction of the time first planned
  const say = (t, ms) => rec.cap(t, ms && Math.round(ms * K));
  const sectorXY = async id => {
    const { s, W, H } = await page.evaluate(() => ({ s: JSON.parse(localStorage.getItem('warptraders-save-v1')), W: WT.W, H: WT.H }));
    const sec = s.sectors[id];
    const r = await page.locator('#map').boundingBox();
    const sc = Math.min(r.width / (W + 4), r.height / (H + 4));
    return { x: r.x + (r.width - W * sc) / 2 + sec.x * sc, y: r.y + (r.height - H * sc) / 2 + sec.y * sc };
  };
  const clickSector = async id => { const p = await sectorXY(id); await rec.clickAt(p.x, p.y); await sleep(500); };
  const ringSector = async (id, ms) => { const p = await sectorXY(id); await rec.hi({ x: p.x - 22, y: p.y - 22, w: 44, h: 44 }, ms, 4); };
  const trade = async (act, good) => { await rec.click(`button[data-act=max][data-g=${good}]`); await sleep(250); await rec.click(`button[data-act=${act}][data-g=${good}]`); };

  // ---- title card, with the seeded game set up underneath ----
  await rec.card({ kick: 'A SPACE TRADING GAME', title: 'WARP<br>TRADERS', line: 'Buy low. Sell high. Beat the clock.', seed: 21 }, 300);
  await page.evaluate(() => document.getElementById('b-new').click());
  await sleep(4200);
  await rec.cardOff();
  await sleep(400);

  // ---- the goal ----
  await say('You fly a freighter between sectors. <b>Make as many credits as you can</b> before the turns run out.', 5200);
  const stats = await page.evaluate(() => { const st = document.querySelectorAll('#topbar .stat'); const a = st[0].getBoundingClientRect(), b = st[2].getBoundingClientRect(); return { x: a.left, y: a.top, w: b.right - a.left, h: a.height }; });
  await rec.hi(stats, 0, 8);
  await say('<b>400 turns.</b> Every warp costs one. You start with 1,000 credits.', 4200);
  await rec.unhi();
  await rec.hi('#map', 0, 0);
  await say('The map shows sectors and the warp lanes between them. <b>Gold is Stardock</b>, your home base.', 4800);
  await rec.unhi();

  // ---- go to the first port ----
  await ringSector(1, 0);
  await say('<b>Click a sector</b> to fly there. Each hop costs a turn.', 3000);
  await rec.unhi();
  await clickSector(1);
  await sleep(500);
  await rec.hi('#p-sector', 0, 6);
  await say('Ports <b>sell</b> some goods and <b>buy</b> others. Cheap when they have lots, dear when they run low.', 5800);
  await rec.unhi();

  // ---- buy ----
  await rec.hi('button[data-act=max][data-g=organics]', 0, 20);
  await say('This port sells <b>Organics</b> cheap. <b>max</b> fills your holds.', 3600);
  await rec.unhi();
  await trade('buy', 'organics');
  await rec.mark('good');
  await sleep(500);
  await say('Bought. Now find someone who <b>pays more</b>.', 2800);

  // ---- sell high ----
  await clickSector(5);
  await sleep(700);
  await say('Sector 6 <b>buys</b> Organics. Same goods, a much better price.', 4000);
  await trade('sell', 'organics');
  await rec.mark('good');
  await rec.hi('#log', 0, 6);
  await say('<b>Sold at a profit.</b> That is the whole game.', 3200);
  await rec.unhi();

  // ---- and back ----
  await say('Never fly empty. This port sells <b>Equipment</b>, and the last one buys it.', 4200);
  await trade('buy', 'equipment');
  await clickSector(1);
  await sleep(600);
  await trade('sell', 'equipment');
  await rec.mark('good');
  await rec.hi(stats, 0, 8);
  await say('<b>Doubled your money in 3 turns.</b> Now do it for 400.', 4600);
  await rec.unhi();

  // ---- the rest ----
  await rec.click('#b-help');
  await sleep(500);
  await say('Watch for <b>pirates</b>: fight, pay a toll, or flee. <b>Stardock</b> sells holds and fighters.', 6200);
  await page.evaluate(() => document.querySelector('#d-help').close());
  await rec.uncap();
  await sleep(400);
  await rec.hi('#b-new', 0, 8);
  await say('Same <b>seed</b> means the same galaxy. Share yours and compare scores with friends.', 5200);
  await rec.unhi();
  await rec.uncap();

  await rec.card({ kick: 'FREE · IN YOUR BROWSER', title: 'WARP<br>TRADERS', line: 'Nothing to install. 400 turns. How rich can you get?', pill: 'jroes.github.io/experiments', seed: 8 }, 5200);
  const out = await rec.finish(path.join(ROOT, 'warptraders', 'intro.mp4'));
  console.log(out);
})().catch(e => { console.error(e); process.exit(1); });
