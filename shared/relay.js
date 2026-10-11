/*
 * Client for the tiny relay in /relay (a Cloudflare Worker, or the same code on any Node host).
 * The relay is only a write-once message board per game room. It never runs the game.
 */
(function (root) {
  'use strict';

  const LIMIT_CODE = 15000;
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

  function randomId(len, alphabet) {
    alphabet = alphabet || ALPHABET;
    const bytes = new Uint8Array(len);
    (root.crypto || require('node:crypto').webcrypto).getRandomValues(bytes);
    // 256 is not a multiple of the alphabet size, so drop the biased tail
    let out = '';
    const limit = 256 - (256 % alphabet.length);
    while (out.length < len) {
      for (const b of bytes) if (b < limit && out.length < len) out += alphabet[b % alphabet.length];
      if (out.length < len) (root.crypto || require('node:crypto').webcrypto).getRandomValues(bytes);
    }
    return out;
  }

  async function sha256hex(s) {
    const subtle = (root.crypto || require('node:crypto').webcrypto).subtle;
    const d = await subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // https only, except for a relay running on this machine
  function cleanBase(url) {
    try {
      const u = new URL(String(url).trim());
      const local = ['localhost', '127.0.0.1'].includes(u.hostname);
      if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
      return u.origin;
    } catch (e) { return null; }
  }

  async function call(base, method, path, opts) {
    opts = opts || {};
    const headers = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers['x-seat'] = opts.token;
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), cache: 'no-store' });
    } catch (e) {
      throw new Error('Could not reach the relay.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { status: res.status, data };
  }

  const room = r => '/v1/rooms/' + r;

  const api = {
    LIMIT_CODE, randomId, sha256hex, cleanBase, call,
    health: base => call(base, 'GET', '/v1/health'),
    create: (base, r, humans, seats) => call(base, 'POST', room(r), { body: { humans, seats } }),
    meta: (base, r) => call(base, 'GET', room(r) + '/meta'),
    sync: (base, r, turn) => call(base, 'GET', room(r) + '/sync/' + turn),
    range: (base, r, from, to) => call(base, 'GET', room(r) + '/orders?from=' + from + '&to=' + to),
    putOrders: (base, r, turn, seat, token, blob) => call(base, 'PUT', room(r) + '/orders/' + turn + '/' + seat, { body: blob, token }),
    skip: (base, r, turn, seat, hostToken, ai) => call(base, 'PUT', room(r) + '/skip/' + turn + '/' + seat, { body: ai ? { ai: true } : {}, token: hostToken }),
    putHash: (base, r, turn, seat, token, h) => call(base, 'PUT', room(r) + '/hash/' + turn + '/' + seat, { body: { h }, token }),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Relay = api;
})(typeof window !== 'undefined' ? window : globalThis);
