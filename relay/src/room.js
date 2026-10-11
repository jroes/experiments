// Cloudflare Durable Object: one instance per game room, SQLite-backed, so it works on the free plan.
import { handle } from './logic.js';

const TTL_MS = 1000 * 60 * 60 * 24 * 90; // forget a room 90 days after its last write

export class Room {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const s = this.ctx.storage;
    const store = {
      get: key => s.get(key),
      getMany: async keys => Object.fromEntries(await s.get(keys)),
      put: (key, value) => s.put(key, value),
      touch: () => s.setAlarm(Date.now() + TTL_MS),
    };
    return handle(request, store);
  }

  async alarm() { await this.ctx.storage.deleteAll(); }
}
