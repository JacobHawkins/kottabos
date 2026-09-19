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

function finalPair(schedule) {
  const shrink = schedule.slice(0, -1);
  const removed = new Set(shrink.map(({ tile }) => tile));
  return Array.from({ length: ARENA.columns * ARENA.rows }, (_, tile) => tile)
    .filter((tile) => !removed.has(tile));
}

function placeOnTile(player, tile) {
  player.x = (tile % ARENA.columns + 0.5) * ARENA.tileSize;
  player.y = (Math.floor(tile / ARENA.columns) + 0.5) * ARENA.tileSize;
}

for (const durationMs of [45_000, 20_000]) {
  test(`${durationMs / 1000}-second rounds show two safe final tiles before a separate fully warned removal`, () => {
    const state = fixture();
    const round = createRound(state, { seed: 'final-pair-timing', durationMs });
    const schedule = round.schedule;
    const final = schedule.at(-1);
    const pair = finalPair(schedule);
    const survivor = pair.find((tile) => tile !== final.tile);
    const pairReachedAt = Math.max(...schedule.slice(0, -1).map(({ goneAt }) => goneAt));
    assert.equal(schedule.length, 48);
    assert.equal(pair.length, 2);
    assert.ok(neighbors(pair[0]).includes(pair[1]), 'the final two tiles share a walkable edge');
    assert.ok(pair.includes(final.tile));
    assert.equal(schedule[0].warningAt, 4_000);
    assert.ok(schedule.every(({ warningAt, goneAt }) => Number.isFinite(warningAt) &&
      Number.isFinite(goneAt) && warningAt >= 0 && goneAt < durationMs));
    assert.ok(schedule.every(({ warningAt }, index) => index === 0 || warningAt >= schedule[index - 1].warningAt));
    assert.ok(final.warningAt - pairReachedAt >= 2_500, 'players can see and occupy both safe final tiles');
    assert.equal(final.goneAt - final.warningAt, TILE_WARNING_MS);
    assert.ok(durationMs - final.goneAt >= 2_500, 'the surviving tile remains until the deadline');

    placeOnTile(state.players.get('0'), final.tile);
    placeOnTile(state.players.get('1'), survivor);
    assert.equal(updateRound(state, round, { dtMs: pairReachedAt }), null);
    assert.deepEqual(state.tiles.map((value, tile) => value === TILE_SAFE ? tile : -1)
      .filter((tile) => tile >= 0), pair);
    assert.equal(state.tiles.filter((tile) => tile === TILE_GONE).length, 47);
    assert.equal(updateRound(state, round, { dtMs: final.warningAt - pairReachedAt - 1 }), null);
    assert.ok(pair.every((tile) => state.tiles[tile] === TILE_SAFE));
    assert.equal(updateRound(state, round, { dtMs: 1 }), null);
    assert.equal(state.tiles[final.tile], TILE_WARNING);
    assert.equal(state.tiles[survivor], TILE_SAFE);
    assert.equal(updateRound(state, round, { dtMs: TILE_WARNING_MS - 1 }), null);
    assert.ok([...state.players.values()].every((player) => player.alive));
    const outcome = updateRound(state, round, { dtMs: 1 });
    assert.equal(state.tiles[final.tile], TILE_GONE);
    assert.equal(state.tiles[survivor], TILE_SAFE);
    assert.equal(outcome.reason, 'last-survivor');
    assert.deepEqual(outcome.pointsByPlayer, { 1: 3 });
  });
}

