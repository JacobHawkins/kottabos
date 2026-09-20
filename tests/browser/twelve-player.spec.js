import { chromium, expect, test } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { MAX_PLAYERS } from '../../shared/constants.js';

// Two actual browser applications plus ten independent SDK sockets. Phone
// dimensions/touch are emulated; this is not twelve physical-phone evidence.
test('twelve-player party fits phone layouts, keeps numbered identities and replays', async ({ baseURL }, testInfo) => {
  const chrome = await chromium.launch({ channel: 'chrome' });
  const edge = await chromium.launch({ channel: 'msedge' });
  const phone = await chrome.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const host = await phone.newPage();
  const guest = await edge.newPage({ viewport: { width: 1360, height: 1000 } });
  const bots = new Set();
  const errors = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  const joinBot = async (code, name) => {
    const room = await new Client(baseURL).joinById(code, { name });
    bots.add(room);
    room.reconnection.enabled = false;
    for (const type of ['welcome', 'notice', 'pong']) room.onMessage(type, () => {});
    room.onError(() => {});
    room.onLeave(() => {});
    return room;
  };
  const noOverflow = async () => expect(await host.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const badges = page => page.locator('.player-row').evaluateAll(rows => Object.fromEntries(rows.map(row =>
    [row.dataset.playerId, row.querySelector('.avatar').textContent])));
  try {
    await host.goto(baseURL);
    await host.locator('#nickname').fill('Phone party host');
    await host.locator('#create-party').tap();
    await expect(host.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    const code = await host.locator('#party-code').innerText();
    await guest.goto(`${baseURL}/?room=${code}`);
    await guest.locator('#nickname').fill('Desktop friend');
    await guest.locator('#join-party').click();
    await expect(guest.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    for (let index = 3; index <= MAX_PLAYERS; index++) await joinBot(code, `Long nickname ${String(index).padStart(2, '0')}!!`);
    for (const page of [host, guest]) {
      await expect(page.locator('.player-row')).toHaveCount(12);
      await expect(page.locator('#player-count')).toHaveText('12 / 12');
    }
    const originalBadges = await badges(host);
    expect(new Set(Object.values(originalBadges)).size).toBe(12);
    expect(Object.values(originalBadges).sort()).toEqual(Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')));
    // Every colored identity marker is painted inside the board, not merely
    // present in a DOM roster; the sprite suite checks the shared artwork.
    await expect.poll(() => host.evaluate(() => {
      const canvas = document.querySelector('#game-container canvas');
      if (!canvas) return false;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return [...document.querySelectorAll('.avatar')].every(avatar => {
        const rgb = getComputedStyle(avatar).backgroundColor.match(/\d+/g).slice(0, 3).map(Number);
        let count = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (!rgb.every((value, channel) => value === pixels[offset + channel])) continue;
          const x = offset / 4 % canvas.width, y = Math.floor(offset / 4 / canvas.width);
          const padding = (canvas.width - 448) / 2;
          if (x < padding || x >= canvas.width - padding || y < padding || y >= canvas.height - padding) return false;
          count++;
        }
        return count > 100;
      });
    })).toBe(true);
    await noOverflow();
    await host.screenshot({ path: testInfo.outputPath('twelve-phone-portrait.png'), fullPage: true });
    await guest.screenshot({ path: testInfo.outputPath('twelve-desktop.png'), fullPage: true });
    await host.setViewportSize({ width: 320, height: 700 });
    await noOverflow();
    await host.setViewportSize({ width: 844, height: 390 });
    await host.evaluate(() => scrollTo(0, 0));
    await noOverflow();
    const stage = await host.locator('.stage').boundingBox();
    const joystick = await host.locator('#joystick').boundingBox();
    expect(stage.y + stage.height).toBeLessThanOrEqual(391);
    expect(joystick.y + joystick.height).toBeLessThanOrEqual(391);
    expect(joystick.x).toBeGreaterThan(stage.x + stage.width);
    await host.screenshot({ path: testInfo.outputPath('twelve-phone-landscape.png'), fullPage: true });
    expect(await host.evaluate(() => {
      const canvas = document.querySelector('#game-container canvas');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set([...document.querySelectorAll('.avatar')].map(avatar =>
        getComputedStyle(avatar).backgroundColor.match(/\d+/g).slice(0, 3).join(',')));
      let lastCharacterRow = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (colors.has(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`)) {
          lastCharacterRow = Math.floor(offset / 4 / canvas.width);
        }
      }
      const bounds = canvas.getBoundingClientRect();
      return document.querySelector('#stage-banner span').getBoundingClientRect().top -
        (bounds.y + (lastCharacterRow + 1) * bounds.height / canvas.height);
    }), 'the lobby banner stays below the bottom row of characters').toBeGreaterThan(0);

    const departing = [...bots][0];
    await departing.leave();
    bots.delete(departing);
    await expect(host.locator('.player-row')).toHaveCount(11);
    for (const [id, badge] of Object.entries(await badges(host))) expect(badge).toBe(originalBadges[id]);
    await joinBot(code, 'Replacement friend');
    await expect(host.locator('.player-row')).toHaveCount(12);
    expect(new Set(Object.values(await badges(host))).size).toBe(12);

    await expect(host.locator('#ready-button')).toHaveCount(0);
    await expect(host.locator('#start-button')).toBeEnabled();
    await host.locator('#start-button').tap();
    for (const page of [host, guest]) await expect(page.locator('#phase-label')).toHaveAttribute('data-phase', 'playing');
    await expect(host.locator('#phase-label')).toHaveAttribute('data-phase', 'results', { timeout: 55_000 });
    await expect(guest.locator('#phase-label')).toHaveAttribute('data-phase', 'results');
    await expect(guest.locator('#result-text')).toHaveText(await host.locator('#result-text').textContent());
    expect(await guest.locator('.player-score').allTextContents()).toEqual(await host.locator('.player-score').allTextContents());
    await noOverflow();
    await host.screenshot({ path: testInfo.outputPath('twelve-results.png'), fullPage: true });
    await host.locator('#replay-button').tap();
    await expect(guest.locator('#phase-label')).toHaveAttribute('data-phase', 'lobby');
    const identity = await host.locator('.player-row').filter({ hasText: 'Phone party host (you)' }).getAttribute('data-player-id');
    const beforeRefresh = await badges(host);
    await host.reload();
    await expect(host.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    await expect(host.locator(`.player-row[data-player-id="${identity}"]`)).toContainText('(you)');
    expect(await badges(host)).toEqual(beforeRefresh);
    await expect(guest.locator('#start-button')).toBeVisible();
    await expect(host.locator('#start-button')).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([...bots].map(room => room.connection?.isOpen ? room.leave() : Promise.resolve()));
    for (const page of [host, guest]) {
      if (!page.isClosed() && await page.locator('#leave-button').isVisible().catch(() => false)) await page.locator('#leave-button').click().catch(() => {});
    }
    await Promise.all([chrome.close(), edge.close()]);
  }
});
