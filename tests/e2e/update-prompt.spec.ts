import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { expect, test } from './fixtures';

const DIST = join(process.cwd(), 'dist');
const PORT = 4180;
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

let server: Server;
let version = 1;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://x').pathname;
      const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
      try {
        let body = await readFile(file.startsWith(DIST) ? file : join(DIST, 'index.html'));
        // A changed byte in sw.js is all the browser needs to treat it as a new version.
        if (path === '/sw.js' && version > 1) body = Buffer.concat([body, Buffer.from(`\n// version ${version}`)]);
        response.writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('a new version waits for the user, then takes over on Reload', async ({ page }) => {
  version = 1;
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByText('Update available')).toHaveCount(0);

  version = 2;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await expect(page.getByText('Update available')).toBeVisible();
  // Nothing has taken over yet: the old worker is still active while the new one waits.
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting != null)).toBe(true);

  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByText('Update available')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting != null))
    .toBe(false);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
});
