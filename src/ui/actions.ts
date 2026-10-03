import { useMemo } from 'react';
import { setCashBalance } from '../services/actions/cash';
import { deleteGoal, saveGoal } from '../services/actions/goals';
import { discardProvisional, reassignProvisional } from '../services/actions/provisional';
import { deleteRule, recategorise } from '../services/actions/rules';
import { clearPassword, saveFinnhubKey, savePassword, savePlanDefaults } from '../services/actions/settings';
import { exportBackup, restoreBackup } from '../services/backup';
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
      setCashBalance: (balance: number, date: string, note?: string) => setCashBalance(db, balance, date, note),
      recategorise: (txnId: string, category: string, opts: { applyToAll: boolean }) =>
        recategorise(db, txnId, category, opts),
      saveGoal: (goal: Parameters<typeof saveGoal>[1]) => saveGoal(db, goal),
      deleteGoal: (id: string) => deleteGoal(db, id),
      savePlanDefaults: (defaults: Parameters<typeof savePlanDefaults>[1]) => savePlanDefaults(db, defaults),
      reassignProvisional: (id: string, schemeKey: string) => reassignProvisional(db, id, schemeKey),
      discardProvisional: (id: string) => discardProvisional(db, id),
      deleteRule: (id: string) => deleteRule(db, id),
      exportBackup: (passphrase: string) => exportBackup(db, passphrase),
      async restoreBackup(bytes: Uint8Array, passphrase: string) {
        const result = await restoreBackup(db, bytes, passphrase);
        refresh();
        return result;
      },
    }),
    [db, refresh],
  );
}
