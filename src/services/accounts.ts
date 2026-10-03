/**
 * Account list and account page queries (§6.4) for the Accounts screens.
 *
 * Every account kind is reduced to the same shape: a signed balance (a loan is negative, as in net
 * worth), an as-of date and a balance history, so one list and one chart serve them all. Kind
 * specific detail (MF schemes, vests, EPF splits, loan rates) comes from the summaries in
 * `dashboard.ts`.
 */

import type { IsoDate, Paise } from '../parsers/types';
import type { AccountKind, AccountRow, FinanceDb, TxnRow } from '../db/schema';
import { listAccounts, snapshotsFor, txnsForAccount, type TxnQueryOptions } from '../db/repos';
import { STALE_BANK_DAYS, STALE_CAS_DAYS, STALE_EPF_DAYS } from '../domain/attention';
import { daysBetween, todayIso } from '../domain/dates';
import { releasedValueInr } from '../domain/equity';
import { priceAt } from '../domain/netWorth';
import {
  buildNetWorthInputs,
  epfSummary,
  equitySummary,
  loanSummary,
  mfSummary,
  monthCountToToday,
  monthEndDates,
} from './dashboard';

export type AccountGroup = 'Banks' | 'Retirement' | 'Market' | 'Loan' | 'Cash';

export interface AccountListItem {
  id: string;
  kind: AccountKind;
  name: string;
  institution: string;
  maskedNumber: string;
  group: AccountGroup;
  /** Signed paise: a loan is negative. Null when the account has no balance yet. */
  balance: Paise | null;
  asOf: IsoDate | null;
  /** True when the account's latest statement is older than its freshness threshold. */
  stale: boolean;
}

export interface AccountDetail {
  account: AccountRow;
  history: { date: IsoDate; balance: Paise }[];
  txns: TxnRow[];
}

const MAX_HISTORY_MONTHS = 96;

const GROUP_OF: Record<AccountKind, AccountGroup> = {
  savings: 'Banks',
  ppf: 'Retirement',
  epf: 'Retirement',
  mf: 'Market',
  equity: 'Market',
  loan: 'Loan',
  cash: 'Cash',
};

const STALE_AFTER_DAYS: Partial<Record<AccountKind, number>> = {
  savings: STALE_BANK_DAYS,
  epf: STALE_EPF_DAYS,
  mf: STALE_CAS_DAYS,
};

function isStale(kind: AccountKind, asOf: IsoDate | null, today: IsoDate): boolean {
  const limit = STALE_AFTER_DAYS[kind];
  if (limit === undefined) return false;
  return asOf === null || daysBetween(asOf, today) > limit;
}

/** Balance and as-of date per account id, for every kind. */
async function balancesOf(
  db: FinanceDb,
  accounts: AccountRow[],
  today: IsoDate,
): Promise<Map<string, { balance: Paise | null; asOf: IsoDate | null }>> {
  const result = new Map<string, { balance: Paise | null; asOf: IsoDate | null }>();
  const epf = await epfSummary(db);
  const mf = accounts.some((account) => account.kind === 'mf') ? await mfSummary(db, today) : null;
  const equity = accounts.some((account) => account.kind === 'equity') ? await equitySummary(db, today) : null;
  const loan = accounts.some((account) => account.kind === 'loan') ? await loanSummary(db) : null;

  for (const account of accounts) {
    switch (account.kind) {
      case 'savings':
      case 'ppf':
      case 'cash': {
        const snapshots = (await snapshotsFor(db, account.id)).filter((snapshot) => snapshot.date <= today);
        const latest = snapshots[snapshots.length - 1];
        result.set(account.id, { balance: latest?.balance ?? null, asOf: latest?.date ?? null });
        break;
      }
      case 'epf': {
        const row = epf.accounts.find((candidate) => candidate.accountId === account.id);
        result.set(account.id, {
          balance: row === undefined || row.asOf === null ? null : row.balance.ee + row.balance.er,
          asOf: row?.asOf ?? null,
        });
        break;
      }
      case 'loan': {
        const history = (loan?.outstandingHistory ?? []).filter((point) => point.date <= today);
        const latest = history[history.length - 1];
        result.set(account.id, {
          balance: latest === undefined ? null : -latest.outstanding,
          asOf: latest?.date ?? null,
        });
        break;
      }
      case 'mf': {
        const asOf = (await db.mfFolios.toArray()).reduce<IsoDate | null>(
          (best, folio) => (best === null || folio.asOf > best ? folio.asOf : best),
          null,
        );
        result.set(account.id, { balance: asOf === null ? null : (mf?.portfolio.value ?? 0), asOf });
        break;
      }
      case 'equity': {
        const hasData = equity !== null && (equity.priceDate !== null || equity.releasedShares > 0);
        result.set(account.id, {
          balance: hasData ? equity.valueInr : null,
          asOf: equity?.priceDate ?? null,
        });
        break;
      }
    }
  }
  return result;
}

