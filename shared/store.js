/*
 * Client for the shared key/value store in /elf-punch (GET/PUT /kv/<namespace>/<key>).
 *
 * There are no accounts. A game lives in one namespace whose name is long and random, and the server will not list
 * keys, so you can only read what you already know the name of. Everything read back is treated as untrusted.
 */
(function (root) {
  'use strict';

  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const KEYS_PER_READ = 60; // the server's limit for one ?keys= request
  const LIMIT_CODE = 8000;  // characters in one orders code

  function randomId(len, alphabet) {
    alphabet = alphabet || ALPHABET;
    const crypto = root.crypto || require('node:crypto').webcrypto;
    const limit = 256 - (256 % alphabet.length); // drop the biased tail so every letter is equally likely
    let out = '';
    while (out.length < len) {
      const bytes = new Uint8Array(len);
      crypto.getRandomValues(bytes);
      for (const b of bytes) if (b < limit && out.length < len) out += alphabet[b % alphabet.length];
    }
    return out;
  }

  // https only, except for a server running on this machine
  function cleanBase(url) {
    try {
      const u = new URL(String(url).trim());
      const local = ['localhost', '127.0.0.1'].includes(u.hostname);
      if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
      return u.origin;
    } catch (e) { return null; }
  }

  const nsName = room => 'sdo-' + room;
  const orderKey = (turn, seat) => 'o-' + turn + '-' + seat;
  const presenceKey = seat => 'p-' + seat;

  async function call(base, method, path, opts) {
    opts = opts || {};
    const headers = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.ifNoneMatch) headers['if-none-match'] = '*';
    if (opts.ifMatch !== undefined) headers['if-match'] = String(opts.ifMatch);
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), cache: 'no-store' });
    } catch (e) {
      throw new Error('Could not reach the game server.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty or not JSON */ }
    const retry = res.headers && res.headers.get && Number(res.headers.get('retry-after'));
    return { status: res.status, data, retryAfter: Number.isFinite(retry) ? retry : null };
  }

  // Read keys by exact name, in as many requests as needed. Returns { status, values: { key: value } }.
  async function readKeys(base, room, keys) {
    const values = {};
    let now = null;
    for (let i = 0; i < keys.length; i += KEYS_PER_READ) {
      const r = await call(base, 'GET', '/kv/' + nsName(room) + '?keys=' + keys.slice(i, i + KEYS_PER_READ).join(','));
      if (r.status !== 200 || !r.data || typeof r.data.values !== 'object' || r.data.values === null) return { status: r.status, data: r.data, retryAfter: r.retryAfter, values: {} };
      for (const [k, v] of Object.entries(r.data.values)) if (v && typeof v === 'object') values[k] = { value: v.value, rev: v.rev, t: Number.isFinite(v.t) ? v.t : null };
      if (Number.isFinite(r.data.now)) now = r.data.now;
    }
    // `now` is the server's clock, so age = now - t never depends on anybody's computer being set right. Older servers do not
    // send it; then the newest write we can see is the best guess.
    if (now === null) for (const v of Object.values(values)) if (v.t !== null && (now === null || v.t > now)) now = v.t;
    return { status: 200, values, now };
  }

  // Write a key only if nobody has yet. The server does this atomically, so exactly one writer wins.
  //   201 won, 200 it already holds exactly this value (a retry), 409 it holds something else (returned as `existing`).
  // `valid(value)` says whether an existing value is real. Junk that a stranger dropped there is replaced.
  async function putOnce(base, room, key, value, valid) {
    const path = '/kv/' + nsName(room) + '/' + key;
    const r = await call(base, 'PUT', path, { body: value, ifNoneMatch: true });
    if (r.status === 201) return { status: 201 };
    if (r.status !== 412) return r;
    const cur = await call(base, 'GET', path);
    if (cur.status === 404) return putOnce(base, room, key, value, valid); // deleted in between: try again
    if (cur.status !== 200 || !cur.data) return cur;
    if (JSON.stringify(cur.data.value) === JSON.stringify(value)) return { status: 200, existing: true };
    if (valid && !valid(cur.data.value)) {
      const over = await call(base, 'PUT', path, { body: value, ifMatch: cur.data.rev });
      if (over.status === 200 || over.status === 201) return { status: 201, replacedJunk: true };
      if (over.status === 412) return { status: 409, existing: undefined }; // someone changed it meanwhile
      return over;
    }
    return { status: 409, existing: cur.data.value };
  }

  const api = {
    LIMIT_CODE, KEYS_PER_READ, randomId, cleanBase, call, nsName, orderKey, presenceKey, readKeys, putOnce,
    // "I am here": overwrites my presence key. The server stamps the write time, which is what decides online or not.
    // `name` is optional: what the player likes to be called, so friends see it next to "online".
    beat: (base, room, seat, name) => call(base, 'PUT', '/kv/' + nsName(room) + '/' + presenceKey(seat), { body: name ? { v: 1, name } : { v: 1 } }),
    // the game's meta row: who is playing and with what rules
    createGame: (base, room, meta) => call(base, 'PUT', '/kv/' + nsName(room) + '/meta', { body: meta, ifNoneMatch: true }),
    readMeta: async (base, room) => {
      const r = await call(base, 'GET', '/kv/' + nsName(room) + '/meta');
      return { status: r.status, retryAfter: r.retryAfter, value: r.data && r.data.value };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
