import { jumpArc, WIND_MS, windTrackY, RUNNER_X, RUNNER_CUE_MS, runnerObstacleX, runnerCue } from '../shared/arcade.js';

export const ARCADE_PAD = 20;
const color = c => Number.parseInt(c.replace('#', ''), 16);
const runnerScale = count => count <= 6 ? 1.5 : 1;

export function arcadeHeadline(state, now = state.roundElapsedMs) {
  const left = Math.max(0, Math.ceil((state.stageEndsMs - now) / 1000));
  if (state.phase === 'countdown') return state.gameId === 'windup' ? 'GET READY TO WIND!' : 'GET READY · ↑ / W JUMPS · ↓ / S DUCKS';
  return state.gameId === 'windup' ? state.gameStage === 'winding' ? `WIND YOUR TOY · ${left}s` : `OVER THE HILLS! · ${left}s`
    : `${runnerCue(state, now)} · ${left}s`;
}

export function drawArcade(g, state, now, localId) {
  const pad = ARCADE_PAD, width = state.columns * state.cellSize, height = state.rows * state.cellSize;
  const players = Object.values(state.players).filter(p => p.participating);
  g.fillStyle(0x142b36).fillRoundedRect(pad, pad, width, height, 8);
  const next = state.entities.filter(e => e.due > now).sort((a, b) => a.due - b.due)[0];
  const spacing = 448 / Math.max(1, state.laneCount), scale = runnerScale(state.laneCount);
  for (const p of players) {
    const y = pad + p.lane, paint = color(p.color), local = p.id === localId;
    if (state.gameId === 'windup') {
      const track = x => pad + windTrackY(x, p.lane, state.laneCount);
      g.lineStyle(local ? 4 : 2, paint, local ? .85 : .45);
      g.beginPath().moveTo(pad + 40, track(40));
      for (let x = 44; x <= 600; x += 4) g.lineTo(pad + x, track(x));
      g.strokePath();
      // Start and distance markers follow the same hills as the wheels.
      for (let x = 40; x <= 600; x += 140) g.lineStyle(2, 0xe8e7cf, .4).lineBetween(pad + x, track(x) - 4, pad + x, track(x) + 4);
    } else {
      g.fillStyle(paint, local ? .17 : .045).fillRect(pad + 8, y - Math.min(34 * scale, spacing - 5), width - 16, Math.min(40 * scale, spacing - 1));
      g.lineStyle(local ? 2 : 1, local ? 0xf3f6dc : paint, local ? .8 : .4).lineBetween(pad + 8, y, pad + width - 8, y);
      if (p.alive && next) {
        const cueWidth = RUNNER_CUE_MS / next.power * 510;
        const ready = next.due - now <= RUNNER_CUE_MS;
        const cueColor = next.kind === 'hurdle' ? 0xffbd69 : 0xc5a0ff;
        g.fillStyle(cueColor, ready ? .25 : .08).fillRect(pad + RUNNER_X, y - 30 * scale, cueWidth, 30 * scale);
        g.lineStyle(2, cueColor, .8).lineBetween(pad + RUNNER_X + cueWidth, y - 30 * scale, pad + RUNNER_X + cueWidth, y);
      }
      // The collision line is exactly the runner's feet, not an obstacle's leading edge.
      g.lineStyle(2, 0xffffff, .5).lineBetween(pad + RUNNER_X, y - 33 * scale, pad + RUNNER_X, y + 4);
      for (const e of state.entities) {
        if (!p.alive) continue;
        const x = pad + runnerObstacleX(e, now);
        const alpha = now > e.due ? .35 : 1;
        if (e.kind === 'hurdle') {
          g.fillStyle(0xf5aa57, alpha).fillRoundedRect(x - 8 * scale, y - 11 * scale, 16 * scale, 11 * scale, 2);
          g.lineStyle(2, 0xfff0c6, alpha).lineBetween(x - 8 * scale, y - 11 * scale, x + 8 * scale, y - 11 * scale);
          // Up arrow makes the action legible without relying on color.
          g.lineBetween(x, y - 17 * scale, x, y - 26 * scale).lineBetween(x, y - 26 * scale, x - 4 * scale, y - 22 * scale).lineBetween(x, y - 26 * scale, x + 4 * scale, y - 22 * scale);
        } else {
          g.fillStyle(0xba94ef, alpha).fillRoundedRect(x - 13 * scale, y - 31 * scale, 26 * scale, 17 * scale, 3);
          g.lineStyle(2, 0xf6e7ff, alpha).lineBetween(x, y - 27 * scale, x, y - 19 * scale)
            .lineBetween(x, y - 19 * scale, x - 4 * scale, y - 23 * scale).lineBetween(x, y - 19 * scale, x + 4 * scale, y - 23 * scale);
          // A visible gap under the overhead bar shows where a duck fits.
          g.lineStyle(1, 0xd9c7f8, .4 * alpha).lineBetween(x, y - 12 * scale, x, y);
        }
      }
    }
  }
  if (state.gameId === 'windup' && state.gameStage === 'winding') {
    g.fillStyle(0xa7edc6).fillRect(pad + 10, pad + height - 15, (width - 20) * Math.min(1, now / WIND_MS), 4);
  }
}

