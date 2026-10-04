import type { CardStatement, CardTxn, IsoDate } from './types';
import { linesText, type Cell, type Line } from './pdfText';
import { isoDate, monthNumber, parseDate, parsePaise } from './normalize';
import { check, validation } from './validation';

const DATE_RE = /^\d\d\/\d\d\/\d{4}$/;
const REF_RE = /^\d{6,}$/;
// pdf.js renders the rupee sign as a backtick in these statements.
const AMOUNT_RE = /^[`₹]?\s*([\d,]+\.\d\d)\s*(CR|DR)?$/i;

export function detectIciciCard(text: string): number {
  return /ICICI Bank/i.test(text) && /CREDIT CARD STATEMENT/.test(text) && /Total Amount due/i.test(text) ? 1 : 0;
}

/** "September 26, 2026" → "2026-09-26". */
function parseLongDate(month: string, day: string, year: string): IsoDate {
  return isoDate(+year, monthNumber(month), +day);
}

/** A printed card amount as paise owed: a trailing CR means the card is in credit, so it is negative. */
function owed(raw: string): number | null {
  const m = raw.match(AMOUNT_RE);
  if (!m) return null;
  const v = parsePaise(m[1]);
  return m[2]?.toUpperCase() === 'CR' ? -v : v;
}

const centre = (c: Cell) => (c.x + c.xe) / 2;

export function parseIciciCard(lines: Line[]): CardStatement {
  const all = linesText(lines);
  const period = all.match(/Statement period\s*:\s*([A-Za-z]+) (\d{1,2}), (\d{4}) to ([A-Za-z]+) (\d{1,2}), (\d{4})/i);
  const card = all.match(/\d{4}[X*]{6,10}(\d{4})/);
  if (!period || !card) throw new Error('ICICI card: statement header not found');

  // Each summary figure is printed under its label, so find the amount whose centre lines up.
  const summaryAmount = (label: RegExp): number => {
    for (const [i, l] of lines.entries()) {
      const cell = l.cells.find((c) => label.test(c.s));
      if (!cell) continue;
      for (const below of lines.slice(i + 1)) {
        if (below.page !== l.page || below.y - l.y > 40) break;
        const hit = below.cells.find((c) => Math.abs(centre(c) - centre(cell)) < 25 && owed(c.s) !== null);
        if (hit) return owed(hit.s) as number;
      }
    }
    throw new Error(`ICICI card: "${label.source}" figure not found`);
  };
  const previousBalance = summaryAmount(/^Previous Balance$/i);
  const purchases = summaryAmount(/^Purchases \/ Charges$/i);
  const cashAdvances = summaryAmount(/^Cash Advances$/i);
  const payments = summaryAmount(/^Payments \/ Credits$/i);
  const totalDue = summaryAmount(/^Total Amount due$/i);

  const header = lines.find((l) => ['Date', 'SerNo.', 'Transaction Details'].every((n) => l.cells.some((c) => c.s === n)));
  if (!header) throw new Error('ICICI card: transaction table not found');
  const col = (name: string) => {
    const c = header.cells.find((h) => h.s.startsWith(name));
    if (!c) throw new Error(`ICICI card: column "${name}" not found`);
    return c;
  };
  const dateCol = col('Date');
  const detailsCol = col('Transaction Details');
  const rewardCol = col('Reward');
  const amountCol = col('Amount');

  let running = -previousBalance;
  const txns: CardTxn[] = [];
  for (const l of lines) {
    const at = l.cells.findIndex((c) => DATE_RE.test(c.s) && Math.abs(c.x - dateCol.x) < 12);
    const ref = l.cells[at + 1];
    if (at < 0 || !ref || !REF_RE.test(ref.s)) continue;
    const description = l.cells
      .slice(at + 2)
      .filter((c) => c.x >= detailsCol.x - 5 && c.xe < rewardCol.x - 8)
      .map((c) => c.s)
      .join(' ');
    // A refund or payment prints "1,234.00 CR", sometimes as two cells.
    const printed = l.cells
      .slice(at + 2)
      .filter((c) => c.xe >= amountCol.xe - 25)
      .map((c) => c.s)
      .join(' ');
    const value = owed(printed);
    if (value === null) throw new Error(`ICICI card: no amount on row ${ref.s}`);
    const amount = -value; // a charge is a debit, so it lowers the balance
    running += amount;
    txns.push({ date: parseDate(l.cells[at].s), description, ref: ref.s, amount, balanceAfter: running });
  }

  const debits = -txns.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0);
  const credits = txns.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);

  return {
    source: 'icici-cc',
    institution: 'ICICI',
    cardLast4: card[1],
    periodFrom: parseLongDate(period[1], period[2], period[3]),
    periodTo: parseLongDate(period[4], period[5], period[6]),
    previousBalance,
    purchases,
    cashAdvances,
    payments,
    totalDue,
    txns,
    validation: validation([
      check('previous + purchases + cash − payments = total due', totalDue, previousBalance + purchases + cashAdvances - payments),
      check('Σ charges = purchases + cash advances', purchases + cashAdvances, debits),
      check('Σ payments and refunds = payments / credits', payments, credits),
    ]),
  };
}
