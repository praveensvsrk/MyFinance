import type { BankStatement, BankTxn } from './types';
import { linesText, nearestColumn, type Line } from './pdfText';
import { parseDate, parsePaise } from './normalize';
import { check, validation } from './validation';

const DATE_RE = /^\d\d\/\d\d\/\d{4}$/;
const AMOUNT_RE = /^\d+\.\d\d$/;

export function detectFederal(text: string): number {
  return /FDRL\d{7}/.test(text) && /Federal Bank/i.test(text) ? 1 : 0;
}

export function parseFederal(lines: Line[]): BankStatement {
  const all = linesText(lines);
  const period = all.match(/for the period (\d\d-[A-Za-z]{3}-\d{4}) to (\d\d-[A-Za-z]{3}-\d{4})/i);
  const acct = all.match(/Account Number\s*:\s*(\d{6,})/);
  const ifsc = all.match(/IFSC\s*:\s*(FDRL\w{7})/);
  const opening = all.match(/Opening Balance\s*:\s*(-?[\d,]*\d\.\d\d)/);
  if (!period || !acct || !ifsc || !opening) throw new Error('Federal: statement header not found');

  const isHeader = (l: Line) => l.cells.some((c) => c.s === 'Withdrawals') && l.cells.some((c) => c.s === 'Deposits');
  const header = lines.find(isHeader);
  if (!header) throw new Error('Federal: transaction table not found');
  const headerCell = (name: string) => {
    const c = header.cells.find((h) => h.s === name);
    if (!c) throw new Error(`Federal: column "${name}" not found`);
    return c;
  };
  const cols = {
    withdrawal: headerCell('Withdrawals').xe,
    deposit: headerCell('Deposits').xe,
    balance: headerCell('Balance').xe,
  };
  const tranId = headerCell('Tran ID');

  const txns: BankTxn[] = [];
  let grand: Line | undefined;
  let descX = -1;
  for (const l of lines.slice(lines.indexOf(header) + 1)) {
    if (/^GRAND TOTAL/.test(l.text)) {
      grand = l;
      break;
    }
    const first = l.cells[0];
    if (!first) continue;
    if (first.x < 60 && DATE_RE.test(first.s)) {
      const desc = l.cells[2];
      descX = desc.x;
      let amount = 0;
      let balance = 0;
      let ref = '';
      for (const c of l.cells.slice(3)) {
        if (AMOUNT_RE.test(c.s)) {
          const col = nearestColumn(c.xe, cols);
          const v = parsePaise(c.s);
          if (col === 'balance') balance = v;
          else amount = col === 'deposit' ? v : -v;
        } else if (c.x < tranId.xe && c.xe > tranId.x) {
          ref = c.s;
        }
      }
      if (l.cells[l.cells.length - 1].s === 'DR') balance = -balance;
      txns.push({
        date: parseDate(first.s),
        valueDate: parseDate(l.cells[1].s),
        description: desc.s,
        ref,
        amount,
        balanceAfter: balance,
      });
    } else if (txns.length && Math.abs(first.x - descX) < 5 && !/The Federal Bank Ltd/i.test(l.text)) {
      txns[txns.length - 1].description += ' ' + l.text;
    }
  }
  if (!grand) throw new Error('Federal: GRAND TOTAL not found');
  const grandAmounts = grand.cells.filter((c) => AMOUNT_RE.test(c.s)).map((c) => parsePaise(c.s));

  const openingBalance = parsePaise(opening[1]);
  let running = openingBalance;
  let mismatches = 0;
  for (const t of txns) {
    running += t.amount;
    if (running !== t.balanceAfter) mismatches++;
  }
  const closingBalance = txns.length ? txns[txns.length - 1].balanceAfter : openingBalance;

  return {
    source: 'federal',
    institution: 'Federal',
    accountLast4: acct[1].slice(-4),
    ifsc: ifsc[1],
    periodFrom: parseDate(period[1]),
    periodTo: parseDate(period[2]),
    openingBalance,
    closingBalance,
    txns,
    validation: validation([
      check('opening + Σ rows = closing', closingBalance, running),
      check('running balance mismatches', 0, mismatches),
      check('Σ withdrawals = GRAND TOTAL', grandAmounts[0] ?? -1, -txns.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0)),
      check('Σ deposits = GRAND TOTAL', grandAmounts[1] ?? -1, txns.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0)),
    ]),
  };
}
