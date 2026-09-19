import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@colyseus/sdk';
import { PartySession, claimBrowserTab } from '../client/session.js';

const flush = async () => { for (let count = 0; count < 20; count++) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const health = { ok: true, instanceId: 'process-one', reconnectionSeconds: 120 };
const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

function setup(t, saved = null) {
  const events = new Map();
  const store = new Map(saved ? [['kottabos.recovery.v1', JSON.stringify(saved)]] : []);
  const original = new Map(['window', 'localStorage', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin: 'https://party.example', hostname: 'party.example' },
    addEventListener(name, handler) { events.set(name, handler); },
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  t.mock.method(globalThis, 'setInterval', () => 0);
  const statuses = [];
  const notices = [];
  const states = [];
  const session = new PartySession({
    onState: (state) => states.push(state), onStatus: (...args) => statuses.push(args),
    onNotice: (notice) => notices.push(notice), onReset() {},
  });
  t.after(() => {
    session.operation?.controller.abort();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { session, statuses, notices, states, store, events };
}

function savedSeat() {
  return { roomId: 'ABCDEF', playerId: 'same-player', token: 'ABCDEF:private-token', ...health, disconnectedAt: Date.now() };
}

test('Web Lock capability failure is distinct from an occupied tab', async (t) => {
  setup(t);
  assert.equal(await claimBrowserTab(), 'unsupported');
  navigator.locks = { request: async (name, options, callback) => callback(null) };
  assert.equal(await claimBrowserTab(), 'occupied');
  navigator.locks.request = async () => { throw new Error('Capability denied'); };
  assert.equal(await claimBrowserTab(), 'unsupported');
});

test('startup retries a provider HTML loading page then creates exactly one party', async (t) => {
  const { session, statuses } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? new Response('<html>Waking up</html>', { headers: { 'Content-Type': 'text/html' } }) : json(health));
  let creates = 0;
  const room = {};
  t.mock.method(session, 'matchmake', async () => { creates++; return room; });
  t.mock.method(session, 'bind', (result) => { session.room = result; });
  const joining = session.join('Athena');
  await flush();
  assert.match(statuses.at(-1)[1], /Waking/);
  assert.equal(session.recoveryDeadline, undefined, 'Readiness must not start a seat reservation');
  t.mock.timers.tick(750);
  await joining;
  assert.equal(creates, 1);
  assert.equal(requests, 2);
  assert.equal(session.room, room);
});

test('startup retries stop after a bounded readiness window', async (t) => {
  const { session, notices } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(session, 'health', async () => { throw new Error('Offline'); });
  let matchmaking = 0;
  t.mock.method(session, 'matchmake', async () => { matchmaking++; });
  const joining = session.join('Athena');
  for (let attempt = 0; attempt < 50 && session.connection === 'joining'; attempt++) {
    await flush();
    t.mock.timers.tick(2500);
  }
  await joining;
  assert.equal(session.connection, 'idle');
  assert.match(notices.at(-1), /try again/);
  assert.equal(matchmaking, 0);
});

test('canceling a delayed initial health response cannot create a late party', async (t) => {
  const { session, notices } = setup(t);
  const response = deferred();
  t.mock.method(session, 'health', () => response.promise);
  let matchmaking = 0;
  t.mock.method(session, 'matchmake', async () => { matchmaking++; });
  const joining = session.join('Athena');
  session.leave();
  const canceledNotice = notices.at(-1);
  response.resolve(health);
  await joining;
  assert.equal(session.connection, 'ended');
  assert.equal(matchmaking, 0);
  assert.equal(notices.at(-1), canceledNotice);
  assert.equal(session.saved, null);
});

test('cancel aborts HTTP immediately and a late matchmaking response cannot open a socket', async (t) => {
  const { session } = setup(t);
  t.mock.method(session, 'health', async () => health);
  const response = deferred();
  let signal;
  t.mock.method(globalThis, 'fetch', (url, options) => { signal = options.signal; return response.promise; });
  let sockets = 0;
  t.mock.method(Client.prototype, 'createRoom', () => { sockets++; throw new Error('Must not create a socket'); });
  const joining = session.join('Athena');
  await flush();
  assert.ok(signal);
  session.leave();
  assert.equal(signal.aborted, true);
  await joining;
  response.resolve(json({ name: 'party', roomId: 'ABCDEF', sessionId: 'new-seat', processId: 'one' }));
  await flush();
  assert.equal(sockets, 0);
  assert.equal(session.room, null);
});

test('cancel closes a pending SDK handshake before a late join can bind or save credentials', async (t) => {
  const { session, store } = setup(t);
  t.mock.method(session, 'health', async () => health);
  const result = deferred();
  let closed = 0;
  const room = { reconnection: { enabled: true }, connection: { close: () => { closed++; } } };
  t.mock.method(Client.prototype, 'createRoom', () => room);
  t.mock.method(Client.prototype, 'create', function () { this.createRoom('party'); return result.promise; });
  let bound = 0;
  t.mock.method(session, 'bind', () => { bound++; });
  const joining = session.join('Athena');
  await flush();
  session.leave();
  assert.ok(closed >= 1, 'A pending socket closes at cancellation, before its join promise settles');
  assert.equal(room.reconnection.enabled, false);
  await joining;
  result.resolve(room);
  await flush();
  assert.equal(bound, 0);
  assert.equal(store.size, 0);
});

test('a blackholed initial WebSocket handshake times out and retires its transport', async (t) => {
  const { session, notices } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(session, 'health', async () => health);
  let closed = false;
  const room = { reconnection: {}, connection: { close: () => { closed = true; } } };
  t.mock.method(Client.prototype, 'createRoom', () => room);
  t.mock.method(Client.prototype, 'create', function () { this.createRoom('party'); return new Promise(() => {}); });
  const joining = session.join('Athena');
  await flush();
  t.mock.timers.tick(15_000);
  await joining;
  assert.equal(closed, true);
  assert.equal(session.connection, 'idle');
  assert.match(notices.at(-1), /could not finish connecting/);
});

test('full and missing parties have distinct actionable errors without allocating a seat', async (t) => {
  const { session, notices } = setup(t);
  t.mock.method(session, 'health', async () => health);
  let exists = true;
  t.mock.method(session, 'party', async () => ({ instanceId: health.instanceId, exists, players: 4, maxPlayers: 4 }));
  let joins = 0;
  t.mock.method(session, 'matchmake', async () => { joins++; });
  await session.join('Hermes', 'ABCDEF');
  assert.match(notices.at(-1), /full, including reserved/);
  exists = false;
  await session.join('Hermes', 'ABCDEF');
  assert.match(notices.at(-1), /ended or the code is incorrect/);
  assert.equal(joins, 0);
});

test('provider HTML during party lookup retries recovery without treating it as an ended party', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const saved = savedSeat();
  const { session, notices } = setup(t, saved);
  let lookups = 0;
  t.mock.method(globalThis, 'fetch', async (url) => url === '/api/health' ? json(health)
    : ++lookups === 1 ? new Response('<html>Loading</html>', { headers: { 'Content-Type': 'text/html' } })
      : json({ exists: true, instanceId: health.instanceId }));
  let restoredToken;
  t.mock.method(session, 'matchmake', async (operation, method, token) => { restoredToken = token; return {}; });
  t.mock.method(session, 'bind', () => { session.connection = 'connected'; });
  const recovery = session.recover();
  await flush();
  assert.equal(session.connection, 'reconnecting');
  const deadline = session.recoveryDeadline;
  t.mock.timers.tick(380);
  await recovery;
  assert.equal(session.connection, 'connected');
  assert.equal(restoredToken, saved.token);
  assert.equal(session.recoveryDeadline, deadline, 'Readiness retries must not extend the reservation');
  assert.deepEqual(notices, []);
});

test('an unreachable recovery stops at the original reservation deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 });
  const saved = { ...savedSeat(), disconnectedAt: 9000, reconnectionSeconds: 2 };
  const { session, notices } = setup(t, saved);
  t.mock.method(session, 'health', async () => { throw new Error('Offline'); });
  const recovery = session.recover();
  for (let step = 0; step < 5; step++) { await flush(); t.mock.timers.tick(400); }
  await recovery;
  assert.equal(session.connection, 'ended');
  assert.match(notices.at(-1), /reservation expired/);
  assert.equal(session.saved, null);
});

test('corrupt saved timing metadata cannot make recovery unbounded', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 });
  const { session } = setup(t, { ...savedSeat(), reconnectionSeconds: 'forever', disconnectedAt: 'yesterday' });
  t.mock.method(session, 'health', async () => { throw new Error('Offline'); });
  t.mock.method(globalThis, 'fetch', async () => json({ released: true }));
  const recovery = session.recover();
  await flush();
  assert.equal(session.recoveryDeadline, 130_000);
  session.leave();
  await recovery;
});

