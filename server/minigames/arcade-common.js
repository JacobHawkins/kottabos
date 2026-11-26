import { randomInt } from 'node:crypto';
import { EntityState } from '../state.js';
import { normalizeInput } from '../../shared/movement.js';
import { livingIds, finishRound } from './last-standing.js';

export function prepare(state, { columns = 19, rows = 15, size = 32, name, duration = 60_000 }) {
  Object.assign(state, { columns, rows, cellSize: size, mapName: name,
    roundElapsedMs: 0, gameStage: 'play', gameEndsMs: duration, stageEndsMs: duration });
  state.tiles.clear(); state.tileGoneAtMs.clear(); state.entities.clear();
  const participantIds = [];
  for (const p of state.players.values()) {
    Object.assign(p, { participating: p.connected, alive: p.connected, hits: 0, dingAtMs: -1,
      charge: 0, distance: 0, actionAtMs: -10000, jumpedAtMs: -1,
      duckUntilMs: 0, stunnedUntilMs: 0, immuneUntilMs: 0 });
    if (p.participating) participantIds.push(p.id);
  }
  state.laneCount = participantIds.length;
  return { participantIds, lastEliminatedIds: [], outcome: null,
    serial: 0, pick: randomInt };
}
export function entity(state, round, values) {
  const e = new EntityState({ id: String(++round.serial), ...values });
  state.entities.push(e); return e;
}
export function removeEntity(state, target) { const i = state.entities.indexOf(target); if (i >= 0) state.entities.splice(i, 1); }
export function validAction(state, p, input, gameId) {
  return state.gameId === gameId && state.phase === 'playing' && p?.connected && p.participating && input?.round === state.round;
}
export function cooldown(state, p, ms) {
  if (state.roundElapsedMs - p.actionAtMs < ms) return false;
  p.actionAtMs = state.roundElapsedMs; return true;
}
export function tick(state, dtMs) { state.roundElapsedMs += Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0; }
export function survivalResult(state, round, eliminated = []) {
  const living = livingIds(state, round);
  if (!living.length && eliminated.length) {
    round.lastEliminatedIds = eliminated;
    return finishRound(state, round, 'simultaneous-elimination');
  }
  return living.length < 2 || state.roundElapsedMs >= state.gameEndsMs
    ? finishRound(state, round, living.length === 1 ? 'last-survivor' : 'time-limit') : null;
}
export function rankedResult(state, round, field, unit, points = 3) {
  if (round.outcome) return round.outcome;
  const players = round.participantIds.map(id => state.players.get(id)).filter(Boolean);
  const high = Math.max(0, ...players.map(p => p[field]));
  const winners = players.filter(p => p[field] === high);
  const award = winners.length > 1 ? 1 : points;
  const names = winners.length > 3 ? `${winners.length} players` : winners.map(p => p.name).join(' & ');
  round.outcome = { winnerIds: winners.map(p => p.id), pointsByPlayer: Object.fromEntries(winners.map(p => [p.id, award])),
    reason: 'ranked', resultText: winners.length ? `${names} ${winners.length > 1 ? 'tie' : 'wins'}! ${high} ${unit} · +${award} ${award === 1 ? 'point' : 'points'}${winners.length > 1 ? ' each' : ''}` : 'Round ended. No points awarded.' };
  return round.outcome;
}
export function moveCursor(state, p, input, dtMs) {
  if (!p.connected) return;
  const d = normalizeInput(input);
  p.x = Math.max(8, Math.min(state.columns * state.cellSize - 8, p.x + d.x * dtMs * .25));
  p.y = Math.max(8, Math.min(state.rows * state.cellSize - 8, p.y + d.y * dtMs * .25));
}
