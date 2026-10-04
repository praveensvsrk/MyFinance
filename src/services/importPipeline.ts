import type { IsoDate, ParseOptions, ParseOutcome, ParsedFile, SourceId, Validation } from '../parsers';
import type {
  BankStatement,
  BenefitHistory,
  CasStatement,
  EpfPassbook,
  EtradeStatement,
  LoanCertificate,
  LoanStatement,
} from '../parsers/types';
import { parseFile } from '../parsers';
import type { AccountRow, FinanceDb, ImportUndo, MfTxnRow, TableName, TxnRow } from '../db/schema';
import { deleteImport, isImportIndexed, newId, upsertAccount } from '../db/repos';
import { addDays, todayIso } from '../domain/dates';
import {
  confirm as confirmProvisionals,
  estimateUnits,
  isCoveredByCas,
  learnLinks,
  markStale,
  matchLink,
  narrationPatternOf,
  type BankDebit,
  type CasBuy,
  type CasMatch,
  type SipLink,
} from '../domain/mfProvisional';
import { matchTransfers } from '../domain/transfers';
import { sha256Hex } from './hash';
import { mapBank } from './mappers/bank';
import { mapCas } from './mappers/cas';
import { mapBenefitHistory, mapEtradeStatement } from './mappers/equity';
import { mapEpf } from './mappers/epf';
import { mapLoanCertificate, mapLoanStatement } from './mappers/loan';
import { provisionalNav, refreshProvisionalUnits } from './provisional';

/** An investment debit whose SIP-link match is ambiguous; the UI resolves it before commit. */
export interface AmbiguousBankDebit {
  bankTxnId: string;
  candidates: string[];
}

/** Everything a mapper produces for one parsed file, before dedupe and commit. */
export interface Mapped {
  tables: Partial<Record<TableName, unknown[]>>;
  /** Rows to delete before inserting, e.g. a snapshot for the same account and date. */
  replace?: { table: TableName; where: Record<string, unknown> }[];
  accountsToUpsert: AccountRow[];
  /** Bank imports only: investment debits that matched several SIP links. */
  ambiguous?: AmbiguousBankDebit[];
  summary: { period: [IsoDate, IsoDate]; counts: Record<string, number>; duplicates: number };
}

export interface ImportPreview {
  fileHash: string;
  source: SourceId;
  parsed: ParsedFile;
  mapped: Mapped;
  validation: Validation;
  alreadyImported: boolean;
  /** Investment debits whose SIP-link match is ambiguous; resolve them via commitImport assignments. */
  ambiguous: AmbiguousBankDebit[];
}

export interface CommitOptions {
  /** Save even when validation failed, flagged as unverified in the UI. */
  unverified?: boolean;
  /** UI answers for ambiguous bank debits: bank transaction id → scheme key (folio id). */
  assignments?: Record<string, string>;
}

export type PreviewResult = { status: 'ok'; preview: ImportPreview } | Exclude<ParseOutcome, { status: 'ok' }>;

type Mapper = (db: FinanceDb, parsed: ParsedFile) => Promise<Mapped>;

const bankMapper: Mapper = (db, parsed) => mapBank(db, parsed as BankStatement);
const loanMapper: Mapper = (db, parsed) => mapLoanStatement(db, parsed as LoanStatement);
const certificateMapper: Mapper = (db, parsed) => mapLoanCertificate(db, parsed as LoanCertificate);
const epfMapper: Mapper = (db, parsed) => mapEpf(db, parsed as EpfPassbook);
const casMapper: Mapper = (db, parsed) => mapCas(db, parsed as CasStatement);
const benefitHistoryMapper: Mapper = (db, parsed) => mapBenefitHistory(db, parsed as BenefitHistory);
const etradeStatementMapper: Mapper = (db, parsed) => mapEtradeStatement(db, parsed as EtradeStatement);

/** Mappers by source. Exhaustive: adding a `SourceId` without a mapper fails to typecheck. */
export const MAPPERS: Record<SourceId, Mapper> = {
  sbi: bankMapper,
  federal: bankMapper,
  'ubi-savings': bankMapper,
  'ubi-loan': loanMapper,
  'ubi-cert': certificateMapper,
  epf: epfMapper,
  cas: casMapper,
  'etrade-xlsx': benefitHistoryMapper,
  'etrade-stmt': etradeStatementMapper,
};

interface FingerprintedRow {
  fingerprint: string;
}

function hasFingerprint(row: unknown): row is FingerprintedRow {
  return typeof row === 'object' && row !== null && typeof (row as { fingerprint?: unknown }).fingerprint === 'string';
}

/**
 * Makes fingerprints unique within one file: a repeated row (e.g. two identical same-day charges)
 * gets `#2`, `#3`… so the unique index accepts it. The suffix depends only on the row's position
 * among its twins, so re-importing the same file produces the same fingerprints and dedupes.
 */