test('a delayed recovery response after cancellation cannot end a newer join', async (t) => {
  const { session, notices } = setup(t, savedSeat());
  const stale = deferred();
  let requests = 0;
  t.mock.method(session, 'health', async () => ++requests === 1 ? stale.promise : health);
  t.mock.method(globalThis, 'fetch', async () => json({ released: true }));
  const recovery = session.recover();
  session.leave();
  const room = {};
  t.mock.method(session, 'matchmake', async () => room);
  t.mock.method(session, 'bind', () => { session.room = room; session.connection = 'connected'; });
  await session.join('New Athena');
  const noticesBefore = notices.length;
  stale.resolve({ ...health, instanceId: 'a-stale-restart' });
  await recovery;
  assert.equal(session.room, room);
  assert.equal(session.connection, 'connected');
  assert.equal(notices.length, noticesBefore);
});

test('page close fences a pending create before its delayed health response', async (t) => {
  const { session, events } = setup(t);
  const stale = deferred();
  t.mock.method(session, 'health', () => stale.promise);
  let creates = 0;
  t.mock.method(session, 'matchmake', async () => { creates++; });
  const joining = session.join('Athena');
  events.get('pagehide')();
  stale.resolve(health);
  await joining;
  assert.equal(creates, 0);
  assert.equal(session.closing, true);
});
