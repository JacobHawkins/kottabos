import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYTEST_URL;
if (!baseURL?.startsWith('https://')) throw new Error('Set PLAYTEST_URL to the authorized HTTPS playtest origin.');
export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['production.spec.js', 'twelve-player.spec.js'],
  grep: /Chrome\/Edge invitation/,
  timeout: 150_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/remote',
  use: { baseURL },
});
