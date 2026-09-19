import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { createAppServer } from '../../server/app.js';

async function until(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  assert.ok(predicate(), message);
}

function observe(room) {
  room.onMessage('welcome', () => {});
  room.onError(() => {});
  room.onLeave(() => {});
  return room;
}

// Kept out of the fast test glob: this intentionally uses the ordinary default
// reservation and real wall-clock time, with no shortened timing or fake clock.
test('ordinary 120-second reservation holds identity until expiry, then releases it', { timeout: 135_000 }, async (t) => {
  const server = await createAppServer({ port: 0, log: false });
  await server.listen();
  const endpoint = `http://127.0.0.1:${server.httpServer.address().port}`;
  const client = new Client(endpoint);
  const active = new Set();
  t.after(async () => {
    await Promise.allSettled([...active].map((room) => room.connection?.isOpen ? room.leave() : Promise.resolve()));
    await server.close();
  });
  const health = await (await fetch(`${endpoint}/api/health`)).json();
  assert.equal(health.reconnectionSeconds, 120);
  const host = observe(await client.create('party', { name: 'Expiry host' }));
  active.add(host);
  const guest = observe(await client.joinById(host.roomId, { name: 'Expiry guest' }));
  active.add(guest);
  const authoritative = server.rooms.get(host.roomId);
  const guestId = [...authoritative.state.players.values()].find((player) => player.name === 'Expiry guest').id;
  const token = guest.reconnectionToken;
  guest.reconnection.enabled = false;
  guest.connection.close(4010, 'expiry acceptance interruption');
  await until(() => authoritative.state.players.get(guestId)?.connected === false, 'guest is reserved');
  const reservedAt = Date.now();
  for (let second = 0; second < 119; second += 1) {
    await delay(Math.max(0, reservedAt + (second + 1) * 1000 - Date.now()));
    assert.equal(authoritative.state.players.has(guestId), true, 'seat remains reserved before the ordinary deadline');
    assert.equal(authoritative.state.players.get(guestId).connected, false);
  }
  await until(() => !authoritative.state.players.has(guestId), 'ordinary reservation expires', 6000);
  const elapsedMs = Date.now() - reservedAt;
  assert.ok(elapsedMs >= 119_500 && elapsedMs < 125_000, `expiry occurred after ${elapsedMs} ms`);
  await assert.rejects(client.reconnect(token));
  const replacement = observe(await client.joinById(host.roomId, { name: 'Fresh guest' }));
  active.add(replacement);
  const replacementId = [...authoritative.state.players.values()].find((player) => player.name === 'Fresh guest').id;
  assert.notEqual(replacementId, guestId);
  assert.equal(authoritative.state.players.get(replacementId).score, 0);
  t.diagnostic(`Real default reservation expired after ${elapsedMs} ms; old credential rejected and fresh identity joined.`);
});
