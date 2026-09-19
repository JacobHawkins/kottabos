import { chromium, expect, test } from '@playwright/test';

test('built app: Chrome/Edge invitation, host stability, round, recovery, results and replay', async ({ baseURL }, testInfo) => {
  const browsers = await Promise.all([chromium.launch({ channel: 'chrome' }), chromium.launch({ channel: 'msedge' })]);
  const errors = [];
  const socketProtocols = [];
  try {
    const host = await browsers[0].newPage({ viewport: { width: 1360, height: 1000 } });
    const guest = await browsers[1].newPage();
    for (const page of [host, guest]) {
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socketProtocols.push(new URL(socket.url()).protocol));
    }
    await host.goto(baseURL);
    await host.locator('#nickname').fill('Production Host');
    await host.locator('#create-party').click();
    await expect(host.locator('#connection-status')).toContainText('Connected');
    const code = await host.locator('#party-code').innerText();
    await guest.goto(`${baseURL}/?room=${code}`);
    await guest.locator('#nickname').fill('Production Guest');
    await guest.locator('#join-party').click();
    await expect(guest.locator('#connection-status')).toContainText('Connected');
    await expect(host.locator('#players-list li')).toHaveCount(2);
    await expect(host.locator('#start-button')).toBeVisible();
    await expect(guest.locator('#start-button')).toBeHidden();
    const id = await guest.locator('#players-list li').filter({ hasText: 'Production Guest' }).getAttribute('data-player-id');
    for (let cycle = 0; cycle < 3; cycle++) {
      await guest.reload();
      await expect(guest.locator('#connection-status')).toContainText('Connected');
      await expect(guest.locator(`#players-list [data-player-id="${id}"]`)).toContainText('(you)');
      await expect(host.locator('#players-list li')).toHaveCount(2);
    }
    for (const page of [host, guest]) {
      expect(await page.evaluate(() => '__partyDebug' in window)).toBe(false);
      await expect(page.locator('#simulate-drop')).toHaveCount(0);
      await expect(page.locator('#diagnostics')).toHaveCount(0);
      await expect(page.locator('#game-container canvas')).toBeVisible();
      await page.locator('#ready-button').click();
    }
    await host.locator('#start-button').click();
    await expect(host.locator('#phase-label')).toHaveAttribute('data-phase', 'playing');
    await host.locator('#game-container').click();
    await host.keyboard.down('KeyD');
    await host.waitForTimeout(250);
    await host.keyboard.up('KeyD');
    await expect(host.locator('#phase-label')).toHaveAttribute('data-phase', 'results', { timeout: 55_000 });
    await expect(guest.locator('#phase-label')).toHaveAttribute('data-phase', 'results');
    const scoreRows = () => guest.locator('#players-list .player-score').allTextContents();
    const scores = await scoreRows();
    await guest.reload();
    await expect(guest.locator('#connection-status')).toContainText('Connected');
    expect(await scoreRows()).toEqual(scores);
    await host.locator('#replay-button').click();
    await expect(guest.locator('#phase-label')).toHaveAttribute('data-phase', 'lobby');
    await host.screenshot({ path: testInfo.outputPath('production-lobby.png'), fullPage: true });
    await host.locator('#leave-button').click();
    await expect(guest.locator('#start-button')).toBeVisible();
    await guest.locator('#leave-button').click();
    expect(socketProtocols.length).toBeGreaterThanOrEqual(2);
    expect(socketProtocols.every(protocol => protocol === (baseURL.startsWith('https:') ? 'wss:' : 'ws:'))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(browsers.map(browser => browser.close()));
  }
});

test('built app: cold-host HTML retries and cancel is immediate', async ({ baseURL }) => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    let requests = 0;
    await page.route('**/api/health', route => {
      requests++;
      return route.fulfill({ status: 503, contentType: 'text/html', body: '<p>Starting service</p>' });
    });
    await page.goto(baseURL);
    await page.locator('#nickname').fill('Cold host');
    await page.locator('#create-party').click();
    await expect.poll(() => requests).toBeGreaterThan(1);
    await expect(page.locator('#cancel-recovery')).toBeVisible();
    await page.locator('#cancel-recovery').click();
    await expect(page.locator('#create-party')).toBeEnabled();
    const canceledAt = requests;
    await page.waitForTimeout(3000);
    expect(requests).toBe(canceledAt);
    await page.unroute('**/api/health');
    await page.locator('#create-party').click();
    await expect(page.locator('#connection-status')).toContainText('Connected');
    await page.locator('#leave-button').click();
  } finally { await browser.close(); }
});
