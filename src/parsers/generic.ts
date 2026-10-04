import type { BankStatement, BankTxn, IsoDate, Paise } from './types';
import { parseDate, parsePaiseOrNull, parseUsDate } from './normalize';
import { check, validation } from './validation';
import type { DateFormat, GuessedMapping, SpreadsheetTable } from './spreadsheet';

export interface GenericMapping {
  institution: string;
  accountLast4: string;
  kind: 'savings' | 'card';
  headerRow: number;
  dateCol: number;
  descriptionCol: number;
  amountCol?: number;
  debitCol?: number;
  creditCol?: number;
  drcrCol?: number;
  balanceCol?: number;
  refCol?: number;
  dateFormat?: DateFormat;
  /** When true, a positive figure in `amountCol` is money out (typical card export). */
  amountInvertsSign?: boolean;
  preset?: string;
}

export function mappingFromGuess(
  guess: GuessedMapping,
  extras: { institution: string; accountLast4: string; kind?: 'savings' | 'card' },
): GenericMapping {
  if (guess.dateCol === undefined || guess.descriptionCol === undefined) {
    throw new Error('Pick the date and description columns');
  }
  const hasAmount = guess.amountCol !== undefined;
  const hasDebitCredit = guess.debitCol !== undefined && guess.creditCol !== undefined;
  if (!hasAmount && !hasDebitCredit) {
    throw new Error('Pick an amount column, or both debit and credit');
  }
  const kind = extras.kind ?? guess.kind ?? 'savings';
  return {
    institution: extras.institution.trim() || guess.institution || 'Bank',
    accountLast4: extras.accountLast4.replace(/\D/g, '').slice(-4) || '0000',
    kind,
    headerRow: guess.headerRow,
    dateCol: guess.dateCol,
    descriptionCol: guess.descriptionCol,
    amountCol: guess.amountCol,
    debitCol: guess.debitCol,
    creditCol: guess.creditCol,
    drcrCol: guess.drcrCol,
    balanceCol: guess.balanceCol,
    refCol: guess.refCol,
    dateFormat: guess.dateFormat,
    amountInvertsSign: kind === 'card' && guess.amountCol !== undefined && guess.debitCol === undefined,
    preset: guess.preset,
  };
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return (row[index] ?? '').trim();
}

function parseRowDate(raw: string, format: DateFormat | undefined): IsoDate {
  const trimmed = raw.replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '');
  if (format === 'mdy') return parseUsDate(trimmed.replace(/-/g, '/'));
  return parseDate(trimmed);
}

function isDebitLabel(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (s === '') return null;
  if (/^(dr|debit|d|wdl|withdrawal)$/.test(s)) return true;
  if (/^(cr|credit|c|deposit)$/.test(s)) return false;
  return null;
}

function rowAmount(row: string[], mapping: GenericMapping): Paise | null {
  if (mapping.debitCol !== undefined || mapping.creditCol !== undefined) {
    const debit = parsePaiseOrNull(cell(row, mapping.debitCol));
    const credit = parsePaiseOrNull(cell(row, mapping.creditCol));
    if (debit === null && credit === null) return null;
    return (credit ?? 0) - (debit ?? 0);
  }
  const raw = cell(row, mapping.amountCol);
  if (raw === '') return null;
  let amount = parsePaiseOrNull(raw);
  if (amount === null) return null;
  const side = isDebitLabel(cell(row, mapping.drcrCol));
  if (side === true) amount = -Math.abs(amount);
  else if (side === false) amount = Math.abs(amount);
  else if (mapping.amountInvertsSign) amount = -amount;
  return amount;
}

const SKIP_DESC = /^(total|grand total|opening balance|closing balance|brought forward|carried forward|b\/f|c\/f)\b/i;

interface Draft {
  date: IsoDate;
  description: string;
  ref: string;
  amount: Paise;
  printed: Paise | null;
}

export function parseGeneric(table: SpreadsheetTable, mapping: GenericMapping): BankStatement {
  const institution = mapping.institution.trim() || 'Bank';
  const last4 = mapping.accountLast4.replace(/\D/g, '').slice(-4) || '0000';
  const drafts: Draft[] = [];
  let skipped = 0;

  for (const row of table.rows.slice(mapping.headerRow + 1)) {
    if (row.every((value) => value.trim() === '')) continue;
    const dateRaw = cell(row, mapping.dateCol);
    const description = cell(row, mapping.descriptionCol);
    if (SKIP_DESC.test(description)) continue;
    if (dateRaw === '') {
      skipped += 1;
      continue;
    }
    let date: IsoDate;
    try {
      date = parseRowDate(dateRaw, mapping.dateFormat);
    } catch {
      skipped += 1;
      continue;
    }
    const amount = rowAmount(row, mapping);
    if (amount === null || amount === 0) {
      skipped += 1;
      continue;
    }
    const printed = mapping.balanceCol === undefined ? null : parsePaiseOrNull(cell(row, mapping.balanceCol));
    drafts.push({
      date,
      description: description || '(no description)',
      ref: cell(row, mapping.refCol),
      amount,
      printed,
    });
  }

  if (drafts.length === 0) throw new Error('No transactions found in this file with those columns');
  drafts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const hasPrinted = drafts.some((draft) => draft.printed !== null);
  let running = hasPrinted && drafts[0].printed !== null ? drafts[0].printed - drafts[0].amount : 0;
  const opening = running;
  const txns: BankTxn[] = [];
  const checks = [];
  for (const draft of drafts) {
    running += draft.amount;
    const balanceAfter = draft.printed ?? running;
    txns.push({
      date: draft.date,
      description: draft.description,
      ref: draft.ref,
      amount: draft.amount,
      balanceAfter,
    });
    if (draft.printed !== null) checks.push(check(`balance ${draft.date}`, draft.printed, running, 1));
  }

  let closing = txns[txns.length - 1].balanceAfter;
  let openingBalance = opening;
  if (mapping.kind === 'card' && closing > 0) {
    for (const txn of txns) txn.balanceAfter = -Math.abs(txn.balanceAfter);
    openingBalance = -Math.abs(openingBalance);
    closing = -Math.abs(closing);
  }

  const notes: string[] = [];
  if (skipped > 0) notes.push(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} that had no date or amount.`);
  if (!hasPrinted) notes.push('No balance column, so running balances start at zero.');
  if (mapping.preset) notes.push(`Read as ${mapping.preset}.`);

  return {
    source: 'generic',
    institution,
    accountLast4: last4,
    ifsc: '',
    periodFrom: txns[0].date,
    periodTo: txns[txns.length - 1].date,
    openingBalance,
    closingBalance: closing,
    txns,
    accountKind: mapping.kind,
    validation: validation(checks.length > 0 ? checks : [check('row count', txns.length, txns.length)], notes),
  };
}
