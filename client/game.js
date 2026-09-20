import Phaser from 'phaser';
import characterSheetUrl from './assets/character-spritesheet.png?url';
import { ARENA, PLAYER_COLORS, TILE_WARNING, TILE_GONE, TILE_WARNING_MS } from '../shared/constants.js';

const PADDING = 50;
const SIZE = ARENA.width + PADDING * 2;
const toColor = (color) => Number.parseInt(color.replace('#', ''), 16);

const CHARACTER_TEXTURE = 'party-character';
// The supplied LPC expanded sheet is 13 columns of 64-pixel cells. These rows
// were checked against this PNG, including the outfit in idle/walk/hurt poses.
const CHARACTER_ROWS = { up: { walk: 8, idle: 22 }, left: { walk: 9, idle: 23 },
  down: { walk: 10, idle: 24 }, right: { walk: 11, idle: 25 } };
const frameAt = (row, column = 0) => row * 13 + column;

function createCharacter(scene, color, number) {
  const shadow = scene.add.ellipse(0, 4, 36, 15, 0x112e31, .45);
  const marker = scene.add.ellipse(0, 3, 34, 12, color);
  const ring = scene.add.ellipse(0, 3, 42, 18).setStrokeStyle(2, 0xecffe9, .95);
  // Anchor the feet, not the texture's empty center, to the gameplay position.
  const sprite = scene.add.sprite(0, 0, CHARACTER_TEXTURE, frameAt(CHARACTER_ROWS.down.idle))
    .setOrigin(.5, 62 / 64).setScale(.75);
  const badge = scene.add.text(0, 13, number, {
    fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#102936',
    backgroundColor: `#${color.toString(16).padStart(6, '0')}`, padding: { x: 3, y: 1 },
  }).setOrigin(.5);
  const label = scene.add.text(0, -49, '', {
    fontFamily: 'monospace', fontSize: '10px', color: '#fffce8',
    backgroundColor: '#102331', padding: { x: 5, y: 3 },
  }).setOrigin(.5);
  const container = scene.add.container(0, 0, [shadow, marker, ring, sprite, badge, label]);
  return { container, label, ring, sprite, number, facing: 'down', moving: false,
    previous: null, round: null, phase: null, wasAlive: null };
}

