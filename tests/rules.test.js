import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, PLAYER_SPEED, STEP_MS, TILE_GONE, TILE_SAFE, TILE_WARNING, TILE_WARNING_MS } from '../shared/constants.js';
import { movePlayer, normalizeInput, tileIndexAt } from '../shared/movement.js';
import { createRound, finishRound, updateRound } from '../server/minigames/stay-on-platform.js';

function fixture(count = 2) {
  return {
    tiles: [],
    tileGoneAtMs: [],
    players: new Map(Array.from({ length: count }, (_, index) => [String(index), {
      name: `Player ${index}`, connected: true, score: 5,
      x: 0, y: 0, alive: false, participating: false,
    }])),
    roundElapsedMs: 0,
  };
}

function placeOnTile(player, tile) {
  player.x = (tile % ARENA.columns + 0.5) * ARENA.tileSize;
  player.y = (Math.floor(tile / ARENA.columns) + 0.5) * ARENA.tileSize;
}

function advance(state, round, durationMs, inputs = new Map()) {
  let remaining = durationMs;
  let outcome = null;
  while (remaining > 0.000001 && !outcome) {
    const dtMs = Math.min(STEP_MS, remaining);
    outcome = updateRound(state, round, { dtMs, inputs });
    remaining -= dtMs;
  }
  return outcome;
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

test('countdown captures connected participants and resets floor timers without starting them or changing scores', () => {
  const state = fixture(3);
  state.players.get('2').connected = false;
  state.tiles = Array(49).fill(TILE_GONE);
  state.tileGoneAtMs = Array(49).fill(1234);
  const round = createRound(state);
  assert.deepEqual(round.participantIds, ['0', '1']);
  assert.ok(state.tiles.every((tile) => tile === TILE_SAFE));
  assert.ok(state.tileGoneAtMs.every((deadline) => deadline === 0));
  assert.equal(state.roundElapsedMs, 0);
  assert.equal(state.players.get('0').alive, true);
  assert.equal(state.players.get('0').score, 5);
  assert.equal(state.players.get('2').participating, false);
  assert.equal(state.players.get('2').alive, false);
});

test('the first playing step warns spawn tiles before movement and starts each entered tile independently', () => {
  const state = fixture();
  const round = createRound(state);
  const player = state.players.get('0');
  player.x = 127;
  const startTile = tileIndexAt(player);
  assert.equal(updateRound(state, round, { dtMs: STEP_MS, inputs: new Map([['0', { x: 1, y: 0 }]]) }), null);
  const enteredTile = tileIndexAt(player);
  assert.notEqual(startTile, enteredTile);
  assert.equal(state.tiles[startTile], TILE_WARNING);
  assert.equal(state.tileGoneAtMs[startTile], TILE_WARNING_MS);
  assert.equal(state.tiles[enteredTile], TILE_WARNING);
  assert.equal(state.tileGoneAtMs[enteredTile], TILE_WARNING_MS + STEP_MS);
  assert.equal(state.tileGoneAtMs[tileIndexAt(state.players.get('1'))], TILE_WARNING_MS);
  assert.equal(state.tiles.filter((tile) => tile === TILE_WARNING).length, 3);
  assert.equal(state.tiles[24], TILE_SAFE, 'untouched central floor has no special schedule');
  assert.equal(state.tileGoneAtMs[24], 0);
});

test('leaving, revisiting and sharing a warning tile never reset its countdown', () => {
  const state = fixture();
  const round = createRound(state);
  const player = state.players.get('0');
  const originalTile = tileIndexAt(player);
  const tileTravelMs = ARENA.tileSize / PLAYER_SPEED * 1000;
  assert.equal(advance(state, round, tileTravelMs, new Map([['0', { x: 1, y: 0 }]])), null);
  const nextTile = tileIndexAt(player);
  const nextDeadline = state.tileGoneAtMs[nextTile];
  assert.notEqual(nextTile, originalTile);
  assert.ok(nextDeadline > TILE_WARNING_MS);
  assert.equal(advance(state, round, tileTravelMs, new Map([['0', { x: -1, y: 0 }]])), null);
  assert.equal(tileIndexAt(player), originalTile);
  assert.equal(state.tileGoneAtMs[originalTile], TILE_WARNING_MS);
  assert.equal(state.tileGoneAtMs[nextTile], nextDeadline, 'the vacated tile keeps counting down');
  placeOnTile(state.players.get('1'), originalTile);
  assert.equal(updateRound(state, round, { dtMs: 100 }), null);
  assert.equal(state.tileGoneAtMs[originalTile], TILE_WARNING_MS, 'a second player cannot extend it');
  assert.equal(state.tileGoneAtMs[nextTile], nextDeadline);
});

test('warnings last the full interval, then stationary participants fall together exactly at disappearance', () => {
  const state = fixture();
  const round = createRound(state);
  const spawnTiles = [...state.players.values()].map(tileIndexAt);
  assert.equal(updateRound(state, round, { dtMs: TILE_WARNING_MS - 1 }), null);
  assert.ok(spawnTiles.every((tile) => state.tiles[tile] === TILE_WARNING));
  assert.ok([...state.players.values()].every((player) => player.alive));
  const outcome = updateRound(state, round, { dtMs: 1 });
  assert.ok(spawnTiles.every((tile) => state.tiles[tile] === TILE_GONE));
  assert.equal(state.tiles.filter((tile) => tile === TILE_GONE).length, 2);
  assert.equal(outcome.reason, 'simultaneous-elimination');
  assert.deepEqual(outcome.pointsByPlayer, { 0: 1, 1: 1 });
  assert.equal(outcome.resultText, 'Player 0 & Player 1 tie! +1 point each');
  assert.ok([...state.players.values()].every((player) => !player.alive && player.score === 5));
  assert.equal(updateRound(state, round, { dtMs: 10_000 }), outcome);
  assert.equal(finishRound(state, round), outcome);
  assert.equal(state.roundElapsedMs, TILE_WARNING_MS, 'a settled round no longer advances');
});

test('moving off on the disappearance step escapes and leaves the vacated tile permanently gone', () => {
  const state = fixture();
  const round = createRound(state);
  const player = state.players.get('1');
  player.x = 383;
  const oldTile = tileIndexAt(player);
  assert.equal(updateRound(state, round, { dtMs: TILE_WARNING_MS - STEP_MS }), null);
  const outcome = updateRound(state, round, { dtMs: STEP_MS, inputs: new Map([['1', { x: 1, y: 0 }]]) });
  assert.equal(state.tiles[oldTile], TILE_GONE);
  assert.notEqual(tileIndexAt(player), oldTile);
  assert.equal(player.alive, true);
  assert.equal(state.tileGoneAtMs[tileIndexAt(player)], TILE_WARNING_MS * 2);
  assert.equal(outcome.reason, 'last-survivor');
  assert.deepEqual(outcome.winnerIds, ['1']);
  assert.deepEqual(outcome.pointsByPlayer, { 1: 3 });
});

test('walking onto an already missing tile eliminates without reviving the floor', () => {
  const state = fixture(3);
  const round = createRound(state);
  const player = state.players.get('0');
  const missingTile = tileIndexAt(player) + 1;
  state.tiles[missingTile] = TILE_GONE;
  player.x = 127;
  assert.equal(updateRound(state, round, { dtMs: STEP_MS, inputs: new Map([['0', { x: 1, y: 0 }]]) }), null);
  assert.equal(tileIndexAt(player), missingTile);
  assert.equal(player.alive, false);
  assert.equal(state.tiles[missingTile], TILE_GONE);
  assert.equal(state.tileGoneAtMs[missingTile], 0);
});

test('every arena tile can be triggered and fall, including the center and boundary tiles', () => {
  for (let tile = 0; tile < ARENA.columns * ARENA.rows; tile += 1) {
    const state = fixture();
    const round = createRound(state);
    for (const player of state.players.values()) placeOnTile(player, tile);
    assert.equal(updateRound(state, round, { dtMs: 1 }), null);
    assert.equal(state.tiles[tile], TILE_WARNING, `tile ${tile} warns when occupied`);
    const outcome = updateRound(state, round, { dtMs: TILE_WARNING_MS - 1 });
    assert.equal(state.tiles[tile], TILE_GONE, `tile ${tile} can disappear`);
    assert.equal(outcome.reason, 'simultaneous-elimination');
    assert.equal(state.tiles.filter((value) => value === TILE_GONE).length, 1);
  }
});

test('player-driven paths continue beyond the old deadline and untouched floor stays safe', () => {
  const state = fixture();
  const round = createRound(state);
  for (const player of state.players.values()) placeOnTile(player, 0);
  const route = Array.from({ length: ARENA.rows }, (_, row) =>
    Array.from({ length: ARENA.columns }, (_, column) => row * ARENA.columns +
      (row % 2 ? ARENA.columns - column - 1 : column))).flat();
  for (const next of route.slice(1, 31)) {
    assert.equal(advance(state, round, 1200), null);
    const player = state.players.get('0');
    const x = (next % ARENA.columns + 0.5) * ARENA.tileSize;
    const y = (Math.floor(next / ARENA.columns) + 0.5) * ARENA.tileSize;
    const direction = {
      x: Math.abs(x - player.x) < 0.001 ? 0 : Math.sign(x - player.x),
      y: Math.abs(y - player.y) < 0.001 ? 0 : Math.sign(y - player.y),
    };
    const inputs = new Map([...state.players.keys()].map((id) => [id, direction]));
    assert.equal(advance(state, round, ARENA.tileSize / PLAYER_SPEED * 1000, inputs), null);
    assert.equal(tileIndexAt(player), next);
  }
  assert.ok(state.roundElapsedMs > 45_000);
  assert.ok([...state.players.values()].every((player) => player.alive));
  assert.equal(round.outcome, null);
  assert.equal(state.tiles[48], TILE_SAFE);
  assert.equal(state.tileGoneAtMs[48], 0);
  assert.ok(state.tiles.filter((tile) => tile === TILE_GONE).length > 25, 'old footprints continue falling');
});

test('eliminated players and late spectators cannot move or start floor countdowns', () => {
  const state = fixture(3);
  const round = createRound(state);
  const eliminated = state.players.get('2');
  eliminated.alive = false;
  placeOnTile(eliminated, 24);
  state.players.set('late', { name: 'Late', connected: true, participating: false, alive: false, x: 32, y: 32 });
  assert.equal(updateRound(state, round, { dtMs: 100, inputs: new Map([
    ['2', { x: 1, y: 0 }], ['late', { x: 1, y: 0 }],
  ]) }), null);
  assert.equal(state.tiles[24], TILE_SAFE);
  assert.equal(state.tileGoneAtMs[24], 0);
  assert.equal(state.tiles[0], TILE_SAFE);
  assert.equal(eliminated.x, 224);
  assert.equal(state.players.get('late').x, 32);
  const outcome = updateRound(state, round, { dtMs: TILE_WARNING_MS });
  assert.deepEqual(outcome.pointsByPlayer, { 0: 1, 1: 1 });
});

test('disconnected participants start timers, remain vulnerable, and cannot revive on rejoin', () => {
  const state = fixture(3);
  const round = createRound(state);
  const player = state.players.get('0');
  player.connected = false;
  assert.equal(updateRound(state, round, { dtMs: 1, inputs: new Map([['0', { x: 1, y: 0 }]]) }), null);
  assert.equal(player.x, 96);
  assert.equal(state.tiles[8], TILE_WARNING);
  assert.equal(state.tileGoneAtMs[8], TILE_WARNING_MS);
  // Let connected opponents move to later-started tiles before this player falls.
  assert.equal(advance(state, round, 500, new Map([
    ['1', { x: -1, y: 0 }], ['2', { x: -1, y: 0 }],
  ])), null);
  assert.equal(updateRound(state, round, { dtMs: TILE_WARNING_MS - round.elapsedMs }), null);
  assert.equal(player.alive, false);
  assert.equal(player.x, 96);
  player.connected = true;
  const position = { x: player.x, y: player.y };
  assert.equal(updateRound(state, round, { dtMs: STEP_MS, inputs: new Map([['0', { x: 1, y: 0 }]]) }), null);
  assert.equal(player.alive, false);
  assert.deepEqual({ x: player.x, y: player.y }, position);
});

test('twelve participants start on distinct, separated safe tiles around a symmetric inset perimeter', () => {
  const state = fixture(12);
  const round = createRound(state);
  const players = [...state.players.values()];
  assert.equal(round.participantIds.length, 12);
  assert.equal(new Set(players.map(tileIndexAt)).size, 12);
  const positions = new Set(players.map(({ x, y }) => `${x},${y}`));
  for (const player of players) {
    assert.ok(player.connected && player.participating && player.alive);
    assert.equal(player.score, 5, 'starting a round preserves party scores');
    assert.equal(state.tiles[tileIndexAt(player)], TILE_SAFE);
    assert.ok(player.x >= ARENA.tileSize && player.x <= ARENA.width - ARENA.tileSize);
    assert.ok(player.y >= ARENA.tileSize && player.y <= ARENA.height - ARENA.tileSize);
    assert.ok(positions.has(`${ARENA.width - player.y},${player.x}`), 'the layout has quarter-turn symmetry');
  }
  for (let first = 0; first < players.length; first += 1) {
    for (let second = first + 1; second < players.length; second += 1) {
      assert.ok(Math.hypot(players[first].x - players[second].x, players[first].y - players[second].y) >= ARENA.tileSize,
        'every pair starts at least one tile apart');
    }
  }
});

test('all twelve players move at the authoritative bounded speed', () => {
  const state = fixture(12);
  const round = createRound(state);
  const before = new Map([...state.players].map(([id, player]) => [id, { x: player.x, y: player.y }]));
  const inputs = new Map([...state.players].map(([id, player]) => [id, {
    x: Math.sign(ARENA.width / 2 - player.x), y: Math.sign(ARENA.height / 2 - player.y),
  }]));
  assert.equal(updateRound(state, round, { dtMs: STEP_MS, inputs }), null);
  for (const [id, player] of state.players) {
    const start = before.get(id);
    assert.ok(Math.abs(Math.hypot(player.x - start.x, player.y - start.y) - PLAYER_SPEED * STEP_MS / 1000) < 0.00001,
      `${id} moves at the same bounded speed`);
    assert.equal(state.tileGoneAtMs[tileIndexAt(start)], TILE_WARNING_MS);
  }
});

test('a twelve-way final fall ties once without choosing a winner by iteration order', () => {
  const state = fixture(12);
  const round = createRound(state);
  const outcome = updateRound(state, round, { dtMs: TILE_WARNING_MS });
  assert.equal(outcome.reason, 'simultaneous-elimination');
  assert.equal(outcome.resultText, '12 players tie! +1 point each');
  assert.deepEqual(outcome.winnerIds, [...state.players.keys()]);
  assert.deepEqual(outcome.pointsByPlayer, Object.fromEntries([...state.players.keys()].map((id) => [id, 1])));
  assert.equal(updateRound(state, round, { dtMs: TILE_WARNING_MS }), outcome);
  assert.equal(finishRound(state, round), outcome);
  assert.ok([...state.players.values()].every((player) => player.score === 5), 'party owns cumulative scores');
});

test('permanent removal settles an existing sole survivor before their tile falls', () => {
  const state = fixture();
  const round = createRound(state);
  assert.equal(updateRound(state, round, { dtMs: TILE_WARNING_MS - 1 }), null);
  state.players.delete('0');
  const outcome = updateRound(state, round, { dtMs: STEP_MS });
  assert.equal(outcome.reason, 'last-survivor');
  assert.deepEqual(outcome.pointsByPlayer, { 1: 3 });
  assert.equal(state.players.get('1').alive, true);
  assert.equal(state.roundElapsedMs, TILE_WARNING_MS - 1, 'round stops before an unnecessary simulation step');
});

test('removing every participant ends a round without awarding points', () => {
  const state = fixture();
  const round = createRound(state);
  state.players.clear();
  const outcome = updateRound(state, round, { dtMs: STEP_MS });
  assert.equal(outcome.reason, 'no-participants');
  assert.deepEqual(outcome.winnerIds, []);
  assert.deepEqual(outcome.pointsByPlayer, {});
});
