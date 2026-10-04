import { describe, expect, it } from 'vitest';
import { trendCaption, trendShape } from '../../src/ui/charts/trendGeometry';

const points = [
  { date: '2025-10-31', total: 3_560_000_00 },
  { date: '2026-03-31', total: 3_900_000_00 },
  { date: '2026-10-03', total: 4_352_470_00 },
];

describe('trendCaption', () => {
  it('says whether net worth rose or fell', () => {
    expect(trendCaption(points, false)).toBe('Net worth rose from ₹35.6L in Oct 2025 to ₹43.5L now.');
    expect(trendCaption([...points].reverse().map((p, i) => ({ ...p, date: points[i].date })), false)).toContain('fell');
  });

  it('never states a figure while amounts are hidden', () => {
    expect(trendCaption(points, true)).toBe('Amounts hidden. Shape only.');
  });

  it('needs two points', () => {
    expect(trendCaption(points.slice(0, 1), false)).toBe('Not enough history yet.');
  });
});

describe('trendShape', () => {
  it('draws nothing for fewer than two points', () => {
    expect(trendShape(points.slice(0, 1), [], false)).toBeNull();
  });

  it('puts the lowest point at the bottom and the highest at the top of the plot', () => {
    const shape = trendShape(points, [], false);
    expect(shape?.line.startsWith('M0.0 117.5')).toBe(true);
    expect(shape?.last.y).toBe(32);
    expect(shape?.last.x).toBe(290);
  });

  it('draws a flat series in the middle instead of dividing by zero', () => {
    const flat = points.map((p) => ({ ...p, total: 100 }));
    expect(trendShape(flat, [], false)?.last.y).toBeCloseTo(74.75);
  });

  it('marks a vest inside the range and ignores one outside it', () => {
    const shape = trendShape(points, ['2026-03-31', '2027-01-01'], false);
    expect(shape?.markers).toHaveLength(1);
    expect(shape?.markers[0].x).toBeCloseTo(145);
  });

  it('drops gridlines, labels and markers while amounts are hidden', () => {
    const shape = trendShape(points, ['2026-03-31'], true);
    expect(shape?.grid).toEqual([]);
    expect(shape?.xLabels).toEqual([]);
    expect(shape?.markers).toEqual([]);
  });
});
