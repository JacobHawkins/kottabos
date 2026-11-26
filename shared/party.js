export const MINIGAMES = Object.freeze({ platform: 'Stay on the Platform', rope: 'Jump Rope',
  windup: 'Wind-up Rally', trails: 'Neon Trails', maze: 'Maze Munch', runner: 'Dash & Duck', bombs: 'Bomb Garden' });
export const SKINS = ['sprite', 'circle', 'square', 'triangle'];
export const SESSION_CHOICES = ['3', '5', '10'];
export const MAP_CHOICES = ['small', 'large', 'shaped'];
export const VOTE_MS = 5000;
export const KICK_CODE = 4011;

export function canMoveInParty(phase, player, gameId) {
  return Boolean(player?.connected && (phase === 'lobby' ||
    (phase === 'playing' && !['rope', 'windup'].includes(gameId) && player.participating &&
      (player.alive ? gameId !== 'runner' : ['trails', 'runner'].includes(gameId)))));
}
