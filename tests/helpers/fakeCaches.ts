/** A minimal in-memory `CacheStorage` for tests (Request keys, Response values). */
class FakeCache {
  private entries = new Map<string, Response>();

  async put(request: Request | string, response: Response): Promise<void> {
    this.entries.set(new Request(request).url, response.clone());
  }

  async match(request: Request | string): Promise<Response | undefined> {
    return this.entries.get(new Request(request).url)?.clone();
  }

  async delete(request: Request | string): Promise<boolean> {
    return this.entries.delete(new Request(request).url);
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

export class FakeCacheStorage {
  private caches = new Map<string, FakeCache>();

  async open(name: string): Promise<Cache> {
    let cache = this.caches.get(name);
    if (cache === undefined) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache as unknown as Cache;
  }
}

export function fakeCaches(): CacheStorage {
  return new FakeCacheStorage() as unknown as CacheStorage;
}
