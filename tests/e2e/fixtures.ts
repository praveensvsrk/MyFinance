import { expect, test as base, type Page } from '@playwright/test';
import { buildBenefitHistoryXlsx, SYNTHETIC_HELD_SHARES } from '../helpers/syntheticBenefitHistory';

/** ACME price (USD) and USDINR the mocked APIs return, so figures are computable in the test. */
export const ACME_USD = 300;
export const USDINR = 85;
/** Released shares × price × rate, in paise: 6 × $300 × ₹85 = ₹1,53,000. */
export const EXPECTED_NET_WORTH = SYNTHETIC_HELD_SHARES * ACME_USD * 100 * USDINR;

export function workbook(name = 'BenefitHistory.xlsx') {
  return {
    name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(buildBenefitHistoryXlsx()),
  };
}

/** Every external price API is answered locally: the suite never touches the network. */
async function mockPriceApis(page: Page): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/finnhub.io/**', (route) =>
    route.fulfill(json({ c: ACME_USD, t: Math.floor(Date.now() / 1000) })),
  );
  await page.route('**/api.frankfurter.dev/**', (route) =>
    route.fulfill(json({ date: today, rates: { INR: USDINR } })),
  );
  await page.route('**/open.er-api.com/**', (route) =>
    route.fulfill(json({ rates: { INR: USDINR }, time_last_update_unix: Math.floor(Date.now() / 1000) })),
  );
  await page.route('**/api.mfapi.in/**', (route) => route.fulfill(json([])));
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await mockPriceApis(page);
    await use(page);
  },
});

export { expect };

/** Reads the Home hero's net worth in paise; 0 on the first-run screen, before anything is imported. */
export async function homeNetWorth(page: Page): Promise<number> {
  await page.goto('/#/');
  const hero = page.getByTestId('net-worth');
  const firstRun = page.getByRole('heading', { name: 'Import your first statement' });
  await expect(hero.or(firstRun)).toBeVisible();
  if (await firstRun.isVisible()) return 0;
  return Number(await hero.getAttribute('data-paise'));
}

/** Saves a Finnhub key (which fetches the mocked prices), then imports the synthetic workbook. */
export async function importWorkbook(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByLabel('Finnhub API key').fill('test-key');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByTestId('key-status')).toHaveText('Prices updated');

  await page.goto('/#/import');
  await page.getByLabel('Choose statements').setInputFiles(workbook());
  await expect(page.getByTestId('import-step')).toHaveText('preview');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByTestId('import-step')).toHaveText('done');
}
