import {
  ARENA, TILE_GONE, TILE_SAFE, TILE_WARNING, TILE_WARNING_MS,
} from '../../shared/constants.js';
import { movePlayer, tileIndexAt } from '../../shared/movement.js';

const SPAWNS = [
  // Tile centers around the inset perimeter, in opposite pairs. The first four
  // retain the original corner starts; the full set has quarter-turn symmetry
  // and at least one tile of separation without giving anyone a central start.
  { x: 96, y: 96 },
  { x: 352, y: 352 },
  { x: 352, y: 96 },
  { x: 96, y: 352 },
  { x: 160, y: 96 },
  { x: 288, y: 352 },
  { x: 352, y: 160 },
  { x: 96, y: 288 },
  { x: 288, y: 96 },
  { x: 160, y: 352 },
  { x: 352, y: 288 },
  { x: 96, y: 160 },
];

/** Prepare participants and floor at countdown start; the party owns phase changes. */
export function createRound(state) {
  const tileCount = ARENA.columns * ARENA.rows;
  for (const [values, initial] of [[state.tiles, TILE_SAFE], [state.tileGoneAtMs, 0]]) {
    while (values.length < tileCount) values.push(initial);
    if (values.length > tileCount) values.splice(tileCount);
    for (let index = 0; index < tileCount; index += 1) values[index] = initial;
  }

  const participantIds = [];
  for (const [id, player] of state.players) {
    player.participating = Boolean(player.connected);
    player.alive = player.participating;
    if (player.participating) {
      const spawn = SPAWNS[participantIds.length % SPAWNS.length];
      player.x = spawn.x;
      player.y = spawn.y;
      participantIds.push(id);
    }
  }
  state.roundElapsedMs = 0;
  return {
    participantIds,
    elapsedMs: 0,
    lastEliminatedIds: [],
    outcome: null,
  };
}

function livingIds(state, round) {
  return round.participantIds.filter((id) => {
    const player = state.players.get(id);
    return player?.participating && player.alive;
  });
}

function nameList(state, ids) {
  return ids.map((id) => state.players.get(id)?.name || 'Player').join(' & ');
}

/** Decide one result. Scores are deliberately awarded only by the party layer. */
export function finishRound(state, round, reason = 'round-ended') {
  if (round.outcome) return round.outcome;
  const survivors = livingIds(state, round);
  let winnerIds = survivors;
  let awardedPoints = survivors.length === 1 ? 3 : 1;
  if (reason === 'simultaneous-elimination') {
    winnerIds = round.lastEliminatedIds.filter((id) => state.players.has(id));
    awardedPoints = 1;
  }
  let resultText = 'Round ended. No points awarded.';
  if (winnerIds.length === 1 && awardedPoints === 3) {
    resultText = `${nameList(state, winnerIds)} wins! +3 points`;
  } else if (winnerIds.length > 0) {
    const winners = winnerIds.length > 3 ? `${winnerIds.length} players` : nameList(state, winnerIds);
    resultText = `${winners} tie! +1 point each`;
  }
  round.outcome = {
    winnerIds: [...winnerIds],
    pointsByPlayer: Object.fromEntries(winnerIds.map((id) => [id, awardedPoints])),
    reason,
    resultText,
  };
  return round.outcome;
}

function triggerFloor(state, player, elapsedMs) {
  const tile = tileIndexAt(player);
  if (tile >= 0 && state.tiles[tile] === TILE_SAFE) {
    state.tiles[tile] = TILE_WARNING;
    // Public, elapsed-round deadlines let every client display the same warning
    // progress, including after recovery. Repeated visits never extend a timer.
    state.tileGoneAtMs[tile] = elapsedMs + TILE_WARNING_MS;
  }
}

/** Advance one playing-phase simulation step; disconnected players still fall. */
export function updateRound(state, round, { dtMs, inputs = new Map() }) {
  if (round.outcome) return round.outcome;
  const stepMs = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;
  const before = livingIds(state, round);
  // A permanent leave can settle the round between simulation steps. Resolve
  // that existing winner before a new movement/hazard step can eliminate them.
  if (before.length === 1) return finishRound(state, round, 'last-survivor');
  if (before.length === 0) return finishRound(state, round, 'no-participants');

  // This runs only after countdown. Warn spawn/current tiles before applying
  // input, so moving immediately cannot avoid starting their countdowns.
  for (const id of before) triggerFloor(state, state.players.get(id), round.elapsedMs);
  round.elapsedMs += stepMs;
  state.roundElapsedMs = round.elapsedMs;

  for (const id of before) {
    const player = state.players.get(id);
    if (player.connected) {
      const position = movePlayer(player, inputs.get(id) || { x: 0, y: 0 }, stepMs / 1000);
      player.x = position.x;
      player.y = position.y;
    }
    triggerFloor(state, player, round.elapsedMs);
  }
  for (let tile = 0; tile < state.tiles.length; tile += 1) {
    if (state.tiles[tile] === TILE_WARNING && round.elapsedMs >= state.tileGoneAtMs[tile]) {
      state.tiles[tile] = TILE_GONE;
    }
  }
  // Movement is resolved before this tick's disappearances: stepping out on the
  // deadline tick can escape, stepping onto a hole cannot. Resolve all falls
  // together, so participant iteration order never decides a tied final fall.
  const eliminated = [];
  for (const id of before) {
    const player = state.players.get(id);
    const tile = tileIndexAt(player);
    if (tile < 0 || state.tiles[tile] === TILE_GONE) {
      player.alive = false;
      eliminated.push(id);
    }
  }
  const remaining = livingIds(state, round);
  if (remaining.length === 0) {
    round.lastEliminatedIds = eliminated;
    return finishRound(state, round, eliminated.length ? 'simultaneous-elimination' : 'no-participants');
  }
  if (remaining.length === 1) return finishRound(state, round, 'last-survivor');
  return null;
}
