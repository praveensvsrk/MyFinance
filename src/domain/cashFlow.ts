import type { IsoDate, Paise } from '../parsers/types';
import { monthKey } from './dates';
import { classifyLoanCredit } from './loanRates';

export interface CashFlowCategory {
  category: string;
  amount: Paise;
}

/** Money in and out under a category the user keeps out of income and spending (e.g. Family). */
export interface ExcludedFlow {
  category: string;
  out: Paise;
  in: Paise;
}

export interface CashFlowSummary {
  income: Paise;
  spending: Paise;
  categories: CashFlowCategory[];
  excluded: ExcludedFlow[];
}

/** The fields the month's income and spending actually read. */
export interface FlowTxn {
  amount: Paise;
  category: string | null;
  kind: string;
}

/** A loan row used to split an EMI debit into interest (spending) and principal (not spending). */
export interface FlowLoanEntry {
  date: IsoDate;
  kind: string;
  amount: Paise;
  interestPart?: Paise;
}

/** This month's loan interest: explicit EMI interest parts first, else the month's interest rows. */
function monthInterestOf(entries: FlowLoanEntry[]): Paise {
  const explicit = entries.reduce((total, entry) => total + (entry.interestPart ?? 0), 0);
  if (explicit > 0) return explicit;
  return entries
    .filter((entry) => entry.kind === 'interest')
    .reduce((total, entry) => total + entry.amount, 0);
}

/**
 * Income and spending for one month. `transfer` and `investment` rows are ignored, rows in an
 * `excluded` category are set aside (reported in `excluded`), and an EMI debit is split using that
 * month's loan interest — only the interest part is spending.
 * `loanEntries` may cover other months; only `month` is used.
 */
export function cashFlowOf(
  txns: FlowTxn[],
  loanEntries: FlowLoanEntry[],
  month: string,
  excluded: ReadonlySet<string> = new Set(),
): CashFlowSummary {
  const monthEntries = loanEntries.filter((entry) => monthKey(entry.date) === month);
  let remainingInterest = monthInterestOf(monthEntries);
  let income = 0;
  let spending = 0;
  const byCategory = new Map<string, Paise>();
  const setAside = new Map<string, ExcludedFlow>();
  const addSpending = (category: string, amount: Paise): void => {
    if (amount <= 0) return;
    spending += amount;
    byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
  };

  for (const txn of txns) {
    if (txn.kind === 'transfer' || txn.kind === 'investment') continue;
    if (txn.category !== null && excluded.has(txn.category)) {
      const flow = setAside.get(txn.category) ?? { category: txn.category, out: 0, in: 0 };
      if (txn.amount > 0) flow.in += txn.amount;
      else flow.out -= txn.amount;
      setAside.set(txn.category, flow);
      continue;
    }
    if (txn.amount > 0) {
      income += txn.amount;
      continue;
    }
    const debit = -txn.amount;
    const isEmi = monthEntries.some(
      (entry) => entry.kind === 'emi' && classifyLoanCredit(debit, entry.amount) === 'emi',
    );
    if (isEmi) {
      const interest = Math.min(debit, remainingInterest);
      remainingInterest -= interest;
      addSpending(txn.category ?? 'Other', interest);
    } else {
      addSpending(txn.category ?? 'Other', debit);
    }
  }

  const categories = [...byCategory]
    .map(([category, amount]) => ({ category, amount }))
    .sort(
      (a, b) =>
        b.amount - a.amount || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
    );
  const setAsideRows = [...setAside.values()].sort((a, b) => b.out + b.in - (a.out + a.in));
  return { income, spending, categories, excluded: setAsideRows };
}
