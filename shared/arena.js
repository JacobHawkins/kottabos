import { ARENA } from './constants.js';

export function arenaFor(state) {
  const columns = state?.columns || ARENA.columns;
  const rows = state?.rows || ARENA.rows;
  const tileSize = state?.cellSize || ARENA.tileSize;
  return { columns, rows, tileSize, width: columns * tileSize, height: rows * tileSize };
}
