import { chromium, expect, test } from '@playwright/test';
import { Client } from '@colyseus/sdk';

test('a jumper can tap, use Space, recover at the handle and speed up the surviving players', async ({ baseURL }, testInfo) => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const bots = [];
  let practice;
  let keepBothJumping = true;
  try {
    await page.goto(baseURL);
    await page.locator('#nickname').fill('Juniper');
    await page.locator('#create-party').tap();
    await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    const code = await page.locator('#party-code').innerText();
    const id = await page.locator('.local-player').getAttribute('data-player-id');
    for (const name of ['Birch', 'Ash']) {
      const room = await new Client(baseURL).joinById(code, { name });
      for (const type of ['welcome', 'notice', 'pong']) room.onMessage(type, () => {});
      bots.push({ room, lastSwing: 0 });
    }
    const state = () => bots[0].room.state;
    const jumper = () => state().players.get(id);
    practice = setInterval(() => {
      for (const [i, bot] of bots.entries()) {
        const s = bot.room.state;
        if ((!keepBothJumping && i === 1) || s.phase !== 'playing' || s.ropeSwing === bot.lastSwing) continue;
        const untilContact = s.ropeHitMs - s.roundElapsedMs;
        if (untilContact >= 120 && untilContact <= 330) {
          bot.room.send('action', { action: 'jump', round: s.round, swing: s.ropeSwing });
          bot.lastSwing = s.ropeSwing;
        }
      }
    }, 15);
    await page.getByLabel('Jump Rope', { exact: true }).check();
    const platform = page.getByLabel('Stay on the Platform', { exact: true });
    await expect(platform).toBeEnabled();
    await platform.uncheck();
    await expect.poll(() => Array.from(state().selectedGames)).toEqual(['rope']);
    await page.locator('#start-button').tap();
    const button = page.locator('#rope-action');
    await expect(button).toBeEnabled();
    await expect(page.locator('#game-container canvas')).toHaveAttribute('width', '640');
    const court = page.locator('#game-container');
    await expect.poll(() => state().ropeHitMs - state().roundElapsedMs, { intervals: [20] }).toBeLessThan(340);
    await court.tap();
    await expect.poll(() => jumper().jumpedAtMs).toBeGreaterThan(0);
    await expect.poll(() => state().ropeSwing).toBe(2);
    expect(jumper().ropeDings).toBe(0);
    const firstJump = jumper().jumpedAtMs;
    await court.focus();
    await page.keyboard.press('Space');
    // Allow the first jump to land before using the keyboard again.
    await expect(async () => {
      await page.keyboard.press('Space');
      expect(jumper().jumpedAtMs).toBeGreaterThan(firstJump);
    }).toPass({ intervals: [100], timeout: 1800 });
    await page.screenshot({ path: testInfo.outputPath('jump-rope-court.png') });
    await expect(button).toHaveText('Pull', { timeout: 9000 });
    await expect(page.locator('#rope-hud')).toContainText('3/3 dings');
    await button.tap();
    await expect.poll(() => state().ropePulls).toBe(1);
    await page.reload();
    await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    await expect(page.locator('.local-player')).toHaveAttribute('data-player-id', id);
    await expect(page.locator('.local-player')).toContainText('AT THE ROPE HANDLE');
    await expect(button).toHaveText('Pull');
    await court.focus();
    await page.keyboard.press('Space');
    await expect.poll(() => state().ropePulls).toBe(2);
    keepBothJumping = false;
    await expect(page.locator('#results-panel')).toBeVisible();
    await expect(page.locator('#result-text')).toContainText('Birch wins! +3 points');
    await expect(page.locator('#session-result')).toContainText('Birch');
    expect(errors).toEqual([]);
  } finally {
    clearInterval(practice);
    await Promise.allSettled(bots.map(({ room }) => room.leave()));
    await browser.close();
  }
});
