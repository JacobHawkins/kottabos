export const MINIGAMES = Object.freeze({ platform: 'Stay on the Platform' });
export const SKINS = ['sprite', 'circle', 'square', 'triangle'];
export const SESSION_CHOICES = ['1', '3', '5'];
export const MAP_CHOICES = ['small', 'large', 'shaped'];
export const VOTE_MS = 5000;
export const KICK_CODE = 4011;

export function canMoveInParty(phase, player) {
  return Boolean(player?.connected && (phase === 'lobby' ||
    (phase === 'playing' && player.participating && player.alive)));
}
