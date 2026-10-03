import type { BankStatement, BankTxn } from './types';
import { linesText, nearestColumn, type Line } from './pdfText';
import { parseDate, parsePaise } from './normalize';
import { check, validation } from './validation';

const DATE_RE = /^\d\d-\d\d-\d{4}$/;
const AMOUNT_RE = /^[\d,]+\.\d\d$/;

export function detectUbiSavings(text: string): number {
  return /UBIN\d{7}/.test(text) && /Account Type\s*:?\s*Saving Account/i.test(text) ? 1 : 0;
}

const band = (l: Line, from: number, to: number) =>
  l.cells.filter((c) => c.x >= from && c.x < to).map((c) => c.s).join('');

export function parseUbiSavings(lines: Line[]): BankStatement {
  const all = linesText(lines);
  const period = all.match(/Statement Period From\s*-?\s*(\d\d\/\d\d\/\d{4}) To (\d\d\/\d\d\/\d{4})/);
  const acct = all.match(/Account No\s*:?\s*(\d{6,})/);
  const ifsc = all.match(/IFSC Code\s*:?\s*(UBIN\w{7})/);
  const records = all.match(/Records from 1 to (\d+)/);
  if (!period || !acct || !ifsc) throw new Error('UBI savings: statement header not found');

  const isHeader = (l: Line) => l.cells.some((c) => c.s === 'Withdrawals') && l.cells.some((c) => c.s === 'Remarks');
  const header = lines.find(isHeader);
  if (!header) throw new Error('UBI savings: transaction table not found');
  const headerCell = (name: string) => {
    const c = header.cells.find((h) => h.s === name);
    if (!c) throw new Error(`UBI savings: column "${name}" not found`);
    return c;
  };
  const cols = {
    withdrawal: headerCell('Withdrawals').xe,
    deposit: headerCell('Deposits').xe,
    balance: headerCell('Balance').xe,
  };
  const refX = headerCell('Tran Id-1').x - 5;
  const utrX = headerCell('UTR Number').x - 5;

  const txns: BankTxn[] = [];
  let footerPage = -1;
  for (const l of lines.slice(lines.indexOf(header) + 1)) {
    if (/^Page No/i.test(l.text)) {
      footerPage = l.page;
      continue;
    }
    if (l.page === footerPage || isHeader(l)) continue;
    const first = l.cells[0];
    if (first && first.x < 95 && DATE_RE.test(first.s)) {
      let amount = 0;
      let balance = 0;
      for (const c of l.cells) {
        if (c.x < utrX || !AMOUNT_RE.test(c.s)) continue;
        const col = nearestColumn(c.xe, cols);
        const v = parsePaise(c.s);
        if (col === 'balance') balance = v;
        else amount = col === 'deposit' ? v : -v;
      }
      txns.push({ date: parseDate(first.s), description: band(l, 95, refX), ref: band(l, refX, utrX), amount, balanceAfter: balance });
    } else if (txns.length) {
      const t = txns[txns.length - 1];
      t.description += band(l, 95, refX);
      t.ref += band(l, refX, utrX);
    }
  }
  if (!txns.length) throw new Error('UBI savings: no transactions found');

  const openingBalance = txns[0].balanceAfter - txns[0].amount;
  let running = openingBalance;
  let mismatches = 0;
  for (const t of txns) {
    running += t.amount;
    if (running !== t.balanceAfter) mismatches++;
  }
  const checks = [check('running balance mismatches', 0, mismatches)];
  if (records) checks.push(check('record count', Number(records[1]), txns.length));

  return {
    source: 'ubi-savings',
    institution: 'UBI',
    accountLast4: acct[1].slice(-4),
    ifsc: ifsc[1],
    periodFrom: parseDate(period[1]),
    periodTo: parseDate(period[2]),
    openingBalance,
    closingBalance: txns[txns.length - 1].balanceAfter,
    txns,
    validation: validation(checks),
  };
}
