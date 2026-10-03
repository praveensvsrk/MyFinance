/**
 * Dashboard and account queries (§6.2–§6.4): the read model the UI consumes.
 *
 * Every figure is derived from the stored rows through the pure domain modules; nothing here
 * re-implements a calculation. Money is integer paise, dates are ISO `YYYY-MM-DD`.
 */

import type { CasTxn, IsoDate, LoanRow, Paise, VestRec } from '../parsers/types';
import type {
  AccountKind,
  EquityLotRow,
  FinanceDb,
  LoanEntryRow,
  LoanYearRow,
  MfFolioRow,
  MfProvisionalRow,
  TxnRow,
  VestRow,
} from '../db/schema';
import {
  getSetting,
  latestSnapshot,
  listAccounts,
  pricesFor,
  snapshotsFor,
  txnsForMonth,
} from '../db/repos';
import {
  needsAttention,
  type Attention,
  type AttentionState,
  type StatementKind,
} from '../domain/attention';
import { addDays, addMonths, daysBetween, fyEndDate, fyStart, monthKey, todayIso } from '../domain/dates';
import { epfBalanceAt, type EpfBalance } from '../domain/epf';
import { lotGainInr, releasedValueInr, unvestedShares, upcomingVest } from '../domain/equity';
import {
  classifyLoanCredit,
  deriveRates,
  planningRate as planningRateOf,
  rateHistory as rateHistoryOf,
  type RateStep,
} from '../domain/loanRates';
import { investedCost, schemeCashflows, schemeValue, unitsAt } from '../domain/mf';
import { mfValueAt } from '../domain/mfProvisional';
import { pctChange } from '../domain/money';
import {
  netWorthAt,
  netWorthSeries,
  priceAt,
  type NetWorthGroups,
  type NetWorthInputs,
  type SeriesPoint,
} from '../domain/netWorth';
import { xirr } from '../domain/xirr';

// ---------- shapes ----------

export type NetWorthRange = '12M' | '3Y' | 'All';

export interface CashFlowCategory {
  category: string;
  amount: Paise;
}

export interface CashFlowSummary {
  income: Paise;
  spending: Paise;
  categories: CashFlowCategory[];
}

export interface CashFlowMonth extends CashFlowSummary {
  month: string;
  transactions: TxnRow[];
}

export interface HomeSummary {
  netWorth: Paise;
  groups: NetWorthGroups;
  change: { amount: Paise; pct: number | null };
  asOf: IsoDate;
  unvestedInr: Paise;
  attention: Attention[];
  thisMonth: {
    income: Paise;
    spending: Paise;
    savingsRatePct: number | null;
    topCategories: CashFlowCategory[];
  };
  upcoming: {
    vest?: { date: IsoDate; shares: number; value: Paise };
    emiDate?: IsoDate;
    ppfReminder?: { dueDate: IsoDate; message: string };
  };
}

export interface MfSchemeSummary {
  folioId: string;
  scheme: string;
  isin: string;
  amfiCode: number | null;
  /** Units ×1000 on `today`. */
  units: number;
  invested: Paise;
  value: Paise;
  gain: Paise;
  nav: number | null;
  navDate: IsoDate | null;
  xirr: number | null;
}

export interface MfSummary {
  schemes: MfSchemeSummary[];
  portfolio: { invested: Paise; value: Paise; gain: Paise; xirr: number | null };
  provisionals: MfProvisionalRow[];
}

export interface LoanYearSummary {
  fy: number;
  interest: Paise;
  principal: Paise;
  source: 'entries' | 'certificate';
}

export interface LoanSummary {
  /** Outstanding (positive) at each known date, oldest first. */
  outstandingHistory: { date: IsoDate; outstanding: Paise }[];
  years: LoanYearSummary[];
  rateHistory: RateStep[];
  planningRate: number | null;
  sanctioned: Paise | null;
  emi: Paise | null;
  disbursed: Paise;
  undisbursed: Paise;
  prepayments: { id: string; date: IsoDate; amount: Paise; description: string }[];
}

