// These rates are intentional: authoritative simulation at 30 Hz, snapshots at 20 Hz.
export const SIMULATION_HZ = 30;
export const STEP_MS = 1000 / SIMULATION_HZ;
export const PATCH_HZ = 20;
export const INPUT_QUEUE_LIMIT = 6;
// The party limit is shared by every minigame, admission checks and the UI.
export const MAX_PLAYERS = 12;

export const ARENA = Object.freeze({
  columns: 7,
  rows: 7,
  tileSize: 64,
  width: 448,
  height: 448,
});

export const PLAYER_SPEED = 150;
export const PLAYER_RADIUS = 12;
export const PLAYER_COLORS = Object.freeze([
  '#67e8f9', '#fbbf24', '#fb7185', '#c4b5fd',
  '#a3e635', '#34d399', '#fb923c', '#60a5fa',
  '#e879f9', '#f1f5f9', '#2dd4bf', '#f87171',
]);
export const TILE_SAFE = 0;
export const TILE_WARNING = 1;
export const TILE_GONE = 2;
export const ROUND_DURATION_MS = 45_000;
export const TILE_WARNING_MS = 1_800;