function uniquifyFingerprints(
  tables: Partial<Record<TableName, unknown[]>>,
): Partial<Record<TableName, unknown[]>> {
  const unique: Partial<Record<TableName, unknown[]>> = {};
  for (const [name, rows] of Object.entries(tables) as [TableName, unknown[]][]) {
    const seen = new Map<string, number>();
    unique[name] = rows.map((row) => {
      if (!hasFingerprint(row)) return row;
      const occurrence = (seen.get(row.fingerprint) ?? 0) + 1;
      seen.set(row.fingerprint, occurrence);
      return occurrence === 1 ? row : { ...row, fingerprint: `${row.fingerprint}#${occurrence}` };
    });
  }
  return unique;
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
  const mapped = await MAPPERS[parsed.source](db, parsed);
  const { tables, duplicates } = await dedupeTables(db, uniquifyFingerprints(mapped.tables));
  const alreadyImported = (await db.imports.where('fileHash').equals(fileHash).count()) > 0;
  // Only debits that survive dedupe can be committed, so only they need a UI answer.
  const keptTxnIds = new Set(
    ((tables.transactions ?? []) as { id?: unknown }[]).map((row) => row.id).filter((id): id is string => typeof id === 'string'),
  );
  const ambiguous = (mapped.ambiguous ?? []).filter((item) => keptTxnIds.has(item.bankTxnId));
  return {
    fileHash,
    source: parsed.source,
    parsed,
    mapped: { ...mapped, tables, summary: { ...mapped.summary, duplicates } },
    validation: parsed.validation,
    alreadyImported,
    ambiguous,
  };
}

/** Test seam: build a preview from an already-parsed file, without touching PDF parsing. */
export function previewFromParsed(db: FinanceDb, parsed: ParsedFile, fileHash: string): Promise<ImportPreview> {
  return buildPreview(db, parsed, fileHash);
}

/** Parses, maps and dedupes a file. A statement password is used for this call only and never stored. */
export async function previewImport(
  db: FinanceDb,
  bytes: Uint8Array,
  opts: ParseOptions = {},
): Promise<PreviewResult> {
  const fileHash = await sha256Hex(bytes);
  const outcome = await parseFile(bytes, opts);
  if (outcome.status !== 'ok') return outcome;
  try {
    return { status: 'ok', preview: await buildPreview(db, outcome.result, fileHash) };
  } catch (e) {
    return { status: 'error', source: outcome.result.source, message: (e as Error).message };
  }
}

/** Deletes the rows matching `where` and returns them, so an undo can put them back. */
async function deleteWhere(db: FinanceDb, table: TableName, where: Record<string, unknown>): Promise<unknown[]> {
  const target = db.table(table);
  const keys = await target
    .filter((row) => Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value))
    .primaryKeys();
  if (keys.length === 0) return [];
  const rows = (await target.bulkGet(keys)).filter((row) => row !== undefined);
  await target.bulkDelete(keys);
  return rows;
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
 * Saves a preview in one rw transaction: the imports row (with its undo log), accounts, replacements,
 * rows, then cross-account transfer pairing, MF provisionals for investment debits and, for a CAS,
 * SIP-link learning and provisional confirmation. Any throw, including from a hook, rolls everything
 * back. Returns the new import id.
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
    const undo: ImportUndo = { replaced: {}, inserted: {} };
    for (const account of mapped.accountsToUpsert) await upsertAccount(db, account);
    for (const { table, where } of mapped.replace ?? []) {
      const removed = await deleteWhere(db, table, where);
      if (removed.length > 0) undo.replaced[table] = [...(undo.replaced[table] ?? []), ...removed];
    }
    for (const [name, rows] of Object.entries(mapped.tables) as [TableName, unknown[]][]) {
      if (rows.length === 0) continue;
      const stamped = rows.map((row) => ({ ...(row as Record<string, unknown>), importId }));
      const keys = await db.table(name).bulkAdd(stamped, { allKeys: true });
      if (!isImportIndexed(name)) undo.inserted[name] = keys;
    }
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
      undo,
    });
    await matchImportedTransfers(db, mapped.summary.period);
    if (Array.isArray(mapped.tables.transactions)) {
      await applyBankProvisionalHook(db, importId, opts.assignments ?? {});
    }
    await runCasPostCommitHooks(db, preview);
  });
  return importId;
}

/**
 * Undoes an import: removes its rows, restores what it replaced, and re-derives provisional units
 * and staleness for provisionals its CAS had confirmed.
 */
export async function undoImport(db: FinanceDb, importId: string): Promise<void> {
  await deleteImport(db, importId);
  await db.transaction('rw', db.mfProvisional, db.mfFolios, db.prices, async () => {
    await refreshProvisionalUnits(db);
    const coverage: Record<string, IsoDate> = {};
    for (const folio of await db.mfFolios.toArray()) coverage[folio.id] = folio.asOf;
    const staled = markStale(await db.mfProvisional.toArray(), coverage, todayIso());
    await db.mfProvisional.bulkPut(staled);
  });
}

