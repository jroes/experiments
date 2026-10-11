import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Starts the real Node relay as a child process with low limits and talks to it over HTTP.
async function freePort() {
  const s = net.createServer();
  s.listen(0);
  await once(s, 'listening');
  const { port } = s.address();
  s.close();
  await once(s, 'close');
  return port;
}

async function start(env) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'relay-'));
  const child = spawn(process.execPath, ['relay/src/node-server.js'], {
    env: { ...process.env, PORT: String(port), DATA_FILE: join(dir, 'data.json'), ...env }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise(res => child.stdout.on('data', d => /listening/.test(String(d)) && res()));
  return { base: 'http://127.0.0.1:' + port, stop: () => child.kill() };
}

const hash = 'a'.repeat(64);
const create = (base, room, ip) => fetch(base + '/v1/rooms/' + room, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(ip ? { 'x-test-ip': ip } : {}) },
  body: JSON.stringify({ humans: 2, seats: { 1: hash, 2: hash } }),
});

test('node relay: room creation is limited per address and the limit reports Retry-After', async () => {
  const srv = await start({ RELAY_IP_CREATE_PER_HOUR: '2', CLIENT_IP_HEADER: 'x-test-ip' });
  try {
    assert.equal((await create(srv.base, 'roomaaaaaaaa1', '9.9.9.9')).status, 201);
    assert.equal((await create(srv.base, 'roomaaaaaaaa2', '9.9.9.9')).status, 201);
    const third = await create(srv.base, 'roomaaaaaaaa3', '9.9.9.9');
    assert.equal(third.status, 429);
    assert.ok(+third.headers.get('retry-after') > 0);
    assert.equal(third.headers.get('access-control-allow-origin'), '*');
    assert.equal((await create(srv.base, 'roomaaaaaaaa4', '8.8.8.8')).status, 201, 'another address is fine');
  } finally { srv.stop(); }
});

test('node relay: request rate is limited per address', async () => {
  const srv = await start({ RELAY_IP_REQ_PER_MIN: '10', CLIENT_IP_HEADER: 'x-test-ip' });
  try {
    const get = ip => fetch(srv.base + '/v1/health', { headers: { 'x-test-ip': ip } });
    // health is answered before limits (it must stay cheap and always available), so use a room path
    const meta = ip => fetch(srv.base + '/v1/rooms/nosuchroom123/meta', { headers: { 'x-test-ip': ip } });
    assert.equal((await get('1.2.3.4')).status, 200);
    let limited = 0;
    for (let i = 0; i < 14; i++) if ((await meta('1.2.3.4')).status === 429) limited++;
    assert.ok(limited >= 4, 'expected the extra requests to be refused, got ' + limited);
    assert.notEqual((await meta('5.6.7.8')).status, 429, 'another address is unaffected');
  } finally { srv.stop(); }
});

test('node relay: the address header is ignored unless configured, so it cannot be used to dodge limits', async () => {
  const srv = await start({ RELAY_IP_CREATE_PER_HOUR: '1' }); // no CLIENT_IP_HEADER
  try {
    assert.equal((await create(srv.base, 'roombbbbbbbb1', '1.1.1.1')).status, 201);
    assert.equal((await create(srv.base, 'roombbbbbbbb2', '2.2.2.2')).status, 429, 'a different claimed address must not reset the limit');
  } finally { srv.stop(); }
});

test('node relay: oversized bodies are refused with 413 and cross-origin headers', async () => {
  const srv = await start({});
  try {
    const r = await fetch(srv.base + '/v1/rooms/roomcccccccc1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(20000) }) });
    assert.equal(r.status, 413);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  } finally { srv.stop(); }
});

test('node relay: a room flood is cut off per room', async () => {
  const srv = await start({ RELAY_ROOM_REQ_PER_MIN: '6', RELAY_IP_REQ_PER_MIN: '1000' });
  try {
    assert.equal((await create(srv.base, 'roomdddddddd1')).status, 201);
    let limited = 0;
    for (let i = 0; i < 10; i++) if ((await fetch(srv.base + '/v1/rooms/roomdddddddd1/meta')).status === 429) limited++;
    assert.ok(limited >= 4, 'got ' + limited);
    assert.equal((await create(srv.base, 'roomdddddddd2')).status, 201, 'other rooms are unaffected');
  } finally { srv.stop(); }
});
