import type { EpfRow, IsoDate, Paise } from '../parsers/types';
import { addMonths, fyStart, monthKey } from './dates';

const PPF_DEFAULT_RATE_PCT = 7.1;
const EPF_DEFAULT_RATE_PCT = 8.25;
/** The statutory PPF contribution cap: ₹1,50,000 per FY, in paise. */
const PPF_ANNUAL_CAP: Paise = 15_000_000;

export interface PpfProjectionInput {
  balance: Paise;
  asOf: IsoDate;
  openingFy: number;
  ratePct?: number;
  yearlyContribution: Paise;
  extensions?: number;
}

export interface PpfProjectionRow {
  fy: number;
  contribution: Paise;
  interest: Paise;
  closing: Paise;
}

export interface EpfProjectionInput {
  balance: Paise;
  asOf: IsoDate;
  ratePct?: number;
  monthlyContribution: Paise;
  retireDate: IsoDate;
}

export interface EpfProjectionRow {
  fy: number;
  closing: Paise;
}

/**
 * Projects PPF year by year from the FY of `asOf` through maturity at the end of FY `openingFy + 14`,
 * plus five years per extension. The contribution is made at the FY start (capped at ₹1,50,000) and
 * the interest is credited at the FY end, compounding into the next year's closing balance.
 */
export function projectPpf(input: PpfProjectionInput): PpfProjectionRow[] {
  const ratePct = input.ratePct ?? PPF_DEFAULT_RATE_PCT;
  const extensions = input.extensions ?? 0;
  const startFy = fyStart(input.asOf);
  const maturityFy = input.openingFy + 15 + 5 * extensions;
  const rows: PpfProjectionRow[] = [];
  let balance = input.balance;
  for (let fy = startFy; fy < maturityFy; fy++) {
    const contribution = Math.min(input.yearlyContribution, PPF_ANNUAL_CAP);
    const interest = Math.round(((balance + contribution) * ratePct) / 100);
    const closing = balance + contribution + interest;
    rows.push({ fy, contribution, interest, closing });
    balance = closing;
  }
  return rows;
}

/**
 * Projects EPF month by month until `retireDate`, one closing balance per FY. Each month adds the
 * contribution and accrues interest on the running balance at `ratePct / 1200`; the accrued interest
 * is credited (rounded once, with `Math.round`) at the FY end rather than compounding monthly, so
 * `closing` already includes it.
 */
export function projectEpf(input: EpfProjectionInput): EpfProjectionRow[] {
  const ratePct = input.ratePct ?? EPF_DEFAULT_RATE_PCT;
  const firstMonth: IsoDate = `${monthKey(input.asOf)}-01`;
  const lastMonth: IsoDate = `${monthKey(input.retireDate)}-01`;
  const rows: EpfProjectionRow[] = [];
  if (lastMonth < firstMonth) return rows;

  let running = input.balance;
  // Σ runningBalance × ratePct over the months; divided by 1200 once when the FY interest is credited.
  let accrued = 0;
  let fy = fyStart(firstMonth);
  for (let month = firstMonth; month <= lastMonth; month = addMonths(month, 1)) {
    const monthFy = fyStart(month);
    if (monthFy !== fy) {
      running += Math.round(accrued / 1200);
      rows.push({ fy, closing: running });
      accrued = 0;
      fy = monthFy;
    }
    running += input.monthlyContribution;
    accrued += running * ratePct;
  }
  rows.push({ fy, closing: running + Math.round(accrued / 1200) });
  return rows;
}

/**
 * The monthly EPF contribution to project with: the mean of EE + ER over the last six `contribution`
 * rows. Fewer than six rows use whatever is available; no rows means 0.
 */
export function defaultEpfMonthly(rows: EpfRow[]): Paise {
  const recent = rows.filter((row) => row.kind === 'contribution').slice(-6);
  if (recent.length === 0) return 0;
  const total = recent.reduce((sum, row) => sum + row.amounts.ee + row.amounts.er, 0);
  return Math.round(total / recent.length);
}

/**
 * The monthly saving needed for `target` from `current` by `targetDate`: the shortfall spread over the
 * whole months remaining (at least one) and rounded up to the next paise. 0 when the goal is met.
 */
export function goalMonthlyRequired(
  target: Paise,
  current: Paise,
  today: IsoDate,
  targetDate: IsoDate,
): Paise {
  const shortfall = Math.max(0, target - current);
  if (shortfall === 0) return 0;
  let months = (+targetDate.slice(0, 4) - +today.slice(0, 4)) * 12 + (+targetDate.slice(5, 7) - +today.slice(5, 7));
  if (+targetDate.slice(8, 10) < +today.slice(8, 10)) months -= 1;
  months = Math.max(1, months);
  return Math.floor((shortfall + months - 1) / months);
}
