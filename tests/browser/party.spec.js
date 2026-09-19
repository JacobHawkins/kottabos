import { chromium, expect, test as base } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// These launch different installed browser applications, not two Chromium tabs.
// Override a channel only when recording the resulting limitation in test reports.
const channels = [process.env.TEST_HOST_BROWSER || 'chrome', process.env.TEST_GUEST_BROWSER || 'msedge'];

const test = base.extend({
  partyBrowsers: async ({ baseURL }, use, testInfo) => {
    const browsers = [];
    const pages = [];
    const errors = [];
    try {
      for (const channel of channels) {
        const browser = await chromium.launch({ channel });
        browsers.push(browser);
        testInfo.annotations.push({ type: 'browser', description: `${channel} ${browser.version()}` });
      }
      async function newPlayer(browserIndex = 0, context) {
        const playerContext = context || await browsers[browserIndex].newContext({ viewport: { width: 1360, height: 1000 } });
        const page = await playerContext.newPage();
        page.on('pageerror', error => errors.push(error.message));
        pages.push(page);
        return page;
      }
      const host = await newPlayer(0);
      const guest = await newPlayer(1);
      await use({ host, guest, newPlayer, baseURL });
      expect(errors, 'No uncaught browser JavaScript errors').toEqual([]);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        for (const [index, page] of pages.entries()) {
          if (!page.isClosed()) {
            await testInfo.attach(`browser-${index}`, { body: await page.screenshot({ fullPage: true }).catch(() => Buffer.from('')), contentType: 'image/png' });
          }
        }
      }
      for (const browser of browsers) await browser.close();
    }
  },
});

async function snapshot(page) {
  return page.evaluate(() => window.__partyDebug);
}

async function connected(page, expectedId) {
  await expect.poll(async () => {
    const state = await snapshot(page);
    const self = state?.players?.find(player => player.id === state.playerId);
    return Boolean(state?.connection === 'connected' && self?.connected && (!expectedId || state.playerId === expectedId));
  }, { message: 'Authoritative state contains the connected player', timeout: 12_000 }).toBe(true);
  return snapshot(page);
}

async function createParty(page, baseURL, name = 'Athena') {
  await page.goto(baseURL);
  await page.locator('#nickname').fill(name);
  await page.locator('#create-party').click();
  await connected(page);
  return (await page.locator('#party-code').innerText()).trim();
}

async function joinParty(page, baseURL, code, name = 'Hermes', invitation = false) {
  await page.goto(invitation ? `${baseURL}/?room=${encodeURIComponent(code)}` : baseURL);
  await page.locator('#nickname').fill(name);
  if (!invitation) await page.locator('#room-code').fill(code);
  else await expect(page.locator('#room-code')).toHaveValue(code);
  await page.locator('#join-party').click();
  return connected(page);
}

async function countPlayers(page, count) {
  await expect.poll(async () => (await snapshot(page))?.players?.length).toBe(count);
  await expect(page.locator('#players-list [data-player-id]')).toHaveCount(count);
}

async function simulateDrop(page) {
  if (!await page.locator('#simulate-drop').isVisible()) await page.locator('#diagnostics summary').click();
  await page.locator('#simulate-drop').click();
}

async function readyAndStart(host, others) {
  for (const page of [host, ...others]) await page.locator('#ready-button').click();
  await expect(host.locator('#start-button')).toBeEnabled();
  await host.locator('#start-button').click();
  for (const page of [host, ...others]) {
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('playing');
    await expect(page.locator('#game-container canvas')).toBeVisible();
  }
}

