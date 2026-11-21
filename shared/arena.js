import { ARENA } from './constants.js';

export function arenaFor(state) {
  const columns = state?.columns || ARENA.columns;
  const rows = state?.rows || ARENA.rows;
  return { columns, rows, tileSize: ARENA.tileSize, width: columns * ARENA.tileSize, height: rows * ARENA.tileSize };
}
