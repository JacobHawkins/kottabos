import { chromium, expect, test } from '@playwright/test';

// These are Chrome touch/viewport emulation checks, not Safari or physical-phone
// certification. Assertions read the shipped UI and visible canvas pixels.
async function characterPosition(page, name) {
  // The shared LPC artwork sits on each player's unique opaque color marker.
  // Tracking that marker works independently of which animation frame is shown.
  return page.evaluate((playerName) => {
    const row = [...document.querySelectorAll('.player-row')].find((element) => element.querySelector('.player-name').textContent.startsWith(playerName));
    const rgb = getComputedStyle(row.querySelector('.avatar')).backgroundColor.match(/\d+/g).slice(0, 3).map(Number);
    const canvas = document.querySelector('#game-container canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0, x = 0, y = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (rgb.every((value, channel) => pixels[index + channel] === value)) {
        count++;
        x += index / 4 % canvas.width;
        y += Math.floor(index / 4 / canvas.width);
      }
    }
    return count > 100 ? { x: x / count, y: y / count } : null;
  }, name);
}

async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

test('phone portrait/landscape controls move, release outside, cancel, and preserve shared rounds', async ({ baseURL }, testInfo) => {
  const browser = await chromium.launch({ channel: process.env.TEST_HOST_BROWSER || 'chrome' });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const desktop = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const host = await phone.newPage(), guest = await desktop.newPage();
  const errors = [];
  for (const page of [host, guest]) page.on('pageerror', (error) => errors.push(error.message));
  try {
    await host.goto(baseURL);
    await host.locator('#nickname').fill('Phone');
    await noHorizontalOverflow(host);
    await host.locator('#create-party').tap();
    await expect(host.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    const invite = await host.locator('#invite-link').inputValue();
    await guest.goto(invite);
    await guest.locator('#nickname').fill('Keyboard');
    await guest.locator('#join-party').click();
    await expect(host.locator('.player-row')).toHaveCount(2);
    await expect(host.locator('#touch-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(guest.locator('#touch-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(host.locator('#start-button')).toBeVisible();
    await expect(guest.locator('#start-button')).toBeHidden();
    await expect(host.locator('#ready-button')).toHaveCount(0);
    const startRound = async () => {
      if (await host.locator('#results-panel').isVisible()) {
        await host.locator('#replay-button').tap();
        await expect(host.locator('#phase-label')).toHaveAttribute('data-phase', 'lobby');
      }
      await expect(host.locator('#start-button')).toBeEnabled();
      await host.locator('#start-button').tap();
      await expect(host.locator('#phase-label')).toHaveAttribute('data-phase', 'playing');
      await expect(host.locator('body')).toHaveClass('is-playing');
      await expect(host.locator('#joystick')).toHaveAttribute('aria-disabled', 'false');
      await expect(host.locator('.party-sidebar')).toBeHidden();
      await expect(host.locator('#leave-button')).toBeVisible();
    };
    const finishRound = async () => {
      await expect(host.locator('#results-panel')).toBeVisible({ timeout: 6_000 });
      await expect(guest.locator('#result-text')).toHaveText(await host.locator('#result-text').textContent());
      await expect(host.locator('#joystick')).toHaveAttribute('aria-disabled', 'true');
      await expect(host.locator('body')).not.toHaveClass('is-playing');
      await expect(host.locator('.party-info')).toBeVisible();
    };
    const joystickPoints = async () => {
      const bounds = await host.locator('#joystick').boundingBox();
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 };
      return { center, right: { ...center, x: center.x + 50 }, second: { ...center, id: 2, x: center.x - 45 } };
    };
    const cdp = await phone.newCDPSession(host);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    // Each check uses a fresh host-started round. Idle players correctly lose
    // their spawn tile after 1.8 seconds, so controls are exercised promptly.
    await startRound();
    let { center, right, second } = await joystickPoints();
    await expect(host.locator('#game-container canvas')).toBeVisible();
    await expect.poll(() => characterPosition(host, 'Phone')).not.toBeNull();
    const before = await characterPosition(host, 'Phone');
    const scrollBefore = await host.evaluate(() => scrollY);
    await touch('touchStart', [center]);
    await host.waitForTimeout(150);
    expect(Math.abs((await characterPosition(host, 'Phone')).x - before.x)).toBeLessThan(3);
    await touch('touchMove', [right]);
    await expect.poll(async () => (await characterPosition(host, 'Phone')).x - before.x, { intervals: [30] }).toBeGreaterThan(25);
    await touch('touchStart', [right, second]);
    await host.waitForTimeout(100);
    // Captured movement continues outside the circle; the extra finger never
    // takes over when the controlling finger lifts.
    await touch('touchMove', [{ ...right, x: right.x + 70 }, second]);
    // Installed Chrome dispatches pointerup for the named ended contact here;
    // an empty touchEnd below releases all remaining contacts.
    await touch('touchEnd', [{ ...right, x: right.x + 70 }]);
    await expect(host.locator('#joystick')).toHaveCSS('--stick-x', '0px');
    await host.waitForTimeout(180);
    const stopped = await characterPosition(host, 'Phone');
    await host.waitForTimeout(200);
    expect(Math.abs((await characterPosition(host, 'Phone')).x - stopped.x)).toBeLessThan(3);
    expect(await host.evaluate(() => scrollY)).toBe(scrollBefore);
    await touch('touchEnd', []);
    // The other screen receives the same movement through the real server.
    await expect.poll(async () => Math.abs((await characterPosition(guest, 'Phone'))?.x - stopped.x), { intervals: [30] }).toBeLessThan(6);
    await finishRound();

    await startRound();
    ({ center, right, second } = await joystickPoints());
    await touch('touchStart', [right]);
    await host.waitForTimeout(100);
    await touch('touchCancel', []);
    await expect(host.locator('#joystick')).toHaveCSS('--stick-x', '0px');
    await host.waitForTimeout(180);
    const canceled = await characterPosition(host, 'Phone');
    await host.waitForTimeout(180);
    expect(Math.abs((await characterPosition(host, 'Phone')).x - canceled.x)).toBeLessThan(3);
    await expect(host.locator('#touch-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => Math.abs((await characterPosition(guest, 'Phone'))?.x - canceled.x), { intervals: [50] }).toBeLessThan(6);
    const desktopBefore = await characterPosition(guest, 'Keyboard');
    await guest.locator('#game-container').focus();
    await guest.keyboard.down('ArrowLeft');
    await expect.poll(async () => desktopBefore.x - (await characterPosition(guest, 'Keyboard')).x, { intervals: [30] }).toBeGreaterThan(20);
    await guest.keyboard.up('ArrowLeft');
    await expect(host.locator('#touch-toggle')).toHaveAttribute('aria-pressed', 'true');
    await finishRound();

    await startRound();
    await noHorizontalOverflow(host);
    await host.screenshot({ path: testInfo.outputPath('phone-portrait.png'), fullPage: true });
    ({ center, right, second } = await joystickPoints());
    await touch('touchStart', [right]);
    await expect(host.locator('#joystick')).not.toHaveCSS('--stick-x', '0px');
    await host.setViewportSize({ width: 844, height: 390 });
    await host.evaluate(() => scrollTo(0, 0));
    await noHorizontalOverflow(host);
    await expect(host.locator('#joystick')).toHaveCSS('--stick-x', '0px');
    const arena = await host.locator('.stage').boundingBox();
    const stick = await host.locator('#joystick').boundingBox();
    expect(arena.y + arena.height).toBeLessThanOrEqual(391);
    expect(stick.y + stick.height).toBeLessThanOrEqual(391);
    expect(stick.x).toBeGreaterThan(arena.x + arena.width);
    await touch('touchEnd', []);
    await host.screenshot({ path: testInfo.outputPath('phone-landscape.png'), fullPage: true });
    await finishRound();
    await host.setViewportSize({ width: 320, height: 568 });
    await startRound();
    for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
      await host.setViewportSize(viewport);
      await noHorizontalOverflow(host);
      for (const selector of ['.stage', '#joystick', '#leave-button']) {
        const bounds = await host.locator(selector).boundingBox();
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
      }
    }
    await finishRound();
    await host.setViewportSize({ width: 844, height: 390 });
    await host.locator('#replay-button').tap();
    await expect(host.locator('#phase-label')).toHaveAttribute('data-phase', 'lobby');
    const identity = await host.locator('.player-row').filter({ hasText: 'Phone (you)' }).getAttribute('data-player-id');
    await host.reload();
    await expect(host.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    await expect(host.locator('.player-row').filter({ hasText: 'Phone (you)' })).toHaveAttribute('data-player-id', identity);
    await host.evaluate(() => scrollTo(0, 0));
    const scrollArena = await host.locator('.stage').boundingBox();
    await expect(host.locator('#game-container canvas')).toHaveCSS('touch-action', 'auto');
    const scrollPoint = { x: scrollArena.x + scrollArena.width / 2, y: scrollArena.y + scrollArena.height / 2, id: 3 };
    await touch('touchStart', [scrollPoint]);
    for (let step = 1; step <= 5; step++) {
      await touch('touchMove', [{ ...scrollPoint, y: scrollPoint.y - step * 20 }]);
      await host.waitForTimeout(20);
    }
    await touch('touchEnd', []);
    await expect.poll(() => host.evaluate(() => scrollY)).toBeGreaterThan(20);
    await host.locator('#touch-toggle').tap();
    await expect(host.locator('#touch-controls')).toBeHidden();
    await host.reload();
    await expect(host.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    await expect(host.locator('#touch-toggle')).toHaveAttribute('aria-pressed', 'false');
    await host.locator('#leave-button').tap();
    await expect(host.locator('#home')).toBeVisible();
    await expect(guest.locator('.player-row')).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
});

test('missing Web Locks has a supported-browser explanation instead of a false duplicate-tab warning', async ({ baseURL }) => {
  const browser = await chromium.launch({ channel: process.env.TEST_HOST_BROWSER || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
    await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    await page.goto(baseURL);
    await expect(page.locator('#tab-blocked-title')).toHaveText('A supported browser is needed.');
    await expect(page.locator('#tab-blocked-message')).toContainText('Web Locks');
    await expect(page.locator('#connection-status')).toHaveText('Browser capability unavailable');
    await expect(page.locator('#home')).toBeHidden();
    await noHorizontalOverflow(page);
  } finally { await browser.close(); }
});
