'use strict';
// Records a scripted run of a page as a video, with captions, a visible cursor, title and end cards, and a generated soundtrack.
// Used by tools/video/sectordominion.js and warptraders.js. Needs Playwright with Chromium, ffmpeg and python3 with numpy.
//
// Frames come from Chrome's screencast (full quality JPEGs with timestamps), not from Playwright's built-in recorder, which
// is limited to about 1 Mbps and makes small text mushy.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const OVERLAY_CSS = `
#vo-cap { position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%) translateY(14px); max-width: 78%; z-index: 99999; pointer-events: none;
  background: rgba(5,7,13,.88); border: 1px solid #5ee0b0; border-radius: 12px; padding: 14px 26px; color: #eaf3ff; font: 600 30px/1.25 ui-monospace, Menlo, Consolas, monospace;
  text-align: center; opacity: 0; transition: opacity .35s, transform .35s; box-shadow: 0 8px 40px rgba(0,0,0,.6), 0 0 24px rgba(94,224,176,.25); }
#vo-cap.on { opacity: 1; transform: translateX(-50%) translateY(0); }
#vo-cap b { color: #5ee0b0; font-weight: 700; }
#vo-hi { position: fixed; z-index: 99998; pointer-events: none; border: 3px solid #ffb454; border-radius: 10px; opacity: 0; transition: opacity .3s, left .35s, top .35s, width .35s, height .35s;
  box-shadow: 0 0 0 9999px rgba(0,0,0,.45), 0 0 26px rgba(255,180,84,.8); }
