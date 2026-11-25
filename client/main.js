import { PartySession, claimBrowserTab } from './session.js';
import { Controls } from './controls.js';
import { MINIGAMES, MAP_CHOICES, SESSION_CHOICES } from '../shared/party.js';
import { inArcade, GAME_HELP } from '../shared/arcade.js';
import { setupMusic } from './music.js';
import { inRopeArena, STRIKES_OUT } from '../shared/rope.js';
import { MAX_PLAYERS, PLAYER_COLORS } from '../shared/constants.js';
import characterCreditsUrl from './assets/character-credits.csv?url';

const $ = (id) => document.getElementById(id);
const music = setupMusic($('party-audio'), $('music-mute'), $('music-volume'), $('music-status'));
const mapLabels = { small: 'Small · 25 tiles', large: 'Large · 98 tiles', shaped: 'Random shape' };
$('character-credits').href = characterCreditsUrl;
$('player-count').textContent = `0 / ${MAX_PLAYERS}`;
if (import.meta.env.DEV) {
  document.querySelector('.site-footer').insertAdjacentHTML('beforebegin', '<details id="diagnostics" hidden><summary>Local diagnostics <span id="diagnostic-summary"></span></summary><div class="diagnostic-content"><output id="diagnostic-values"></output><button id="simulate-drop" class="secondary">Test a 3-second connection drop</button><p>Development tools. Scores and floor hazards keep running while disconnected.</p></div></details>');
}
let session, controls, game, loadingGame;
let lastRoster = '';
let pendingGames = null;
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
  const loadingRoom = session.room;
  loadingGame = import('./game.js').then(({ createGame }) => {
    if (session.state) game = createGame(session, controls);
  }).catch(() => {
    // A late import failure must not replace a leave, ended-session or recovery notice.
    if (session.room === loadingRoom && session.state && session.connection === 'connected') {
      notice('The game renderer could not load. Refresh once; your reserved identity will rejoin automatically.');
    }
  })
    .finally(() => { loadingGame = null; });
}

function reset() {
  pendingGames = null;
  music('');
  $('manage-panel').hidePopover();
  $('music-panel').hidePopover();
  $('music-button').hidden = true;
  $('manage-party').hidden = true;
  $('skin-choice').removeAttribute('data-locked');
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
  const key = JSON.stringify(players.map(({ id, name, color, connected, score, alive, participating, roundPoints, sessionPoints, ropeDings, hits, collected }) =>
    [id, name, color, connected, score, alive, participating, roundPoints, sessionPoints, ropeDings, hits, collected])) + state.gameId + state.hostId + state.phase + session.playerId;
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
    status.textContent = !player.connected ? 'RECONNECTING · SEAT HELD' : ['lobby', 'lengthVote'].includes(state.phase) ? 'IN THE PARTY'
      : !player.participating ? 'SPECTATING · NEXT ROUND' : player.alive ? 'STILL STANDING' : 'ELIMINATED · SPECTATING';
    if (inRopeArena(state) && player.connected && player.participating) {
      status.textContent = player.alive ? `JUMPING · ${player.ropeDings}/${STRIKES_OUT} DINGS` : 'AT THE ROPE HANDLE';
    }
    if (inArcade(state) && player.connected && player.participating) {
      status.textContent = player.alive ? state.gameId === 'maze' ? `${player.collected} MUNCH PTS · ${player.hits}/3 HITS`
        : state.gameId === 'runner' ? `RUNNING · ${player.hits}/3 DINGS` : 'IN THE GAME'
        : ({ trails: 'ERASING TRAILS', runner: 'AIMING A RETICLE', bombs: 'DROPPING RANDOM BOMBS' }[state.gameId] || 'ELIMINATED · SPECTATING');
    }
    if (player.id === state.hostId) status.textContent += ' · HOST';
    if (state.sessionRound && state.phase !== 'lobby') status.textContent += ` · ${player.sessionPoints} SESSION PTS`;
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
  $('kick-list').replaceChildren(...players.filter(p => p.id !== session.playerId).map(p => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = p.name + (p.connected ? '' : ' (reserved)');
    const kick = document.createElement('button');
    kick.className = 'secondary';
    kick.textContent = 'Kick';
    kick.setAttribute('aria-label', `Kick ${p.name}`);
    kick.onclick = () => session.send('kick', p.id);
    row.append(name, kick);
    return row;
  }));
  $('player-count').textContent = `${players.length} / ${MAX_PLAYERS}`;
  const awards = players.filter((player) => player.roundPoints > 0).map((player) => {
    const award = document.createElement('span');
    award.className = 'result-award';
    award.textContent = `${player.name} +${player.roundPoints}`;
    return award;
  });
  $('results-detail').replaceChildren(...(awards.length ? awards : ['No points awarded this round.']));
}

