import type { FinanceDb, TxnRow } from '../db/schema';
import type { Paise } from '../parsers/types';
import { matchesSearch } from '../domain/search';

export interface TxnSearch {
  query: string;
  /** The newest matches first, at most `limit` of them. */
  matches: TxnRow[];
  /** Every match, including any past `limit`. */
  count: number;
  /** Total paid out and received across every match. */
  out: Paise;
  in: Paise;
  /** Account names by id, for labelling rows from different accounts. */
  accountNames: Record<string, string>;
}

/** Transactions from every account and month that a search box query finds (see `matchesSearch`). */
export async function searchTransactions(db: FinanceDb, query: string, limit = 200): Promise<TxnSearch> {
  const found = (await db.transactions.toArray()).filter((txn) => matchesSearch(txn, query));
  found.sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
  const accountNames: Record<string, string> = {};
  for (const account of await db.accounts.toArray()) accountNames[account.id] = account.name;
  return {
    query,
    matches: found.slice(0, limit),
    count: found.length,
    out: found.reduce((sum, txn) => sum + Math.max(0, -txn.amount), 0),
    in: found.reduce((sum, txn) => sum + Math.max(0, txn.amount), 0),
    accountNames,
  };
}
