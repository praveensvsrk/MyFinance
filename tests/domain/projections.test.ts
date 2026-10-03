import { describe, expect, it } from 'vitest';
import {
  defaultEpfMonthly,
  goalMonthlyRequired,
  projectEpf,
  projectPpf,
} from '../../src/domain/projections';
import type { EpfRow } from '../../src/parsers/types';

function epfRow(
  wageMonth: string,
  kind: EpfRow['kind'],
  ee: number,
  er: number,
  extra: Partial<EpfRow> = {},
): EpfRow {
  return {
    wageMonth,
    creditDate: `${wageMonth}-01`,
    kind,
    particulars: '',
    epfWages: 0,
    epsWages: 0,
    amounts: { ee, er, eps: 0 },
    ...extra,
  };
}

describe('projectPpf', () => {
  it('projects 15 FY rows from the FY of asOf with interest credited at FY end', () => {
    const rows = projectPpf({
      balance: 0,
      asOf: '2026-04-01',
      openingFy: 2026,
      yearlyContribution: 15000000,
    });
    expect(rows).toHaveLength(15);
    expect(rows[0]).toEqual({ fy: 2026, contribution: 15000000, interest: 1065000, closing: 16065000 });
    expect(rows[14].fy).toBe(2040);
    const expectedInterest = Math.round((rows[1].closing + 15000000) * 0.071);
    expect(rows[2].interest).toBe(expectedInterest);
  });

  it('caps a yearly contribution at ₹1,50,000', () => {
    const rows = projectPpf({
      balance: 0,
      asOf: '2026-04-01',
      openingFy: 2026,
      yearlyContribution: 20000000,
    });
    expect(rows[0].contribution).toBe(15000000);
    expect(rows[0].closing).toBe(16065000);
  });

  it('adds five years of maturity per extension', () => {
    const rows = projectPpf({
      balance: 0,
      asOf: '2026-04-01',
      openingFy: 2026,
      yearlyContribution: 15000000,
      extensions: 1,
    });
    expect(rows).toHaveLength(20);
    expect(rows[19].fy).toBe(2045);
  });

  it('starts from the FY of asOf and compounds the starting balance', () => {
    const rows = projectPpf({
      balance: 1000000,
      asOf: '2027-04-15',
      openingFy: 2026,
      yearlyContribution: 0,
    });
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({ fy: 2027, contribution: 0, interest: 71000, closing: 1071000 });
  });
});

describe('projectEpf', () => {
  it('credits one full FY of monthly interest at FY end', () => {
    const rows = projectEpf({
      balance: 0,
      asOf: '2026-04-01',
      monthlyContribution: 100000,
      retireDate: '2027-03-31',
    });
    expect(rows).toEqual([{ fy: 2026, closing: 1253625 }]);
  });

  it('accrues interest on the running balance with no contributions', () => {
    const rows = projectEpf({
      balance: 10000000,
      asOf: '2026-04-01',
      monthlyContribution: 0,
      retireDate: '2027-03-31',
    });
    expect(rows).toEqual([{ fy: 2026, closing: 10825000 }]);
  });

  it('compounds the interest it credits at each FY end', () => {
    const rows = projectEpf({
      balance: 1000000,
      asOf: '2026-04-01',
      monthlyContribution: 0,
      retireDate: '2028-03-31',
    });
    expect(rows).toEqual([
      { fy: 2026, closing: 1082500 },
      { fy: 2027, closing: 1171806 },
    ]);
  });
});

describe('defaultEpfMonthly', () => {
  it('averages EE + ER over the last six contribution rows only', () => {
    const rows: EpfRow[] = [
      epfRow('2026-04', 'contribution', 1000, 0),
      epfRow('2026-05', 'contribution', 2000, 0),
      epfRow('2026-06', 'withdrawal', 900000, 900000),
      epfRow('2026-07', 'contribution', 100000, 20000),
      epfRow('2026-08', 'contribution', 100000, 20000),
      epfRow('2026-09', 'contribution', 100000, 20000),
      epfRow('2026-10', 'contribution', 100000, 20000),
      epfRow('2026-11', 'contribution', 100000, 20000),
      epfRow('2026-12', 'contribution', 100000, 20000),
    ];
    expect(defaultEpfMonthly(rows)).toBe(120000);
  });

  it('averages the rows available when there are fewer than six', () => {
    expect(defaultEpfMonthly([epfRow('2026-04', 'contribution', 100, 0), epfRow('2026-05', 'contribution', 201, 0)])).toBe(151);
  });

  it('returns 0 when there are no contribution rows', () => {
    expect(defaultEpfMonthly([epfRow('2026-04', 'withdrawal', 500, 0)])).toBe(0);
    expect(defaultEpfMonthly([])).toBe(0);
  });
});

describe('goalMonthlyRequired', () => {
  it('splits the shortfall over the months remaining', () => {
    expect(goalMonthlyRequired(1e7, 4e6, '2026-10-03', '2027-10-03')).toBe(500000);
  });

  it('rounds up to the next paise', () => {
    expect(goalMonthlyRequired(5, 0, '2026-10-03', '2026-12-03')).toBe(3);
  });

  it('treats a target inside the current month as one month', () => {
    expect(goalMonthlyRequired(1000, 400, '2026-10-03', '2026-10-20')).toBe(600);
  });

  it('requires a whole month when the target day is earlier in the month', () => {
    expect(goalMonthlyRequired(1e7, 0, '2026-10-15', '2027-10-03')).toBe(909091);
  });

  it('returns 0 when the goal is already met', () => {
    expect(goalMonthlyRequired(100, 100, '2026-10-03', '2027-10-03')).toBe(0);
    expect(goalMonthlyRequired(100, 500, '2026-10-03', '2027-10-03')).toBe(0);
  });
});
