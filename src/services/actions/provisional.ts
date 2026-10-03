import type { FinanceDb } from '../../db/schema';
import { estimateUnits } from '../../domain/mfProvisional';
import { saveUserLink } from '../importPipeline';
import { provisionalNav } from '../provisional';

/**
 * Assigns a provisional MF unit entry to a scheme: re-values it at that scheme's NAV, returns it to
 * `provisional` status and remembers the choice as a `user` SIP link for later debits.
 */
export async function reassignProvisional(db: FinanceDb, id: string, schemeKey: string): Promise<void> {
  await db.transaction('rw', db.mfProvisional, db.mfSipLinks, db.transactions, db.prices, db.mfFolios, async () => {
    const row = await db.mfProvisional.get(id);
    if (row === undefined) throw new Error(`provisional ${id} not found`);
    const nav = await provisionalNav(db, schemeKey, row.date);
    await db.mfProvisional.put({
      ...row,
      schemeKey,
      status: 'provisional',
      estUnits: nav === null ? 0 : estimateUnits(row.grossPaise, nav.value),
      navDate: nav?.date ?? null,
    });
    const bankTxn = await db.transactions.get(row.bankTxnId);
    if (bankTxn !== undefined) await saveUserLink(db, bankTxn, schemeKey);
  });
}

/** Drops a provisional entry (a failed or rejected SIP). */
export async function discardProvisional(db: FinanceDb, id: string): Promise<void> {
  await db.mfProvisional.delete(id);
}
