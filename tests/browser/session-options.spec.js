import { chromium, expect, test } from '@playwright/test';

test('three-round session carries a late joiner, votes, skins and local music preferences', async ({ baseURL }) => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  try {
    const [host, guest, late] = await Promise.all(Array.from({ length: 3 }, () => browser.newPage()));
    [host, guest, late].forEach(page => page.on('pageerror', error => errors.push(error.message)));
    async function enter(page, name, url, button) {
      await page.goto(url);
      await page.locator('#nickname').fill(name);
      await page.locator(button).click();
      await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    }
    await enter(host, 'Daphne', baseURL, '#create-party');
    const invite = await host.locator('#invite-link').inputValue();
    await enter(guest, 'Apollo', invite, '#join-party');
    await expect(guest.locator('#manage-party')).toBeHidden();
    await guest.locator('#skin-choice').selectOption('triangle');
    await guest.locator('#lock-skin').click();
    await expect(guest.locator('#lock-skin')).toHaveText('Locked in');
    const debug = await host.evaluate(() => Boolean(window.__partyDebug));
    if (debug) {
      await expect.poll(() => host.evaluate(() => Object.values(window.__partyDebug.renderedCharacters)
        .some(p => p.skin === 'triangle'))).toBe(true);
      const guestX = () => host.evaluate(() => window.__partyDebug.players.find(p => p.name === 'Apollo').x);
      const original = await guestX();
      await guest.locator('#game-container').focus();
      await guest.keyboard.down('ArrowRight');
      try { await expect.poll(guestX).toBeGreaterThan(original + 15); }
      finally { await guest.keyboard.up('ArrowRight'); }
      expect(await host.evaluate(() => window.__partyDebug.tiles.every(tile => tile === 0))).toBe(true);
    }
    const audio = page => page.locator('#party-audio');
    await expect.poll(() => audio(host).evaluate(el => el.currentTime)).toBeGreaterThan(0);
    await expect(audio(host)).toHaveAttribute('src', /DK-Water/);
    await guest.locator('#music-button').click();
    await guest.locator('#music-volume').fill('60');
    await guest.locator('#music-mute').click();
    await guest.reload();
    await expect(guest.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    await expect(guest.locator('#skin-choice')).toHaveValue('triangle');
    await expect(guest.locator('#music-mute')).toHaveAttribute('aria-pressed', 'true');
    await expect(guest.locator('#music-volume')).toHaveValue('60');
    await expect(host.locator('#music-mute')).toHaveAttribute('aria-pressed', 'false');

    // Prepare the invitation before the short first round.
    await late.goto(invite);
    await late.locator('#nickname').fill('Iris');
    await host.locator('#start-button').click();
    await host.locator('[data-choice="5"]').click();
    await host.locator('[data-choice="3"]').click();
    await expect(guest.locator('[data-choice="3"]')).toContainText('(1)');
    await expect(guest.locator('[data-choice="5"]')).toContainText('(0)');
    await expect(host.locator('#phase-label')).toHaveAttribute('data-phase', 'playing');
    await expect(audio(host)).toHaveAttribute('src', /DK-Racing/);
    await late.locator('#join-party').click();
    await expect(late.locator('.local-player')).toContainText('SPECTATING');
    await expect(late.locator('#vote-title')).toHaveText('Pick the next map');
    await late.locator('[data-choice="large"]').click();
    await expect(host.locator('#round-label')).toContainText('Round 2 of 3 · Large');
    await expect(late.locator('.local-player')).toContainText('STILL STANDING');
    await expect(host.locator('#game-container canvas')).toHaveAttribute('width', '996');
    await expect(host.locator('#vote-panel')).toBeVisible();
    await guest.locator('[data-choice="shaped"]').click();
    await expect(host.locator('#round-label')).toHaveText(/Round 3 of 3 · (Diamond|Cross|Ring|Hourglass|Steps)/);
    await expect(late.locator('#session-result')).toHaveText(/Daphne & Apollo tie for the session with 3 points/);
    await expect(host.locator('#session-result')).toHaveText(/Daphne & Apollo tie for the session with 3 points/);
    await expect(audio(host)).toHaveAttribute('src', /DK-Water/);
    await host.locator('#manage-party').click();
    await host.getByRole('button', { name: 'Kick Iris' }).click();
    await expect(late.locator('#notice')).toContainText('host removed you');
    await expect(host.locator('#player-count')).toHaveText('2 / 12');
    await late.reload();
    await expect(late.locator('#home')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
