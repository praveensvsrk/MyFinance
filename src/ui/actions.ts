import { useMemo } from 'react';
import { clearPassword, saveFinnhubKey, savePassword } from '../services/actions/settings';
import { refreshPrices } from '../services/prices';
import { useApp } from './AppContext';

/**
 * Write actions for screens, bound to the app's database. Screens call these; they never touch
 * Dexie directly. Each one refreshes live queries by itself (Dexie live queries re-run on write).
 */
export function useActions() {
  const { db, refresh } = useApp();
  return useMemo(
    () => ({
      /**
       * Stores the Finnhub key and fetches prices straight away: the 20 h window must not make a
       * newly entered key wait a day before ACME is valued.
       */
      async saveFinnhubKeyAndRefresh(key: string) {
        await saveFinnhubKey(db, key);
        const result = await refreshPrices(db, { fetch: (...args) => fetch(...args), force: true });
        refresh();
        return result;
      },
      savePassword: (source: Parameters<typeof savePassword>[1], password: string) =>
        savePassword(db, source, password),
      clearPassword: (source: Parameters<typeof clearPassword>[1]) => clearPassword(db, source),
    }),
    [db, refresh],
  );
}
