import type { IsoDate, ParseOptions, ParseOutcome, ParsedFile, SourceId, Validation } from '../parsers';
import type { BankStatement } from '../parsers/types';
import { parseFile } from '../parsers';
import type { AccountRow, FinanceDb, TableName } from '../db/schema';
import { deleteImport, getSetting, newId, setSetting, upsertAccount } from '../db/repos';
import { addDays, todayIso } from '../domain/dates';
import { matchTransfers } from '../domain/transfers';
import { sha256Hex } from './hash';
import { mapBank } from './mappers/bank';

export { deleteImport as undoImport } from '../db/repos';

/** Everything a mapper produces for one parsed file, before dedupe and commit. */
export interface Mapped {
  tables: Partial<Record<TableName, unknown[]>>;
  /** Rows to delete before inserting, e.g. a snapshot for the same account and date. */
  replace?: { table: TableName; where: Record<string, unknown> }[];
  accountsToUpsert: AccountRow[];
  summary: { period: [IsoDate, IsoDate]; counts: Record<string, number>; duplicates: number };
}

export interface ImportPreview {
  fileHash: string;
  source: SourceId;
  parsed: ParsedFile;
  mapped: Mapped;
  validation: Validation;
  alreadyImported: boolean;
}

export interface CommitOptions {
  /** Save even when validation failed, flagged as unverified in the UI. */
  unverified?: boolean;
  /** Remember the password that unlocked this source's statements. */
  savePasswordFor?: { source: SourceId; password: string };
}

export type PreviewResult = { status: 'ok'; preview: ImportPreview } | Exclude<ParseOutcome, { status: 'ok' }>;

type Mapper = (db: FinanceDb, parsed: ParsedFile) => Promise<Mapped>;

const bankMapper: Mapper = (db, parsed) => mapBank(db, parsed as BankStatement);

/** Mappers by source. Later tasks register the loan, EPF, CAS and equity mappers here. */
const MAPPERS: Partial<Record<SourceId, Mapper>> = {
  sbi: bankMapper,
  federal: bankMapper,
  'ubi-savings': bankMapper,
};

interface FingerprintedRow {
  fingerprint: string;
}

function hasFingerprint(row: unknown): row is FingerprintedRow {
  return typeof row === 'object' && row !== null && typeof (row as { fingerprint?: unknown }).fingerprint === 'string';
}

/** Drops rows whose fingerprint is already stored, across every mapped table that uses one. */
async function dedupeTables(
  db: FinanceDb,
  tables: Partial<Record<TableName, unknown[]>>,
): Promise<{ tables: Partial<Record<TableName, unknown[]>>; duplicates: number }> {
  const kept: Partial<Record<TableName, unknown[]>> = {};
  let duplicates = 0;
  for (const [name, rows] of Object.entries(tables) as [TableName, unknown[]][]) {
    const fingerprints = rows.filter(hasFingerprint).map((row) => row.fingerprint);
    if (fingerprints.length === 0) {
      kept[name] = rows;
      continue;
    }
    const stored = await db.table(name).where('fingerprint').anyOf(fingerprints).toArray();
    const storedSet = new Set(stored.map((row) => (row as FingerprintedRow).fingerprint));
    const remaining = rows.filter((row) => !hasFingerprint(row) || !storedSet.has(row.fingerprint));
    duplicates += rows.length - remaining.length;
    kept[name] = remaining;
  }
  return { tables: kept, duplicates };
}

async function buildPreview(db: FinanceDb, parsed: ParsedFile, fileHash: string): Promise<ImportPreview> {
  const mapper = MAPPERS[parsed.source];
  if (!mapper) throw new Error(`no mapper for source ${parsed.source}`);
  const mapped = await mapper(db, parsed);
  const { tables, duplicates } = await dedupeTables(db, mapped.tables);
  const alreadyImported = (await db.imports.where('fileHash').equals(fileHash).count()) > 0;
  return {
    fileHash,
    source: parsed.source,
    parsed,
    mapped: { ...mapped, tables, summary: { ...mapped.summary, duplicates } },
    validation: parsed.validation,
    alreadyImported,
  };
}

