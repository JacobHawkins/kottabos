import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PLAYERS, TILE_SAFE } from '../shared/constants.js';
import { movePlayer, tileIndexInArena } from '../shared/movement.js';
import { MAP_CHOICES, SESSION_CHOICES } from '../shared/party.js';
import { mapSpawns, prepareMap, SHAPES } from '../server/minigames/maps.js';
import { winningChoice } from '../server/voting.js';

test('ballots resolve empty, plurality and tied choices, including the last tied option', () => {
  assert.deepEqual(SESSION_CHOICES, ['3', '5', '10']);
  const ballots = (...votes) => votes.map(vote => ({ vote }));
  assert.equal(winningChoice(ballots('', '9'), SESSION_CHOICES, '3'), '3');
  assert.equal(winningChoice(ballots(), MAP_CHOICES, 'classic'), 'classic');
  assert.equal(winningChoice(ballots('3', '3', '1', '5'), SESSION_CHOICES, '3'), '3');
  for (const [draw, expected] of [[0, 'small'], [1, 'shaped']]) {
    assert.equal(winningChoice(ballots('small', 'shaped'), MAP_CHOICES, 'classic', n => {
      assert.equal(n, 2);
      return draw;
    }), expected);
  }
});

test('all map sizes and five distinct connected silhouettes support twelve unique safe spawns', () => {
  const state = { tiles: [], tileGoneAtMs: [] };
  for (const [choice, size] of [['large', 98], ['small', 25], ['classic', 49]]) {
    const arena = prepareMap(state, choice);
    assert.equal(state.tiles.length, size);
    assert.ok(state.tiles.every(tile => tile === TILE_SAFE));
    const edge = movePlayer({ x: arena.width - 1, y: arena.height - 1 }, { x: 1, y: 1 }, 1, arena);
    assert.equal(tileIndexInArena(edge, arena), size - 1);
  }
  const masks = new Set();
  for (let shape = 0; shape < Object.keys(SHAPES).length; shape++) {
    const arena = prepareMap(state, 'shaped', () => shape);
    masks.add(state.tiles.join(''));
    const spawns = mapSpawns(state, MAX_PLAYERS).map(point => tileIndexInArena(point, arena));
    assert.equal(new Set(spawns).size, MAX_PLAYERS);
    assert.ok(spawns.every(i => state.tiles[i] === TILE_SAFE));
    const visited = new Set([spawns[0]]);
    for (const i of visited) {
      for (const next of [i - arena.columns, i + arena.columns, i - 1, i + 1]) {
        const distance = Math.abs(next % arena.columns - i % arena.columns) +
          Math.abs(Math.floor(next / arena.columns) - Math.floor(i / arena.columns));
        if (distance === 1 && state.tiles[next] === TILE_SAFE) visited.add(next);
      }
    }
    assert.equal(visited.size, state.tiles.filter(tile => tile === TILE_SAFE).length);
    assert.ok(state.tileGoneAtMs.every(ms => ms === 0));
  }
  assert.equal(masks.size, 5);
});
