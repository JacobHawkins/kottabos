import { Client } from '@colyseus/sdk';

const STORAGE_KEY = 'kottabos.recovery.v1';
const TAB_LOCK = 'kottabos.active-player.v1';
const READINESS_MS = 90_000;
const REQUEST_MS = 2000;
const JOIN_MS = 15_000;

function aborted() { return new DOMException('Connection canceled', 'AbortError'); }

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const finish = () => { signal.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); reject(aborted()); };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function retire(room) {
  if (!room) return;
  room.reconnection.enabled = false;
  // Closing a pending handshake also prevents it from becoming a late player.
  try { room.connection?.close(4000, 'Connection canceled'); } catch { /* Already closed. */ }
}

// SDK 0.18.2 has no initial-join cancellation API. Its room factory is the
// narrow pinned-version hook needed to close an in-flight WebSocket, while the
// public fetchFn option and consumeSeatReservation keep matchmaking unchanged.
class PendingClient extends Client {
  constructor(signal) {
    super(window.location.origin, {
      fetchFn: (url, options) => fetch(url, { ...options, signal }),
    });
    this.signal = signal;
    this.pendingRoom = null;
  }

  createRoom(...args) {
    if (this.signal.aborted) throw aborted();
    this.pendingRoom = super.createRoom(...args);
    this.pendingRoom.reconnection.enabled = false;
    return this.pendingRoom;
  }

  consumeSeatReservation(response, ...args) {
    if (this.signal.aborted) throw aborted();
    // A provider loading page may return HTTP 200 while the app is still asleep.
    if (!response || typeof response.roomId !== 'string' || typeof response.sessionId !== 'string' ||
        typeof response.processId !== 'string' || typeof response.name !== 'string') {
      throw new Error('Service is not ready');
    }
    return super.consumeSeatReservation(response, ...args);
  }
}

export async function claimBrowserTab() {
  if (!navigator.locks?.request) return 'unsupported';
  let decided;
  const decision = new Promise((resolve) => { decided = resolve; });
  try {
    navigator.locks.request(TAB_LOCK, { ifAvailable: true }, async (lock) => {
      decided(lock ? 'claimed' : 'occupied');
      if (lock) await new Promise((release) => window.addEventListener('pagehide', release, { once: true }));
    }).catch(() => decided('unsupported'));
  } catch { decided('unsupported'); }
  return decision;
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && /^[A-Z]{6}$/.test(saved.roomId) && typeof saved.token === 'string' &&
        saved.token.startsWith(`${saved.roomId}:`) && typeof saved.playerId === 'string') return saved;
  } catch { /* An unavailable/corrupt browser store cannot restore a credential. */ }
  return null;
}

export class PartySession {
  constructor({ onState, onStatus, onNotice, onReset }) {
    this.callbacks = { onState, onStatus, onNotice, onReset };
    this.operation = null;
    this.room = null;
    this.state = null;
    this.playerId = '';
    this.connection = 'idle';
    this.generation = 0;
    this.saved = readSaved();
    this.cleanups = [];
    this.reconnectionSeconds = 120;
    this.latency = 0;
    this.lastPong = performance.now();
    this.monitorBusy = false;
    this.closing = false;
    this.timer = setInterval(() => this.monitor(), 1000);
    window.addEventListener('pagehide', () => {
      this.closing = true;
      this.generation++;
      this.operation?.controller.abort();
      if (!this.room) return;
      this.persist(Date.now());
      const room = this.room;
      this.room = null;
      this.detach();
      room.reconnection.enabled = false;
      room.connection.close(4010, 'Page closing');
    });
    window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
  }

  status(connection, message) {
    this.connection = connection;
    this.callbacks.onStatus(connection, message);
  }

