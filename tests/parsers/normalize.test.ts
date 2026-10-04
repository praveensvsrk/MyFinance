import { describe, expect, it } from 'vitest';
import {
  fyStartOf,
  isAmount,
  parseDate,
  parseMonthYear,
  parsePaise,
  parsePaiseOrNull,
  parseScaled,
  parseUsDate,
} from '../../src/parsers/normalize';

describe('parsePaise', () => {
  it.each([
    ['5,00,000.00CR', 50000000],
    ['10,00,000.00CR', 100000000],
    ['100.00DR', -10000],
    ['50,000.00(Dr)', -5000000],
    ['80,000.00(Cr)', 8000000],
    ['(13,000.00)', -1300000],
    ['-1,00,00,000.00', -1000000000],
    ['1000.00', 100000],
    ['100000.0', 10000000],
    ['Rs. 10000000', 1000000000],
    ['Rs.75000', 7500000],
    ['INR 20,000.00', 2000000],
    ['$50,000.00', 5000000],
    ['$(30,000.00)', -3000000],
    ['$1,500.00 ', 150000],
    ['1,20,000', 12000000],
    ['0', 0],
  ])('%s → %d', (raw, expected) => {
    expect(parsePaise(raw)).toBe(expected);
  });

  it('returns null for empty cells and non-numbers', () => {
    for (const raw of ['', '-', "'-", '—', 'abc', '34.32%']) expect(parsePaiseOrNull(raw)).toBeNull();
    expect(isAmount('1,234.00')).toBe(true);
    expect(isAmount('UPI')).toBe(false);
  });

  it('throws for non-numbers in the strict variant', () => {
    expect(() => parsePaise('UPI')).toThrow();
  });

  it('never returns negative zero', () => {
    expect(Object.is(parsePaise('(0.00)'), 0)).toBe(true);
  });
});

describe('parseScaled', () => {
  it('scales units, NAVs and prices without float error', () => {
    expect(parseScaled('1,000.000', 3)).toBe(1000000);
    expect(parseScaled('(1,000.000)', 3)).toBe(-1000000);
    expect(parseScaled('2,000.082', 4)).toBe(20000820);
    expect(parseScaled('40.0000', 4)).toBe(400000);
    expect(parseScaled('0.29', 2)).toBe(29);
  });

  it('rounds half up when the input has more decimals than requested', () => {
    expect(parseScaled('$200.000', 2)).toBe(20000);
    expect(parseScaled('1.005', 2)).toBe(101);
    expect(parseScaled('1.004', 2)).toBe(100);
  });
});

describe('dates', () => {
  it.each([
    ['05/04/2026', '2026-04-05'],
    ['05-04-2026', '2026-04-05'],
    ['27-Aug-2026', '2026-08-27'],
    ['24-JAN-2025', '2025-01-24'],
    ['01-Apr-2026', '2026-04-01'],
    ['03/10/2026 17:17', '2026-10-03'],
    ['31/03/2026 10:00:01', '2026-03-31'],
    ['2026-04-05', '2026-04-05'],
    ['05/04/26', '2026-04-05'],
  ])('parseDate(%s) = %s', (raw, iso) => {
    expect(parseDate(raw)).toBe(iso);
  });

  it('parses US month-first dates', () => {
    expect(parseUsDate('07/15/2026')).toBe('2026-07-15');
    expect(parseUsDate('01/24/23')).toBe('2023-01-24');
  });

  it('parses wage months', () => {
    expect(parseMonthYear('Mar-2025')).toBe('2025-03');
  });

  it('rejects garbage', () => {
    expect(() => parseDate('31/31/2026')).toThrow();
    expect(() => parseDate('hello')).toThrow();
  });

  it('computes the financial-year start', () => {
    expect(fyStartOf('2026-03-31')).toBe(2025);
    expect(fyStartOf('2026-04-01')).toBe(2026);
  });
});
