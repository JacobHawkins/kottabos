import { chromium, expect, test as base } from '@playwright/test';

const test = base.extend({
  recoveryPage: async ({ baseURL }, use) => {
    const browser = await chromium.launch({ channel: process.env.TEST_HOST_BROWSER || 'chrome' });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(baseURL);
      await page.locator('#nickname').fill('Athena');
      await use(page);
      expect(errors, 'Recovery branches have no uncaught browser errors').toEqual([]);
    } finally { await browser.close(); }
  },
});

test('a provider HTML loading page is retried before the initial party is created', async ({ recoveryPage: page }) => {
  let healthRequests = 0;
  let creates = 0;
  page.on('request', request => { if (request.url().includes('/matchmake/create/')) creates++; });
  await page.route('**/api/health', async route => {
    if (++healthRequests === 1) await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Waking up</html>' });
    else await route.continue();
  });
  await page.locator('#create-party').click();
  await expect(page.locator('#connection-status')).toContainText(/waking|connecting/i);
  await expect(page.locator('#cancel-recovery')).toBeVisible();
  await expect(page.locator('#party-code')).toHaveText(/^[A-Z]{6}$/);
  await expect(page.locator('#connection-status')).toContainText('Connected');
  expect(creates).toBe(1);
  expect(healthRequests).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#players-list [data-player-id]')).toHaveCount(1);
  await page.locator('#leave-button').click();
});

test('cancel during startup health waiting returns immediately and cannot create a late party', async ({ recoveryPage: page }) => {
  let waiting;
  let creates = 0;
  page.on('request', request => { if (request.url().includes('/matchmake/create/')) creates++; });
  await page.route('**/api/health', route => { waiting = route; });
  await page.locator('#create-party').click();
  await expect.poll(() => Boolean(waiting)).toBe(true);
  await page.locator('#cancel-recovery').click();
  await expect(page.locator('#create-party')).toBeEnabled();
  await expect(page.locator('#notice')).toContainText(/canceled/i);
  await waiting.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, instanceId: 'late-health', reconnectionSeconds: 120 }) }).catch(() => {});
  await page.waitForTimeout(800);
  expect(creates).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('kottabos.recovery.v1'))).toBeNull();
  await expect(page.locator('#create-party')).toBeEnabled();
});

test('cancel before a delayed matchmaking response prevents a late game socket', async ({ recoveryPage: page }) => {
  let waiting;
  let response;
  let sockets = 0;
  page.on('websocket', () => { sockets++; });
  await page.route('**/matchmake/create/party', async route => {
    response = await route.fetch();
    waiting = route;
  });
  await page.locator('#create-party').click();
  await expect.poll(() => Boolean(waiting)).toBe(true);
  await page.locator('#cancel-recovery').click();
  await expect(page.locator('#create-party')).toBeEnabled();
  await waiting.fulfill({ response }).catch(() => {});
  await page.waitForTimeout(800);
  expect(sockets).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('kottabos.recovery.v1'))).toBeNull();
  await expect(page.locator('#notice')).toContainText(/canceled/i);
});

test('cancel during the game handshake closes the pending socket without restoring a player', async ({ recoveryPage: page, baseURL }) => {
  let socketClosed = false;
  let heldFrames = 0;
  let roomCode;
  page.on('response', async response => {
    if (response.url().includes('/matchmake/create/')) roomCode = (await response.json()).roomId;
  });
  await page.routeWebSocket('**', socket => {
    const server = socket.connectToServer();
    server.onMessage(() => { heldFrames++; });
    socket.onClose((code, reason) => { socketClosed = true; server.close({ code, reason }); });
  });
  await page.addInitScript(() => {
    const RoutedWebSocket = window.WebSocket;
    // The SDK first probes Node's (url, options) overload. Native browsers
    // reject the object synchronously and the SDK retries the browser overload;
    // Playwright's mock otherwise reports that rejection asynchronously.
    window.WebSocket = class extends RoutedWebSocket {
      constructor(url, protocols) {
        if (protocols !== undefined && typeof protocols !== 'string' && !Array.isArray(protocols)) {
          throw new DOMException('Invalid WebSocket protocols', 'SyntaxError');
        }
        super(url, protocols);
      }
    };
  });
  // The pinned SDK captures globalThis.WebSocket at module evaluation. Load
  // it after installing interception so this actually delays the game socket.
  await page.reload();
  await page.locator('#nickname').fill('Athena');
  await page.locator('#create-party').click();
  await expect.poll(() => heldFrames).toBeGreaterThan(0);
  await page.locator('#cancel-recovery').click();
  await expect(page.locator('#create-party')).toBeEnabled();
  await expect.poll(() => socketClosed).toBe(true);
  await expect.poll(async () => {
    if (!roomCode) return false;
    const response = await page.request.get(`${baseURL}/api/parties/${roomCode}`);
    const party = await response.json();
    return !party.exists || party.players === 0;
  }).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('kottabos.recovery.v1'))).toBeNull();
});
