import { PartySession, claimBrowserTab } from './session.js';
import { Controls } from './controls.js';
import { MAX_PLAYERS, PLAYER_COLORS } from '../shared/constants.js';
import characterCreditsUrl from './assets/character-credits.csv?url';

const $ = (id) => document.getElementById(id);
$('character-credits').href = characterCreditsUrl;
$('player-count').textContent = `0 / ${MAX_PLAYERS}`;
if (import.meta.env.DEV) {
  document.querySelector('.site-footer').insertAdjacentHTML('beforebegin', '<details id="diagnostics" hidden><summary>Local diagnostics <span id="diagnostic-summary"></span></summary><div class="diagnostic-content"><output id="diagnostic-values"></output><button id="simulate-drop" class="secondary">Test a 3-second connection drop</button><p>Development tools. Scores and floor hazards keep running while disconnected.</p></div></details>');
}
let session, controls, game, loadingGame;
let lastRoster = '';
let clockOffset = 0;
const invitationCode = new URL(location.href).searchParams.get('room')?.toUpperCase() || '';
if (/^[A-Z]{6}$/.test(invitationCode)) $('room-code').value = invitationCode;
try { $('nickname').value = localStorage.getItem('kottabos.nickname') || ''; } catch { /* Optional convenience. */ }

function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function renderStatus(connection, message) {
  $('connection-status').textContent = message;
  $('connection-status').dataset.state = connection;
  const busy = ['joining', 'reconnecting'].includes(connection);
  $('create-party').disabled = busy;
  $('join-party').disabled = busy;
  $('cancel-recovery').hidden = !busy || Boolean(session?.state);
  $('cancel-recovery').textContent = connection === 'joining' ? 'Cancel connecting' : 'Cancel rejoining';
  if (connection !== 'connected') controls?.clear();
  if (session?.state) render(session.state);
}

async function ensureGame() {
  if (game || loadingGame) return;
  loadingGame = import('./game.js').then(({ createGame }) => {
    if (session.state) game = createGame(session, controls);
  }).catch(() => notice('The game renderer could not load. Refresh once; your reserved identity will rejoin automatically.'))
    .finally(() => { loadingGame = null; });
}

function reset() {
  controls?.clear();
  game?.destroy();
  game = null;
  $('home').hidden = false;
  $('party').hidden = true;
  $('results-panel').hidden = true;
  $('leave-button').hidden = true;
  document.body.classList.remove('is-playing');
  lastRoster = '';
}

function renderRoster(state) {
  const players = Object.values(state.players);
  $('party').dataset.phase = state.phase;
  // Do not replace buttons or roster nodes for every movement patch.
  const key = JSON.stringify(players.map(({ id, name, color, connected, score, alive, participating, roundPoints }) =>
    ({ id, name, color, connected, score, alive, participating, roundPoints }))) + state.hostId + state.phase + session.playerId;
  if (key === lastRoster) return;
  lastRoster = key;
  const rows = players.map((player) => {
    const row = document.createElement('li');
    row.className = 'player-row';
    row.dataset.playerId = player.id;
    row.classList.toggle('local-player', player.id === session.playerId);
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.style.setProperty('--player-color', player.color);
    avatar.textContent = String(PLAYER_COLORS.indexOf(player.color) + 1).padStart(2, '0');
    avatar.setAttribute('aria-label', `Player ${Number(avatar.textContent)}`);
    const info = document.createElement('div');
    info.className = 'player-info';
    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player.name + (player.id === session.playerId ? ' (you)' : '');
    const status = document.createElement('div');
    status.className = 'player-state';
    status.textContent = !player.connected ? 'RECONNECTING · SEAT HELD' : state.phase === 'lobby' ? 'IN THE PARTY'
      : !player.participating ? 'SPECTATING · NEXT ROUND' : player.alive ? 'STILL STANDING' : 'ELIMINATED · SPECTATING';
    if (player.id === state.hostId) status.textContent += ' · HOST';
    info.append(name, status);
    const score = document.createElement('div');
    score.className = 'player-score';
    score.textContent = player.score;
    const units = document.createElement('small');
    units.textContent = 'PTS';
    score.append(units);
    row.append(avatar, info, score);
    return row;
  });
  $('players-list').replaceChildren(...rows);
  $('player-count').textContent = `${players.length} / ${MAX_PLAYERS}`;
  const awards = players.filter((player) => player.roundPoints > 0).map((player) => {
    const award = document.createElement('span');
    award.className = 'result-award';
    award.textContent = `${player.name} +${player.roundPoints}`;
    return award;
  });
  $('results-detail').replaceChildren(...(awards.length ? awards : ['No points awarded this round.']));
}

