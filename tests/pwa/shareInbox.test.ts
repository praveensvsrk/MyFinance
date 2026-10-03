import { describe, expect, it } from 'vitest';
import { FILE_NAME_HEADER, INBOX_CACHE, takeSharedFiles } from '../../src/pwa/shareInbox';
import { fakeCaches } from '../helpers/fakeCaches';

async function park(storage: CacheStorage, index: number, name: string, bytes: number[]): Promise<void> {
  const cache = await storage.open(INBOX_CACHE);
  await cache.put(
    new Request(`https://app.test/__share__/${index}`),
    new Response(new Uint8Array(bytes), { headers: { [FILE_NAME_HEADER]: encodeURIComponent(name) } }),
  );
}

describe('takeSharedFiles', () => {
  it('returns parked files in order with their names, then empties the inbox', async () => {
    const storage = fakeCaches();
    await park(storage, 10, 'second statement.pdf', [4, 5]);
    await park(storage, 2, 'first é.pdf', [1, 2, 3]);

    const files = await takeSharedFiles(storage);
    expect(files.map((file) => file.name)).toEqual(['first é.pdf', 'second statement.pdf']);
    expect(Array.from(files[0]!.bytes)).toEqual([1, 2, 3]);
    expect(Array.from(files[1]!.bytes)).toEqual([4, 5]);

    expect(await takeSharedFiles(storage)).toEqual([]);
  });

  it('is empty when nothing was shared or Cache Storage is unavailable', async () => {
    expect(await takeSharedFiles(fakeCaches())).toEqual([]);
    expect(await takeSharedFiles(undefined)).toEqual([]);
  });
});