async function walkTo(page, target) {
  await page.locator('#game-container canvas').click({ position: { x: 30, y: 30 } });
  const id = (await snapshot(page)).playerId;
  const position = () => snapshot(page).then(state => state.players.find(player => player.id === id));
  // Move in two short orthogonal legs, using actual keyboard events throughout.
  for (const axis of ['x', 'y']) {
    const before = await position();
    if (!before.alive) break;
    const direction = Math.sign(target[axis] - before[axis]);
    if (Math.abs(target[axis] - before[axis]) < 8) continue;
    const key = axis === 'x' ? (direction > 0 ? 'ArrowRight' : 'ArrowLeft') : (direction > 0 ? 'ArrowDown' : 'ArrowUp');
    await page.keyboard.down(key);
    try {
      await expect.poll(async () => {
        const current = await position();
        return current.alive ? direction * (target[axis] - current[axis]) : 0;
      }, { intervals: [30], timeout: 4000 }).toBeLessThan(8);
    } finally {
      await page.keyboard.up(key);
    }
  }
}

function followVisibleSafeFloor(page) {
  let stopping = false;
  let failure;
  const held = new Set();
  const finished = (async () => {
    while (!stopping && !page.isClosed()) {
      const state = await snapshot(page);
      const player = state?.players.find((entry) => entry.id === state.playerId);
      if (state?.phase !== 'playing' || !player?.alive) break;
      const tile = Math.floor(player.y / 64) * 7 + Math.floor(player.x / 64);
      const previous = new Map([[tile, null]]);
      const queue = [tile];
      let target = tile;
      // Use only synchronized, currently visible tile colors, never the
      // server-private future schedule or a fixed presumed final island.
      for (const current of queue) {
        if (state.tiles[current] === 0) { target = current; break; }
        const column = current % 7;
        const row = Math.floor(current / 7);
        const neighbors = [column > 0 ? current - 1 : -1, column < 6 ? current + 1 : -1,
          row > 0 ? current - 7 : -1, row < 6 ? current + 7 : -1];
        for (const next of neighbors) {
          if (next >= 0 && state.tiles[next] !== 2 && !previous.has(next)) {
            previous.set(next, current);
            queue.push(next);
          }
        }
      }
      while (previous.get(target) !== null && previous.get(target) !== tile) target = previous.get(target);
      const dx = target % 7 * 64 + 32 - player.x;
      const dy = Math.floor(target / 7) * 64 + 32 - player.y;
      const wanted = new Set();
      if (Math.abs(dx) > 9) wanted.add(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
      if (Math.abs(dy) > 9) wanted.add(dy > 0 ? 'ArrowDown' : 'ArrowUp');
      for (const key of held) if (!wanted.has(key)) { await page.keyboard.up(key); held.delete(key); }
      for (const key of wanted) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
      await page.waitForTimeout(40);
    }
  })().catch((error) => { failure = error; }).finally(async () => {
    if (!page.isClosed()) for (const key of held) await page.keyboard.up(key).catch(() => {});
  });
  return async () => { stopping = true; await finished; if (failure) throw failure; };
}

test('Chrome + Edge lobby, repeated refresh, dropped connection, close/reopen, duplicate tab, and explicit host leave', async ({ partyBrowsers }, testInfo) => {
  const { host, guest, newPlayer, baseURL } = partyBrowsers;
  await host.goto(baseURL);
  await expect(host.locator('#create-party')).toBeVisible();
  await host.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  const code = await createParty(host, baseURL);
  expect(code).toMatch(/^[A-Z0-9]{4,8}$/);
  await joinParty(guest, baseURL, code, 'Hermes', true);
  await countPlayers(host, 2);
  await expect.poll(async () => (await snapshot(host)).sceneCount).toBe(1);
  await expect.poll(async () => (await snapshot(guest)).sceneCount).toBe(1);
  await host.screenshot({ path: testInfo.outputPath('lobby.png'), fullPage: true });
  const initial = await snapshot(host);
  const guestInitial = await snapshot(guest);
  const guestId = guestInitial.playerId;
  expect(initial.playerId).not.toBe(guestId);
  expect(new URL(guest.url()).searchParams.get('room')).toBe(code);
  expect(new URL(guest.url()).search).not.toMatch(/token|credential|session/i);
  expect(await guest.locator('#start-button').isVisible() && await guest.locator('#start-button').isEnabled()).toBe(false);

  await test.step('Repeated refresh retains identity, one scene, and stable listeners', async () => {
    for (let refresh = 0; refresh < 3; refresh += 1) {
      await guest.reload();
      const state = await connected(guest, guestId);
      await countPlayers(host, 2);
      expect(state.listenerCount).toBe(guestInitial.listenerCount);
      expect(state.sceneCount).toBe(guestInitial.sceneCount);
      expect(state.players.find(player => player.id === guestId).score).toBe(0);
    }
  });

  await test.step('Another tab in the same profile cannot claim the identity', async () => {
    const duplicate = await newPlayer(0, host.context());
    await duplicate.goto(baseURL);
    await expect(duplicate.locator('#connection-status')).toContainText(/another tab|active tab|already open/i);
    await countPlayers(guest, 2);
    await duplicate.close();
    await connected(host, initial.playerId);
  });

  await test.step('A short interrupted transport recovers automatically', async () => {
    await simulateDrop(guest);
    await expect(guest.locator('#connection-status')).toContainText(/reconnect|recover|offline/i);
    await expect.poll(async () => (await snapshot(host)).players.find(player => player.id === guestId)?.connected).toBe(false);
    await connected(guest, guestId);
    await countPlayers(host, 2);
  });

  await test.step('Closing and reopening a tab uses the saved rotated credentials', async () => {
    const guestContext = guest.context();
    await guest.close();
    const reopened = await newPlayer(1, guestContext);
    await reopened.goto(baseURL);
    await connected(reopened, guestId);
    await countPlayers(host, 2);

    await host.locator('#leave-button').click();
    await expect(host.locator('#create-party')).toBeVisible();
    await countPlayers(reopened, 1);
    await expect(reopened.locator('#start-button')).toBeVisible();
    await host.reload();
    await expect(host.locator('#create-party')).toBeVisible();
    await countPlayers(reopened, 1);

    await host.locator('#nickname').fill('Athena Again');
    await host.locator('#room-code').fill(code);
    await host.locator('#join-party').click();
    const fresh = await connected(host);
    expect(fresh.playerId).not.toBe(initial.playerId);
    await countPlayers(reopened, 2);
    await host.locator('#ready-button').click();
    await reopened.locator('#ready-button').click();
    await expect(reopened.locator('#start-button')).toBeEnabled();
    expect(await host.locator('#start-button').isVisible() && await host.locator('#start-button').isEnabled()).toBe(false);
  });
});

test('Authoritative round, responsive keyboard movement, eliminated refresh, spectator join, shared results and replay', async ({ partyBrowsers }, testInfo) => {
  const { host, guest, newPlayer, baseURL } = partyBrowsers;
  const code = await createParty(host, baseURL);
  await joinParty(guest, baseURL, code);
  const third = await newPlayer(0);
  await joinParty(third, baseURL, code, 'Dionysus');
  await countPlayers(host, 3);
  await readyAndStart(host, [guest, third]);
  const hostId = (await snapshot(host)).playerId;
  const guestId = (await snapshot(guest)).playerId;

  await test.step('Refresh during play restores the same participant and current round', async () => {
    const before = await snapshot(guest);
    await guest.reload();
    const after = await connected(guest, guestId);
    expect(after.round).toBe(before.round);
    expect(after.players.find(player => player.id === guestId).participating).toBe(true);
    await countPlayers(host, 3);
  });

  await test.step('A playing disconnect clears held inputs and restores the same character', async () => {
    await guest.locator('#game-container canvas').click({ position: { x: 30, y: 30 } });
    await guest.keyboard.down('ArrowLeft');
    await simulateDrop(guest);
    await expect(guest.locator('#connection-status')).toContainText(/reconnect|recover|offline/i);
    await expect.poll(async () => (await snapshot(host)).players.find(player => player.id === guestId).connected).toBe(false);
    const disconnectedPosition = (await snapshot(host)).players.find(player => player.id === guestId);
    await host.waitForTimeout(700);
    const stillDisconnected = (await snapshot(host)).players.find(player => player.id === guestId);
    expect(stillDisconnected.x).toBe(disconnectedPosition.x);
    expect(stillDisconnected.y).toBe(disconnectedPosition.y);
    await guest.keyboard.up('ArrowLeft');
    await connected(guest, guestId);
    await countPlayers(host, 3);
  });

  const stopSurvivors = [followVisibleSafeFloor(guest), followVisibleSafeFloor(third)];
  await test.step('Keyboard input moves the authoritative character and is visible remotely', async () => {
    // Keep two survivors responding to visible warnings while the eliminated
    // player refreshes and a spectator joins; the final destination now varies.
    const before = (await snapshot(host)).players.find(player => player.id === hostId);
    await host.locator('#game-container canvas').click({ position: { x: 30, y: 30 } });
    await host.keyboard.down('ArrowLeft');
    await expect.poll(async () => (await snapshot(host)).players.find(player => player.id === hostId).x).toBeLessThan(before.x - 15);
    await expect.poll(async () => (await snapshot(guest)).players.find(player => player.id === hostId).x).toBeLessThan(before.x - 15);
    await host.keyboard.up('ArrowLeft');
    await expect.poll(async () => (await snapshot(host)).tiles.includes(2)).toBe(true);
    const visible = await snapshot(host);
    const removed = visible.tiles.findIndex((tile) => tile === 2);
    expect(removed, 'at least one visible floor tile has already disappeared').toBeGreaterThanOrEqual(0);
    await walkTo(host, { x: removed % 7 * 64 + 32, y: Math.floor(removed / 7) * 64 + 32 });
    await expect.poll(async () => (await snapshot(host)).players.find(player => player.id === hostId).alive, { timeout: 15_000 }).toBe(false);
  });

  await test.step('An eliminated player remains eliminated after recovery', async () => {
    const before = await snapshot(host);
    await host.reload();
    const after = await connected(host, hostId);
    expect(after.round).toBe(before.round);
    expect(after.players.find(player => player.id === hostId).alive).toBe(false);
    expect(after.players.find(player => player.id === hostId).score).toBe(before.players.find(player => player.id === hostId).score);
    await countPlayers(guest, 3);
    await host.screenshot({ path: testInfo.outputPath('playing-eliminated.png'), fullPage: true });
  });

  const spectator = await newPlayer(1);
  await joinParty(spectator, baseURL, code, 'Iris');
  const spectatorState = await snapshot(spectator);
  expect(spectatorState.players.find(player => player.id === spectatorState.playerId).participating).toBe(false);
  expect(spectatorState.players.find(player => player.id === spectatorState.playerId).alive).toBe(false);

  await test.step('All clients receive the same result and cumulative scores', async () => {
    await expect.poll(async () => (await snapshot(host)).phase, { timeout: 25_000 }).toBe('results');
    await expect.poll(async () => (await snapshot(guest)).phase).toBe('results');
    await Promise.all(stopSurvivors.map((stop) => stop()));
    expect((await snapshot(guest)).players.find((player) => player.id === guestId).alive).toBe(true);
    const resultText = await host.locator('#result-text').innerText();
    expect(resultText.length).toBeGreaterThan(5);
    await expect(guest.locator('#result-text')).toHaveText(resultText);
    const scoreState = page => snapshot(page).then(state => state.players.map(({ id, score }) => ({ id, score })).sort((a, b) => a.id.localeCompare(b.id)));
    await expect.poll(() => scoreState(guest)).toEqual(await scoreState(host));
    expect((await scoreState(host)).some(player => player.score > 0)).toBe(true);
    await expect(third.locator('#result-text')).toHaveText(resultText);
    await host.screenshot({ path: testInfo.outputPath('results.png'), fullPage: true });
    const diagnostics = await Promise.all([host, guest].map(async page => {
      const { fps, latency, serverStepMs, pendingInputs, listenerCount, sceneCount } = await snapshot(page);
      return { fps, latency, serverStepMs, pendingInputs, listenerCount, sceneCount };
    }));
    const diagnosticsPath = testInfo.outputPath('local-diagnostics.json');
    await writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2));
    await testInfo.attach('local-diagnostics', { path: diagnosticsPath, contentType: 'application/json' });
  });

  await test.step('Refresh also preserves an earned score and the completed result', async () => {
    const before = await snapshot(guest);
    const score = before.players.find(player => player.id === guestId).score;
    expect(score).toBeGreaterThan(0);
    await guest.reload();
    const after = await connected(guest, guestId);
    expect(after.phase).toBe('results');
    expect(after.players.find(player => player.id === guestId).score).toBe(score);
    expect(after.listenerCount).toBe(before.listenerCount);
    await countPlayers(host, 4);
  });

  await test.step('Host replay returns everyone to the lobby and allows the next round', async () => {
    const priorRound = (await snapshot(host)).round;
    const replayHost = await host.locator('#replay-button').isVisible() ? host : guest;
    await replayHost.locator('#replay-button').click();
    await expect.poll(async () => (await snapshot(guest)).phase).toBe('lobby');
    await readyAndStart(replayHost, [host, guest, third, spectator].filter(page => page !== replayHost));
    const next = await snapshot(host);
    expect(next.round).toBe(priorRound + 1);
    expect(next.players.every(player => player.alive && player.participating)).toBe(true);
    await countPlayers(host, 4);
  });
});

