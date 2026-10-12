// Renders the link-preview images with Chromium (via Playwright): node tools/make-og.js
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const page = 'file://' + path.join(__dirname, 'og.html');
  for (const [v, out] of [['game', 'sectordominion/og.png'], ['invite', 'j/invite.png']]) {
    await p.goto(page + '?v=' + v);
    await p.screenshot({ path: path.join(__dirname, '..', out) });
  }
  await b.close();
})();
