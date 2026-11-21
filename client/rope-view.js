import { jumpHeight, STRIKES_OUT } from '../shared/rope.js';

export const COURT_WIDTH = 640;
export const COURT_HEIGHT = 400;
const FEET = 246;
const LEFT = 35;
const RIGHT = COURT_WIDTH - LEFT;

export function drawCourt(g, rope, state, now) {
  const duration = state.ropeHitMs - state.ropeStartMs;
  const phase = Math.max(0, Math.min(1, (now - state.ropeStartMs) / duration));
  const turn = 2 * Math.PI * phase;
  g.fillStyle(0x162e40).fillRect(0, 0, COURT_WIDTH, 145);
  // The back rail and planked court give the feet a fixed reference.
  for (let y = 34; y < 125; y += 34) {
    g.fillStyle(0x294555).fillRect(0, y, COURT_WIDTH, 6);
    g.fillStyle(0x0e2738).fillRect(0, y + 6, COURT_WIDTH, 10);
  }
  g.fillStyle(0xb7774d).fillRect(0, 145, COURT_WIDTH, COURT_HEIGHT - 145);
  for (let row = 0; row < 12; row++) {
    const y = 145 + row * 24;
    g.fillStyle(row % 2 ? 0xc58b60 : 0xbd8158).fillRect(0, y, COURT_WIDTH, 23);
    g.lineStyle(1, 0x8c603f, .65);
    for (let x = row % 3 * 54; x < COURT_WIDTH; x += 160) g.lineBetween(x, y, x, y + 22);
  }
  g.lineStyle(3, 0xffdcaa, .75).strokeRoundedRect(16, 162, COURT_WIDTH - 32, 210, 14);
  g.lineStyle(2, 0xffdcaa, .55).strokeEllipse(COURT_WIDTH / 2, FEET, 165, 90);
  for (const x of [LEFT, RIGHT]) {
    g.fillStyle(0x664d40, .55).fillEllipse(x, FEET + 20, 30, 10);
    g.fillStyle(0x253e4b).fillRoundedRect(x - 5, FEET - 12, 10, 34, 4);
  }
  // Once per revolution the whole rope is straight across the shoe line.
  // The return arc goes behind the runners and the approach passes in front.
  rope.clear().setDepth(phase < .5 ? 1 : 500);
  const lift = 90 * (1 - Math.cos(turn));
  const depth = Math.sin(turn);
  let lastX = LEFT, lastY = FEET;
  for (let i = 1; i <= 48; i++) {
    const t = i / 48;
    const x = LEFT + t * (RIGHT - LEFT);
    const bow = Math.sin(Math.PI * t);
    const y = FEET - lift * bow;
    g.lineStyle(3, 0x574140, .22).lineBetween(lastX, FEET + 20 * depth * Math.sin(Math.PI * (i - 1) / 48),
      x, FEET + 20 * depth * bow);
    rope.lineStyle(6, 0x433631).lineBetween(lastX, lastY + 1, x, y + 1);
    rope.lineStyle(3.5, i % 4 ? 0xffe7a1 : 0xe86f4d).lineBetween(lastX, lastY, x, y);
    lastX = x;
    lastY = y;
  }
  for (const x of [LEFT, RIGHT]) rope.fillStyle(0x264657).fillCircle(x, FEET, 7)
    .fillStyle(0xffcc75).fillCircle(x, FEET, 3);
}

export function drawRopePlayer(character, marks, player, local, slots, now, controls, state, reducedMotion) {
  const jumping = player.alive;
  const group = jumping ? slots.jumpers : slots.pullers;
  const spot = group.indexOf(player.id);
  const spread = Math.min(76, 480 / Math.max(group.length - 1, 1));
  const leftHandle = spot % 2 === 0;
  const tier = Math.floor(spot / 2);
  const x = jumping ? COURT_WIDTH / 2 + (spot - (group.length - 1) / 2) * spread
    : leftHandle ? LEFT + 15 + (tier % 3) * 48 : RIGHT - 15 - (tier % 3) * 48;
  const ground = jumping ? FEET : 177 - Math.floor(tier / 3) * 52;
  const height = jumping ? jumpHeight(controls.visualJumpAt(player), now) * 70 : 0;
  const playing = state.phase === 'playing';
  const tug = !jumping && player.pulledSwing === state.ropeSwing;
  const jog = jumping && playing && !reducedMotion ? 2 * Math.abs(Math.sin(now / 115 + spot)) : 0;
  const y = ground - height - jog;
  const recentlyHit = player.dingAtMs >= 0 && now - player.dingAtMs < 380;
  marks.fillStyle(0x54391e, .4).fillEllipse(x, ground + 3, 36 - height / 6, 8);
  for (let i = 0; i < STRIKES_OUT; i++) {
    const dot = x + (i - 1) * 9;
    marks.fillStyle(0x26383a).fillCircle(dot, ground + 28, 4);
    if (i < player.ropeDings) marks.fillStyle(0xff9876).fillCircle(dot, ground + 28, 2.8);
  }
  character.container.setPosition(x, y).setScale(jumping ? 1 : .83)
    .setRotation(!reducedMotion && tug ? (leftHandle ? -.16 : .16) : 0)
    .setDepth(ground + (local ? 2 : 0)).setAlpha(player.connected ? 1 : .55);
  character.ring.setVisible(local);
  character.label.setVisible(local || recentlyHit);
  character.label.setPosition(0, -49).setText(recentlyHit ? (jumping ? 'DING!' : 'PULL!') : 'YOU');
  character.moving = playing && jumping;
  character.facing = jumping ? 'down' : leftHandle ? 'right' : 'left';
  if (reducedMotion || !playing || !player.connected) {
    const idle = { down: 24, left: 23, right: 25 }[character.facing];
    character.sprite.stop().setFrame(idle * 13);
  } else {
    character.sprite.play(`party-${jumping || tug ? 'walk' : 'idle'}-${character.facing}`, true);
  }
  character.phase = state.phase;
  character.round = state.round;
  character.previous = null;
  character.wasAlive = player.alive;
}
