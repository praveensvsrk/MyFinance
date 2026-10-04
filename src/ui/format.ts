import type { IsoDate } from '../parsers/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const MASK = '••••';
const DASH = '—';

/** `12.3%`, or an em dash when there is no value. */
export function pct(n: number | null, digits = 1): string {
  return n === null || !Number.isFinite(n) ? DASH : `${n.toFixed(digits)}%`;
}

/** A change with an arrow, so a gain or loss never relies on colour alone. */
export function signedPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  const text = `${Math.abs(n).toFixed(1)}%`;
  if (Number(Math.abs(n).toFixed(1)) === 0) return text;
  return `${n > 0 ? '▲' : '▼'} ${text}`;
}

function monthName(month: string): string {
  return MONTHS[Number(month) - 1] ?? month;
}

/** `3 Oct`. */
export function dateShort(d: IsoDate): string {
  return `${Number(d.slice(8, 10))} ${monthName(d.slice(5, 7))}`;
}

/** `3 Oct 2026`. */
export function dateLong(d: IsoDate): string {
  return `${dateShort(d)} ${d.slice(0, 4)}`;
}

/** `Oct 2026` from `YYYY-MM`. */
export function monthLabel(month: string): string {
  return `${monthName(month.slice(5, 7))} ${month.slice(0, 4)}`;
}

function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Units are stored ×1000: `1234567` → `1,234.567`, trailing zeros dropped. */
export function units(milli: number): string {
  const n = Math.round(milli);
  const abs = Math.abs(n);
  const whole = groupWestern(String(Math.floor(abs / 1000)));
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${n < 0 ? '−' : ''}${whole}${frac === '' ? '' : `.${frac}`}`;
}

function fixed4(x10000: number): string {
  const abs = Math.abs(Math.round(x10000));
  const whole = groupWestern(String(Math.floor(abs / 10000)));
  return `${whole}.${String(abs % 10000).padStart(4, '0')}`;
}

/** A NAV stored ×10⁴. */
export function nav(x10000: number): string {
  return `₹${fixed4(x10000)}`;
}

/** A USD→INR rate stored ×10⁴. */
export function usdInr(x10000: number): string {
  return `₹${fixed4(x10000)}`;
}

/** Replaces a formatted amount with a mask while amounts are hidden. */
export function mask(text: string, hidden: boolean): string {
  return hidden ? MASK : text;
}

/** `FY 2026-27` from the year the financial year starts in. */
export function fyLabel(fy: number): string {
  return `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

/** `3 yr 4 mo`, `7 mo`, `2 yr`, or `0 mo`. */
export function durationText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y > 0 ? `${y} yr` : '', m > 0 ? `${m} mo` : ''].filter((part) => part !== '');
  return parts.length === 0 ? '0 mo' : parts.join(' ');
}

/** `812 KB`, `3.4 MB`: storage sizes for the Settings screen. */
export function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** A fund name without its "(formerly …)" note, which can span a line break: "X (formerly Y ) - Direct Plan" → "X - Direct Plan". */
export function fundDisplayName(name: string): string {
  return name
    .replace(/\s*\(\s*(?:erstwhile|formerly)\b[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
