import { describe, expect, it } from 'vitest';
import {
  classifyLoanCredit,
  deriveRates,
  planningRate,
  rateChanged,
  rateHistory,
  snapRate,
} from '../../src/domain/loanRates';
import type { LoanRow } from '../../src/parsers/types';

function loanRow(
  date: string,
  kind: LoanRow['kind'],
  amount: number,
  outstandingAfter: number,
  extra: Partial<LoanRow> = {},
): LoanRow {
  return {
    date,
    description: '',
    ref: '',
    kind,
    amount,
    outstandingAfter,
    printedOutstanding: outstandingAfter,
    ...extra,
  };
}

describe('classifyLoanCredit', () => {
  it('classifies a credit within 1% of the EMI as an EMI', () => {
    expect(classifyLoanCredit(7550000, 7500000)).toBe('emi');
  });

  it('classifies larger credits as prepayments', () => {
    expect(classifyLoanCredit(50000000, 7500000)).toBe('prepayment');
    expect(classifyLoanCredit(2000000, 7500000)).toBe('prepayment');
  });

  it('includes the 1% boundaries', () => {
    expect(classifyLoanCredit(10100, 10000)).toBe('emi');
    expect(classifyLoanCredit(9900, 10000)).toBe('emi');
    expect(classifyLoanCredit(10101, 10000)).toBe('prepayment');
    expect(classifyLoanCredit(9899, 10000)).toBe('prepayment');
  });
});

describe('deriveRates', () => {
  it('derives a flat rate from the interest row', () => {
    const interest = Math.round((1e9 * 0.0785 * 31) / 365);
    const rows: LoanRow[] = [
      loanRow('2026-01-01', 'disbursement', 1e9, 1e9),
      loanRow('2026-02-24', 'interest', interest, 1e9 + interest, {
        interestFrom: '2026-01-25',
        interestTo: '2026-02-24',
      }),
    ];
    const derived = deriveRates(rows);
    expect(derived).toHaveLength(1);
    expect(derived[0].date).toBe('2026-02-24');
    expect(Math.abs(derived[0].ratePct - 7.85)).toBeLessThanOrEqual(0.001);
  });

  it('weights each day by that day’s outstanding', () => {
    const interest =
      Math.round((1e9 * 0.0785 * 16) / 365) + Math.round((9e8 * 0.0785 * 15) / 365);
    const rows: LoanRow[] = [
      loanRow('2026-01-01', 'disbursement', 1e9, 1e9),
      loanRow('2026-02-10', 'repayment', 1e8, 9e8),
      loanRow('2026-02-24', 'interest', interest, 9e8 + interest, {
        interestFrom: '2026-01-25',
        interestTo: '2026-02-24',
      }),
    ];
    const derived = deriveRates(rows);
    expect(derived).toHaveLength(1);
    expect(Math.abs(derived[0].ratePct - 7.85)).toBeLessThanOrEqual(0.001);
  });

  it('skips interest rows without a period', () => {
    const rows: LoanRow[] = [loanRow('2026-01-31', 'interest', 700000, 1e9 + 700000)];
    expect(deriveRates(rows)).toEqual([]);
  });
});

describe('snapRate', () => {
  it('rounds to the nearest 0.05', () => {
    expect(snapRate(7.86)).toBe(7.85);
    expect(snapRate(7.88)).toBe(7.9);
    expect(snapRate(9.1)).toBe(9.1);
  });
});

describe('rateHistory', () => {
  const dates = [
    '2026-01-01',
    '2026-02-01',
    '2026-03-01',
    '2026-04-01',
    '2026-05-01',
    '2026-06-01',
    '2026-07-01',
    '2026-08-01',
  ];
  const derived = [9.1, 9.11, 8.05, 9.1, 8.06, 8.04, 7.86, 7.84].map((ratePct, i) => ({
    date: dates[i],
    ratePct,
  }));

  it('records only confirmed steps, dated at the first of the two readings', () => {
    expect(rateHistory(derived)).toEqual([
      { from: '2026-01-01', ratePct: 9.1 },
      { from: '2026-05-01', ratePct: 8.05 },
      { from: '2026-07-01', ratePct: 7.85 },
    ]);
  });

  it('returns an empty history when there are no readings', () => {
    expect(rateHistory([])).toEqual([]);
  });
});

describe('planningRate', () => {
  const dates = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'];

  it('is the snapped median of the last three readings', () => {
    const derived = [8.05, 7.86, 7.84, 7.88].map((ratePct, i) => ({ date: dates[i], ratePct }));
    expect(planningRate(derived)).toBe(7.85);
  });

  it('is null when there are no readings', () => {
    expect(planningRate([])).toBeNull();
  });
});

describe('rateChanged', () => {
  it('is true when the last two raw readings differ by more than 0.1', () => {
    expect(
      rateChanged([
        { date: '2026-01-01', ratePct: 8.05 },
        { date: '2026-02-01', ratePct: 7.86 },
      ]),
    ).toBe(true);
  });

  it('is false for small moves and fewer than two readings', () => {
    expect(
      rateChanged([
        { date: '2026-01-01', ratePct: 9.1 },
        { date: '2026-02-01', ratePct: 9.11 },
      ]),
    ).toBe(false);
    expect(rateChanged([{ date: '2026-01-01', ratePct: 9.1 }])).toBe(false);
    expect(rateChanged([])).toBe(false);
  });
});
