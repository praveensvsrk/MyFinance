/**
 * Regenerates the README screenshots from made-up data (see seed.ts).
 *
 *   npm run screenshots
 *
 * Starts the dev server, opens the app in a phone-sized browser, fills its database with the demo
 * person and saves one PNG per screen into assets/screenshots/. No real data is involved and the
 * network is blocked. Set CHROME_PATH to use a specific Chromium; otherwise the installed Chrome is used.
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, devices, type Page } from '@playwright/test';
import { DEMO_TODAY } from './seed';

const PORT = 5199;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = 'assets/screenshots';

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(ORIGIN)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('The dev server did not start');
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
try {
  await waitForServer();
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
  );
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    // Taller than a real phone, so each screen shows the part that matters without scrolling.
    viewport: { width: 412, height: 1160 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
  const page = await context.newPage();
  // Pin "today" so the same dates, balances and "as of" labels come out on every run.
  await page.clock.setFixedTime(new Date(`${DEMO_TODAY}T10:30:00+05:30`));
  // No outside requests; the price refresh is also switched off by the seeded data.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  // A headless browser never grants persistent storage; a real install would have it. (A string, not
  // a function, because tsx adds helpers to functions that do not exist in the browser.)
  await page.addInitScript({
    content: `
      Object.defineProperty(navigator.storage, 'persisted', { value: async () => true, configurable: true });
      Object.defineProperty(navigator.storage, 'persist', { value: async () => true, configurable: true });
    `,
  });

  await page.goto(`${ORIGIN}/#/`);
  // Run inside the page, so the seed writes to the same database object the app uses. A string,
  // because these paths exist only for the dev server, not for TypeScript.
  await page.evaluate(`(async () => {
    const { db } = await import('/src/ui/db.ts');
    const { seedDemo } = await import('/scripts/demo/seed.ts');
    await seedDemo(db);
  })()`);
  await page.reload();

  const shots: { name: string; hash: string; ready: string; prepare?: (page: Page) => Promise<void> }[] = [
    { name: 'home', hash: '/', ready: '[data-testid=trend-chart]' },
    { name: 'cash-flow', hash: '/cash-flow', ready: 'text=Where it went' },
    {
      name: 'investments',
      hash: '/accounts/mf',
      ready: 'text=Portfolio',
      prepare: async (p) => {
        await p.getByRole('button', { name: '12M' }).click();
      },
    },
    {
      name: 'plan',
      hash: '/plan',
      ready: '#extra-monthly',
      prepare: async (p) => {
        await p.locator('#extra-monthly').fill('10000');
        await p.locator('#lump-sum').fill('200000');
        await p.evaluate('document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)');
      },
    },
  ];
  for (const shot of shots) {
    await page.goto(`${ORIGIN}/#${shot.hash}`);
    await page.waitForSelector(shot.ready);
    await shot.prepare?.(page);
    await settle(page);
    await page.screenshot({ path: `${OUT}/${shot.name}.png` });
    console.log(`saved ${OUT}/${shot.name}.png`);
  }
  await browser.close();
} finally {
  server.kill();
}
