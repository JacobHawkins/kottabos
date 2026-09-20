import { defineConfig } from '@playwright/test';

const port = Number(process.env.BROWSER_TEST_PORT || 2581);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['mobile.spec.js', 'production.spec.js', 'recovery.spec.js', 'twelve-player.spec.js'],
  timeout: 90_000,
  expect: { timeout: 12_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/production',
  use: { baseURL },
  webServer: {
    command: 'node scripts/production.js',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', RECONNECT_SECONDS: '5', COUNTDOWN_MS: '350' },
  },
});
