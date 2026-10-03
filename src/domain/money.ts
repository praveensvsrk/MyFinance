/** Money is always integer paise (INR) or cents (USD). Formatting never uses floats for storage. */

const MINUS = '\u2212'; // U+2212 MINUS SIGN

/** Groups an integer digit string the Indian way: last three digits, then groups of two. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) groups.unshift(rest);
  return [...groups, last3].join(',');
}

/** Groups an integer digit string in threes (US style). */
function groupUs(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Drops trailing zeros (and a bare decimal point) from a decimal string like "12.30". */
function dropTrailingZeros(value: string): string {
  return value.replace(/\.?0+$/, '');
}

function compactAmount(absPaise: number): string {
  if (absPaise >= 1_000_000_000) {
    const hundredths = Math.round(absPaise / 10_000_000);
    return dropTrailingZeros(`${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`) + 'Cr';
  }
  if (absPaise >= 10_000_000) {
    const tenths = Math.round(absPaise / 1_000_000);
    if (tenths >= 1000) {
      const hundredths = Math.round(absPaise / 10_000_000);
      return dropTrailingZeros(`${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`) + 'Cr';
    }
    return dropTrailingZeros(`${Math.floor(tenths / 10)}.${tenths % 10}`) + 'L';
  }
  if (absPaise >= 100_000) {
    const tenths = Math.round(absPaise / 10_000);
    if (tenths >= 1000) {
      const lakhTenths = Math.round(absPaise / 1_000_000);
      return dropTrailingZeros(`${Math.floor(lakhTenths / 10)}.${lakhTenths % 10}`) + 'L';
    }
    return dropTrailingZeros(`${Math.floor(tenths / 10)}.${tenths % 10}`) + 'K';
  }
  return groupIndian(String(Math.round(absPaise / 100)));
}

/** Formats integer paise as Indian rupees. Compact drops `.00` and uses K/L/Cr above ₹1,000. */
export function formatInr(paise: number, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const n = Math.round(paise);
  const abs = Math.abs(n);
  const prefix = n < 0 ? MINUS : opts.sign && n > 0 ? '+' : '';
  if (opts.compact) return `${prefix}₹${compactAmount(abs)}`;
  const digits = String(abs).padStart(3, '0');
  return `${prefix}₹${groupIndian(digits.slice(0, -2))}.${digits.slice(-2)}`;
}

/** Formats integer cents as US dollars with two decimals, e.g. `$50,000.00`. */
export function formatUsd(cents: number): string {
  const n = Math.round(cents);
  const digits = String(Math.abs(n)).padStart(3, '0');
  return `${n < 0 ? MINUS : ''}$${groupUs(digits.slice(0, -2))}.${digits.slice(-2)}`;
}

/** Percentage change from `from` to `to`; null when `from` is zero. */
export function pctChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / from) * 100;
}
