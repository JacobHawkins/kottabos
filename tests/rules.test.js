import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, PLAYER_SPEED, TILE_GONE, TILE_SAFE, TILE_WARNING, TILE_WARNING_MS } from '../shared/constants.js';
import { movePlayer, normalizeInput, tileIndexAt } from '../shared/movement.js';
import { createRound, createTileSchedule, finishRound, updateRound } from '../server/minigames/stay-on-platform.js';

function fixture(count = 2) {
  return {
    tiles: [],
    players: new Map(Array.from({ length: count }, (_, index) => [String(index), {
      name: `Player ${index}`, connected: true, ready: true, score: 5,
      x: 0, y: 0, alive: false, participating: false,
    }])),
    roundElapsedMs: 0,
  };
}

test('shared movement normalizes diagonal speed, ignores invalid input, and clamps edges', () => {
  const start = { x: 224, y: 224 };
  const straight = movePlayer(start, { x: 1, y: 0 }, 1);
  const diagonal = movePlayer(start, { x: 1, y: 1 }, 1);
  assert.equal(straight.x - start.x, PLAYER_SPEED);
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.y - start.y) - PLAYER_SPEED) < 0.00001);
  assert.deepEqual(normalizeInput({ x: Infinity, y: NaN }), { x: 0, y: 0 });
  assert.deepEqual(movePlayer(start, { x: 1, y: 1 }, -1), start);
  const edge = movePlayer({ x: 1, y: ARENA.height - 1 }, { x: -1, y: 1 }, 10);
  assert.equal(edge.x, 0.01);
  assert.equal(edge.y, ARENA.height - 0.01);
  assert.equal(tileIndexAt(edge), 42);
  assert.equal(tileIndexAt({ x: NaN, y: 1 }), -1);
});

test('seeded hazards warn every disappearing tile and preserve the final island', () => {
  const schedule = createTileSchedule('party:round-1');
  assert.deepEqual(schedule, createTileSchedule('party:round-1'));
  assert.notDeepEqual(schedule, createTileSchedule('party:round-2'));
  assert.equal(new Set(schedule.map((event) => event.tile)).size, 48);
  assert.ok(schedule.every((event) => Number.isInteger(event.tile) && event.tile >= 0 && event.tile < 49));
  assert.equal(schedule[0].warningAt, 4_000);
  assert.ok(schedule.every((event) => event.goneAt - event.warningAt >= TILE_WARNING_MS - 0.001));
  assert.ok(schedule.every((event) => event.goneAt < 45_000));
});

function neighbors(tile) {
  const column = tile % ARENA.columns;
  const row = Math.floor(tile / ARENA.columns);
  return [
    column > 0 ? tile - 1 : -1,
    column < ARENA.columns - 1 ? tile + 1 : -1,
    row > 0 ? tile - ARENA.columns : -1,
    row < ARENA.rows - 1 ? tile + ARENA.columns : -1,
  ].filter((index) => index >= 0);
}

test('varied final islands retain connected floor and enough warning time to escape each wave', () => {
  const tileCount = ARENA.columns * ARENA.rows;
  const islands = new Set();
  for (let seed = 0; seed < 200; seed += 1) {
    const schedule = createTileSchedule(`variety:${seed}`);
    const remaining = new Set(Array.from({ length: tileCount }, (_, index) => index));
    const waves = Map.groupBy(schedule, (event) => event.goneAt);
    for (const wave of waves.values()) {
      for (const { tile } of wave) remaining.delete(tile);
      const visited = new Set();
      const frontier = [remaining.values().next().value];
      for (const tile of frontier) {
        if (visited.has(tile)) continue;
        visited.add(tile);
        frontier.push(...neighbors(tile).filter((next) => remaining.has(next) && !visited.has(next)));
      }
      assert.equal(visited.size, remaining.size, `seed ${seed} retains one connected island`);

      // Start at any point in a warned tile, then follow orthogonal tile
      // centers to a surviving tile. Include a whole tile of extra distance
      // for that initial position, so a center-only path cannot hide a trap.
      const availableBefore = new Set([...remaining, ...wave.map(({ tile }) => tile)]);
      for (const { tile: warnedTile } of wave) {
        const distances = new Map([[warnedTile, 0]]);
        const escape = [warnedTile];
        let steps;
        for (const tile of escape) {
          if (remaining.has(tile)) { steps = distances.get(tile); break; }
          for (const next of neighbors(tile)) {
            if (availableBefore.has(next) && !distances.has(next)) {
              distances.set(next, distances.get(tile) + 1);
              escape.push(next);
            }
          }
        }
        assert.ok((steps + 1) * ARENA.tileSize <= PLAYER_SPEED * TILE_WARNING_MS / 1000,
          `seed ${seed} gives tile ${warnedTile} enough time to reach surviving floor`);
      }
    }
    assert.equal(remaining.size, 1);
    islands.add(remaining.values().next().value);
  }
  assert.equal(islands.size, 9, 'seeded rounds can end on each of the nine central destinations');
  assert.ok(islands.has(24), 'the center remains one possible destination');
});