export interface EpfAccountSummary {
  accountId: string;
  name: string;
  asOf: IsoDate | null;
  balance: EpfBalance;
  contributions: { date: IsoDate; ee: Paise; er: Paise; eps: Paise }[];
}

export interface EpfSummary {
  accounts: EpfAccountSummary[];
  totals: EpfBalance;
}

export interface EquityLotSummary {
  id: string;
  acquiredDate: IsoDate;
  remainingShares: number;
  source: EquityLotRow['source'];
  gainInr: Paise | null;
}

export interface EquityVestSummary {
  id: string;
  vestDate: IsoDate;
  shares: number;
  status: VestRow['status'];
  valueInr: Paise | null;
}

export interface EquitySummary {
  releasedShares: number;
  valueInr: Paise;
  unvestedShares: number;
  unvestedValueInr: Paise;
  priceUsdCents: number | null;
  priceDate: IsoDate | null;
  usdInr: number | null;
  usdInrDate: IsoDate | null;
  upcoming: { date: IsoDate; shares: number; valueInr: Paise } | null;
  lots: EquityLotSummary[];
  vests: EquityVestSummary[];
  /** ESPP lots from the Benefit History; the workbook has no separate purchase rows. */
  esppLots: EquityLotRow[];
}

// ---------- small helpers ----------

/** A symbol's stored price series, oldest first, as domain series points. */
async function priceSeries(db: FinanceDb, symbol: string): Promise<SeriesPoint[]> {
  return (await pricesFor(db, symbol)).map((price) => ({ date: price.date, value: price.value }));
}

/** The stored NAV symbol for a folio: its AMFI code once resolved, otherwise its ISIN (or id). */
function mfSymbolFor(folio: MfFolioRow): string {
  if (typeof folio.amfiCode === 'number' && Number.isFinite(folio.amfiCode)) return `MF:${folio.amfiCode}`;
  return `MF:${folio.isin === '' ? folio.id : folio.isin}`;
}

function sortByDate<T extends { date: IsoDate }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The latest point on or before `date`, or null. */
function latestOnOrBefore<T extends { date: IsoDate }>(points: T[], date: IsoDate): T | null {
  let best: T | null = null;
  for (const point of points) {
    if (point.date <= date && (best === null || point.date > best.date)) best = point;
  }
  return best;
}

/** Stored vest row → the parser shape the equity domain helpers consume. */
function asVestRec(row: VestRow): VestRec {
  return {
    grantNumber: row.grantNumber ?? '',
    period: row.period,
    vestDate: row.vestDate,
    shares: row.shares,
    cancelledShares: row.cancelledShares ?? 0,
    vestedShares: row.vestedShares ?? 0,
    releasedShares: row.releasedShares ?? 0,
    sellableShares: row.sellableShares ?? 0,
    sharesWithheld: row.sharesWithheld ?? 0,
    fmvUsdCents: row.fmvUsdCents ?? null,
    taxableGainUsdCents: row.taxableGainUsdCents ?? null,
    taxRatePct: row.taxRatePct ?? null,
    status: row.status,
  };
}

/** INR value of `shares` at a USD price (cents) and a USDINR rate (×10⁴); 0 when a price is missing. */
function shareValue(
  shares: number,
  priceUsdCents: number | undefined,
  usdInr: number | undefined,
): Paise {
  if (priceUsdCents === undefined || usdInr === undefined) return 0;
  return releasedValueInr([{ remainingShares: shares }], priceUsdCents, usdInr);
}

/** Outstanding points for the loan fallback: entries and certificate 31-Mar closings, by date. */
interface OutstandingPoint {
  date: IsoDate;
  outstanding: Paise;
}

/**
 * Linear interpolation across the fallback points, clamped at both ends. Used only when the loan
 * has no snapshot on or before the queried date (a statement or certificate snapshot wins).
 */
