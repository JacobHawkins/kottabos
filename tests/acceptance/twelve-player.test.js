import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { Client } from '@colyseus/sdk';
import { createAppServer } from '../../server/app.js';
import { ARENA, MAX_PLAYERS, STEP_MS, TILE_GONE, TILE_SAFE, TILE_WARNING, TILE_WARNING_MS } from '../../shared/constants.js';

// Deliberately separate from npm test: this holds twelve real SDK sockets for
// an entire round. PLAYTEST_URL runs the same bounded party against an explicitly
// selected deployment; it does not create multiple parties or keep hosting awake.
const remoteEndpoint = process.env.PLAYTEST_URL?.replace(/\/$/, '');

async function until(predicate, message, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  assert.ok(await predicate(), message);
}

function scores(room) {
  return [...room.state.players.values()].map(({ id, score, roundPoints }) => ({ id, score, roundPoints }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function nearestSafeDirection(state, player) {
  const { columns, rows, tileSize } = ARENA;
  const tile = Math.floor(player.y / tileSize) * columns + Math.floor(player.x / tileSize);
  const previous = new Map([[tile, null]]);
  const queue = [tile];
  let target = tile;
  // The controller navigates only the synchronized floor visible to players.
  for (const current of queue) {
    if (state.tiles[current] === TILE_SAFE) { target = current; break; }
    const column = current % columns;
    const row = Math.floor(current / columns);
    const neighbors = [column > 0 ? current - 1 : -1, column < columns - 1 ? current + 1 : -1,
      row > 0 ? current - columns : -1, row < rows - 1 ? current + columns : -1];
    for (const next of neighbors) {
      if (next >= 0 && state.tiles[next] !== TILE_GONE && !previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
  while (previous.get(target) !== null && previous.get(target) !== tile) target = previous.get(target);
  const dx = target % columns * tileSize + tileSize / 2 - player.x;
  const dy = Math.floor(target / columns) * tileSize + tileSize / 2 - player.y;
  return { x: Math.abs(dx) > 9 ? Math.sign(dx) : 0, y: Math.abs(dy) > 9 ? Math.sign(dy) : 0 };
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0);
}

test('twelve real clients complete movement, reserved-seat recovery, shared results, replay and host transfer',
  { timeout: 150_000 }, async (t) => {
    assert.equal(MAX_PLAYERS, 12, 'this acceptance case targets exactly twelve players');
    let server;
    let endpoint = remoteEndpoint;
    if (!endpoint) {
      server = await createAppServer({ port: Number(process.env.TWELVE_PLAYER_TEST_PORT || 2584),
        countdownMs: 500, log: false });
      await server.listen();
      endpoint = `http://127.0.0.1:${server.httpServer.address().port}`;
    }
    const connections = new Set();
    const players = [];
    const roundTripMs = [];
    const stepTimes = [];
    let partyCode;
    let stopController = false;
    let controller;
    t.after(async () => {
      stopController = true;
      await controller?.catch(() => {});
      await Promise.allSettled([...connections].map(async (room) => {
        room.reconnection.enabled = false;
        if (room.connection?.isOpen) await room.leave();
        else if (room.reconnectionToken) await fetch(`${endpoint}/api/leave`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: room.roomId, reconnectionToken: room.reconnectionToken }),
        });
      }));
      try {
        if (partyCode) await until(async () => {
          const response = await fetch(`${endpoint}/api/parties/${partyCode}`);
          return response.ok && !(await response.json()).exists;
        }, 'the acceptance party releases every seat and is disposed', 8_000);
      } finally {
        await server?.close();
      }
    });
    const health = await fetch(`${endpoint}/api/health`, { signal: AbortSignal.timeout(90_000) });
    assert.equal(health.status, 200);
    const client = new Client(endpoint);

    async function track(room) {
      connections.add(room);
      // Recovery is exercised explicitly below. Match the browser's explicit-
      // leave behavior: a proxy may report an abnormal socket close even after
      // the server accepted leave; that must not start automatic SDK retries.
      room.reconnection.enabled = false;
      const player = { room, id: '', seq: 0 };
      room.onMessage('welcome', ({ playerId }) => { player.id = playerId; });
      room.onMessage('notice', () => {});
      room.onMessage('pong', ({ sentAt }) => { roundTripMs.push(performance.now() - sentAt); });
      room.onError(() => {});
      room.onLeave(() => {});
      room.send('identify');
      await until(() => player.id && room.state.players?.get(player.id)?.connected, 'each SDK socket receives its own identity');
      player.seq = room.state.players.get(player.id).lastInputSeq;
      return player;
    }

    players.push(await track(await client.create('party', { name: 'Twelve player 1' })));
    partyCode = players[0].room.roomId;
    for (let index = 1; index < MAX_PLAYERS; index += 1) {
      players.push(await track(await client.joinById(partyCode, { name: `Twelve player ${index + 1}` })));
    }
    const host = players[0];
    await until(() => players.every(({ room }) => room.state.players.size === MAX_PLAYERS), 'all twelve clients receive the full roster');
    assert.equal(new Set(players.map(({ id }) => id)).size, 12, 'identities are distinct');
    assert.equal(new Set([...host.room.state.players.values()].map(({ color }) => color)).size, 12, 'all twelve colors are distinct');
    const lookup = await (await fetch(`${endpoint}/api/parties/${partyCode}`)).json();
    assert.equal(lookup.maxPlayers, 12);
    assert.equal(lookup.players, 12);

    async function rejectThirteenth() {
      const response = await fetch(`${endpoint}/matchmake/joinById/${partyCode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Thirteenth player' }),
      });
      assert.equal(response.status, 409, 'a full party returns standard HTTP Conflict through a hosting proxy');
      assert.match(response.headers.get('content-type'), /application\/json/);
      const body = await response.json();
      assert.equal(body.code, 522, 'the Colyseus protocol error is retained in JSON');
      assert.match(body.error, /locked|full/i);
      await assert.rejects(async () => {
        const unexpected = await client.joinById(partyCode, { name: 'Thirteenth player' });
        connections.add(unexpected);
      }, error => error.code === 409 && /full|locked|maxclients/i.test(error.message),
      'a thirteenth identity cannot take a seat and receives a useful SDK error');
    }
    await rejectThirteenth();
    const original = players[11];
    const token = original.room.reconnectionToken;
    original.room.reconnection.enabled = false;
    original.room.connection.close(4010, 'twelve-player recovery acceptance');
    await until(() => host.room.state.players.get(original.id)?.connected === false, 'the dropped twelfth seat remains reserved');
    assert.equal(host.room.state.players.size, 12);
    await rejectThirteenth();
    players[11] = await track(await client.reconnect(token));
    assert.equal(players[11].id, original.id, 'recovery resumes the identity at full capacity');
    assert.notEqual(players[11].room.reconnectionToken, token, 'recovery rotates the credential');
    await until(() => players.every(({ room }) => [...room.state.players.values()].every(({ connected }) => connected)),
      'all clients observe twelve connected players after recovery');

    host.room.send('start');
    await until(() => host.room.state.phase === 'countdown', 'the host starts all twelve connected players');
    const startingPositions = new Map([...host.room.state.players].map(([id, player]) => [id, { x: player.x, y: player.y }]));
    assert.equal(new Set([...startingPositions.values()].map(({ x, y }) => `${x},${y}`)).size, 12, 'all twelve spawns are distinct');
    assert.ok([...host.room.state.players.values()].every(({ alive, participating }) => alive && participating));
    await until(() => players.every(({ room }) => room.state.phase === 'playing'), 'all twelve clients enter the same round');
    const startedAt = performance.now();
    assert.equal(host.room.state.phaseEndsAt, 0, 'playing has no global deadline');
    assert.equal([...host.room.state.tiles].filter((tile) => tile === TILE_WARNING).length, 12,
      'each occupied spawn starts its floor countdown');
    assert.equal([...host.room.state.tiles].filter((tile) => tile === TILE_SAFE).length, ARENA.columns * ARENA.rows - 12,
      'unvisited tiles stay intact');
    for (let step = 0; step < 8; step += 1) {
      for (const player of players) {
        const position = player.room.state.players.get(player.id);
        player.room.send('input', { seq: ++player.seq, x: Math.sign(ARENA.width / 2 - position.x),
          y: Math.sign(ARENA.height / 2 - position.y) });
      }
      await delay(STEP_MS);
    }
    await until(() => [...host.room.state.players].every(([id, player]) => {
      const start = startingPositions.get(id);
      return player.lastInputSeq > 0 && Math.hypot(player.x - start.x, player.y - start.y) > 5;
    }), 'each of the twelve players moves authoritatively and is visible to the host');

    let sawGone = false;
    const activatedDeadlines = new Map();
    let nextPingAt = 0;
    controller = (async () => {
      while (!stopController && host.room.state.phase === 'playing') {
        const state = host.room.state;
        sawGone ||= [...state.tiles].some((tile) => tile === TILE_GONE);
        for (let tile = 0; tile < state.tileGoneAtMs.length; tile += 1) {
          const goneAt = state.tileGoneAtMs[tile];
          if (!goneAt) continue;
          if (activatedDeadlines.has(tile)) {
            assert.equal(goneAt, activatedDeadlines.get(tile), 'stepping back onto a tile cannot restart its timer');
          } else activatedDeadlines.set(tile, goneAt);
        }
        stepTimes.push(state.stepMs);
        const pingNow = performance.now() >= nextPingAt;
        if (pingNow) nextPingAt = performance.now() + 1_000;
        for (const player of players) {
          const self = player.room.state.players.get(player.id);
          if (self?.alive && player.room.state.phase === 'playing') {
            player.room.send('input', { seq: ++player.seq, ...nearestSafeDirection(player.room.state, self) });
          }
          if (pingNow) player.room.send('ping', { sentAt: performance.now() });
        }
        await delay(STEP_MS);
      }
    })();
    await until(() => players.every(({ room }) => room.state.phase === 'results'), 'all twelve clients receive results', 65_000);
    await controller;
    assert.ok(sawGone, 'occupied tiles disappear during the round');
    assert.ok(activatedDeadlines.size > MAX_PLAYERS, 'movement arms floor beyond the initial twelve spawns');
    assert.ok(host.room.state.roundElapsedMs >= TILE_WARNING_MS, 'players receive the full initial floor countdown');
    const expectedScores = scores(host.room);
    const expectedWinners = [...host.room.state.winnerIds];
    assert.ok(expectedWinners.length >= 1, 'the player-driven round has a winner or simultaneous final fall');
    assert.ok(expectedScores.some(({ score }) => score > 0));
    for (const { id, roundPoints } of expectedScores) {
      assert.equal(roundPoints, expectedWinners.includes(id) ? (expectedWinners.length === 1 ? 3 : 1) : 0,
        'only the final survivor or simultaneous last fall receives points');
    }
    for (const { room } of players) {
      assert.deepEqual(scores(room), expectedScores, 'all twelve clients agree on cumulative scores');
      assert.deepEqual([...room.state.winnerIds], expectedWinners);
      assert.equal(room.state.resultText, host.room.state.resultText);
    }
    await delay(200);
    assert.deepEqual(scores(host.room), expectedScores, 'scores are not awarded again after results');
    t.diagnostic(JSON.stringify({ endpoint, simultaneousClients: 12, roundElapsedMs: Math.round(host.room.state.roundElapsedMs),
      observedWallMs: Math.round(performance.now() - startedAt), survivors: expectedWinners.length,
      pingSamples: roundTripMs.length, rttP50Ms: percentile(roundTripMs, 0.5), rttP95Ms: percentile(roundTripMs, 0.95),
      observedServerStepMaxMs: Number(Math.max(...stepTimes).toFixed(2)),
      scope: 'One automated party; not twelve physical devices or a multi-party capacity benchmark.' }));

    host.room.send('replay');
    await until(() => players.every(({ room }) => room.state.phase === 'lobby'), 'replay returns all twelve identities to the lobby');
    for (const { room } of players) {
      assert.deepEqual(scores(room), expectedScores, 'replay preserves cumulative scores');
      assert.equal(room.state.players.size, 12);
      assert.ok([...room.state.tiles].every((tile) => tile === TILE_SAFE));
      assert.ok([...room.state.tileGoneAtMs].every((deadline) => deadline === 0));
    }
    await host.room.leave();
    await until(() => players.slice(1).every(({ room }) => room.state.players.size === 11 && room.state.hostId === players[1].id),
      'explicit host leave releases its seat and transfers host controls');
    const replacement = await track(await client.joinById(partyCode, { name: 'Replacement player' }));
    assert.notEqual(replacement.id, host.id, 'the released seat receives a new identity');
    players[0] = replacement;
    await until(() => players.every(({ room }) => room.state.players.size === 12), 'the released twelfth seat can be filled');
    assert.equal(replacement.room.state.hostId, players[1].id, 'joining does not steal host controls');
    players[1].room.send('start');
    await until(() => players.every(({ room }) => room.state.round === 2 && room.state.phase === 'countdown'),
      'the transferred host can start the next twelve-player round');
  });