function render(state) {
  $('home').hidden = true;
  $('party').hidden = false;
  $('leave-button').hidden = false;
  document.body.classList.toggle('is-playing', ['countdown', 'playing'].includes(state.phase));
  ensureGame();
  const me = state.players[session.playerId];
  const host = me?.id === state.hostId;
  const online = session.connection === 'connected';
  const players = Object.values(state.players);
  $('party-code').textContent = state.code;
  $('host-label').textContent = `Host: ${state.players[state.hostId]?.name || 'waiting for a player'}`;
  $('invite-link').value = `${location.origin}/?room=${state.code}`;
  $('room-code').value = state.code;
  $('round-label').textContent = `STAY ON THE PLATFORM${state.round ? ` / ROUND ${String(state.round).padStart(2, '0')}` : ''}`;
  $('phase-label').textContent = { lobby: 'The gathering place.', countdown: 'Find your footing.', playing: 'Stay on the Platform', results: 'That was a close one.' }[state.phase] || state.phase;
  $('phase-label').dataset.phase = state.phase;
  $('start-button').hidden = !host || state.phase !== 'lobby';
  const connected = players.filter((player) => player.connected);
  $('start-button').disabled = !online || connected.length < 2;
  $('replay-button').hidden = !host || state.phase !== 'results';
  $('replay-button').disabled = !online;
  $('lobby-hint').textContent = !online ? 'Reconnecting automatically. Your character still faces the falling floor.' : state.phase === 'lobby'
    ? connected.length < 2 ? 'Invite another player to get started.' : host ? 'Your party is here. Start whenever you like.' : 'Your host will start the round.'
    : state.phase === 'results' ? host ? 'Back to the lobby for another round. Scores carry over.' : 'Your host can bring everyone back for another round.'
      : me?.participating && me.alive ? 'Make every tile count.' : 'You’re spectating. You can play in the next round.';
  $('results-panel').hidden = state.phase !== 'results';
  $('result-text').textContent = state.resultText;
  $('player-mode').textContent = me?.participating && !me.alive ? 'SPECTATING' : state.phase === 'playing' && !me?.participating ? 'NEXT ROUND IS YOURS' : 'YOU’VE GOT THIS';
  if (import.meta.env.DEV) $('simulate-drop').disabled = !online;
  renderRoster(state);
  renderClock();
}

function renderClock() {
  const state = session?.state;
  if (!state) return;
  const seconds = Math.max(0, Math.ceil((state.phaseEndsAt - (Date.now() + clockOffset)) / 1000));
  const survivors = Object.values(state.players).filter((player) => player.participating && player.alive).length;
  $('timer-value').textContent = state.phase === 'playing' ? String(survivors).padStart(2, '0')
    : state.phase === 'countdown' ? String(seconds).padStart(2, '0') : '—';
  $('timer-label').textContent = state.phase === 'playing' ? 'STILL STANDING' : state.phase === 'countdown' ? 'STARTING IN' : 'HOST STARTS THE ROUND';
  const me = state.players[session.playerId];
  const banner = $('stage-banner');
  banner.classList.toggle('countdown', state.phase === 'countdown' && session.connection === 'connected');
  banner.hidden = state.phase === 'playing' && me?.alive && session.connection === 'connected';
  banner.firstElementChild.textContent = session.connection !== 'connected' ? 'Reconnecting… your spot is reserved'
    : state.phase === 'lobby' ? 'Host starts the round'
      : state.phase === 'countdown' ? Math.max(1, seconds)
        : state.phase === 'results' ? 'One more round?'
          : me?.participating ? 'You fell! Watch the survivors, then try again.' : 'You’re spectating. Join the next round.';
}

