import { describe, expect, it } from 'vitest';
import { netWorthAt, netWorthSeries, priceAt, type NetWorthInputs } from '../../src/domain/netWorth';

const ASOF = '2026-10-03';

/** The plan's synthetic example: bank 1e7, cash 5e5, PPF 2e7, EPF 3e7, MF 4e7, 10 shares at $200, USDINR 85, loan 1e8. */
function inputs(over: Partial<NetWorthInputs> = {}): NetWorthInputs {
  return {
    banks: [{ accountId: 'sbi-1234', snapshots: [{ date: '2026-09-30', balance: 10_000_000 }] }],
    cash: [{ accountId: 'cash', snapshots: [{ date: '2026-09-30', balance: 500_000 }] }],
    ppf: [{ accountId: 'sbi-ppf', snapshots: [{ date: '2026-09-30', balance: 20_000_000 }] }],
    epfTotals: [{ accountId: 'epf-00001', at: () => 30_000_000 }],
    mf: () => 40_000_000,
    equity: {
      lots: [{ acquiredDate: '2026-01-15', remainingShares: 10 }],
      acme: [{ date: '2026-09-30', value: 20_000 }],
      usdInr: [{ date: '2026-09-30', value: 850_000 }],
    },
    loanOutstanding: () => 100_000_000,
    ...over,
  };
}

/** Overrides just the equity block while keeping the other inputs. */
function withEquity(equity: NetWorthInputs['equity']): NetWorthInputs {
  return inputs({ equity });
}

describe('priceAt', () => {
  const series = [
    { date: '2026-01-31', value: 100 },
    { date: '2026-06-30', value: 200 },
    { date: '2026-09-30', value: 300 },
  ];

  it('returns the nearest point on or before the date', () => {
    expect(priceAt(series, '2026-06-30')).toEqual({ date: '2026-06-30', value: 200 });
    expect(priceAt(series, '2026-09-15')).toEqual({ date: '2026-06-30', value: 200 });
    expect(priceAt(series, '2027-01-01')).toEqual({ date: '2026-09-30', value: 300 });
  });

  it('returns null when no point is on or before the date', () => {
    expect(priceAt([{ date: '2026-10-01', value: 100 }], '2026-09-30')).toBeNull();
    expect(priceAt([], '2026-09-30')).toBeNull();
  });
});

describe('netWorthAt', () => {
  it("computes the plan's binding example exactly", () => {
    const nw = netWorthAt(inputs(), ASOF);
    expect(nw.total).toBe(117_500_000);
    expect(nw.groups).toEqual({
      liquid: 10_500_000,
      retirement: 50_000_000,
      market: 57_000_000,
      liabilities: -100_000_000,
    });
  });

  it('does not subtract the loan from the total', () => {
    const { total, groups } = netWorthAt(inputs(), ASOF);
    expect(groups.liquid + groups.retirement + groups.market).toBe(total);
    expect(groups.liabilities).toBeLessThan(0);
  });

  it('uses the latest snapshot on or before the date for each account', () => {
    const inp = inputs({
      banks: [
        {
          accountId: 'sbi-1234',
          snapshots: [
            { date: '2026-08-31', balance: 9_000_000 },
            { date: '2026-09-30', balance: 10_000_000 },
          ],
        },
      ],
      cash: [{ accountId: 'cash', snapshots: [{ date: '2026-08-31', balance: 500_000 }] }],
    });
    expect(netWorthAt(inp, '2026-09-15').groups.liquid).toBe(9_500_000);
    expect(netWorthAt(inp, '2026-10-03').groups.liquid).toBe(10_500_000);
  });

  it('counts only lots acquired on or before the date', () => {
    const inp = withEquity({
      lots: [
        { acquiredDate: '2026-09-01', remainingShares: 4 },
        { acquiredDate: '2026-10-01', remainingShares: 6 },
      ],
      acme: [{ date: '2026-09-30', value: 20_000 }],
      usdInr: [{ date: '2026-09-30', value: 850_000 }],
    });
    // 4 × $200 × ₹85 = ₹68,000 = 6,800,000 paise.
    expect(netWorthAt(inp, '2026-09-30').groups.market).toBe(40_000_000 + 6_800_000);
    expect(netWorthAt(inp, '2026-10-03').groups.market).toBe(40_000_000 + 17_000_000);
  });

  it('treats the equity component as 0 when the ACME price is missing', () => {
    const inp = withEquity({
      lots: [{ acquiredDate: '2026-01-15', remainingShares: 10 }],
      acme: [],
      usdInr: [{ date: '2026-09-30', value: 850_000 }],
    });
    expect(netWorthAt(inp, ASOF).groups.market).toBe(40_000_000);
  });

  it('treats the equity component as 0 when the USDINR rate is missing', () => {
    const inp = withEquity({
      lots: [{ acquiredDate: '2026-01-15', remainingShares: 10 }],
      acme: [{ date: '2026-09-30', value: 20_000 }],
      usdInr: [],
    });
    expect(netWorthAt(inp, ASOF).groups.market).toBe(40_000_000);
  });

  it('values equity at the nearest price point on or before the date', () => {
    const inp = withEquity({
      lots: [{ acquiredDate: '2026-01-15', remainingShares: 10 }],
      acme: [
        { date: '2026-08-31', value: 10_000 },
        { date: '2026-09-30', value: 20_000 },
      ],
      usdInr: [{ date: '2026-08-31', value: 850_000 }],
    });
    // On 2026-09-15 the nearest ACME price is $100 → 10 × $100 × ₹85 = ₹85,000 = 8,500,000 paise.
    expect(netWorthAt(inp, '2026-09-15').groups.market).toBe(40_000_000 + 8_500_000);
    // On 2026-09-30 the newer price applies: 10 × $200 × ₹85 = ₹1,70,000 = 17,000,000 paise.
    expect(netWorthAt(inp, '2026-09-30').groups.market).toBe(40_000_000 + 17_000_000);
  });

  it('sums EPF and PPF into retirement and keeps cash in liquid', () => {
    const nw = netWorthAt(
      inputs({
        epfTotals: [
          { accountId: 'epf-a', at: () => 10_000_000 },
          { accountId: 'epf-b', at: () => 20_000_000 },
        ],
      }),
      ASOF,
    );
    expect(nw.groups.retirement).toBe(50_000_000);
  });
});

describe('netWorthSeries', () => {
  it('evaluates netWorthAt for every date, in order', () => {
    const inp = inputs({
      banks: [
        {
          accountId: 'sbi-1234',
          snapshots: [
            { date: '2026-08-31', balance: 9_000_000 },
            { date: '2026-09-30', balance: 10_000_000 },
          ],
        },
      ],
      cash: [{ accountId: 'cash', snapshots: [{ date: '2026-08-31', balance: 500_000 }] }],
      ppf: [{ accountId: 'sbi-ppf', snapshots: [{ date: '2026-08-31', balance: 20_000_000 }] }],
      equity: {
        lots: [{ acquiredDate: '2026-01-15', remainingShares: 10 }],
        acme: [{ date: '2026-08-31', value: 20_000 }],
        usdInr: [{ date: '2026-08-31', value: 850_000 }],
      },
    });
    const dates = ['2026-08-31', '2026-09-15', '2026-10-03'];
    expect(netWorthSeries(inp, dates)).toEqual(dates.map((date) => ({ date, total: netWorthAt(inp, date).total })));
    expect(netWorthSeries(inp, dates).map((p) => p.total)).toEqual([116_500_000, 116_500_000, 117_500_000]);
  });
});
