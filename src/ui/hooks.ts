/**
 * Data hooks for the screens. Each wraps a service query in a Dexie live query, so a screen
 * re-renders by itself after an import, an undo or a manual edit, and returns `{ data, loading }`
 * (`data` is undefined until the first result). Screens never touch Dexie tables directly.
 */

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Paise } from '../parsers/types';
import type { GoalRow, ImportRow, RuleRow, TxnRow } from '../db/schema';
import { equitySymbol, getSetting, listImports, snapshotsFor, type TxnQueryOptions } from '../db/repos';
import {
  accountDetail,
  accountList,
  type AccountDetail,
  type AccountListItem,
} from '../services/accounts';
import { getPlanDefaults, type PlanDefaults } from '../services/actions/settings';
import { getCategoryConfig } from '../services/actions/categories';
import { listGoals } from '../services/actions/goals';
import { DEFAULT_CATEGORY_CONFIG, type CategoryConfig } from '../domain/categories';
import { listRules } from '../services/actions/rules';
import { fyStart } from '../domain/dates';
import {
  cashFlowMonth,
  epfSummary,
  equitySummary,
  homeSummary,
  loanSummary,
  mfSummary,
  netWorthTrend,
  type CashFlowMonth,
  type EpfSummary,
  type EquitySummary,
  type HomeSummary,
  type LoanSummary,
  type MfSummary,
  type NetWorthRange,
} from '../services/dashboard';
import { yearView, type YearView } from '../services/financialYear';
import { netWorthBreakdown, type NetWorthBreakdown } from '../services/netWorthBreakdown';
import { useApp } from './AppContext';

export interface Query<T> {
  data: T | undefined;
  loading: boolean;
}

function wrap<T>(data: T | undefined): Query<T> {
  return { data, loading: data === undefined };
}

export function useHome(): Query<HomeSummary> {
  const { db, today } = useApp();
  return wrap(useLiveQuery(() => homeSummary(db, today), [db, today]));
}

export function useTrend(range: NetWorthRange): Query<{ date: string; total: Paise }[]> {
  const { db, today } = useApp();
  return wrap(useLiveQuery(() => netWorthTrend(db, range, today), [db, today, range]));
}

export function useCashFlow(month: string): Query<CashFlowMonth> {
  const { db } = useApp();
  return wrap(useLiveQuery(() => cashFlowMonth(db, month), [db, month]));
}

/** One financial year against the same dates a year earlier. */
export function useYear(fy: number): Query<YearView> {
  const { db, today } = useApp();
  return wrap(useLiveQuery(() => yearView(db, fy, today), [db, today, fy]));
}

export function useAccounts(): Query<AccountListItem[]> {
  const { db, today } = useApp();
  return wrap(useLiveQuery(() => accountList(db, today), [db, today]));
}

/** One account's page data; `data` is null for an unknown id. */
export function useAccountDetail(id: string, opts: TxnQueryOptions = {}): Query<AccountDetail | null> {
  const { db, today } = useApp();
  const search = opts.search ?? '';
  const limit = opts.limit ?? 0;
  return wrap(
    useLiveQuery(() => accountDetail(db, id, { search, limit: limit || undefined }, today), [
      db,
      today,
      id,
      search,
      limit,
    ]),
  );
}

export function useMf(): Query<MfSummary> {
  const { db, today } = useApp();
  return wrap(useLiveQuery(() => mfSummary(db, today), [db, today]));
}

export function useLoan(): Query<LoanSummary> {
  const { db } = useApp();
  return wrap(useLiveQuery(() => loanSummary(db), [db]));
}

export function useEpf(): Query<EpfSummary> {
  const { db } = useApp();
  return wrap(useLiveQuery(() => epfSummary(db), [db]));
}

export function useEquity(): Query<EquitySummary> {
  const { db, today } = useApp();
  return wrap(useLiveQuery(() => equitySummary(db, today), [db, today]));
}

