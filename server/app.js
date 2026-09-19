import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createPartyRoomClass } from './party-room.js';
import { createPublicGuard } from './public-guard.js';

export async function createAppServer({
  port = 2567,
  host = '127.0.0.1',
  reconnectionSeconds = 120,
  countdownMs = 3000,
  roundDurationMs = 45_000,
  maxRooms = 4,
  allowedOrigin = '',
  requestLimits,
  log = (...args) => console.info('[party]', ...args),
} = {}) {
  if (!Number.isFinite(reconnectionSeconds) || reconnectionSeconds <= 0 || reconnectionSeconds > 600) {
    throw new Error('Reconnection reservation must be between 0 and 600 seconds.');
  }
  if (!Number.isFinite(countdownMs) || countdownMs < 0 || !Number.isFinite(roundDurationMs) || roundDurationMs <= 0) {
    throw new Error('Invalid round timing configuration.');
  }
  const instanceId = randomUUID();
  if (!Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > 100) throw new Error('MAX_ROOMS must be an integer from 1 to 100.');
  const guard = createPublicGuard({ allowedOrigin, limits: requestLimits });
  const rooms = new Map();
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (request, response) => {
    response.set('Cache-Control', 'no-store').json({ ok: true, instanceId, reconnectionSeconds });
  });
  app.get('/api/parties/:code', (request, response) => {
    const room = rooms.get(request.params.code.toUpperCase());
    response.set('Cache-Control', 'no-store').json({
      exists: Boolean(room),
      instanceId,
      ...(room && {
        code: room.roomId,
        players: room.state.players.size,
        connected: Array.from(room.state.players.values()).filter((player) => player.connected).length,
        maxPlayers: room.maxClients,
        phase: room.state.phase,
      }),
    });
  });
  const parseLeaveBody = express.json({ limit: '2kb', strict: true });
  app.post('/api/leave', (request, response) => {
    parseLeaveBody(request, response, (error) => {
      response.set('Cache-Control', 'no-store');
      if (error) return response.status(400).json({ released: false });
      const { roomId, reconnectionToken } = request.body ?? {};
      if (typeof roomId !== 'string' || !/^[A-Z]{6}$/.test(roomId) ||
          typeof reconnectionToken !== 'string' || reconnectionToken.length > 200 ||
          !reconnectionToken.startsWith(`${roomId}:`)) {
        return response.status(400).json({ released: false });
      }
      const token = reconnectionToken.slice(roomId.length + 1);
      const released = rooms.get(roomId)?.releaseWithCredential(token) ?? false;
      response.json({ released });
    });
  });
  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer, pingInterval: 3000, pingMaxRetries: 2, maxPayload: 4096, verifyClient: guard.verifyClient }),
    gracefullyShutdown: false,
    greet: false,
    devMode: false,
  });
  gameServer.define('party', createPartyRoomClass({
    rooms, instanceId, reconnectionSeconds, countdownMs, roundDurationMs, maxRooms, log: log || (() => {}),
  }));
  let closed = false;
  return {
    app, httpServer, gameServer, instanceId, rooms,
    async listen() {
      // Register before listen: Colyseus attaches its own error listener only
      // after binding, while EADDRINUSE is emitted before that callback runs.
      let rejectBinding;
      const bindFailure = new Promise((resolve, reject) => { rejectBinding = reject; });
      httpServer.once('error', rejectBinding);
      try {
        await Promise.race([gameServer.listen(port, host, undefined, () => guard.install(httpServer)), bindFailure]);
      } finally {
        httpServer.removeListener('error', rejectBinding);
      }
      return httpServer.address();
    },
    async close() {
      if (closed) return;
      closed = true;
      await gameServer.gracefullyShutdown(false);
    },
  };
}