  persist(disconnectedAt = null) {
    if (!this.room?.reconnectionToken || !this.playerId) return;
    this.saved = {
      roomId: this.room.roomId, playerId: this.playerId, token: this.room.reconnectionToken,
      instanceId: this.instanceId, reconnectionSeconds: this.reconnectionSeconds, disconnectedAt,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved)); }
    catch { this.callbacks.onNotice('Browser storage is unavailable. Keep this tab open; refresh recovery cannot be saved.'); }
  }

  forget() {
    this.saved = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Memory state is still cleared. */ }
  }

  beginOperation() {
    this.operation?.controller.abort();
    const operation = { generation: ++this.generation, controller: new AbortController() };
    this.operation = operation;
    return operation;
  }

  current(operation) {
    return !this.closing && operation.generation === this.generation && !operation.controller.signal.aborted;
  }

  async json(path, signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) throw aborted();
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, REQUEST_MS);
    try {
      const response = await fetch(path, { cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Service is not ready');
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }

  async health(signal) {
    const data = await this.json('/api/health', signal);
    if (data?.ok !== true || typeof data.instanceId !== 'string' || !data.instanceId ||
        !Number.isFinite(data.reconnectionSeconds) || data.reconnectionSeconds <= 0 || data.reconnectionSeconds > 600) {
      throw new Error('Service is not ready');
    }
    return data;
  }

  async party(code, signal) {
    const data = await this.json(`/api/parties/${encodeURIComponent(code)}`, signal);
    if (typeof data?.exists !== 'boolean' || typeof data.instanceId !== 'string') throw new Error('Service is not ready');
    return data;
  }

  async ready(operation, code) {
    const deadline = Date.now() + READINESS_MS;
    let attempts = 0;
    while (this.current(operation)) {
      try {
        const health = await this.health(operation.controller.signal);
        if (!this.current(operation)) throw aborted();
        const party = code ? await this.party(code, operation.controller.signal) : null;
        if (!this.current(operation)) throw aborted();
        if (party && party.instanceId !== health.instanceId) throw new Error('Service restarted while connecting');
        return { health, party };
      } catch (error) {
        if (!this.current(operation)) throw aborted();
        if (Date.now() >= deadline) throw new Error('Service readiness timed out');
        this.status('joining', 'Waking or connecting to the server… retrying. You can cancel.');
        await sleep(Math.min(500 + ++attempts * 250, 2500, deadline - Date.now()), operation.controller.signal);
      }
    }
    throw aborted();
  }

  async matchmake(operation, method, ...args) {
    const controller = new AbortController();
    const client = new PendingClient(controller.signal);
    const parentSignal = operation.controller.signal;
    const cancel = () => controller.abort();
    if (!this.current(operation)) throw aborted();
    parentSignal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, JOIN_MS);
    let cancelPending;
    const canceled = new Promise((resolve, reject) => {
      cancelPending = () => { retire(client.pendingRoom); reject(aborted()); };
      controller.signal.addEventListener('abort', cancelPending, { once: true });
    });
    try {
      const joined = client[method](...args).then((room) => {
        if (controller.signal.aborted || !this.current(operation)) { retire(room); throw aborted(); }
        return room;
      });
      return await Promise.race([joined, canceled]);
    } catch (error) {
      retire(client.pendingRoom);
      throw error;
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', cancelPending);
    }
  }

  async join(name, code = '') {
    if (this.closing || this.room || !['idle', 'ended'].includes(this.connection)) return;
    const operation = this.beginOperation();
    this.status('joining', code ? 'Joining party…' : 'Creating party…');
    try {
      const { health, party } = await this.ready(operation, code);
      if (!this.current(operation)) return;
      if (party && !party.exists) {
        this.status('idle', 'Ready when you are');
        this.callbacks.onNotice('That party has ended or the code is incorrect. Check the invitation or create a new party.');
        return;
      }
      if (party && party.players >= party.maxPlayers) {
        this.status('idle', 'Ready when you are');
        this.callbacks.onNotice('That party is full, including reserved seats. Ask someone to leave, wait for a seat, or create a new party.');
        return;
      }
      this.instanceId = health.instanceId;
      this.reconnectionSeconds = health.reconnectionSeconds;
      this.status('joining', code ? 'Joining party…' : 'Creating party…');
      const room = await this.matchmake(operation, code ? 'joinById' : 'create', code || 'party', { name });
      if (!this.current(operation)) { retire(room); return; }
      this.bind(room);
    } catch (error) {
      if (!this.current(operation)) return;
      this.status('idle', 'Ready when you are');
      this.callbacks.onNotice(error.code === 400 ? 'Enter a nickname of 1–18 characters and check the party code.'
        : code && [409, 4213, 522].includes(error.code) ? 'That party is full or unavailable. Check the code, wait for a reserved seat, or create a new party.'
        : error.code === 429 ? 'The server is busy with too many requests. Wait a moment, then try again.'
        : 'The server could not finish connecting. It may be waking up or your connection may be interrupted. Check your connection and try again.');
    }
  }

  async recover() {
    if (this.closing || !this.saved) return;
    const saved = this.saved;
    const operation = this.beginOperation();
    this.playerId = saved.playerId;
    this.instanceId = saved.instanceId;
    this.reconnectionSeconds = Number.isFinite(saved.reconnectionSeconds) && saved.reconnectionSeconds > 0 && saved.reconnectionSeconds <= 600
      ? saved.reconnectionSeconds : 120;
    // A killed browser may not record its close time. The server remains the
    // authority for expiration; this deadline bounds retries while unreachable.
    const disconnectedAt = Number.isFinite(saved.disconnectedAt) && saved.disconnectedAt > 0 && saved.disconnectedAt <= Date.now()
      ? saved.disconnectedAt : Date.now();
    this.recoveryDeadline = disconnectedAt + this.reconnectionSeconds * 1000;
    this.status('reconnecting', 'Reconnecting to your party…');
    let attempts = 0;
    let invalidReservations = 0;
    while (this.current(operation)) {
      try {
        const health = await this.health(operation.controller.signal);
        if (!this.current(operation)) return;
        if (saved.instanceId && health.instanceId !== saved.instanceId) {
          this.end('The server restarted. Your previous party has ended. Create a new party to play again.'); return;
        }
        const party = await this.party(saved.roomId, operation.controller.signal);
        if (!this.current(operation)) return;
        if (party.instanceId !== health.instanceId) throw new Error('Service restarted while connecting');
        if (!party.exists) {
          this.end('Your party is no longer available. Its reservation expired or the party ended. Create a new party.'); return;
        }
        const room = await this.matchmake(operation, 'reconnect', saved.token);
        if (!this.current(operation)) { retire(room); return; }
        this.bind(room);
        return;
      } catch (error) {
        if (!this.current(operation)) return;
        attempts++;
        // A refresh can race server-side socket-close detection. Retry invalid
        // reservations briefly before calling them expired; never make a new player silently.
        if (error.code === 524) invalidReservations++;
        if (invalidReservations >= 16) {
          this.end('Your reserved seat has expired. Join the party again with its code if there is space, or create a new party.'); return;
        }
        if (Date.now() >= this.recoveryDeadline) {
          this.end('Your reconnection reservation expired or the server is unavailable. Join again or create a new party when the server is back.'); return;
        }
        this.status('reconnecting', 'Waiting for the server or connection… retrying while your seat reservation lasts.');
        try {
          await sleep(Math.max(0, Math.min(300 + attempts * 80, 1000, this.recoveryDeadline - Date.now())), operation.controller.signal);
        } catch { return; }
      }
    }
  }

  bind(room) {
    this.detach();
    this.room = room;
    this.status('joining', 'Restoring party state…');
    Object.assign(room.reconnection, { enabled: true, minUptime: 0, minDelay: 300, maxDelay: 2500, maxRetries: 120, maxEnqueuedMessages: 0 });
    const current = () => this.room === room;
    // SDK 0.18.2 has no public cancellation for an already scheduled retry.
    // Fence its public transport method so retired rooms cannot open ghost seats.
    const reconnectTransport = room.connection.reconnect.bind(room.connection);
    room.connection.reconnect = (...args) => {
      if (current() && room.reconnection.enabled) reconnectTransport(...args);
    };
    const listen = (signal, callback) => {
      signal(callback);
      this.cleanups.push(() => signal.remove(callback));
    };
    const update = (state) => {
      if (!current() || !state?.players) return;
      this.state = state.toJSON();
      const me = this.state.players[this.playerId];
      if (me?.connected && this.connection !== 'connected' && room.connection.isOpen) {
        this.lastPong = performance.now();
        this.recoveryDeadline = null;
        this.status('connected', 'Connected · party');
        this.persist();
      }
      this.callbacks.onState(this.state);
    };
    listen(room.onStateChange, update);
    this.cleanups.push(room.onMessage('welcome', (message) => {
      if (!current()) return;
      this.playerId = message.playerId;
      this.instanceId = message.instanceId;
      this.reconnectionSeconds = message.reconnectionSeconds;
      // SDK 0.18.2 updates its token after firing onReconnect. Persist at the
      // next microtask, including the initial identification response.
      queueMicrotask(() => { if (current()) { this.persist(); update(room.state); } });
    }));
    this.cleanups.push(room.onMessage('notice', (data) => { if (current()) this.callbacks.onNotice(data.message); }));
    this.cleanups.push(room.onMessage('pong', (data) => {
      if (!current()) return;
      this.latency = Math.max(0, Math.round(performance.now() - data.sentAt));
      this.lastPong = performance.now();
    }));
    listen(room.onDrop, () => {
      if (!current()) return;
      if (!this.recoveryDeadline) this.recoveryDeadline = Date.now() + this.reconnectionSeconds * 1000;
      this.persist(this.recoveryDeadline - this.reconnectionSeconds * 1000);
      this.status('reconnecting', 'Reconnecting… your spot is reserved');
    });
    listen(room.onReconnect, () => {
      if (!current()) return;
      Object.assign(room.reconnection, { minDelay: 300, maxDelay: 2500 });
      this.status('joining', 'Restoring party state…');
      queueMicrotask(() => { if (current()) { this.persist(); room.send('identify'); } });
    });
    listen(room.onError, () => { /* Recovery monitor supplies credential-safe, actionable feedback. */ });
    listen(room.onLeave, (code) => {
      if (!current()) return;
      this.room = null;
      this.detach();
      if (code === 4000) this.end('You left the party. Join with a code whenever you want to play again.');
      else if (code === 4001) this.end('The server stopped. Your party has ended. Start the server and create a new party.');
      else this.recover();
    });
    room.send('identify');
    // The join promise may settle before or after the first state frame.
    update(room.state);
  }

  detach() {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  send(type, data) {
    if (this.connection !== 'connected' || !this.room?.connection.isOpen) return false;
    this.room.send(type, data);
    return true;
  }

  async monitor() {
    if (this.monitorBusy || !this.room) return;
    if (this.connection === 'connected') {
      this.send('ping', { sentAt: performance.now() });
      if (performance.now() - this.lastPong > 5000) this.room.connection.close(4010, 'Connection stalled');
      return;
    }
    if (!this.recoveryDeadline) return;
    this.monitorBusy = true;
    const room = this.room;
    const generation = this.generation;
    const deadline = this.recoveryDeadline;
    try {
      const health = await this.health();
      if (room !== this.room || generation !== this.generation || deadline !== this.recoveryDeadline) return;
      if (health.instanceId !== this.instanceId) this.end('The server restarted. Your previous party has ended. Create a new party to play again.');
      else if (Date.now() >= this.recoveryDeadline) this.end('Your reserved seat has expired. Join again with the party code if there is space, or create a new party.');
    } catch {
      if (room !== this.room || generation !== this.generation || deadline !== this.recoveryDeadline) return;
      if (Date.now() >= this.recoveryDeadline) this.end('The server is unavailable and your reservation expired. Start the server and create a new party.');
    } finally { this.monitorBusy = false; }
  }

  end(message) {
    this.generation++;
    this.operation?.controller.abort();
    const room = this.room;
    this.room = null;
    this.detach();
    if (room) { room.reconnection.enabled = false; room.connection.close(4000); }
    this.forget();
    this.state = null;
    this.playerId = '';
    this.recoveryDeadline = null;
    this.callbacks.onReset();
    this.status('ended', 'Ready for a new party');
    this.callbacks.onNotice(message);
  }

  leave() {
    const room = this.room;
    const wasOnline = room?.connection.isOpen;
    const credential = this.saved;
    // This also releases a reserved seat when the WebSocket is currently down
    // but HTTP still works. Truly offline clients can only wait for expiration.
    if (credential) {
      fetch('/api/leave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: credential.roomId, reconnectionToken: credential.token }),
        signal: AbortSignal.timeout(2000), keepalive: true,
      }).catch(() => {});
    }
    if (room) {
      room.reconnection.enabled = false;
      if (wasOnline) room.leave();
    }
    this.end(!room && !credential ? 'Connection canceled. Create or join a party when you are ready.'
      : wasOnline ? 'You left the party. Your spot is free. Join again whenever you like.'
      : 'You left and automatic rejoining is off. Your seat is released now if the server is reachable, otherwise when its reservation expires.');
  }

  simulateDrop() {
    if (!import.meta.env.DEV || this.connection !== 'connected') return;
    // The real transport closes; the server reserves the player normally.
    // Delaying the SDK retry gives the reconnecting UI time to be inspected.
    Object.assign(this.room.reconnection, { minDelay: 3000, maxDelay: 3000 });
    this.room.connection.close(4010, 'Local recovery test');
  }

  get listenerCount() { return this.cleanups.length; }
}