function renderOptions(state, me, host, online) {
  const lobby = state.phase === 'lobby';
  // Keep a host's click visible while its ordered server acknowledgement is
  // in flight. Unrelated 20 Hz patches must not undo it between pointerup and
  // the reply, or a quick second selection can accidentally drop the first.
  if (pendingGames && (!lobby || !host || !online || pendingGames.code !== state.code ||
      performance.now() >= pendingGames.expiresAt ||
      JSON.stringify(pendingGames.ids) === JSON.stringify(state.selectedGames))) pendingGames = null;
  const selectedGames = pendingGames?.ids || state.selectedGames;
  $('lobby-settings').hidden = !lobby;
  if (!lobby) $('skin-choice').removeAttribute('data-locked');
  if (lobby && me && $('skin-choice').dataset.locked !== me.skin) {
    $('skin-choice').value = me.skin;
    $('skin-choice').dataset.locked = me.skin;
  }
  $('skin-choice').disabled = !online;
  const locked = $('skin-choice').value === me?.skin;
  $('lock-skin').disabled = locked || !online;
  $('lock-skin').textContent = locked ? 'Locked in' : 'Lock in';
  $('game-choices').hidden = !host;
  for (const option of $('game-choices').querySelectorAll('input')) {
    option.checked = selectedGames.includes(option.value);
    option.disabled = !online || (option.checked && selectedGames.length === 1);
  }
  $('manage-party').hidden = !host;
  $('manage-party').disabled = !online;
  if (!online || !host) $('manage-panel').hidePopover();
  const vote = state.phase === 'lengthVote' || state.phase === 'mapVote';
  const openingVote = vote && $('vote-panel').hidden;
  $('vote-panel').hidden = !vote;
  if (!vote) return;
  const lengthVote = state.phase === 'lengthVote';
  const choices = lengthVote ? SESSION_CHOICES : MAP_CHOICES;
  $('vote-title').textContent = lengthVote ? 'How many rounds?' : 'Pick the next map';
  $('vote-hint').textContent = lengthVote ? 'Five seconds to vote. No votes starts three rounds.'
    : state.resultText + ' · No votes keeps the classic board.';
  if ($('vote-options').dataset.phase !== state.phase) {
    $('vote-options').dataset.phase = state.phase;
    $('vote-options').replaceChildren(...choices.map(choice => {
      const button = document.createElement('button');
      button.className = 'secondary';
      button.dataset.choice = choice;
      button.onclick = () => session.send('vote', { phase: session.state.phase, round: session.state.round, choice });
      return button;
    }));
  }
  for (const button of $('vote-options').children) {
    const choice = button.dataset.choice;
    const count = Object.values(state.players).filter(p => p.vote === choice).length;
    const label = lengthVote ? choice + (choice === '1' ? ' round' : ' rounds') : mapLabels[choice];
    const text = `${label} (${count})`;
    if (button.textContent !== text) button.textContent = text;
    button.setAttribute('aria-pressed', String(me?.vote === choice));
    button.disabled = !online;
  }
  if (openingVote) $('vote-panel').scrollIntoView({ block: 'nearest' });
}

