import assert from 'node:assert/strict';
import test from 'node:test';
import { Controls, joystickDirection } from '../client/controls.js';
import { STEP_MS } from '../shared/constants.js';

class Element extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.style = { setProperty() {} };
    this.captures = new Set();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 140, height: 140 }; }
  focus() {}
}

function emit(target, type, fields = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
}

function harness(t) {
  const originals = new Map(['window', 'document', 'localStorage', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new Element();
  const document = new Element();
  const coarse = Object.assign(new Element(), { matches: true });
  window.matchMedia = () => coarse;
  for (const [key, value] of Object.entries({ window, document, localStorage: { getItem: () => null, setItem() {} }, navigator: { maxTouchPoints: 1 } })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.after(() => { for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const sent = [];
  const session = { connection: 'connected', playerId: 'me', state: { phase: 'playing', round: 1, players: { me: { x: 150, y: 150, alive: true, participating: true, lastInputSeq: 0 } } }, send: (type, value) => { sent.push({ type, value }); return true; } };
  const joystick = new Element(), toggle = new Element(), panel = new Element(), hint = new Element();
  const controls = new Controls(session, { joystick, toggle, panel, hint });
  controls.reconcile();
  const pointer = (type, id = 1, x = 119, y = 70) => emit(joystick, type, { pointerId: id, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  return { controls, session, sent, joystick, toggle, window, document, pointer, coarse };
}

test('joystick has a quiet center and bounded analog or diagonal movement', () => {
  assert.deepEqual(joystickDirection(3, -3, 50), { x: 0, y: 0 });
  const half = joystickDirection(28, 0, 50);
  assert.equal(half.x, .5);
  const far = joystickDirection(300, 400, 50);
  assert.equal(Math.hypot(far.x, far.y), 1);
  assert.ok(far.x > 0 && far.y > 0);
});

test('one captured finger controls movement; release outside resets touch and queued input', (t) => {
  const { controls, sent, joystick, pointer } = harness(t);
  pointer('pointerdown');
  assert.ok(joystick.hasPointerCapture(1));
  pointer('pointerdown', 2, 0, 0);
  pointer('pointermove', 2, 0, 0);
  pointer('pointerup', 2);
  assert.deepEqual(controls.direction(), { x: 1, y: 0 });
  pointer('pointermove', 1, 500, 70);
  controls.update(STEP_MS);
  assert.equal(sent.at(-1).type, 'input');
  assert.deepEqual(sent.at(-1).value, { x: 1, y: 0, seq: 1 });
  pointer('pointerup', 1, 500, 70);
  assert.deepEqual(controls.direction(), { x: 0, y: 0 });
  assert.equal(controls.pending.length, 0);
  assert.equal(sent.at(-1).type, 'clearInputs');
  assert.equal(joystick.captures.size, 0);
});

test('hybrid keyboard and touch share the speed limit and release independently', (t) => {
  const { controls, window, pointer } = harness(t);
  emit(window, 'keydown', { code: 'ArrowDown' });
  pointer('pointerdown');
  assert.ok(Math.abs(Math.hypot(...Object.values(controls.direction())) - 1) < 1e-12);
  pointer('pointerup');
  assert.deepEqual(controls.direction(), { x: 0, y: 1 });
  emit(window, 'keyup', { code: 'ArrowDown' });
  assert.deepEqual(controls.direction(), { x: 0, y: 0 });
});

test('pointer cancellation and lost capture never leave a held direction', (t) => {
  const { controls, pointer } = harness(t);
  for (const event of ['pointercancel', 'lostpointercapture']) {
    pointer('pointerdown');
    pointer(event);
    assert.equal(controls.pointerId, null);
    assert.deepEqual(controls.direction(), { x: 0, y: 0 });
  }
});

test('a hybrid device keeps detected touch controls when its pointer capability changes', (t) => {
  const { controls, coarse, toggle } = harness(t);
  coarse.matches = false;
  navigator.maxTouchPoints = 0;
  emit(coarse, 'change');
  assert.equal(controls.touchEnabled, true);
  emit(toggle, 'click');
  coarse.matches = true;
  emit(coarse, 'change');
  assert.equal(controls.touchEnabled, false, 'explicit player preference wins');
});

test('blur, hidden page, page close, rotation, and disabling touch clear every input source', (t) => {
  const { controls, joystick, window, document, toggle, pointer } = harness(t);
  const boundaries = [() => emit(window, 'blur'), () => { document.hidden = true; emit(document, 'visibilitychange'); }, () => emit(window, 'pagehide'), () => emit(window, 'resize'), () => emit(toggle, 'click')];
  for (const boundary of boundaries) {
    emit(window, 'keydown', { code: 'KeyW' });
    pointer('pointerdown');
    controls.update(STEP_MS);
    boundary();
    assert.deepEqual(controls.direction(), { x: 0, y: 0 });
    assert.equal(controls.pending.length, 0);
    assert.equal(joystick.captures.size, 0);
  }
});

test('disconnect, elimination, new round, and phase transitions clear all held movement', (t) => {
  const { controls, session, window, pointer } = harness(t);
  const boundaries = [() => { session.connection = 'reconnecting'; }, () => { session.state.players.me.alive = false; }, () => { session.state.round++; }, () => { session.state.phase = 'results'; }];
  for (const boundary of boundaries) {
    session.connection = 'connected';
    session.state.phase = 'playing';
    session.state.players.me.alive = true;
    controls.reconcile();
    emit(window, 'keydown', { code: 'KeyW' });
    pointer('pointerdown');
    controls.update(STEP_MS);
    boundary();
    controls.reconcile();
    assert.deepEqual(controls.direction(), { x: 0, y: 0 });
    assert.equal(controls.pending.length, 0);
    assert.equal(controls.pointerId, null);
  }
});
