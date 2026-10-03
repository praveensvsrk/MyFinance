import type { IsoDate, Paise } from '../parsers/types';

export type AmortMode = 'reduce-tenure' | 'reduce-emi';

export interface LumpSum {
  date: IsoDate;
  amount: Paise;
}

export interface AmortiseInput {
  outstanding: Paise;
  annualPct: number;
  emi: Paise;
  start: IsoDate;
  extraMonthly?: Paise;
  lumpSums?: LumpSum[];
  mode?: AmortMode;
  maxMonths?: number;
}

export interface AmortRow {
  date: IsoDate;
  interest: Paise;
  principal: Paise;
  prepay: Paise;
  outstanding: Paise;
}

export interface AmortResult {
  rows: AmortRow[];
  months: number;
  totalInterest: Paise;
  endDate: IsoDate;
}

export interface WhatIfResult {
  baseline: AmortResult;
  scenario: AmortResult;
  interestSaved: Paise;
  monthsSaved: number;
}

/** UTC month stepping with clamping to the end of the target month (never local time). */
function addMonthsIso(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dd = Math.min(day, lastDay);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function monthKey(d: IsoDate): string {
  return d.slice(0, 7);
}

/**
 * Standard annuity EMI, rounded up to the whole rupee.
 * The epsilon absorbs floating-point noise when the exact value is a whole number of rupees.
 */
export function standardEmi(principal: Paise, annualPct: number, months: number): Paise {
  if (months <= 0) throw new Error('months must be positive');
  const rate = annualPct / 1200;
  let exact: number;
  if (rate === 0) {
    exact = principal / months;
  } else {
    const factor = Math.pow(1 + rate, months);
    exact = (principal * rate * factor) / (factor - 1);
  }
  return Math.ceil(exact / 100 - 1e-6) * 100;
}

/** Number of months a straight (no lump sum) schedule takes, honouring extraMonthly. */
function straightMonths(input: AmortiseInput, maxMonths: number): number {
  const extraMonthly = input.extraMonthly ?? 0;
  const emi = input.emi;
  let outstanding = input.outstanding;
  let months = 0;
  while (outstanding > 0) {
    if (months >= maxMonths) throw new Error('amortisation exceeds maxMonths');
    const interest = Math.round((outstanding * input.annualPct) / 1200);
    const principal = Math.min(emi, outstanding + interest) - interest;
    let prepay = extraMonthly;
    const afterPrincipal = outstanding - principal;
    if (prepay > afterPrincipal) prepay = afterPrincipal;
    outstanding = afterPrincipal - prepay;
    months++;
  }
  return months;
}

/**
 * Month-by-month amortisation. Interest is rounded on the running outstanding; every payment is
 * capped at outstanding + interest so the schedule terminates exactly at 0 and
 * Σ principal + Σ prepay equals the starting outstanding to the paise.
 *
 * reduce-emi recomputes the EMI after each prepayment over the original remaining months (the term
 * of the same schedule run without lump sums), so the loan still ends on the original schedule.
 */
export function amortise(input: AmortiseInput): AmortResult {
  const initial = input.outstanding;
  if (initial <= 0) {
    return { rows: [], months: 0, totalInterest: 0, endDate: input.start };
  }
  const firstInterest = Math.round((initial * input.annualPct) / 1200);
  if (input.emi <= 0 || input.emi <= firstInterest) {
    throw new Error('EMI does not cover interest');
  }

  const mode = input.mode ?? 'reduce-tenure';
  const maxMonths = input.maxMonths ?? 600;
  const extraMonthly = input.extraMonthly ?? 0;
  const originalMonths = mode === 'reduce-emi' ? straightMonths(input, maxMonths) : 0;

  const lumpByMonth = new Map<string, number>();
  for (const lump of input.lumpSums ?? []) {
    if (monthKey(lump.date) < monthKey(input.start)) {
      throw new Error(`lump sum dated ${lump.date} is before the schedule start ${input.start}`);
    }
    const key = monthKey(lump.date);
    lumpByMonth.set(key, (lumpByMonth.get(key) ?? 0) + lump.amount);
  }

  let outstanding = initial;
  let emi = input.emi;
  const rows: AmortRow[] = [];
  let totalInterest = 0;

  for (let m = 0; outstanding > 0; m++) {
    if (m >= maxMonths) throw new Error('amortisation exceeds maxMonths');
    const date = addMonthsIso(input.start, m);
    const interest = Math.round((outstanding * input.annualPct) / 1200);
    const principal = Math.min(emi, outstanding + interest) - interest;
    const afterPrincipal = outstanding - principal;
    let prepay = extraMonthly + (lumpByMonth.get(monthKey(date)) ?? 0);
    if (prepay > afterPrincipal) prepay = afterPrincipal;
    outstanding = afterPrincipal - prepay;
    rows.push({ date, interest, principal, prepay, outstanding });
    totalInterest += interest;

    if (outstanding > 0 && mode === 'reduce-emi' && prepay > 0) {
      const remaining = Math.max(originalMonths - (m + 1), 1);
      emi = standardEmi(outstanding, input.annualPct, remaining);
    }
  }

  const last = rows[rows.length - 1];
  return { rows, months: rows.length, totalInterest, endDate: last.date };
}

/** Compares a baseline schedule with a scenario (typically with prepayments). */
export function whatIf(baseInput: AmortiseInput, scenarioInput: AmortiseInput): WhatIfResult {
  const baseline = amortise(baseInput);
  const scenario = amortise(scenarioInput);
  return {
    baseline,
    scenario,
    interestSaved: baseline.totalInterest - scenario.totalInterest,
    monthsSaved: baseline.months - scenario.months,
  };
}
