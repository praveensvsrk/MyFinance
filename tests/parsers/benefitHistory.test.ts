import { beforeAll, describe, expect, it } from 'vitest';
import { detectBenefitHistory, parseBenefitHistory, readWorkbook } from '../../src/parsers/benefitHistory';
import type { BenefitHistory } from '../../src/parsers/types';
import { hasValueFixture, readFixture } from '../helpers/fixtures';

const XLSX_FILE = 'etrade/benefit_history.xlsx';
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe.skipIf(!hasValueFixture(XLSX_FILE))('parseBenefitHistory on the real XLSX', () => {
  let bh: BenefitHistory;
  beforeAll(() => {
    const wb = readWorkbook(readFixture(XLSX_FILE));
    expect(detectBenefitHistory(wb)).toBeGreaterThan(0);
    bh = parseBenefitHistory(wb);
  });

  it('reads grants, vests and ESPP purchases', () => {
    expect(bh.source).toBe('etrade-xlsx');
    expect(bh.grants.filter((g) => g.type === 'RSU')).toHaveLength(5);
    expect(bh.esppPurchases).toHaveLength(4);
    expect(bh.grants.filter((g) => g.type === 'ESPP')).toHaveLength(4);
    expect(bh.vests).toHaveLength(40);
    expect(bh.validation.checks.filter((c) => !c.ok)).toEqual([]);
    expect(bh.validation.ok).toBe(true);
  });

  it('reconciles held shares and cost with the client statement', () => {
    const rsu = bh.lots.filter((l) => l.source === 'RSU');
    const espp = bh.lots.filter((l) => l.source === 'ESPP');
    expect(round4(sum(rsu.map((l) => l.remainingShares)))).toBe(90);
    expect(round4(sum(espp.map((l) => l.remainingShares)))).toBe(10.5);
    expect(round4(sum(bh.lots.map((l) => l.remainingShares)))).toBe(100.5);
    expect(Math.abs(sum(bh.lots.map((l) => l.remainingCostUsdCents)) - 5000000)).toBeLessThanOrEqual(100);
  });

  it('reads the unvested schedule per grant', () => {
    const unvested: Record<string, number> = {};
    for (const v of bh.vests.filter((v) => v.status === 'unvested')) {
      unvested[v.grantNumber] = (unvested[v.grantNumber] ?? 0) + v.shares - v.cancelledShares;
    }
    expect(unvested).toEqual({ RU000011: 10, RU000012: 20, RU000013: 30, RU000014: 40 });
  });

  it('derives FMV at vest from the taxable gain', () => {
    const v = bh.vests.find((x) => x.grantNumber === 'RU000013' && x.period === 1)!;
    expect(v).toMatchObject({
      vestDate: '2025-01-15',
      shares: 6,
      vestedShares: 6,
      taxableGainUsdCents: 150000,
      fmvUsdCents: 30000,
      sharesWithheld: 2,
      taxRatePct: 30,
      status: 'vested',
    });
    const future = bh.vests.find((x) => x.grantNumber === 'RU000014' && x.period === 3)!;
    expect(future).toMatchObject({ vestDate: '2026-01-15', status: 'unvested', fmvUsdCents: null });
  });

  it('records sale events without proceeds', () => {
    expect(bh.sales.length).toBeGreaterThan(0);
    expect(bh.sales.some((s) => s.plan === 'ESPP' && s.shares! > 0)).toBe(true);
  });
});
