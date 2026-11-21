import { jumpHeight, NEXT_JUMP_MS, STRIKES_OUT } from '../../shared/rope.js';
import { livingIds, finishRound } from './last-standing.js';

function swingDuration(elapsed, pulls) {
  // The baseline reaches 100 ms around 45 seconds. Every distinct pull adds
  // lasting speed. Only the simulation's resolution bounds the fastest swing.
  const natural = Math.max(100, 1800 - elapsed * .038);
  return Math.max(40, Math.round(natural * .76 ** pulls));
}

export function createRound(state) {
  state.mapName = 'Rope court';
  state.roundElapsedMs = 0;
  state.ropeSwing = 1;
  state.ropeStartMs = 0;
  state.ropeHitMs = swingDuration(0, 0);
  state.ropePulls = 0;
  state.tiles.clear();
  state.tileGoneAtMs.clear();
  const participantIds = [];
  for (const player of state.players.values()) {
    player.participating = player.connected;
    player.alive = player.participating;
    player.ropeDings = 0;
    player.jumpedAtMs = -1;
    player.dingAtMs = -1;
    player.pulledSwing = 0;
    if (player.participating) participantIds.push(player.id);
  }
  return { participantIds, lastEliminatedIds: [], outcome: null };
}

export function act(state, player, input) {
  if (state.phase !== 'playing' || state.gameId !== 'rope' || !player?.connected || !player.participating ||
      input?.round !== state.round || input.swing !== state.ropeSwing) return;
  if (player.alive) {
    if (input.action !== 'jump' ||
        (player.jumpedAtMs >= 0 && state.roundElapsedMs - player.jumpedAtMs < NEXT_JUMP_MS)) return;
    player.jumpedAtMs = state.roundElapsedMs;
  } else if (input.action === 'pull' && player.pulledSwing !== state.ropeSwing) {
    player.pulledSwing = state.ropeSwing;
    state.ropePulls++;
  }
}

export function updateRound(state, round, { dtMs }) {
  if (round.outcome) return round.outcome;
  const living = livingIds(state, round);
  if (living.length < 2) return finishRound(state, round, living.length ? 'last-survivor' : 'no-participants');
  state.roundElapsedMs += dtMs;
  // Fixed ticks can straddle the contact instant. Judge every player against
  // the published deadline, including any disconnected jumpers.
  while (state.roundElapsedMs >= state.ropeHitMs) {
    const eliminated = [];
    for (const id of livingIds(state, round)) {
      const p = state.players.get(id);
      if (jumpHeight(p.jumpedAtMs, state.ropeHitMs) >= .42) continue;
      p.dingAtMs = state.ropeHitMs;
      p.ropeDings++;
      if (p.ropeDings === STRIKES_OUT) {
        p.alive = false;
        eliminated.push(id);
      }
    }
    const remaining = livingIds(state, round);
    if (remaining.length === 0) {
      round.lastEliminatedIds = eliminated;
      return finishRound(state, round, 'simultaneous-elimination');
    }
    if (remaining.length === 1) return finishRound(state, round, 'last-survivor');
    state.ropeSwing++;
    state.ropeStartMs = state.ropeHitMs;
    state.ropeHitMs += swingDuration(state.ropeStartMs, state.ropePulls);
  }
  return null;
}