test('Expired reservation explains recovery failure and permits a fresh identity', async ({ partyBrowsers }) => {
  const { host, guest, newPlayer, baseURL } = partyBrowsers;
  const code = await createParty(host, baseURL);
  await joinParty(guest, baseURL, code);
  await countPlayers(host, 2);
  const originalId = (await snapshot(guest)).playerId;
  const context = guest.context();
  await guest.close();
  await expect.poll(async () => (await snapshot(host)).players.some(player => player.id === originalId), { timeout: 12_000 }).toBe(false);
  const reopened = await newPlayer(1, context);
  await reopened.goto(baseURL);
  await expect(reopened.locator('#notice')).toContainText(/expired|unavailable|ended|no longer|could not/i, { timeout: 15_000 });
  await expect(reopened.locator('#create-party')).toBeVisible();
  await reopened.locator('#nickname').fill('Hermes Returned');
  await reopened.locator('#room-code').fill(code);
  await reopened.locator('#join-party').click();
  const fresh = await connected(reopened);
  expect(fresh.playerId).not.toBe(originalId);
  expect(fresh.players.find(player => player.id === fresh.playerId).score).toBe(0);
  await countPlayers(host, 2);
});

test('Explicit leave cancels an already scheduled transport retry', async ({ partyBrowsers }) => {
  const { host, guest, baseURL } = partyBrowsers;
  const code = await createParty(host, baseURL);
  await joinParty(guest, baseURL, code);
  const guestId = (await snapshot(guest)).playerId;
  await simulateDrop(guest);
  await expect(guest.locator('#connection-status')).toContainText(/reconnect|recover|offline/i);
  await expect.poll(async () => (await snapshot(host)).players.find(player => player.id === guestId)?.connected).toBe(false);
  await guest.locator('#leave-button').click();
  await expect(guest.locator('#create-party')).toBeVisible();
  // This spans the pending 3-second SDK retry and the 4-second reservation.
  const until = Date.now() + 5500;
  while (Date.now() < until) {
    const formerPlayer = (await snapshot(host)).players.find(player => player.id === guestId);
    expect(formerPlayer?.connected || false, 'Leaving must not revive a ghost connection').toBe(false);
    await host.waitForTimeout(100);
  }
  await countPlayers(host, 1);
  await guest.reload();
  await expect(guest.locator('#create-party')).toBeVisible();
  await countPlayers(host, 1);
});