function interpolateOutstanding(points: OutstandingPoint[], date: IsoDate): Paise {
  if (points.length === 0) return 0;
  const sorted = sortByDate(points);
  if (date <= sorted[0].date) return sorted[0].outstanding;
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const next = sorted[i];
    if (date > next.date) continue;
    const span = daysBetween(previous.date, next.date);
    if (span <= 0) return next.outstanding;
    const offset = daysBetween(previous.date, date);
    return Math.round(
      previous.outstanding + ((next.outstanding - previous.outstanding) * offset) / span,
    );
  }
  return sorted[sorted.length - 1].outstanding;
}

// ---------- net-worth inputs ----------

/**
 * Assembles `NetWorthInputs` from the db:
 * - banks/cash/PPF from their snapshots;
 * - EPF from the stored entries replayed by `epfBalanceAt`;
 * - MF from the stored units replayed against each folio's `MF:*` NAV series, plus the
 *   non-confirmed provisionals valued by `mfValueAt`;
 * - equity from the stored lots and the ACME / USDINR price series;
 * - loans from their snapshots, falling back per date to loan-entry outstanding with certificate
 *   31-Mar points interpolated linearly (§5.11).
 */
export async function buildNetWorthInputs(db: FinanceDb): Promise<NetWorthInputs> {
  const accounts = await listAccounts(db);

  const snapshotSeries = async (kind: AccountKind): Promise<NetWorthInputs['banks']> => {
    const series: NetWorthInputs['banks'] = [];
    for (const account of accounts.filter((row) => row.kind === kind)) {
      const snapshots = await snapshotsFor(db, account.id);
      series.push({
        accountId: account.id,
        snapshots: snapshots.map((snapshot) => ({ date: snapshot.date, balance: snapshot.balance })),
      });
    }
    return series;
  };

  const banks = await snapshotSeries('savings');
  const cash = await snapshotSeries('cash');
  const ppf = await snapshotSeries('ppf');

  const epfTotals: NetWorthInputs['epfTotals'] = [];
  for (const account of accounts.filter((row) => row.kind === 'epf')) {
    const entries = await db.epfEntries.where('accountId').equals(account.id).toArray();
    epfTotals.push({ accountId: account.id, at: (date) => epfBalanceAt(entries, date).total });
  }

  const folios = await db.mfFolios.toArray();
  const mfTxns = await db.mfTxns.toArray();
  const provisionals = await db.mfProvisional.toArray();
  const navSeriesByFolio = new Map<string, SeriesPoint[]>();
  for (const folio of folios) {
    navSeriesByFolio.set(folio.id, await priceSeries(db, mfSymbolFor(folio)));
  }
  const mf = (date: IsoDate): Paise => {
    const unitsByScheme: Record<string, number> = {};
    const navByScheme: Record<string, number> = {};
    for (const folio of folios) {
      const rows = mfTxns.filter((txn) => txn.folioId === folio.id);
      unitsByScheme[folio.id] = unitsAt(rows, date);
      const nav = priceAt(navSeriesByFolio.get(folio.id) ?? [], date);
      if (nav !== null) navByScheme[folio.id] = nav.value;
    }
    const due = provisionals.filter((provisional) => provisional.date <= date);
    return mfValueAt(unitsByScheme, navByScheme, due).value;
  };

  const lots = await db.equityLots.toArray();
  const equity: NetWorthInputs['equity'] = {
    lots: lots.map((lot) => ({ acquiredDate: lot.acquiredDate, remainingShares: lot.remainingShares })),
    acme: await priceSeries(db, 'ACME'),
    usdInr: await priceSeries(db, 'USDINR'),
  };

  const loanSnapshots: OutstandingPoint[] = [];
  const fallbackByDate = new Map<IsoDate, Paise>();
  for (const account of accounts.filter((row) => row.kind === 'loan')) {
    // Loan snapshots store the outstanding as a negative balance (see the loan mapper).
    for (const snapshot of await snapshotsFor(db, account.id)) {
      loanSnapshots.push({ date: snapshot.date, outstanding: -snapshot.balance });
    }
    for (const year of (await db.loanYears.toArray()).filter((row) => row.accountId === account.id)) {
      fallbackByDate.set(fyEndDate(year.fy), year.closingOutstanding);
    }
    for (const entry of await db.loanEntries.where('accountId').equals(account.id).toArray()) {
      // Entries are more precise than a certificate's year-end point on the same date.
      fallbackByDate.set(entry.date, entry.outstandingAfter);
    }
  }
  const fallbackPoints = sortByDate(
    [...fallbackByDate].map(([date, outstanding]) => ({ date, outstanding })),
  );
  const loanOutstanding = (date: IsoDate): Paise => {
    const snapshot = latestOnOrBefore(loanSnapshots, date);
    return snapshot !== null ? snapshot.outstanding : interpolateOutstanding(fallbackPoints, date);
  };

  return { banks, cash, ppf, epfTotals, mf, equity, loanOutstanding };
}

