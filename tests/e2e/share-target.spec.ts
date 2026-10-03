import { expect, test, workbook } from './fixtures';

test('a file shared to the app lands in the import screen', async ({ page }) => {
  await page.goto('/#/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const file = workbook('Shared Benefit History.xlsx');
  // The OS submits a multipart POST to the manifest's share_target action as a page navigation;
  // a real form submission is the closest thing the browser lets a test do.
  await page.evaluate(
    ({ name, bytes, mimeType }) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.enctype = 'multipart/form-data';
      form.action = 'share-target';
      const input = document.createElement('input');
      input.type = 'file';
      input.name = 'files';
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }));
      input.files = transfer.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    },
    { name: file.name, bytes: Array.from(file.buffer), mimeType: file.mimeType },
  );

  await expect(page).toHaveURL(/#\/import$/);
  await expect(page.getByTestId('import-step')).toHaveText('preview');
  await expect(page.getByTestId('import-preview')).toContainText('Shared Benefit History.xlsx');
});
