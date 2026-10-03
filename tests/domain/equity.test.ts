import { describe, expect, it } from 'vitest';
import { crossCheck, lotGainInr, releasedValueInr, unvestedShares, upcomingVest } from '../../src/domain/equity';
import type { EtradeStatement, LotRec, VestRec } from '../../src/parsers/types';

function vest(
  grantNumber: string,
  vestDate: string,
  shares: number,
  status: VestRec['status'] = 'unvested',
): VestRec {
  return {
    grantNumber,
    period: 1,
    vestDate,
    shares,
    cancelledShares: 0,
    vestedShares: status === 'vested' ? shares : 0,
    releasedShares: 0,
    sellableShares: 0,
    sharesWithheld: 0,
    fmvUsdCents: null,
    taxableGainUsdCents: null,
    taxRatePct: null,
    status,
  };
}

function lot(remainingShares: number, costPerShareUsdCents: number, remainingCostUsdCents: number): LotRec {
  return {
    key: 'RU1#1',
    source: 'RSU',
    acquiredDate: '2026-01-01',
    netShares: remainingShares,
    remainingShares,
    costPerShareUsdCents,
    remainingCostUsdCents,
  };
}

function statement(over: Partial<EtradeStatement> = {}): EtradeStatement {
  return {
    source: 'etrade-stmt',
    periodFrom: '2026-09-01',
    periodTo: '2026-09-30',
    symbol: 'ACME',
    quantity: 0,
    priceUsdCents: 20000,
    totalCostUsdCents: 0,
    marketValueUsdCents: 0,
    unvested: [],
    validation: { ok: true, checks: [], notes: [] },
    ...over,
  };
}

describe('releasedValueInr', () => {
  it('values released lots in paise, independently recomputed', () => {
    // Recompute the plan's example from its own binding formula:
    // round(100.5 shares × $200.00 × ₹85.0000 per USD).
    const expected = Math.round((100.5 * 20000 * 850000) / 10_000);
    expect(expected).toBe(170_850_000);
    expect(releasedValueInr([{ remainingShares: 100.5 }], 20000, 850000)).toBe(expected);
  });

  it('sums across lots before rounding', () => {
    const expected = Math.round((5 * 25000 * 850000) / 10_000);
    expect(releasedValueInr([{ remainingShares: 2 }, { remainingShares: 3 }], 25000, 850000)).toBe(expected);
  });
});

describe('unvestedShares', () => {
  it('counts only future unvested vests', () => {
    const vests = [
      vest('RU1', '2026-12-15', 12),
      vest('RU2', '2026-12-15', 22),
      vest('RU1', '2026-06-15', 6, 'vested'),
      vest('RU1', '2026-01-15', 5), // unvested status but already past
    ];
    expect(unvestedShares(vests, '2026-10-03')).toBe(34);
  });
});

describe('upcomingVest', () => {
  it('sums grants vesting on the same earliest date', () => {
    const vests = [
      vest('G1', '2027-03-15', 20),
      vest('G1', '2026-12-15', 12),
      vest('G2', '2026-12-15', 22),
      vest('G1', '2026-06-15', 6, 'vested'),
    ];
    expect(upcomingVest(vests, '2026-10-03')).toEqual({ date: '2026-12-15', shares: 34 });
  });

  it('returns null when nothing vests in the future', () => {
    expect(upcomingVest([vest('G1', '2026-06-15', 6, 'vested')], '2026-10-03')).toBeNull();
  });
});

describe('lotGainInr', () => {
  const held = { remainingShares: 10, costPerShareUsdCents: 20_000, usdInrOnAcquire: 800_000 };

  it('is positive when price and USDINR rise: value at spot minus cost at acquire rate', () => {
    expect(lotGainInr(held, 25_000, 850_000)).toBe(21_250_000 - 16_000_000);
  });

  it('is negative when the price falls', () => {
    expect(lotGainInr(held, 15_000, 850_000)).toBe(12_750_000 - 16_000_000);
  });
});

describe('crossCheck', () => {
  const lots = [lot(90, 20_000, 3_000_000), lot(10.5, 10_000, 186_470)];
  const vests = [
    vest('RU1', '2026-12-15', 12),
    vest('RU2', '2026-12-15', 22),
    vest('RU1', '2026-06-15', 6, 'vested'),
  ];
  const base = {
    quantity: 100.5,
    totalCostUsdCents: 3_186_474,
    unvested: [
      { grantDate: '2025-01-24', grantNumber: 'RU1', quantity: 12 },
      { grantDate: '2025-04-24', grantNumber: 'RU2', quantity: 22 },
    ],
  };

  it('passes with a 4¢ total-cost gap', () => {
    const checks = crossCheck(statement(base), lots, vests);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('fails with a $2 total-cost gap', () => {
    const checks = crossCheck(statement({ ...base, totalCostUsdCents: 3_186_470 + 200 }), lots, vests);
    expect(checks.find((c) => c.name === 'cost')?.ok).toBe(false);
    expect(checks.find((c) => c.name === 'quantity')?.ok).toBe(true);
  });

  it('fails when the held quantity disagrees', () => {
    const checks = crossCheck(statement({ ...base, quantity: 180 }), lots, vests);
    expect(checks.find((c) => c.name === 'quantity')?.ok).toBe(false);
  });

  it('fails when unvested shares disagree per grant', () => {
    const checks = crossCheck(
      statement({ ...base, unvested: [{ grantDate: '2025-01-24', grantNumber: 'RU1', quantity: 11 }] }),
      lots,
      vests,
    );
    expect(checks.find((c) => c.name === 'unvested:RU1')?.ok).toBe(false);
  });
});
