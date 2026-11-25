import { livingIds } from './last-standing.js';
import { prepare, cell, center, neighbor, entity, tick, gridMove, spreadSpawns, placeSpawns, rankedResult } from './arcade-common.js';

export function createRound(state) {
  const round = prepare(state, { name: 'Shared maze', duration: 60_000 });
  for (let i = 0; i < state.cells.length; i++) {
    const x = i % state.columns, y = Math.floor(i / state.columns);
    state.cells[i] = x === 0 || y === 0 || x === state.columns - 1 || y === state.rows - 1 || x % 2 === 0 && y % 2 === 0 ? 1 : 2;
  }
  const open = Array.from(state.cells, (v, i) => v === 2 ? i : -1).filter(i => i >= 0);
  const spawns = spreadSpawns(state, round.participantIds.length, open);
  placeSpawns(state, round, spawns);
  for (const i of spawns) state.cells[i] = 0;
  for (const i of [20, 36, 248, 264]) state.cells[i] = 3;
  for (const i of [140, 144, 102, 182]) entity(state, round, { kind: 'ghost', ...center(state, i), due: 0 });
  round.ghostMoveMs = 500;
  return round;
}

// Breadth-first distance map makes ghosts navigate corridors, including corners.
function distances(state, target) {
  const distance = new Map([[target, 0]]), queue = [target];
  for (let n = 0; n < queue.length; n++) for (let d = 0; d < 4; d++) {
    const next = neighbor(state, queue[n], d);
    if (next >= 0 && state.cells[next] !== 1 && !distance.has(next)) {
      distance.set(next, distance.get(queue[n]) + 1); queue.push(next);
    }
  }
  return distance;
}
export function updateRound(state, round, { dtMs, inputs = new Map() }) {
  if (round.outcome) return round.outcome;
  tick(state, dtMs);
  const living = livingIds(state, round).map(id => state.players.get(id));
  const previous = new Map(living.map(p => [p.id, cell(state, p)]));
  for (const p of living) gridMove(state, round, p, inputs.get(p.id), i => state.cells[i] === 1);
  const eaters = new Map();
  for (const p of living) {
    const index = cell(state, p);
    if (!eaters.has(index)) eaters.set(index, []);
    eaters.get(index).push(p);
  }
  for (const [index, players] of eaters) {
    const food = state.cells[index];
    if (![2, 3].includes(food)) continue;
    for (const p of players) { p.collected += food === 3 ? 5 : 1; if (food === 3) p.powerUntilMs = state.roundElapsedMs + 4000; }
    state.cells[index] = 0;
  }
  const moveGhosts = state.roundElapsedMs >= round.ghostMoveMs;
  if (moveGhosts) round.ghostMoveMs = state.roundElapsedMs + 300;
  for (const ghost of state.entities) {
    if (ghost.due > state.roundElapsedMs) continue;
    const old = cell(state, ghost);
    if (moveGhosts && living.length) {
      const nearest = [...living].sort((a, b) => Math.hypot(a.x - ghost.x, a.y - ghost.y) - Math.hypot(b.x - ghost.x, b.y - ghost.y))[0];
      const map = distances(state, cell(state, nearest));
      const options = [0, 1, 2, 3].map(d => neighbor(state, old, d)).filter(i => i >= 0 && state.cells[i] !== 1);
      options.sort((a, b) => (map.get(a) ?? 999) - (map.get(b) ?? 999));
      const scared = nearest.powerUntilMs > state.roundElapsedMs;
      if (options.length) Object.assign(ghost, center(state, scared ? options.at(-1) : options[0]));
    }
    const touching = living.filter(p => p.alive && (cell(state, p) === cell(state, ghost) ||
      previous.get(p.id) === cell(state, ghost) && cell(state, p) === old));
    const powered = touching.filter(p => p.powerUntilMs > state.roundElapsedMs);
    if (powered.length) {
      for (const p of powered) p.collected += 10;
      ghost.due = state.roundElapsedMs + 2000;
      Object.assign(ghost, center(state, 142));
    } else for (const p of touching) {
      if (p.immuneUntilMs > state.roundElapsedMs) continue;
      p.hits++; p.immuneUntilMs = state.roundElapsedMs + 1600;
      if (p.hits >= 3) p.alive = false;
    }
  }
  return state.roundElapsedMs >= state.gameEndsMs || !livingIds(state, round).length || !state.cells.some(v => v === 2 || v === 3)
    ? rankedResult(state, round, 'collected', 'munch points') : null;
}
