import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSetting, setSetting } from '../../src/db/repos';
import { FinanceDb } from '../../src/db/schema';
import { runStartup } from '../../src/pwa/startup';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-startup-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

const NOW = new Date('2026-10-03T08:00:00Z');

function storage(initiallyPersisted: boolean, grant = true) {
  let persisted = initiallyPersisted;
  return {
    persisted: vi.fn(async () => persisted),
    persist: vi.fn(async () => {
      persisted = grant;
      return grant;
    }),
  };
}

const failingFetch = vi.fn(async () => {
  throw new Error('network down');
}) as unknown as typeof fetch;

describe('runStartup', () => {
  it('drops statement passwords saved by an earlier version', async () => {
    await setSetting(db, 'passwords', { sbi: 'old-pass' });
    await runStartup(db, { storage: storage(true), fetch: failingFetch, online: () => false, now: () => NOW });
    expect(await db.settings.get('passwords')).toBeUndefined();
  });

  it('asks for persistent storage once on first run and records it', async () => {
    const store = storage(false);
    const result = await runStartup(db, { storage: store, fetch: failingFetch, online: () => true, now: () => NOW });
    expect(store.persist).toHaveBeenCalledTimes(1);
    expect(result.persisted).toBe(true);
    expect(await getSetting(db, 'firstRunDone', false)).toBe(true);
    expect(await getSetting(db, 'storagePersistAsked', false)).toBe(true);
  });

  it('does not ask again once persistence is granted', async () => {
    const store = storage(true);
    await setSetting(db, 'firstRunDone', true);
    const result = await runStartup(db, { storage: store, fetch: failingFetch, online: () => true, now: () => NOW });
    expect(store.persist).not.toHaveBeenCalled();
    expect(result.persisted).toBe(true);
  });

  it('retries after first run while storage is not persisted', async () => {
    const store = storage(false, false);
    await setSetting(db, 'firstRunDone', true);
    const result = await runStartup(db, { storage: store, fetch: failingFetch, online: () => true, now: () => NOW });
    expect(store.persist).toHaveBeenCalledTimes(1);
    expect(result.persisted).toBe(false);
  });

  it('skips the price refresh while offline', async () => {
    const doFetch = vi.fn() as unknown as typeof fetch;
    const result = await runStartup(db, { storage: storage(true), fetch: doFetch, online: () => false, now: () => NOW });
    expect(result.refreshed).toBeNull();
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('does not throw when every request fails, and records the failures', async () => {
    const result = await runStartup(db, { storage: storage(true), fetch: failingFetch, online: () => true, now: () => NOW });
    expect(result.refreshed).not.toBeNull();
    expect(result.refreshed!.failed.length).toBeGreaterThan(0);
  });

  it('copes with a browser that has no storage API', async () => {
    const result = await runStartup(db, { storage: undefined, fetch: failingFetch, online: () => true, now: () => NOW });
    expect(result.persisted).toBe(false);
  });
});
