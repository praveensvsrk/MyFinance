import { describe, expect, it } from 'vitest';
import { dateLong, dateShort, mask, monthLabel, nav, pct, signedPct, units, usdInr } from '../../src/ui/format';

describe('format', () => {
  it('formats percentages', () => {
    expect(pct(12.34)).toBe('12.3%');
    expect(pct(null)).toBe('—');
    expect(signedPct(2.14)).toBe('▲ 2.1%');
    expect(signedPct(-0.4)).toBe('▼ 0.4%');
    expect(signedPct(0)).toBe('0.0%');
    expect(signedPct(null)).toBe('—');
  });

  it('formats dates', () => {
    expect(dateShort('2026-10-03')).toBe('3 Oct');
    expect(dateLong('2026-10-03')).toBe('3 Oct 2026');
    expect(monthLabel('2026-10')).toBe('Oct 2026');
  });

  it('formats units, NAV and FX', () => {
    expect(units(1234567)).toBe('1,234.567');
    expect(units(1500)).toBe('1.5');
    expect(units(2000)).toBe('2');
    expect(nav(1234567)).toBe('₹123.4567');
    expect(usdInr(832500)).toBe('₹83.2500');
  });

  it('masks text when hidden', () => {
    expect(mask('₹1,00,000.00', true)).toBe('••••');
    expect(mask('₹1,00,000.00', false)).toBe('₹1,00,000.00');
  });
});
