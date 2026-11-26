import test from 'node:test';
import assert from 'node:assert/strict';
import { PartyState, PlayerState } from '../server/state.js';
import { games } from '../server/minigames/index.js';
import { PLAYER_COLORS, MAX_PLAYERS } from '../shared/constants.js';
import { WIND_MS, RELEASE_MS, RUN_JUMP_MS, WIND_BURST, WIND_PER_SECOND, windTrackY, runnerObstacleX, RUNNER_X } from '../shared/arcade.js';
import { entity } from '../server/minigames/arcade-common.js';

function setup(id, count = 3) {
  const state = new PartyState({ gameId: id, phase: 'playing', round: 5, sessionRound: 1 });
  const players = Array.from({ length: count }, (_, i) => new PlayerState({ id: String(i), name: `Player ${i}`, color: PLAYER_COLORS[i] }));
  for (const p of players) state.players.set(p.id, p);
  const round = games[id].createRound(state);
  const step = (ms = 34, inputs = new Map()) => games[id].updateRound(state, round, { dtMs: ms, inputs });
  const action = (p, action, extra = {}) => games[id].act?.(state, p, { action, round: state.round, ...extra }, round);
  return { state, round, players, step, action };
}

for (const id of ['windup', 'runner']) {
  test(`${id}: twelve distinct participants, late joins, action roles and bounded ending`, () => {
    const { state, round, players, step, action } = setup(id, MAX_PLAYERS);
    assert.equal(new Set(players.map(p => `${p.x}:${p.y}`)).size, MAX_PLAYERS);
    const late = new PlayerState({ id: 'late' }); state.players.set(late.id, late);
    for (const p of [late, players[0]]) {
      const before = JSON.stringify(p.toJSON());
      for (const name of ['wind', 'jump', 'duck', 'stun']) action(p, name, { round: -1 });
      assert.equal(JSON.stringify(p.toJSON()), before);
    }
    players[0].connected = false;
    const before = JSON.stringify(players[0].toJSON());
    for (const name of ['wind', 'jump', 'duck', 'stun']) action(players[0], name);
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
  assert.equal(a.charge, 3);
  step(80); action(a, 'wind'); action(b, 'wind');
  assert.equal(a.charge, 4);
  a.connected = false;
  step(WIND_MS - 80); action(b, 'wind');
  assert.equal(state.gameStage, 'racing'); assert.equal(b.charge, 1);
  step(RELEASE_MS / 2);
  assert.ok(a.distance > b.distance && b.distance > c.distance);
  const outcome = step(RELEASE_MS / 2);
  assert.equal(a.distance, 40); assert.equal(b.distance, 10);
  assert.deepEqual(outcome.pointsByPlayer, { [a.id]: 1 });
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

test('wind-up accepts rapid distinct taps and network bursts, but bounds sustained flooding', () => {
  const { state, players: [a], step, action } = setup('windup');
  for (let i = 0; i < WIND_BURST + 1000; i++) action(a, 'wind');
  assert.equal(a.charge, WIND_BURST);
  step(100); action(a, 'wind'); action(a, 'wind'); action(a, 'wind'); action(a, 'wind');
  assert.equal(a.charge, WIND_BURST + 3);
  for (let ms = 100; ms < WIND_MS; ms += 50) {
    step(50);
    for (let i = 0; i < 100; i++) action(a, 'wind');
  }
  assert.ok(a.charge <= WIND_BURST + WIND_MS / 1000 * WIND_PER_SECOND);
  const finalCharge = a.charge;
  action(a, 'wind'); assert.equal(a.charge, finalCharge);
  step(RELEASE_MS);
  assert.ok(a.x <= 600);
  assert.equal(a.y, windTrackY(a.x, a.lane, 3));
  assert.equal(state.gameStage, 'racing');
});

test('toy hills rise and fall while staying in separate lanes for twelve players', () => {
  const { players, step, action } = setup('windup', 12);
  for (const p of players) for (let i = 0; i < 8; i++) action(p, 'wind');
  step(WIND_MS + RELEASE_MS / 3);
  for (const p of players) {
    assert.equal(p.y, windTrackY(p.x, p.lane, 12));
    assert.ok(Math.abs(p.y - p.lane) <= 448 / 12 / 4);
  }
  assert.ok(windTrackY(80, 200, 2) > 200);
  assert.ok(windTrackY(180, 200, 2) < 200);
});

test('runner obstacles cross the feet at contact, remain visible afterward, and ding only once', () => {
  const { state, round, players: [a], step } = setup('runner');
  round.spawnAtMs = Infinity;
  const e = entity(state, round, { kind: 'hurdle', due: 1000, power: 2000 });
  assert.ok(runnerObstacleX(e, 900) > RUNNER_X);
  assert.equal(runnerObstacleX(e, 1000), a.x);
  assert.ok(runnerObstacleX(e, 1100) < RUNNER_X);
  step(1000);
  assert.equal(a.hits, 1);
  assert.ok(state.entities.includes(e));
  step(100); assert.equal(a.hits, 1);
  step(200); assert.equal(a.hits, 1);
  assert.equal(state.entities.length, 0);
});

test('removed game ids cannot be selected or instantiated', async () => {
  const { MINIGAMES } = await import('../shared/party.js');
  assert.deepEqual(Object.keys(games), ['platform', 'rope', 'windup', 'runner']);
  assert.deepEqual(Object.keys(MINIGAMES), Object.keys(games));
});

test('departing racers do not change the distance scale or hills under remaining toys', () => {
  const { state, players: [a, b], step, action } = setup('windup');
  for (let n = 0; n < 8; n++) action(a, 'wind');
  action(b, 'wind');
  step(WIND_MS + 1000);
  const x = b.x, y = b.y;
  state.players.delete(a.id);
  step(0);
  assert.equal(b.x, x);
  assert.equal(b.y, y);
  assert.equal(state.laneCount, 3);
});
