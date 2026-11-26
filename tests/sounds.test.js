import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundEffects } from '../client/sounds.js';

test('only new local dings and deaths make outcome sounds; recovery never replays them', () => {
  const sound = Object.create(SoundEffects.prototype), played = [];
  sound.play = name => played.push(name);
  const state = { code: 'ABCDEF', round: 2, gameId: 'runner', phase: 'playing' };
  const me = { id: 'me', participating: true, alive: true, hits: 0, totalDings: 0, totalEliminations: 0 };
  sound.observe(state, me, true);
  // A snapshot changed for another player's action; the local player is unchanged.
  sound.observe(state, me, true);
  assert.deepEqual(played, []);
  me.hits = 1; me.totalDings = 1;
  sound.observe(state, me, true);
  sound.observe(state, me, true);
  assert.deepEqual(played, ['ding']);
  me.hits = 3; me.alive = false; me.totalDings = 3; me.totalEliminations = 1;
  sound.observe({ ...state, phase: 'results' }, me, true);
  assert.deepEqual(played, ['ding', 'ding', 'death']);
  sound.observe(null, null, false);
  sound.observe(state, me, true);
  assert.equal(played.length, 3);
  // The next patch can already be in a new round with the player alive again.
  state.round++;
  me.hits = 0; me.alive = true;
  me.totalDings += 3; me.totalEliminations++;
  sound.observe(state, me, true);
  assert.deepEqual(played.slice(-2), ['ding', 'death']);
  state.round++;
  me.hits = 0; me.alive = true;
  sound.observe(state, me, true);
  assert.equal(played.length, 5);
});

test('movement sound follows local input, has a bounded cadence and stops on release', () => {
  const sound = Object.create(SoundEffects.prototype), played = [];
  sound.lastStepAt = -Infinity;
  sound.play = name => played.push(name);
  sound.movement(false, 0);
  sound.movement(true, 0);
  sound.movement(true, 100);
  sound.movement(true, 240);
  sound.movement(false, 300);
  sound.movement(false, 1000);
  assert.deepEqual(played, ['move', 'move']);
  sound.movement(true, 1010);
  assert.equal(played.length, 3);
});
