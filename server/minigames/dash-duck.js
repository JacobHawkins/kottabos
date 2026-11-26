import { RUN_JUMP_MS, DUCK_MS, jumpArc } from '../../shared/arcade.js';
import { livingIds } from './last-standing.js';
import { prepare, entity, removeEntity, validAction, cooldown, tick, moveCursor, survivalResult } from './arcade-common.js';

export function createRound(state) {
  const round = prepare(state, { columns: 20, rows: 16, name: 'Obstacle sprint', duration: 75_000 });
  round.participantIds.forEach((id, i) => {
    const lane = 40 + (i + .5) * 448 / round.participantIds.length;
    Object.assign(state.players.get(id), { x: 110, y: lane, lane });
  });
  round.spawnAtMs = 700;
  return round;
}
export function act(state, p, input, round) {
  if (!validAction(state, p, input, 'runner') || !round) return;
  const now = state.roundElapsedMs;
  if (p.alive) {
    if (p.stunnedUntilMs > now || now < p.duckUntilMs || p.jumpedAtMs >= 0 && now - p.jumpedAtMs < RUN_JUMP_MS) return;
    if (input.action === 'jump') p.jumpedAtMs = now;
    if (input.action === 'duck') p.duckUntilMs = now + DUCK_MS;
  } else if (input.action === 'stun' && cooldown(state, p, 1800)) {
    // One nearby runner per shot. A target has a grace period against chained stuns.
    const targets = livingIds(state, round).map(id => state.players.get(id))
      .filter(target => Math.hypot(target.x - p.x, target.y - p.y) <= 28 && target.immuneUntilMs <= now)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    if (targets[0]) { targets[0].stunnedUntilMs = now + 350; targets[0].immuneUntilMs = now + 2000; }
  }
}
export function updateRound(state, round, { dtMs, inputs = new Map() }) {
  if (round.outcome) return round.outcome;
  const early = survivalResult(state, round); if (early) return early;
  tick(state, dtMs);
  for (const id of round.participantIds) {
    const p = state.players.get(id);
    if (p && !p.alive) moveCursor(state, p, inputs.get(id), dtMs);
  }
  if (state.roundElapsedMs >= round.spawnAtMs) {
    const travel = Math.max(1100, 2500 - state.roundElapsedMs / 60);
    entity(state, round, { kind: round.pick(2) ? 'hurdle' : 'bar', x: 620, due: state.roundElapsedMs + travel, power: travel });
    round.spawnAtMs = state.roundElapsedMs + Math.max(780, 1600 - state.roundElapsedMs / 90);
  }
  const eliminated = [];
  for (const obstacle of [...state.entities]) {
    obstacle.x = 110 + (obstacle.due - state.roundElapsedMs) / obstacle.power * 510;
    if (state.roundElapsedMs < obstacle.due) continue;
    for (const id of livingIds(state, round)) {
      const p = state.players.get(id);
      const dodged = obstacle.kind === 'hurdle' ? jumpArc(p.jumpedAtMs, obstacle.due) >= .45
        : p.duckUntilMs > obstacle.due && p.duckUntilMs - DUCK_MS <= obstacle.due;
      if (!dodged) { p.hits++; p.dingAtMs = obstacle.due; if (p.hits >= 3) { p.alive = false; eliminated.push(id); } }
    }
    removeEntity(state, obstacle);
  }
  return survivalResult(state, round, eliminated);
}
