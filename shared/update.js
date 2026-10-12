/*
 * Tells you when a new version of the site has been deployed, and lets you pick it up without losing anything.
 *
 * The deploy writes the commit it deployed into /version.json (and into shared/version.js, which each page loads, so the page knows
 * which version it is). Every few minutes while the page is visible, this asks for version.json again. If the answer is different, a
 * small bar says "A new version is ready" with Refresh and Later. Nothing reloads by itself, so it never interrupts a turn.
 * Refresh first writes down every game (the page passes in `beforeReload`), then reloads.
 */
(function (root) {
  'use strict';

  const POLL_MS = 5 * 60 * 1000;

  // What a fetched version.json means for a page of version `current`: 'update' only for a real, different version.
  function decide(current, body) {
    if (typeof current !== 'string' || !current || current === 'dev') return 'none';
    let o = body;
    if (typeof body === 'string') { try { o = JSON.parse(body); } catch (e) { return 'none'; } }
    if (!o || typeof o !== 'object' || typeof o.version !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(o.version)) return 'none';
    return o.version === current ? 'none' : 'update';
  }

  const U = {
    decide,

    // opts: { url: where version.json is, relative to the page; beforeReload: () => void, current: this page's version }
    start(opts) {
      opts = opts || {};
      const current = opts.current !== undefined ? opts.current : root.APP_VERSION;
      if (!current || current === 'dev' || !root.document) return null;
      const url = opts.url || '../version.json';
      let dismissed = null, last = 0, bar = null, latest = null;

      async function check() {
        last = Date.now();
        let body = null;
        try {
          const res = await root.fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
          if (!res.ok) return;
          body = await res.json();
        } catch (e) { return; } // offline, or no version.json (a local copy): nothing to say
        if (decide(current, body) === 'update' && body.version !== dismissed) show(body.version);
      }

      function show(version) {
        latest = version;
        if (bar) { bar.hidden = false; root.dispatchEvent(new root.Event('resize')); return; }
        const d = root.document;
        bar = d.createElement('div');
        bar.id = 'update-bar'; bar.setAttribute('role', 'status');
        bar.style.cssText = 'flex:none;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;' +
          'padding:8px 12px;padding-top:calc(8px + env(safe-area-inset-top));background:#123a2e;color:#cfe3ff;border-bottom:1px solid #5ee0b0;font:inherit;text-align:center';
        const msg = d.createElement('span');
        msg.textContent = 'A new version is ready. Refresh to get it. Your games are saved first.';
        const go = d.createElement('button'); go.textContent = 'Refresh'; go.className = 'primary';
        const later = d.createElement('button'); later.textContent = 'Later';
        go.onclick = () => {
          go.disabled = true; go.textContent = 'Saving...';
          try { if (opts.beforeReload) opts.beforeReload(); } catch (e) { /* the page also saves when it closes */ }
          root.location.reload();
        };
        later.onclick = () => { dismissed = latest; bar.hidden = true; root.dispatchEvent(new root.Event('resize')); };
        bar.append(msg, go, later);
        d.body.insertBefore(bar, d.body.firstChild); // in the page's flow, so it pushes the game down instead of covering its buttons
        root.dispatchEvent(new root.Event('resize')); // and the map refits to the room that is left
      }

      setTimeout(check, 8000);
      root.setInterval(() => { if (!root.document.hidden) check(); }, POLL_MS);
      root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden && Date.now() - last > 60000) check(); });
      return { check };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = U;
  else root.Updater = U;
})(typeof window !== 'undefined' ? window : globalThis);