test('A delayed recovery health response cannot end an already recovered session', async ({ partyBrowsers }) => {
  const { host, guest, baseURL } = partyBrowsers;
  const code = await createParty(host, baseURL);
  await joinParty(guest, baseURL, code);
  await countPlayers(host, 2);
  const originalId = (await snapshot(guest)).playerId;
  const health = await guest.request.get(`${baseURL}/api/health`);
  const healthBody = await health.text();
  let delayedRoute;
  let droppedAt = 0;
  await guest.route('**/api/health', async route => {
    // The SDK resumes after 3 seconds. Hold the health poll that begins after
    // 1.7 seconds, leaving room to release it before its 2-second abort timeout.
    if (droppedAt && Date.now() - droppedAt >= 1700 && !delayedRoute) {
      delayedRoute = route;
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: healthBody });
  });
  try {
    droppedAt = Date.now();
    await simulateDrop(guest);
    await expect.poll(() => Boolean(delayedRoute), { timeout: 5000, intervals: [30] }).toBe(true);
    await connected(guest, originalId);
    await delayedRoute.fulfill({ status: 200, contentType: 'application/json', body: healthBody });
    delayedRoute = null;
    await guest.waitForTimeout(500);
    expect((await snapshot(guest)).connection).toBe('connected');
    expect((await snapshot(guest)).playerId).toBe(originalId);
    await countPlayers(host, 2);
    await expect(guest.locator('#notice')).toBeHidden();
  } finally {
    if (delayedRoute) await delayedRoute.abort().catch(() => {});
    await guest.unroute('**/api/health');
  }
});

