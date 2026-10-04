/**
 * Turns a CSV or a non-E*TRADE workbook into a grid of strings, and guesses which columns are
 * date / description / debit / credit / amount / balance from typical Indian bank export headers.
 */

import * as XLSX from 'xlsx';
import { readWorkbook, type WorkBook } from './benefitHistory';

export interface SpreadsheetTable {
  sheetName: string;
  rows: string[][];
}

export type DateFormat = 'dmy' | 'mdy' | 'ymd';

export interface GuessedMapping {
  headerRow: number;
  dateCol?: number;
  descriptionCol?: number;
  amountCol?: number;
  debitCol?: number;
  creditCol?: number;
  balanceCol?: number;
  refCol?: number;
  drcrCol?: number;
  institution?: string;
  kind?: 'savings' | 'card';
  /** Set when the header row matches a known bank export. */
  preset?: string;
  dateFormat?: DateFormat;
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);
const isZip = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);

function delimiterOf(line: string): ',' | '\t' | ';' {
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === ',' || ch === '\t' || ch === ';')) counts[ch] += 1;
  }
  if (counts['\t'] >= counts[','] && counts['\t'] >= counts[';'] && counts['\t'] > 0) return '\t';
  if (counts[';'] > counts[','] && counts[';'] > 0) return ';';
  return ',';
}

/** RFC-style CSV with quoted fields; delimiter is sniffed from the first line. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delim = delimiterOf(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < source.length) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      row.push(cell.trim());
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      cell = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function sheetRows(wb: WorkBook, name: string): string[][] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils
    .sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })
    .map((row) => row.map((cell) => String(cell ?? '').trim()));
}

export function tableFromWorkbook(wb: WorkBook): SpreadsheetTable | null {
  let best: SpreadsheetTable | null = null;
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb, name).filter((row) => row.some((cell) => cell !== ''));
    if (rows.length < 2) continue;
    if (best === null || rows.length > best.rows.length) best = { sheetName: name, rows };
  }
  return best;
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const printable = text.replace(/[\t\n\r]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    if (printable.length < 8) return null;
    if (printable.length / Math.max(text.replace(/[\t\n\r]/g, '').length, 1) < 0.85) return null;
    return text;
  } catch {
    return null;
  }
}

/** True when the bytes look like a CSV/TSV rather than a PDF, zip, or random binary. */
export function looksLikeCsv(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || isZip(bytes) || startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return false;
  const text = decodeText(bytes.slice(0, Math.min(bytes.length, 64 * 1024)));
  if (text === null) return false;
  const rows = parseCsv(text);
  return rows.length >= 2 && rows.some((row) => row.length >= 3);
}

export function extractSpreadsheet(bytes: Uint8Array): SpreadsheetTable | null {
  if (isZip(bytes)) {
    try {
      return tableFromWorkbook(readWorkbook(bytes));
    } catch {
      return null;
    }
  }
  const text = decodeText(bytes);
  if (text === null) return null;
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell !== ''));
  if (rows.length < 2) return null;
  return { sheetName: 'CSV', rows };
}

