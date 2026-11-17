import { defineConfig } from '@playwright/test';

const browserName = process.env.STRAGGLER_TEST_BROWSER ?? 'webkit';
if (browserName !== 'webkit' && browserName !== 'chromium')
  throw new Error('STRAGGLER_TEST_BROWSER must be webkit or chromium.');

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/browser',
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : undefined,
  retries: 0,
  reporter: process.env.CI
    ? [['line'], ['json', { outputFile: 'test-results/browser/results.json' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1200, height: 820 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: browserName, use: { browserName } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
  },
});
