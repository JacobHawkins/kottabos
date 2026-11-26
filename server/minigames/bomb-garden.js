import { livingIds } from './last-standing.js';
import { prepare, cell, center, neighbor, entity, removeEntity, validAction, cooldown, tick,
  gridMove, spreadSpawns, placeSpawns, survivalResult } from './arcade-common.js';

export function createRound(state) {
  const round = prepare(state, { name: 'Crate garden', duration: 75_000 });
  const open = [];
  for (let i = 0; i < state.cells.length; i++) {
    const x = i % state.columns, y = Math.floor(i / state.columns);
    const wall = x === 0 || y === 0 || x === state.columns - 1 || y === state.rows - 1 || x % 2 === 0 && y % 2 === 0;
    state.cells[i] = wall ? 1 : round.pick(100) < 70 ? 2 : 0;
    if (!wall && x % 2 && y % 2) open.push(i);
  }
  const spawns = spreadSpawns(state, round.participantIds.length, open);
  for (const index of spawns) {
    state.cells[index] = 0;
    // Every spawn has two steps of escape and a turn, even with twelve players.
    for (let d = 0; d < 4; d++) {
      let next = index;
      for (let n = 0; n < 2; n++) {
        next = neighbor(state, next, d);
        if (next < 0 || state.cells[next] === 1) break;
        state.cells[next] = 0;
        for (let side = 0; side < 4; side++) {
          const turn = neighbor(state, next, side);
          if (turn >= 0 && state.cells[turn] !== 1) state.cells[turn] = 0;
        }
      }
    }
  }
  placeSpawns(state, round, spawns);
  return round;
}
export function act(state, p, input, round) {
  if (!validAction(state, p, input, 'bombs') || !round || input.action !== 'bomb') return;
  const bombs = state.entities.filter(e => e.kind === 'bomb');
  const occupied = new Set(bombs.map(e => cell(state, e)));
  if (p.alive && bombs.filter(e => e.owner === p.id).length >= p.capacity) return;
  let index = cell(state, p);
  if (!p.alive) {
    const open = Array.from(state.cells, (v, i) => (v === 0 || v >= 4) && !occupied.has(i) ? i : -1).filter(i => i >= 0);
    if (!open.length || !cooldown(state, p, 1000)) return;
    index = open[round.pick(open.length)];
  } else if (occupied.has(index) || !cooldown(state, p, 250)) return;
  entity(state, round, { kind: 'bomb', ...center(state, index), owner: p.id,
    due: state.roundElapsedMs + (p.alive ? 1800 : 2200), power: p.alive ? p.power : 2 });
}

export function updateRound(state, round, { dtMs, inputs = new Map() }) {
  if (round.outcome) return round.outcome;
  const early = survivalResult(state, round); if (early) return early;
  tick(state, dtMs);
  for (const e of [...state.entities]) if (e.kind === 'flame' && e.due <= state.roundElapsedMs) removeEntity(state, e);
  const bombs = state.entities.filter(e => e.kind === 'bomb');
  const bombCells = new Map(bombs.map(b => [cell(state, b), b]));
  for (const id of livingIds(state, round)) {
    const p = state.players.get(id);
    gridMove(state, round, p, inputs.get(id), i => [1, 2].includes(state.cells[i]) || bombCells.has(i), 140);
    const index = cell(state, p);
    if (state.cells[index] === 4) { p.power = Math.min(7, p.power + 1); state.cells[index] = 0; }
    if (state.cells[index] === 5) { p.capacity = Math.min(4, p.capacity + 1); state.cells[index] = 0; }
  }
  const fire = new Set(state.entities.filter(e => e.kind === 'flame').map(e => cell(state, e)));
  const queue = bombs.filter(b => b.due <= state.roundElapsedMs || fire.has(cell(state, b)));
  const exploded = new Set(), blast = new Set(), crates = new Set();
  for (let n = 0; n < queue.length; n++) {
    const bomb = queue[n]; if (exploded.has(bomb.id)) continue;
    exploded.add(bomb.id);
    const origin = cell(state, bomb); blast.add(origin);
    for (let d = 0; d < 4; d++) {
      let index = origin;
      for (let distance = 0; distance < bomb.power; distance++) {
        index = neighbor(state, index, d);
        if (index < 0 || state.cells[index] === 1) break;
        blast.add(index);
        if (state.cells[index] === 2) { crates.add(index); break; }
        if (bombCells.has(index)) { queue.push(bombCells.get(index)); break; }
      }
    }
  }
  for (const bomb of bombs) if (exploded.has(bomb.id)) removeEntity(state, bomb);
  for (const index of blast) {
    if (!fire.has(index)) entity(state, round, { kind: 'flame', ...center(state, index), due: state.roundElapsedMs + 450 });
    fire.add(index);
    if (crates.has(index)) { const roll = round.pick(4); state.cells[index] = roll < 2 ? 4 + roll : 0; }
    else if (state.cells[index] >= 4) state.cells[index] = 0;
  }
  const eliminated = [];
  for (const id of livingIds(state, round)) {
    const p = state.players.get(id);
    if (fire.has(cell(state, p))) { p.alive = false; eliminated.push(id); }
  }
  return survivalResult(state, round, eliminated);
}
