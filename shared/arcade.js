// Public presentation/control constants. All outcomes are evaluated on the server.
export const ARCADE_GAMES = ['windup', 'runner'];
export const WIND_MS = 10_000;
export const RELEASE_MS = 8_000;
export const RUN_JUMP_MS = 600;
export const DUCK_MS = 650;
export const RUNNER_X = 110;
export const RUNNER_SPAWN_X = 620;
export const RUNNER_CUE_MS = 420;
export const WIND_BURST = 8;
export const WIND_PER_SECOND = 30;
export const GAME_HELP = {
  windup: 'Tap Wind or press Space repeatedly for 10 seconds. Then watch your toy race! Farthest earns +1 point; tied leaders each earn +1.',
  runner: 'Jump: ↑ / W / Jump. Duck: ↓ / S / Duck. Act when the obstacle enters the bright timing zone, before it reaches your feet. Orange hurdles need a jump; purple overhead bars need a duck. Space does nothing. Three dings and you are out. Then aim with WASD, arrows or the joystick and press Enter or Stun near a runner.',
};
export function inArcade(state) {
  return ARCADE_GAMES.includes(state?.gameId) && state.sessionRound > 0 && !['lobby', 'lengthVote'].includes(state.phase);
}
export function windTrackY(x, lane, count) {
  const amplitude = Math.min(28, 448 / Math.max(1, count) * .25);
  return lane + Math.sin((x - 40) / 560 * Math.PI * 6) * amplitude;
}
export function runnerObstacleX(obstacle, now) {
  return RUNNER_X + (obstacle.due - now) / obstacle.power * (RUNNER_SPAWN_X - RUNNER_X);
}
export function runnerCue(state, now = state.roundElapsedMs) {
  const next = state.entities.filter(e => e.due > now).sort((a, b) => a.due - b.due)[0];
  if (!next) return 'KEEP RUNNING';
  const action = next.kind === 'hurdle' ? 'JUMP ↑ / W' : 'DUCK ↓ / S';
  return next.due - now <= RUNNER_CUE_MS ? `${action} NOW!` : `NEXT: ${action}`;
}
export function jumpArc(at, now, duration = RUN_JUMP_MS) {
  if (at < 0 || now < at || now >= at + duration) return 0;
  const t = (now - at) / duration;
  return 4 * t * (1 - t);
}
