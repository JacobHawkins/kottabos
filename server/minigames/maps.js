import { randomInt } from 'node:crypto';
import { ARENA, TILE_SAFE, TILE_GONE } from '../../shared/constants.js';
import { arenaFor } from '../../shared/arena.js';

// Each silhouette fits the classic footprint and has one connected play area.
export const SHAPES = {
  Diamond: (x, y) => Math.abs(x - 3) + Math.abs(y - 3) <= 3,
  Cross: (x, y) => Math.abs(x - 3) <= 1 || Math.abs(y - 3) <= 1,
  Ring: (x, y) => Math.abs(x - 3) >= 2 || Math.abs(y - 3) >= 2,
  Hourglass: (x, y) => Math.abs(x - 3) <= Math.max(1, Math.abs(y - 3)),
  Steps: (x, y) => Math.abs(x - y) <= 3,
};

export function prepareMap(state, choice = 'classic', pick = randomInt) {
  state.columns = choice === 'large' ? 14 : choice === 'small' ? 5 : ARENA.columns;
  state.rows = choice === 'small' ? 5 : ARENA.rows;
  const shapes = Object.keys(SHAPES);
  state.mapName = choice === 'shaped' ? shapes[pick(shapes.length)]
    : ({ classic: 'Classic', large: 'Large', small: 'Small' }[choice]);
  const occupies = SHAPES[state.mapName];
  const size = state.columns * state.rows;
  for (const values of [state.tiles, state.tileGoneAtMs]) {
    if (values.length > size) values.splice(size);
    while (values.length < size) values.push(0);
  }
  for (let i = 0; i < size; i++) {
    const present = !occupies || occupies(i % state.columns, Math.floor(i / state.columns));
    state.tiles[i] = present ? TILE_SAFE : TILE_GONE;
    state.tileGoneAtMs[i] = 0;
  }
  return arenaFor(state);
}

// Spread seats over distinct playable tile centers, including narrow silhouettes.
export function mapSpawns(state, count) {
  const floor = [];
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] === TILE_SAFE) floor.push({
      x: (i % state.columns + .5) * ARENA.tileSize,
      y: (Math.floor(i / state.columns) + .5) * ARENA.tileSize,
    });
  }
  const chosen = [floor.shift()];
  while (chosen.length < count && floor.length) {
    const distances = floor.map(p => Math.min(...chosen.map(s => (s.x - p.x) ** 2 + (s.y - p.y) ** 2)));
    chosen.push(floor.splice(distances.indexOf(Math.max(...distances)), 1)[0]);
  }
  return chosen;
}
