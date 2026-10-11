// Cloudflare Worker entry: send each room to its own Durable Object.
import { route } from './logic.js';
export { Room } from './room.js';

export default {
  async fetch(request, env) {
    const r = route(request);
    if (r.response) return r.response;
    return env.ROOMS.get(env.ROOMS.idFromName(r.room)).fetch(request);
  },
};
