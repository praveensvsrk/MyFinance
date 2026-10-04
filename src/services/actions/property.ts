import type { IsoDate, Paise } from '../../parsers/types';
import type { FinanceDb } from '../../db/schema';
import { upsertAccount } from '../../db/repos';
import { purchaseOf, type Purchase } from '../../domain/property';

/** One home. A second property would be a new id; the screen edits this one. */
export const PROPERTY_ACCOUNT_ID = 'property';

export interface PropertyInput {
  name: string;
  /** What the home is worth, in paise, on `date`. */
  balance: Paise;
  date: IsoDate;
  /** Compound annual change. 0 keeps the entered value until the next update. */
  annualPct: number;
  /** What it was bought for. Omitted keeps what is stored; null clears it. */
  purchase?: Purchase | null;
}

/**
 * Records a valuation of the home. The account is created the first time. Each call keeps the
 * previous valuations, and a repeat of the same date replaces that day's figure. The yearly
 * change applies from the latest valuation forward; it is not written into the snapshot itself.
 */
export async function saveProperty(db: FinanceDb, input: PropertyInput): Promise<string> {
  const name = input.name.trim().slice(0, 40) || 'Home';
  await db.transaction('rw', db.accounts, db.balanceSnapshots, async () => {
    const existing = await db.accounts.get(PROPERTY_ACCOUNT_ID);
    const { purchasePrice: _price, purchaseDate: _date, ...kept } = existing?.meta ?? {};
    const stored = purchaseOf(existing?.meta);
    const purchase = input.purchase === undefined ? stored : input.purchase;
    await upsertAccount(db, {
      id: PROPERTY_ACCOUNT_ID,
      kind: 'property',
      institution: '',
      maskedNumber: '',
      name,
      meta: {
        ...kept,
        appreciationPct: input.annualPct,
        ...(purchase === null ? {} : { purchasePrice: purchase.price, purchaseDate: purchase.date ?? '' }),
      },
    });
    await db.balanceSnapshots.put({
      accountId: PROPERTY_ACCOUNT_ID,
      date: input.date,
      balance: input.balance,
      source: 'manual',
      importId: null,
    });
  });
  return PROPERTY_ACCOUNT_ID;
}
