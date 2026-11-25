// Public presentation/control constants. All outcomes are evaluated on the server.
export const ARCADE_GAMES = ['windup', 'trails', 'maze', 'runner', 'bombs'];
export const WIND_MS = 10_000;
export const RELEASE_MS = 8_000;
export const RUN_JUMP_MS = 600;
export const DUCK_MS = 650;
export const DIRECTIONS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
export const GAME_HELP = {
  windup: 'Tap Wind or press Space repeatedly for 10 seconds. Then watch your toy race! Farthest earns +1 point; tied leaders each earn +1.',
  trails: 'Steer with WASD, arrows or the joystick. Keep moving: a trail or the edge knocks you out. Once out, move your eraser and press Space or Erase to clear nearby trails.',
  maze: 'Move with WASD, arrows or the joystick. Eat dots for points; big stars let you eat ghosts for 4 seconds. Three ghost hits knock you out. Most collected points wins after 60 seconds or when the dots are gone.',
  runner: 'Jump over orange hurdles (Space / Jump). Duck under purple bars (↓ / S / Duck). Three dings and you are out. Then move your reticle and press Space or Stun near a runner to briefly stun them.',
  bombs: 'Move with WASD, arrows or the joystick; Space or Bomb drops a bomb. Escape before it bursts! Break crates for range (+) and extra-bomb (B) powerups. Once out, Space or Random bomb drops a bomb on a random open cell.',
};
export function inArcade(state) {
  return ARCADE_GAMES.includes(state?.gameId) && state.sessionRound > 0 && !['lobby', 'lengthVote'].includes(state.phase);
}
export function directionIndex(input) {
  if (!input || Math.hypot(input.x, input.y) < .2) return -1;
  return Math.abs(input.x) >= Math.abs(input.y) ? input.x > 0 ? 0 : 2 : input.y > 0 ? 1 : 3;
}
export function jumpArc(at, now, duration = RUN_JUMP_MS) {
  if (at < 0 || now < at || now >= at + duration) return 0;
  const t = (now - at) / duration;
  return 4 * t * (1 - t);
}