test('Closing and reopening the Chrome application preserves a reserved player', async ({ partyBrowsers }, testInfo) => {
  const { guest, baseURL } = partyBrowsers;
  // The profile is a test-specific output directory, never the user's browser profile.
  const profile = testInfo.outputPath('chrome-recovery-profile');
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: channels[0], viewport: { width: 1280, height: 900 } });
    const original = await context.newPage();
    const code = await createParty(original, baseURL);
    await joinParty(guest, baseURL, code);
    const originalId = (await snapshot(original)).playerId;
    await context.close();
    context = await chromium.launchPersistentContext(profile, { channel: channels[0], viewport: { width: 1280, height: 900 } });
    const reopened = await context.newPage();
    await reopened.goto(baseURL);
    await connected(reopened, originalId);
    await countPlayers(guest, 2);
  } finally {
    await context?.close();
  }
});

test('A restarted server explains the ended session and offers a working new party', async ({ partyBrowsers }) => {
  const { host, guest } = partyBrowsers;
  const port = Number(process.env.BROWSER_RESTART_TEST_PORT || 2580);
  const baseURL = `http://127.0.0.1:${port}`;
  // Resolve from this test file back to the repository rather than the shell cwd.
  const repository = fileURLToPath(new URL('../..', import.meta.url));
  let server;
  async function startServer() {
    server = spawn(process.execPath, ['scripts/dev.js'], {
      cwd: repository,
      windowsHide: true,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RECONNECT_SECONDS: '4' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let startupOutput = '';
    server.stdout.on('data', chunk => { startupOutput += chunk.toString(); });
    server.stderr.on('data', chunk => { startupOutput += chunk.toString(); });
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error(`Restart test server exited: ${startupOutput.slice(-3000)}`);
      try { return (await fetch(`${baseURL}/api/health`)).ok; } catch { return false; }
    }, { message: 'Isolated restart test server becomes healthy', timeout: 20_000 }).toBe(true);
  }
  async function stopServer() {
    if (!server || server.exitCode !== null) return;
    const ended = once(server, 'exit');
    server.kill();
    await ended;
  }
  try {
    await startServer();
    const code = await createParty(host, baseURL);
    await joinParty(guest, baseURL, code);
    const originalId = (await snapshot(host)).playerId;
    await stopServer();
    await startServer();
    await expect(host.locator('#notice')).toContainText(/restarted|unavailable|ended|no longer/i, { timeout: 20_000 });
    await expect(guest.locator('#notice')).toContainText(/restarted|unavailable|ended|no longer/i, { timeout: 20_000 });
    await expect(host.locator('#create-party')).toBeVisible();
    await host.locator('#nickname').fill('New Athena');
    await host.locator('#create-party').click();
    const fresh = await connected(host);
    expect(fresh.playerId).not.toBe(originalId);
    await countPlayers(host, 1);
  } finally {
    await stopServer();
  }
});
