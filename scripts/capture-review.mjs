import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.REVIEW_URL || 'http://localhost:5173';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) {
  throw new Error('This local QA capture intentionally accepts only a loopback development URL.');
}
const directory = 'artifacts/qa-review';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch(
  existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {},
);
const observations = [];
try {
  for (const [name, width, height] of [
    ['mobile', 390, 844],
    ['narrow', 320, 740],
    ['desktop', 1440, 1000],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      timezoneId: 'Europe/Warsaw',
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const screen of [
      'dashboard',
      'calendar',
      'tasks',
      'subjects',
      'documents',
      'activity',
      'settings',
    ]) {
      await page.goto(`${base}/#${screen}`);
      await page.locator('.page-content').waitFor();
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        content: document.documentElement.scrollWidth,
      }));
      observations.push({ device: name, screen, ...dimensions, errors: [...errors] });
      if (
        screen === 'dashboard' ||
        (name === 'mobile' && ['documents', 'activity'].includes(screen))
      ) {
        await page.screenshot({ path: `${directory}/${name}-${screen}.png`, fullPage: true });
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${directory}/observations.json`, JSON.stringify(observations, null, 2));
const failures = observations.filter((item) => item.content > item.viewport || item.errors.length);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(
  `Reviewed ${observations.length} real screen/viewport combinations: no horizontal overflow or uncaught browser errors. Screenshots: ${directory}`,
);
