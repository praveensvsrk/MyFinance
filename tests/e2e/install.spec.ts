import { expect, test } from './fixtures';

test('Chrome considers the app installable', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    return href === undefined ? null : ((await (await fetch(href)).json()) as Record<string, unknown>);
  });
  expect(manifest).toMatchObject({ display: 'standalone', share_target: { action: 'share-target', method: 'POST' } });

  // Chrome's own installability engine (Lighthouse 12 no longer has installability audits).
  const client = await context.newCDPSession(page);
  const { installabilityErrors } = await client.send('Page.getInstallabilityErrors');
  // Playwright runs in an incognito-style profile, which can never install anything; every other
  // problem (manifest, icons, start_url, display mode) is a real failure.
  expect(installabilityErrors.filter((error) => error.errorId !== 'in-incognito')).toEqual([]);
});
