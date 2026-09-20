import { chromium, expect, test } from '@playwright/test';

for (const leaveFirst of [true, false]) {
  test(leaveFirst
    ? 'a late renderer import failure preserves the leave notice and home screen'
    : 'a renderer import failure still explains the problem in a connected party', async ({ baseURL }) => {
    const browser = await chromium.launch({ channel: process.env.TEST_HOST_BROWSER || 'chrome' });
    try {
      const page = await browser.newPage();
      let rendererRequest;
      await page.route('**/client/game.js*', route => { rendererRequest = route; });
      await page.goto(baseURL);
      await page.locator('#nickname').fill('Slow renderer');
      await page.locator('#create-party').click();
      await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
      await expect.poll(() => Boolean(rendererRequest)).toBe(true);
      let leaveNotice;
      if (leaveFirst) {
        await page.locator('#leave-button').click();
        await expect(page.locator('#notice')).toContainText('You left the party');
        leaveNotice = await page.locator('#notice').textContent();
      }

      // Release a real module evaluation failure only after the chosen session
      // state is established. Await its rejection and a frame, without a timed sleep.
      const moduleUrl = rendererRequest.request().url();
      await rendererRequest.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'throw new Error("Deliberate renderer loading regression failure");',
      });
      await page.evaluate(async url => {
        await import(url).catch(() => {});
        await new Promise(resolve => requestAnimationFrame(resolve));
      }, moduleUrl);

      if (leaveFirst) {
        await expect(page.locator('#notice')).toHaveText(leaveNotice);
        await expect(page.locator('#home')).toBeVisible();
        await expect(page.locator('#party')).toBeHidden();
        await expect(page.locator('#create-party')).toBeEnabled();
        await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'ended');
        expect(await page.evaluate(() => localStorage.getItem('kottabos.recovery.v1'))).toBeNull();
      } else {
        await expect(page.locator('#notice')).toContainText('The game renderer could not load');
        await expect(page.locator('#party')).toBeVisible();
        await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
        await page.locator('#leave-button').click();
      }
    } finally {
      await browser.close();
    }
  });
}