#vo-hi.on { opacity: 1; animation: vopulse 1.1s ease-in-out infinite; }
@keyframes vopulse { 50% { border-color: #ffe0a8; } }
#vo-cur { position: fixed; z-index: 100000; width: 26px; height: 26px; margin: -4px 0 0 -4px; pointer-events: none; left: -50px; top: -50px; transition: transform .08s; }
#vo-cur svg { filter: drop-shadow(0 2px 4px rgba(0,0,0,.7)); }
#vo-cur.down { transform: scale(.82); }
.vo-ripple { position: fixed; z-index: 99997; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; border: 3px solid #5ee0b0; pointer-events: none; animation: voripple .6s ease-out forwards; }
@keyframes voripple { to { transform: scale(5); opacity: 0; } }
#vo-card { position: fixed; inset: 0; z-index: 100001; background: #05070d; color: #cfe3ff; display: grid; place-items: center; text-align: center; opacity: 1; transition: opacity .9s; font-family: ui-monospace, Menlo, Consolas, monospace; overflow: hidden; }
#vo-card.off { opacity: 0; pointer-events: none; }
#vo-card canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#vo-card .in { position: relative; animation: vozoom 6s ease-out forwards; }
@keyframes vozoom { from { transform: scale(.92); letter-spacing: 2px; } to { transform: scale(1.04); } }
#vo-card .kick { color: #7d90b0; letter-spacing: 8px; font-size: 24px; margin-bottom: 18px; }
#vo-card h1 { margin: 0; font-size: 104px; line-height: 1.02; color: #5ee0b0; letter-spacing: 10px; text-shadow: 0 0 40px rgba(94,224,176,.55); }
#vo-card p { font-size: 34px; margin: 26px 0 0; color: #cfe3ff; }
#vo-card .pill { display: inline-block; margin-top: 34px; border: 2px solid #5ee0b0; color: #5ee0b0; background: #123a2e; padding: 12px 30px; font-size: 30px; border-radius: 10px; }
`;

const OVERLAY_JS = `
(() => {
  if (window.__vo) return;
  const el = (tag, id) => { const e = document.createElement(tag); if (id) e.id = id; return e; };
  const mount = () => {
    if (document.getElementById('vo-cap')) return;
    const st = document.createElement('style'); st.textContent = ${JSON.stringify(OVERLAY_CSS)}; document.head.appendChild(st);
    document.body.append(el('div', 'vo-cap'), el('div', 'vo-hi'));
    const cur = el('div', 'vo-cur');
    cur.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2 L4 20 L9 15.5 L12.5 23 L15.5 21.6 L12 14.2 L19 14 Z" fill="#fff" stroke="#05070d" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(cur);
    window.addEventListener('mousemove', e => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
    window.addEventListener('mousedown', e => {
      cur.classList.add('down');
      const r = document.createElement('div'); r.className = 'vo-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.append(r); setTimeout(() => r.remove(), 700);
    }, true);
    window.addEventListener('mouseup', () => cur.classList.remove('down'), true);
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  window.__vo = {
    cap(html) { const c = document.getElementById('vo-cap'); if (!c) return; if (!html) { c.classList.remove('on'); return; } c.innerHTML = html; c.classList.add('on'); },
    hi(r) { const h = document.getElementById('vo-hi'); if (!h) return; if (!r) { h.classList.remove('on'); return; }
      const pad = r.pad === undefined ? 8 : r.pad; h.style.left = (r.x - pad) + 'px'; h.style.top = (r.y - pad) + 'px'; h.style.width = (r.w + pad * 2) + 'px'; h.style.height = (r.h + pad * 2) + 'px'; h.classList.add('on'); },
    card(opts) {
      let c = document.getElementById('vo-card'); if (c) c.remove();
      c = document.createElement('div'); c.id = 'vo-card';
      c.innerHTML = '<canvas></canvas><div class="in"><div class="kick">' + (opts.kick || '') + '</div><h1>' + opts.title + '</h1><p>' + (opts.line || '') + '</p>' + (opts.pill ? '<span class="pill">' + opts.pill + '</span>' : '') + '</div>';
      document.body.append(c);
      const cv = c.querySelector('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d');
      let a = opts.seed || 7; const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const stars = Array.from({ length: 220 }, () => ({ x: rnd() * 1280, y: rnd() * 720, z: .2 + rnd() * 1 }));
      const cols = ['#5ee0b0', '#ffb454', '#ff6b6b', '#b48cff', '#6b7a94'];
      const worlds = Array.from({ length: 16 }, (_, i) => ({ x: 720 + rnd() * 480, y: 60 + rnd() * 600, r: 6 + rnd() * 14, c: cols[(rnd() * 5) | 0], p: rnd() * 6.28 }));
      let t0 = performance.now();
      const tick = () => {
        if (!c.isConnected) return;
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = '#05070d'; g.fillRect(0, 0, 1280, 720);
        for (const s of stars) { s.x -= s.z * .6; if (s.x < 0) s.x = 1280; g.fillStyle = 'rgba(207,227,255,' + (.25 + s.z * .4) + ')'; g.fillRect(s.x, s.y, 1 + s.z, 1 + s.z); }
        g.strokeStyle = 'rgba(94,224,176,.22)'; g.lineWidth = 2; g.setLineDash([8, 8]);
        for (let i = 0; i < worlds.length; i++) for (let j = i + 1; j < worlds.length; j++) { const A = worlds[i], B = worlds[j];
          if (A.c === B.c && Math.abs(A.x - B.x) + Math.abs(A.y - B.y) < 260) { g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke(); } }
        g.setLineDash([]);
        for (const w of worlds) { const r = w.r * (1 + .08 * Math.sin(t * 2 + w.p)); g.fillStyle = w.c; g.shadowColor = w.c; g.shadowBlur = 24; g.beginPath(); g.arc(w.x, w.y, r, 0, 7); g.fill(); }
        g.shadowBlur = 0;
        requestAnimationFrame(tick);
      };
      tick();
    },
    cardOff() { const c = document.getElementById('vo-card'); if (c) { c.classList.add('off'); setTimeout(() => c.remove(), 1000); } },
  };
})();
`;

class Recorder {
  constructor(opts) {
    this.opts = { width: 1280, height: 720, ...opts };
    this.frames = [];
    this.marks = []; // { t, kind }: where sound effects go
    this.t0 = null;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-'));
  }

  async start() {
    const { width, height } = this.opts;
    this.browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
    this.ctx = await this.browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    if (this.opts.route) await this.opts.route(this.ctx);
    this.page = await this.ctx.newPage();
    this.page.on('dialog', d => d.accept(this.opts.promptAnswer || ''));
    this.page.on('pageerror', e => console.log('page error:', e.message));
    await this.page.addInitScript(OVERLAY_JS);
    if (this.opts.init) await this.page.addInitScript(this.opts.init);
    this.client = await this.ctx.newCDPSession(this.page);
    this.client.on('Page.screencastFrame', async f => {
      const ts = f.metadata.timestamp;
      if (this.t0 === null) this.t0 = ts;
      const file = path.join(this.dir, 'f' + String(this.frames.length).padStart(6, '0') + '.jpg');
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      this.frames.push({ file, ts });
      try { await this.client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) { /* closing */ }
    });
    await this.page.goto(this.opts.url);
    await this.client.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    this.wall0 = Date.now() / 1000;
    return this.page;
  }

  now() { return Date.now() / 1000 - this.wall0; }
  mark(kind) { this.marks.push({ t: Date.now() / 1000, kind }); }
  async wait(ms) { await sleep(ms); }

  async cap(html, ms) { await this.page.evaluate(h => window.__vo.cap(h), html); if (ms) await sleep(ms); }
  async uncap() { await this.page.evaluate(() => window.__vo.cap('')); }
  async card(opts, ms) { this.mark('hit'); await this.page.evaluate(o => window.__vo.card(o), opts); if (ms) await sleep(ms); }
  async cardOff() { await this.page.evaluate(() => window.__vo.cardOff()); await sleep(900); }

  // ring around an element (by selector) or a rectangle { x, y, w, h }
  async hi(target, ms, pad) {
    let r = target;
    if (typeof target === 'string') {
      const b = await this.page.locator(target).first().boundingBox();
      if (!b) throw new Error('nothing to highlight for ' + target);
      r = { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    await this.page.evaluate(([rr, p]) => window.__vo.hi({ ...rr, pad: p }), [r, pad]);
    if (ms) await sleep(ms);
  }
  async unhi() { await this.page.evaluate(() => window.__vo.hi(null)); }

  async moveTo(x, y, steps) {
    await this.page.mouse.move(x, y, { steps: steps || 22 });
  }
  async clickAt(x, y) {
    await this.moveTo(x, y);
    await sleep(120);
    this.mark('click');
    await this.page.mouse.down(); await sleep(70); await this.page.mouse.up();
    await sleep(260);
  }
  async click(selector) {
    const loc = this.page.locator(selector).first();
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error('nothing to click for ' + selector);
    await this.clickAt(b.x + b.width / 2, b.y + b.height / 2);
  }

  async finish(outFile) {
    await this.client.send('Page.stopScreencast');
    await sleep(300);
    const dur = this.now();
    await this.browser.close();
    if (this.frames.length < 2) throw new Error('no frames captured');
    // timeline: each frame lasts until the next one
    const list = [];
    for (let i = 0; i < this.frames.length; i++) {
      const next = i + 1 < this.frames.length ? this.frames[i + 1].ts : this.frames[i].ts + 0.5;
      list.push("file '" + this.frames[i].file + "'", 'duration ' + Math.max(0.001, next - this.frames[i].ts).toFixed(4));
    }
    list.push("file '" + this.frames[this.frames.length - 1].file + "'");
    const listFile = path.join(this.dir, 'list.txt');
    fs.writeFileSync(listFile, list.join('\n'));
    const total = this.frames[this.frames.length - 1].ts - this.frames[0].ts + 0.5;
    const silent = path.join(this.dir, 'silent.mp4');
    let r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-movflags', '+faststart', silent], { stdio: 'inherit' });
    if (r.status) throw new Error('ffmpeg failed');
    // sound
    const wav = path.join(this.dir, 'sound.wav');
    const marks = this.marks.map(m => ({ t: Math.max(0, m.t - this.frames[0].ts), kind: m.kind }));
    fs.writeFileSync(path.join(this.dir, 'marks.json'), JSON.stringify({ duration: total, marks, seed: this.opts.musicSeed || 1 }));
    r = spawnSync('python3', [path.join(__dirname, 'music.py'), path.join(this.dir, 'marks.json'), wav], { stdio: 'inherit' });
    if (r.status) throw new Error('music failed');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', outFile], { stdio: 'inherit' });
    if (r.status) throw new Error('mux failed');
    // a poster frame from about a third of the way in
    if (this.opts.poster) spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(this.opts.posterAt || 4), '-i', outFile, '-frames:v', '1', '-q:v', '3', this.opts.poster], { stdio: 'inherit' });
    return { seconds: total, frames: this.frames.length, dir: this.dir };
  }
}

module.exports = { Recorder, sleep };
