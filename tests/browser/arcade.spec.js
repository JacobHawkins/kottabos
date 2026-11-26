import { chromium, expect, test } from '@playwright/test';
import { Client } from '@colyseus/sdk';

const games = { windup: 'Wind-up Rally', runner: 'Dash & Duck' };
for (const [gameId, title] of Object.entries(games)) {
  test(`${title}: phone actions, shared game state, recovery and layout`, async ({ baseURL }, testInfo) => {
    const browser = await chromium.launch({ channel: process.env.TEST_HOST_BROWSER || 'chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [], bots = [];
    page.on('pageerror', error => errors.push(error.message));
    let botLoop;
    try {
      await page.addInitScript(() => {
        window.__playedTones = [];
        const create = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
          const oscillator = create.call(this);
          const set = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
          oscillator.frequency.setValueAtTime = (value, time) => { window.__playedTones.push(value); return set(value, time); };
          return oscillator;
        };
      });
      await page.goto(baseURL);
      await page.locator('#nickname').fill('Phone');
      await page.locator('#create-party').tap();
      await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
      const code = await page.locator('#party-code').innerText();
      const id = await page.locator('.local-player').getAttribute('data-player-id');
      for (let i = 0; i < 3; i++) {
        const room = await new Client(baseURL).joinById(code, { name: `Bot ${i}` });
        for (const type of ['welcome', 'notice', 'pong']) room.onMessage(type, () => {});
        bots.push(room);
      }
      const state = () => bots[0].state;
      const me = () => state().players.get(id);
      botLoop = setInterval(() => {
        for (const [i, bot] of bots.entries()) {
          const s = bot.state, p = [...s.players.values()].find(p => p.name === `Bot ${i}`);
          if (s.phase !== 'playing' || !p?.alive) continue;
          if (s.gameId === 'runner') {
            const e = s.entities.find(e => e.due - s.roundElapsedMs > 100 && e.due - s.roundElapsedMs < 200);
            if (e) bot.send('action', { round: s.round, action: e.kind === 'hurdle' ? 'jump' : 'duck' });
          }

        }
      }, 40);
      await page.getByLabel(title, { exact: true }).check();
      await page.getByLabel('Stay on the Platform', { exact: true }).uncheck();
      await expect.poll(() => [...state().selectedGames]).toEqual([gameId]);
      await expect(page.locator('#game-choices input')).toHaveCount(4);
      await page.locator('#start-button').tap();
      await expect(page.locator('[data-choice]')).toHaveCount(3);
      await expect(page.locator('[data-choice="10"]')).toBeVisible();
      await expect(page.locator('[data-choice="1"]')).toHaveCount(0);
      await page.locator('[data-choice="3"]').tap();
      await expect(page.locator('#phase-label')).toHaveAttribute('data-phase', 'playing');
      await expect.poll(() => state().gameId).toBe(gameId);
      await expect(page.locator('#game-container canvas')).toBeVisible();
      const action = page.locator('#rope-action');
      await page.evaluate(() => { window.__playedTones = []; });
      if (gameId === 'windup') {

        await action.tap();
        await expect.poll(() => me().charge).toBe(1);
        await page.locator('#game-container').focus();
        await page.keyboard.press('Space');
        await expect.poll(() => me().charge).toBe(2);
        await page.keyboard.down('Space');
        await expect.poll(() => me().charge).toBe(3);
        await page.keyboard.down('Space'); // A repeat remains ignored after the server cooldown expires.
        await page.waitForTimeout(160);
        await page.keyboard.up('Space');
        expect(me().charge).toBe(3);
        await action.focus();
        const beforeEnter = me().charge;
        await page.keyboard.down('Enter');
        await expect.poll(() => me().charge).toBe(beforeEnter + 1);
        await page.keyboard.down('Enter'); // Repeated keydown on a focused native button.
        await page.waitForTimeout(160);
        await page.keyboard.up('Enter');
        expect(me().charge).toBe(beforeEnter + 1);
        await page.locator('#game-container').focus();
        const beforeBurst = me().charge;
        for (let i = 0; i < 6; i++) await page.keyboard.press('Space', { delay: 10 });
        await expect.poll(() => me().charge).toBe(beforeBurst + 6);
        expect(await page.evaluate(() => window.__playedTones.filter(hz => hz === 620).length)).toBe(me().charge);
      } else {
        // Space must not activate a focused native game button either.
        await action.focus();
        await page.keyboard.press('Space');
        await page.waitForTimeout(100);
        expect(me().jumpedAtMs).toBe(-1);
        await page.locator('#game-container').focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => me().jumpedAtMs).toBeGreaterThanOrEqual(0);
        await page.waitForTimeout(650);
        await page.keyboard.press('KeyS');
        await expect.poll(() => me().duckUntilMs).toBeGreaterThan(state().roundElapsedMs);
        await page.waitForTimeout(700);
        const previousJump = me().jumpedAtMs;
        await page.keyboard.press('KeyW');
        await expect.poll(() => me().jumpedAtMs).toBeGreaterThan(previousJump);
        await page.waitForTimeout(650);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => me().duckUntilMs).toBeGreaterThan(state().roundElapsedMs);
        await expect(page.locator('#runner-cue')).toContainText('NOW!', { timeout: 5000 });
        await page.screenshot({ path: testInfo.outputPath('runner-timing-zone.png') });
        await expect(action).toHaveText('Stun', { timeout: 15000 });
        const tones = await page.evaluate(() => window.__playedTones);
        expect(tones.filter(hz => hz === 280)).toHaveLength(2); // Other runners keep jumping silently.
        expect(tones.filter(hz => hz === 390)).toHaveLength(2);
        expect(tones.filter(hz => hz === 1040)).toHaveLength(3);
        expect(tones.filter(hz => hz === 310)).toHaveLength(1);
        const target = [...state().players.values()].find(p => p.alive);
        await page.locator('#game-container').focus();
        await page.keyboard.down('ArrowDown');
        await expect.poll(() => Math.abs(me().y - target.y), { intervals: [15] }).toBeLessThan(20);
        await page.keyboard.up('ArrowDown');
        await page.keyboard.press('Space');
        expect(me().actionAtMs).toBe(-10000);
        await page.keyboard.press('Enter');
        await expect.poll(() => target.stunnedUntilMs).toBeGreaterThan(0);
      }
      const round = state().round, alive = me().alive, charge = me().charge;
      await page.screenshot({ path: testInfo.outputPath(`${gameId}-phone.png`) });
      await page.reload();
      await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
      await expect(page.locator('.local-player')).toHaveAttribute('data-player-id', id);
      expect(state().round).toBe(round);
      expect(me().alive).toBe(alive);
      expect(me().charge).toBe(charge);
      for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await expect(page.locator('#game-container canvas')).toBeVisible();
        for (const selector of ['#rope-action', '#duck-action', '#joystick', '#leave-button']) {
          const el = page.locator(selector);
          if (!await el.isVisible()) continue;
          const box = await el.boundingBox();
          expect(box.y, `${selector} stays below the top edge`).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height, `${selector} stays in the viewport`).toBeLessThanOrEqual(viewport.height + 1);
        }
        await page.screenshot({ path: testInfo.outputPath(`${gameId}-${viewport.width}.png`) });
      }
      if (gameId === 'windup') {
        await expect.poll(() => state().gameStage, { timeout: 12000 }).toBe('racing');
        await expect.poll(() => me().distance).toBeGreaterThan(0);
        await expect.poll(() => me().score, { timeout: 10000 }).toBe(1);
      }
      expect(errors).toEqual([]);
      await page.locator('#leave-button').tap();
    } finally {
      clearInterval(botLoop);
      await Promise.allSettled(bots.map(room => room.leave()));
      await browser.close();
    }
  });
}

