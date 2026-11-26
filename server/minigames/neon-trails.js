import { PLAYER_COLORS } from '../../shared/constants.js';
import { directionIndex } from '../../shared/arcade.js';
import { livingIds } from './last-standing.js';
import { prepare, cell, center, neighbor, validAction, cooldown, tick, survivalResult, moveCursor } from './arcade-common.js';

export function createRound(state) {
  const round = prepare(state, { columns: 27, rows: 21, size: 24, name: 'Neon circuit', duration: 75_000 });
  round.nextMoveMs = 180;
  round.participantIds.forEach((id, i) => {
    const p = state.players.get(id);
    const x = 3 + i % 4 * 7, y = 3 + Math.floor(i / 4) * 7;
    Object.assign(p, center(state, y * state.columns + x), { facing: i % 2 ? 2 : 0 });
    state.cells[cell(state, p)] = 10 + Math.max(0, PLAYER_COLORS.indexOf(p.color));
  });
  return round;
}
export function act(state, p, input) {
  if (!validAction(state, p, input, 'trails') || p.alive || input.action !== 'erase' || !cooldown(state, p, 350)) return;
  const cx = Math.floor(p.x / state.cellSize), cy = Math.floor(p.y / state.cellSize);
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
    if (x >= 0 && y >= 0 && x < state.columns && y < state.rows && (x - cx) ** 2 + (y - cy) ** 2 <= 4) state.cells[y * state.columns + x] = 0;
  }
}
export function updateRound(state, round, { dtMs, inputs = new Map() }) {
  if (round.outcome) return round.outcome;
  const early = survivalResult(state, round); if (early) return early;
  tick(state, dtMs);
  for (const id of round.participantIds) {
    const p = state.players.get(id); if (!p) continue;
    if (!p.alive) { moveCursor(state, p, inputs.get(id), dtMs); continue; }
    const dir = p.connected ? directionIndex(inputs.get(id)) : -1;
    if (dir >= 0 && dir !== (p.facing + 2) % 4) round.intent.set(id, dir);
  }
  const eliminated = [];
  if (state.roundElapsedMs >= round.nextMoveMs) {
    round.nextMoveMs = state.roundElapsedMs + Math.max(85, 180 - state.roundElapsedMs / 700);
    const next = new Map();
    for (const id of livingIds(state, round)) {
      const p = state.players.get(id);
      if (p.connected && round.intent.has(id)) p.facing = round.intent.get(id);
      round.intent.delete(id);
      next.set(id, neighbor(state, cell(state, p), p.facing));
    }
    const counts = new Map();
    for (const index of next.values()) counts.set(index, (counts.get(index) || 0) + 1);
    for (const [id, index] of next) {
      const p = state.players.get(id);
      // Swapping heads also collides, even if an eraser removed their last trail cells.
      const swap = [...next].some(([other, destination]) => other !== id && destination === cell(state, p) && index === cell(state, state.players.get(other)));
      if (index < 0 || state.cells[index] || counts.get(index) > 1 || swap) { p.alive = false; eliminated.push(id); }
    }
    for (const [id, index] of next) {
      const p = state.players.get(id); if (!p.alive) continue;
      Object.assign(p, center(state, index));
      state.cells[index] = 10 + Math.max(0, PLAYER_COLORS.indexOf(p.color));
    }
  }
  return survivalResult(state, round, eliminated);
}
