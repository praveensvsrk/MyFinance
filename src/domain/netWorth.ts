import type { IsoDate, Paise } from '../parsers/types';
import { releasedValueInr } from './equity';

/** A dated numeric point (a price, a rate or a balance). */
export interface SeriesPoint {
  date: IsoDate;
  value: number;
}

/** A dated paise balance, as stored in `balanceSnapshots`. */
export interface BalanceSnapshot {
  date: IsoDate;
  balance: Paise;
}

/** One account's balance history. */
export interface AccountSeries {
  accountId: string;
  snapshots: BalanceSnapshot[];
}

/** An EPF account whose EE + ER total is computed on demand. */
export interface EpfTotalInput {
  accountId: string;
  at: (date: IsoDate) => Paise;
}

/** Released ACME lots and the price series that value them. */
export interface EquityNetWorthInput {
  lots: { acquiredDate: IsoDate; remainingShares: number }[];
  acme: SeriesPoint[];
  usdInr: SeriesPoint[];
}

export interface NetWorthInputs {
  banks: AccountSeries[];
  cash: AccountSeries[];
  ppf: AccountSeries[];
  epfTotals: EpfTotalInput[];
  mf: (date: IsoDate) => Paise;
  equity: EquityNetWorthInput;
  loanOutstanding: (date: IsoDate) => Paise;
}

export interface NetWorthGroups {
  liquid: Paise;
  retirement: Paise;
  market: Paise;
  liabilities: Paise;
}

export interface NetWorth {
  total: Paise;
  groups: NetWorthGroups;
}

/** The latest point whose date is on or before `date`; null when there is none. */
function latestPoint<T extends { date: IsoDate }>(series: T[], date: IsoDate): T | null {
  let best: T | null = null;
  for (const point of series) {
    if (point.date > date) continue;
    if (best === null || point.date > best.date) best = point;
  }
  return best;
}

/** The nearest point with `date` on or before the given date, or null when the series has none. */
export function priceAt(series: SeriesPoint[], date: IsoDate): SeriesPoint | null {
  return latestPoint(series, date);
}

/** The latest snapshot balance on or before `date`; 0 when the account has no such snapshot. */
function balanceAt(account: AccountSeries, date: IsoDate): Paise {
  return latestPoint(account.snapshots, date)?.balance ?? 0;
}

/**
 * Released ACME value on `date`: lots acquired on or before it, valued at the nearest ACME price
 * and USDINR rate. If either price is missing on or before `date`, the whole component is 0 —
 * a partial valuation would silently guess one of the two factors.
 */
function equityValueAt(equity: EquityNetWorthInput, date: IsoDate): Paise {
  const price = priceAt(equity.acme, date);
  const usdInr = priceAt(equity.usdInr, date);
  if (price === null || usdInr === null) return 0;
  return releasedValueInr(
    equity.lots.filter((lot) => lot.acquiredDate <= date),
    price.value,
    usdInr.value,
  );
}

/** Net worth on `date`: Liquid (banks + cash), Retirement (EPF + PPF), Market (MF + ACME), Liabilities (−loan). */
export function netWorthAt(inp: NetWorthInputs, date: IsoDate): NetWorth {
  let liquid = 0;
  for (const account of inp.banks) liquid += balanceAt(account, date);
  for (const account of inp.cash) liquid += balanceAt(account, date);

  let retirement = 0;
  for (const account of inp.ppf) retirement += balanceAt(account, date);
  for (const account of inp.epfTotals) retirement += account.at(date);

  const market = inp.mf(date) + equityValueAt(inp.equity, date);

  // The loan is stored as a positive outstanding; liabilities are its negation.
  const liabilities = -inp.loanOutstanding(date);

  return {
    total: liquid + retirement + market + liabilities,
    groups: { liquid, retirement, market, liabilities },
  };
}

/** `netWorthAt` evaluated for each date, in the given order. */
export function netWorthSeries(inp: NetWorthInputs, dates: IsoDate[]): { date: IsoDate; total: Paise }[] {
  return dates.map((date) => ({ date, total: netWorthAt(inp, date).total }));
}
