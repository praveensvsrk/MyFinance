import type { IsoDate } from '../parsers/types';
import { daysBetween } from './dates';

export interface XirrFlow {
  date: IsoDate;
  amount: number;
}

const NEWTON_TOL = 1e-9;
const NEWTON_ITERATIONS = 100;
const BISECTION_ITERATIONS = 200;
const RATE_LOW = -0.9999;
const RATE_HIGH = 10;

/**
 * Money-weighted annual return (Actual/365), as a fraction.
 * Newton's method first, then bisection over [-0.9999, 10].
 * Returns null unless there is at least one positive and one negative flow.
 */
export function xirr(flows: XirrFlow[], guess = 0.1): number | null {
  if (!flows || flows.length === 0) return null;
  let hasPositive = false;
  let hasNegative = false;
  for (const f of flows) {
    if (f.amount > 0) hasPositive = true;
    else if (f.amount < 0) hasNegative = true;
  }
  if (!hasPositive || !hasNegative) return null;

  const base = flows[0].date;
  const years = flows.map((f) => daysBetween(base, f.date) / 365);

  const npv = (rate: number): number => {
    if (rate <= -1 || !Number.isFinite(rate)) return Number.NaN;
    let sum = 0;
    for (let i = 0; i < flows.length; i++) {
      sum += flows[i].amount / Math.pow(1 + rate, years[i]);
    }
    return sum;
  };

  const derivative = (rate: number): number => {
    if (rate <= -1 || !Number.isFinite(rate)) return Number.NaN;
    let sum = 0;
    for (let i = 0; i < flows.length; i++) {
      sum += (-years[i] * flows[i].amount) / Math.pow(1 + rate, years[i] + 1);
    }
    return sum;
  };

  let rate = Number.isFinite(guess) && guess > -1 ? guess : 0.1;
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const f = npv(rate);
    if (!Number.isFinite(f)) break;
    if (Math.abs(f) < NEWTON_TOL) return rate;
    const df = derivative(rate);
    if (!Number.isFinite(df) || df === 0) break;
    const next = rate - f / df;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < NEWTON_TOL) return next;
    rate = next;
  }

  // Bisection fallback over [RATE_LOW, RATE_HIGH].
  let low = RATE_LOW;
  let high = RATE_HIGH;
  let fLow = npv(low);
  const fHigh = npv(high);
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || (fLow < 0) === (fHigh < 0)) return null;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (!Number.isFinite(fMid)) return null;
    if (fMid === 0 || high - low < 1e-12) return mid;
    if ((fMid < 0) === (fLow < 0)) {
      low = mid;
      fLow = fMid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}
