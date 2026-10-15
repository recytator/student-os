import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    actionTimeout: 10_000,
    baseURL: 'http://localhost:8899',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: existsSync('/usr/bin/chromium')
      ? { executablePath: '/usr/bin/chromium' }
      : undefined,
  },
  projects: [
    {
      name: 'android-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'desktop-chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: [
    {
      command:
        'npm run build && node tests/prepare-e2e.mjs && npx wrangler dev --local --port 8899 --persist-to .wrangler/e2e --var DEV_AUTH:true',
      url: 'http://localhost:8899/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
