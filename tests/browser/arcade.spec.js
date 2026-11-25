import { chromium, expect, test } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { DIRECTIONS } from '../../shared/arcade.js';

const games = { windup: 'Wind-up Rally', trails: 'Neon Trails', maze: 'Maze Munch', runner: 'Dash & Duck', bombs: 'Bomb Garden' };
for (const [gameId, title] of Object.entries(games)) {
  test(`${title}: phone actions, shared game state, recovery and layout`, async ({ baseURL }, testInfo) => {
    const browser = await chromium.launch({ channel: process.env.TEST_HOST_BROWSER || 'chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [], bots = [];
    page.on('pageerror', error => errors.push(error.message));
    let botLoop, seq = 0;
    try {
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
          if (s.gameId === 'trails') {
            const x = Math.floor(p.x / s.cellSize), y = Math.floor(p.y / s.cellSize);
            const options = [p.facing, (p.facing + 1) % 4, (p.facing + 3) % 4];
            const dir = options.find(d => {
              const nx = x + DIRECTIONS[d].x, ny = y + DIRECTIONS[d].y;
              return nx >= 0 && ny >= 0 && nx < s.columns && ny < s.rows && !s.cells[ny * s.columns + nx];
            });
            if (dir !== undefined) bot.send('input', { seq: ++seq, ...DIRECTIONS[dir] });
          }
        }
      }, 40);
      await page.getByLabel(title, { exact: true }).check();
      await page.getByLabel('Stay on the Platform', { exact: true }).uncheck();
      await expect.poll(() => [...state().selectedGames]).toEqual([gameId]);
      await page.locator('#start-button').tap();
      await expect(page.locator('[data-choice]')).toHaveCount(3);
      await expect(page.locator('[data-choice="10"]')).toBeVisible();
      await expect(page.locator('[data-choice="1"]')).toHaveCount(0);
      await page.locator('[data-choice="3"]').tap();
      await expect(page.locator('#phase-label')).toHaveAttribute('data-phase', 'playing');
      await expect.poll(() => state().gameId).toBe(gameId);
      await expect(page.locator('#game-container canvas')).toBeVisible();
      const action = page.locator('#rope-action');
      if (gameId === 'windup') {
        await action.tap();
        await expect.poll(() => me().charge).toBe(1);
        await page.locator('#game-container').focus();
        await page.keyboard.press('Space');
        await expect.poll(() => me().charge).toBe(2);
        await page.keyboard.down('Space');
        await page.waitForTimeout(120);
        await page.keyboard.up('Space');
        expect(me().charge).toBeLessThanOrEqual(3);
      } else if (gameId === 'maze') {
        const before = me().x;
        await page.locator('#game-container').focus();
        await page.keyboard.down('ArrowRight');
        await expect.poll(() => me().x).toBeGreaterThan(before);
        await page.keyboard.up('ArrowRight');
        await expect.poll(() => me().collected).toBeGreaterThan(0);
      } else if (gameId === 'bombs') {
        await action.tap();
        await expect.poll(() => state().entities.filter(e => e.kind === 'bomb').length).toBe(1);
        await expect(action).toHaveText('Random bomb');
        await action.tap();
        await expect.poll(() => state().entities.some(e => e.kind === 'bomb' && e.owner === id)).toBe(true);
      } else if (gameId === 'trails') {
        await page.locator('#game-container').focus();
        await page.keyboard.down('ArrowUp');
        await expect(action).toHaveText('Erase');
        await page.keyboard.up('ArrowUp');
        await action.tap();
        await expect.poll(() => me().actionAtMs).toBeGreaterThan(0);
      } else {
        await action.tap();
        await expect.poll(() => me().jumpedAtMs).toBeGreaterThanOrEqual(0);
        await page.waitForTimeout(650);
        await page.locator('#duck-action').tap();
        await expect.poll(() => me().duckUntilMs).toBeGreaterThan(state().roundElapsedMs);
        await expect(action).toHaveText('Stun', { timeout: 15000 });
        const target = [...state().players.values()].find(p => p.alive);
        await page.locator('#game-container').focus();
        await page.keyboard.down('ArrowDown');
        await expect.poll(() => Math.abs(me().y - target.y), { intervals: [15] }).toBeLessThan(20);
        await page.keyboard.up('ArrowDown');
        await action.tap();
        await expect.poll(() => target.stunnedUntilMs).toBeGreaterThan(0);
      }
      const round = state().round, alive = me().alive, charge = me().charge, collected = me().collected;
      await page.screenshot({ path: testInfo.outputPath(`${gameId}-phone.png`) });
      await page.reload();
      await expect(page.locator('#connection-status')).toHaveAttribute('data-state', 'connected');
      await expect(page.locator('.local-player')).toHaveAttribute('data-player-id', id);
      expect(state().round).toBe(round);
      expect(me().alive).toBe(alive);
      expect(me().charge).toBe(charge);
      expect(me().collected).toBeGreaterThanOrEqual(collected);
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
    const maze = page.getByLabel('Maze Munch', { exact: true });
    const bombs = page.getByLabel('Bomb Garden', { exact: true });
    await maze.check();
    await page.waitForTimeout(250); // Five unrelated snapshots arrive without the selection acknowledgement.
    await expect(maze).toBeChecked();
    await bombs.check();
    await page.getByLabel('Stay on the Platform', { exact: true }).uncheck();
    await page.waitForTimeout(250);
    await expect(maze).toBeChecked(); await expect(bombs).toBeChecked();
    expect([...observer.state.selectedGames]).toEqual(['platform']);
    hold = false;
    for (const send of queued.splice(0)) send();
    await expect.poll(() => [...observer.state.selectedGames]).toEqual(['maze', 'bombs']);
    await expect(maze).toBeChecked(); await expect(bombs).toBeChecked();
    await page.locator('#leave-button').click();
  } finally {
    hold = false;
    await observer?.leave();
    await browser.close();
  }
});
