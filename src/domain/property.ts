import type { IsoDate, Paise } from '../parsers/types';
import { addDays, addMonths, daysBetween, monthKey } from './dates';

/** A value the user entered for the home on a given day. */
export interface PropertyPoint {
  date: IsoDate;
  balance: Paise;
}

/** The yearly change stored on a property account, or 0 when it was never set. */
export function annualPctOf(meta: Record<string, unknown> | undefined): number {
  const value = meta?.appreciationPct;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Grows `balance` from `from` to `to` at a compound annual percent, actual/365.
 * A later entry replaces this: growth always starts from the latest value on or before the date.
 */
export function appreciate(balance: Paise, from: IsoDate, to: IsoDate, annualPct: number): Paise {
  if (to <= from || annualPct === 0) return balance;
  const years = daysBetween(from, to) / 365;
  return Math.round(balance * (1 + annualPct / 100) ** years);
}

/** Worth on `date`: the latest entry on or before it, grown to that date. 0 before the first entry. */
export function propertyValueAt(points: PropertyPoint[], date: IsoDate, annualPct: number): Paise {
  let best: PropertyPoint | null = null;
  for (const point of points) {
    if (point.date > date) continue;
    if (best === null || point.date > best.date) best = point;
  }
  if (best === null) return 0;
  return appreciate(best.balance, best.date, date, annualPct);
}

/**
 * One point per entered value, each month-end, and `today`, so a single valuation still draws a
 * line forward. Dates before the first entry are left out.
 */
export function propertySeries(
  points: PropertyPoint[],
  annualPct: number,
  today: IsoDate,
): { date: IsoDate; balance: Paise }[] {
  if (points.length === 0) return [];
  const first = points.reduce((earliest, point) => (point.date < earliest ? point.date : earliest), points[0].date);
  if (first > today) return [];

  const dates = new Set<IsoDate>();
  for (const point of points) {
    if (point.date <= today) dates.add(point.date);
  }
  let cursor = monthKey(first);
  const end = monthKey(today);
  while (cursor <= end) {
    const monthEnd = addDays(addMonths(`${cursor}-01`, 1), -1);
    dates.add(monthEnd > today ? today : monthEnd);
    cursor = monthKey(addMonths(`${cursor}-01`, 1));
  }
  return [...dates]
    .sort()
    .map((date) => ({ date, balance: propertyValueAt(points, date, annualPct) }));
}
