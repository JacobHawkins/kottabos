import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Room, ServerError } from '@colyseus/core';
import { PartyState, PlayerState } from './state.js';
import { MAX_PLAYERS, PATCH_HZ, PLAYER_COLORS, STEP_MS } from '../shared/constants.js';
import { normalizeInput, movePlayer } from '../shared/movement.js';
import { canMoveInParty, KICK_CODE, MAP_CHOICES, SESSION_CHOICES, SKINS, VOTE_MS } from '../shared/party.js';
import { games } from './minigames/index.js';
import { prepareMap } from './minigames/maps.js';
import { winningChoice } from './voting.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const INPUT_QUEUE_LIMIT = 6;
const INPUT_EXPIRY_MS = 250;

function credentialMatches(actual, supplied) {
  const expected = Buffer.from(actual);
  const candidate = Buffer.from(supplied);
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export function validateName(value) {
  if (typeof value !== 'string') throw new ServerError(400, 'Enter a nickname (1–18 characters).');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 18 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new ServerError(400, 'Enter a nickname (1–18 characters).');
  }
  return name;
}

// Capture trusted server configuration, never merge it with client join options.
export function createPartyRoomClass({ rooms, instanceId, reconnectionSeconds, countdownMs, voteMs = VOTE_MS, maxRooms = 4, log }) {
  return class PartyRoom extends Room {
    onCreate(options) {
      // Check and reserve synchronously so concurrent matchmaking requests
      // cannot exceed the pilot's process-wide room allowance.
      if (rooms.size >= maxRooms) throw new ServerError(503, 'The playtest server is full. Try again later.');
      validateName(options?.name);
      do {
        this.roomId = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      } while (rooms.has(this.roomId));
      rooms.set(this.roomId, this);
      this.maxClients = MAX_PLAYERS;
      this.setPrivate(true);
      this.seatReservationTimeout = 15;
      this.state = new PartyState({ code: this.roomId });
      this.inputState = new Map();
      this.recoveryReservations = new Map();
      this.accumulator = 0;
      this.roundGame = null;
      this.awardedRound = 0;
      this.state.selectedGames.push('platform');
      prepareMap(this.state);
      this.patchRate = 1000 / PATCH_HZ;
      this.maxMessagesPerSecond = 120;
      this.onMessage('start', (client) => this.startSession(client));
      this.onMessage('kick', (client, id) => this.kick(client, id));
      this.onMessage('vote', (client, ballot) => this.vote(client, ballot));
      this.onMessage('skin', (client, skin) => {
        const player = this.playerFor(client);
        if (this.state.phase === 'lobby' && player?.connected && SKINS.includes(skin)) player.skin = skin;
      });
      this.onMessage('games', (client, ids) => {
        if (this.state.phase !== 'lobby' || !this.isHost(client) || !Array.isArray(ids) ||
            !ids.length || ids.length > Object.keys(games).length || new Set(ids).size !== ids.length ||
            !ids.every(id => typeof id === 'string' && Object.hasOwn(games, id))) return;
        this.state.selectedGames.splice(0, this.state.selectedGames.length, ...ids);
      });
      this.onMessage('replay', (client) => this.replay(client));
      this.onMessage('input', (client, input) => this.acceptInput(client, input));
      this.onMessage('action', (client, input) => games[this.state.gameId].act?.(this.state, this.playerFor(client), input));
      this.onMessage('clearInputs', (client) => this.clearInputs(client.userData?.playerId));
      this.onMessage('identify', (client) => this.sendWelcome(client));
      this.onMessage('ping', (client, data) => {
        if (Number.isFinite(data?.sentAt)) client.send('pong', { sentAt: data.sentAt });
      });
      this.setSimulationInterval((deltaTime) => this.simulate(deltaTime), STEP_MS);
      // Colyseus also cleans abandoned seat reservations; this covers creation
      // requests whose browser disappears before it opens the room socket.
      this.clock.setTimeout(() => {
        if (this.state.players.size === 0) this.disconnect();
      }, 20_000);
      log('created', this.roomId);
    }

    onAuth(client, options) {
      validateName(options?.name);
      // maxClients reserves dropped sockets too; the explicit check protects
      // the application invariant during simultaneous matchmaking requests.
      if (this.state.players.size >= MAX_PLAYERS) throw new ServerError(409, 'This party is full, including reserved seats.');
      return true;
    }

    // Colyseus 0.18's default reconnect check replaces an active socket. Our
    // party contract only resumes reserved seats; it never takes over a player
    // in another tab. Both HTTP resume and automatic socket retry use these
    // public Room methods. A refresh retries until the old socket has dropped.
    checkReconnectionToken(token) {
      if (this.clients.some((client) => client.reconnectionToken === token)) {
        throw new ServerError(409, 'This player is still connected. Close the other tab, then retry.');
      }
      return super.checkReconnectionToken(token);
    }

    hasReservedSeat(sessionId, token) {
      if (token && this.clients.some((client) => client.sessionId === sessionId && client.reconnectionToken === token)) return false;
      return super.hasReservedSeat(sessionId, token);
    }

    onJoin(client, options) {
      const id = randomUUID();
      const usedColors = new Set(Array.from(this.state.players.values(), (player) => player.color));
      const color = PLAYER_COLORS.find((entry) => !usedColors.has(entry)) ?? PLAYER_COLORS[0];
      const player = new PlayerState({ id, name: validateName(options?.name), color });
      this.placeInLobby(player);
      client.userData = { playerId: id };
      this.state.players.set(id, player);
      this.inputState.set(id, this.freshInputState());
      this.transferHost();
      this.sendWelcome(client);
      log('joined', this.roomId, this.state.players.size);
    }

    onDrop(client, code) {
      if (code === KICK_CODE) return; // Colyseus calls onLeave when no reservation is made.
      const player = this.playerFor(client);
      if (!player) return;
      player.connected = false;
      this.clearInputs(player.id);
      this.transferHost();
      const reservation = this.allowReconnection(client, reconnectionSeconds);
      this.recoveryReservations.set(player.id, { token: client.reconnectionToken, reservation });
      reservation.catch(() => {});
      log('reserved', this.roomId, this.state.players.size);
    }

    onReconnect(client) {
      const player = this.playerFor(client);
      if (!player) return;
      player.connected = true;
      this.recoveryReservations.delete(player.id);
      this.clearInputs(player.id);
      this.transferHost();
      this.sendWelcome(client);
      log('rejoined', this.roomId, this.state.players.size);
    }

    onLeave(client) {
      const id = client.userData?.playerId;
      this.state.players.delete(id);
      this.inputState.delete(id);
      this.recoveryReservations.delete(id);
      this.transferHost();
      log('left', this.roomId, this.state.players.size);
    }

    onDispose() {
      rooms.delete(this.roomId);
      this.inputState?.clear();
      this.recoveryReservations?.clear();
      log('ended', this.roomId);
    }

    playerFor(client) {
      return this.state.players.get(client.userData?.playerId);
    }

    isHost(client) {
      const player = this.playerFor(client);
      return player?.connected && player.id === this.state.hostId;
    }

    kick(client, id) {
      if (!this.isHost(client) || id === this.state.hostId || !this.state.players.has(id)) return;
      const target = this.clients.find(peer => peer.userData?.playerId === id);
      if (target) this.kickClient(target.sessionId, KICK_CODE, 'Removed by the host');
      else this.recoveryReservations.get(id)?.reservation.reject(false);
    }

    placeInLobby(player) {
      const seat = PLAYER_COLORS.indexOf(player.color);
      player.x = 64 + seat % 4 * 104;
      player.y = 104 + Math.floor(seat / 4) * 112;
    }

    sendWelcome(client) {
      client.send('welcome', { playerId: client.userData.playerId, reconnectionSeconds, instanceId });
    }

    // Authenticated HTTP leave covers a dropped WebSocket while HTTP is still
    // reachable. Credentials stay only in this server-private map and request
    // body. Rejecting the documented Deferred follows normal onLeave cleanup.
    releaseWithCredential(token) {
      for (const client of this.clients) {
        if (credentialMatches(client.reconnectionToken, token)) {
          client.leave(4000);
          return true;
        }
      }
      for (const { token: reservedToken, reservation } of this.recoveryReservations.values()) {
        if (credentialMatches(reservedToken, token)) {
          reservation.reject(false);
          return true;
        }
      }
      return false;
    }

    transferHost() {
      // Joining or recovering never displaces a connected host. A drop/leave
      // transfers to the earliest remaining connected seat, without takeback
      // when the previous host returns (including after a browser refresh).
      if (this.state.players.get(this.state.hostId)?.connected) return;
      this.state.hostId = Array.from(this.state.players.values()).find((player) => player.connected)?.id ?? '';
    }

    freshInputState() {
      return { queue: [], latestSeq: 0, windowStart: Date.now(), received: 0 };
    }

    clearInputs(id) {
      const input = this.inputState.get(id);
      if (!input) return;
      input.queue.length = 0;
      const player = this.state.players.get(id);
      if (player) player.lastInputSeq = input.latestSeq;
    }

    acceptInput(client, data) {
      const player = this.playerFor(client);
      if (!canMoveInParty(this.state.phase, player, this.state.gameId)) return;
      if (!data || !Number.isSafeInteger(data.seq) || data.seq <= 0 ||
          !Number.isFinite(data.x) || !Number.isFinite(data.y) || Math.abs(data.x) > 1 || Math.abs(data.y) > 1) return;
      const input = this.inputState.get(player.id);
      if (data.seq <= input.latestSeq) return;
      const now = Date.now();
      if (now - input.windowStart >= 1000) {
        input.windowStart = now;
        input.received = 0;
      }
      if (++input.received > 90) return;
      input.latestSeq = data.seq;
      if (input.queue.length >= INPUT_QUEUE_LIMIT) input.queue.shift();
      input.queue.push({ ...normalizeInput(data), seq: data.seq, receivedAt: now });
    }

    connectedCount() {
      return Array.from(this.state.players.values()).filter(p => p.connected).length;
    }

    startSession(client) {
      if (!this.isHost(client) || this.state.phase !== 'lobby') return;
      if (this.connectedCount() < 2) {
        client.send('notice', { message: 'At least two connected players are needed to start.' });
        return;
      }
      this.state.sessionRound = 0;
      this.state.sessionLength = 1;
      this.state.sessionResult = '';
      this.state.sessionWinnerIds.clear();
      for (const p of this.state.players.values()) {
        p.sessionPoints = 0;
        this.clearInputs(p.id);
      }
      this.openVote('lengthVote');
    }

    openVote(phase) {
      this.state.phase = phase;
      this.state.phaseEndsAt = Date.now() + voteMs;
      for (const p of this.state.players.values()) p.vote = '';
    }

    vote(client, ballot) {
      const { phase, round, phaseEndsAt } = this.state;
      const p = this.playerFor(client);
      if (!p?.connected || !ballot || ballot.phase !== phase || ballot.round !== round || Date.now() >= phaseEndsAt) return;
      const choices = phase === 'lengthVote' ? SESSION_CHOICES : phase === 'mapVote' ? MAP_CHOICES : [];
      if (choices.includes(ballot.choice)) p.vote = ballot.choice;
    }

    closeVote() {
      const players = this.state.players.values();
      this.nextMap = 'classic';
      if (this.state.phase === 'lengthVote') {
        this.state.sessionLength = Number(winningChoice(players, SESSION_CHOICES, '1'));
      } else {
        this.nextMap = winningChoice(players, MAP_CHOICES, 'classic');
      }
      this.state.phase = 'waiting';
      this.state.phaseEndsAt = 0;
    }

    nextGameId() {
      return this.state.selectedGames[this.state.sessionRound % this.state.selectedGames.length];
    }

    startRound() {
      this.state.gameId = this.nextGameId();
      this.state.sessionRound += 1;
      this.state.round += 1;
      if (this.state.sessionRound === 1) this.state.resultText = '';
      this.state.winnerIds.clear();
      for (const entry of this.state.players.values()) {
        entry.roundPoints = 0;
        this.clearInputs(entry.id);
      }
      this.roundGame = games[this.state.gameId].createRound(this.state, this.nextMap);
      this.state.phase = 'countdown';
      this.state.phaseEndsAt = Date.now() + countdownMs;
      log('countdown', this.roomId, this.state.round);
    }

    replay(client) {
      if (this.playerFor(client)?.id !== this.state.hostId || this.state.phase !== 'results') return;
      this.state.phase = 'lobby';
      this.state.phaseEndsAt = 0;
      this.state.roundElapsedMs = 0;
      prepareMap(this.state);
      this.roundGame = null;
      for (const player of this.state.players.values()) {
        player.alive = false;
        player.participating = false;
        this.placeInLobby(player);
        this.clearInputs(player.id);
      }
    }

    simulate(deltaTime) {
      const started = performance.now();
      // Bound catch-up after a suspended/overloaded process. Each consumed input
      // still represents exactly one fixed simulation step.
      this.accumulator += Math.min(deltaTime, 5 * STEP_MS);
      while (this.accumulator >= STEP_MS) {
        this.accumulator -= STEP_MS;
        this.step();
      }
      this.state.stepMs = Math.round((performance.now() - started) * 100) / 100;
    }

    step() {
      const now = Date.now();
      this.state.serverTime = now;
      this.state.tick += 1;
      if (['lengthVote', 'mapVote'].includes(this.state.phase) && now >= this.state.phaseEndsAt) this.closeVote();
      if (this.state.phase === 'waiting' && this.connectedCount() >= 2) this.startRound();
      if (this.state.phase === 'countdown' && now >= this.state.phaseEndsAt) {
        this.state.phase = 'playing';
        this.state.phaseEndsAt = 0;
        log('playing', this.roomId, this.state.round);
      }
      if (this.state.phase !== 'playing' && this.state.phase !== 'lobby') return;
      const inputs = new Map();
      for (const [id, input] of this.inputState) {
        const player = this.state.players.get(id);
        while (input.queue.length && now - input.queue[0].receivedAt > INPUT_EXPIRY_MS) {
          player.lastInputSeq = input.queue.shift().seq;
        }
        const command = input.queue.shift();
        if (command) {
          player.lastInputSeq = command.seq;
          if (player.connected) inputs.set(id, command);
        }
      }
      if (this.state.phase === 'lobby') {
        for (const [id, input] of inputs) {
          const p = this.state.players.get(id);
          Object.assign(p, movePlayer(p, input, STEP_MS / 1000));
        }
        return;
      }
      const result = games[this.state.gameId].updateRound(this.state, this.roundGame, { dtMs: STEP_MS, inputs });
      if (!result || this.awardedRound === this.state.round) return;
      this.awardedRound = this.state.round;
      this.state.phase = 'results';
      this.state.phaseEndsAt = 0;
      this.state.resultText = result.resultText;
      this.state.winnerIds.clear();
      this.state.winnerIds.push(...result.winnerIds);
      for (const player of this.state.players.values()) {
        player.roundPoints = result.pointsByPlayer[player.id] ?? 0;
        player.score += player.roundPoints;
        player.sessionPoints += player.roundPoints;
        this.clearInputs(player.id);
      }
      if (this.state.sessionRound < this.state.sessionLength) {
        if (games[this.nextGameId()].usesMaps) this.openVote('mapVote');
        else this.state.phase = 'waiting';
      } else {
        const players = [...this.state.players.values()];
        const high = Math.max(0, ...players.map(p => p.sessionPoints));
        const winners = players.filter(p => high > 0 && p.sessionPoints === high);
        this.state.sessionWinnerIds.push(...winners.map(p => p.id));
        const names = winners.map(p => p.name).join(' & ');
        this.state.sessionResult = winners.length
          ? `${names} ${winners.length === 1 ? 'wins' : 'tie for'} the session with ${high} ${high === 1 ? 'point' : 'points'}!`
          : 'Session complete. No points awarded.';
      }
      log('results', this.roomId, this.state.round, result.reason);
    }
  };
}