function renderRope(state, me, online) {
  const rope = inRopeArena(state);
  const arcade = inArcade(state);
  $('duck-action').hidden = true;
  $('arcade-guide').hidden = !arcade;
  if (arcade) { renderArcade(state, me, online); return; }
  $('party').dataset.game = rope ? 'rope' : 'platform';
  $('platform-guide').hidden = rope;
  $('rope-guide').hidden = !rope && !(state.phase === 'lobby' && state.selectedGames.includes('rope'));
  $('rope-controls').hidden = !rope || !['countdown', 'playing'].includes(state.phase);
  $('rope-hud').hidden = !rope;
  $('game-container').setAttribute('aria-label', rope ? 'Jump Rope court. Press Space or tap to jump or pull.'
    : 'Game arena. Move with the touch joystick, W A S D, or arrow keys.');
  if (!rope) return;
  const pulling = me?.participating && !me.alive;
  const pulled = pulling && me.pulledSwing === state.ropeSwing;
  const button = $('rope-action');
  button.dataset.action = pulling ? 'pull' : 'jump';
  button.textContent = pulled ? 'Pulled!' : pulling ? 'Pull' : 'Jump';
  button.disabled = !online || !me?.participating || state.phase !== 'playing' || pulled;
  $('rope-hint').textContent = !me?.participating ? 'You join on the next round.'
    : pulling ? 'Space or tap once per swing. Every pull adds speed.'
    : 'Space or tap the court just before the rope reaches your feet.';
  $('rope-hud').textContent = [`Swing ${state.ropeSwing}`, me?.participating ? `${me.ropeDings}/${STRIKES_OUT} dings` : 'Spectating',
    `${state.ropePulls} ${state.ropePulls === 1 ? 'pull' : 'pulls'}`].join(' · ');
}

function renderArcade(state, me, online) {
  const id = state.gameId;
  $('party').dataset.game = id;
  $('platform-guide').hidden = true;
  $('rope-guide').hidden = true;
  $('arcade-guide-title').textContent = MINIGAMES[id];
  $('arcade-guide-text').textContent = GAME_HELP[id];
  $('game-container').setAttribute('aria-label', `${MINIGAMES[id]}. ${GAME_HELP[id]}`);
  const active = ['playing', 'countdown'].includes(state.phase);
  const hasAction = id !== 'maze' && (id !== 'trails' || me?.participating && !me.alive);
  $('rope-controls').hidden = !active || !hasAction;
  $('duck-action').hidden = id !== 'runner' || !me?.alive;
  $('duck-action').disabled = !online || !me?.participating || state.phase !== 'playing';
  const labels = { windup: state.gameStage === 'winding' ? 'Wind!' : 'Racing…', trails: 'Erase',
    runner: me?.alive ? 'Jump' : 'Stun', bombs: me?.alive ? 'Bomb' : 'Random bomb' };
  const button = $('rope-action');
  button.textContent = labels[id] || '';
  button.dataset.action = id;
  button.disabled = !online || !me?.participating || state.phase !== 'playing' || id === 'windup' && state.gameStage !== 'winding';
  $('rope-hint').textContent = !me?.participating ? 'You join on the next round.'
    : ({ windup: 'Tap repeatedly. Space works too.', trails: 'Move your eraser. Tap to clear trails.',
      runner: me.alive ? 'Orange: jump. Purple: duck.' : 'Aim with the joystick or arrows. Tap Stun.',
      bombs: me.alive ? 'Drop a bomb, then move away!' : 'Tap for a random bomb. 1s cooldown.' })[id];
  $('rope-hud').hidden = false;
  $('rope-hud').textContent = !me?.participating ? 'Spectating' : id === 'windup' ? `${me.charge} winds · ${me.distance} cm`
    : id === 'maze' ? `${me.collected} munch points · ${me.hits}/3 hits`
      : id === 'runner' ? me.alive ? `${me.hits}/3 dings` : 'Aim at a runner · Stun every 1.8s'
        : id === 'bombs' ? me.alive ? `Range ${me.power} · ${me.capacity} bomb capacity` : 'Random bomb · 1 second cooldown'
          : me.alive ? 'Steer · Avoid trails and edges' : 'Move your eraser · Erase every 0.35s';
}

