import type { Check, LoanCertificate, LoanRow, LoanStatement, Paise, Validation } from '../../parsers/types';
import { classifyLoanCredit } from '../../domain/loanRates';
import { fyEndDate } from '../../domain/dates';
import type {
  AccountRow,
  FinanceDb,
  LoanEntryKind,
  LoanEntryRow,
  LoanYearRow,
  SnapshotRow,
} from '../../db/schema';
import { newId } from '../../db/repos';
import { fingerprint } from '../hash';
import type { Mapped } from '../importPipeline';

/** Fallback contractual EMI (₹80,000 in paise) when no certificate has been imported yet. */
const DEFAULT_EMI: Paise = 8_000_000;

/** Adds (or refreshes) a validation check and recomputes the overall verdict. */
function setCheck(validation: Validation, checkToAdd: Check): void {
  const index = validation.checks.findIndex((existing) => existing.name === checkToAdd.name);
  if (index === -1) validation.checks.push(checkToAdd);
  else validation.checks[index] = checkToAdd;
  validation.ok = validation.checks.every((existing) => existing.ok);
}

/** The stored kind for a statement row: repayments are an EMI or a prepayment. */
function entryKind(row: LoanRow, emi: Paise): LoanEntryKind {
  switch (row.kind) {
    case 'repayment':
      return classifyLoanCredit(row.amount, emi);
    case 'disbursement':
      return 'disbursement';
    case 'interest':
      return 'interest';
    case 'charge':
      return 'charge';
  }
}

/** The latest stored entry dated strictly before `date`, or null when there is none. */
function previousEntry(entries: LoanEntryRow[], date: string): LoanEntryRow | null {
  let previous: LoanEntryRow | null = null;
  for (const entry of entries) {
    if (entry.date >= date) continue;
    if (previous === null || entry.date > previous.date) previous = entry;
  }
  return previous;
}

/**
 * Joins the new statement to the stored history: the latest stored entry before the first new row
 * must carry the statement's opening outstanding. A mismatch marks the preview invalid.
 */
async function checkJoin(db: FinanceDb, accountId: string, s: LoanStatement): Promise<void> {
  const first = s.rows[0];
  if (first === undefined) return;
  const stored = await db.loanEntries.where('accountId').equals(accountId).toArray();
  const previous = previousEntry(stored, first.date);
  if (previous === null || previous.outstandingAfter === s.openingOutstanding) return;
  setCheck(s.validation, {
    name: 'join',
    expected: s.openingOutstanding,
    actual: previous.outstandingAfter,
    ok: false,
  });
}

function loanAccountId(accountLast4: string): string {
  return `ubi-loan-${accountLast4}`;
}

function accountRow(accountLast4: string, meta: Record<string, unknown>): AccountRow {
  return {
    id: loanAccountId(accountLast4),
    kind: 'loan',
    institution: 'UBI',
    maskedNumber: accountLast4,
    name: 'UBI Home Loan',
    meta,
  };
}

/**
 * Maps a UBI home-loan statement: upserts the account (preserving the certificate's meta),
 * classifies credits against `meta.bankEmi` (falling back to the certificate EMI or 8,000,000),
 * fingerprints the rows for dedupe, joins the statement to the stored history and snapshots the
 * closing outstanding as a negative balance (loans count against net worth).
 */
export async function mapLoanStatement(db: FinanceDb, s: LoanStatement): Promise<Mapped> {
  const accountId = loanAccountId(s.accountLast4);
  const existing = await db.accounts.get(accountId);
  const meta = existing?.meta ?? {};
  const emi = typeof meta.bankEmi === 'number' ? meta.bankEmi : DEFAULT_EMI;

  const entries: LoanEntryRow[] = [];
  for (const row of s.rows) {
    const kind = entryKind(row, emi);
    const entry: LoanEntryRow = {
      id: newId(),
      accountId,
      date: row.date,
      description: row.description,
      ref: row.ref,
      kind,
      amount: row.amount,
      outstandingAfter: row.outstandingAfter,
      importId: '',
      // The parsed kind, not the EMI-classified one, so a later change of `bankEmi` cannot make an
      // already-imported repayment look new.
      fingerprint: await fingerprint([accountId, row.date, row.kind, row.amount, row.ref]),
    };
    if (row.interestFrom !== undefined) entry.interestFrom = row.interestFrom;
    if (row.interestTo !== undefined) entry.interestTo = row.interestTo;
    entries.push(entry);
  }

  await checkJoin(db, accountId, s);

  const snapshots: SnapshotRow[] = [
    { accountId, date: s.periodTo, balance: -s.closingOutstanding, source: 'statement', importId: '' },
  ];

  return {
    tables: { loanEntries: entries, balanceSnapshots: snapshots },
    replace: [{ table: 'balanceSnapshots', where: { accountId, date: s.periodTo } }],
    accountsToUpsert: [accountRow(s.accountLast4, { ...meta })],
    summary: {
      period: [s.periodFrom, s.periodTo],
      counts: { loanEntries: entries.length, balanceSnapshots: 1 },
      duplicates: 0,
    },
  };
}

/**
 * Maps a UBI loan interest certificate: merges sanctioned/releaseDate/bankEmi into the account
 * meta, replaces the FY's `loanYears` row and snapshots −closingOutstanding at the FY end.
 */
export async function mapLoanCertificate(db: FinanceDb, c: LoanCertificate): Promise<Mapped> {
  const accountId = loanAccountId(c.accountLast4);
  const existing = await db.accounts.get(accountId);
  const meta = {
    ...(existing?.meta ?? {}),
    sanctioned: c.sanctioned,
    releaseDate: c.releaseDate,
    bankEmi: c.emi,
  };

  const year: LoanYearRow = {
    accountId,
    fy: c.fyStart,
    interestCharged: c.interestCharged,
    principalRepaid: c.principalPaid,
    totalPaid: c.totalPaid,
    closingOutstanding: c.closingOutstanding,
    importId: '',
  };
  const snapshotDate = fyEndDate(c.fyStart);
  const snapshots: SnapshotRow[] = [
    { accountId, date: snapshotDate, balance: -c.closingOutstanding, source: 'statement', importId: '' },
  ];

  return {
    tables: { loanYears: [year], balanceSnapshots: snapshots },
    replace: [
      { table: 'loanYears', where: { accountId, fy: c.fyStart } },
      { table: 'balanceSnapshots', where: { accountId, date: snapshotDate } },
    ],
    accountsToUpsert: [accountRow(c.accountLast4, meta)],
    summary: {
      period: [`${c.fyStart}-04-01`, c.closingDate],
      counts: { loanYears: 1, balanceSnapshots: 1 },
      duplicates: 0,
    },
  };
}