/** Test seam: build a preview from an already-parsed file, without touching PDF parsing. */
export function previewFromParsed(db: FinanceDb, parsed: ParsedFile, fileHash: string): Promise<ImportPreview> {
  return buildPreview(db, parsed, fileHash);
}

/** Parses, maps and dedupes a file, loading saved passwords from the `passwords` setting. */
export async function previewImport(
  db: FinanceDb,
  bytes: Uint8Array,
  opts: ParseOptions = {},
): Promise<PreviewResult> {
  const fileHash = await sha256Hex(bytes);
  const saved = await getSetting<Record<string, string>>(db, 'passwords', {});
  const outcome = await parseFile(bytes, {
    ...opts,
    savedPasswords: [...(opts.savedPasswords ?? []), ...Object.values(saved)],
  });
  if (outcome.status !== 'ok') return outcome;
  try {
    return { status: 'ok', preview: await buildPreview(db, outcome.result, fileHash) };
  } catch (e) {
    return { status: 'error', source: outcome.result.source, message: (e as Error).message };
  }
}

async function deleteWhere(db: FinanceDb, table: TableName, where: Record<string, unknown>): Promise<void> {
  const target = db.table(table);
  const keys = await target
    .filter((row) => Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value))
    .primaryKeys();
  if (keys.length > 0) await target.bulkDelete(keys);
}

/** Pairs transfers across the transactions that fall within ±3 days of the imported period. */
async function matchImportedTransfers(db: FinanceDb, period: [IsoDate, IsoDate]): Promise<void> {
  const rows = await db.transactions
    .where('date')
    .between(addDays(period[0], -3), addDays(period[1], 3), true, true)
    .toArray();
  const pairs = matchTransfers(
    rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      date: row.date,
      amount: row.amount,
      kind: row.kind,
      description: row.description,
    })),
  );
  if (pairs.length === 0) return;
  await db.transaction('rw', db.transactions, async () => {
    for (const [debitId, creditId] of pairs) {
      await db.transactions.update(debitId, { kind: 'transfer', transferPairId: creditId });
      await db.transactions.update(creditId, { kind: 'transfer', transferPairId: debitId });
    }
  });
}

/**
 * Saves a preview in one rw transaction (imports row, accounts, replacements, rows). Any throw rolls
 * everything back. Afterwards, cross-account transfers are paired. Returns the new import id.
 */
export async function commitImport(
  db: FinanceDb,
  preview: ImportPreview,
  opts: CommitOptions = {},
): Promise<string> {
  if (!preview.validation.ok && !opts.unverified) throw new Error('validation failed');
  const importId = newId();
  const { mapped } = preview;
  await db.transaction('rw', db.tables, async () => {
    await db.imports.add({
      id: importId,
      fileHash: preview.fileHash,
      source: preview.source,
      periodFrom: mapped.summary.period[0],
      periodTo: mapped.summary.period[1],
      importedAt: todayIso(),
      counts: { ...mapped.summary.counts },
      verified: preview.validation.ok,
      notes: preview.validation.notes,
    });
    for (const account of mapped.accountsToUpsert) await upsertAccount(db, account);
    for (const { table, where } of mapped.replace ?? []) await deleteWhere(db, table, where);
    for (const [name, rows] of Object.entries(mapped.tables) as [TableName, unknown[]][]) {
      if (rows.length === 0) continue;
      const stamped = rows.map((row) => ({ ...(row as Record<string, unknown>), importId }));
      await db.table(name).bulkAdd(stamped);
    }
    if (opts.savePasswordFor) {
      const passwords = await getSetting<Record<string, string>>(db, 'passwords', {});
      passwords[opts.savePasswordFor.source] = opts.savePasswordFor.password;
      await setSetting(db, 'passwords', passwords);
    }
  });
  await matchImportedTransfers(db, mapped.summary.period);
  return importId;
}
