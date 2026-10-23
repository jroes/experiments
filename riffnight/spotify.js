/*
 * Spotify as a remote: log in, search, pick a speaker, start a track there, and know when it ends.
 * The notes come from listening (game.js Jam): Spotify's API no longer gives out a song's beats or audio, and its in-browser
 * player does not run on phones, so the music plays in the Spotify app or on a speaker and the mic hears it.
 *
 * Login is OAuth with PKCE: no secret, only a client ID (public by design). The owner makes an app at
 * developer.spotify.com, adds this page's address as a redirect URI, and puts the ID in RN_SPOTIFY_CLIENT_ID below (or pastes
 * it in Settings). An app in development mode works for its owner and up to four people they add, all with Premium.
 * The cleaners at the bottom run under node; everything else is browser only.
 */
(function (root) {
  'use strict';

  // Set this to the app's client ID. Not a secret: it is sent in every login link.
  const CLIENT_ID = '';
  const SCOPES = 'user-read-playback-state user-modify-playback-state';
  const KEY = 'riffnight-spotify-v1';
  const str = (x, n) => (typeof x === 'string' ? x : '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n || 200);

  // ---------- what Spotify sends back is checked before use ----------
  function cleanTrack(t) {
    if (!t || typeof t !== 'object' || typeof t.uri !== 'string' || !/^spotify:track:[A-Za-z0-9]{1,40}$/.test(t.uri)) return null;
    const artists = Array.isArray(t.artists) ? t.artists.slice(0, 4).map(a => str(a && a.name, 80)).filter(Boolean) : [];
    const ms = typeof t.duration_ms === 'number' && Number.isFinite(t.duration_ms) && t.duration_ms > 0 ? Math.min(t.duration_ms, 3600000) : 0;
    return { uri: t.uri, name: str(t.name, 120) || 'Untitled', artists: artists.join(', '), ms };
  }
  function cleanDevices(d) {
    const list = d && Array.isArray(d.devices) ? d.devices : [];
    return list.slice(0, 20).map(x => x && typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x.id)
      ? { id: x.id, name: str(x.name, 60) || 'Device', type: str(x.type, 20), active: x.is_active === true, restricted: x.is_restricted === true } : null).filter(Boolean);
  }
  function cleanState(s) {
    if (!s || typeof s !== 'object') return { playing: false, track: null, progress: 0 };
    const p = typeof s.progress_ms === 'number' && Number.isFinite(s.progress_ms) ? Math.max(0, s.progress_ms) : 0;
    return { playing: s.is_playing === true, track: cleanTrack(s.item), progress: p };
  }
  function cleanTokens(o) {
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object' || typeof o.access !== 'string' || !o.access) return null;
    return { access: str(o.access, 2000), refresh: str(o.refresh, 2000), exp: typeof o.exp === 'number' && Number.isFinite(o.exp) ? o.exp : 0 };
  }
  // the track is over: it played to its end, stopped near the end, or something else is on now
  function trackOver(state, uri, ms) {
    if (!state.track || state.track.uri !== uri) return true;
    const end = (state.track.ms || ms) - 1500;
    return state.progress >= end || (!state.playing && state.progress >= end - 2000);
  }

  const api = { CLIENT_ID, cleanTrack, cleanDevices, cleanState, cleanTokens, trackOver };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---------- browser ----------
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  let tokens = cleanTokens(ls.get(KEY));
  const clientId = () => root.RN_SPOTIFY_CLIENT_ID || ls.get(KEY + '-client') || CLIENT_ID;
  const redirect = () => location.origin + location.pathname;
  const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomText = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0, n); };

  function store(t) { tokens = t; ls.set(KEY, t ? JSON.stringify(t) : null); }

  async function login() {
    const id = clientId();
    if (!id) throw new Error('Spotify is not set up yet. It needs a client ID (see Help).');
    if (!crypto.subtle) throw new Error('Logging in needs a secure page (https).');
    const verifier = randomText(64), state = randomText(16);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    sessionStorage.setItem(KEY + '-pkce', JSON.stringify({ verifier, state }));
    const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: redirect(), code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state });
    location.assign('https://accounts.spotify.com/authorize?' + q);
  }

  async function tokenCall(params) {
    const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId(), ...params }) });
    let d = null;
    try { d = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || !d || typeof d.access_token !== 'string') throw new Error('Spotify said no to the login' + (d && d.error ? ' (' + str(d.error, 40) + ')' : '') + '.');
    const ttl = typeof d.expires_in === 'number' && Number.isFinite(d.expires_in) ? d.expires_in : 3600;
    store({ access: d.access_token, refresh: typeof d.refresh_token === 'string' ? d.refresh_token : (tokens && tokens.refresh) || '', exp: Date.now() + (ttl - 60) * 1000 });
  }

  // Back from Spotify's login page with ?code=...: trade it for tokens and tidy the address. Returns true if it did.
  async function finish() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return false;
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(KEY + '-pkce')); } catch (e) { /* none */ }
    sessionStorage.removeItem(KEY + '-pkce');
    const clean = () => { for (const k of ['code', 'state', 'error']) q.delete(k); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); };
    if (q.has('error') || !saved || saved.state !== q.get('state')) { clean(); throw new Error(q.has('error') ? 'Spotify login was cancelled.' : 'That Spotify login did not match. Try again.'); }
    const code = q.get('code');
    clean();
    await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirect(), code_verifier: saved.verifier });
    return true;
  }

  async function call(method, path, body, retried) {
    if (!tokens) throw new Error('Log in to Spotify first.');
    if (Date.now() > tokens.exp && tokens.refresh) await tokenCall({ grant_type: 'refresh_token', refresh_token: tokens.refresh });
    let res;
    try {
      res = await fetch('https://api.spotify.com/v1' + path, { method, headers: { authorization: 'Bearer ' + tokens.access, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new Error('Could not reach Spotify.'); }
    if (res.status === 401 && !retried && tokens.refresh) {
      try { await tokenCall({ grant_type: 'refresh_token', refresh_token: tokens.refresh }); } catch (e) { store(null); throw new Error('Log in to Spotify again.'); }
      return call(method, path, body, true);
    }
    if (res.status === 204 || res.status === 202) return null;
    let d = null;
    try { d = await res.json(); } catch (e) { /* empty */ }
    if (res.ok) return d;
    const reason = d && d.error && typeof d.error === 'object' ? str(d.error.reason || d.error.message, 80) : '';
    if (res.status === 401) { store(null); throw new Error('Log in to Spotify again.'); }
    if (res.status === 403) throw new Error(/PREMIUM/i.test(reason) ? 'Starting songs from here needs Spotify Premium.' : 'Spotify did not allow that. The app owner has to add your Spotify account to the app.');
    if (res.status === 404 && /DEVICE/i.test(reason)) throw new Error('No Spotify device is on. Open Spotify on a phone, computer or speaker, then refresh the list.');
    if (res.status === 429) throw new Error('Spotify says slow down. Try again in a moment.');
    throw new Error('Spotify said no (' + res.status + (reason ? ', ' + reason : '') + ').');
  }

  root.RNSpotify = {
    ...api,
    get configured() { return !!clientId(); },
    get loggedIn() { return !!tokens; },
    setClientId(id) { ls.set(KEY + '-client', /^[0-9a-f]{32}$/i.test(id) ? id : null); },
    login, finish,
    logout() { store(null); },
    async search(q) {
      const d = await call('GET', '/search?type=track&limit=10&q=' + encodeURIComponent(String(q).slice(0, 100)));
      const items = d && d.tracks && Array.isArray(d.tracks.items) ? d.tracks.items : [];
      return items.map(cleanTrack).filter(Boolean);
    },
    async devices() { return cleanDevices(await call('GET', '/me/player/devices')); },
    async play(uri, deviceId) {
      await call('PUT', '/me/player/play' + (deviceId ? '?device_id=' + encodeURIComponent(deviceId) : ''), { uris: [uri], position_ms: 0 });
    },
    async pause() { try { await call('PUT', '/me/player/pause'); } catch (e) { /* already stopped */ } },
    async state() { return cleanState(await call('GET', '/me/player')); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
