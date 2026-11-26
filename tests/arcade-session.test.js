import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { createAppServer } from '../server/app.js';

async function until(check, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!check() && Date.now() < end) await delay(15);
  assert.ok(check());
}
function observe(room) {
  for (const type of ['welcome', 'notice', 'pong']) room.onMessage(type, () => {});
  return room;
}

test('ten rounds rotate both arcade games, synchronize state, recover identity and award each round once', async t => {
  const server = await createAppServer({ port: 0, countdownMs: 100, voteMs: 150, log: false });
  await server.listen();
  const client = new Client(`http://127.0.0.1:${server.httpServer.address().port}`);
  const members = [];
  t.after(async () => { await Promise.allSettled(members.filter(r => r.connection.isOpen).map(r => r.leave())); await server.close(); });
  const host = observe(await client.create('party', { name: 'Host' })); members.push(host);
  let guest = observe(await client.joinById(host.roomId, { name: 'Guest' })); members.push(guest);
  const room = server.rooms.get(host.roomId), state = room.state;
  const guestId = [...state.players.values()].find(p => p.name === 'Guest').id;
  const selection = ['windup', 'runner'];
  host.send('games', selection); host.send('start');
  await until(() => host.state.phase === 'lengthVote');
  host.send('vote', { phase: 'lengthVote', round: 0, choice: '1' });
  await delay(30); assert.equal([...state.players.values()].find(p => p.name === 'Host').vote, '', 'one-round vote is rejected');
  host.send('vote', { phase: 'lengthVote', round: 0, choice: '10' });
  let totals = new Map([...state.players.keys()].map(id => [id, 0]));
  for (let n = 1; n <= 10; n++) {
    await until(() => state.phase === 'playing' && state.sessionRound === n);
    assert.equal(state.gameId, selection[(n - 1) % selection.length]);
    assert.equal(state.sessionLength, 10);
    await until(() => guest.state.round === n && guest.state.phase === 'playing');
    assert.equal(guest.state.columns, state.columns);
    assert.equal(guest.state.players.get(guestId).hits, 0);
    if (n === 1) {
      host.send('action', { round: n, action: 'wind' });
      await until(() => [...state.players.values()].some(p => p.charge === 1));
      const token = guest.reconnectionToken;
      guest.reconnection.enabled = false; guest.connection.close(4010, 'recovery test');
      await until(() => !state.players.get(guestId).connected);
      guest = observe(await client.reconnect(token)); members.push(guest);
      await until(() => guest.state.players?.get(guestId)?.connected);
      assert.notEqual(guest.reconnectionToken, token);
      assert.equal(state.players.size, 2);
      assert.equal(guest.state.gameStage, 'winding');
    }
    // Advance the real fixed-step simulation without waiting 60–75 wall seconds.
    // Outcomes, hazards, phase transitions and awards still use production code.
    const dings = state.players.get(guestId).totalDings;
    const eliminations = state.players.get(guestId).totalEliminations;
    for (let ticks = 0; ticks < 2500 && state.phase === 'playing'; ticks++) room.step();
    assert.notEqual(state.phase, 'playing');
    if (state.gameId === 'runner') {
      assert.equal(state.players.get(guestId).totalDings, dings + 3);
      assert.equal(state.players.get(guestId).totalEliminations, eliminations + 1);
    }
    for (const p of state.players.values()) {
      totals.set(p.id, totals.get(p.id) + p.roundPoints);
      assert.equal(p.score, totals.get(p.id)); assert.equal(p.sessionPoints, p.score);
    }
  }
  await until(() => host.state.phase === 'results' && guest.state.phase === 'results');
  assert.deepEqual(host.state.toJSON(), guest.state.toJSON());
  const before = [...state.players.values()].map(p => p.score);
  room.step(); room.step(); assert.deepEqual([...state.players.values()].map(p => p.score), before);
  host.send('replay'); await until(() => guest.state.phase === 'lobby');
  assert.deepEqual([...state.players.values()].map(p => p.score), before);
  assert.equal(state.cellSize, 64); assert.equal(state.players.size, 2);
});
