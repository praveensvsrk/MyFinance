import type { FinanceDb } from '../../db/schema';
import { unpairCounterparts } from '../../db/repos';
import { EQUITY_SYMBOL_SETTING } from '../../config';

/** Import sources whose file feeds a single, fixed account rather than one keyed by its own id. */
const SOURCES_OF_FIXED_ACCOUNT: Record<string, string[]> = {
  mf: ['cas'],
  equity: ['etrade-xlsx', 'etrade-stmt'],
};

/**
 * Deletes an account and everything stored for it, and forgets the import record of every file that
 * fed it, so importing the same file again brings the account and its rows back (a file already on
 * record is refused as a duplicate). Rows of other accounts that came from the same file stay.
 * Manually entered accounts (cash, home) have no file, so for them the delete is final.
 * One `rw` transaction: a throw leaves everything as it was.
 */
export async function deleteAccount(db: FinanceDb, id: string): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const account = await db.accounts.get(id);
    if (account === undefined) return;

    const importIds = new Set<string>();
    const note = (rows: { importId?: string | null }[]): void => {
      for (const row of rows) if (row.importId) importIds.add(row.importId);
    };

    const snapshots = await db.balanceSnapshots.where('accountId').equals(id).toArray();
    note(snapshots);
    await db.balanceSnapshots.where('accountId').equals(id).delete();

    const txns = await db.transactions.where('accountId').equals(id).toArray();
    if (txns.length > 0) {
      note(txns);
      const txnIds = txns.map((txn) => txn.id);
      await db.transactions.where('accountId').equals(id).delete();
      await db.mfProvisional.where('bankTxnId').anyOf(txnIds).delete();
      await unpairCounterparts(db, txnIds);
    }
    await db.mfSipLinks.filter((link) => link.accountId === id).delete();

    note(await db.loanYears.where('accountId').equals(id).toArray());
    await db.loanYears.where('accountId').equals(id).delete();
    note(await db.loanEntries.where('accountId').equals(id).toArray());
    await db.loanEntries.where('accountId').equals(id).delete();

    if (account.kind === 'epf') {
      note(await db.epfEntries.where('accountId').equals(id).toArray());
      // The inferred transfer rows an import added to other EPF accounts mean nothing without it.
      for (const importId of importIds) await db.epfEntries.where('importId').equals(importId).delete();
      await db.epfEntries.where('accountId').equals(id).delete();
    }

    if (account.kind === 'mf') {
      note(await db.mfTxns.toArray());
      await Promise.all([db.mfFolios.clear(), db.mfTxns.clear(), db.mfProvisional.clear(), db.mfSipLinks.clear()]);
    }

    if (account.kind === 'equity') {
      await Promise.all([db.equityGrants.clear(), db.vests.clear(), db.equityLots.clear()]);
      await db.settings.bulkDelete([EQUITY_SYMBOL_SETTING, 'etradeMismatch']);
    }

    const sources = SOURCES_OF_FIXED_ACCOUNT[account.kind];
    if (sources !== undefined) {
      for (const row of await db.imports.where('source').anyOf(sources).toArray()) importIds.add(row.id);
    }
    await db.imports.bulkDelete([...importIds]);

    for (const goal of await db.goals.toArray()) {
      if (goal.linkedAccountIds.includes(id)) {
        await db.goals.update(goal.id, { linkedAccountIds: goal.linkedAccountIds.filter((linked) => linked !== id) });
      }
    }
    await db.accounts.delete(id);
  });
}
