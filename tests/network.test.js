import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { Client } from '@colyseus/sdk';
import { createAppServer } from '../server/app.js';
import { PLAYER_SPEED, STEP_MS } from '../shared/constants.js';
import { tileIndexAt } from '../shared/movement.js';

async function until(predicate, message, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.ok(predicate(), message);
}

// Transparent TCP forwarding delays *all* data after the WebSocket upgrade,
// including game inputs, state patches, and ping replies. HTTP throttling alone
// would not exercise the live game transport. Each direction adds half the RTT.
async function delayedProxy(targetPort, roundTripMs) {
  const sockets = new Set();
  const timers = new Set();
  const server = createServer((downstream) => {
    const upstream = connect({ host: '127.0.0.1', port: targetPort });
    sockets.add(downstream);
    sockets.add(upstream);
    for (const [source, destination] of [[downstream, upstream], [upstream, downstream]]) {
      source.on('data', (data) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (!destination.destroyed) destination.write(data);
        }, roundTripMs / 2);
        timers.add(timer);
      });
      source.on('error', () => destination.destroy());
      source.on('close', () => { sockets.delete(source); destination.destroy(); });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function observe(room) {
  room.onMessage('welcome', () => {});
  room.onMessage('notice', () => {});
  room.onError(() => {});
  room.onLeave(() => {});
  return room;
}

test('100 ms and 250 ms added game WebSocket RTT preserve movement, recovery and once-only scores', { timeout: 45_000 }, async (t) => {
  const server = await createAppServer({ port: 0, countdownMs: 100, reconnectionSeconds: 6, log: false });
  await server.listen();
  t.after(() => server.close());
  for (const addedRtt of [100, 250]) {
    await t.test(`${addedRtt} ms added round trip`, async (t) => {
      const proxy = await delayedProxy(server.httpServer.address().port, addedRtt);
      const connections = new Set();
      const track = (room) => { connections.add(room); return observe(room); };
      t.after(async () => {
        await Promise.allSettled([...connections].map((room) => room.connection?.isOpen ? room.leave() : Promise.resolve()));
        await proxy.close();
      });
      const httpStarted = performance.now();
      assert.equal((await fetch(`${proxy.endpoint}/api/health`)).ok, true);
      const httpRtt = performance.now() - httpStarted;
      assert.ok(httpRtt >= addedRtt * 0.85, 'HTTP traffic traverses both delayed proxy directions');

      const client = new Client(proxy.endpoint);
      let host = track(await client.create('party', { name: 'Delayed host' }));
      const guest = track(await client.joinById(host.roomId, { name: 'Delayed guest' }));
      const authoritative = server.rooms.get(host.roomId);
      const [hostId, guestId] = authoritative.state.players.keys();
      await until(() => host.state.players?.size === 2 && guest.state.players?.size === 2, 'delayed clients synchronize');
      const pingStarted = performance.now();
      let gameRtt;
      host.onMessage('pong', () => { gameRtt = performance.now() - pingStarted; });
      host.send('ping', { sentAt: pingStarted });
      await until(() => gameRtt !== undefined, 'game WebSocket ping returns');
      assert.ok(gameRtt >= addedRtt * 0.85 && gameRtt < addedRtt + 1000, `actual WebSocket RTT was ${gameRtt} ms`);
      const player = authoritative.state.players.get(hostId);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const token = host.reconnectionToken;
        host.reconnection.enabled = false;
        host.connection.close(4010, 'controlled proxy-path interruption');
        await until(() => !player.connected, 'server reserves interrupted seat');
        assert.equal(authoritative.state.hostId, guestId, 'connected guest receives host controls');
        const position = { x: player.x, y: player.y };
        await delay(addedRtt + 80);
        assert.deepEqual({ x: player.x, y: player.y }, position, 'disconnected player does not move');
        host = track(await client.reconnect(token));
        await until(() => host.state.players?.get(hostId)?.connected, 'same player resumes under latency');
        assert.notEqual(host.reconnectionToken, token, 'recovery rotates credential');
        assert.equal(authoritative.state.players.size, 2);
        assert.equal(authoritative.state.hostId, guestId, 'recovered creator cannot reclaim host');
      }

      guest.send('start');
      await until(() => host.state.phase === 'playing' && guest.state.phase === 'playing', 'transferred host starts without readiness');
      const originalX = player.x;
      const movementStarted = performance.now();
      host.send('input', { seq: 1, x: 1, y: 0 });
      host.send('input', { seq: 1, x: 1, y: 0 });
      await until(() => guest.state.players.get(hostId).lastInputSeq === 1, 'remote observes acknowledged movement through delayed frames');
      assert.ok(performance.now() - movementStarted >= addedRtt * 0.85, 'input and remote state both crossed the delayed proxy');
      assert.ok(Math.abs(player.x - originalX - PLAYER_SPEED * STEP_MS / 1000) < 0.001, 'duplicate sequence moves exactly once');

      const survivor = authoritative.state.players.get(guestId);
      const spawn = tileIndexAt(survivor);
      for (let seq = 1; seq <= 8; seq += 1) {
        guest.send('input', { seq, x: -1, y: 0 });
        await delay(STEP_MS);
      }
      await until(() => tileIndexAt(survivor) !== spawn, 'guest escapes its armed spawn under latency');
      const token = host.reconnectionToken;
      host.reconnection.enabled = false;
      host.connection.close(4010, 'hazard interruption');
      await until(() => !player.connected, 'hazard victim is disconnected');
      await until(() => authoritative.state.phase === 'results', 'disconnected character remains vulnerable');
      host = track(await client.reconnect(token));
      await until(() => host.state.phase === 'results' && guest.state.phase === 'results', 'delayed clients agree on results');
      assert.equal(host.state.players.get(hostId).alive, false, 'recovery never revives elimination');
      assert.equal(host.state.players.get(hostId).score, 0);
      assert.equal(host.state.players.get(guestId).score, 3);
      await delay(addedRtt + 100);
      assert.equal(authoritative.state.players.get(guestId).score, 3, 'late updates cannot award twice');
      assert.deepEqual([...host.state.winnerIds], [...guest.state.winnerIds]);
      const leavingToken = guest.reconnectionToken;
      guest.reconnection.enabled = false;
      await guest.leave();
      await until(() => authoritative.state.players.size === 1, 'explicit leave releases delayed connection');
      await assert.rejects(client.reconnect(leavingToken));
      t.diagnostic(`Added ${addedRtt} ms RTT to TCP data in both directions; measured HTTP ${httpRtt.toFixed(1)} ms, game WebSocket ${gameRtt.toFixed(1)} ms. Three repeated recoveries plus eliminated recovery passed.`);
    });
  }
});
