import { describe, expect, it } from 'vitest';
import { formatInr, formatUsd, pctChange } from '../../src/domain/money';

describe('formatInr', () => {
  it('uses Indian grouping with two decimals', () => {
    expect(formatInr(123456789)).toBe('₹12,34,567.89');
  });

  it('formats a single rupee', () => {
    expect(formatInr(100)).toBe('₹1.00');
  });

  it('prefixes negatives with U+2212', () => {
    expect(formatInr(-5000050)).toBe('−₹50,000.50');
  });

  it('adds + for positives with sign:true', () => {
    expect(formatInr(500, { sign: true })).toBe('+₹5.00');
  });
});

describe('formatInr compact', () => {
  it('formats lakhs with one decimal place', () => {
    expect(formatInr(123456789, { compact: true })).toBe('₹12.3L');
  });

  it('drops the decimals for an exact crore', () => {
    expect(formatInr(1000000000, { compact: true })).toBe('₹1Cr');
  });

  it('formats crores with up to two decimals', () => {
    expect(formatInr(1234567890, { compact: true })).toBe('₹1.23Cr');
  });

  it('formats thousands with one decimal place', () => {
    expect(formatInr(150000, { compact: true })).toBe('₹1.5K');
  });

  it('rounds amounts below a thousand to whole rupees', () => {
    expect(formatInr(99900, { compact: true })).toBe('₹999');
  });
});

describe('formatUsd', () => {
  it('uses US grouping with two decimals', () => {
    expect(formatUsd(5000000)).toBe('$50,000.00');
  });
});

describe('pctChange', () => {
  it('computes the percentage change', () => {
    expect(pctChange(200, 250)).toBe(25);
  });

  it('returns null when the starting value is zero', () => {
    expect(pctChange(0, 123)).toBeNull();
  });
});

describe('formatInr whole', () => {
  it('rounds to whole rupees with Indian grouping', () => {
    expect(formatInr(435_247_049, { whole: true })).toBe('₹43,52,470');
  });

  it('keeps the sign for a real loss and signs a gain on request', () => {
    expect(formatInr(-13_820_000, { whole: true })).toBe('−₹1,38,200');
    expect(formatInr(13_820_000, { whole: true, sign: true })).toBe('+₹1,38,200');
  });

  it('shows no minus sign for a negative that rounds to zero rupees', () => {
    expect(formatInr(-30, { whole: true })).toBe('₹0');
  });
});

describe('formatInr fixed units', () => {
  it('shows every amount in one unit', () => {
    expect(formatInr(830_000, { compact: true, unit: 'thousands' })).toBe('₹8.3K');
    expect(formatInr(3_000_000_00, { compact: true, unit: 'thousands' })).toBe('₹3,000K');
    expect(formatInr(36_000_00, { compact: true, unit: 'lakhs' })).toBe('₹0.36L');
    expect(formatInr(36_00_000_00, { compact: true, unit: 'lakhs' })).toBe('₹36L');
    expect(formatInr(-57_400_00, { compact: true, unit: 'rupees' })).toBe('−₹57,400');
    expect(formatInr(830_000, { compact: true, unit: 'default' })).toBe('₹8.3K');
  });
});
