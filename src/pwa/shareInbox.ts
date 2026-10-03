/**
 * The share inbox: files shared to the installed app (Web Share Target) are parked by the service
 * worker in a Cache Storage entry, because a POST body cannot be handed to a page directly. The
 * app drains the inbox when it opens. The service worker and the page share these constants.
 */

export const INBOX_CACHE = 'myfinance-share-inbox';
export const INBOX_PREFIX = '/__share__/';
/** The original file name, URI-encoded because header values must be Latin-1. */
export const FILE_NAME_HEADER = 'x-file-name';

export interface SharedFile {
  name: string;
  bytes: Uint8Array;
}

/** Index in the key's path, or NaN. */
export function inboxIndex(url: string): number {
  const path = new URL(url, 'http://inbox.invalid').pathname;
  return Number(path.slice(path.lastIndexOf('/') + 1));
}

/** Reads and removes every parked file, oldest first. Returns [] when Cache Storage is missing. */
export async function takeSharedFiles(
  cacheStorage: CacheStorage | undefined = globalThis.caches,
): Promise<SharedFile[]> {
  if (cacheStorage === undefined) return [];
  const cache = await cacheStorage.open(INBOX_CACHE);
  const keys = (await cache.keys()).filter((request) => new URL(request.url).pathname.includes(INBOX_PREFIX));
  keys.sort((a, b) => inboxIndex(a.url) - inboxIndex(b.url));
  const files: SharedFile[] = [];
  for (const key of keys) {
    const response = await cache.match(key);
    if (response !== undefined) {
      const encoded = response.headers.get(FILE_NAME_HEADER) ?? '';
      files.push({
        name: encoded === '' ? 'shared-file' : decodeURIComponent(encoded),
        bytes: new Uint8Array(await response.arrayBuffer()),
      });
    }
    await cache.delete(key);
  }
  return files;
}
