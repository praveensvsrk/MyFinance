import { TABLE_STORES, type AccountRow, type FinanceDb, type ImportRow, type PriceRow, type SnapshotRow, type TxnRow } from './schema';
import type { IsoDate } from '../parsers/types';

/** Largest ISO date, used as the open end of ascending date ranges. */
const MAX_DATE = '9999-12-31';

/** A v4 UUID; the app uses these as row ids everywhere. */
export function newId(): string {
  return crypto.randomUUID();
}

function byDateThenId(a: { date: IsoDate; id: string }, b: { date: IsoDate; id: string }): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------- accounts ----------

export async function upsertAccount(db: FinanceDb, account: AccountRow): Promise<void> {
  await db.accounts.put(account);
}

export async function listAccounts(db: FinanceDb): Promise<AccountRow[]> {
  return db.accounts.toArray();
}

// ---------- settings ----------

export async function getSetting<T>(db: FinanceDb, key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(db: FinanceDb, key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

// ---------- balance snapshots ----------

/** The newest snapshot dated on or before `onOrBefore` (any date when omitted). */
export async function latestSnapshot(
  db: FinanceDb,
  accountId: string,
  onOrBefore?: IsoDate,
): Promise<SnapshotRow | null> {
  const upper = onOrBefore ?? MAX_DATE;
  const row = await db.balanceSnapshots
    .where('[accountId+date]')
    .between([accountId, ''], [accountId, upper], true, true)
    .last();
  return row ?? null;
}

/** Every snapshot for an account, oldest first. */
export async function snapshotsFor(db: FinanceDb, accountId: string): Promise<SnapshotRow[]> {
  return db.balanceSnapshots
    .where('[accountId+date]')
    .between([accountId, ''], [accountId, MAX_DATE], true, true)
    .toArray();
}

// ---------- transactions ----------

/** Transactions of a `YYYY-MM` month, oldest first. */
export async function txnsForMonth(db: FinanceDb, month: string): Promise<TxnRow[]> {
  const rows = await db.transactions.where('date').startsWith(`${month}-`).toArray();
  return rows.sort(byDateThenId);
}

export interface TxnQueryOptions {
  limit?: number;
  offset?: number;
  /** Case-insensitive substring match on the description or reference. */
  search?: string;
}

/** One account's transactions, oldest first, optionally paged and filtered. */
export async function txnsForAccount(
  db: FinanceDb,
  accountId: string,
  options: TxnQueryOptions = {},
): Promise<TxnRow[]> {
  const offset = options.offset ?? 0;
  const search = options.search?.trim().toLowerCase();
  let collection = db.transactions
    .where('[accountId+date]')
    .between([accountId, ''], [accountId, MAX_DATE], true, true);
  if (search !== undefined && search !== '') {
    collection = collection.filter(
      (txn) =>
        txn.description.toLowerCase().includes(search) ||
        (txn.ref ?? '').toLowerCase().includes(search),
    );
  }
  const rows = await collection.toArray();
  rows.sort(byDateThenId);
  return rows.slice(offset, options.limit === undefined ? undefined : offset + options.limit);
}

// ---------- prices ----------

/** A symbol's price series, oldest first. */
export async function pricesFor(db: FinanceDb, symbol: string): Promise<PriceRow[]> {
  const rows = await db.prices.where('symbol').equals(symbol).toArray();
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Insert or replace one `[symbol+date]` price point. */
export async function putPrice(db: FinanceDb, price: PriceRow): Promise<void> {
  await db.prices.put(price);
}

// ---------- imports ----------

/** Imports, newest first. */
export async function listImports(db: FinanceDb): Promise<ImportRow[]> {
  const rows = await db.imports.orderBy('importedAt').toArray();
  return rows.reverse();
}

/** Every table that stores an `importId`. */
const IMPORT_TABLE_NAMES = (Object.keys(TABLE_STORES) as (keyof typeof TABLE_STORES)[]).filter(
  (name) => TABLE_STORES[name].split(',').some((part) => part.trim() === 'importId'),
);

/**
 * Undoes one import in a single `rw` transaction: removes its rows from every table that carries
 * an `importId`, deletes provisionals created from its transactions, then the `imports` row.
 * Rows from other imports are untouched.
 */
export async function deleteImport(db: FinanceDb, importId: string): Promise<void> {
  const tables = IMPORT_TABLE_NAMES.map((name) => db[name]);
  await db.transaction('rw', [...tables, db.mfProvisional, db.imports], async () => {
    const txnIds = await db.transactions.where('importId').equals(importId).primaryKeys();
    await db.transactions.where('importId').equals(importId).delete();
    await db.balanceSnapshots.where('importId').equals(importId).delete();
    await db.epfEntries.where('importId').equals(importId).delete();
    await db.loanYears.where('importId').equals(importId).delete();
    await db.loanEntries.where('importId').equals(importId).delete();
    await db.mfTxns.where('importId').equals(importId).delete();
    if (txnIds.length > 0) {
      await db.mfProvisional.where('bankTxnId').anyOf(txnIds).delete();
    }
    await db.imports.delete(importId);
  });
}
