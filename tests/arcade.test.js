import test from 'node:test';
import assert from 'node:assert/strict';
import { PartyState, PlayerState } from '../server/state.js';
import { games } from '../server/minigames/index.js';
import { PLAYER_COLORS, MAX_PLAYERS } from '../shared/constants.js';
import { WIND_MS, RELEASE_MS, RUN_JUMP_MS } from '../shared/arcade.js';
import { center, cell, entity } from '../server/minigames/arcade-common.js';

function setup(id, count = 3) {
  const state = new PartyState({ gameId: id, phase: 'playing', round: 5, sessionRound: 1 });
  const players = Array.from({ length: count }, (_, i) => new PlayerState({ id: String(i), name: `Player ${i}`, color: PLAYER_COLORS[i] }));
  for (const p of players) state.players.set(p.id, p);
  const round = games[id].createRound(state);
  const step = (ms = 34, inputs = new Map()) => games[id].updateRound(state, round, { dtMs: ms, inputs });
  const action = (p, action, extra = {}) => games[id].act?.(state, p, { action, round: state.round, ...extra }, round);
  return { state, round, players, step, action };
}

for (const id of ['windup', 'trails', 'maze', 'runner', 'bombs']) {
  test(`${id}: twelve distinct participants, late joins, action roles and bounded ending`, () => {
    const { state, round, players, step, action } = setup(id, MAX_PLAYERS);
    assert.equal(new Set(players.map(p => `${p.x}:${p.y}`)).size, MAX_PLAYERS);
    const late = new PlayerState({ id: 'late' }); state.players.set(late.id, late);
    for (const p of [late, players[0]]) {
      const before = JSON.stringify(p.toJSON());
      for (const name of ['wind', 'bomb', 'erase', 'jump', 'duck', 'stun']) action(p, name, { round: -1 });
      assert.equal(JSON.stringify(p.toJSON()), before);
    }
    players[0].connected = false;
    const before = JSON.stringify(players[0].toJSON());
    for (const name of ['wind', 'bomb', 'erase', 'jump', 'duck', 'stun']) action(players[0], name);
    assert.equal(JSON.stringify(players[0].toJSON()), before);
    let outcome;
    for (let i = 0; i < 2400 && !outcome; i++) outcome = step();
    assert.ok(outcome, 'game terminates even with idle or disconnected players');
    assert.ok(!outcome.winnerIds.includes('late'));
    assert.equal(step(5000), outcome, 'outcome is immutable');
    assert.ok(players.every(p => p.score === 0), 'only the party layer awards scores');
    assert.ok(round.participantIds.length === MAX_PLAYERS);
  });
}

test('wind-up counts distinct taps, freezes at the deadline, releases every toy and awards farthest +1', () => {
  const { state, players: [a, b, c], step, action } = setup('windup');
  action(a, 'wind'); action(a, 'wind'); action(a, 'wind', { charge: 9999 });
  assert.equal(a.charge, 1);
  step(80); action(a, 'wind'); action(b, 'wind');
  assert.equal(a.charge, 2);
  a.connected = false;
  step(WIND_MS - 80); action(b, 'wind');
  assert.equal(state.gameStage, 'racing'); assert.equal(b.charge, 1);
  step(RELEASE_MS / 2);
  assert.ok(a.distance > b.distance && b.distance > c.distance);
  const outcome = step(RELEASE_MS / 2);
  assert.equal(a.distance, 20); assert.equal(b.distance, 10);
  assert.deepEqual(outcome.pointsByPlayer, { [a.id]: 1 });
});

test('trails resolve head-on, reverse, old trails and edge collisions; only eliminated participants erase', () => {
  const { state, round, players: [a,b,c], step, action } = setup('trails');
  for (let i = 0; i < state.cells.length; i++) state.cells[i] = 0;
  Object.assign(a, center(state, 100), { facing: 0 });
  Object.assign(b, center(state, 102), { facing: 2 });
  Object.assign(c, center(state, 200), { facing: 0 });
  state.cells[101] = 10;
  action(a, 'erase'); assert.equal(state.cells[101], 10);
  state.cells[101] = 0;
  const result = step(180);
  assert.equal(a.alive, false); assert.equal(b.alive, false); assert.equal(c.alive, true);
  assert.deepEqual(result.winnerIds, [c.id]);
  // A live game with two survivors lets an eliminated participant keep playing.
  round.outcome = null; b.alive = true;
  state.cells[cell(state, a)] = 11;
  action(a, 'erase'); assert.equal(state.cells[cell(state, a)], 0);
  state.cells[cell(state, a)] = 11;
  action(a, 'erase'); assert.equal(state.cells[cell(state, a)], 11, 'erase cooldown bounds spam');
  Object.assign(b, center(state, 26), { facing: 0 });
  step(180, new Map([[b.id, { x: -1, y: 0 }]]));
  assert.equal(b.alive, false, 'cannot reverse out of an edge collision');
});