export function createGame(session, controls) {
  let scene;
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  class PlatformScene extends Phaser.Scene {
    constructor() { super('platform'); }
    preload() {
      this.load.spritesheet(CHARACTER_TEXTURE, characterSheetUrl, { frameWidth: 64, frameHeight: 64 });
    }
    create() {
      scene = this;
      this.textures.get(CHARACTER_TEXTURE).setFilter(Phaser.Textures.FilterMode.NEAREST);
      for (const [direction, rows] of Object.entries(CHARACTER_ROWS)) {
        this.anims.create({ key: `party-walk-${direction}`, frames: this.anims.generateFrameNumbers(CHARACTER_TEXTURE,
          { start: frameAt(rows.walk, 1), end: frameAt(rows.walk, 8) }), frameRate: 8, repeat: -1 });
        this.anims.create({ key: `party-idle-${direction}`, frames: [0, 0, 1].map(column =>
          ({ key: CHARACTER_TEXTURE, frame: frameAt(rows.idle, column) })), frameRate: 2, repeat: -1 });
      }
      this.anims.create({ key: 'party-fall', frames: this.anims.generateFrameNumbers(CHARACTER_TEXTURE,
        { start: frameAt(20), end: frameAt(20, 5) }), frameRate: 8, repeat: 0 });
      this.board = this.add.graphics();
      this.characters = new Map();
      this.samples = [];
      this.fps = 0;
    }

    capture(state) {
      if (!this.board) return;
      const sample = { time: performance.now(), round: state.round, players: {} };
      for (const player of Object.values(state.players)) sample.players[player.id] = { x: player.x, y: player.y };
      this.samples.push(sample);
      if (this.samples.length > 12) this.samples.shift();
    }

    remotePosition(player, now) {
      const target = now - 100;
      const samples = this.samples.filter((sample) => sample.round === session.state.round && sample.players[player.id]);
      let before = samples[0];
      let after = samples.at(-1);
      for (const sample of samples) {
        if (sample.time <= target) before = sample;
        if (sample.time >= target) { after = sample; break; }
      }
      if (!before || !after) return player;
      const a = before.players[player.id], b = after.players[player.id];
      const ratio = Math.max(0, Math.min(1, (target - before.time) / (after.time - before.time || 1)));
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }

    update(time, delta) {
      this.fps = Math.round(this.game.loop.actualFps);
      controls.update(delta);
      const state = session.state;
      if (!state) { this.board?.clear(); return; }
      const graphics = this.board;
      graphics.clear();
      graphics.fillStyle(0x081722, 0.5);
      graphics.fillRoundedRect(PADDING - 9, PADDING + 10, ARENA.width + 18, ARENA.height + 12, 10);
      const warningPulse = (Math.sin(time / 190) + 1) / 2;
      for (let index = 0; index < state.tiles.length; index++) {
        const x = PADDING + (index % ARENA.columns) * ARENA.tileSize;
        const y = PADDING + Math.floor(index / ARENA.columns) * ARENA.tileSize;
        const tile = state.tiles[index];
        if (tile === TILE_GONE) {
          graphics.fillStyle(0x0c1b27);
          graphics.fillRoundedRect(x + 3, y + 3, 58, 58, 5);
          graphics.lineStyle(1, 0x27414c, 0.65);
          graphics.strokeRoundedRect(x + 3, y + 3, 58, 58, 5);
          graphics.fillStyle(0x45616b, 0.5);
          graphics.fillCircle(x + 32, y + 32, 1.5);
          continue;
        }
        const warning = tile === TILE_WARNING;
        graphics.fillStyle(warning ? 0x99703d : 0x345951);
        graphics.fillRoundedRect(x + 2, y + 7, 60, 55, 5);
        graphics.fillStyle(warning ? (warningPulse > .5 ? 0xf2be73 : 0xd79b55) : ((index + Math.floor(index / 7)) % 2 ? 0x648b7c : 0x6d9687));
        graphics.fillRoundedRect(x + 2, y + 2, 60, 55, 5);
        graphics.lineStyle(1, warning ? 0xffd79a : 0xa5c7a8, warning ? .85 : .3);
        graphics.strokeRoundedRect(x + 3, y + 3, 58, 52, 4);
        if (warning) {
          const remaining = Math.max(0, Math.min(1,
            ((state.tileGoneAtMs?.[index] ?? state.roundElapsedMs + TILE_WARNING_MS) - state.roundElapsedMs) / TILE_WARNING_MS));
          graphics.fillStyle(0x513d2a, .5);
          graphics.fillRoundedRect(x + 9, y + 47, 46, 4, 2);
          graphics.fillStyle(0xfff0bc);
          graphics.fillRoundedRect(x + 9, y + 47, Math.max(1, 46 * remaining), 4, 2);
          graphics.lineStyle(2, 0x765730, .7);
          graphics.lineBetween(x + 27, y + 19, x + 36, y + 26);
          graphics.lineBetween(x + 36, y + 26, x + 27, y + 37);
          graphics.fillStyle(0x513d2a, .75);
          graphics.fillCircle(x + 44, y + 12, 2);
        }
      }
      const players = Object.values(state.players);
      for (const [id, character] of this.characters) {
        if (!state.players[id]) { character.container.destroy(); this.characters.delete(id); }
      }
      players.forEach((player) => {
        let character = this.characters.get(player.id);
        const local = player.id === session.playerId;
        const seat = Math.max(0, PLAYER_COLORS.indexOf(player.color));
        const number = String(seat + 1).padStart(2, '0');
        if (!character) {
          character = createCharacter(this, toColor(player.color), number);
          this.characters.set(player.id, character);
        }
        const lobby = state.phase === 'lobby';
        const shortName = [...player.name].length > 12 ? [...player.name].slice(0, 11).join('') + '…' : player.name;
        character.label.setText(local ? `${number} · YOU` : shortName);
        // Numbers remain visible without twelve overlapping name plates during play.
        character.label.setVisible(lobby || local);
        character.ring.setVisible(local);
        const visible = lobby || player.participating;
        character.container.setVisible(visible);
        if (!visible) return;
        const position = lobby ? { x: 64 + seat % 4 * (ARENA.width - 128) / 3, y: 104 + Math.floor(seat / 4) * 112 }
          : local ? (controls.position() || player) : this.remotePosition(player, performance.now());
        // Keep identity labels inside the canvas even against its top/side edges.
        const labelHalfWidth = character.label.width / 2 + 3;
        character.label.setPosition(
          Math.max(labelHalfWidth - PADDING - position.x, Math.min(0, SIZE - labelHalfWidth - PADDING - position.x)),
          position.y < 22 ? 33 : -49,
        );
        const resetPose = character.round !== state.round || character.phase !== state.phase;
        const dx = !resetPose && character.previous ? position.x - character.previous.x : 0;
        const dy = !resetPose && character.previous ? position.y - character.previous.y : 0;
        // Local reconciliation can move a few pixels backwards. Face the held
        // input so corrections do not turn the sprite around after key release.
        const direction = local ? controls.direction() : { x: dx, y: dy };
        character.moving = state.phase === 'playing' && player.alive && player.connected &&
          session.connection === 'connected' && Math.hypot(dx, dy) > .05 && Math.hypot(direction.x, direction.y) > .01;
        if (resetPose && (lobby || state.phase === 'countdown' || character.round !== state.round)) character.facing = 'down';
        if (character.moving) character.facing = Math.abs(direction.x) > Math.abs(direction.y)
          ? direction.x > 0 ? 'right' : 'left' : direction.y > 0 ? 'down' : 'up';
        const fallen = !lobby && !player.alive;
        const { sprite } = character;
        if (fallen) {
          // A fresh scene showing an eliminated player restores the final pose.
          // An alive-to-eliminated transition in this scene animates only once.
          if (motionPreference.matches || character.wasAlive === null) sprite.stop().setFrame(frameAt(20, 5));
          else if (character.wasAlive) sprite.play('party-fall');
        } else if (motionPreference.matches || !player.connected || session.connection !== 'connected') {
          sprite.stop().setFrame(frameAt(CHARACTER_ROWS[character.facing].idle));
        } else {
          sprite.play(`party-${character.moving ? 'walk' : 'idle'}-${character.facing}`, true);
        }
        character.previous = { x: position.x, y: position.y };
        character.round = state.round;
        character.phase = state.phase;
        character.wasAlive = player.alive;
        character.container.setPosition(PADDING + position.x, PADDING + position.y);
        character.container.setDepth((local ? ARENA.height : 0) + position.y + 10);
        character.container.setAlpha(!lobby && !player.alive ? .22 : player.connected ? 1 : .5);
        character.container.setScale(!lobby && !player.alive ? .7 : 1);
      });
    }
  }

  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent: 'game-container',
    width: SIZE,
    height: SIZE,
    backgroundColor: '#10212c',
    banner: false,
    audio: { noAudio: true },
    // The page controller owns input; the decorative canvas must allow normal
    // phone scrolling and zoom. Only the thumb joystick suppresses gestures.
    input: { keyboard: false, mouse: false, touch: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: PlatformScene,
  });
  // Phase changes resize the parent without necessarily resizing the window.
  const resizeObserver = new ResizeObserver(() => {
    if (!game.scale.canvas) return;
    game.scale.getParentBounds();
    game.scale.refresh();
  });
  resizeObserver.observe(document.getElementById('game-container'));
  return {
    capture: (state) => scene?.capture(state),
    destroy: () => { resizeObserver.disconnect(); game.destroy(true); },
    get fps() { return scene?.fps || 0; },
    get sceneCount() { return game.scene.scenes.length; },
    get renderedCharacters() { return scene ? Object.fromEntries([...scene.characters].map(([id, value]) => [id, {
      texture: value.sprite.texture.key, frame: value.sprite.frame.name, facing: value.facing, moving: value.moving,
      visible: value.container.visible, alpha: value.container.alpha, number: value.number,
      animation: value.sprite.anims.currentAnim?.key || '', animating: value.sprite.anims.isPlaying,
    }])) : {}; },
    get renderedPositions() { return scene ? Object.fromEntries([...scene.characters].map(([id, value]) => [id, { x: value.container.x - PADDING, y: value.container.y - PADDING }])) : {}; },
  };
}
