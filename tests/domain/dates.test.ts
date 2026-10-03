import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  fyEndDate,
  fyStart,
  monthKey,
  todayIso,
} from '../../src/domain/dates';

describe('addDays', () => {
  it('crosses into a leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('handles negative offsets across a month boundary', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('daysBetween', () => {
  it('counts whole days from a to b', () => {
    expect(daysBetween('2025-01-01', '2026-01-01')).toBe(365);
  });
});

describe('addMonths', () => {
  it('clamps to the end of the target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('crosses a year boundary', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('monthKey', () => {
  it('returns YYYY-MM', () => {
    expect(monthKey('2026-10-03')).toBe('2026-10');
  });
});

describe('fyStart', () => {
  it('starts the financial year in April', () => {
    expect(fyStart('2026-03-31')).toBe(2025);
    expect(fyStart('2026-04-01')).toBe(2026);
  });
});

describe('fyEndDate', () => {
  it('returns 31 March of the following year', () => {
    expect(fyEndDate(2025)).toBe('2026-03-31');
  });
});

describe('todayIso', () => {
  it('uses UTC, not the local timezone', () => {
    expect(todayIso(new Date(Date.UTC(2026, 9, 3, 23, 59)))).toBe('2026-10-03');
  });
});