export function drawArcadePlayer(character, g, p, state, local, position, reducedMotion, now = state.roundElapsedMs) {
  const toy = state.gameId === 'windup', cursor = !p.alive && !toy;
  character.container.setVisible(p.participating);
  if (!p.participating) return;
  const count = state.laneCount, scale = toy ? 1 : runnerScale(count);
  const x = ARCADE_PAD + position.x, y = ARCADE_PAD + (toy ? windTrackY(position.x, p.lane, count) : position.y);
  const paint = color(p.color);
  character.container.setRotation(0).setPosition(x, y).setDepth(10 + y).setAlpha(p.connected ? 1 : .5).setScale(.68 * scale);
  character.ring.setVisible(local && !toy && !cursor);
  character.sprite.setVisible(p.skin === 'sprite' && !cursor && !toy);
  character.shape.setVisible(p.skin !== 'sprite' && !cursor && !toy);
  character.marker.setVisible(!cursor && !toy);
  character.shadow.setVisible(!cursor && !toy);
  character.label.setVisible(local || toy);
  const metric = toy ? state.gameStage === 'winding' ? `${p.charge} winds` : `${p.distance} cm` : `${p.hits}/3`;
  character.label.setFontSize(18).setText(`${local ? 'YOU' : character.number} · ${metric}`).setPosition(toy && state.gameStage === 'winding' ? 45 : 0, -45);
  if (cursor) {
    g.lineStyle(2, paint, .9).strokeCircle(x, y, 28);
    g.lineBetween(x - 34, y, x + 34, y).lineBetween(x, y - 34, x, y + 34);
    if (now - p.actionAtMs < 250) g.fillStyle(paint, .2).fillCircle(x, y, 28);
    character.label.setText(local ? 'YOUR RETICLE' : character.number);
    return;
  }
  if (toy) {
    const slope = (windTrackY(position.x + 1, p.lane, count) - windTrackY(position.x - 1, p.lane, count)) / 2;
    const angle = Math.atan(slope), cos = Math.cos(angle), sin = Math.sin(angle);
    const point = (a, b) => ({ x: x + a * cos - b * sin, y: y + a * sin + b * cos });
    const corners = [[-14,-20],[14,-20],[14,-5],[-14,-5]].map(([a,b]) => point(a,b));
    g.fillStyle(paint).fillPoints(corners, true);
    if (local) g.lineStyle(2, 0xffffff).strokePoints(corners, true);
    for (const offset of [-8, 8]) {
      const wheel = point(offset, -3);
      g.fillStyle(0x091922).fillCircle(wheel.x, wheel.y, 5);
      g.fillStyle(0xaac5ce).fillCircle(wheel.x, wheel.y, 2);
    }
    const key = point(0, -26), base = point(0, -19);
    g.lineStyle(2, 0xffe6aa).lineBetween(base.x, base.y, key.x, key.y);
    g.strokeEllipse(key.x, key.y, p.charge % 2 ? 12 : 5, 5);
  } else {
    if (reducedMotion) character.sprite.stop().setFrame(25 * 13);
    else character.sprite.play('party-walk-right', true);
    character.container.setY(y - jumpArc(p.jumpedAtMs, now) * 25 * scale);
    if (p.duckUntilMs > now) character.container.setScale(.68 * scale, .30 * scale);
    if (p.stunnedUntilMs > now) g.lineStyle(3, 0xfff099).strokeCircle(x, y - 20, 17);
    if (p.dingAtMs >= 0 && now - p.dingAtMs >= 0 && now - p.dingAtMs < 300) {
      g.lineStyle(3, 0xff775e, 1 - (now - p.dingAtMs) / 300).strokeCircle(x, y - 12, 21);
    }
  }
}