test('countdown captures connected participants; reset preserves scores and clears floor', () => {
  const state = fixture(3);
  state.players.get('2').connected = false;
  state.tiles = Array(49).fill(TILE_GONE);
  const round = createRound(state, { seed: 7 });
  assert.deepEqual(round.participantIds, ['0', '1']);
  assert.ok(state.tiles.every((tile) => tile === TILE_SAFE));
  assert.equal(state.players.get('0').alive, true);
  assert.equal(state.players.get('0').score, 5);
  assert.equal(state.players.get('2').participating, false);
  assert.equal(state.players.get('2').alive, false);
});

test('warnings do not eliminate until the exact disappearance step', () => {
  const state = fixture();
  const round = createRound(state);
  round.schedule = [{ tile: 8, warningAt: 100, goneAt: 1900 }];
  assert.equal(updateRound(state, round, { dtMs: 100 }), null);
  assert.equal(state.tiles[8], TILE_WARNING);
  assert.equal(state.players.get('0').alive, true);
  assert.equal(updateRound(state, round, { dtMs: 1799 }), null);
  const outcome = updateRound(state, round, { dtMs: 1 });
  assert.equal(state.players.get('0').alive, false);
  assert.equal(state.tiles[8], TILE_GONE);
  assert.deepEqual(outcome.winnerIds, ['1']);
  assert.deepEqual(outcome.pointsByPlayer, { 1: 3 });
});

test('simultaneous final falls tie at one point each; finishing cannot award twice', () => {
  const state = fixture();
  const round = createRound(state);
  round.schedule = [8, 40].map((tile) => ({ tile, warningAt: 0, goneAt: 100 }));
  const outcome = updateRound(state, round, { dtMs: 100 });
  assert.deepEqual(outcome.winnerIds, ['0', '1']);
  assert.deepEqual(outcome.pointsByPlayer, { 0: 1, 1: 1 });
  assert.equal(outcome.reason, 'simultaneous-elimination');
  assert.equal(updateRound(state, round, { dtMs: 1000 }), outcome);
  assert.equal(finishRound(state, round), outcome);
  assert.equal(state.players.get('0').score, 5, 'party owns cumulative scoring');
});

test('deadline survivors tie and late spectators never earn points', () => {
  const state = fixture();
  const round = createRound(state, { durationMs: 3000 });
  round.schedule = [];
  state.players.set('late', { name: 'Late', connected: true, participating: false, alive: false });
  const outcome = updateRound(state, round, { dtMs: 5000 });
  assert.equal(state.roundElapsedMs, 3000);
  assert.equal(outcome.reason, 'deadline');
  assert.deepEqual(outcome.pointsByPlayer, { 0: 1, 1: 1 });
});

test('disconnected players stop moving, remain vulnerable, and cannot revive on rejoin', () => {
  const state = fixture(3);
  const round = createRound(state);
  const player = state.players.get('0');
  player.connected = false;
  round.schedule = [{ tile: 8, warningAt: 0, goneAt: 100 }];
  assert.equal(updateRound(state, round, { dtMs: 100, inputs: new Map([['0', { x: 1, y: 0 }]]) }), null);
  assert.equal(player.x, 96);
  assert.equal(player.alive, false);
  player.connected = true;
  updateRound(state, round, { dtMs: 100, inputs: new Map([['0', { x: 1, y: 0 }]]) });
  assert.equal(player.alive, false);
  assert.equal(player.x, 96);
});

test('a permanent leave cannot prevent the remaining player winning', () => {
  const state = fixture();
  const round = createRound(state);
  state.players.delete('0');
  const outcome = updateRound(state, round, { dtMs: 1000 / 30 });
  assert.deepEqual(outcome.winnerIds, ['1']);
  assert.deepEqual(outcome.pointsByPlayer, { 1: 3 });
});

test('permanent removal settles an existing sole survivor before the next hazard', () => {
  const state = fixture();
  const round = createRound(state);
  state.players.delete('0');
  round.schedule = [{ tile: 40, warningAt: 0, goneAt: 1000 / 30 }];
  const outcome = updateRound(state, round, { dtMs: 1000 / 30 });
  assert.equal(outcome.reason, 'last-survivor');
  assert.deepEqual(outcome.pointsByPlayer, { 1: 3 });
  assert.equal(state.players.get('1').alive, true);
  assert.equal(state.roundElapsedMs, 0, 'round stops before an unnecessary simulation step');
});

test('removing every participant ends a round without awarding points', () => {
  const state = fixture();
  const round = createRound(state);
  state.players.clear();
  const outcome = updateRound(state, round, { dtMs: 1000 / 30 });
  assert.equal(outcome.reason, 'no-participants');
  assert.deepEqual(outcome.winnerIds, []);
  assert.deepEqual(outcome.pointsByPlayer, {});
});
