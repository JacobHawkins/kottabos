import { randomInt } from 'node:crypto';
import { EntityState } from '../state.js';
import { DIRECTIONS, directionIndex } from '../../shared/arcade.js';
import { normalizeInput } from '../../shared/movement.js';
import { livingIds, finishRound } from './last-standing.js';

export function prepare(state, { columns = 19, rows = 15, size = 32, name, duration = 60_000 }) {
  Object.assign(state, { columns, rows, cellSize: size, mapName: name,
    roundElapsedMs: 0, gameStage: 'play', gameEndsMs: duration, stageEndsMs: duration });
  state.tiles.clear(); state.tileGoneAtMs.clear(); state.cells.clear(); state.entities.clear();
  state.cells.push(...Array(columns * rows).fill(0));
  const participantIds = [];
  for (const p of state.players.values()) {
    Object.assign(p, { participating: p.connected, alive: p.connected, hits: 0, collected: 0,
      charge: 0, distance: 0, power: 2, capacity: 1, actionAtMs: -10000, jumpedAtMs: -1,
      duckUntilMs: 0, stunnedUntilMs: 0, immuneUntilMs: 0, powerUntilMs: 0 });
    if (p.participating) participantIds.push(p.id);
  }
  return { participantIds, lastEliminatedIds: [], outcome: null, moveAt: new Map(), intent: new Map(),
    serial: 0, pick: randomInt };
}
export function cell(state, p) { return Math.floor(p.y / state.cellSize) * state.columns + Math.floor(p.x / state.cellSize); }
export function center(state, index) {
  return { x: (index % state.columns + .5) * state.cellSize, y: (Math.floor(index / state.columns) + .5) * state.cellSize };
}
export function neighbor(state, index, dir) {
  const d = DIRECTIONS[dir];
  if (!d) return -1;
  const x = index % state.columns + d.x, y = Math.floor(index / state.columns) + d.y;
  return x < 0 || y < 0 || x >= state.columns || y >= state.rows ? -1 : y * state.columns + x;
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
export function gridMove(state, round, p, input, blocked, period = 130) {
  // Remember the newest steering command until the next cell step. Never queue extra movement.
  if (input) round.intent.set(p.id, directionIndex(input));
  if (!p.connected || state.roundElapsedMs < (round.moveAt.get(p.id) || 0)) return;
  const dir = round.intent.get(p.id) ?? -1;
  const next = neighbor(state, cell(state, p), dir);
  if (next < 0 || blocked(next)) return;
  p.facing = dir;
  Object.assign(p, center(state, next));
  round.moveAt.set(p.id, state.roundElapsedMs + period);
}
export function spreadSpawns(state, count, available) {
  const pool = [...available], chosen = [];
  while (chosen.length < count && pool.length) {
    let best = 0, score = -1;
    for (let i = 0; i < pool.length; i++) {
      const p = center(state, pool[i]);
      const nearest = chosen.length ? Math.min(...chosen.map(j => {
        const q = center(state, j); return (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      })) : 0;
      if (nearest > score) { score = nearest; best = i; }
    }
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen;
}
export function placeSpawns(state, round, spawns) {
  round.participantIds.forEach((id, i) => Object.assign(state.players.get(id), center(state, spawns[i])));
}
