/**
 * Handles the Web Share Target POST (`share-target`): parks each shared file in the share inbox
 * and redirects to the import screen. Kept free of service-worker globals so it can be unit tested.
 */

import { FILE_NAME_HEADER, INBOX_CACHE, INBOX_PREFIX, inboxIndex } from './shareInbox';

export async function handleShare(
  request: Request,
  cacheStorage: CacheStorage,
  scopeUrl: string,
): Promise<Response> {
  const destination = new URL('#/import', scopeUrl).href;
  try {
    const form = await request.formData();
    const cache = await cacheStorage.open(INBOX_CACHE);
    const existing = (await cache.keys()).map((key) => inboxIndex(key.url)).filter(Number.isFinite);
    let next = existing.length === 0 ? 0 : Math.max(...existing) + 1;
    for (const value of form.getAll('files')) {
      if (typeof value === 'string') continue;
      const file = value as File;
      await cache.put(
        new Request(new URL(`${INBOX_PREFIX}${next}`, scopeUrl).href),
        new Response(await file.arrayBuffer(), {
          headers: { [FILE_NAME_HEADER]: encodeURIComponent(file.name || 'shared-file') },
        }),
      );
      next += 1;
    }
  } catch {
    // A malformed share still lands on the import screen, which simply shows nothing to import.
  }
  return Response.redirect(destination, 303);
}
