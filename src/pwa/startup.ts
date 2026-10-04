import type { FinanceDb } from '../db/schema';
import { getSetting, setSetting } from '../db/repos';
import { refreshPrices, type PriceRefreshResult } from '../services/prices';

export interface StartupDeps {
  fetch: typeof fetch;
  storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined;
  online: () => boolean;
  now: () => Date;
}

export interface StartupResult {
  /** Whether the browser has granted persistent storage. */
  persisted: boolean;
  /** The price refresh outcome; null when offline, throttled to nothing or it threw. */
  refreshed: PriceRefreshResult | null;
}

function browserDeps(): StartupDeps {
  return {
    fetch: (...args) => fetch(...args),
    storage: typeof navigator === 'undefined' ? undefined : navigator.storage,
    online: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    now: () => new Date(),
  };
}

/**
 * Work the app does when it opens (§5 storage, §6 prices): ask the browser to keep our data
 * (without this it may evict IndexedDB under storage pressure), then refresh prices when online.
 * Nothing here may throw; a failed price refresh is already recorded for Needs attention.
 */
export async function runStartup(db: FinanceDb, deps: Partial<StartupDeps> = {}): Promise<StartupResult> {
  const { fetch: doFetch, storage, online, now } = { ...browserDeps(), ...deps };

  let persisted = false;
  try {
    persisted = (await storage?.persisted?.()) ?? false;
    const firstRun = !(await getSetting(db, 'firstRunDone', false));
    // First run asks once; afterwards ask again only while not granted (Chrome grants silently once installed).
    if (storage?.persist && (firstRun || !persisted)) {
      persisted = await storage.persist();
      await setSetting(db, 'storagePersistAsked', true);
    }
    if (firstRun) await setSetting(db, 'firstRunDone', true);
    // Statement passwords are no longer remembered; drop any saved by an earlier version.
    await db.settings.delete('passwords');
  } catch {
    // Persistence is best effort.
  }

  let refreshed: PriceRefreshResult | null = null;
  if (online()) {
    try {
      refreshed = await refreshPrices(db, { fetch: doFetch, now: now() });
    } catch {
      refreshed = null;
    }
  }
  return { persisted, refreshed };
}

/** Runs `runStartup` now and again each time the app returns to the foreground. */
export function startOnOpen(db: FinanceDb): () => void {
  void runStartup(db);
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void runStartup(db);
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}
