import type { FinanceDb } from '../db/schema';
import type { IsoDate, Paise } from '../parsers/types';
import { getSetting } from '../db/repos';
import { normaliseDescription } from '../domain/categorise';
import { findRecurring, type Recurring } from '../domain/recurring';
import { rulePatternFor } from './actions/rules';

export type { Recurring } from '../domain/recurring';

/** Settings key for the payees the user said are not recurring. */
export const RECURRING_DISMISSED_KEY = 'recurringDismissed';

export interface RecurringSummary {
  items: Recurring[];
  /** What `items` come to per month. */
  perMonth: Paise;
  /** How many the user hid as not recurring. */
  hidden: number;
}

/**
 * The payee a narration pays, with numbers taken out so a reference that changes every month
 * (`NACH DR HDFC LIFE 48213`) still groups with the rest.
 */
export function recurringPayee(description: string): string {
  const merchant = rulePatternFor(description) ?? normaliseDescription(description);
  const key = merchant.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
  return key.length >= 3 ? key : merchant;
}

/** Recurring payments from every account (see `findRecurring`), less the ones the user hid. */
export async function recurringPayments(db: FinanceDb, today: IsoDate): Promise<RecurringSummary> {
  const rows = await db.transactions.toArray();
  const asOf = rows.reduce<IsoDate>((latest, txn) => (txn.date > latest ? txn.date : latest), '');
  const payments = rows
    .filter((txn) => txn.amount < 0 && txn.kind !== 'transfer')
    .map((txn) => ({ payee: recurringPayee(txn.description), date: txn.date, amount: -txn.amount, category: txn.category }));
  const dismissed = new Set(await getSetting<string[]>(db, RECURRING_DISMISSED_KEY, []));
  const all = findRecurring(payments, asOf, today);
  const items = all.filter((item) => !dismissed.has(item.payee));
  return { items, perMonth: items.reduce((sum, item) => sum + item.perMonth, 0), hidden: all.length - items.length };
}
