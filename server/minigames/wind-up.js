import { WIND_MS, RELEASE_MS } from '../../shared/arcade.js';
import { prepare, validAction, cooldown, tick, rankedResult } from './arcade-common.js';

export function createRound(state) {
  const round = prepare(state, { columns: 20, rows: 16, name: 'Toy racetrack', duration: WIND_MS + RELEASE_MS });
  state.gameStage = 'winding'; state.stageEndsMs = WIND_MS;
  round.participantIds.forEach((id, i) => {
    const lane = 40 + (i + .5) * 448 / round.participantIds.length;
    Object.assign(state.players.get(id), { x: 40, y: lane, lane });
  });
  return round;
}
export function act(state, p, input) {
  if (!validAction(state, p, input, 'windup') || !p.alive || input.action !== 'wind' ||
      state.roundElapsedMs >= WIND_MS || !cooldown(state, p, 80)) return;
  p.charge++;
}
export function updateRound(state, round, { dtMs }) {
  if (round.outcome) return round.outcome;
  tick(state, dtMs);
  if (state.roundElapsedMs >= WIND_MS) {
    state.gameStage = 'racing'; state.stageEndsMs = state.gameEndsMs;
    const progress = Math.min(1, (state.roundElapsedMs - WIND_MS) / RELEASE_MS);
    for (const id of round.participantIds) {
      const p = state.players.get(id);
      if (p) { p.distance = Math.round(p.charge * 10 * (1 - (1 - progress) ** 2)); p.x = 40 + p.distance * .42; }
    }
  }
  return state.roundElapsedMs >= state.gameEndsMs ? rankedResult(state, round, 'distance', 'cm', 1) : null;
}
