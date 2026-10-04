import type { IsoDate, Paise } from '../parsers/types';
import { cashFlowOf, type CashFlowSummary, type ExcludedFlow, type FlowLoanEntry, type FlowTxn } from './cashFlow';
import { addMonths, daysBetween, fyEndDate, monthKey } from './dates';

/** Inclusive ISO dates. */
export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface InvestTxn extends FlowTxn {
  accountId: string;
  date: IsoDate;
  description: string;
}

export interface YearLoanEntry extends FlowLoanEntry {
  principalPart?: Paise;
}

/**
 * The financial year that starts in April of `fy`, cut off at `today` when the year is still open.
 * A future year collapses to its first day so a caller never sums an empty reversed range.
 */
export function fyRange(fy: number, today: IsoDate): DateRange & { partial: boolean } {
  const from = `${fy}-04-01` as IsoDate;
  const end = fyEndDate(fy);
  if (today < from) return { from, to: from, partial: true };
  const partial = today < end;
  return { from, to: partial ? today : end, partial };
}

/** The same calendar span one year earlier, for a like-for-like comparison. */
export function previousRange(range: DateRange): DateRange {
  return { from: addMonths(range.from, -12), to: addMonths(range.to, -12) };
}

/** `YYYY-MM` keys from `range.from` through `range.to`, inclusive. */
export function monthsCovering(range: DateRange): string[] {
  if (range.to < range.from) return [];
  const months: string[] = [];
  let cursor = monthKey(range.from);
  const end = monthKey(range.to);
  while (cursor <= end) {
    months.push(cursor);
    cursor = monthKey(addMonths(`${cursor}-01`, 1));
  }
  return months;
}

function inRange(date: IsoDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/**
 * Income and spending across a range. Each month is totalled on its own so an EMI is split with
 * that month's interest, and a day past `range.to` is left out (a partial October stops on today,
 * not on the 31st).
 */
export function cashFlowBetween(
  txns: (FlowTxn & { date: IsoDate })[],
  loanEntries: FlowLoanEntry[],
  range: DateRange,
  excluded: ReadonlySet<string> = new Set(),
): CashFlowSummary {
  let income = 0;
  let spending = 0;
  const byCategory = new Map<string, Paise>();
  const setAside = new Map<string, ExcludedFlow>();
  for (const month of monthsCovering(range)) {
    const monthTxns = txns.filter((txn) => monthKey(txn.date) === month && inRange(txn.date, range));
    // A charge dated after the range (interest on the 25th, today the 4th) must not split an EMI already paid.
    const flow = cashFlowOf(
      monthTxns,
      loanEntries.filter((entry) => entry.date <= range.to),
      month,
      excluded,
    );
    income += flow.income;
    spending += flow.spending;
    for (const row of flow.categories) {
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount);
    }
    for (const row of flow.excluded) {
      const total = setAside.get(row.category) ?? { category: row.category, out: 0, in: 0 };
      total.out += row.out;
      total.in += row.in;
      setAside.set(row.category, total);
    }
  }
  const categories = [...byCategory]
    .map(([category, amount]) => ({ category, amount }))
    .sort(
      (a, b) =>
        b.amount - a.amount || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
    );
  const excludedRows = [...setAside.values()].sort((a, b) => b.out + b.in - (a.out + a.in));
  return { income, spending, categories, excluded: excludedRows };
}

/**
 * Money moved into investments during the range.
 * Bank debits tagged `investment` count, split into PPF (the narration says PPF) and everything else.
 * A credit on a PPF account counts too, unless the same amount already counted as a bank PPF debit
 * within five days — overlapping statements would otherwise record one deposit twice.
 */
export function investedBetween(
  txns: InvestTxn[],
  ppfAccountIds: ReadonlySet<string>,
  range: DateRange,
): { ppf: Paise; other: Paise } {
  const window = txns.filter((txn) => inRange(txn.date, range));
  const bankPpf: InvestTxn[] = [];
  let other = 0;
  for (const txn of window) {
    if (txn.kind !== 'investment' || txn.amount >= 0) continue;
    if (/PPF/i.test(txn.description)) bankPpf.push(txn);
    else other -= txn.amount;
  }

  const used = new Set<InvestTxn>();
  let ppf = bankPpf.reduce((total, txn) => total - txn.amount, 0);
  for (const txn of window) {
    if (!ppfAccountIds.has(txn.accountId) || txn.amount <= 0 || txn.kind === 'interest') continue;
    const match = bankPpf.find(
      (debit) =>
        !used.has(debit) &&
        -debit.amount === txn.amount &&
        Math.abs(daysBetween(debit.date, txn.date)) <= 5,
    );
    if (match !== undefined) used.add(match);
    else ppf += txn.amount;
  }
  return { ppf, other };
}

/** Employee and employer shares credited in the range. Interest, transfers and EPS are left out. */
export function epfContributed(
  entries: { kind: string; creditDate: IsoDate; ee: Paise; er: Paise }[],
  range: DateRange,
): { employee: Paise; employer: Paise } {
  let employee = 0;
  let employer = 0;
  for (const entry of entries) {
    if (entry.kind !== 'contribution' || !inRange(entry.creditDate, range)) continue;
    employee += entry.ee;
    employer += entry.er;
  }
  return { employee, employer };
}

/**
 * Interest charged and principal repaid in the range, from loan entries.
 * Same rule as the loan page: an explicit principal part wins, otherwise principal is what was
 * paid minus the interest charged.
 */
export function loanRepaid(entries: YearLoanEntry[], range: DateRange): { interest: Paise; principal: Paise } {
  const rows = entries.filter((entry) => inRange(entry.date, range));
  const interest = rows.reduce(
    (total, entry) => total + (entry.interestPart ?? (entry.kind === 'interest' ? entry.amount : 0)),
    0,
  );
  const paid = rows
    .filter((entry) => entry.kind === 'emi' || entry.kind === 'prepayment')
    .reduce((total, entry) => total + entry.amount, 0);
  const explicit = rows.reduce((total, entry) => total + (entry.principalPart ?? 0), 0);
  return { interest, principal: explicit > 0 ? explicit : Math.max(0, paid - interest) };
}
