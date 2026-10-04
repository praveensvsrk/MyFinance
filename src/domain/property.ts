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

/** What the home was bought for, as the user entered it. The date is optional. */
export interface Purchase {
  price: Paise;
  date: IsoDate | null;
}

/** The purchase stored on a property account, or null when none was entered. */
export function purchaseOf(meta: Record<string, unknown> | undefined): Purchase | null {
  const price = meta?.purchasePrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  const date = meta?.purchaseDate;
  return { price, date: typeof date === 'string' && date !== '' ? date : null };
}

/** Value minus purchase price, and that as a percent of the price. */
export function gainSince(value: Paise, purchase: Purchase): { amount: Paise; pct: number } {
  const amount = value - purchase.price;
  return { amount, pct: (amount / purchase.price) * 100 };
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

/**
 * The purchase, when it is earlier than every valuation. A valuation already on or before the
 * purchase date is the worth that day, so the purchase price is not a second point.
 */
function purchaseAnchor(points: PropertyPoint[], purchase: Purchase | null | undefined): PropertyPoint | null {
  if (purchase?.date == null) return null;
  for (const point of points) {
    if (point.date <= purchase.date) return null;
  }
  return { date: purchase.date, balance: purchase.price };
}

function earliest(points: PropertyPoint[]): PropertyPoint | undefined {
  return points.reduce<PropertyPoint | undefined>(
    (best, point) => (best === undefined || point.date < best.date ? point : best),
    undefined,
  );
}

/**
 * Worth between the purchase and the first valuation. The line passes through both figures, so
 * recording today's value does not add the whole home on the day it was typed in.
 */
function bridge(opening: PropertyPoint, next: PropertyPoint, date: IsoDate): Paise {
  const span = daysBetween(opening.date, next.date);
  if (span <= 0) return next.balance;
  const fraction = daysBetween(opening.date, date) / span;
  if (opening.balance <= 0) return Math.round(opening.balance + (next.balance - opening.balance) * fraction);
  return Math.round(opening.balance * (next.balance / opening.balance) ** fraction);
}

/**
 * Worth on `date`. 0 before the home was bought, or before the first valuation when no purchase
 * date was entered. From the purchase up to the first valuation the value runs from the price
 * paid to that valuation. After a valuation it grows from that valuation at `annualPct`.
 */
export function propertyValueAt(
  points: PropertyPoint[],
  date: IsoDate,
  annualPct: number,
  purchase?: Purchase | null,
): Paise {
  const opening = purchaseAnchor(points, purchase);
  const next = earliest(points);
  if (opening !== null && (next === undefined || date < next.date)) {
    if (date < opening.date) return 0;
    return next === undefined ? appreciate(opening.balance, opening.date, date, annualPct) : bridge(opening, next, date);
  }

  let best: PropertyPoint | null = null;
  for (const point of points) {
    if (point.date > date) continue;
    if (best === null || point.date > best.date) best = point;
  }
  if (best === null) return 0;
  return appreciate(best.balance, best.date, date, annualPct);
}

/**
 * One point per entered value, the purchase when it is earlier, each month-end, and `today`.
 * Dates before the home was bought, or before the first valuation, are left out.
 */
export function propertySeries(
  points: PropertyPoint[],
  annualPct: number,
  today: IsoDate,
  purchase?: Purchase | null,
): { date: IsoDate; balance: Paise }[] {
  const opening = purchaseAnchor(points, purchase);
  if (points.length === 0 && opening === null) return [];
  const first = opening?.date ?? earliest(points)?.date;
  if (first === undefined || first > today) return [];

  const dates = new Set<IsoDate>();
  if (opening !== null && opening.date <= today) dates.add(opening.date);
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
    .map((date) => ({ date, balance: propertyValueAt(points, date, annualPct, purchase) }));
}
