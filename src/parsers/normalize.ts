import type { IsoDate } from './types';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9,
  october: 10, november: 11, december: 12,
};

export function monthNumber(name: string): number {
  const n = MONTHS[name.toLowerCase()];
  if (!n) throw new Error(`Unrecognised month: ${name}`);
  return n;
}

export function isoDate(y: number, m: number, d: number): IsoDate {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Invalid date ${y}-${m}-${d}`);
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Day-first dates: 05/04/2026, 05-04-2026, 27-Aug-2026, 24-JAN-2025, 2026-04-05, optionally followed by a time. */
export function parseDate(raw: string): IsoDate {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (m) return isoDate(2000 + +m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s]+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  throw new Error(`Unrecognised date: ${raw}`);
}

/** Month-first dates used by E*TRADE: 07/15/2026 or 01/24/23. */
export function parseUsDate(raw: string): IsoDate {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) throw new Error(`Unrecognised US date: ${raw}`);
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return isoDate(y, +m[1], +m[2]);
}

/** "Mar-2025" → "2025-03" */
export function parseMonthYear(raw: string): string {
  const m = raw.trim().match(/^([A-Za-z]{3})-(\d{4})$/);
  if (!m) throw new Error(`Unrecognised month-year: ${raw}`);
  return `${m[2]}-${String(monthNumber(m[1])).padStart(2, '0')}`;
}

/** Financial year (April–March) start year: 2026-03-31 → 2025, 2026-04-01 → 2026. */
export function fyStartOf(date: IsoDate): number {
  const y = +date.slice(0, 4);
  return +date.slice(5, 7) >= 4 ? y : y - 1;
}

/**
 * Parses a printed number into an integer scaled by 10^decimals, using string arithmetic (no float error).
 * Handles Indian/Western grouping, a "Rs."/"INR"/"$" prefix, a CR/DR or (Dr)/(Cr) suffix (DR is negative),
 * parentheses for negatives and a leading minus. Returns null for empty cells ("", "-", "—") and non-numbers.
 */
export function parseScaledOrNull(raw: string, decimals: number): number | null {
  let s = raw.trim().replace(/^(Rs\.?|INR)\s*/i, '').replace(/[$\s]/g, '');
  if (s === '' || s === '-' || s === '—' || s === "'-") return null;
  let sign = 1;
  const suffix = s.match(/(\((?:Dr|Cr)\)|CR|DR)$/i);
  if (suffix) {
    if (/dr/i.test(suffix[1])) sign = -1;
    s = s.slice(0, -suffix[1].length);
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    sign = -sign;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  }
  if (!/^\d[\d,]*(\.\d+)?$/.test(s)) return null;
  const [intPart, frac = ''] = s.replace(/,/g, '').split('.');
  let value = Number(intPart + frac.slice(0, decimals).padEnd(decimals, '0'));
  if (frac.length > decimals && Number(frac[decimals]) >= 5) value += 1;
  return value === 0 ? 0 : sign * value;
}

export function parseScaled(raw: string, decimals: number): number {
  const v = parseScaledOrNull(raw, decimals);
  if (v === null) throw new Error(`Not a number: "${raw}"`);
  return v;
}

export const parsePaise = (raw: string): number => parseScaled(raw, 2);
export const parsePaiseOrNull = (raw: string): number | null => parseScaledOrNull(raw, 2);
export const isAmount = (raw: string): boolean => parseScaledOrNull(raw, 2) !== null;