/** The scheme chosen by the learned SIP links, or `unassigned` when none or several match. */
function schemeFromLinks(
  txn: TxnRow,
  links: SipLink[],
  lastCasDateByScheme: Record<string, IsoDate>,
): string {
  const match = matchLink(
    { id: txn.id, accountId: txn.accountId, date: txn.date, amount: txn.amount, description: txn.description },
    links,
    lastCasDateByScheme,
  );
  return match !== null && 'schemeKey' in match ? match.schemeKey : 'unassigned';
}

/** Remembers the user's answer as a permanent link so later debits match on their own. */
export async function saveUserLink(db: FinanceDb, txn: TxnRow, schemeKey: string): Promise<void> {
  const narrationPattern = narrationPatternOf(txn.description);
  const link: SipLink = {
    id: `user:${txn.accountId}:${schemeKey}:${narrationPattern}`,
    schemeKey,
    narrationPattern,
    grossPaise: Math.abs(txn.amount),
    dayOfMonth: +txn.date.slice(8, 10),
    accountId: txn.accountId,
    source: 'user',
  };
  await db.mfSipLinks.put(link);
}

/**
 * Bank post-commit hook: for every investment debit of this import, picks the scheme from the
 * user's assignments or from the learned SIP links, values it with `provisionalNav` and stores the
 * provisional. An ambiguous or unmatched debit becomes `unassigned`. A debit that a CAS already
 * covers (its date + 7 days is within the scheme's, or for `unassigned` any, CAS coverage) gets no
 * provisional: its units are already in the folio.
 */
async function applyBankProvisionalHook(
  db: FinanceDb,
  importId: string,
  assignments: Record<string, string>,
): Promise<void> {
  const imported = await db.transactions.where('importId').equals(importId).toArray();
  await addProvisionals(
    db,
    imported.filter((txn) => txn.kind === 'investment' && txn.amount < 0),
    assignments,
  );
}

/**
 * Stores a provisional for each investment debit in `debits`, picking the scheme as the bank hook
 * does. Call inside a `rw` transaction on `mfProvisional`, `mfSipLinks`, `mfFolios` and `prices`.
 */
export async function addProvisionals(
  db: FinanceDb,
  debits: TxnRow[],
  assignments: Record<string, string> = {},
): Promise<void> {
  if (debits.length === 0) return;

  const links = await db.mfSipLinks.toArray();
  const lastCasDateByScheme: Record<string, IsoDate> = {};
  for (const folio of await db.mfFolios.toArray()) lastCasDateByScheme[folio.id] = folio.asOf;
  const latestCasDate = Object.values(lastCasDateByScheme).sort().pop();

  for (const txn of debits) {
    const assigned = assignments[txn.id];
    if (assigned !== undefined) await saveUserLink(db, txn, assigned);

    const schemeKey = assigned ?? schemeFromLinks(txn, links, lastCasDateByScheme);
    const coverage = schemeKey === 'unassigned' ? latestCasDate : lastCasDateByScheme[schemeKey];
    if (isCoveredByCas(txn.date, coverage)) continue;

    const nav = schemeKey === 'unassigned' ? null : await provisionalNav(db, schemeKey, txn.date);
    const grossPaise = Math.abs(txn.amount);
    await db.mfProvisional.add({
      id: newId(),
      bankTxnId: txn.id,
      schemeKey,
      date: txn.date,
      grossPaise,
      estUnits: nav === null ? 0 : estimateUnits(grossPaise, nav.value),
      navDate: nav?.date ?? null,
      status: 'provisional',
    });
  }
}

/**
 * CAS post-commit hook: learns SIP links from this statement's purchases against the stored bank
 * debits, confirms the provisionals the statement covers, then marks the uncovered old ones stale.
 */
async function runCasPostCommitHooks(db: FinanceDb, preview: ImportPreview): Promise<void> {
  if (preview.source !== 'cas') return;
  const rows = (preview.mapped.tables.mfTxns ?? []) as MfTxnRow[];

  const casBuys: CasBuy[] = [];
  const casTxns: CasMatch[] = [];
  for (const row of rows) {
    const gross = row.amount + row.stampDuty;
    if (row.type === 'purchase' || row.type === 'sip') casBuys.push({ schemeKey: row.folioId, date: row.date, gross });
    casTxns.push({ id: row.id, schemeKey: row.folioId, date: row.date, gross });
  }

  const debits: BankDebit[] = (await db.transactions.toArray())
    .filter((txn) => txn.amount < 0)
    .map((txn) => ({
      id: txn.id,
      accountId: txn.accountId,
      date: txn.date,
      amount: txn.amount,
      description: txn.description,
    }));
  const learned = learnLinks(casBuys, debits, await db.mfSipLinks.toArray());
  if (learned.length > 0) await db.mfSipLinks.bulkPut(learned);

  const statement = preview.parsed as CasStatement;
  const coverage: Record<string, IsoDate> = {};
  for (const scheme of statement.schemes) coverage[`${scheme.folio}|${scheme.isin}`] = statement.periodTo;

  const provisionals = markStale(
    confirmProvisionals(await db.mfProvisional.toArray(), casTxns),
    coverage,
    todayIso(),
  );
  if (provisionals.length > 0) await db.mfProvisional.bulkPut(provisionals);
}