// ---------- cash flow ----------

/** This month's loan interest: explicit EMI interest parts first, else the month's interest rows. */
function monthInterestOf(entries: LoanEntryRow[]): Paise {
  const explicit = entries.reduce((total, entry) => total + (entry.interestPart ?? 0), 0);
  if (explicit > 0) return explicit;
  return entries
    .filter((entry) => entry.kind === 'interest')
    .reduce((total, entry) => total + entry.amount, 0);
}

/**
 * Income/spending for a month: `transfer` and `investment` rows are ignored, and an EMI debit is
 * split using that month's loan interest — only the interest part is spending.
 */
function cashFlowOf(txns: TxnRow[], loanEntries: LoanEntryRow[], month: string): CashFlowSummary {
  const monthEntries = loanEntries.filter((entry) => monthKey(entry.date) === month);
  let remainingInterest = monthInterestOf(monthEntries);
  let income = 0;
  let spending = 0;
  const byCategory = new Map<string, Paise>();
  const addSpending = (category: string, amount: Paise): void => {
    if (amount <= 0) return;
    spending += amount;
    byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
  };

  for (const txn of txns) {
    if (txn.kind === 'transfer' || txn.kind === 'investment') continue;
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
        b.amount - a.amount ||
        (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
    );
  return { income, spending, categories };
}

/** A `YYYY-MM` month's income, spending, sorted category breakdown and transactions. */
export async function cashFlowMonth(db: FinanceDb, month: string): Promise<CashFlowMonth> {
  const transactions = await txnsForMonth(db, month);
  const loanEntries = await db.loanEntries.toArray();
  const flow = cashFlowOf(transactions, loanEntries, month);
  return { month, income: flow.income, spending: flow.spending, categories: flow.categories, transactions };
}

// ---------- needs attention ----------

function statementKindOf(kind: AccountKind): StatementKind {
  return kind === 'savings' ? 'bank' : kind;
}

/** Storage persistence check; when the browser exposes no `navigator.storage`, assume persisted. */
async function isStoragePersisted(): Promise<boolean> {
  try {
    const navigatorRef: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
    const storage: StorageManager | undefined = navigatorRef?.storage;
    if (storage === undefined || typeof storage.persisted !== 'function') return true;
    return await storage.persisted();
  } catch {
    return true;
  }
}

/** The §6.2 attention state: statement freshness, CAS/backup age, failures and stale provisionals. */
async function attentionStateOf(db: FinanceDb, today: IsoDate): Promise<AttentionState> {
  const freshness: AttentionState['lastStatementByAccount'] = [];
  for (const account of await listAccounts(db)) {
    const snapshot = await latestSnapshot(db, account.id, today);
    if (snapshot === null) continue;
    freshness.push({
      accountId: account.id,
      kind: statementKindOf(account.kind),
      name: account.name,
      date: snapshot.date,
    });
  }

  const folios = await db.mfFolios.toArray();
  const lastCasDate = folios.reduce<IsoDate | null>(
    (latest, folio) => (latest === null || folio.asOf > latest ? folio.asOf : latest),
    null,
  );
  const etradeMismatch = await getSetting<AttentionState['etradeMismatch']>(
    db,
    'etradeMismatch',
    undefined,
  );

  return {
    today,
    lastStatementByAccount: freshness,
    lastCasDate,
    lastBackupAt: await getSetting<IsoDate | null>(db, 'lastBackupAt', null),
    priceFailures: await getSetting<string[]>(db, 'priceFailures', []),
    unverifiedImports: (await db.imports.toArray())
      .filter((row) => !row.verified)
      .map((row) => ({ id: row.id, source: row.source })),
    staleProvisionals: await db.mfProvisional.where('status').equals('stale').count(),
    storagePersisted: await isStoragePersisted(),
    ...(etradeMismatch === undefined ? {} : { etradeMismatch }),
  };
}

/** The newest date of any balance snapshot or price point on or before `today`, else `today`. */
async function latestDataDate(db: FinanceDb, today: IsoDate): Promise<IsoDate> {
  let latest: IsoDate | null = null;
  const consider = (date: IsoDate): void => {
    if (date <= today && (latest === null || date > latest)) latest = date;
  };
  for (const snapshot of await db.balanceSnapshots.toArray()) consider(snapshot.date);
  for (const price of await db.prices.toArray()) consider(price.date);
  return latest ?? today;
}

// ---------- home ----------

/** The next expected EMI date: a month after the last recorded EMI, advanced past today. */
async function nextEmiDate(db: FinanceDb, today: IsoDate): Promise<IsoDate | undefined> {
  const emis = (await db.loanEntries.toArray()).filter(
    (entry) => entry.kind === 'emi' && entry.date <= today,
  );
  if (emis.length === 0) return undefined;
  const last = emis.reduce((a, b) => (a.date > b.date ? a : b));
  let next = addMonths(last.date, 1);
  while (next <= today) next = addMonths(next, 1);
  return next;
}

/** The next monthly PPF deposit date (the 5th), when a PPF account exists. */
async function ppfReminderFor(
  db: FinanceDb,
  today: IsoDate,
): Promise<HomeSummary['upcoming']['ppfReminder'] | undefined> {
  const accounts = (await listAccounts(db)).filter((account) => account.kind === 'ppf');
  if (accounts.length === 0) return undefined;
  const fifth = `${monthKey(today)}-05`;
  const dueDate = today <= fifth ? fifth : `${monthKey(addMonths(`${monthKey(today)}-01`, 1))}-05`;
  return {
    dueDate,
    message:
      'Deposit by the 5th to earn this month’s interest; top up to the ₹1.5 lakh annual cap by 31 Mar',
  };
}

/** Everything the Home screen shows (§6.2): net worth, change, cash flow, attention, upcoming. */
export async function homeSummary(db: FinanceDb, today: IsoDate): Promise<HomeSummary> {
  const inputs = await buildNetWorthInputs(db);
  const now = netWorthAt(inputs, today);
  const previous = netWorthAt(inputs, addMonths(today, -1));

  const flow = cashFlowOf(
    await txnsForMonth(db, monthKey(today)),
    await db.loanEntries.toArray(),
    monthKey(today),
  );

  const vests = (await db.vests.toArray()).map(asVestRec);
  const acme = priceAt(inputs.equity.acme, today);
  const usdInr = priceAt(inputs.equity.usdInr, today);
  const nextVest = upcomingVest(vests, today);

  const upcoming: HomeSummary['upcoming'] = {};
  if (nextVest !== null) {
    upcoming.vest = {
      date: nextVest.date,
      shares: nextVest.shares,
      value: shareValue(nextVest.shares, acme?.value, usdInr?.value),
    };
  }
  const emiDate = await nextEmiDate(db, today);
  if (emiDate !== undefined) upcoming.emiDate = emiDate;
  const ppfReminder = await ppfReminderFor(db, today);
  if (ppfReminder !== undefined) upcoming.ppfReminder = ppfReminder;

  return {
    netWorth: now.total,
    groups: now.groups,
    change: { amount: now.total - previous.total, pct: pctChange(previous.total, now.total) },
    asOf: await latestDataDate(db, today),
    unvestedInr: shareValue(unvestedShares(vests, today), acme?.value, usdInr?.value),
    attention: needsAttention(await attentionStateOf(db, today)),
    thisMonth: {
      income: flow.income,
      spending: flow.spending,
      savingsRatePct:
        flow.income > 0 ? ((flow.income - flow.spending) / flow.income) * 100 : null,
      topCategories: flow.categories.slice(0, 3),
    },
    upcoming,
  };
}

// ---------- trend ----------

/** The last `count` month ends through `today` (the current month stops at today). */
export function monthEndDates(count: number, today: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const firstOfMonth = `${monthKey(addMonths(today, -i))}-01`;
    const end = addDays(addMonths(firstOfMonth, 1), -1);
    dates.push(end > today ? today : end);
  }
  return dates;
}

