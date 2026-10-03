import type { IsoDate, Paise } from '../../parsers/types';

/**
 * Rupees typed by a person (`1,50,000`, `₹2500.5`, `12L`-style suffixes are not accepted) → integer
 * paise. Null for empty or unparseable text; more than two decimals are rounded.
 */
export function parseRupees(text: string): Paise | null {
  const cleaned = text.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Integer paise → the plain rupee text an input shows (`150000`, `2500.5`). */
export function rupeesText(paise: Paise): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

/** `YYYY-MM-DD` that is a real calendar date, else false. */
export function isRealDate(value: string): value is IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A plain decimal typed by a person (a rate or an age); null for empty or unparseable text. */
export function parseNumber(text: string): number | null {
  const cleaned = text.trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}
