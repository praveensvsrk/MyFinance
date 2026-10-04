/**
 * The components behind the Home net-worth figure, for the "How this is calculated" sheet (§6.2):
 * every account that contributes, its balance and as-of date, the prices used, and the newest
 * price date (shown beside the offline notice). Built from the same list the Accounts screen uses,
 * so the two can never disagree.
 */

import type { IsoDate, Paise } from '../parsers/types';
import type { AccountKind, FinanceDb } from '../db/schema';
import { accountList, type AccountListItem } from './accounts';
import { equitySummary, mfSummary } from './dashboard';

export interface BreakdownRow {
  id: string;
  kind: AccountKind;
  /** What the row is, e.g. `SBI ••4821`. */
  label: string;
  /** The prices and pending amounts behind a market value; absent for plain balances. */
  basis?: {
    /** Latest NAV date (mutual funds). */
    navDate?: IsoDate | null;
    /** Provisional SIP units not yet on a CAS, in paise (mutual funds). */
    provisional?: Paise;
    /** Released shares, the USD price in cents and the USDINR rate ×10⁴ (employer stock). */
    shares?: number;
    priceUsdCents?: number | null;
    usdInr?: number | null;
  };
  value: Paise;
  asOf: IsoDate | null;
  stale: boolean;
}

export interface NetWorthBreakdown {
  liquid: BreakdownRow[];
  retirement: BreakdownRow[];
  market: BreakdownRow[];
  property: BreakdownRow[];
  liabilities: BreakdownRow[];
  /** Upcoming and past vest dates, for the trend chart's markers. */
  vestDates: IsoDate[];
  /** The newest NAV or share price date; null when no price is stored. */
  pricesAsOf: IsoDate | null;
}

const GROUP_OF_KIND = {
  savings: 'liquid',
  card: 'liquid',
  cash: 'liquid',
  epf: 'retirement',
  ppf: 'retirement',
  mf: 'market',
  equity: 'market',
  property: 'property',
  loan: 'liabilities',
} as const;

function labelOf(account: AccountListItem): string {
  if (account.kind === 'mf') return 'Mutual funds';
  if (account.kind === 'equity') return account.name;
  if (account.kind === 'epf') return account.name;
  if (account.maskedNumber === '' || account.kind === 'ppf' || account.kind === 'cash') {
    return account.kind === 'ppf' ? 'PPF' : account.name;
  }
  return `${account.institution} ••${account.maskedNumber}`;
}

export async function netWorthBreakdown(db: FinanceDb, today: IsoDate): Promise<NetWorthBreakdown> {
  const accounts = await accountList(db, today);
  const hasMf = accounts.some((account) => account.kind === 'mf' && account.balance !== null);
  const hasEquity = accounts.some((account) => account.kind === 'equity' && account.balance !== null);
  const mf = hasMf ? await mfSummary(db, today) : null;
  const equity = hasEquity ? await equitySummary(db, today) : null;

  const result: NetWorthBreakdown = {
    liquid: [],
    retirement: [],
    market: [],
    property: [],
    liabilities: [],
    vestDates: (equity?.vests ?? []).map((vest) => vest.vestDate),
    pricesAsOf: null,
  };

  const navDates = (mf?.schemes ?? []).flatMap((scheme) => (scheme.navDate === null ? [] : [scheme.navDate]));
  const priceDates = [...navDates, ...(equity?.priceDate == null ? [] : [equity.priceDate])];
  result.pricesAsOf = priceDates.length === 0 ? null : priceDates.reduce((a, b) => (a > b ? a : b));

  for (const account of accounts) {
    if (account.balance === null) continue;
    let basis: BreakdownRow['basis'];
    if (account.kind === 'mf' && mf !== null) {
      basis = {
        navDate: navDates.length === 0 ? null : navDates.reduce((a, b) => (a > b ? a : b)),
        provisional: mf.provisionals
          .filter((row) => row.status !== 'confirmed')
          .reduce((total, row) => total + row.grossPaise, 0),
      };
    } else if (account.kind === 'equity' && equity !== null) {
      basis = {
        shares: equity.releasedShares,
        priceUsdCents: equity.priceUsdCents,
        usdInr: equity.usdInr,
      };
    }
    result[GROUP_OF_KIND[account.kind]].push({
      id: account.id,
      kind: account.kind,
      label: labelOf(account),
      ...(basis === undefined ? {} : { basis }),
      value: account.balance,
      asOf: account.asOf,
      stale: account.stale,
    });
  }
  return result;
}