/** Months from the earliest stored data point's month to `today`'s month, inclusive. */
export async function monthCountToToday(db: FinanceDb, today: IsoDate): Promise<number> {
  let earliest: IsoDate | null = null;
  for (const snapshot of await db.balanceSnapshots.toArray()) {
    if (earliest === null || snapshot.date < earliest) earliest = snapshot.date;
  }
  for (const price of await db.prices.toArray()) {
    if (earliest === null || price.date < earliest) earliest = price.date;
  }
  if (earliest === null) return 1;
  const months =
    (Number(today.slice(0, 4)) - Number(earliest.slice(0, 4))) * 12 +
    (Number(today.slice(5, 7)) - Number(earliest.slice(5, 7))) +
    1;
  return Math.max(1, months);
}

/** Month-end net-worth points for the given range (§6.2 trend). */
export async function netWorthTrend(
  db: FinanceDb,
  range: NetWorthRange,
  today: IsoDate = todayIso(),
): Promise<{ date: IsoDate; total: Paise }[]> {
  const inputs = await buildNetWorthInputs(db);
  const count = range === '12M' ? 12 : range === '3Y' ? 36 : await monthCountToToday(db, today);
  return netWorthSeries(inputs, monthEndDates(count, today));
}

// ---------- mutual funds ----------

