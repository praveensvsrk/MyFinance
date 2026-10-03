import type { IsoDate } from '../parsers/types';

export { fyStartOf as fyStart } from '../parsers/normalize';

const DAY_MS = 86_400_000;

function utcMs(date: IsoDate): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
}

function fromUtcMs(ms: number): IsoDate {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** Adds `n` days using UTC arithmetic. */
export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtcMs(utcMs(d) + n * DAY_MS);
}

/** Whole days from `a` to `b` (`b - a`). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

/** Adds `n` months, clamping the day to the end of the target month. */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const year = +d.slice(0, 4);
  const month = +d.slice(5, 7) - 1;
  const day = +d.slice(8, 10);
  const total = year * 12 + month + n;
  const targetYear = Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return fromUtcMs(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}

/** `YYYY-MM` month key. */
export function monthKey(d: IsoDate): IsoDate {
  return d.slice(0, 7);
}

/** Last date of the financial year that starts in `fy`, i.e. 31 March of `fy + 1`. */
export function fyEndDate(fy: number): IsoDate {
  return `${fy + 1}-03-31`;
}

/** Today's ISO date from UTC components, never the local timezone. */
export function todayIso(now: Date = new Date()): IsoDate {
  return `${String(now.getUTCFullYear()).padStart(4, '0')}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
    now.getUTCDate(),
  ).padStart(2, '0')}`;
}
