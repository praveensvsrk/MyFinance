import { describe, expect, it } from 'vitest';
import { groupRupees, isRealDate, parseNumber, parseRupees, rupeesText } from '../../src/ui/common/amount';
import { groupByDay } from '../../src/ui/common/groupByDay';
import { thin } from '../../src/ui/charts/TrendChart';
import { bytesText, durationText, fyLabel } from '../../src/ui/format';

describe('parseRupees', () => {
  it('reads plain, grouped and ₹-prefixed amounts into paise', () => {
    expect(parseRupees('2500')).toBe(250_000);
    expect(parseRupees('1,50,000')).toBe(15_000_000);
    expect(parseRupees('₹ 2500.5')).toBe(250_050);
    expect(parseRupees('0.005')).toBe(1);
  });
  it('rejects empty, negative and non-numeric text', () => {
    for (const bad of ['', ' ', '-5', 'abc', '1.2.3', '12L']) expect(parseRupees(bad)).toBeNull();
  });
});

describe('rupeesText', () => {
  it('drops the decimals of whole rupees', () => {
    expect(rupeesText(250_000)).toBe('2500');
    expect(rupeesText(250_050)).toBe('2500.50');
  });
});

describe('parseNumber and isRealDate', () => {
  it('parses decimals and rejects junk', () => {
    expect(parseNumber('8.25')).toBe(8.25);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('x')).toBeNull();
  });
  it('accepts only real calendar dates', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-2-3')).toBe(false);
    expect(isRealDate('')).toBe(false);
  });
});

describe('groupByDay', () => {
  it('groups adjacent rows of the same date and keeps their order', () => {
    const rows = [
      { date: '2026-10-03', id: 'a' },
      { date: '2026-10-03', id: 'b' },
      { date: '2026-10-01', id: 'c' },
    ];
    expect(groupByDay(rows).map((g) => [g.date, g.items.map((r) => r.id)])).toEqual([
      ['2026-10-03', ['a', 'b']],
      ['2026-10-01', ['c']],
    ]);
  });
});

describe('thin', () => {
  it('keeps short series whole and long ones to 60 points with both ends', () => {
    expect(thin([1, 2, 3])).toEqual([1, 2, 3]);
    const long = Array.from({ length: 500 }, (_, i) => i);
    const out = thin(long);
    expect(out).toHaveLength(60);
    expect(out[0]).toBe(0);
    expect(out[59]).toBe(499);
  });
});

describe('format helpers', () => {
  it('labels financial years, durations and sizes', () => {
    expect(fyLabel(2026)).toBe('FY 2026-27');
    expect(fyLabel(2099)).toBe('FY 2099-00');
    expect(durationText(0)).toBe('0 mo');
    expect(durationText(7)).toBe('7 mo');
    expect(durationText(24)).toBe('2 yr');
    expect(durationText(40)).toBe('3 yr 4 mo');
    expect(bytesText(512)).toBe('512 B');
    expect(bytesText(2048)).toBe('2 KB');
    expect(bytesText(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});

describe('groupRupees', () => {
  it('groups the rupees the Indian way as they are typed', () => {
    expect(groupRupees('5220484')).toBe('52,20,484');
    expect(groupRupees('100000')).toBe('1,00,000');
    expect(groupRupees('999')).toBe('999');
    expect(groupRupees('')).toBe('');
  });
  it('keeps the decimals and a trailing point as typed', () => {
    expect(groupRupees('150000.5')).toBe('1,50,000.5');
    expect(groupRupees('150000.')).toBe('1,50,000.');
    expect(groupRupees('0.05')).toBe('0.05');
  });
  it('regroups text that already has commas', () => {
    expect(groupRupees('5,220,484')).toBe('52,20,484');
  });
  it('leaves text that is not an amount alone, so the field can flag it', () => {
    expect(groupRupees('12L')).toBe('12L');
    expect(groupRupees('1.2.3')).toBe('1.2.3');
  });
});
