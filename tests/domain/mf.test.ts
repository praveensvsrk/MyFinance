import { describe, expect, it } from 'vitest';
import { investedCost, schemeCashflows, schemeValue, unitsAt } from '../../src/domain/mf';
import { fifoRemainingCost, type FifoTxn } from '../../src/domain/mfFifo';
import type { CasTxn } from '../../src/parsers/types';

function casTxn(date: string, type: CasTxn['type'], amount: number, units: number, stampDuty = 0): CasTxn {
  return {
    date,
    description: '',
    type,
    amount,
    units,
    nav: 0,
    unitBalance: 0,
    stampDuty,
    stt: 0,
    tds: 0,
  };
}

describe('unitsAt', () => {
  const txns = [
    { date: '2026-01-01', units: 100000 },
    { date: '2026-02-01', units: 200000 },
    { date: '2026-03-01', units: -50000 },
  ];

  it('sums units dated on or before the date', () => {
    expect(unitsAt(txns, '2026-02-01')).toBe(300000);
    expect(unitsAt(txns, '2026-03-01')).toBe(250000);
  });

  it('returns 0 before the first transaction', () => {
    expect(unitsAt(txns, '2025-12-31')).toBe(0);
  });
});

describe('schemeValue', () => {
  it('converts ×1000 units at a ×10⁴ NAV into paise', () => {
    // 1,000 units at NAV 25.0000 = ₹25,000.00.
    expect(schemeValue(1_000_000, 250000)).toBe(2_500_000);
  });

  it('rounds the result to whole paise', () => {
    // 1.234 units × 45.6789 = 56.3677626 → 5636.77626 paise.
    expect(schemeValue(1234, 456789)).toBe(5637);
  });
});

describe('investedCost', () => {
  it('is the FIFO remaining cost of the open lots', () => {
    const txns: FifoTxn[] = [
      { date: '2026-01-01', type: 'sip', amount: 100000, units: 1000, stampDuty: 50 },
      { date: '2026-02-01', type: 'sip', amount: 300000, units: 2000, stampDuty: 0 },
      { date: '2026-03-01', type: 'redemption', amount: -250000, units: -1500, stampDuty: 0 },
    ];
    expect(investedCost(txns)).toBe(fifoRemainingCost(txns));
    expect(investedCost(txns)).toBe(225000);
  });
});

describe('schemeCashflows', () => {
  it('signs purchases as negative gross (amount + stamp duty)', () => {
    const flows = schemeCashflows([casTxn('2026-04-01', 'sip', 2199890, 879956, 110)], '2026-06-30', 2_500_000);
    expect(flows).toEqual([
      { date: '2026-04-01', amount: -2_200_000 },
      { date: '2026-06-30', amount: 2_500_000 },
    ]);
  });

  it('signs redemptions as positive flows', () => {
    const flows = schemeCashflows([casTxn('2026-04-01', 'redemption', -500000, -19540)], '2026-06-30', 100_000);
    expect(flows).toEqual([
      { date: '2026-04-01', amount: 500_000 },
      { date: '2026-06-30', amount: 100_000 },
    ]);
  });

  it('produces flows xirr can consume (both signs present)', () => {
    const flows = schemeCashflows(
      [casTxn('2026-04-01', 'sip', 100000, 4000), casTxn('2026-05-01', 'redemption', -20000, -800)],
      '2026-06-30',
      90000,
    );
    expect(flows.some((f) => f.amount < 0)).toBe(true);
    expect(flows.some((f) => f.amount > 0)).toBe(true);
    expect(flows[flows.length - 1]).toEqual({ date: '2026-06-30', amount: 90_000 });
  });
});
