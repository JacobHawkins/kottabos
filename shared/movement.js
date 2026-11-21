import { ARENA, PLAYER_SPEED } from './constants.js';

// This module is used by authoritative movement and browser prediction.
export function normalizeInput(input = {}) {
  let x = Number.isFinite(input.x) ? Math.max(-1, Math.min(1, input.x)) : 0;
  let y = Number.isFinite(input.y) ? Math.max(-1, Math.min(1, input.y)) : 0;
  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  return { x, y };
}

export function movePlayer(position, input, dtSeconds, arena = ARENA) {
  const direction = normalizeInput(input);
  const distance = PLAYER_SPEED * (Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0);
  // The player's center decides which tile supports them; the arena edge is solid.
  return {
    x: Math.max(0.01, Math.min(arena.width - 0.01, position.x + direction.x * distance)),
    y: Math.max(0.01, Math.min(arena.height - 0.01, position.y + direction.y * distance)),
  };
}

export function tileIndexAt(position) {
  return tileIndexInArena(position, ARENA);
}

export function tileIndexInArena(position, arena) {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)
    || position.x < 0 || position.y < 0 || position.x >= arena.width || position.y >= arena.height) {
    return -1;
  }
  return Math.floor(position.y / arena.tileSize) * arena.columns
    + Math.floor(position.x / arena.tileSize);
}

