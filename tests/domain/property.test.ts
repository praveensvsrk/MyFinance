import { describe, expect, it } from 'vitest';
import { appreciate, gainSince, propertySeries, propertyValueAt, purchaseOf } from '../../src/domain/property';

describe('purchaseOf and gainSince', () => {
  it('reads the stored price, with the date optional', () => {
    expect(purchaseOf({ purchasePrice: 65_000_000, purchaseDate: '2019-03-12' })).toEqual({ price: 65_000_000, date: '2019-03-12' });
    expect(purchaseOf({ purchasePrice: 65_000_000, purchaseDate: '' })).toEqual({ price: 65_000_000, date: null });
    expect(purchaseOf({ purchasePrice: 65_000_000 })?.date).toBeNull();
  });

  it('is null without a usable price', () => {
    expect(purchaseOf(undefined)).toBeNull();
    expect(purchaseOf({})).toBeNull();
    expect(purchaseOf({ purchasePrice: 0 })).toBeNull();
    expect(purchaseOf({ purchasePrice: 'x' })).toBeNull();
  });

  it('gives the gain or loss against the price', () => {
    expect(gainSince(80_000_000, { price: 64_000_000, date: null })).toEqual({ amount: 16_000_000, pct: 25 });
    expect(gainSince(48_000_000, { price: 64_000_000, date: null })).toEqual({ amount: -16_000_000, pct: -25 });
  });
});

describe('appreciate', () => {
  it('leaves the value alone when the rate is 0 or the date has not moved', () => {
    expect(appreciate(100_000_000, '2025-04-01', '2026-04-01', 0)).toBe(100_000_000);
    expect(appreciate(100_000_000, '2026-04-01', '2026-04-01', 5)).toBe(100_000_000);
    expect(appreciate(100_000_000, '2026-04-01', '2025-04-01', 5)).toBe(100_000_000);
  });

  it('compounds for a full year of 365 days', () => {
    expect(appreciate(100_000_000, '2025-10-03', '2026-10-03', 5)).toBe(105_000_000);
    expect(appreciate(100_000_000, '2025-10-03', '2026-10-03', -10)).toBe(90_000_000);
  });
});

describe('propertyValueAt', () => {
  const points = [
    { date: '2024-04-01', balance: 80_000_000 },
    { date: '2026-04-01', balance: 100_000_000 },
  ];

  it('uses the latest entry on or before the date and grows from that day', () => {
    expect(propertyValueAt(points, '2024-03-31', 5)).toBe(0);
    expect(propertyValueAt(points, '2025-04-01', 0)).toBe(80_000_000);
    expect(propertyValueAt(points, '2026-04-01', 5)).toBe(100_000_000);
    expect(propertyValueAt([], '2026-04-01', 5)).toBe(0);
  });

  it('steps up on the purchase date and meets the later valuation without a second jump', () => {
    const valuation = [{ date: '2025-12-31', balance: 400_000_000 }];
    const purchase = { price: 100_000_000, date: '2024-01-01' as const };
    expect(propertyValueAt(valuation, '2023-12-31', 0, purchase)).toBe(0);
    expect(propertyValueAt(valuation, '2024-01-01', 0, purchase)).toBe(100_000_000);
    // 730 days across, so the midpoint is the geometric mean.
    expect(propertyValueAt(valuation, '2024-12-31', 0, purchase)).toBe(200_000_000);
    expect(propertyValueAt(valuation, '2025-12-31', 0, purchase)).toBe(400_000_000);
    expect(propertyValueAt(valuation, '2025-12-30', 0, purchase)).toBeLessThan(400_000_000);
    expect(propertyValueAt(valuation, '2026-12-31', 10, purchase)).toBe(440_000_000);
  });

  it('ignores a purchase that has no date, or that is not earlier than the valuation', () => {
    const points = [{ date: '2024-04-01', balance: 80_000_000 }];
    expect(propertyValueAt(points, '2024-03-31', 0, { price: 50_000_000, date: null })).toBe(0);
    expect(propertyValueAt(points, '2024-04-01', 0, { price: 50_000_000, date: '2024-04-01' })).toBe(80_000_000);
    expect(propertyValueAt(points, '2024-06-01', 0, { price: 50_000_000, date: '2024-05-01' })).toBe(80_000_000);
  });
});

describe('propertySeries', () => {
  it('draws from the first valuation through today, including each month end', () => {
    const series = propertySeries([{ date: '2026-09-15', balance: 50_000_000 }], 0, '2026-10-03');
    expect(series.map((point) => point.date)).toEqual(['2026-09-15', '2026-09-30', '2026-10-03']);
    expect(series.every((point) => point.balance === 50_000_000)).toBe(true);
  });

  it('starts at the purchase date when that is earlier than the valuation', () => {
    const series = propertySeries([{ date: '2026-09-15', balance: 50_000_000 }], 0, '2026-10-03', {
      price: 40_000_000,
      date: '2026-08-10',
    });
    expect(series[0]).toEqual({ date: '2026-08-10', balance: 40_000_000 });
    expect(series.at(-1)?.balance).toBe(50_000_000);
    expect(series.find((point) => point.date === '2026-08-31')?.balance).toBeGreaterThan(40_000_000);
    expect(series.find((point) => point.date === '2026-08-31')?.balance).toBeLessThan(50_000_000);
  });
});