export interface PlanInputs {
  loan: LoanSummary;
  epf: EpfSummary;
  equity: EquitySummary;
  goals: GoalRow[];
  defaults: PlanDefaults;
  /** Latest balance per account id (loan negative), for goal progress. */
  balances: Record<string, Paise>;
  /** Sum of PPF account balances. */
  ppfBalance: Paise;
  /** FY (start year) of the earliest PPF statement, a stand-in for the opening year; null without PPF. */
  ppfFirstFy: number | null;
}

/** Everything the Plan screen (§6.5) starts from. */
export function usePlanInputs(): Query<PlanInputs> {
  const { db, today } = useApp();
  return wrap(
    useLiveQuery(async (): Promise<PlanInputs> => {
      const [loan, epf, equity, goals, defaults, accounts] = await Promise.all([
        loanSummary(db),
        epfSummary(db),
        equitySummary(db, today),
        listGoals(db),
        getPlanDefaults(db),
        accountList(db, today),
      ]);
      const balances: Record<string, Paise> = {};
      let ppfBalance = 0;
      let ppfFirstFy: number | null = null;
      for (const account of accounts) {
        balances[account.id] = account.balance ?? 0;
        if (account.kind !== 'ppf') continue;
        ppfBalance += account.balance ?? 0;
        const first = (await snapshotsFor(db, account.id))[0];
        if (first !== undefined) {
          const fy = fyStart(first.date);
          ppfFirstFy = ppfFirstFy === null ? fy : Math.min(ppfFirstFy, fy);
        }
      }
      return { loan, epf, equity, goals, defaults, balances, ppfBalance, ppfFirstFy };
    }, [db, today]),
  );
}

/** Import history, newest first (§6.6). */
export function useImports(): Query<ImportRow[]> {
  const { db } = useApp();
  return wrap(useLiveQuery(() => listImports(db), [db]));
}

/** The employer stock's ticker from the imported E*TRADE files; '' until one is imported. */
export function useEquitySymbol(): string {
  const { db } = useApp();
  return useLiveQuery(() => equitySymbol(db), [db]) ?? '';
}

/** One stored setting, live. `data` is the fallback until the first read. */
export function useSetting<T>(key: string, fallback: T): Query<T> {
  const { db } = useApp();
  return wrap(useLiveQuery(() => getSetting<T>(db, key, fallback), [db, key]));
}

export interface StorageStatus {
  /** True once the browser has granted persistent storage; false when unknown or denied. */
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

/** Storage persistence and usage for the Settings screen (§6.7). */
export function useStorageStatus(): Query<StorageStatus> {
  const [status, setStatus] = useState<StorageStatus | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    async function read(): Promise<void> {
      const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
      const persisted = storage?.persisted ? await storage.persisted().catch(() => false) : false;
      const estimate = storage?.estimate ? await storage.estimate().catch(() => undefined) : undefined;
      if (!cancelled) {
        setStatus({
          persisted,
          usageBytes: estimate?.usage ?? null,
          quotaBytes: estimate?.quota ?? null,
        });
      }
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, []);
  return wrap(status);
}

/** The accounts behind the Home net-worth figure (the "How this is calculated" sheet). */
export function useNetWorthBreakdown(): Query<NetWorthBreakdown> {
  const { db, today } = useApp();
  return wrap(useLiveQuery(() => netWorthBreakdown(db, today), [db, today]));
}

/** The category list and which categories are kept out of spending; defaults until loaded. */
export function useCategoryConfig(): CategoryConfig {
  const { db } = useApp();
  return useLiveQuery(() => getCategoryConfig(db), [db]) ?? DEFAULT_CATEGORY_CONFIG;
}

/** Categorisation rules, highest priority first (Settings). */
export function useRules(): Query<RuleRow[]> {
  const { db } = useApp();
  return wrap(useLiveQuery(() => listRules(db), [db]));
}

/** Every transaction, oldest first, so the rule editor can preview a rule against all of them. */
export function useAllTransactions(): Query<TxnRow[]> {
  const { db } = useApp();
  return wrap(useLiveQuery(() => db.transactions.orderBy('date').toArray(), [db]));
}
