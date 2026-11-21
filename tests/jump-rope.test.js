import test from 'node:test';
import assert from 'node:assert/strict';
import { PartyState, PlayerState } from '../server/state.js';
import { act, createRound, updateRound } from '../server/minigames/jump-rope.js';
import { MAX_PLAYERS } from '../shared/constants.js';

function court(count) {
  const state = new PartyState();
  state.gameId = 'rope';
  state.phase = 'playing';
  state.round = 4;
  const players = Array.from({ length: count }, (_, i) => {
    const p = new PlayerState();
    p.id = p.name = String(i + 1);
    state.players.set(p.id, p);
    return p;
  });
  const round = createRound(state);
  const tickTo = time => updateRound(state, round, { dtMs: time - state.roundElapsedMs });
  const action = (player, action, overrides) => act(state, player, {
    round: state.round, swing: state.ropeSwing, action, ...overrides
  });
  function swing(jumpers = []) {
    tickTo(state.ropeHitMs - 225);
    for (const p of jumpers) action(p, 'jump');
    return tickTo(state.ropeHitMs);
  }
  return { state, players, swing, action, tickTo };
}

test('three misses take a jumper out, successful jumps clear the rope, and only the final survivors score', () => {
  const { state, players: [a,b,c], swing, tickTo } = court(3);
  b.connected = false;
  assert.equal(swing([a]), null);
  assert.equal(swing([a]), null);
  assert.deepEqual([a.ropeDings, b.ropeDings, c.ropeDings], [0, 2, 2]);
  assert.ok(b.alive && c.alive);
  const result = swing([a]);
  assert.deepEqual(result.pointsByPlayer, { [a.id]: 3 });
  assert.equal(b.alive, false);
  assert.equal(result, tickTo(state.ropeHitMs + 1));
  const tied = court(3);
  tied.swing([tied.players[0], tied.players[1]]);
  tied.swing(); tied.swing(); tied.swing();
  assert.deepEqual(tied.tickTo(tied.state.ropeHitMs).pointsByPlayer, { 1: 1, 2: 1 });
});

test('actions are scoped to role, connection, round and swing, and jumps require a landing and recovery', () => {
  const { state, players: [p], action, tickTo } = court(2);
  action(p, 'pull');
  assert.equal(state.ropePulls, 0);
  action(p, 'jump', { round: state.round - 1 });
  action(p, 'jump', { swing: 2 });
  p.participating = false; action(p, 'jump'); p.participating = true;
  p.connected = false; action(p, 'jump'); p.connected = true;
  state.phase = 'countdown'; action(p, 'jump'); state.phase = 'playing';
  assert.equal(p.jumpedAtMs, -1);
  action(p, 'jump', { jumpedAtMs: 1700 });
  assert.equal(p.jumpedAtMs, 0);
  tickTo(580); action(p, 'jump');
  assert.equal(p.jumpedAtMs, 0);
  tickTo(750); action(p, 'jump');
  assert.equal(p.jumpedAtMs, 750);
});

test('ten eliminated players can compound pulls on the next swing without moving a published contact', () => {
  const { state, players, swing, action, tickTo } = court(MAX_PLAYERS);
  const finalists = players.slice(0, 2);
  for (let i = 0; i < 3; i++) swing(finalists);
  assert.equal(players.filter(p => p.alive).length, 2);
  const due = state.ropeHitMs;
  for (const p of players.slice(2)) {
    action(p, 'pull'); action(p, 'pull'); action(p, 'jump');
  }
  assert.equal(state.ropeHitMs, due);
  assert.equal(state.ropePulls, 10);
  swing(finalists);
  assert.ok(state.ropeHitMs - state.ropeStartMs < 120);
  action(players[2], 'pull');
  assert.equal(state.ropePulls, 11);
  const flattened = tickTo(state.ropeHitMs + 1500);
  assert.deepEqual(flattened.pointsByPlayer, { 1: 1, 2: 1 });
});

test('even perfectly timed attempts run out of recovery time as the unassisted rope accelerates', () => {
  const { state, players, swing } = court(2);
  let result;
  const openingPeriod = state.ropeHitMs;
  while (!result && state.roundElapsedMs < 50_000) result = swing(players);
  assert.deepEqual(result.pointsByPlayer, { 1: 1, 2: 1 });
  assert.ok(state.roundElapsedMs < 50_000);
  assert.ok(state.ropeHitMs - state.ropeStartMs < openingPeriod / 2);
  assert.equal(state.ropePulls, 0);
});
