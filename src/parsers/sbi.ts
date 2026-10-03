import type { BankStatement, BankTxn } from './types';
import { linesText, type Line } from './pdfText';
import { parseDate, parsePaise } from './normalize';
import { check, validation } from './validation';

const DATE_RE = /^\d\d\/\d\d\/\d{4}$/;
const AMOUNT_RE = /^[\d,]+\.\d\d$/;

export function detectSbi(text: string): number {
  return /SBIN\d{7}/.test(text) && /State Bank of India/i.test(text) && /Brought Forward/.test(text) ? 1 : 0;
}

interface Draft {
  date: string;
  valueDate: string;
  desc: string[];
  debit: number;
  credit: number;
  balance: number;
}

const isDateLine = (l: Line) => l.cells.length > 0 && l.cells[0].x < 35 && DATE_RE.test(l.cells[0].s);

export function parseSbi(lines: Line[]): BankStatement {
  const all = linesText(lines);
  const period = all.match(/Statement From\s*:?\s*(\d\d-\d\d-\d{4})\s+to\s+(\d\d-\d\d-\d{4})/);
  const acct = all.match(/Account Number\s*:?\s*(\d{6,})/);
  const ifsc = all.match(/IFSC Code\s*:?\s*(SBIN\w{7})/);
  if (!period || !acct || !ifsc) throw new Error('SBI: statement header not found');

  const start = lines.findIndex((l) => l.cells.some((c) => c.s === 'Balance'));
  const end = lines.findIndex((l) => /^Statement Summary/.test(l.text));
  if (start < 0 || end < 0) throw new Error('SBI: transaction table not found');
  const body = lines
    .slice(start + 1, end)
    .filter((l) => !/^Page no\./i.test(l.text) && !l.cells.some((c) => c.s === 'Balance'));

  const drafts: Draft[] = [];
  for (let i = 0; i < body.length; i++) {
    const l = body[i];
    if (isDateLine(l)) {
      const prev = body[i - 1];
      const prefix = prev && !isDateLine(prev) && prev.page === l.page && l.y - prev.y < 9 ? prev : null;
      // The prefix line was appended to the previous row as a continuation; it belongs to this row.
      if (prefix && drafts.length) drafts[drafts.length - 1].desc.pop();
      const d: Draft = {
        date: parseDate(l.cells[0].s),
        valueDate: parseDate(l.cells[1].s),
        desc: prefix ? [prefix.text] : [],
        debit: 0,
        credit: 0,
        balance: 0,
      };
      d.desc.push(l.cells.filter((c) => c.x >= 130 && c.x < 300).map((c) => c.s).join(' '));
      for (const c of l.cells) {
        if (!AMOUNT_RE.test(c.s)) continue;
        const mid = (c.x + c.xe) / 2;
        if (c.xe > 500) d.balance = parsePaise(c.s);
        else if (mid < 410) d.debit = parsePaise(c.s);
        else d.credit = parsePaise(c.s);
      }
      drafts.push(d);
    } else if (drafts.length) {
      drafts[drafts.length - 1].desc.push(l.text);
    }
  }

  const bfIdx = lines.findIndex((l, i) => i > end && /^Brought Forward/.test(l.text));
  const summary = lines[bfIdx + 1]?.cells.map((c) => c.s) ?? [];
  if (bfIdx < 0 || summary.length < 6) throw new Error('SBI: Statement Summary values not found');
  const [bf, drCount, crCount, totalDr, totalCr, closing] = summary;
  const opening = parsePaise(bf);
  const closingBalance = parsePaise(closing);

  const txns: BankTxn[] = drafts.map((d) => ({
    date: d.date,
    valueDate: d.valueDate,
    description: d.desc.join(' ').replace(/\s+/g, ' ').trim(),
    amount: d.credit - d.debit,
    balanceAfter: d.balance,
  }));

  let running = opening;
  let mismatches = 0;
  for (const t of txns) {
    running += t.amount;
    if (running !== t.balanceAfter) mismatches++;
  }
  const debits = txns.filter((t) => t.amount < 0);
  const credits = txns.filter((t) => t.amount > 0);

  const ppfLine = lines.find((l) => l.page === 1 && l.cells.some((c) => c.s === 'PPF'));
  const asOn = all.match(/As on (\d\d-\d\d-\d{4})/);
  let ppfBalance: BankStatement['ppfBalance'];
  if (ppfLine && asOn) {
    const idx = ppfLine.cells.findIndex((c) => c.s === 'PPF');
    const value = ppfLine.cells[idx + 1]?.s;
    if (value) ppfBalance = { date: parseDate(asOn[1]), balance: parsePaise(value) };
  }

  return {
    source: 'sbi',
    institution: 'SBI',
    accountLast4: acct[1].slice(-4),
    ifsc: ifsc[1],
    periodFrom: parseDate(period[1]),
    periodTo: parseDate(period[2]),
    openingBalance: opening,
    closingBalance,
    txns,
    ppfBalance,
    validation: validation([
      check('opening + Σ rows = closing', closingBalance, running),
      check('running balance mismatches', 0, mismatches),
      check('debit count', Number(drCount), debits.length),
      check('credit count', Number(crCount), credits.length),
      check('total debits', parsePaise(totalDr), -debits.reduce((a, t) => a + t.amount, 0)),
      check('total credits', parsePaise(totalCr), credits.reduce((a, t) => a + t.amount, 0)),
    ]),
  };
}
