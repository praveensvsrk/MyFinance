import { beforeAll, describe, expect, it } from 'vitest';
import { detectUbiLoan, parseUbiLoan } from '../../src/parsers/ubiLoan';
import { fyStartOf } from '../../src/parsers/normalize';
import { linesText } from '../../src/parsers/pdfText';
import type { LoanRow, LoanStatement } from '../../src/parsers/types';
import { fixtureLines, hasValueFixture } from '../helpers/fixtures';

const CURRENT = 'ubi/loan_current.pdf';
const YEARLY = ['ubi/loan_history_1.pdf', 'ubi/loan_history_2.pdf', 'ubi/loan_history_3.pdf', 'ubi/loan_history_4.pdf'];
const ALL = [...YEARLY, CURRENT];
const sum = (rows: LoanRow[]) => rows.reduce((a, r) => a + r.amount, 0);
const key = (r: LoanRow) => `${r.date}|${r.kind}|${r.amount}|${r.ref}`;

describe('detectUbiLoan', () => {
  it('needs the bank name and the loan account type', () => {
    expect(detectUbiLoan('Union Bank of India\nAccount Type : Loan Account')).toBeGreaterThan(0);
    expect(detectUbiLoan('Union Bank of India\nAccount Type Saving Account')).toBe(0);
  });
});

describe.skipIf(!hasValueFixture(CURRENT))('parseUbiLoan on the current statement', () => {
  let st: LoanStatement;
  beforeAll(async () => {
    const lines = await fixtureLines(CURRENT);
    expect(detectUbiLoan(linesText(lines))).toBeGreaterThan(0);
    st = parseUbiLoan(lines);
  });

  it('reads rows ascending with recomputed outstanding', () => {
    expect(st).toMatchObject({ source: 'ubi-loan', periodFrom: '2026-04-01', periodTo: '2026-10-03' });
    expect(st.rows).toHaveLength(13);
    expect(st.rows.map((r) => r.date)).toEqual([...st.rows.map((r) => r.date)].sort());
    expect(st.openingOutstanding).toBe(980000000);
    expect(st.closingOutstanding).toBe(930000000);
    expect(st.rows.filter((r) => r.kind === 'interest')).toHaveLength(6);
    expect(st.rows.filter((r) => r.kind === 'repayment')).toHaveLength(7);
    expect(sum(st.rows.filter((r) => r.kind === 'interest'))).toBe(30000000);
    expect(sum(st.rows.filter((r) => r.kind === 'repayment'))).toBe(80000000);
    expect(st.validation.ok).toBe(true);
    expect(st.validation.notes).toEqual([]);
  });

  it('orders same-date rows so the chain holds (interest before EMI on 25-05)', () => {
    const may25 = st.rows.filter((r) => r.date === '2026-05-25');
    expect(may25.map((r) => r.kind)).toEqual(['interest', 'repayment']);
    expect(st.rows.every((r) => r.printedOutstanding === r.outstandingAfter)).toBe(true);
  });

  it('parses the wrapped interest period', () => {
    const last = st.rows[st.rows.length - 1];
    expect(last).toMatchObject({ kind: 'interest', date: '2026-09-25', amount: 5000000, interestFrom: '2026-08-25', interestTo: '2026-09-24' });
  });
});

describe.skipIf(!ALL.every(hasValueFixture))('parseUbiLoan across the full history', () => {
  const parsed: Record<string, LoanStatement> = {};
  beforeAll(async () => {
    for (const f of ALL) parsed[f] = parseUbiLoan(await fixtureLines(f));
  });

  it('starts at the first disbursement', () => {
    const fy23 = parsed['ubi/loan_history_1.pdf'];
    expect(fy23.openingOutstanding).toBe(0);
    expect(fy23.rows[0]).toMatchObject({ date: '2020-01-15', kind: 'disbursement', amount: 100000000 });
  });

  it('tolerates one constant-offset stretch in the bank balance column', () => {
    for (const f of ['ubi/loan_history_3.pdf', 'ubi/loan_history_4.pdf']) {
      expect(parsed[f].validation.ok).toBe(true);
      expect(parsed[f].validation.notes).toHaveLength(1);
      expect(parsed[f].validation.notes[0]).toMatch(/recomputed/);
    }
    for (const f of ['ubi/loan_history_1.pdf', 'ubi/loan_history_2.pdf']) expect(parsed[f].validation.ok).toBe(true);
  });

  it('chains end to end and matches the FY 2025-26 interest certificate', () => {
    const merged = new Map<string, LoanRow>();
    for (const f of ALL) for (const r of parsed[f].rows) merged.set(key(r), r);
    const rows = [...merged.values()];
    expect(sum(rows.filter((r) => r.kind === 'disbursement'))).toBe(1000000000);
    const fy25 = rows.filter((r) => fyStartOf(r.date) === 2025);
    const interest = sum(fy25.filter((r) => r.kind === 'interest'));
    const repaid = sum(fy25.filter((r) => r.kind === 'repayment'));
    expect(interest).toBe(80000000);
    expect(repaid).toBe(150000000);
    expect(repaid - interest).toBe(70000000);
  });

  it('gives identical outstanding for rows present in two statements', () => {
    const older = new Map(parsed['ubi/loan_history_4.pdf'].rows.map((r) => [key(r), r]));
    const overlap = parsed[CURRENT].rows.filter((r) => older.has(key(r)));
    expect(overlap).toHaveLength(5);
    for (const r of overlap) expect(r.outstandingAfter).toBe(older.get(key(r))!.outstandingAfter);
  });
});
