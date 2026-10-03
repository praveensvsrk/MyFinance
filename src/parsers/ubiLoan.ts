import type { LoanRow, LoanRowKind, LoanStatement } from './types';
import { linesText, type Line } from './pdfText';
import { parseDate, parsePaise } from './normalize';
import { check, validation } from './validation';

const DATE_RE = /^\d\d\/\d\d\/\d{4}$/;
const DRCR_RE = /\((Dr|Cr)\)$/;
const BAL_RE = /^-?[\d,]+\.\d\d$/;

export function detectUbiLoan(text: string): number {
  return /Union Bank of India/i.test(text) && /Account Type\s*:\s*Loan Account/i.test(text) ? 1 : 0;
}

interface Draft {
  date: string;
  description: string;
  ref: string;
  dr: boolean;
  amount: number;
  /** As printed: negative = outstanding. */
  printed: number;
  page: number;
  y: number;
}

/** Change to the printed (negative) balance caused by a row. */
const printedDelta = (d: Draft) => (d.dr ? -d.amount : d.amount);
/** Change to the outstanding (positive) caused by a row. */
const outstandingDelta = (d: Draft) => (d.dr ? d.amount : -d.amount);

function* permutations<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) {
    yield xs.slice();
    return;
  }
  for (let i = 0; i < xs.length; i++) {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...rest];
  }
}

/** Orders same-date rows so that printed balances chain; keeps the given order if none does. */
function orderGroup(group: Draft[], prevPrinted: number | null): Draft[] {
  if (group.length === 1 || group.length > 5) return group;
  for (const perm of permutations(group)) {
    let bal = prevPrinted ?? perm[0].printed - printedDelta(perm[0]);
    let ok = true;
    for (const d of perm) {
      bal += printedDelta(d);
      if (bal !== d.printed) {
        ok = false;
        break;
      }
    }
    if (ok) return perm;
  }
  return group;
}

function kindOf(desc: string, dr: boolean): LoanRowKind {
  if (!dr) return 'repayment';
  if (/Int\.:/.test(desc)) return 'interest';
  if (/Disbursement/i.test(desc)) return 'disbursement';
  return 'charge';
}

export function parseUbiLoan(lines: Line[]): LoanStatement {
  const all = linesText(lines);
  const period = all.match(/Statement Period From\s*-\s*(\d\d\/\d\d\/\d{4}) To (\d\d\/\d\d\/\d{4})/);
  const acct = all.match(/Account No\s*:\s*(\d{6,})/);
  if (!period || !acct) throw new Error('UBI loan: statement header not found');

  const drafts: Draft[] = [];
  for (const l of lines) {
    const first = l.cells[0];
    if (!first) continue;
    if (first.x >= 60 && first.x < 120 && DATE_RE.test(first.s)) {
      const amountCell = l.cells.find((c) => DRCR_RE.test(c.s));
      const balCell = [...l.cells].reverse().find((c) => BAL_RE.test(c.s));
      if (!amountCell || !balCell) continue;
      const band = (from: number, to: number) =>
        l.cells.filter((c) => c.x >= from && c.x < to).map((c) => c.s).join('');
      drafts.push({
        date: parseDate(first.s),
        description: band(150, 380),
        ref: band(380, 470),
        dr: /\(Dr\)$/.test(amountCell.s),
        amount: Math.abs(parsePaise(amountCell.s)),
        printed: parsePaise(balCell.s),
        page: l.page,
        y: l.y,
      });
    } else {
      const d = drafts[drafts.length - 1];
      if (d && d.page === l.page && l.y - d.y > 0 && l.y - d.y < 15 && first.x >= 150 && first.x < 380) {
        d.description += l.text;
      }
    }
  }
  if (!drafts.length) throw new Error('UBI loan: no transactions found');

  // Printed newest first: reverse, then stable-sort by date and fix same-date order.
  const asc = drafts.slice().reverse().sort((a, b) => a.date.localeCompare(b.date));
  const ordered: Draft[] = [];
  for (let i = 0; i < asc.length; ) {
    let j = i;
    while (j < asc.length && asc[j].date === asc[i].date) j++;
    const prev = ordered.length ? ordered[ordered.length - 1].printed : null;
    ordered.push(...orderGroup(asc.slice(i, j), prev));
    i = j;
  }

  // Anchor on the newest printed balance and back-compute from amounts.
  const n = ordered.length;
  const after: number[] = new Array(n);
  after[n - 1] = -ordered[n - 1].printed;
  for (let i = n - 1; i > 0; i--) after[i - 1] = after[i] - outstandingDelta(ordered[i]);
  const openingOutstanding = after[0] - outstandingDelta(ordered[0]);

  const offsets = ordered.map((d, i) => -d.printed - after[i]);
  const bad = offsets.flatMap((o, i) => (o !== 0 ? [i] : []));
  const oneStretch =
    bad.length === 0 ||
    (bad[bad.length - 1] - bad[0] + 1 === bad.length && bad.every((i) => offsets[i] === offsets[bad[0]]));
  const notes: string[] = [];
  if (bad.length && oneStretch) {
    notes.push(
      `Bank balance column inconsistent for ${bad.length} rows (${ordered[bad[0]].date} to ${ordered[bad[bad.length - 1]].date}); outstanding recomputed from amounts`,
    );
  }

  const rows: LoanRow[] = ordered.map((d, i) => {
    const kind = kindOf(d.description, d.dr);
    const row: LoanRow = {
      date: d.date,
      description: d.description,
      ref: d.ref,
      kind,
      amount: d.amount,
      outstandingAfter: after[i],
      printedOutstanding: -d.printed,
    };
    const p = d.description.match(/Int\.:(\d\d-\d\d-\d{4}) to (\d\d-\d\d-\d{4})/);
    if (kind === 'interest' && p) {
      row.interestFrom = parseDate(p[1]);
      row.interestTo = parseDate(p[2]);
    }
    return row;
  });

  return {
    source: 'ubi-loan',
    accountLast4: acct[1].slice(-4),
    periodFrom: parseDate(period[1]),
    periodTo: parseDate(period[2]),
    rows,
    openingOutstanding,
    closingOutstanding: after[n - 1],
    validation: validation(
      [check('printed balance disagreements form at most one constant stretch', 'yes', oneStretch ? 'yes' : 'no')],
      notes,
    ),
  };
}
