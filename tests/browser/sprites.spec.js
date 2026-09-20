import { chromium, expect, test } from '@playwright/test';

const snapshot = (page) => page.evaluate(() => window.__partyDebug);
const character = async (page, id) => (await snapshot(page))?.renderedCharacters?.[id];

async function connected(page, expectedId) {
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state?.connection === 'connected'
      && state.players.some(player => player.id === (expectedId || state.playerId) && player.connected);
  }).toBe(true);
  return snapshot(page);
}

async function expectIdle(page, id, facing, row) {
  const matchesIdle = sprite => sprite?.facing === facing && !sprite.moving
    && [row * 13, row * 13 + 1].includes(Number(sprite.frame));
  await expect.poll(async () => {
    const sprite = await character(page, id);
    return matchesIdle(sprite);
  }, { intervals: [25] }).toBe(true);
  await page.waitForTimeout(200);
  expect(matchesIdle(await character(page, id))).toBe(true);
}

async function expectFallen(page, id) {
  await expect.poll(async () => {
    const sprite = await character(page, id);
    return sprite && { frame: Number(sprite.frame), moving: sprite.moving, animating: sprite.animating, alpha: sprite.alpha };
  }).toEqual({ frame: 265, moving: false, animating: false, alpha: .22 });
}

// The supplied LPC sheet has 13 columns of 64px frames. Walk rows are
// up/left/down/right = 8/9/10/11; idle rows 22/23/24/25 have two breathing poses.
test('LPC characters load, walk and stop directionally, and reset through recovery and replay', async ({ baseURL }, testInfo) => {
  const chrome = await chromium.launch({ channel: process.env.TEST_HOST_BROWSER || 'chrome' });
  const edge = await chromium.launch({ channel: process.env.TEST_GUEST_BROWSER || 'msedge' });
  const host = await chrome.newPage({ viewport: { width: 1360, height: 1000 } });
  const guest = await edge.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors = [];
  const sheets = [];
  for (const page of [host, guest]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.headers()['content-type']?.startsWith('image/png')
        && new URL(response.url()).pathname.endsWith('/character-spritesheet.png')) sheets.push(response.status());
    });
  }
  try {
    await host.goto(baseURL);
    await host.locator('#nickname').fill('Sprite host');
    await host.locator('#create-party').click();
    const initial = await connected(host);
    const hostId = initial.playerId;
    await guest.goto(await host.locator('#invite-link').inputValue());
    await guest.locator('#nickname').fill('Sprite guest');
    await guest.locator('#join-party').click();
    const guestId = (await connected(guest)).playerId;
    await expect.poll(async () => Object.keys((await snapshot(host)).renderedCharacters || {}).length).toBe(2);
    await expect.poll(() => sheets.filter(status => status === 200).length).toBe(2);
    for (const page of [host, guest]) {
      await expect.poll(async () => {
        const sprites = Object.values((await snapshot(page)).renderedCharacters || {});
        return sprites.length === 2 && sprites.every(sprite => sprite.texture === 'party-character' && sprite.visible);
      }).toBe(true);
      await expectIdle(page, hostId, 'down', 24);
      await expectIdle(page, guestId, 'down', 24);
      const sprites = (await snapshot(page)).renderedCharacters;
      expect([sprites[hostId].number, sprites[guestId].number].sort()).toEqual(['01', '02']);
    }
    await host.screenshot({ path: testInfo.outputPath('sprite-lobby.png'), fullPage: true });
    await host.emulateMedia({ reducedMotion: 'reduce' });
    const allStill = async () => Object.values((await snapshot(host)).renderedCharacters)
      .every(sprite => !sprite.animating && Number(sprite.frame) === 312);
    await expect.poll(allStill).toBe(true);
    await host.waitForTimeout(200);
    expect(await allStill()).toBe(true);
    await host.emulateMedia({ reducedMotion: 'no-preference' });

    await host.locator('#start-button').click();
    await expect.poll(async () => (await snapshot(host)).phase, { intervals: [20] }).toBe('playing');
    const before = (await snapshot(host)).players.find(player => player.id === hostId).x;
    await host.locator('#game-container').focus();
    await host.keyboard.down('ArrowRight');
    const frames = new Set();
    try {
      await expect.poll(async () => {
        const sprite = await character(host, hostId);
        if (sprite?.moving && sprite.facing === 'right') frames.add(Number(sprite.frame));
        return frames.size;
      }, { intervals: [25], timeout: 1000 }).toBeGreaterThan(1);
      expect([...frames].every(frame => frame >= 144 && frame <= 151)).toBe(true);
      await expect.poll(async () => {
        const state = await snapshot(guest);
        const sprite = state.renderedCharacters[hostId];
        return state.players.find(player => player.id === hostId).x > before + 35
          && sprite.facing === 'right' && sprite.moving;
      }, { intervals: [25], timeout: 1000 }).toBe(true);
    } finally {
      await host.keyboard.up('ArrowRight');
    }
    await expectIdle(host, hostId, 'right', 25);
    await expectIdle(guest, hostId, 'right', 25);
    await host.screenshot({ path: testInfo.outputPath('sprite-round.png'), fullPage: true });
    await expect.poll(async () => (await snapshot(host)).phase).toBe('results');

    const result = await snapshot(host);
    const score = result.players.find(player => player.id === hostId).score;
    expect(result.players.find(player => player.id === guestId).alive).toBe(false);
    await expectFallen(guest, guestId);
    await expectFallen(host, guestId);
    await guest.reload();
    const fallenRecovery = await connected(guest, guestId);
    expect(fallenRecovery.players.find(player => player.id === guestId).alive).toBe(false);
    await expectFallen(guest, guestId);
    await guest.waitForTimeout(200);
    await expectFallen(guest, guestId);
    await host.reload();
    const recovered = await connected(host, hostId);
    expect(recovered.players.find(player => player.id === hostId).score).toBe(score);
    expect(recovered.players).toHaveLength(2);
    await expect.poll(async () => (await character(host, hostId))?.texture).toBe('party-character');
    expect((await character(host, hostId)).number).toBe('01');
    expect((await character(host, hostId)).moving).toBe(false);

    // Refresh transfers host controls to the remaining connected player.
    await expect(guest.locator('#replay-button')).toBeVisible();
    await guest.locator('#replay-button').click();
    await expect.poll(async () => (await snapshot(host)).phase).toBe('lobby');
    for (const page of [host, guest]) {
      await expectIdle(page, hostId, 'down', 24);
      await expectIdle(page, guestId, 'down', 24);
      expect(Object.keys((await snapshot(page)).renderedCharacters)).toHaveLength(2);
    }
    await guest.locator('#start-button').click();
    await expect.poll(async () => (await snapshot(guest)).phase, { intervals: [20] }).toBe('playing');
    expect((await snapshot(guest)).round).toBe(2);
    await guest.locator('#game-container').focus();
    await guest.keyboard.down('ArrowUp');
    try {
      await expect.poll(async () => {
        const sprite = await character(guest, guestId);
        return sprite?.facing === 'up' && sprite.moving && Number(sprite.frame) >= 105 && Number(sprite.frame) <= 112;
      }, { intervals: [25], timeout: 1000 }).toBe(true);
      await guest.emulateMedia({ reducedMotion: 'reduce' });
      await expect.poll(async () => {
        const sprite = await character(guest, guestId);
        return sprite?.facing === 'up' && sprite.moving && !sprite.animating && Number(sprite.frame) === 286;
      }, { intervals: [25], timeout: 1000 }).toBe(true);
    } finally {
      await guest.keyboard.up('ArrowUp');
    }
    await expectIdle(guest, guestId, 'up', 22);
    expect(errors, 'No uncaught rendering or recovery errors').toEqual([]);
  } finally {
    await Promise.all([chrome.close(), edge.close()]);
  }
});
