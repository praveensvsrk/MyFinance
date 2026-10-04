import Dexie, { type IndexableType, type Table } from 'dexie';
import {
  TABLE_STORES,
  type AccountRow,
  type FinanceDb,
  type ImportRow,
  type PriceRow,
  type SnapshotRow,
  type TableName,
  type TxnRow,
} from './schema';
import { categorise, type Rule } from '../domain/categorise';
import type { IsoDate } from '../parsers/types';
import { EQUITY_SYMBOL_SETTING } from '../config';

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

/** The employer stock's ticker as read from the imported E*TRADE files; '' until one is imported. */
export async function equitySymbol(db: FinanceDb): Promise<string> {
  const value = await getSetting<unknown>(db, EQUITY_SYMBOL_SETTING, '');
  return typeof value === 'string' ? value : '';
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

/** Transactions from `from` through `to`, inclusive, oldest first. */
export async function txnsBetween(db: FinanceDb, from: IsoDate, to: IsoDate): Promise<TxnRow[]> {
  const rows = await db.transactions.where('date').between(from, to, true, true).toArray();
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

/** Every table that indexes an `importId`. */
const IMPORT_TABLE_NAMES = (Object.keys(TABLE_STORES) as TableName[]).filter((name) =>
  TABLE_STORES[name].split(',').some((part) => part.trim() === 'importId'),
);

/** True for tables whose rows an undo finds by the `importId` index. */
export function isImportIndexed(name: TableName): boolean {
  return IMPORT_TABLE_NAMES.includes(name);
}

/** The primary key of `row` in `table`, for tables with an inbound key path. */
export function primaryKeyOf(table: Table<unknown, IndexableType>, row: unknown): IndexableType {
  const keyPath = table.schema.primKey.keyPath;
  const source = row as object;
  if (Array.isArray(keyPath)) return keyPath.map((path) => Dexie.getByKeyPath(source, path));
  return Dexie.getByKeyPath(source, keyPath as string);
}

/** A counterpart's kind once its pairing is gone: what the rules say, as when it was imported. */
export async function unpairCounterparts(db: FinanceDb, deletedIds: string[]): Promise<void> {
  const counterparts = await db.transactions.where('transferPairId').anyOf(deletedIds).toArray();
  if (counterparts.length === 0) return;
  const rules = (await db.rules.toArray()).sort((a, b) => b.priority - a.priority) as Rule[];
  for (const row of counterparts) {
    const { kind } = categorise({ description: row.description, amount: row.amount, accountId: row.accountId }, rules);
    await db.transactions.update(row.id, { kind, transferPairId: null });
  }
}

/**
 * Undoes one import in a single `rw` transaction. Removes its rows from every table that indexes an
 * `importId`; deletes provisionals created from its bank rows and unpairs their transfer
 * counterparts; resets provisionals that its CAS rows had confirmed; then reverses what it did to
 * tables without an `importId` index: the rows it inserted (unless a later import has since replaced
 * them) and the rows its `replace` step deleted (unless a later import has since re-created them).
 * Rows from other imports are untouched.
 */
export async function deleteImport(db: FinanceDb, importId: string): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const importRow = await db.imports.get(importId);
    const txnIds = await db.transactions.where('importId').equals(importId).primaryKeys();
    const mfTxnIds = await db.mfTxns.where('importId').equals(importId).primaryKeys();

    for (const name of IMPORT_TABLE_NAMES) {
      await db.table(name).where('importId').equals(importId).delete();
    }
    if (txnIds.length > 0) {
      await db.mfProvisional.where('bankTxnId').anyOf(txnIds).delete();
      await unpairCounterparts(db, txnIds);
    }
    if (mfTxnIds.length > 0) {
      const confirmed = await db.mfProvisional.where('status').equals('confirmed').toArray();
      const reset = confirmed
        .filter((p) => p.confirmedByMfTxnId !== undefined && mfTxnIds.includes(p.confirmedByMfTxnId))
        .map(({ confirmedByMfTxnId: _removed, ...p }) => ({ ...p, status: 'provisional' as const }));
      if (reset.length > 0) await db.mfProvisional.bulkPut(reset);
    }

    const undo = importRow?.undo;
    if (undo) {
      for (const [name, keys] of Object.entries(undo.inserted) as [TableName, unknown[]][]) {
        const table = db.table(name);
        for (const key of keys) {
          const current = (await table.get(key as IndexableType)) as { importId?: string } | undefined;
          if (current?.importId === importId) await table.delete(key as IndexableType);
        }
      }
      for (const [name, rows] of Object.entries(undo.replaced) as [TableName, unknown[]][]) {
        const table = db.table(name);
        for (const row of rows) {
          if ((await table.get(primaryKeyOf(table, row))) === undefined) await table.put(row);
        }
      }
    }
    await db.imports.delete(importId);
  });
}
