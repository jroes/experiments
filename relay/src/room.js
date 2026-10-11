// Cloudflare Durable Objects (SQLite-backed, so they work on the free plan).
//   Room: one per game, holds that game's rows.
//   Gate: one for the whole relay, counts room creations so a flood can't use up your free daily quota.
import { handle, reply, tooMany } from './logic.js';
import { readLimits, gateCheck } from './limits.js';

const TTL_MS = 1000 * 60 * 60 * 24 * 90; // forget a room 90 days after its last write

export class Room {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
    const s = this.ctx.storage;
    const store = {
      get: key => s.get(key),
      getMany: async keys => Object.fromEntries(await s.get(keys)),
      put: (key, value) => s.put(key, value),
      touch: () => s.setAlarm(Date.now() + TTL_MS),
    };
    return handle(request, store, undefined, { limits: readLimits(this.env) });
  }

  async alarm() { await this.ctx.storage.deleteAll(); }
}

export class Gate {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
    const ip = new URL(request.url).searchParams.get('ip') || 'unknown';
    const s = this.ctx.storage;
    const r = await gateCheck({ get: k => s.get(k), put: (k, v) => s.put(k, v) }, ip, Date.now(), readLimits(this.env));
    if (!(await s.getAlarm())) await s.setAlarm(Date.now() + 1000 * 60 * 60 * 48); // counters are keyed by hour and day, this just frees old rows
    return r.ok ? reply({ ok: true }) : tooMany(r.retryAfter, r.reason);
  }

  async alarm() { await this.ctx.storage.deleteAll(); }
}
