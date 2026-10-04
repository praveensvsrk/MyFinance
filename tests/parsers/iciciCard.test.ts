import { beforeAll, describe, expect, it } from 'vitest';
import { detectIciciCard, parseIciciCard } from '../../src/parsers/iciciCard';
import { buildLines, linesText, type RawItem } from '../../src/parsers/pdfText';
import type { CardStatement } from '../../src/parsers/types';
import { fixtureLines, hasFixture } from '../helpers/fixtures';

const CARD = 'icici-cc/statement.pdf';

describe('detectIciciCard', () => {
  it('needs the bank name, the statement title and the due-amount label', () => {
    expect(detectIciciCard('CREDIT CARD STATEMENT\nICICI Bank Credit Card GST Number\nTotal Amount due')).toBe(1);
    expect(detectIciciCard('ICICI Bank savings account statement')).toBe(0);
    expect(detectIciciCard('CREDIT CARD STATEMENT HDFC Bank Total Amount due')).toBe(0);
  });
});

describe.skipIf(!hasFixture(CARD))('parseIciciCard on the real statement (fixtures/' + CARD + ')', () => {
  let st: CardStatement;
  beforeAll(async () => {
    const lines = await fixtureLines(CARD);
    expect(detectIciciCard(linesText(lines))).toBe(1);
    st = parseIciciCard(lines);
  });

  it('reads the header and summary', () => {
    expect(st).toMatchObject({
      source: 'icici-cc',
      institution: 'ICICI',
      cardLast4: '7004',
      periodFrom: '2026-08-27',
      periodTo: '2026-09-26',
      previousBalance: 0,
      purchases: 488669,
      cashAdvances: 0,
      payments: 0,
      totalDue: 488669,
    });
  });

  it('reads every charge and reproduces the summary', () => {
    expect(st.txns).toHaveLength(16);
    expect(st.txns.every((t) => t.amount < 0)).toBe(true);
    expect(st.txns.reduce((a, t) => a + t.amount, 0)).toBe(-488669);
    expect(st.txns[st.txns.length - 1].balanceAfter).toBe(-488669);
    expect(st.validation.ok).toBe(true);
  });

  it('reads the first and last rows without the reward points or the sidebar text', () => {
    expect(st.txns[0]).toEqual({
      date: '2026-09-09',
      description: 'CENTURY GAMES SINGAPORE SG',
      ref: '14139105148',
      amount: -89900,
      balanceAfter: -89900,
    });
    expect(st.txns[15]).toMatchObject({
      date: '2026-09-12',
      description: 'RAZ*ARANI ECOSTEPS LLP Gurgaon HA IN',
      amount: -178000,
    });
  });
});

/** Cells of one synthetic line as raw pdf.js items at explicit x positions. */
function row(y: number, ...cells: [number, number, string][]): RawItem[] {
  return cells.map(([x, xe, s]) => ({ x, y, w: xe - x, s }));
}

function synthetic(opts: { previous: string; purchases: string; payments: string; due: string; rows: RawItem[][] }) {
  const items: RawItem[] = [
    ...row(40, [40, 60, 'ICICI Bank'], [100, 160, 'CREDIT CARD STATEMENT']),
    ...row(60, [40, 70, '4315XXXXXXXX1234']),
    ...row(80, [81, 147, 'Total Amount due'], [221, 276, 'Previous Balance'], [306, 371, 'Purchases / Charges'], [404, 453, 'Cash Advances'], [488, 548, 'Payments / Credits']),
    ...row(92, [90, 135, `\`${opts.due}`], [239, 259, `\`${opts.previous}`], [321, 356, `\`${opts.purchases}`], [418, 438, '`0.00'], [507, 529, `\`${opts.payments}`]),
    ...row(150, [208, 221, 'Date'], [262, 280, 'SerNo.'], [305, 358, 'Transaction Details'], [443, 465, 'Reward'], [486, 498, 'Intl.#'], [522, 557, 'Amount (in`)']),
    ...opts.rows.flat(),
    ...row(300, [40, 300, 'Statement period : August 27, 2026 to September 26, 2026']),
  ];
  return buildLines(items, 1);
}

const txnRow = (y: number, date: string, ref: string, desc: string, amount: [number, number, string][]) =>
  row(y, [208, 239, date], [252, 291, ref], [305, 400, desc], [452, 456, '0'], ...amount);

describe('parseIciciCard on synthetic lines', () => {
  it('reads payments and refunds marked CR, and a previous balance', () => {
    const lines = synthetic({
      previous: '1,000.00',
      purchases: '500.00',
      payments: '1,200.00',
      due: '300.00',
      rows: [
        txnRow(170, '02/09/2026', '11111111111', 'BBPS Payment received', [[505, 557, '1,000.00 CR']]),
        txnRow(184, '05/09/2026', '22222222222', 'SHOP ONE MUMBAI', [[538, 557, '500.00']]),
        // The CR marker may arrive as its own cell.
        txnRow(198, '07/09/2026', '33333333333', 'SHOP ONE REFUND', [[505, 540, '200.00'], [545, 557, 'CR']]),
      ],
    });
    const st = parseIciciCard(lines);
    expect(st.cardLast4).toBe('1234');
    expect(st.txns.map((t) => t.amount)).toEqual([100000, -50000, 20000]);
    expect(st.txns.map((t) => t.balanceAfter)).toEqual([0, -50000, -30000]);
    expect(st.totalDue).toBe(30000);
    expect(st.validation.ok).toBe(true);
  });

  it('treats a total due marked CR as a credit balance', () => {
    const lines = synthetic({ previous: '100.00 CR', purchases: '0.00', payments: '0.00', due: '100.00 CR', rows: [] });
    const st = parseIciciCard(lines);
    expect(st.previousBalance).toBe(-10000);
    expect(st.totalDue).toBe(-10000);
    expect(st.validation.ok).toBe(true);
  });

  it('fails validation when the rows do not add up to the summary', () => {
    const lines = synthetic({
      previous: '0.00',
      purchases: '999.00',
      payments: '0.00',
      due: '999.00',
      rows: [txnRow(170, '05/09/2026', '22222222222', 'SHOP ONE MUMBAI', [[538, 557, '500.00']])],
    });
    const st = parseIciciCard(lines);
    expect(st.validation.ok).toBe(false);
    expect(st.validation.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(['Σ charges = purchases + cash advances']);
  });

  it('throws when the statement header is missing', () => {
    expect(() => parseIciciCard(buildLines(row(10, [10, 50, 'nothing']), 1))).toThrow(/header/);
  });
});