function render(state) {
  $('home').hidden = true;
  $('party').hidden = false;
  $('leave-button').hidden = false;
  $('music-button').hidden = false;
  music(state.phase);
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
  renderOptions(state, me, host, online);
  renderRope(state, me, online);
  const active = state.sessionRound && state.phase !== 'lobby';
  $('round-label').textContent = active ? `Round ${state.sessionRound} of ${state.sessionLength} · ${state.mapName}` : 'Party lobby';
  $('phase-label').textContent = { lobby: 'The gathering place.', lengthVote: 'Session vote', mapVote: 'Map vote',
    waiting: 'Waiting for players', countdown: MINIGAMES[state.gameId], playing: MINIGAMES[state.gameId], results: 'Session results' }[state.phase];
  $('phase-label').dataset.phase = state.phase;
  $('start-button').hidden = !host || state.phase !== 'lobby';
  const connected = players.filter((player) => player.connected);
  $('start-button').disabled = !online || connected.length < 2;
  $('replay-button').hidden = !host || state.phase !== 'results';
  $('replay-button').disabled = !online;
  $('lobby-hint').textContent = !online ? 'Reconnecting automatically. The round keeps running.' : state.phase === 'lobby'
    ? connected.length < 2 ? 'Explore the lobby and invite another player.' : host ? 'Begin the session to open the round vote.' : 'Explore the lobby while the host gets started.'
    : state.phase === 'results' ? 'Return to the lobby for another session. Party scores carry over.'
      : state.phase === 'waiting' ? 'The session resumes when two players are connected.'
      : ['lengthVote', 'mapVote'].includes(state.phase) ? 'Everyone can vote. Tied votes are decided at random.'
      : inArcade(state) ? (state.phase === 'countdown' && state.resultText ? state.resultText : GAME_HELP[state.gameId])
      : inRopeArena(state) ? (state.phase === 'countdown' && state.resultText ? state.resultText : $('rope-hint').textContent)
      : me?.participating && me.alive ? 'Make every tile count.' : 'You’re spectating. You can play in the next round.';
  $('results-panel').hidden = state.phase !== 'results';
  $('result-text').textContent = state.resultText;
  $('session-result').textContent = state.sessionResult;
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
  const timed = inArcade(state) && state.phase === 'playing';
  $('timer-value').textContent = timed ? String(Math.max(0, Math.ceil((state.stageEndsMs - state.roundElapsedMs) / 1000))) : state.phase === 'playing' ? String(survivors).padStart(2, '0')
    : state.phaseEndsAt ? String(seconds).padStart(2, '0') : '—';
  $('timer-label').textContent = timed ? state.gameStage === 'winding' ? 'WINDING' : 'SECONDS LEFT' : state.phase === 'playing' ? 'STILL STANDING' : state.phase === 'countdown' ? 'STARTING IN'
    : state.phaseEndsAt ? 'VOTE CLOSES IN' : state.phase === 'lobby' ? 'WAITING FOR HOST' : '';
  const me = state.players[session.playerId];
  const banner = $('stage-banner');
  banner.classList.toggle('countdown', state.phase === 'countdown' && session.connection === 'connected');
  banner.hidden = session.connection === 'connected' && (['lobby', 'lengthVote', 'mapVote', 'results'].includes(state.phase) ||
    state.phase === 'playing' && (me?.alive || (inRopeArena(state) || inArcade(state) && ['trails', 'runner', 'bombs'].includes(state.gameId)) && me?.participating));
  banner.firstElementChild.textContent = session.connection !== 'connected' ? 'Reconnecting… your spot is reserved'
    : state.phase === 'waiting' ? 'Waiting for two connected players'
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
  controls = new Controls(session, { joystick: $('joystick'), toggle: $('touch-toggle'), panel: $('touch-controls'), hint: $('touch-hint'),
    arena: $('game-container'), actionButton: $('rope-action'), secondaryButton: $('duck-action') });
  $('skin-choice').onchange = () => render(session.state);
  $('lock-skin').onclick = () => session.send('skin', $('skin-choice').value);
  for (const [id, title] of Object.entries(MINIGAMES)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = id;
    input.onchange = () => {
      const ids = [...$('game-choices').querySelectorAll('input:checked')].map(el => el.value);
      if (ids.length && session.send('games', ids)) pendingGames = { ids, code: session.state.code, expiresAt: performance.now() + 3000 };
      render(session.state);
    };
    label.append(input, title);
    $('game-choices').append(label);
  }
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
      serverStepMs: session.state?.stepMs || 0, gameId: session.state?.gameId,
      cells: session.state?.cells || [], entities: session.state?.entities || [], gameStage: session.state?.gameStage,
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
