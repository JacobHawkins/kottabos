import Phaser from 'phaser';
import { ARENA, PLAYER_COLORS, TILE_WARNING, TILE_GONE } from '../shared/constants.js';

const PADDING = 50;
const SIZE = ARENA.width + PADDING * 2;
const toColor = (color) => Number.parseInt(color.replace('#', ''), 16);

export function createGame(session, controls) {
  let scene;
  class PlatformScene extends Phaser.Scene {
    constructor() { super('platform'); }
    create() {
      scene = this;
      this.board = this.add.graphics();
      this.characters = new Map();
      this.samples = [];
      this.fps = 0;
      this.add.text(SIZE / 2, 19, 'THE FLOOR IS NOT YOUR FRIEND', {
        fontFamily: 'monospace', fontSize: '9px', color: '#7997a4', letterSpacing: 2,
      }).setOrigin(0.5);
      this.add.text(17, SIZE / 2, 'K / 001', { fontFamily: 'monospace', fontSize: '9px', color: '#557380' }).setOrigin(0.5).setAngle(-90);
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
          const shadow = this.add.ellipse(0, 11, 31, 12, 0x112e31, .35);
          const body = this.add.graphics();
          body.fillStyle(toColor(player.color));
          body.fillRoundedRect(-14, -19, 28, 31, { tl: 11, tr: 11, bl: 7, br: 7 });
          const badge = this.add.text(0, -4, number, { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#102936' }).setOrigin(.5);
          const ring = this.add.ellipse(0, 10, 36, 14).setStrokeStyle(2, 0xecffe9, .9);
          const label = this.add.text(0, -34, '', { fontFamily: 'monospace', fontSize: '11px', color: '#fffce8', backgroundColor: '#102331', padding: { x: 5, y: 3 } }).setOrigin(.5);
          const container = this.add.container(0, 0, [shadow, ring, body, badge, label]);
          character = { container, label, ring };
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
        const position = lobby ? { x: 64 + seat % 4 * (ARENA.width - 128) / 3, y: 104 + Math.floor(seat / 4) * 120 }
          : local ? (controls.position() || player) : this.remotePosition(player, performance.now());
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
  return {
    capture: (state) => scene?.capture(state),
    destroy: () => game.destroy(true),
    get fps() { return scene?.fps || 0; },
    get sceneCount() { return game.scene.scenes.length; },
    get renderedPositions() { return scene ? Object.fromEntries([...scene.characters].map(([id, value]) => [id, { x: value.container.x - PADDING, y: value.container.y - PADDING }])) : {}; },
  };
}
