import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1200, height: 820 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: process.env.STRAGGLER_TEST_BROWSER
          ? { executablePath: process.env.STRAGGLER_TEST_BROWSER }
          : {},
      },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
  },
});
