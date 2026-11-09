import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1200, height: 820 },
    launchOptions: process.env.MIR_TEST_BROWSER
      ? { executablePath: process.env.MIR_TEST_BROWSER }
      : {},
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
  },
});
