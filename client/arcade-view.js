import { PLAYER_COLORS } from '../shared/constants.js';
import { jumpArc, WIND_MS } from '../shared/arcade.js';

export const ARCADE_PAD = 20;
const color = c => Number.parseInt(c.replace('#', ''), 16);

export function arcadeHeadline(state) {
  const left = Math.max(0, Math.ceil((state.stageEndsMs - state.roundElapsedMs) / 1000));
  return state.gameId === 'windup' ? state.gameStage === 'winding' ? `WIND YOUR TOY · ${left}s` : `LET THEM RUN! · ${left}s`
    : state.gameId === 'runner' ? `ORANGE: JUMP   PURPLE: DUCK · ${left}s`
      : state.gameId === 'trails' ? `KEEP MOVING · ${left}s` : state.gameId === 'maze' ? `MUNCH THE MAZE · ${left}s` : `MIND THE FUSE · ${left}s`;
}

export function drawArcade(g, state) {
  const pad = ARCADE_PAD, size = state.cellSize, width = state.columns * size, height = state.rows * size;
  g.fillStyle(state.gameId === 'trails' ? 0x081322 : 0x142b36).fillRoundedRect(pad, pad, width, height, 8);
  if (['windup', 'runner'].includes(state.gameId)) {
    const players = Object.values(state.players).filter(p => p.participating);
    players.forEach(p => {
      const y = pad + p.lane;
      g.fillStyle(color(p.color), .07).fillRect(pad + 8, y - 28, width - 16, 35);
      g.lineStyle(1, color(p.color), .3).lineBetween(pad + 8, y + 7, pad + width - 8, y + 7);
      if (state.gameId === 'windup') {
        g.fillStyle(0x091c26).fillRect(pad + 45, y - 9, width - 65, 4);
        g.fillStyle(color(p.color), .65).fillRect(pad + 45, y - 9, Math.min(width - 65, p.charge * 4.2), 4);
      }
    });
    if (state.gameId === 'windup') {
      g.lineStyle(2, 0xfff3c6, .65).lineBetween(pad + 40, pad + 30, pad + 40, pad + height - 12);
      const progress = Math.min(1, state.roundElapsedMs / WIND_MS);
      g.fillStyle(0xa7edc6).fillRect(pad + 10, pad + height - 15, (width - 20) * progress, 4);
    } else for (const e of state.entities) {
      players.forEach(p => {
        const y = pad + p.lane, x = pad + e.x;
        if (e.kind === 'hurdle') {
          g.fillStyle(0xf5aa57).fillTriangle(x, y, x + 15, y - 20, x + 30, y);
          g.lineStyle(2, 0xffe4b3).lineBetween(x + 7, y - 7, x + 23, y - 7);
        } else {
          g.fillStyle(0xc2a2f3).fillRoundedRect(x, y - 28, 32, 15, 3);
          g.lineStyle(2, 0xf2deff).lineBetween(x + 3, y - 19, x + 29, y - 19);
        }
      });
    }
    return;
  }
  state.cells.forEach((value, i) => {
    const x = pad + i % state.columns * size, y = pad + Math.floor(i / state.columns) * size;
    g.lineStyle(1, 0x2c4652, .3).strokeRect(x, y, size, size);
    if (state.gameId === 'trails') {
      if (value >= 10) g.fillStyle(color(PLAYER_COLORS[value - 10]), .75).fillRoundedRect(x + 3, y + 3, size - 6, size - 6, 3);
    } else if (value === 1) {
      g.fillStyle(state.gameId === 'maze' ? 0x426bba : 0x597c73).fillRoundedRect(x + 2, y + 2, size - 4, size - 4, 4);
      g.lineStyle(1, 0x95c7d9, .6).strokeRoundedRect(x + 4, y + 4, size - 8, size - 8, 3);
    } else if (state.gameId === 'maze') {
      if (value === 2) g.fillStyle(0xffe5a3).fillCircle(x + size / 2, y + size / 2, 3);
      if (value === 3) {
        g.fillStyle(0xe5a4ff).fillCircle(x + size / 2, y + size / 2, 9);
        g.fillStyle(0xffffff).fillCircle(x + size / 2, y + size / 2, 3);
      }
    } else if (value === 2) {
      g.fillStyle(0x9e724a).fillRect(x + 3, y + 3, size - 6, size - 6);
      g.lineStyle(2, 0xe0b575).strokeRect(x + 5, y + 5, size - 10, size - 10);
      g.lineBetween(x + 5, y + 5, x + size - 5, y + size - 5);
    } else if (value >= 4) {
      g.fillStyle(value === 4 ? 0xf7b662 : 0xa9efae).fillCircle(x + size / 2, y + size / 2, 10);
      g.lineStyle(3, 0x17303b).lineBetween(x + 11, y + 16, x + 21, y + 16);
      if (value === 4) g.lineBetween(x + 16, y + 11, x + 16, y + 21);
      else g.fillStyle(0x17303b).fillCircle(x + 16, y + 16, 5);
    }
  });
  for (const e of state.entities) {
    const x = pad + e.x, y = pad + e.y;
    if (e.kind === 'ghost') {
      if (e.due > state.roundElapsedMs) continue;
      g.fillStyle(0xee87b8).fillRoundedRect(x - 11, y - 12, 22, 23, 9);
      g.fillStyle(0xffffff).fillCircle(x - 4, y - 3, 4).fillCircle(x + 4, y - 3, 4);
      g.fillStyle(0x142332).fillCircle(x - 4, y - 3, 2).fillCircle(x + 4, y - 3, 2);
    } else if (e.kind === 'bomb') {
      const pulse = Math.sin(state.roundElapsedMs / 65) > 0;
      g.fillStyle(0x080f21).fillCircle(x, y, 12);
      g.lineStyle(2, pulse ? 0xffe0a0 : 0xf26f72).strokeCircle(x, y, 12);
      g.lineStyle(3, 0xffd96e).lineBetween(x + 3, y - 11, x + 7, y - 16);
      const remaining = Math.max(0, Math.min(1, (e.due - state.roundElapsedMs) / 2200));
      g.fillStyle(0xfce0ad).fillRect(x - 10, y + 15, remaining * 20, 3);
    } else if (e.kind === 'flame') {
      g.fillStyle(0xff8c4b, .9).fillRoundedRect(x - 15, y - 15, 30, 30, 5);
      g.fillStyle(0xffed9a).fillCircle(x, y, 8);
    }
  }
}

