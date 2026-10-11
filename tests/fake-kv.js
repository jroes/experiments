'use strict';
// An in-memory stand-in for the elf-punch /kv API (same status codes and shapes), so the lockstep tests run fast.
// The real thing is tested separately: set KV_URL to run the same tests against the real binary.
function installFakeKv(opts) {
  opts = opts || {};
  const spaces = new Map(); // ns -> Map(key -> {value, rev, t})
  const calls = [];
  let rev = 0;
  const json = (status, obj, headers) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...(headers || {}) } });
  const err = (status, code, msg) => json(status, { error: msg || code, code });

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method, path: u.pathname + u.search });
    if (opts.intercept) { const r = opts.intercept({ method, url: u, headers }); if (r) return r; }
    const m = /^\/kv\/([a-z0-9_-]{1,40})(?:\/([A-Za-z0-9_.:-]{1,100}))?$/.exec(u.pathname);
    if (!m) return err(400, 'bad_namespace');
    const [, ns, key] = m;
    const space = spaces.get(ns);
    if (method === 'GET' && !key) {
      const keys = u.searchParams.get('keys');
      if (keys === null) return err(404, 'no_listing');
      const names = keys.split(',');
      if (!keys || names.length > 60 || names.some(k => !/^[A-Za-z0-9_.:-]{1,100}$/.test(k))) return err(400, 'bad_key');
      const values = {};
      for (const k of names) if (space && space.has(k)) values[k] = { value: space.get(k).value, rev: space.get(k).rev, t: 1 };
      return json(200, { values });
    }
    if (!key) return err(405, 'method_not_allowed');
    if (method === 'GET') {
      const e = space && space.get(key);
      return e ? json(200, { value: e.value, rev: e.rev, t: 1 }) : err(404, 'not_found');
    }
    if (method === 'PUT') {
      const body = init.body === undefined ? 'null' : init.body;
      if (body.length > 65536) return err(413, 'too_large');
      let value;
      try { value = JSON.parse(body); } catch (e) { return err(400, 'bad_json'); }
      const cur = space && space.get(key);
      if (headers['if-none-match'] === '*' && cur) return err(412, 'exists');
      if (headers['if-match'] !== undefined && (!cur || String(cur.rev) !== String(headers['if-match']).replace(/"/g, ''))) return err(412, 'rev_mismatch');
      if (!spaces.has(ns)) spaces.set(ns, new Map());
      spaces.get(ns).set(key, { value, rev: ++rev });
      return json(cur ? 200 : 201, { rev, created: !cur });
    }
    if (method === 'DELETE') {
      const had = !!(space && space.delete(key));
      return json(200, { deleted: had });
    }
    return err(405, 'method_not_allowed');
  };
  return { spaces, calls, set(ns, key, value) { if (!spaces.has(ns)) spaces.set(ns, new Map()); spaces.get(ns).set(key, { value, rev: ++rev }); } };
}
module.exports = { installFakeKv };