/** Every account as a list row (§6.4), in kind order then name. */
export async function accountList(db: FinanceDb, today: IsoDate = todayIso()): Promise<AccountListItem[]> {
  const accounts = await listAccounts(db);
  const balances = await balancesOf(db, accounts, today);
  const order = Object.keys(GROUP_OF);
  return accounts
    .map((account): AccountListItem => {
      const found = balances.get(account.id) ?? { balance: null, asOf: null };
      return {
        id: account.id,
        kind: account.kind,
        name: account.name,
        institution: account.institution,
        maskedNumber: account.maskedNumber,
        group: GROUP_OF[account.kind],
        balance: found.balance,
        asOf: found.asOf,
        stale: isStale(account.kind, found.asOf, today),
      };
    })
    .sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
}

/** The balance history of an account whose balance is replayed rather than snapshotted. */
async function replayedHistory(
  db: FinanceDb,
  account: AccountRow,
  today: IsoDate,
): Promise<{ date: IsoDate; balance: Paise }[]> {
  const inputs = await buildNetWorthInputs(db);
  const months = Math.min(MAX_HISTORY_MONTHS, await monthCountToToday(db, today));
  const dates = monthEndDates(months, today);
  switch (account.kind) {
    case 'mf':
      return dates.map((date) => ({ date, balance: inputs.mf(date) }));
    case 'epf': {
      const epf = inputs.epfTotals.find((candidate) => candidate.accountId === account.id);
      return dates.map((date) => ({ date, balance: epf?.at(date) ?? 0 }));
    }
    case 'equity':
      return dates.map((date) => {
        const price = priceAt(inputs.equity.acme, date);
        const usdInr = priceAt(inputs.equity.usdInr, date);
        const lots = inputs.equity.lots.filter((lot) => lot.acquiredDate <= date);
        const balance =
          price === null || usdInr === null ? 0 : releasedValueInr(lots, price.value, usdInr.value);
        return { date, balance };
      });
    default:
      return [];
  }
}

/**
 * One account's page data: balance history and, for bank and PPF accounts, transactions
 * (oldest first, optionally searched and paged).
 */
export async function accountDetail(
  db: FinanceDb,
  id: string,
  opts: TxnQueryOptions = {},
  today: IsoDate = todayIso(),
): Promise<AccountDetail | null> {
  const account = await db.accounts.get(id);
  if (account === undefined) return null;

  let history: AccountDetail['history'];
  if (account.kind === 'savings' || account.kind === 'ppf' || account.kind === 'cash') {
    history = (await snapshotsFor(db, id))
      .filter((snapshot) => snapshot.date <= today)
      .map((snapshot) => ({ date: snapshot.date, balance: snapshot.balance }));
  } else if (account.kind === 'loan') {
    history = (await loanSummary(db)).outstandingHistory
      .filter((point) => point.date <= today)
      .map((point) => ({ date: point.date, balance: -point.outstanding }));
  } else {
    history = await replayedHistory(db, account, today);
  }

  const hasTxns = account.kind === 'savings' || account.kind === 'ppf';
  return { account, history, txns: hasTxns ? await txnsForAccount(db, id, opts) : [] };
}
