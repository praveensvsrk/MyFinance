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
import type { AccountRow, FinanceDb, MfTxnRow, PriceRow, TableName, TxnRow } from '../db/schema';
import { deleteImport, getSetting, newId, pricesFor, setSetting, upsertAccount } from '../db/repos';
import { addDays, todayIso } from '../domain/dates';
import {
  confirm as confirmProvisionals,
  estimateUnits,
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

export { deleteImport as undoImport } from '../db/repos';

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
  /** Remember the password that unlocked this source's statements. */
  savePasswordFor?: { source: SourceId; password: string };
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

/** Mappers by source. */
const MAPPERS: Partial<Record<SourceId, Mapper>> = {
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
 * everything back. Afterwards, cross-account transfers are paired, investment debits become MF
 * provisionals and a CAS learns/confirms SIP links. Returns the new import id.
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
  if (Array.isArray(mapped.tables.transactions)) {
    await applyBankProvisionalHook(db, importId, opts.assignments ?? {});
  }
  await runCasPostCommitHooks(db, preview);
  return importId;
}

/** Latest price for `symbol` dated on or before `date`, or null when there is none. */
async function latestPriceOnOrBefore(db: FinanceDb, symbol: string, date: IsoDate): Promise<PriceRow | null> {
  const rows = await pricesFor(db, symbol);
  let found: PriceRow | null = null;
  for (const row of rows) {
    if (row.date > date) break;
    found = row;
  }
  return found;
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
async function saveUserLink(db: FinanceDb, txn: TxnRow, schemeKey: string): Promise<void> {
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

/** The NAV (×10⁴) for a scheme: its AMFI price series, else the CAS NAV stored under the ISIN. */
async function navForScheme(db: FinanceDb, schemeKey: string, date: IsoDate): Promise<PriceRow | null> {
  const folio = await db.mfFolios.get(schemeKey);
  if (!folio) return null;
  if (typeof folio.amfiCode === 'number' && Number.isFinite(folio.amfiCode)) {
    const amfi = await latestPriceOnOrBefore(db, `MF:${folio.amfiCode}`, date);
    if (amfi !== null) return amfi;
  }
  return latestPriceOnOrBefore(db, `MF:${folio.isin === '' ? folio.id : folio.isin}`, date);
}

/**
 * Bank post-commit hook: for every investment debit of this import, picks the scheme from the
 * user's assignments or from the learned SIP links, finds its latest NAV and stores the
 * provisional. An ambiguous or unmatched debit becomes `unassigned`.
 */
async function applyBankProvisionalHook(
  db: FinanceDb,
  importId: string,
  assignments: Record<string, string>,
): Promise<void> {
  const imported = await db.transactions.where('importId').equals(importId).toArray();
  const debits = imported.filter((txn) => txn.kind === 'investment' && txn.amount < 0);
  if (debits.length === 0) return;

  const links = await db.mfSipLinks.toArray();
  const lastCasDateByScheme: Record<string, IsoDate> = {};
  for (const folio of await db.mfFolios.toArray()) lastCasDateByScheme[folio.id] = folio.asOf;

  for (const txn of debits) {
    const assigned = assignments[txn.id];
    if (assigned !== undefined) await saveUserLink(db, txn, assigned);

    const schemeKey = assigned ?? schemeFromLinks(txn, links, lastCasDateByScheme);
    const nav = schemeKey === 'unassigned' ? null : await navForScheme(db, schemeKey, txn.date);
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