test('maze walls block movement, shared pickups are fair, power eats ghosts, and disconnects remain vulnerable', () => {
  const { state, round, players: [a,b,c], step } = setup('maze');
  state.entities.clear();
  Object.assign(a, center(state, 20)); Object.assign(b, center(state, 20));
  state.cells[20] = 3;
  step(130, new Map([[a.id, { x: -1, y: 0 }]]));
  assert.equal(cell(state, a), 20, 'boundary wall blocks input');
  assert.equal(a.collected, 5); assert.equal(b.collected, 5);
  entity(state, round, { kind: 'ghost', ...center(state, 20), due: 0 });
  step(1);
  assert.equal(a.collected, 15); assert.equal(b.collected, 15);
  assert.ok(state.entities[0].due > state.roundElapsedMs);
  state.entities.clear();
  c.connected = false; c.powerUntilMs = 0;
  round.ghostMoveMs = Infinity;
  entity(state, round, { kind: 'ghost', x: c.x, y: c.y });
  step(1); assert.equal(c.hits, 1);
  step(100); assert.equal(c.hits, 1, 'hit grace prevents one overlap consuming every life');
  step(1600); step(1600);
  assert.equal(c.alive, false); assert.equal(c.hits, 3);
  c.connected = true; step(1);
  assert.equal(c.alive, false, 'reconnection cannot revive a player');
});

test('runner jump and duck clear the matching hazards; three dings unlock a bounded aimed stun', () => {
  const { state, round, players: [a,b,c], step, action } = setup('runner');
  round.spawnAtMs = Infinity;
  function obstacle(kind, due = state.roundElapsedMs + 200) { entity(state, round, { kind, due, power: 2000, x: 200 }); }
  obstacle('hurdle'); action(a, 'jump'); action(b, 'duck');
  step(200);
  assert.equal(a.hits, 0); assert.equal(b.hits, 1); assert.equal(c.hits, 1);
  step(RUN_JUMP_MS);
  obstacle('bar'); action(a, 'duck'); action(b, 'jump'); step(200);
  assert.equal(a.hits, 0); assert.equal(b.hits, 2);
  step(700); obstacle('hurdle'); action(a, 'jump'); step(200);
  assert.equal(b.alive, false); assert.equal(c.alive, false);
  // Keep another survivor to test post-elimination play before the round ends.
  round.outcome = null; c.alive = true; c.hits = 0;
  step(600);
  b.x = a.x; b.y = a.y;
  action(b, 'stun');
  assert.equal(a.stunnedUntilMs, state.roundElapsedMs + 350);
  const jumped = a.jumpedAtMs; action(a, 'jump'); assert.equal(a.jumpedAtMs, jumped);
  action(b, 'stun'); assert.equal(a.stunnedUntilMs, state.roundElapsedMs + 350);
  step(400); action(a, 'jump'); assert.notEqual(a.jumpedAtMs, jumped);
});

test('bombs enforce capacity and walls, chain together, reveal powerups, and allow bounded random revenge', () => {
  const { state, round, players: [a,b,c], step, action } = setup('bombs');
  for (let i = 0; i < state.cells.length; i++) state.cells[i] = 0; state.entities.clear(); round.pick = () => 0;
  Object.assign(a, center(state, 100)); Object.assign(b, center(state, 102)); Object.assign(c, center(state, 200));
  action(a, 'bomb'); action(a, 'bomb'); assert.equal(state.entities.length, 1);
  action(b, 'bomb'); state.entities[1].due = 9000;
  state.cells[99] = 1; state.cells[101] = 2;
  Object.assign(a, center(state, 150));
  step(1800);
  assert.equal(state.cells[101], 4, 'crate reveals range powerup');
  assert.equal(state.entities.filter(e => e.kind === 'bomb').length, 1, 'crate stops a blast');
  assert.equal(state.entities.some(e => e.kind === 'flame' && cell(state, e) === 99), false);
  step(500);
  Object.assign(a, center(state, 101)); step(34); assert.equal(a.power, 3);
  Object.assign(a, center(state, 104)); action(a, 'bomb');
  Object.assign(a, center(state, 180));
  step(1800);
  assert.equal(state.entities.some(e => e.kind === 'bomb'), false, 'adjacent bombs chain immediately');
  assert.equal(b.alive, false);
  action(b, 'bomb'); action(b, 'bomb');
  assert.equal(state.entities.filter(e => e.kind === 'bomb').length, 1);
  assert.equal(state.entities.find(e => e.kind === 'bomb').due, state.roundElapsedMs + 2200);
  step(1000); action(b, 'bomb'); assert.equal(state.entities.filter(e => e.kind === 'bomb').length, 2);
});

test('all bomb garden twelve-player spawns have a two-step escape and crates remain to clear', () => {
  for (let sample = 0; sample < 20; sample++) {
    const { state, players } = setup('bombs', MAX_PLAYERS);
    assert.ok(state.cells.some(v => v === 2));
    for (const p of players) {
      assert.equal(state.cells[cell(state, p)], 0);
      assert.ok([1,-1,state.columns,-state.columns].some(d => state.cells[cell(state,p)+d] === 0 && state.cells[cell(state,p)+2*d] === 0));
    }
  }
});
