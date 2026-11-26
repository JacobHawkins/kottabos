import { WIND_MS, RELEASE_MS, WIND_BURST, WIND_PER_SECOND, windTrackY } from '../../shared/arcade.js';
import { prepare, validAction, tick, rankedResult } from './arcade-common.js';

export function createRound(state) {
  const round = prepare(state, { columns: 20, rows: 16, name: 'Toy racetrack', duration: WIND_MS + RELEASE_MS });
  state.gameStage = 'winding'; state.stageEndsMs = WIND_MS;
  round.windBudgets = new Map();
  round.participantIds.forEach((id, i) => {
    const lane = 40 + (i + .5) * 448 / round.participantIds.length;
    Object.assign(state.players.get(id), { x: 40, y: lane, lane });
  });
  return round;
}
export function act(state, p, input, round) {
  if (!validAction(state, p, input, 'windup') || !p.alive || input.action !== 'wind' ||
      state.roundElapsedMs >= WIND_MS || !round) return;
  // Allow distinct taps arriving together between ticks, while bounding sustained spam.
  const now = state.roundElapsedMs;
  const budget = round.windBudgets.get(p.id) || { at: now, tokens: WIND_BURST };
  budget.tokens = Math.min(WIND_BURST, budget.tokens + (now - budget.at) * WIND_PER_SECOND / 1000);
  budget.at = now;
  round.windBudgets.set(p.id, budget);
  if (budget.tokens < 1) return;
  budget.tokens--;
  p.actionAtMs = now;
  p.charge++;
}
export function updateRound(state, round, { dtMs }) {
  if (round.outcome) return round.outcome;
  tick(state, dtMs);
  if (state.roundElapsedMs >= WIND_MS) {
    state.gameStage = 'racing'; state.stageEndsMs = state.gameEndsMs;
    const progress = Math.min(1, (state.roundElapsedMs - WIND_MS) / RELEASE_MS);
    round.trackDistance ??= Math.max(100, ...round.participantIds.map(id => (state.players.get(id)?.charge || 0) * 10));
    for (const id of round.participantIds) {
      const p = state.players.get(id);
      if (p) {
        p.distance = Math.round(p.charge * 10 * (1 - (1 - progress) ** 2));
        p.x = 40 + p.distance / round.trackDistance * 560;
        p.y = windTrackY(p.x, p.lane, round.participantIds.length);
      }
    }
  }
  return state.roundElapsedMs >= state.gameEndsMs ? rankedResult(state, round, 'distance', 'cm', 1) : null;
}
