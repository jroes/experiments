'use strict';
// Serves the game from the local repo as if it were on GitHub Pages, and the shared store from a local elf-punch, so the video
// shows the real address and works without any network. Start the server first (see CLAUDE.md, "Testing").
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.mp4': 'video/mp4', '.jpg': 'image/jpeg' };

function route(kvPort) {
  return async ctx => {
    await ctx.route('https://jroes.github.io/experiments/**', async r => {
      const u = new URL(r.request().url());
      let rel = decodeURIComponent(u.pathname.replace(/^\/experiments\/?/, ''));
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) return r.fulfill({ status: 404, body: 'not found' });
      await r.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await ctx.route('https://elf-castle-wood-puncher.fly.dev/**', async r => {
      const u = new URL(r.request().url());
      const res = await r.fetch({ url: 'http://127.0.0.1:' + kvPort + u.pathname + u.search });
      await r.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after' } });
    });
  };
}
module.exports = { route, ROOT };
