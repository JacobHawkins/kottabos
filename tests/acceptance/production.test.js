import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import WebSocket from 'ws';
import { createProductionServer } from '../../server/production.js';
import { createAppServer } from '../../server/app.js';

async function until(predicate, message, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(15);
  }
  assert.ok(predicate(), message);
}

function observe(room) {
  room.onMessage('welcome', () => {});
  room.onMessage('notice', () => {});
  room.onError(() => {});
  room.onLeave(() => {});
  return room;
}

function chunkedPost(url, chunks) {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (incoming) => {
      let body = '';
      incoming.on('data', (chunk) => { body += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode, body }));
    });
    outgoing.on('error', reject);
    for (const chunk of chunks) outgoing.write(chunk);
    outgoing.end();
  });
}

test('built production serves only public assets and completes the multiplayer round/recovery/replay loop', { timeout: 15_000 }, async (t) => {
  const server = await createProductionServer({ port: 0, countdownMs: 50, roundDurationMs: 3000, log: false });
  await server.listen();
  const endpoint = `http://127.0.0.1:${server.httpServer.address().port}`;
  const connections = new Set();
  const track = (room) => { connections.add(room); return observe(room); };
  t.after(async () => {
    await Promise.allSettled([...connections].map((room) => room.connection?.isOpen ? room.leave() : Promise.resolve()));
    await server.close();
  });

  const home = await fetch(endpoint);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  const html = await home.text();
  const entry = html.match(/<script[^>]+src="(\/assets\/[^\"]+\.js)"/);
  assert.ok(entry, 'built HTML references a bundled public JavaScript entry');
  const asset = await fetch(`${endpoint}${entry[1]}`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  const assetRoot = new URL('../../dist/assets/', import.meta.url);
  for (const filename of await readdir(assetRoot)) {
    if (!filename.endsWith('.js')) continue;
    const script = await readFile(new URL(filename, assetRoot), 'utf8');
    assert.doesNotMatch(script, /__partyDebug|\/@vite\/client|vite-hmr/, 'built JavaScript has no active development hook');
  }
  assert.doesNotMatch(html, /\/@vite\/client|vite-hmr/);
  for (const path of ['/package.json', '/package-lock.json', '/server/app.js', '/client/main.js',
    '/PARTY_GAME_PROJECT_BRIEF.md', '/node_modules/@colyseus/sdk/package.json', '/.env',
    '/test-results/index.html', '/@vite/client', '/assets/missing.js', '/api/missing', '/matchmake/missing']) {
    const response = await fetch(`${endpoint}${path}`);
    assert.equal(response.status, 404, `${path} is not public`);
    assert.match(response.headers.get('content-type'), /application\/json/, 'API or missing asset errors cannot become HTML');
  }

  const client = new Client(endpoint);
  const host = track(await client.create('party', { name: 'Production host' }));
  let guest = track(await client.joinById(host.roomId, { name: 'Production guest' }));
  const authoritative = server.rooms.get(host.roomId);
  const [hostId, guestId] = authoritative.state.players.keys();
  host.send('ready', true);
  guest.send('ready', true);
  await until(() => [...authoritative.state.players.values()].every((player) => player.ready), 'production players ready');
  host.send('start');
  await until(() => host.state.phase === 'results' && guest.state.phase === 'results', 'production round reaches shared results');
  assert.deepEqual([...host.state.winnerIds], [...guest.state.winnerIds]);
  assert.equal(host.state.players.get(hostId).score, 1, 'simultaneous fall scores once');
  assert.equal(guest.state.players.get(guestId).score, 1);
  const token = guest.reconnectionToken;
  guest.reconnection.enabled = false;
  guest.connection.close(4010, 'production recovery acceptance');
  await until(() => !authoritative.state.players.get(guestId).connected, 'production reserves guest');
  guest = track(await client.reconnect(token));
  await until(() => guest.state.players?.get(guestId)?.connected, 'production identity recovers');
  assert.equal(guest.state.players.get(guestId).alive, false);
  assert.equal(guest.state.players.get(guestId).score, 1);
  assert.notEqual(guest.reconnectionToken, token);
  host.send('replay');
  await until(() => host.state.phase === 'lobby' && guest.state.phase === 'lobby', 'built service supports replay');
  assert.equal(guest.state.players.get(guestId).score, 1, 'replay preserves scores');
});

test('public HTTP and WebSocket guards reject foreign origins, oversized bodies and forged-IP rate bypass', { timeout: 15_000 }, async (t) => {
  const origin = 'https://kottabos.example';
  const server = await createAppServer({ port: 0, allowedOrigin: origin,
    requestLimits: { create: 2, lookup: 2, match: 20 }, log: false });
  await server.listen();
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.httpServer.address().port}`;
  const foreign = await fetch(`${endpoint}/api/health`, { headers: { Origin: 'https://foreign.example' } });
  assert.equal(foreign.status, 403);
  assert.equal((await fetch(`${endpoint}/api/health`, { headers: { Origin: origin } })).status, 200);
  const websocketStatus = await new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint.replace('http:', 'ws:') + '/unavailable/ABCDEF', { origin: 'https://foreign.example' });
    socket.on('unexpected-response', (outgoing, incoming) => {
      incoming.resume();
      outgoing.destroy();
      resolve(incoming.statusCode);
    });
    socket.on('error', reject);
    socket.on('open', () => { socket.close(); reject(new Error('Foreign WebSocket origin was accepted')); });
  });
  assert.equal(websocketStatus, 403);

  const huge = JSON.stringify({ roomId: 'ABCDEF', reconnectionToken: `ABCDEF:${'x'.repeat(5000)}` });
  const oversized = await fetch(`${endpoint}/api/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: huge });
  assert.equal(oversized.status, 413, 'Content-Length body is bounded');
  assert.doesNotMatch(await oversized.text(), /xxxx/, 'body and credentials are never echoed');
  const chunked = await chunkedPost(`${endpoint}/api/leave`, [huge.slice(0, 120), huge.slice(120)]);
  assert.equal(chunked.status, 413, 'chunked body is bounded without Content-Length');
  assert.doesNotMatch(chunked.body, /xxxx/);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${endpoint}/api/parties/ABCDEF`, { headers: { 'X-Forwarded-For': `198.51.100.${attempt + 1}` } });
    assert.equal(response.status, attempt < 2 ? 200 : 429, 'forged forwarded peers cannot bypass lookup budget');
    if (attempt === 2) assert.equal(response.headers.get('retry-after'), '60');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${endpoint}/matchmake/create/party`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${attempt + 1}` },
      body: JSON.stringify({ name: '' }) });
    const body = await response.json();
    assert.equal(attempt < 2 ? body.code : response.status, attempt < 2 ? 400 : 429,
      'forged forwarded peers cannot bypass create budget');
  }
});