test('host selections stay checked across unrelated patches while acknowledgements are delayed', async ({ baseURL }) => {
  const browser = await chromium.launch({ channel: process.env.TEST_HOST_BROWSER || 'chrome' });
  let observer, hold = false;
  const queued = [];
  try {
    const page = await browser.newPage();
    await page.routeWebSocket('**', socket => {
      const server = socket.connectToServer();
      socket.onMessage(message => { if (hold) queued.push(() => server.send(message)); else server.send(message); });
    });
    await page.addInitScript(() => {
      const RoutedWebSocket = window.WebSocket;
      window.WebSocket = class extends RoutedWebSocket {
        constructor(url, protocols) {
          if (protocols !== undefined && typeof protocols !== 'string' && !Array.isArray(protocols)) {
            throw new DOMException('Invalid WebSocket protocols', 'SyntaxError');
          }
          super(url, protocols);
        }
      };
    });
    await page.goto(baseURL);
    await page.locator('#nickname').fill('Selection host');
    await page.locator('#create-party').click();
    await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
    observer = await new Client(baseURL).joinById(await page.locator('#party-code').innerText(), { name: 'Observer' });
    for (const type of ['welcome', 'notice', 'pong']) observer.onMessage(type, () => {});
    await expect.poll(() => [...(observer.state.selectedGames || [])]).toEqual(['platform']);
    hold = true;
    const windup = page.getByLabel('Wind-up Rally', { exact: true });
    const runner = page.getByLabel('Dash & Duck', { exact: true });
    await windup.check();
    await page.waitForTimeout(250); // Five unrelated snapshots arrive without the selection acknowledgement.
    await expect(windup).toBeChecked();
    await runner.check();
    await page.getByLabel('Stay on the Platform', { exact: true }).uncheck();
    await page.waitForTimeout(250);
    await expect(windup).toBeChecked(); await expect(runner).toBeChecked();
    expect([...observer.state.selectedGames]).toEqual(['platform']);
    hold = false;
    for (const send of queued.splice(0)) send();
    await expect.poll(() => [...observer.state.selectedGames]).toEqual(['windup', 'runner']);
    await expect(windup).toBeChecked(); await expect(runner).toBeChecked();
    await windup.uncheck();
    await expect(runner).toBeDisabled();
    await expect.poll(() => [...observer.state.selectedGames]).toEqual(['runner']);
    await page.locator('#leave-button').click();
  } finally {
    hold = false;
    await observer?.leave();
    await browser.close();
  }
});