/** Per-scheme units, cost, value, gain and XIRR, plus the portfolio XIRR (§6.4). */
export async function mfSummary(db: FinanceDb, today: IsoDate): Promise<MfSummary> {
  const folios = await db.mfFolios.toArray();
  const txns = await db.mfTxns.toArray();
  const schemes: MfSchemeSummary[] = [];
  const portfolioFlows: { date: IsoDate; amount: Paise }[] = [];
  let portfolioInvested = 0;
  let portfolioValue = 0;

  for (const folio of folios) {
    const rows = txns.filter((txn) => txn.folioId === folio.id);
    const units = unitsAt(rows, today);
    const invested = investedCost(rows);
    const nav = priceAt(await priceSeries(db, mfSymbolFor(folio)), today);
    const value = nav === null ? 0 : schemeValue(units, nav.value);
    // `schemeCashflows` reads only `date`, `amount` and `stampDuty`; a stored row carries all three.
    const flows = schemeCashflows(rows as unknown as CasTxn[], today, value);

    schemes.push({
      folioId: folio.id,
      scheme: folio.scheme,
      isin: folio.isin,
      amfiCode: folio.amfiCode ?? null,
      units,
      invested,
      value,
      gain: value - invested,
      nav: nav?.value ?? null,
      navDate: nav?.date ?? null,
      xirr: xirr(flows),
    });
    portfolioFlows.push(...flows);
    portfolioInvested += invested;
    portfolioValue += value;
  }

  return {
    schemes,
    portfolio: {
      invested: portfolioInvested,
      value: portfolioValue,
      gain: portfolioValue - portfolioInvested,
      xirr: xirr(portfolioFlows),
    },
    provisionals: await db.mfProvisional.toArray(),
  };
}

// ---------- loans ----------

