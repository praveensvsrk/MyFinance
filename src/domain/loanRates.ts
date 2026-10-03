import type { IsoDate, LoanRow, Paise } from '../parsers/types';

export interface DerivedRate {
  date: IsoDate;
  ratePct: number;
}

export interface RateStep {
  from: IsoDate;
  ratePct: number;
}

const DAY_MS = 86_400_000;

/** UTC midnight of an ISO date, in milliseconds. Never uses the local timezone. */
function utcMs(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * A credit within ±1% of the contractual EMI is an EMI payment; anything else is a prepayment.
 * The boundary check uses integer arithmetic (diff × 100 ≤ emi) so it is exact and inclusive.
 */
export function classifyLoanCredit(amount: Paise, emi: Paise): 'emi' | 'prepayment' {
  return Math.abs(amount - emi) * 100 <= emi ? 'emi' : 'prepayment';
}

/**
 * Derives the annual interest rate of each `interest` row: interest × 365 / Σ daily outstanding × 100.
 * The outstanding for a day is the closing balance: the `outstandingAfter` of the latest row dated
 * on or before that day, excluding the interest row being derived (so a prepayment dated day d
 * reduces day d, matching the plan's 16-day/15-day weighting test). Days run from interestFrom to
 * interestTo inclusive.
 */
export function deriveRates(rows: LoanRow[]): DerivedRate[] {
  const out: DerivedRate[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== 'interest' || !row.interestFrom || !row.interestTo) continue;
    const dailyTotal = sumDailyOutstanding(rows, i, row.interestFrom, row.interestTo);
    if (dailyTotal <= 0) continue;
    out.push({ date: row.date, ratePct: (row.amount * 365 * 100) / dailyTotal });
  }
  return out;
}

/** Σ outstandingAfter (daily closing balance) over each day in [from, to], as an exact integer sum. */
function sumDailyOutstanding(
  rows: LoanRow[],
  excludeIndex: number,
  from: IsoDate,
  to: IsoDate,
): number {
  const end = utcMs(to);
  let total = 0;
  for (let day = utcMs(from); day <= end; day += DAY_MS) {
    let best = -Infinity;
    let outstanding = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i === excludeIndex) continue;
      const at = utcMs(rows[i].date);
      if (at <= day && at >= best) {
        best = at;
        outstanding = rows[i].outstandingAfter;
      }
    }
    if (best !== -Infinity) total += outstanding;
  }
  return total;
}

/** Rounds a rate to the nearest 0.05 percentage points. */
export function snapRate(pct: number): number {
  return Math.round(pct * 20) / 20;
}

/**
 * Snapshots a confirmed rate history: the first reading starts it, and a step is only recorded when
 * two consecutive snapped readings agree and differ from the current rate (the first of the pair
 * provides the step's date).
 */
export function rateHistory(derived: DerivedRate[]): RateStep[] {
  const out: RateStep[] = [];
  if (derived.length === 0) return out;
  const snapped = derived.map((entry) => snapRate(entry.ratePct));
  let current = snapped[0];
  out.push({ from: derived[0].date, ratePct: current });
  for (let i = 1; i < derived.length; i++) {
    if (snapped[i] === snapped[i - 1] && snapped[i] !== current) {
      current = snapped[i];
      out.push({ from: derived[i - 1].date, ratePct: current });
    }
  }
  return out;
}

/** The snapped median of the last three derived rates, or null when there are none. */
export function planningRate(derived: DerivedRate[]): number | null {
  if (derived.length === 0) return null;
  const recent = derived
    .slice(-3)
    .map((entry) => entry.ratePct)
    .sort((a, b) => a - b);
  const mid = recent.length >> 1;
  const median =
    recent.length % 2 === 1 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;
  return snapRate(median);
}

/** True when the last two raw derived rates differ by more than 0.1 percentage points. */
export function rateChanged(derived: DerivedRate[]): boolean {
  if (derived.length < 2) return false;
  const last = derived[derived.length - 1].ratePct;
  const previous = derived[derived.length - 2].ratePct;
  return Math.abs(last - previous) > 0.1;
}
