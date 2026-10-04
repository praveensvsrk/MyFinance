import { describe, expect, it } from 'vitest';
import { appreciate, propertySeries, propertyValueAt } from '../../src/domain/property';

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
});

describe('propertySeries', () => {
  it('draws from the first valuation through today, including each month end', () => {
    const series = propertySeries([{ date: '2026-09-15', balance: 50_000_000 }], 0, '2026-10-03');
    expect(series.map((point) => point.date)).toEqual(['2026-09-15', '2026-09-30', '2026-10-03']);
    expect(series.every((point) => point.balance === 50_000_000)).toBe(true);
  });
});