/** Stored loan entry → the parser row shape `deriveRates` consumes (only interest rows matter). */
function toLoanRow(entry: LoanEntryRow): LoanRow {
  return {
    date: entry.date,
    description: entry.description,
    ref: entry.ref,
    kind: entry.kind === 'interest' ? 'interest' : 'repayment',
    amount: entry.amount,
    outstandingAfter: entry.outstandingAfter,
    printedOutstanding: entry.outstandingAfter,
    ...(entry.interestFrom === undefined ? {} : { interestFrom: entry.interestFrom }),
    ...(entry.interestTo === undefined ? {} : { interestTo: entry.interestTo }),
  };
}

/**
 * Loan account page data (§6.4): outstanding history, per-FY interest/principal (from entries,
 * else the certificate's `loanYears`), derived rate history and planning rate, the undisbursed
 * sanction and the prepayments.
 */
export async function loanSummary(db: FinanceDb): Promise<LoanSummary> {
  const accounts = (await listAccounts(db)).filter((account) => account.kind === 'loan');
  const entries: LoanEntryRow[] = [];
  const snapshots: OutstandingPoint[] = [];
  const yearRows: LoanYearRow[] = [];
  let sanctioned: Paise | null = null;
  let emi: Paise | null = null;

  for (const account of accounts) {
    entries.push(...(await db.loanEntries.where('accountId').equals(account.id).toArray()));
    for (const snapshot of await snapshotsFor(db, account.id)) {
      snapshots.push({ date: snapshot.date, outstanding: -snapshot.balance });
    }
    yearRows.push(...(await db.loanYears.toArray()).filter((row) => row.accountId === account.id));
    if (typeof account.meta.sanctioned === 'number') sanctioned = (sanctioned ?? 0) + account.meta.sanctioned;
    if (typeof account.meta.bankEmi === 'number') emi = account.meta.bankEmi;
  }

  // Entries are the recomputed truth; a snapshot only fills a date no entry covers.
  const byDate = new Map<IsoDate, Paise>();
  for (const snapshot of snapshots) byDate.set(snapshot.date, snapshot.outstanding);
  for (const entry of entries) byDate.set(entry.date, entry.outstandingAfter);
  const outstandingHistory = sortByDate(
    [...byDate].map(([date, outstanding]) => ({ date, outstanding })),
  );

  const fys = new Set<number>([
    ...entries.map((entry) => fyStart(entry.date)),
    ...yearRows.map((row) => row.fy),
  ]);
  const years: LoanYearSummary[] = [];
  for (const fy of [...fys].sort((a, b) => a - b)) {
    const fyEntries = entries.filter((entry) => fyStart(entry.date) === fy);
    if (fyEntries.length > 0) {
      const interest = fyEntries.reduce(
        (total, entry) => total + (entry.interestPart ?? (entry.kind === 'interest' ? entry.amount : 0)),
        0,
      );
      const paid = fyEntries
        .filter((entry) => entry.kind === 'emi' || entry.kind === 'prepayment')
        .reduce((total, entry) => total + entry.amount, 0);
      const explicitPrincipal = fyEntries.reduce((total, entry) => total + (entry.principalPart ?? 0), 0);
      years.push({
        fy,
        interest,
        principal: explicitPrincipal > 0 ? explicitPrincipal : Math.max(0, paid - interest),
        source: 'entries',
      });
      continue;
    }
    const certificate = yearRows.find((row) => row.fy === fy);
    if (certificate !== undefined) {
      years.push({
        fy,
        interest: certificate.interestCharged,
        principal: certificate.principalRepaid,
        source: 'certificate',
      });
    }
  }

  const derived = deriveRates(entries.map(toLoanRow));
  const disbursed = entries
    .filter((entry) => entry.kind === 'disbursement')
    .reduce((total, entry) => total + entry.amount, 0);
  const prepayments = entries
    .filter((entry) => entry.kind === 'prepayment')
    .map((entry) => ({ id: entry.id, date: entry.date, amount: entry.amount, description: entry.description }));

  return {
    outstandingHistory,
    years,
    rateHistory: rateHistoryOf(derived),
    planningRate: planningRateOf(derived),
    sanctioned,
    emi,
    disbursed,
    undisbursed: sanctioned === null ? 0 : Math.max(0, sanctioned - disbursed),
    prepayments: sortByDate(prepayments),
  };
}

