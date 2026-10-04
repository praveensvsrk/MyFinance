import type { IsoDate, Paise } from '../parsers/types';
import type { FinanceDb } from '../db/schema';
import { listAccounts, txnsBetween } from '../db/repos';
import { excludedSet } from '../domain/categories';
import type { CashFlowCategory } from '../domain/cashFlow';
import { addDays } from '../domain/dates';
import {
  cashFlowBetween,
  epfContributed,
  fyRange,
  investedBetween,
  loanRepaid,
  previousRange,
  type DateRange,
} from '../domain/financialYear';
import { netWorthAt } from '../domain/netWorth';
import { getCategoryConfig } from './actions/categories';
import { buildNetWorthInputs } from './dashboard';

export interface YearMoney {
  income: Paise;
  spending: Paise;
  categories: CashFlowCategory[];
  invested: { ppf: Paise; other: Paise };
  epf: { employee: Paise; employer: Paise };
  loan: { interest: Paise; principal: Paise };
}

export interface YearCategory {
  category: string;
  amount: Paise;
  previous: Paise;
}

export interface YearView {
  fy: number;
  from: IsoDate;
  to: IsoDate;
  partial: boolean;
  previousFrom: IsoDate;
  previousTo: IsoDate;
  current: YearMoney;
  previous: YearMoney;
  /** Categories of either year, largest this year first. `previous` is the same category last year. */
  categories: YearCategory[];
  /** Net worth the day before the year starts, and on the last day of the range. */
  netWorth: { opening: Paise; closing: Paise };
}

function mergeCategories(current: CashFlowCategory[], previous: CashFlowCategory[]): YearCategory[] {
  const prior = new Map(previous.map((row) => [row.category, row.amount]));
  const seen = new Set<string>();
  const rows: YearCategory[] = current.map((row) => {
    seen.add(row.category);
    return { category: row.category, amount: row.amount, previous: prior.get(row.category) ?? 0 };
  });
  for (const row of previous) {
    if (seen.has(row.category)) continue;
    rows.push({ category: row.category, amount: 0, previous: row.amount });
  }
  return rows;
}

async function moneyFor(db: FinanceDb, range: DateRange): Promise<YearMoney> {
  const [txns, loanEntries, accounts, epfEntries] = await Promise.all([
    txnsBetween(db, range.from, range.to),
    db.loanEntries.toArray(),
    listAccounts(db),
    db.epfEntries.toArray(),
  ]);
  const flow = cashFlowBetween(txns, loanEntries, range, excludedSet(await getCategoryConfig(db)));
  const ppfIds = new Set(accounts.filter((account) => account.kind === 'ppf').map((account) => account.id));
  return {
    income: flow.income,
    spending: flow.spending,
    categories: flow.categories,
    invested: investedBetween(txns, ppfIds, range),
    epf: epfContributed(epfEntries, range),
    loan: loanRepaid(loanEntries, range),
  };
}

/** One financial year against the same dates a year earlier, plus the net-worth change across it. */
export async function yearView(db: FinanceDb, fy: number, today: IsoDate): Promise<YearView> {
  const range = fyRange(fy, today);
  const prior = previousRange(range);
  const [current, previous, inputs] = await Promise.all([
    moneyFor(db, range),
    moneyFor(db, prior),
    buildNetWorthInputs(db),
  ]);
  return {
    fy,
    from: range.from,
    to: range.to,
    partial: range.partial,
    previousFrom: prior.from,
    previousTo: prior.to,
    current,
    previous,
    categories: mergeCategories(current.categories, previous.categories),
    netWorth: {
      opening: netWorthAt(inputs, addDays(range.from, -1)).total,
      closing: netWorthAt(inputs, range.to).total,
    },
  };
}
