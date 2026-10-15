// Renders jetfall/og.png, the link-preview picture, from the real game in Chromium (via Playwright).
// Needs the repo served on port 8199: python3 -m http.server 8199, then node tools/jetfall-og.js
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.route('**/elf-castle-wood-puncher.fly.dev/**', r => r.abort());
  await p.addInitScript(() => localStorage.setItem('jetfall-v1', JSON.stringify({ name: 'og', host: { map: 'highland', solo: { bots: 6, skill: 0.8 } }, quality: 'high' })));
  await p.goto('http://127.0.0.1:8199/jetfall/');
  await p.waitForTimeout(800);
  await p.click('#playBots');
  await p.waitForTimeout(18000); // let the bots get going
  await p.evaluate(() => {
    const w = JFGame.session.client.world, o = w.bases[1].o;
    const pos = [o.x + 62 * o.face, w.terrain.padH + 24, o.z - 40 * o.face];
    const dx = o.x - pos[0], dz = o.z - pos[2];
    JFGame.cam = { pos, yaw: Math.atan2(-dx, -dz) - 0.25, pitch: -0.2 };
    document.getElementById('hud').style.visibility = 'hidden';
    JFGame.renderer.q = Object.assign({}, JFGame.renderer.q, { grain: 0 }); // grain does not compress
    const t = document.createElement('div');
    t.innerHTML = '<div style="font:bold 96px ui-monospace,Menlo,monospace;letter-spacing:18px;color:#fff;text-shadow:0 0 24px rgba(94,224,176,.6),5px 5px 0 #ff7a3d,-5px -5px 0 #4fb3ff">JETFALL</div><div style="font:28px ui-monospace,Menlo,monospace;color:#fff;text-shadow:0 2px 6px #000">jetpacks · skiing · capture the flag</div>';
    t.style.cssText = 'position:fixed;left:56px;bottom:48px;z-index:9';
    document.body.appendChild(t);
  });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(__dirname, '..', 'jetfall', 'og.png') });
  await b.close();
})();