test('three-second test rounds retain both final tiles rather than abbreviating the finale warning', () => {
  const state = fixture();
  const round = createRound(state, { seed: 'short-final-pair', durationMs: 3_000 });
  assert.equal(round.schedule.length, 47);
  const removed = new Set(round.schedule.map(({ tile }) => tile));
  const pair = Array.from({ length: 49 }, (_, tile) => tile).filter((tile) => !removed.has(tile));
  assert.equal(removed.size, 47);
  assert.equal(pair.length, 2);
  assert.ok(neighbors(pair[0]).includes(pair[1]));
  assert.ok(round.schedule.every(({ warningAt, goneAt }) => warningAt >= 0 &&
    goneAt - warningAt === TILE_WARNING_MS && goneAt < round.durationMs));
  placeOnTile(state.players.get('0'), pair[0]);
  placeOnTile(state.players.get('1'), pair[1]);
  const outcome = updateRound(state, round, { dtMs: 5_000 });
  assert.equal(state.roundElapsedMs, 3_000);
  assert.ok(pair.every((tile) => state.tiles[tile] === TILE_SAFE));
  assert.equal(state.tiles.filter((tile) => tile === TILE_GONE).length, 47);
  assert.equal(outcome.reason, 'deadline');
  assert.deepEqual(outcome.pointsByPlayer, { 0: 1, 1: 1 });

  const stationaryState = fixture();
  const stationaryRound = createRound(stationaryState, { seed: 'short-final-pair', durationMs: 3_000 });
  const stationaryOutcome = updateRound(stationaryState, stationaryRound, { dtMs: 3_000 });
  assert.equal(stationaryOutcome.reason, 'simultaneous-elimination');
  assert.deepEqual(stationaryOutcome.pointsByPlayer, { 0: 1, 1: 1 });
  assert.ok([...stationaryState.players.values()].every((player) => !player.alive));
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

test('varied final pairs retain connected floor and either endpoint can survive', () => {
  const tileCount = ARENA.columns * ARENA.rows;
  const islands = new Set();
  const pairOutcomes = new Map();
  const pairPatterns = new Map();
  for (let seed = 0; seed < 200; seed += 1) {
    const schedule = createTileSchedule(`variety:${seed}`);
    const pair = finalPair(schedule);
    const pairKey = pair.join(',');
    const survivor = pair.find((tile) => tile !== schedule.at(-1).tile);
    assert.equal(pair.length, 2);
    assert.ok(neighbors(pair[0]).includes(pair[1]));
    if (!pairOutcomes.has(pairKey)) pairOutcomes.set(pairKey, new Set());
    pairOutcomes.get(pairKey).add(survivor);
    if (!pairPatterns.has(pairKey)) pairPatterns.set(pairKey, new Set());
    pairPatterns.get(pairKey).add(schedule.slice(0, -1).map(({ tile }) => tile).join(','));
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
  assert.equal(pairOutcomes.size, 12, 'rounds use all horizontal and vertical pairs within the central 3x3 area');
  for (const [pair, outcomes] of pairOutcomes) {
    assert.equal(outcomes.size, 2, `either tile in pair ${pair} can survive`);
    assert.ok(pairPatterns.get(pair).size > 1, `pair ${pair} has varying earlier collapse patterns`);
  }
});

test('players can escape the final warning onto its adjacent survivor and tie at the deadline', () => {
  const state = fixture();
  const round = createRound(state, { seed: 'walk-to-final-survivor' });
  const final = round.schedule.at(-1);
  const survivor = finalPair(round.schedule).find((tile) => tile !== final.tile);
  const player = state.players.get('0');
  placeOnTile(player, final.tile);
  placeOnTile(state.players.get('1'), survivor);
  assert.equal(updateRound(state, round, { dtMs: final.warningAt }), null);
  const destination = state.players.get('1');
  const direction = { x: Math.sign(destination.x - player.x), y: Math.sign(destination.y - player.y) };
  const crossingMs = ARENA.tileSize / PLAYER_SPEED * 1000;
  assert.equal(updateRound(state, round, { dtMs: crossingMs, inputs: new Map([['0', direction]]) }), null);
  assert.equal(tileIndexAt(player), survivor);
  assert.equal(updateRound(state, round, { dtMs: final.goneAt - round.elapsedMs }), null);
  assert.ok([...state.players.values()].every((entry) => entry.alive));
  const outcome = updateRound(state, round, { dtMs: round.durationMs });
  assert.equal(state.roundElapsedMs, round.durationMs);
  assert.equal(outcome.reason, 'deadline');
  assert.deepEqual(outcome.pointsByPlayer, { 0: 1, 1: 1 });
  assert.equal(updateRound(state, round, { dtMs: 1_000 }), outcome);
  assert.equal(finishRound(state, round), outcome);
});

test('players sharing the removed final tile fall together and tie without scoring twice', () => {
  const state = fixture();
  const round = createRound(state, { seed: 'shared-final-fall' });
  const final = round.schedule.at(-1);
  for (const player of state.players.values()) placeOnTile(player, final.tile);
  assert.equal(updateRound(state, round, { dtMs: final.goneAt - 1 }), null);
  const outcome = updateRound(state, round, { dtMs: 1 });
  assert.equal(outcome.reason, 'simultaneous-elimination');
  assert.deepEqual(outcome.pointsByPlayer, { 0: 1, 1: 1 });
  assert.ok([...state.players.values()].every((player) => !player.alive && player.score === 5));
  assert.equal(updateRound(state, round, { dtMs: round.durationMs }), outcome);
  assert.equal(finishRound(state, round), outcome);
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