function norm(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const FIELD_ALIASES: Record<keyof Pick<GuessedMapping, 'dateCol' | 'descriptionCol' | 'amountCol' | 'debitCol' | 'creditCol' | 'balanceCol' | 'refCol' | 'drcrCol'>, string[]> = {
  dateCol: ['date', 'txndate', 'transactiondate', 'trandate', 'valuedate', 'postingdate', 'txndt'],
  descriptionCol: [
    'narration',
    'description',
    'particulars',
    'remarks',
    'transactionremarks',
    'details',
    'transactionparticulars',
    'narrationdescription',
  ],
  amountCol: ['amount', 'amountinr', 'transactionamount', 'txnamount'],
  debitCol: ['debit', 'withdrawal', 'withdrawalamt', 'withdrawalamount', 'withdrawals', 'dr', 'debitamount', 'withdrawalamountinr'],
  creditCol: ['credit', 'deposit', 'depositamt', 'depositamount', 'deposits', 'cr', 'creditamount', 'depositamountinr'],
  balanceCol: ['balance', 'closingbalance', 'closingbal', 'runningbalance', 'balanceinr', 'bal'],
  refCol: ['ref', 'reference', 'chqrefno', 'chequenumber', 'chequeno', 'chqno', 'refnochequeno', 'transactionid', 'refno'],
  drcrCol: ['drc', 'drcr', 'type', 'transactiontype', 'crdr'],
};

interface Preset {
  name: string;
  institution: string;
  kind: 'savings' | 'card';
  /** Normalised header fragments that must all appear. */
  required: string[];
}

const PRESETS: Preset[] = [
  {
    name: 'HDFC savings',
    institution: 'HDFC',
    kind: 'savings',
    required: ['narration', 'withdrawalamt', 'depositamt', 'closingbalance'],
  },
  {
    name: 'ICICI savings',
    institution: 'ICICI',
    kind: 'savings',
    required: ['transactionremarks', 'withdrawalamountinr', 'depositamountinr'],
  },
  {
    name: 'SBI savings',
    institution: 'SBI',
    kind: 'savings',
    required: ['txndate', 'debit', 'credit', 'balance'],
  },
  {
    name: 'Axis savings',
    institution: 'Axis',
    kind: 'savings',
    required: ['trandate', 'particulars'],
  },
  {
    name: 'HDFC credit card',
    institution: 'HDFC',
    kind: 'card',
    required: ['transactiondescription', 'rewardpoint'],
  },
];

function scoreHeader(cells: string[]): { mapping: GuessedMapping; hits: number } {
  const norms = cells.map(norm);
  const mapping: GuessedMapping = { headerRow: 0 };
  let hits = 0;
  const taken = new Set<number>();
  const assign = (field: keyof typeof FIELD_ALIASES, aliases: string[]): void => {
    for (let i = 0; i < norms.length; i++) {
      if (taken.has(i) || norms[i] === '') continue;
      if (aliases.some((alias) => norms[i] === alias || norms[i].includes(alias))) {
        mapping[field] = i;
        taken.add(i);
        hits += 1;
        return;
      }
    }
  };
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [keyof typeof FIELD_ALIASES, string[]][]) {
    assign(field, aliases);
  }
  // A column named only "Date" should win over "Value Date" for the posting date.
  const dateExact = norms.findIndex((n) => n === 'date' || n === 'txndate' || n === 'transactiondate' || n === 'trandate');
  if (dateExact >= 0) mapping.dateCol = dateExact;

  const joined = norms.join(' ');
  for (const preset of PRESETS) {
    if (preset.required.every((token) => joined.includes(token))) {
      mapping.preset = preset.name;
      mapping.institution = preset.institution;
      mapping.kind = preset.kind;
      break;
    }
  }
  return { mapping, hits };
}

export function guessMapping(table: SpreadsheetTable): GuessedMapping {
  const limit = Math.min(table.rows.length, 25);
  let best: { mapping: GuessedMapping; hits: number } | null = null;
  for (let i = 0; i < limit; i++) {
    const scored = scoreHeader(table.rows[i] ?? []);
    if (best === null || scored.hits > best.hits) {
      best = { mapping: { ...scored.mapping, headerRow: i }, hits: scored.hits };
    }
  }
  const guessed = best?.mapping ?? { headerRow: 0 };
  if (guessed.dateCol !== undefined) {
    const dates = table.rows
      .slice(guessed.headerRow + 1, guessed.headerRow + 12)
      .map((row) => row[guessed.dateCol! ] ?? '');
    guessed.dateFormat = guessDateFormat(dates);
  }
  return guessed;
}

function guessDateFormat(samples: string[]): DateFormat | undefined {
  let sawIso = false;
  let sawDayFirst = false;
  let sawMonthFirst = false;
  for (const raw of samples) {
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) sawIso = true;
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (!m) continue;
    const a = +m[1];
    const b = +m[2];
    if (a > 12) sawDayFirst = true;
    if (b > 12) sawMonthFirst = true;
  }
  if (sawIso && !sawDayFirst && !sawMonthFirst) return 'ymd';
  if (sawDayFirst && !sawMonthFirst) return 'dmy';
  if (sawMonthFirst && !sawDayFirst) return 'mdy';
  return 'dmy';
}
