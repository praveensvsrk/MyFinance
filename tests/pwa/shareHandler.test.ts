import { describe, expect, it } from 'vitest';
import { handleShare } from '../../src/pwa/shareHandler';
import { takeSharedFiles } from '../../src/pwa/shareInbox';
import { fakeCaches } from '../helpers/fakeCaches';

const SCOPE = 'https://user.github.io/MyFinance/';

function shareRequest(files: File[]): Request {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  return new Request(`${SCOPE}share-target`, { method: 'POST', body: form });
}

describe('handleShare', () => {
  it('parks every shared file and redirects to the import screen', async () => {
    const storage = fakeCaches();
    const response = await handleShare(
      shareRequest([
        new File([new Uint8Array([1, 2, 3])], 'first.pdf'),
        new File([new Uint8Array([9])], 'Benefit History é.xlsx'),
      ]),
      storage,
      SCOPE,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(`${SCOPE}#/import`);

    const files = await takeSharedFiles(storage);
    expect(files.map((file) => file.name)).toEqual(['first.pdf', 'Benefit History é.xlsx']);
    expect(Array.from(files[0]!.bytes)).toEqual([1, 2, 3]);
  });

  it('appends to files that are already waiting', async () => {
    const storage = fakeCaches();
    await handleShare(shareRequest([new File([new Uint8Array([1])], 'a.pdf')]), storage, SCOPE);
    await handleShare(shareRequest([new File([new Uint8Array([2])], 'b.pdf')]), storage, SCOPE);
    expect((await takeSharedFiles(storage)).map((file) => file.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('still redirects when the body is not a form', async () => {
    const response = await handleShare(
      new Request(`${SCOPE}share-target`, { method: 'POST', body: 'nonsense' }),
      fakeCaches(),
      SCOPE,
    );
    expect(response.status).toBe(303);
  });
});