async function join(create) {
  notice('');
  if (!$('nickname').reportValidity()) return;
  const name = $('nickname').value.trim();
  const code = $('room-code').value.trim().toUpperCase();
  if (!name || (!create && !/^[A-Z]{6}$/.test(code))) { notice('Enter a nickname and a six-letter party code to join.'); return; }
  try { localStorage.setItem('kottabos.nickname', name); } catch { /* Optional convenience. */ }
  await session.join(name, create ? '' : code);
}

$('retry-tab').addEventListener('click', () => location.reload());
const tabClaim = await claimBrowserTab();
if (tabClaim === 'claimed') {
  session = new PartySession({
    onState: (state) => {
      clockOffset = state.serverTime - Date.now();
      controls.reconcile();
      game?.capture(state);
      render(state);
    },
    onStatus: renderStatus,
    onNotice: notice,
    onReset: reset,
  });
  controls = new Controls(session, { joystick: $('joystick'), toggle: $('touch-toggle'), panel: $('touch-controls'), hint: $('touch-hint') });
  $('home').hidden = false;
  session.status('idle', 'Ready when you are');
  $('create-party').addEventListener('click', () => join(true));
  $('join-form').addEventListener('submit', (event) => { event.preventDefault(); join(false); });
  $('start-button').addEventListener('click', () => { notice(''); session.send('start'); });
  $('replay-button').addEventListener('click', () => { notice(''); session.send('replay'); });
  $('leave-button').addEventListener('click', () => session.leave());
  $('cancel-recovery').addEventListener('click', () => session.leave());
  if (import.meta.env.DEV) $('simulate-drop').addEventListener('click', () => session.simulateDrop());
  $('copy-invite').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('invite-link').value);
      $('invitation-feedback').textContent = 'Invitation copied. Send it to your friends.';
    } catch {
      $('invite-link').select();
      $('invitation-feedback').textContent = 'Select and copy the invitation link below.';
    }
  });
  setInterval(() => {
    renderClock();
    if (!import.meta.env.DEV) return;
    $('diagnostic-summary').textContent = `${game?.fps || '—'} FPS / ${session.latency} ms RTT`;
    $('diagnostic-values').textContent = `Connection: ${session.connection} · reservation ${session.reconnectionSeconds}s\nSimulation: 30 Hz · updates: 20 Hz · server step ${session.state?.stepMs ?? 0} ms\nPending inputs: ${controls.pending.length} · last correction: ${controls.correction.toFixed(1)} px\nRoom listeners: ${session.listenerCount} · Phaser scenes: ${game?.sceneCount || 0}`;
  }, 100);
  if (import.meta.env.DEV) {
    $('diagnostics').hidden = false;
    Object.defineProperty(window, '__partyDebug', { get: () => ({
      playerId: session.playerId, roomId: session.room?.roomId || session.saved?.roomId || '',
      phase: session.state?.phase, round: session.state?.round, players: Object.values(session.state?.players || {}),
      tiles: session.state?.tiles || [], tileGoneAtMs: session.state?.tileGoneAtMs || [],
      roundElapsedMs: session.state?.roundElapsedMs || 0, connection: session.connection,
      pendingInputs: controls.pending.length, listenerCount: session.listenerCount, sceneCount: game?.sceneCount || 0,
      renderedPositions: game?.renderedPositions || {}, fps: game?.fps || 0, latency: session.latency,
      renderedCharacters: game?.renderedCharacters || {},
      serverStepMs: session.state?.stepMs || 0,
    }) });
  }
  if (session.saved) await session.recover();
} else {
  $('tab-blocked').hidden = false;
  if (tabClaim === 'unsupported') {
    $('tab-blocked-title').textContent = 'A supported browser is needed.';
    $('tab-blocked-message').textContent = !window.isSecureContext
      ? 'Open the HTTPS invitation link to play. Browser identity protection is unavailable on an insecure connection, including an ordinary HTTP address on your local network.'
      : 'This browser could not protect your player identity between tabs. Open the invitation link in an updated Chrome, Edge, or Safari browser with Web Locks available.';
    $('connection-status').textContent = !window.isSecureContext ? 'Secure connection required' : 'Browser capability unavailable';
    $('retry-tab').textContent = 'Check again';
  } else $('connection-status').textContent = 'Another tab is active';
}