// ---------- EPF ----------

/** EPF page data (§6.4): per-account as-of balance and contribution history, EE/ER/EPS split. */
export async function epfSummary(db: FinanceDb): Promise<EpfSummary> {
  const accounts: EpfAccountSummary[] = [];
  const totals: EpfBalance = { ee: 0, er: 0, eps: 0, total: 0 };

  for (const account of (await listAccounts(db)).filter((row) => row.kind === 'epf')) {
    const entries = (await db.epfEntries.where('accountId').equals(account.id).toArray()).sort(
      (a, b) => (a.creditDate < b.creditDate ? -1 : a.creditDate > b.creditDate ? 1 : 0),
    );
    const asOf = entries.reduce<IsoDate | null>(
      (latest, entry) => (latest === null || entry.creditDate > latest ? entry.creditDate : latest),
      null,
    );
    const balance = asOf === null ? { ee: 0, er: 0, eps: 0, total: 0 } : epfBalanceAt(entries, asOf);
    accounts.push({
      accountId: account.id,
      name: account.name,
      asOf,
      balance,
      contributions: entries
        .filter((entry) => entry.kind === 'contribution')
        .map((entry) => ({ date: entry.creditDate, ee: entry.ee, er: entry.er, eps: entry.eps })),
    });
    totals.ee += balance.ee;
    totals.er += balance.er;
    totals.eps += balance.eps;
    totals.total += balance.total;
  }

  return { accounts, totals };
}

// ---------- equity ----------

/** ACME page data (§6.4): released shares and value, vest timeline in shares and ₹, ESPP lots. */
export async function equitySummary(db: FinanceDb, today: IsoDate): Promise<EquitySummary> {
  const lots = await db.equityLots.toArray();
  const price = priceAt(await priceSeries(db, 'ACME'), today);
  const usdInr = priceAt(await priceSeries(db, 'USDINR'), today);
  const canValue = price !== null && usdInr !== null;

  const vestRows = await db.vests.toArray();
  const vests = vestRows.map(asVestRec);
  const nextVest = upcomingVest(vests, today);

  return {
    releasedShares: Math.round(lots.reduce((total, lot) => total + lot.remainingShares, 0) * 10_000) / 10_000,
    valueInr: canValue ? releasedValueInr(lots, price.value, usdInr.value) : 0,
    unvestedShares: unvestedShares(vests, today),
    unvestedValueInr: canValue ? shareValue(unvestedShares(vests, today), price.value, usdInr.value) : 0,
    priceUsdCents: price?.value ?? null,
    priceDate: price?.date ?? null,
    usdInr: usdInr?.value ?? null,
    usdInrDate: usdInr?.date ?? null,
    upcoming:
      nextVest === null
        ? null
        : {
            date: nextVest.date,
            shares: nextVest.shares,
            valueInr: canValue ? shareValue(nextVest.shares, price.value, usdInr.value) : 0,
          },
    lots: lots.map((lot) => ({
      id: lot.id,
      acquiredDate: lot.acquiredDate,
      remainingShares: lot.remainingShares,
      source: lot.source,
      gainInr:
        canValue && lot.usdInrOnAcquire !== null
          ? lotGainInr(
              {
                remainingShares: lot.remainingShares,
                costPerShareUsdCents: lot.costPerShareUsdCents,
                usdInrOnAcquire: lot.usdInrOnAcquire,
              },
              price.value,
              usdInr.value,
            )
          : null,
    })),
    vests: vestRows.map((row) => ({
      id: row.id,
      vestDate: row.vestDate,
      shares: row.shares,
      status: row.status,
      valueInr: canValue ? shareValue(row.shares, price.value, usdInr.value) : null,
    })),
    esppLots: lots.filter((lot) => lot.source === 'ESPP'),
  };
}
