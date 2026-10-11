// Cloudflare Worker entry: rate limit, then send each room to its own Durable Object.
import { route, tooMany } from './logic.js';
export { Room, Gate } from './room.js';

export default {
  async fetch(request, env) {
    const r = route(request);
    if (r.response) return r.response;

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';

    // Optional per-address limit using Cloudflare's rate limiting binding. Turn it on in wrangler.toml (see the comments there).
    if (env.RL) {
      const { success } = await env.RL.limit({ key: ip });
      if (!success) return tooMany(10, 'rate_limited');
    }

    // New rooms go through the Gate, which counts them per address and per day.
    if (request.method === 'POST') {
      const gate = env.GATE.get(env.GATE.idFromName('gate'));
      const g = await gate.fetch('https://gate/check?ip=' + encodeURIComponent(ip));
      if (g.status !== 200) return tooMany(Number(g.headers.get('retry-after')) || 60, (await g.json()).error || 'rate_limited');
    }

    return env.ROOMS.get(env.ROOMS.idFromName(r.room)).fetch(request);
  },
};
