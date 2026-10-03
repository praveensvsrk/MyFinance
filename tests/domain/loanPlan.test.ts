import { describe, expect, it } from 'vitest';
import { amortise, standardEmi, whatIf, type AmortiseInput } from '../../src/domain/loanPlan';

const P = 1_000_000_000; // ₹1,00,00,000 in paise
const ANNUAL_PCT = 8.5;
const MONTHS = 240;
const START = '2026-01-01';
const EMI = standardEmi(P, ANNUAL_PCT, MONTHS);

function baseInput(): AmortiseInput {
  return { outstanding: P, annualPct: ANNUAL_PCT, emi: EMI, start: START };
}

function sum(rows: { principal: number; prepay: number }[], key: 'principal' | 'prepay'): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

describe('standardEmi', () => {
  it('rounds up the annuity payment to the whole rupee', () => {
    const r = ANNUAL_PCT / 1200;
    const factor = Math.pow(1 + r, MONTHS);
    const exact = (P * r * factor) / (factor - 1);
    expect(EMI % 100).toBe(0);
    expect(EMI).toBeGreaterThanOrEqual(exact);
    expect(EMI).toBeLessThan(exact + 100);
  });

  it('amortises the loan to zero in exactly the requested months', () => {
    const result = amortise({ ...baseInput() });
    expect(result.months).toBe(240);
    expect(result.rows).toHaveLength(240);
    expect(result.rows[239].outstanding).toBe(0);
    expect(result.rows[239].date).toBe('2045-12-01');
    expect(result.endDate).toBe('2045-12-01');
    expect(result.totalInterest).toBe(result.rows.reduce((total, row) => total + row.interest, 0));
    expect(sum(result.rows, 'principal') + sum(result.rows, 'prepay')).toBe(P);
  });
});

describe('amortise', () => {
  it('applies a lump sum in its month and still ends exactly at the starting outstanding', () => {
    const result = amortise({
      ...baseInput(),
      lumpSums: [{ date: '2026-03-10', amount: 20_000_000 }],
    });
    expect(result.rows[2].prepay).toBe(20_000_000);
    expect(result.rows[2].date).toBe('2026-03-01');
    expect(result.rows[result.months - 1].outstanding).toBe(0);
    expect(sum(result.rows, 'principal') + sum(result.rows, 'prepay')).toBe(P);
  });

  it('clamps month-end dates to the end of the month', () => {
    const result = amortise({
      outstanding: 10_000_000,
      annualPct: 10,
      emi: standardEmi(10_000_000, 10, 12),
      start: '2026-01-31',
    });
    expect(result.rows[0].date).toBe('2026-01-31');
    expect(result.rows[1].date).toBe('2026-02-28');
    expect(result.rows[2].date).toBe('2026-03-31');
  });

  it('throws when the EMI does not cover the first month interest', () => {
    const firstInterest = Math.round((P * ANNUAL_PCT) / 1200);
    expect(() => amortise({ ...baseInput(), emi: firstInterest })).toThrow(
      'EMI does not cover interest',
    );
    expect(() => amortise({ ...baseInput(), emi: firstInterest - 1 })).toThrow(
      'EMI does not cover interest',
    );
  });

  it('rejects a lump sum dated before the schedule starts instead of ignoring it', () => {
    expect(() =>
      amortise({ ...baseInput(), lumpSums: [{ date: '2025-12-15', amount: 20_000_000 }] }),
    ).toThrow('before the schedule start');
    // The start month itself is fine.
    expect(() =>
      amortise({ ...baseInput(), lumpSums: [{ date: '2026-01-02', amount: 20_000_000 }] }),
    ).not.toThrow();
  });

  it('throws when the EMI is zero', () => {
    expect(() => amortise({ ...baseInput(), emi: 0 })).toThrow('EMI does not cover interest');
  });
});

describe('whatIf', () => {
  it('reduce-tenure: the lump sum shortens the loan and saves interest', () => {
    const out = whatIf(baseInput(), {
      ...baseInput(),
      mode: 'reduce-tenure',
      lumpSums: [{ date: '2026-01-15', amount: 50_000_000 }],
    });
    expect(out.baseline.months).toBe(240);
    expect(out.monthsSaved).toBeGreaterThan(0);
    expect(out.interestSaved).toBeGreaterThan(0);
    expect(out.monthsSaved).toBe(out.baseline.months - out.scenario.months);
  });

  it('reduce-emi: the lump sum keeps the original tenure', () => {
    const out = whatIf(baseInput(), {
      ...baseInput(),
      mode: 'reduce-emi',
      lumpSums: [{ date: '2026-01-15', amount: 50_000_000 }],
    });
    expect(out.baseline.months).toBe(240);
    expect(out.scenario.months).toBe(240);
    expect(out.monthsSaved).toBe(0);
  });

  it('throws when the baseline EMI does not cover interest', () => {
    const firstInterest = Math.round((P * ANNUAL_PCT) / 1200);
    expect(() => whatIf({ ...baseInput(), emi: firstInterest }, baseInput())).toThrow(
      'EMI does not cover interest',
    );
  });
});
