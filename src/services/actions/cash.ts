import type { IsoDate, Paise } from '../../parsers/types';
import type { FinanceDb } from '../../db/schema';
import { getSetting, setSetting, upsertAccount } from '../../db/repos';

export const CASH_ACCOUNT_ID = 'cash';

/**
 * Records a manually entered cash balance (§6.4 "set balance"). The `cash` account is created on
 * first use; each call adds a `manual` snapshot, so the balance history keeps every entry. A note
 * is kept per date in the `cashNotes` setting.
 */
export async function setCashBalance(
  db: FinanceDb,
  balance: Paise,
  date: IsoDate,
  note?: string,
): Promise<string> {
  await db.transaction('rw', db.accounts, db.balanceSnapshots, db.settings, async () => {
    if ((await db.accounts.get(CASH_ACCOUNT_ID)) === undefined) {
      await upsertAccount(db, {
        id: CASH_ACCOUNT_ID,
        kind: 'cash',
        institution: 'Cash',
        maskedNumber: '',
        name: 'Cash',
        meta: {},
      });
    }
    await db.balanceSnapshots.put({
      accountId: CASH_ACCOUNT_ID,
      date,
      balance,
      source: 'manual',
      importId: null,
    });
    if (note !== undefined && note.trim() !== '') {
      const notes = await getSetting<Record<string, string>>(db, 'cashNotes', {});
      await setSetting(db, 'cashNotes', { ...notes, [date]: note.trim() });
    }
  });
  return CASH_ACCOUNT_ID;
}
