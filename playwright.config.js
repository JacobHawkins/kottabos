import { defineConfig } from '@playwright/test';

const port = Number(process.env.BROWSER_TEST_PORT || 2579);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  testIgnore: ['production.spec.js'],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results',
  use: { baseURL },
  webServer: {
    command: 'node scripts/dev.js',
    url: `${baseURL}/api/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      RECONNECT_SECONDS: '4',
      COUNTDOWN_MS: '350',
      ROUND_DURATION_MS: '20000',
    },
  },
});
