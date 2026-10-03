import { EXPECTED_NET_WORTH, expect, homeNetWorth, importWorkbook, test } from './fixtures';

test('importing a statement shows its figures on Home, and undo removes them', async ({ page }) => {
  expect(await homeNetWorth(page)).toBe(0);

  await importWorkbook(page);
  await expect(page.getByTestId('import-history')).toContainText('E*TRADE Benefit History');
  expect(await homeNetWorth(page)).toBe(EXPECTED_NET_WORTH);

  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('import-history')).not.toContainText('E*TRADE');
  expect(await homeNetWorth(page)).toBe(0);
});

test('the app reloads offline and still shows the stored figures', async ({ page, context }) => {
  await importWorkbook(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // A page is only controlled by the worker from its next load.
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Import' })).toBeVisible();
  expect(await homeNetWorth(page)).toBe(EXPECTED_NET_WORTH);

  await page.goto('/#/accounts');
  await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
});
