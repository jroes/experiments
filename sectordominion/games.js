/*
 * The list of games on this device. You can be in several at once: solo games and games with friends.
 *
 * Each game's data lives under its own localStorage key, and one small index says which games exist and which is open.
 * Nothing here knows about the rules. It only keeps track of what is stored where, so it runs under node for the tests.
 */
(function (root) {
  'use strict';

  const INDEX_KEY = 'sectordominion-games-v2';
  const PREFIX = 'sectordominion-g-';
  const LEGACY_SOLO = 'sectordominion-save-v1';      // before there was a list: one solo game
  const LEGACY_ONLINE = 'sectordominion-online-v1';  // and one game with friends
  const MAX_GAMES = 24;
  const ID_RE = /^[a-z0-9]{8}$/;

  function newId() {
    const crypto = root.crypto || require('node:crypto').webcrypto;
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  }

  class Library {
    constructor(storage) {
      this.storage = storage;
      this.list = [];     // [{ id, kind: 'solo' | 'online' }], in the order they were added
      this.active = null; // id of the game that is open
    }

    // ----- storage that may be missing or full: never throws -----
    _get(k) { try { return this.storage.getItem(k); } catch (e) { return null; } }
    _set(k, v) { try { this.storage.setItem(k, v); return true; } catch (e) { return false; } }
    _del(k) { try { this.storage.removeItem(k); } catch (e) { /* ignore */ } }
    _json(k) { try { return JSON.parse(this._get(k)); } catch (e) { return null; } }

    load() {
      const idx = this._json(INDEX_KEY);
      this.list = []; this.active = null;
      if (idx && Array.isArray(idx.list)) {
        const seen = new Set();
        for (const g of idx.list) {
          if (!g || !ID_RE.test(g.id) || seen.has(g.id) || (g.kind !== 'solo' && g.kind !== 'online')) continue;
          if (this._get(PREFIX + g.id) === null) continue; // the data is gone: forget the game
          seen.add(g.id); this.list.push({ id: g.id, kind: g.kind });
        }
        if (this.list.some(g => g.id === idx.active)) this.active = idx.active;
      } else this._migrate();
      if (!this.active && this.list.length) this.active = this.list[this.list.length - 1].id;
      this._save();
      return this;
    }

    // from the single-game version of the app: keep whatever was saved as games in the list
    _migrate() {
      const solo = this._get(LEGACY_SOLO), online = this._get(LEGACY_ONLINE);
      let soloId = null, onlineId = null;
      if (solo) { soloId = newId(); if (this._set(PREFIX + soloId, solo)) this.list.push({ id: soloId, kind: 'solo' }); }
      if (online) { onlineId = newId(); if (this._set(PREFIX + onlineId, online)) this.list.push({ id: onlineId, kind: 'online' }); }
      this.active = onlineId || soloId; // the old app opened the game with friends first
      if (this.list.length) { this._del(LEGACY_SOLO); this._del(LEGACY_ONLINE); }
    }

    _save() { this._set(INDEX_KEY, JSON.stringify({ v: 2, active: this.active, list: this.list })); }

    get full() { return this.list.length >= MAX_GAMES; }
    has(id) { return this.list.some(g => g.id === id); }
    kind(id) { const g = this.list.find(x => x.id === id); return g ? g.kind : null; }

    // Adds an empty slot for a game and opens it. The caller writes the game with write().
    add(kind) {
      if (kind !== 'solo' && kind !== 'online') throw new Error('Unknown kind of game.');
      if (this.full) throw new Error('You are in ' + MAX_GAMES + ' games. Delete one first.');
      let id;
      do { id = newId(); } while (this.has(id));
      this.list.push({ id, kind });
      this.active = id;
      this._save();
      return id;
    }

    setActive(id) { if (this.has(id)) { this.active = id; this._save(); } }

    // Forgets a game and its data. Returns the id that is open afterwards (the newest one left), or null if none is.
    remove(id) {
      if (!this.has(id)) return this.active;
      this.list = this.list.filter(g => g.id !== id);
      this._del(PREFIX + id);
      if (this.active === id) this.active = this.list.length ? this.list[this.list.length - 1].id : null;
      this._save();
      return this.active;
    }

    read(id) { return this.has(id) ? this._json(PREFIX + id) : null; }
    write(id, payload) { return this.has(id) ? this._set(PREFIX + id, JSON.stringify(payload)) : false; }
  }

  const api = { Library, MAX_GAMES, INDEX_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Games = api;
})(typeof window !== 'undefined' ? window : globalThis);
