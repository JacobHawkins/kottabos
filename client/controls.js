import { STEP_MS } from '../shared/constants.js';
import { movePlayer, normalizeInput } from '../shared/movement.js';

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const TOUCH_SETTING = 'kottabos.touch-controls';

export function joystickDirection(x, y, radius) {
  const distance = Math.hypot(x, y);
  const deadZone = radius * 0.12;
  if (distance <= deadZone || radius <= 0) return { x: 0, y: 0 };
  const strength = Math.min(1, (distance - deadZone) / (radius - deadZone));
  return { x: x / distance * strength, y: y / distance * strength };
}

// One controller for the page lifetime, independent of reconnecting Room objects.
export class Controls {
  constructor(session, { joystick, toggle, panel, hint } = {}) {
    this.session = session;
    this.keys = new Set();
    this.pending = [];
    this.sequence = 0;
    this.accumulator = 0;
    this.predicted = null;
    this.round = -1;
    this.correction = 0;
    this.pointerId = null;
    this.touch = { x: 0, y: 0 };
    this.joystick = joystick;
    this.toggle = toggle;
    this.panel = panel;
    this.hint = hint;
    this.phase = '';
    this.wasMovable = false;
    window.addEventListener('keydown', (event) => {
      if (!MOVEMENT_KEYS.has(event.code) || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
      if (this.canMove()) { event.preventDefault(); this.keys.add(event.code); }
    });
    window.addEventListener('keyup', (event) => { this.keys.delete(event.code); });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    window.addEventListener('pagehide', () => this.clear());
    window.addEventListener('resize', () => this.clear());
    this.setupTouch();
  }

  setupTouch() {
    if (!this.joystick) return;
    const coarse = window.matchMedia('(any-pointer: coarse)');
    let preference;
    try { preference = localStorage.getItem(TOUCH_SETTING); } catch { /* Optional preference. */ }
    this.touchEnabled = preference ? preference === 'on' : coarse.matches || navigator.maxTouchPoints > 0;
    coarse.addEventListener('change', () => {
      // Once touch is detected, keep it available until the player turns it
      // off. Hybrid devices can temporarily report a mouse as their pointer.
      if (preference || this.touchEnabled || !(coarse.matches || navigator.maxTouchPoints > 0)) return;
      this.clear();
      this.touchEnabled = true;
      this.renderTouch();
    });
    this.toggle?.addEventListener('click', () => {
      this.clear();
      this.touchEnabled = !this.touchEnabled;
      preference = this.touchEnabled ? 'on' : 'off';
      try { localStorage.setItem(TOUCH_SETTING, preference); } catch { /* Optional preference. */ }
      this.renderTouch();
    });
    this.joystick.addEventListener('pointerdown', (event) => {
      if (!this.touchEnabled || !this.canMove() || this.pointerId !== null || event.button !== 0) return;
      event.preventDefault();
      this.pointerId = event.pointerId;
      // Capture first: no movement is accepted if the browser cannot own the drag.
      try { this.joystick.setPointerCapture(event.pointerId); }
      catch { this.releaseTouch(); return; }
      this.joystick.focus({ preventScroll: true });
      this.moveTouch(event);
    });
    this.joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.preventDefault();
      if (!this.canMove() || event.buttons === 0) this.releaseTouch();
      else this.moveTouch(event);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.joystick.addEventListener(type, (event) => {
        if (event.pointerId === this.pointerId) this.releaseTouch();
      });
    }
    this.renderTouch();
  }

  moveTouch(event) {
    const bounds = this.joystick.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) * 0.35;
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    this.touch = joystickDirection(x, y, radius);
    this.joystick.style.setProperty('--stick-x', `${this.touch.x * radius}px`);
    this.joystick.style.setProperty('--stick-y', `${this.touch.y * radius}px`);
  }

  releaseTouch(flush = true) {
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.touch = { x: 0, y: 0 };
    this.joystick?.style.setProperty('--stick-x', '0px');
    this.joystick?.style.setProperty('--stick-y', '0px');
    if (pointerId !== null && this.joystick?.hasPointerCapture(pointerId)) this.joystick.releasePointerCapture(pointerId);
    if (flush) this.clearQueue();
  }

  renderTouch() {
    if (!this.joystick) return;
    this.panel.hidden = !this.touchEnabled;
    this.toggle.setAttribute('aria-pressed', String(this.touchEnabled));
    this.toggle.textContent = `Touch controls: ${this.touchEnabled ? 'on' : 'off'}`;
    this.joystick.setAttribute('aria-disabled', String(!this.canMove()));
    this.hint.textContent = this.canMove() ? 'Drag to move. Release to stop.'
      : this.session.connection !== 'connected' ? 'Movement pauses while reconnecting.'
        : this.session.state?.phase === 'lobby' ? 'Ready up to play. Drag here when the round starts.'
          : this.session.state?.phase === 'countdown' ? 'Get ready to move.' : 'Movement is off while you spectate or wait.';
  }

  get me() { return this.session.state?.players[this.session.playerId]; }
  canMove() { return this.session.connection === 'connected' && this.session.state?.phase === 'playing' && this.me?.alive && this.me?.participating; }
  direction() {
    return normalizeInput({
      x: this.touch.x + Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
      y: this.touch.y + Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')),
    });
  }

  clear() {
    this.keys.clear();
    this.releaseTouch(false);
    this.clearQueue();
    this.renderTouch();
  }

  clearQueue() {
    this.pending.length = 0;
    this.accumulator = 0;
    this.predicted = this.me ? { x: this.me.x, y: this.me.y } : null;
    this.session.send('clearInputs');
  }

  reconcile() {
    const me = this.me;
    const movable = Boolean(this.canMove());
    const phase = this.session.state?.phase || '';
    const round = this.session.state?.round ?? -1;
    if (this.round !== round || this.phase !== phase || (this.wasMovable && !movable)) this.clear();
    this.round = round;
    this.phase = phase;
    this.wasMovable = movable;
    this.renderTouch();
    if (!me) { this.clear(); return; }
    this.sequence = Math.max(this.sequence, me.lastInputSeq || 0);
    if (!movable) {
      this.pending.length = 0;
      this.accumulator = 0;
      this.predicted = { x: me.x, y: me.y };
      return;
    }
    // Discard acknowledged commands and replay only local, unacknowledged input.
    // The server consumes at most one command per tick, regardless of send rate.
    this.pending = this.pending.filter((input) => input.seq > me.lastInputSeq);
    let predicted = { x: me.x, y: me.y };
    for (const input of this.pending) predicted = movePlayer(predicted, input, STEP_MS / 1000);
    this.correction = this.predicted ? Math.hypot(predicted.x - this.predicted.x, predicted.y - this.predicted.y) : 0;
    this.predicted = predicted;
  }

  update(deltaMs) {
    if (!this.canMove()) return;
    if (!this.predicted) this.reconcile();
    // Never replay a large burst after tab suspension or a slow frame.
    this.accumulator += Math.min(deltaMs, 2 * STEP_MS);
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      if (this.pending.length >= 30) { this.clear(); break; }
      const input = { ...this.direction(), seq: ++this.sequence };
      if (!this.session.send('input', input)) { this.clear(); break; }
      this.pending.push(input);
      this.predicted = movePlayer(this.predicted, input, STEP_MS / 1000);
    }
  }

  position() {
    if (!this.predicted) return null;
    // Fractional-tick preview responds on the next animation frame, even before
    // the next 30 Hz command is sent. It never changes authoritative outcomes.
    return this.canMove() ? movePlayer(this.predicted, this.direction(), this.accumulator / 1000) : this.predicted;
  }
}
