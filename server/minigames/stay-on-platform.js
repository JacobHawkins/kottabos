import {
  ARENA, ROUND_DURATION_MS, TILE_GONE, TILE_SAFE, TILE_WARNING, TILE_WARNING_MS,
} from '../../shared/constants.js';
import { movePlayer, tileIndexAt } from '../../shared/movement.js';

const SPAWNS = [
  { x: 96, y: 96 },
  { x: 352, y: 352 },
  { x: 352, y: 96 },
  { x: 96, y: 352 },
];

function seededRandom(seed) {
  let value = 2166136261;
  for (const character of String(seed)) {
    value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  }
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function createTileSchedule(seed, durationMs = ROUND_DURATION_MS) {
  const random = seededRandom(seed);
  const centerColumn = Math.floor(ARENA.columns / 2);
  const centerRow = Math.floor(ARENA.rows / 2);
  // Nine equally likely destinations give every spawn the same distribution
  // of travel distances. Keeping the island away from the edge leaves room to
  // approach it from every direction; its location stays server-private.
  const islandColumn = centerColumn - 1 + Math.floor(random() * 3);
  const islandRow = centerRow - 1 + Math.floor(random() * 3);
  const rings = new Map();
  for (let row = 0; row < ARENA.rows; row += 1) {
    for (let column = 0; column < ARENA.columns; column += 1) {
      const distance = Math.abs(column - islandColumn) + Math.abs(row - islandRow);
      if (distance === 0) continue;
      if (!rings.has(distance)) rings.set(distance, []);
      rings.get(distance).push(row * ARENA.columns + column);
    }
  }
  const order = [];
  // Manhattan rings guarantee each remaining tile has an orthogonal route
  // inward. Randomly removing a square's corners can instead strand a tile
  // behind two holes. Shuffle equal-distance tiles for variety within waves.
  for (const distance of [...rings.keys()].sort((left, right) => right - left)) {
    order.push(...shuffled(rings.get(distance), random));
  }

  const waveSizes = [3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5];
  const firstWarningAt = Math.min(4_000, Math.max(200, durationMs - TILE_WARNING_MS - 1_000));
  const lastWarningAt = Math.max(firstWarningAt, durationMs - TILE_WARNING_MS - 2_500);
  const schedule = [];
  let cursor = 0;
  for (let wave = 0; wave < waveSizes.length; wave += 1) {
    // Increasing wave size and decreasing gaps make the last third busier.
    const progress = wave / (waveSizes.length - 1);
    const warningAt = firstWarningAt + (lastWarningAt - firstWarningAt) * (1 - (1 - progress) ** 1.25);
    for (let offset = 0; offset < waveSizes[wave]; offset += 1) {
      schedule.push({ tile: order[cursor++], warningAt, goneAt: warningAt + TILE_WARNING_MS });
    }
  }
  return schedule;
}

/** Prepare participants and floor at countdown start; the party owns phase changes. */
export function createRound(state, { seed = 1, durationMs = ROUND_DURATION_MS } = {}) {
  const duration = Number.isFinite(durationMs) ? Math.max(3_000, durationMs) : ROUND_DURATION_MS;
  const tileCount = ARENA.columns * ARENA.rows;
  while (state.tiles.length < tileCount) state.tiles.push(TILE_SAFE);
  if (state.tiles.length > tileCount) state.tiles.splice(tileCount);
  for (let index = 0; index < tileCount; index += 1) state.tiles[index] = TILE_SAFE;

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
    durationMs: duration,
    schedule: createTileSchedule(seed, duration),
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
export function finishRound(state, round, reason = 'deadline') {
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
    resultText = `${nameList(state, winnerIds)} tie! +1 point each`;
  }
  round.outcome = {
    winnerIds: [...winnerIds],
    pointsByPlayer: Object.fromEntries(winnerIds.map((id) => [id, awardedPoints])),
    reason,
    resultText,
  };
  return round.outcome;
}

/** Advance exactly one server simulation step; disconnected players still fall. */
export function updateRound(state, round, { dtMs, inputs = new Map() }) {
  if (round.outcome) return round.outcome;
  const elapsed = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;
  const stepMs = Math.min(elapsed, Math.max(0, round.durationMs - round.elapsedMs));
  const before = livingIds(state, round);
  // A permanent leave can settle the round between simulation steps. Resolve
  // that existing winner before a new movement/hazard step can eliminate them.
  if (before.length === 1) return finishRound(state, round, 'last-survivor');
  if (before.length === 0) return finishRound(state, round, 'no-participants');
  round.elapsedMs += stepMs;
  state.roundElapsedMs = round.elapsedMs;

  for (const id of before) {
    const player = state.players.get(id);
    if (player.connected) {
      const position = movePlayer(player, inputs.get(id) || { x: 0, y: 0 }, stepMs / 1000);
      player.x = position.x;
      player.y = position.y;
    }
  }
  for (const event of round.schedule) {
    state.tiles[event.tile] = round.elapsedMs >= event.goneAt
      ? TILE_GONE : round.elapsedMs >= event.warningAt ? TILE_WARNING : TILE_SAFE;
  }
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
  if (round.elapsedMs >= round.durationMs) return finishRound(state, round, 'deadline');
  return null;
}
