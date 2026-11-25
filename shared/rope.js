export const STRIKES_OUT = 3;
export const JUMP_MS = 300;
export const NEXT_JUMP_MS = 300;

// Collision and drawing use the same arc. The leading/trailing few frames
// leave the feet low enough for the rope to clip them.
export function jumpHeight(jumpedAt, elapsed) {
  if (jumpedAt < 0) return 0;
  const t = Math.max(0, Math.min(1, (elapsed - jumpedAt) / JUMP_MS));
  return 4 * t * (1 - t);
}

export function inRopeArena(state) {
  return state?.gameId === 'rope' && state.sessionRound > 0 &&
    state.phase !== 'lobby' && state.phase !== 'lengthVote';
}
