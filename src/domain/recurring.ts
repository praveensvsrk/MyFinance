import type { IsoDate, Paise } from '../parsers/types';
import { addDays, addMonths, daysBetween } from './dates';

/** One payment out, with its payee already worked out from the narration. */
export interface Payment {
  payee: string;
  date: IsoDate;
  /** Paise paid, as a positive number. */
  amount: Paise;
  category: string | null;
}

export type Cadence = 'monthly' | 'quarterly' | 'yearly';

export interface Recurring {
  payee: string;
  category: string | null;
  /** The usual amount: the middle of the recent payments. */
  amount: Paise;
  cadence: Cadence;
  last: IsoDate;
  /** The next date it is expected on or after today. */
  next: IsoDate;
  count: number;
  /** `amount` spread over the months it covers. */
  perMonth: Paise;
}

interface Rhythm {
  cadence: Cadence;
  months: number;
  /** Days between two payments that still count as one step. */
  minDays: number;
  maxDays: number;
  /** Payments needed before it counts as recurring. */
  minCount: number;
  /** Days past the expected date before it counts as stopped. */
  grace: number;
}

const RHYTHMS: Rhythm[] = [
  { cadence: 'monthly', months: 1, minDays: 25, maxDays: 35, minCount: 3, grace: 20 },
  { cadence: 'quarterly', months: 3, minDays: 80, maxDays: 100, minCount: 3, grace: 30 },
  { cadence: 'yearly', months: 12, minDays: 350, maxDays: 380, minCount: 2, grace: 45 },
];

/** How many recent payments to judge a payee on. */
const WINDOW = 6;

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Fewer than four checks must all pass; from four on, one may be off. */
function mostly(checks: boolean[]): boolean {
  const misses = checks.filter((ok) => !ok).length;
  return misses <= (checks.length >= 4 ? 1 : 0);
}

function lastDayOf(month: string): number {
  return new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
}

/**
 * The first date `months` apart from `last` that falls on or after `today`. A payment on the last
 * day of a short month keeps the later day it was usually paid on (31 Jan, 28 Feb, then 31 Mar).
 */
function nextDate(recent: Payment[], months: number, today: IsoDate): IsoDate {
  const last = recent[recent.length - 1]!.date;
  const atMonthEnd = +last.slice(8, 10) === lastDayOf(last.slice(0, 7));
  const day = atMonthEnd ? Math.max(...recent.map((payment) => +payment.date.slice(8, 10))) : +last.slice(8, 10);
  for (let step = 1; ; step++) {
    const month = addMonths(`${last.slice(0, 7)}-01`, step * months).slice(0, 7);
    const date = `${month}-${String(Math.min(day, lastDayOf(month))).padStart(2, '0')}`;
    if (date >= today) return date;
  }
}

/**
 * Payees paid at a steady rhythm (monthly, quarterly or yearly) for a steady amount, still going
 * as of `asOf` (the newest statement date), soonest next date first. A payee paid several times a
 * month, or for amounts all over the place, is not recurring.
 */
export function findRecurring(payments: Payment[], asOf: IsoDate, today: IsoDate): Recurring[] {
  const byPayee = new Map<string, Payment[]>();
  for (const payment of payments) {
    const group = byPayee.get(payment.payee);
    if (group === undefined) byPayee.set(payment.payee, [payment]);
    else group.push(payment);
  }

  const found: Recurring[] = [];
  for (const [payee, group] of byPayee) {
    group.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const recent = group.slice(-WINDOW);
    const gaps = recent.slice(1).map((payment, i) => daysBetween(recent[i]!.date, payment.date));
    const rhythm = RHYTHMS.find(
      (r) => recent.length >= r.minCount && mostly(gaps.map((gap) => gap >= r.minDays && gap <= r.maxDays)),
    );
    if (rhythm === undefined) continue;
    const amount = median(recent.map((payment) => payment.amount));
    if (!mostly(recent.map((payment) => payment.amount >= amount * 0.5 && payment.amount <= amount * 1.5))) continue;
    const last = recent[recent.length - 1]!;
    if (addDays(addMonths(last.date, rhythm.months), rhythm.grace) < asOf) continue;
    found.push({
      payee,
      category: last.category,
      amount,
      cadence: rhythm.cadence,
      last: last.date,
      next: nextDate(recent, rhythm.months, today),
      count: group.length,
      perMonth: Math.round(amount / rhythm.months),
    });
  }
  return found.sort((a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : a.payee < b.payee ? -1 : 1));
}
