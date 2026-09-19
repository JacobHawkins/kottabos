import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { createAppServer } from '../server/app.js';
import { MAX_PLAYERS, STEP_MS, PLAYER_SPEED } from '../shared/constants.js';

async function until(predicate, message, timeout = 3000) {
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
  room.onMessage('pong', () => {});
  room.onError(() => {});
  room.onLeave(() => {});
  return room;
}

async function drop(room, serverRoom, id) {
  const token = room.reconnectionToken;
  room.reconnection.enabled = false;
  room.connection.close(4005, 'test interruption');
  await until(() => serverRoom.state.players.get(id)?.connected === false, 'server reserves dropped player');
  return token;
}

// Serial because the Colyseus matchmaker is process-global; the protocol clients
// below are independent real WebSocket sessions, not room method mocks.
test('party lifecycle and recovery over real HTTP/WebSocket connections', { timeout: 30_000 }, async (t) => {
  let server = await createAppServer({ port: 0, reconnectionSeconds: 0.7, countdownMs: 100, roundDurationMs: 3500, log: false });
  await server.listen();
  let endpoint = `http://127.0.0.1:${server.httpServer.address().port}`;
  let client = new Client(endpoint);
  const clients = new Set();
  const track = (room) => { clients.add(room); return observe(room); };
  t.after(async () => {
    await Promise.allSettled(Array.from(clients, (room) => room.connection?.isOpen ? room.leave() : Promise.resolve()));
    await server.close();
  });

  let first;
  let second;
  let authoritative;
  let firstId;
  let secondId;

  await t.test('foundation: private code, distinct identities, nickname validation, permission checks', async () => {
    await assert.rejects(client.create('party', { name: '   ' }), /nickname/);
    first = track(await client.create('party', { name: 'Amber' }));
    second = track(await client.joinById(first.roomId, { name: 'Basil' }));
    authoritative = server.rooms.get(first.roomId);
    await until(() => first.state.players?.size === 2 && second.state.players?.size === 2, 'both clients see two players');
    [firstId, secondId] = Array.from(authoritative.state.players.keys());
    assert.match(first.roomId, /^[A-Z]{6}$/);
    assert.notEqual(firstId, secondId);
    assert.notEqual(firstId, first.sessionId);
    assert.equal(first.state.hostId, firstId);
    assert.notEqual(first.state.players.get(firstId).color, first.state.players.get(secondId).color);
    second.send('start');
    await delay(100);
    assert.equal(authoritative.state.phase, 'lobby');
    const status = await (await fetch(`${endpoint}/api/parties/${first.roomId}`)).json();
    assert.deepEqual([status.exists, status.players, status.connected], [true, 2, 2]);
    assert.equal(status.instanceId, server.instanceId);
    assert.ok(!JSON.stringify(status).includes('Token'));
  });

  await t.test('concurrent party creation respects the shared four-room pilot limit', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
      client.create('party', { name: `Pilot ${index}` }).then(track)));
    const created = attempts.filter((attempt) => attempt.status === 'fulfilled').map((attempt) => attempt.value);
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    try {
      assert.equal(created.length, 3, 'one existing party leaves exactly three free rooms');
      assert.equal(server.rooms.size, 4);
      assert.equal(rejected.length, 3);
      assert.ok(rejected.every(({ reason }) => reason.code === 503 && /server is full/i.test(reason.message)));
      const status = await (await fetch(`${endpoint}/api/parties/${first.roomId}`)).json();
      assert.equal(status.exists, true, 'existing parties stay available at capacity');
    } finally {
      await Promise.all(created.map((room) => room.leave()));
    }
    await until(() => server.rooms.size === 1, 'leaving frees pilot room capacity');
  });

  await t.test('later joins keep the creator host; guests cannot start even when everyone is ready', async () => {
    const third = track(await client.joinById(first.roomId, { name: 'Cedar' }));
    await until(() => third.state.players?.size === 3 && first.state.players?.size === 3, 'third player arrives');
    assert.equal(authoritative.state.hostId, firstId);
    const fourth = track(await client.joinById(first.roomId, { name: 'Dahlia' }));
    await until(() => [first, second, third, fourth].every((room) => room.state.players?.size === 4), 'four clients see the roster');
    for (const room of [first, second, third, fourth]) {
      assert.equal(room.state.hostId, firstId, 'every client agrees the creator keeps host controls');
      room.send('ready', true);
    }
    await until(() => Array.from(authoritative.state.players.values()).every((player) => player.ready), 'all four players ready');
    fourth.send('start');
    third.send('start');
    second.send('start');
    await delay(100);
    assert.equal(authoritative.state.phase, 'lobby', 'ready guests have no start permission');
    await fourth.leave();
    await third.leave();
    await until(() => authoritative.state.players.size === 2, 'temporary players release their seats');
    assert.equal(authoritative.state.hostId, firstId, 'guest departures do not change host');
  });

  await t.test('lobby reload/reopen restores identity repeatedly and rejects concurrent takeover', async () => {
    for (let retry = 0; retry < 3; retry += 1) {
      const token = await drop(first, authoritative, firstId);
      assert.equal(authoritative.state.hostId, secondId);
      first = track(await new Client(endpoint).reconnect(token));
      await until(() => first.state.players?.get(firstId)?.connected, 'reload receives authoritative identity');
      assert.equal(authoritative.state.players.size, 2);
      assert.equal(authoritative.state.hostId, secondId, 'returning creator does not take host back');
      assert.equal(first.state.hostId, secondId, 'recovered client sees transferred host');
      assert.notEqual(first.reconnectionToken, token);
    }
    const lateGuest = track(await client.joinById(first.roomId, { name: 'Juniper' }));
    await until(() => lateGuest.state.players?.size === 3, 'new guest arrives after host transfer');
    assert.equal(lateGuest.state.hostId, secondId, 'joining after recovery preserves the replacement host');
    await lateGuest.leave();
    await until(() => authoritative.state.players.size === 2, 'late guest releases seat');
    await assert.rejects(new Client(endpoint).reconnect(first.reconnectionToken));
    assert.equal(authoritative.state.players.size, 2);
    assert.equal(authoritative.state.players.get(firstId).connected, true);
    first.send('ready', true);
    second.send('ready', true);
    await until(() => Array.from(authoritative.state.players.values()).every((player) => player.ready), 'ready once per participant');
  });

  await t.test('fixed-step inputs cannot move twice for duplicate sequence or unbounded commands', async () => {
    second.send('start');
    await until(() => authoritative.state.phase === 'playing', 'countdown starts a round');
    const player = authoritative.state.players.get(firstId);
    const original = { x: player.x, y: player.y };
    first.send('input', { seq: 1, x: 1, y: 0 });
    first.send('input', { seq: 1, x: 1, y: 0 });
    first.send('input', { seq: 2, x: 5000, y: 0 });
    first.send('input', { seq: 3, x: null, y: 0 });
    await until(() => player.lastInputSeq === 1, 'one input acknowledged');
    await delay(80);
    assert.ok(Math.abs(player.x - original.x - PLAYER_SPEED * STEP_MS / 1000) < 0.001);
    assert.equal(player.y, original.y);
    assert.equal(player.lastInputSeq, 1);
  });

  await t.test('round reload, dropped hazards, eliminated recovery, shared results and replay', async () => {
    let token = await drop(first, authoritative, firstId);
    first = track(await new Client(endpoint).reconnect(token));
    await until(() => first.state.phase === 'playing' && first.state.players?.get(firstId)?.connected, 'round reload receives playing state');
    assert.equal(first.state.players.get(firstId).alive, true);
    // Position the authoritative player over a removed tile to exercise the
    // regular hazard update while their socket is gone; no game rule bypass.
    token = await drop(first, authoritative, firstId);
    const player = authoritative.state.players.get(firstId);
    const index = Math.floor(player.y / 64) * 7 + Math.floor(player.x / 64);
    authoritative.roundGame.schedule = [{ tile: index, warningAt: 0, goneAt: 0 }];
    await until(() => authoritative.state.phase === 'results', 'hazard produces results');
    first = track(await new Client(endpoint).reconnect(token));
    await until(() => first.state.phase === 'results' && second.state.phase === 'results', 'both clients agree results');
    assert.equal(first.state.players.get(firstId).alive, false);
    assert.equal(first.state.players.get(firstId).score, 0);
    assert.equal(second.state.players.get(secondId).score, 3);
    assert.deepEqual(Array.from(first.state.winnerIds), Array.from(second.state.winnerIds));
    const score = authoritative.state.players.get(secondId).score;
    await delay(100);
    assert.equal(authoritative.state.players.get(secondId).score, score, 'results award only once');
    second.send('replay');
    await until(() => first.state.phase === 'lobby', 'replay returns same party to lobby');
    assert.equal(first.state.players.get(secondId).score, score);
    assert.equal(first.state.players.get(firstId).ready, false);
  });

  await t.test('running SDK automatically reconnects without duplicate listener events', async () => {
    let dropCount = 0;
    let reconnectCount = 0;
    first.reconnection.enabled = true;
    first.reconnection.minUptime = 0;
    first.onDrop(() => { dropCount += 1; });
    first.onReconnect(() => { reconnectCount += 1; });
    first.connection.close(4010, 'test automatic recovery');
    await until(() => reconnectCount === 1 && authoritative.state.players.get(firstId).connected, 'automatic retry returns');
    assert.equal(dropCount, 1);
    assert.equal(authoritative.state.players.size, 2);
  });

  await t.test('twelve seats include reservations; expiry releases seat and invalidates credential', async () => {
    const guests = [];
    for (let index = 2; index < MAX_PLAYERS; index++) {
      guests.push(track(await client.joinById(first.roomId, { name: `Seat ${index + 1}` })));
    }
    await until(() => authoritative.state.players.size === MAX_PLAYERS, 'all twelve seats occupied');
    const droppedId = Array.from(authoritative.state.players.values()).find((player) => player.name === `Seat ${MAX_PLAYERS}`).id;
    const token = await drop(guests.pop(), authoritative, droppedId);
    await assert.rejects(client.joinById(first.roomId, { name: 'Elm' }));
    await until(() => !authoritative.state.players.has(droppedId), 'reservation expires', 2000);
    await assert.rejects(new Client(endpoint).reconnect(token));
    const replacement = track(await client.joinById(first.roomId, { name: 'Elm' }));
    await until(() => authoritative.state.players.size === MAX_PLAYERS, 'released seat can be joined');
    await Promise.all([...guests, replacement].map((room) => room.leave()));
    await until(() => authoritative.state.players.size === 2, 'temporary players leave');
  });

  await t.test('authenticated HTTP leave releases a dropped reservation, rejecting guessed credentials', async () => {
    const room = track(await client.joinById(first.roomId, { name: 'Hazel' }));
    await until(() => authoritative.state.players.size === 3, 'temporary third player joins');
    const id = Array.from(authoritative.state.players.values()).find((player) => player.name === 'Hazel').id;
    const token = await drop(room, authoritative, id);
    const release = async (reconnectionToken) => (await fetch(`${endpoint}/api/leave`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: first.roomId, reconnectionToken }),
    })).json();
    assert.equal((await release(`${first.roomId}:guessed`)).released, false);
    assert.equal(authoritative.state.players.size, 3);
    assert.equal((await release(token)).released, true);
    await until(() => !authoritative.state.players.has(id), 'HTTP leave promptly releases seat');
    assert.equal((await release(token)).released, false);
    await assert.rejects(client.reconnect(token));
  });

  await t.test('host explicit leave transfers control, releases seat, prevents token reuse; empty party ends', async () => {
    const token = second.reconnectionToken;
    await second.leave();
    await until(() => authoritative.state.players.size === 1, 'explicit leave releases seat');
    assert.equal(authoritative.state.hostId, firstId);
    await assert.rejects(new Client(endpoint).reconnect(token));
    const code = first.roomId;
    await first.leave();
    await until(() => !server.rooms.has(code), 'empty room disposed');
    const status = await (await fetch(`${endpoint}/api/parties/${code}`)).json();
    assert.equal(status.exists, false);
  });

  await t.test('server restart creates a new instance and old recovery credentials are unavailable', async () => {
    const room = track(await client.create('party', { name: 'Fern' }));
    const oldInstanceId = server.instanceId;
    const token = room.reconnectionToken;
    const code = room.roomId;
    await server.close();
    server = await createAppServer({ port: 0, log: false });
    await server.listen();
    endpoint = `http://127.0.0.1:${server.httpServer.address().port}`;
    client = new Client(endpoint);
    assert.notEqual(server.instanceId, oldInstanceId);
    await assert.rejects(client.reconnect(token));
    const status = await (await fetch(`${endpoint}/api/parties/${code}`)).json();
    assert.equal(status.exists, false);
    assert.equal(status.instanceId, server.instanceId);
    const replacement = track(await client.create('party', { name: 'Fern' }));
    await replacement.leave();
  });
});
