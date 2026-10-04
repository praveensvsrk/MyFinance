import { useMemo } from 'react';
import { deleteAccount } from '../services/actions/accounts';
import { setCashBalance } from '../services/actions/cash';
import { addCategory, deleteCategory, setCategoryExcluded } from '../services/actions/categories';
import { saveProperty, type PropertyInput } from '../services/actions/property';
import { deleteGoal, saveGoal } from '../services/actions/goals';
import { discardProvisional, reassignProvisional } from '../services/actions/provisional';
import { deleteRule, moveRule, recategorise, saveRule, setRuleEnabled } from '../services/actions/rules';
import { saveFinnhubKey, savePlanDefaults } from '../services/actions/settings';
import { saveManualAccount } from '../services/actions/manualAccount';
import { clearAllData, loadSampleData } from '../services/actions/sample';
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
      setCashBalance: (balance: number, date: string, note?: string) => setCashBalance(db, balance, date, note),
      saveManualAccount: (input: Parameters<typeof saveManualAccount>[1]) => saveManualAccount(db, input),
      deleteAccount: (id: string) => deleteAccount(db, id),
      saveProperty: (input: PropertyInput) => saveProperty(db, input),
      recategorise: (txnId: string, category: string, opts: { applyToAll: boolean }) =>
        recategorise(db, txnId, category, opts),
      saveGoal: (goal: Parameters<typeof saveGoal>[1]) => saveGoal(db, goal),
      deleteGoal: (id: string) => deleteGoal(db, id),
      savePlanDefaults: (defaults: Parameters<typeof savePlanDefaults>[1]) => savePlanDefaults(db, defaults),
      reassignProvisional: (id: string, schemeKey: string) => reassignProvisional(db, id, schemeKey),
      discardProvisional: (id: string) => discardProvisional(db, id),
      deleteRule: (id: string) => deleteRule(db, id),
      addCategory: (name: string, excluded: boolean) => addCategory(db, name, excluded),
      setCategoryExcluded: (name: string, excluded: boolean) => setCategoryExcluded(db, name, excluded),
      deleteCategory: (name: string) => deleteCategory(db, name),
      saveRule: (draft: Parameters<typeof saveRule>[1], opts: Parameters<typeof saveRule>[2]) =>
        saveRule(db, draft, opts),
      setRuleEnabled: (id: string, enabled: boolean) => setRuleEnabled(db, id, enabled),
      moveRule: (id: string, direction: 'up' | 'down') => moveRule(db, id, direction),
      exportBackup: (passphrase: string) => exportBackup(db, passphrase),
      async restoreBackup(bytes: Uint8Array, passphrase: string) {
        const result = await restoreBackup(db, bytes, passphrase);
        refresh();
        return result;
      },
      async loadSampleData() {
        await loadSampleData(db);
        refresh();
      },
      async clearAllData() {
        await clearAllData(db);
        refresh();
      },
    }),
    [db, refresh],
  );
}