export function drawArcadePlayer(character, g, p, state, local, position, reducedMotion) {
  const id = state.gameId, now = state.roundElapsedMs, pad = ARCADE_PAD;
  const cursor = !p.alive && ['trails', 'runner'].includes(id);
  const visible = p.participating && (p.alive || cursor);
  character.container.setVisible(visible);
  if (!visible) return;
  const x = pad + position.x, y = pad + position.y;
  const paint = color(p.color);
  character.container.setRotation(0).setPosition(x, y).setDepth(10 + y).setAlpha(p.connected ? 1 : .5).setScale(.68);
  character.ring.setVisible(local);
  character.sprite.setVisible(p.skin === 'sprite' && !cursor && !['windup', 'trails'].includes(id));
  character.shape.setVisible(p.skin !== 'sprite' && !cursor && !['windup', 'trails'].includes(id));
  character.marker.setVisible(!cursor);
  character.shadow.setVisible(!cursor);
  character.label.setVisible(local || id === 'windup');
  const metric = id === 'windup' ? state.gameStage === 'winding' ? `${p.charge} winds` : `${p.distance}cm`
    : id === 'maze' ? `${p.collected} · ${p.hits}/3` : id === 'runner' ? `${p.hits}/3` : '';
  character.label.setFontSize(18);
  character.label.setText(`${local ? 'YOU' : character.number}${metric ? ' · ' + metric : ''}`);
  character.label.setPosition(0, -42);
  if (cursor) {
    const radius = id === 'trails' ? state.cellSize * 2 : 28;
    g.lineStyle(2, paint, .9).strokeCircle(x, y, radius);
    g.lineBetween(x - radius - 6, y, x + radius + 6, y).lineBetween(x, y - radius - 6, x, y + radius + 6);
    if (now - p.actionAtMs < 250) g.fillStyle(paint, .2).fillCircle(x, y, radius);
    character.label.setText(local ? id === 'trails' ? 'YOUR ERASER' : 'YOUR RETICLE' : character.number);
    return;
  }
  if (id === 'windup') {
    g.fillStyle(paint).fillRoundedRect(x - 14, y - 20, 28, 17, 5);
    g.fillStyle(0x0a1a22).fillCircle(x - 8, y - 2, 5).fillCircle(x + 8, y - 2, 5);
    g.lineStyle(2, 0xffe6aa).lineBetween(x, y - 20, x, y - 29);
    const turn = p.charge % 2 ? 6 : 2;
    g.strokeEllipse(x, y - 29, turn * 2, 5);
    character.label.setPosition(38, -17);
  } else if (id === 'trails') {
    g.fillStyle(paint).fillCircle(x, y, 9);
    const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    g.lineStyle(3, 0xffffff).lineBetween(x, y, x + Math.cos(angles[p.facing]) * 12, y + Math.sin(angles[p.facing]) * 12);
  } else {
    const moving = id === 'runner' || character.previous && Math.hypot(position.x - character.previous.x, position.y - character.previous.y) > .1;
    const facing = id === 'runner' ? 'right' : ['right', 'down', 'left', 'up'][p.facing];
    if (reducedMotion) character.sprite.stop().setFrame(({ up: 22, left: 23, down: 24, right: 25 }[facing]) * 13);
    else character.sprite.play(`party-${moving ? 'walk' : 'idle'}-${facing}`, true);
    if (p.immuneUntilMs > now && Math.floor(now / 90) % 2) character.container.setAlpha(.45);
    if (id === 'runner') {
      const jump = jumpArc(p.jumpedAtMs, now) * 25;
      character.container.setY(y - jump);
      if (p.duckUntilMs > now) character.container.setScale(.68, .36);
      if (p.stunnedUntilMs > now) g.lineStyle(3, 0xfff099).strokeCircle(x, y - 20, 17);
    }
    if (id === 'maze' && p.powerUntilMs > now) g.lineStyle(2, 0xe3a5ff).strokeCircle(x, y, 15);
  }
  character.previous = { x: position.x, y: position.y };
}
