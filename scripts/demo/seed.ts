/**
 * Demo data for the README screenshots: one made-up person with accounts, 18 months of
 * transactions, a home loan, SIPs, RSUs and so on. Every name, number and amount is invented, and
 * everything is derived from a seeded random generator, so the same screenshots come out each time.
 *
 * `seedDemo` writes rows straight into the app's Dexie tables (the same shapes the importers
 * produce), so the real screens render them. Run via `npm run screenshots`.
 */

import type {
  AccountRow,
  EpfEntryRow,
  EquityGrantRow,
  EquityLotRow,
  FinanceDb,
  GoalRow,
  LoanEntryRow,
  MfFolioRow,
  MfTxnRow,
  PriceRow,
  RuleRow,
  SnapshotRow,
  TxnRow,
  VestRow,
} from '../../src/db/schema';
import { EQUITY_SYMBOL_SETTING } from '../../src/config';
import { addDays, addMonths, daysBetween, monthKey } from '../../src/domain/dates';
import { standardEmi } from '../../src/domain/loanPlan';
import type { IsoDate, Paise } from '../../src/parsers/types';

/** The date the screenshots are taken on. The page clock is pinned to it. */
export const DEMO_TODAY: IsoDate = '2026-09-30';

const IMPORT_ID = 'demo';
const rupees = (amount: number): Paise => Math.round(amount * 100);

// ---------- seeded randomness ----------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260930);
const between = (low: number, high: number): number => low + random() * (high - low);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
function gauss(): number {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}
const digits = (n: number): string => Array.from({ length: n }, () => Math.floor(random() * 10)).join('');

// ---------- dates ----------

const pad = (n: number): string => String(n).padStart(2, '0');
const day = (month: string, d: number): IsoDate => `${month}-${pad(d)}`;
const lastDayOf = (month: string): IsoDate => addDays(addMonths(`${month}-01`, 1), -1);
const monthsBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = monthKey(addMonths(`${m}-01`, 1))) out.push(m);
  return out;
};

const TODAY_MONTH = monthKey(DEMO_TODAY);
/** Transactions cover this window: enough for a financial-year view against the year before. */
const TXN_FROM = '2025-04';
/** Balances and holdings start earlier so the trend chart has a long run. */
const HISTORY_FROM = '2024-04';

// ---------- accounts ----------

const SBI = 'sbi-4821';
const FEDERAL = 'federal-7305';
const CARD = 'icici-card-9012';
const PPF = 'sbi-ppf';
const EPF = 'epf-DEMO00412';
const LOAN = 'ubi-loan-7733';
const HOME = 'home';

const EMPLOYER = 'Acme Systems India Pvt Ltd';
const SYMBOL = 'ACME';

// The loan's terms: ₹58 lakh disbursed on day one, a standard 20-year EMI.
const LOAN_DISBURSED_ON: IsoDate = '2024-04-01';
const LOAN_PRINCIPAL = rupees(5_800_000);
const LOAN_EMI = standardEmi(LOAN_PRINCIPAL, 8.5, 240);

const accounts: AccountRow[] = [
  { id: SBI, kind: 'savings', institution: 'SBI', maskedNumber: '4821', name: 'SBI Savings', meta: { source: 'sbi' } },
  { id: FEDERAL, kind: 'savings', institution: 'Federal', maskedNumber: '7305', name: 'Federal Savings', meta: { source: 'federal' } },
  { id: CARD, kind: 'card', institution: 'ICICI', maskedNumber: '9012', name: 'ICICI Credit Card', meta: { source: 'icici-card' } },
  { id: PPF, kind: 'ppf', institution: 'SBI', maskedNumber: 'PPF', name: 'SBI PPF', meta: { source: 'sbi' } },
  { id: EPF, kind: 'epf', institution: 'EPFO', maskedNumber: '00412', name: EMPLOYER, meta: { memberId: 'DEMOMEMBER00412', establishmentName: EMPLOYER } },
  { id: 'mf', kind: 'mf', institution: 'CAMS', maskedNumber: '', name: 'Mutual funds', meta: { source: 'cas' } },
  { id: 'equity', kind: 'equity', institution: 'E*TRADE', maskedNumber: '', name: SYMBOL, meta: { symbol: SYMBOL } },
  { id: HOME, kind: 'property', institution: '', maskedNumber: '', name: 'Home, Bengaluru', meta: { appreciationPct: 6 } },
  { id: LOAN, kind: 'loan', institution: 'UBI', maskedNumber: '7733', name: 'UBI Home Loan', meta: { sanctioned: LOAN_PRINCIPAL, bankEmi: LOAN_EMI } },
];

// ---------- transactions ----------

interface Draft {
  accountId: string;
  date: IsoDate;
  description: string;
  /** Rupees, signed: credit > 0, debit < 0. */
  amount: number;
  category: string | null;
  kind?: TxnRow['kind'];
  pairId?: string | null;
}

const drafts: Draft[] = [];
const add = (draft: Draft): void => {
  drafts.push(draft);
};
const upi = (merchant: string, note: string, mcc: string): string => `UPIOUT/${digits(12)}/${merchant}/${note}/${mcc}`;

/** Where the everyday spending goes: [account, narration, category, low, high, per month]. */
interface Habit {
  merchant: string;
  note: string;
  mcc: string;
  category: string;
  low: number;
  high: number;
  perMonth: [number, number];
}
const UPI_HABITS: Habit[] = [
  { merchant: 'BIGBASKET', note: 'Groceries', mcc: '5411', category: 'Groceries', low: 800, high: 2600, perMonth: [2, 3] },
  { merchant: 'ZEPTO', note: 'Groceries', mcc: '5411', category: 'Groceries', low: 280, high: 900, perMonth: [2, 4] },
  { merchant: 'DMART', note: 'Groceries', mcc: '5411', category: 'Groceries', low: 1800, high: 4200, perMonth: [1, 2] },
  { merchant: 'SWIGGY', note: 'Food', mcc: '5812', category: 'Food delivery', low: 280, high: 760, perMonth: [3, 5] },
  { merchant: 'ZOMATO', note: 'Food', mcc: '5814', category: 'Food delivery', low: 250, high: 680, perMonth: [2, 3] },
  { merchant: 'INDIAN OIL', note: 'Fuel', mcc: '5541', category: 'Fuel', low: 1800, high: 3200, perMonth: [1, 2] },
  { merchant: 'UBER', note: 'Ride', mcc: '4112', category: 'Transport', low: 150, high: 480, perMonth: [2, 4] },
  { merchant: 'NAMMA METRO', note: 'Metro', mcc: '4111', category: 'Transport', low: 200, high: 400, perMonth: [1, 1] },
  { merchant: 'APOLLO PHARMACY', note: 'Medicine', mcc: '5912', category: 'Medical', low: 300, high: 1700, perMonth: [0, 2] },
  { merchant: 'STARBUCKS', note: 'Coffee', mcc: '5814', category: 'Dining out', low: 320, high: 780, perMonth: [1, 3] },
  { merchant: 'AMAZON', note: 'Shopping', mcc: '5311', category: 'Shopping', low: 400, high: 2400, perMonth: [1, 2] },
];
const CARD_HABITS: { description: string; category: string; low: number; high: number; perMonth: [number, number] }[] = [
  { description: 'AMAZON PAY INDIA BANGALORE', category: 'Shopping', low: 700, high: 5200, perMonth: [2, 3] },
  { description: 'MYNTRA DESIGNS BANGALORE', category: 'Shopping', low: 1200, high: 4800, perMonth: [0, 2] },
  { description: 'CROMA ELECTRONICS BANGALORE', category: 'Shopping', low: 2400, high: 9800, perMonth: [0, 1] },
  { description: 'TOIT BREWPUB BANGALORE', category: 'Dining out', low: 1400, high: 3600, perMonth: [1, 2] },
  { description: 'THE BIG CHILL CAFE BANGALORE', category: 'Dining out', low: 700, high: 1800, perMonth: [1, 2] },
  { description: 'BIGBASKET BANGALORE', category: 'Groceries', low: 1400, high: 3800, perMonth: [1, 2] },
  { description: 'SHELL PETROL PUMP BANGALORE', category: 'Fuel', low: 1500, high: 2600, perMonth: [1, 1] },
  { description: 'UBER INDIA BANGALORE', category: 'Transport', low: 220, high: 640, perMonth: [1, 3] },
  { description: 'DECATHLON SPORTS BANGALORE', category: 'Shopping', low: 1100, high: 4200, perMonth: [0, 1] },
  { description: 'NETFLIX.COM MUMBAI', category: 'Subscriptions', low: 649, high: 649, perMonth: [1, 1] },
  { description: 'SPOTIFY MUMBAI', category: 'Subscriptions', low: 119, high: 119, perMonth: [1, 1] },
  { description: 'APPLE ICLOUD', category: 'Subscriptions', low: 75, high: 75, perMonth: [1, 1] },
  { description: 'MANIPAL HOSPITAL BANGALORE', category: 'Medical', low: 900, high: 3200, perMonth: [0, 1] },
];

/** One-off lumps that make some months look different from others. */
const EXTRAS: Record<string, Draft[]> = {
  '2025-06': [
    { accountId: CARD, date: '2025-06-09', description: 'MAKEMYTRIP INDIA GURGAON', amount: -23400, category: 'Travel' },
    { accountId: CARD, date: '2025-06-12', description: 'TAJ HOTELS MUMBAI', amount: -18600, category: 'Travel' },
  ],
  '2025-10': [{ accountId: CARD, date: '2025-10-18', description: 'TANISHQ JEWELLERY BANGALORE', amount: -34800, category: 'Gifts' }],
  '2025-12': [
    { accountId: CARD, date: '2025-12-20', description: 'INDIGO AIRLINES GURGAON', amount: -21800, category: 'Travel' },
    { accountId: CARD, date: '2025-12-24', description: 'OYO ROOMS GURGAON', amount: -12400, category: 'Travel' },
  ],
  '2026-01': [{ accountId: FEDERAL, date: '2026-01-14', description: 'LIC OF INDIA PREMIUM', amount: -42000, category: 'Insurance' }],
  '2026-09': [
    { accountId: CARD, date: '2026-09-07', description: 'INDIGO AIRLINES GURGAON', amount: -16400, category: 'Travel' },
    { accountId: CARD, date: '2026-09-09', description: 'VISTARA GOA RESORT PANAJI', amount: -9800, category: 'Travel' },
    { accountId: CARD, date: '2026-09-21', description: 'CROMA ELECTRONICS BANGALORE', amount: -12800, category: 'Shopping' },
  ],
};

const SALARY_RAISE_FROM = '2026-04';
const salaryFor = (month: string): number => (month >= SALARY_RAISE_FROM ? 212000 : 192000);
const SIPS = [
  { key: 'idx', rupees: 15000 },
  { key: 'flexi', rupees: 12000 },
  { key: 'mid', rupees: 8000 },
  { key: 'small', rupees: 5000 },
];
const FUND_NAMES: Record<string, string> = {
  idx: 'Nifty 50 Index Fund - Direct Growth',
  flexi: 'Flexi Cap Fund - Direct Growth',
  mid: 'Mid Cap Opportunities Fund - Direct Growth',
  small: 'Small Cap Fund - Direct Growth',
  bond: 'Corporate Bond Fund - Direct Growth',
};

// The loan is simulated here so the transaction EMIs and the loan statement agree.
const loanRate = (period: string): number => (period >= '2025-07' ? 8.25 : 8.5);
const PREPAYMENT = { date: '2026-04-02' as IsoDate, amount: rupees(200_000) };

const loanEntries: LoanEntryRow[] = [];
function simulateLoan(): void {
  let outstanding = LOAN_PRINCIPAL;
  const push = (row: Omit<LoanEntryRow, 'id' | 'accountId' | 'importId' | 'fingerprint' | 'ref'>): void => {
    const n = loanEntries.length;
    loanEntries.push({ ...row, id: `loan-${n}`, accountId: LOAN, ref: '', importId: IMPORT_ID, fingerprint: `loan|${n}` });
  };
  push({ date: LOAN_DISBURSED_ON, description: 'LOAN DISBURSEMENT', kind: 'disbursement', amount: LOAN_PRINCIPAL, outstandingAfter: outstanding });
  for (const month of monthsBetween(HISTORY_FROM, TODAY_MONTH)) {
    const first = day(month, 1);
    if (month > HISTORY_FROM && first <= DEMO_TODAY) {
      // Interest for last month, worked out the way `deriveRates` reads it back: from the daily
      // closing balances, so the rate shown in the app is the rate used here.
      const period = monthKey(addMonths(first, -1));
      const from = day(period, 1);
      const to = lastDayOf(period);
      let dailyTotal = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        let balance = 0;
        for (const row of loanEntries) if (row.date <= d) balance = row.outstandingAfter;
        dailyTotal += balance;
      }
      const interest = Math.round((dailyTotal * loanRate(period)) / 36_500);
      outstanding += interest;
      push({ date: first, description: 'INTEREST DEBITED', kind: 'interest', amount: interest, outstandingAfter: outstanding, interestFrom: from, interestTo: to });
    }
    const emiDate = day(month, 5);
    if (emiDate > DEMO_TODAY) continue;
    if (PREPAYMENT.date >= first && PREPAYMENT.date < emiDate) {
      outstanding -= PREPAYMENT.amount;
      push({ date: PREPAYMENT.date, description: 'PART PAYMENT RECEIVED', kind: 'prepayment', amount: PREPAYMENT.amount, outstandingAfter: outstanding });
    }
    outstanding -= LOAN_EMI;
    push({ date: emiDate, description: 'EMI RECEIVED', kind: 'emi', amount: LOAN_EMI, outstandingAfter: outstanding });
  }
}

/** Month-by-month balances before the transaction window, a gentle wander around a level. */
function wander(level: number, spread: number, months: string[]): Map<string, number> {
  const out = new Map<string, number>();
  let value = level;
  for (const month of months) {
    value += (level - value) * 0.35 + gauss() * spread;
    out.set(month, Math.round(value));
  }
  return out;
}

function generateTransactions(): void {
  const months = monthsBetween(TXN_FROM, TODAY_MONTH);
  const lastBillDay = (month: string): number => (month === TODAY_MONTH ? 29 : 28);
  const pair = (): string => `pair-${digits(8)}`;

  for (const month of months) {
    const limit = month === TODAY_MONTH ? 29 : 28;

    // SBI: salary, EMI, SIPs, PPF, family, utilities, transfers.
    add({ accountId: SBI, date: day(month, 28), description: `NEFT-${EMPLOYER.toUpperCase()}-SALARY`, amount: salaryFor(month), category: 'Salary' });
    if (month.endsWith('-03')) {
      add({ accountId: SBI, date: day(month, 20), description: `NEFT-${EMPLOYER.toUpperCase()}-ANNUAL BONUS`, amount: 240000, category: 'Salary' });
    }
    add({ accountId: SBI, date: day(month, 5), description: 'ACH D- UBIN-HOME LOAN EMI', amount: -LOAN_EMI / 100, category: 'Loan EMI' });
    for (const sip of SIPS) {
      add({ accountId: SBI, date: day(month, 5), description: `ACH D- SAMPLE AMC-${sip.key.toUpperCase()} SIP`, amount: -sip.rupees, category: 'Investments', kind: 'investment' });
    }
    add({ accountId: SBI, date: day(month, 10), description: 'TRANSFER TO PPF 4821', amount: -12500, category: 'Investments', kind: 'investment' });
    add({ accountId: SBI, date: day(month, 12), description: 'TRANSFER TO FAMILY', amount: -15000, category: 'Family' });
    add({ accountId: SBI, date: day(month, 8), description: upi('BESCOM', 'Electricity', '4900'), amount: -Math.round(between(1700, 3300)), category: 'Utilities' });
    add({ accountId: SBI, date: day(month, 14), description: 'ACH D- AIRTEL BROADBAND', amount: -1179, category: 'Utilities' });
    add({ accountId: SBI, date: day(month, 20), description: 'ACH D- AIRTEL POSTPAID', amount: -599, category: 'Utilities' });
    if (['03', '06', '09', '12'].includes(month.slice(5))) {
      add({ accountId: SBI, date: day(month, 26), description: 'SBINT:CREDIT INTEREST', amount: Math.round(between(2100, 2700)), category: 'Interest', kind: 'interest' });
    }
    if (month === monthKey(PREPAYMENT.date)) {
      add({ accountId: SBI, date: PREPAYMENT.date, description: 'TRANSFER TO UBI HOME LOAN PART PAYMENT', amount: -PREPAYMENT.amount / 100, category: 'Loan EMI', kind: 'investment' });
    }

    // The monthly top-up from SBI to Federal, one transfer seen from both sides.
    const topUp = pair();
    add({ accountId: SBI, date: day(month, 6), description: 'TRANSFER TO FEDERAL BANK 7305', amount: -75000, category: null, kind: 'transfer', pairId: topUp });
    add({ accountId: FEDERAL, date: day(month, 6), description: 'TRANSFER FROM SBI 4821', amount: 75000, category: null, kind: 'transfer', pairId: topUp });

    // Federal UPI spending.
    for (const habit of UPI_HABITS) {
      const count = Math.round(between(habit.perMonth[0], habit.perMonth[1]));
      for (let i = 0; i < count; i++) {
        add({
          accountId: FEDERAL,
          date: day(month, 1 + Math.floor(random() * limit)),
          description: upi(habit.merchant, habit.note, habit.mcc),
          amount: -Math.round(between(habit.low, habit.high) / 10) * 10,
          category: habit.category,
        });
      }
    }
    if (random() < 0.45) {
      add({ accountId: FEDERAL, date: day(month, 1 + Math.floor(random() * limit)), description: upi('URBAN COMPANY', 'Home services', '7349'), amount: -Math.round(between(500, 1800) / 10) * 10, category: 'Other' });
    }
    if (random() < 0.3) {
      add({ accountId: FEDERAL, date: day(month, 1 + Math.floor(random() * limit)), description: upi('FERNS N PETALS', 'Gift', '5992'), amount: -Math.round(between(900, 2800) / 10) * 10, category: 'Gifts' });
    }

    // Card purchases, then the bill paid from Federal on the 18th.
    for (const habit of CARD_HABITS) {
      const count = Math.round(between(habit.perMonth[0], habit.perMonth[1]));
      for (let i = 0; i < count; i++) {
        add({
          accountId: CARD,
          date: day(month, 1 + Math.floor(random() * lastBillDay(month))),
          description: habit.description,
          amount: -Math.round(between(habit.low, habit.high)),
          category: habit.category,
        });
      }
    }
    for (const extra of EXTRAS[month] ?? []) add(extra);
  }

  // Card bill payments depend on what was spent before the 18th, so work them out afterwards.
  const byCard = drafts.filter((draft) => draft.accountId === CARD).sort((a, b) => (a.date < b.date ? -1 : 1));
  let owed = 0;
  let cursor = 0;
  for (const month of months) {
    const billDate = day(month, 18);
    while (cursor < byCard.length && byCard[cursor].date <= billDate) owed += -byCard[cursor++].amount;
    if (billDate > DEMO_TODAY || owed <= 0) continue;
    const link = pair();
    add({ accountId: FEDERAL, date: billDate, description: `CC PAYMENT ICICI ${digits(6)}`, amount: -owed, category: null, kind: 'transfer', pairId: link });
    add({ accountId: CARD, date: billDate, description: 'PAYMENT RECEIVED THANK YOU', amount: owed, category: null, kind: 'transfer', pairId: link });
    owed = 0;
  }
}

function transactionRows(): { txns: TxnRow[]; snapshots: SnapshotRow[] } {
  const priorMonths = monthsBetween(HISTORY_FROM, monthKey(addMonths(`${TXN_FROM}-01`, -1)));
  const opening: Record<string, number> = {
    [SBI]: 410000,
    [FEDERAL]: 180000,
    [CARD]: 0,
  };
  const txns: TxnRow[] = [];
  const snapshots: SnapshotRow[] = [];
  const statementEnd = (month: string): IsoDate => (month === TODAY_MONTH ? DEMO_TODAY : lastDayOf(month));

  // Months before the statements start: balances only.
  const prior: Record<string, Map<string, number>> = {
    [SBI]: wander(380000, 40000, priorMonths),
    [FEDERAL]: wander(170000, 25000, priorMonths),
    [CARD]: wander(-24000, 9000, priorMonths),
  };
  for (const id of [SBI, FEDERAL, CARD]) {
    for (const [month, balance] of prior[id]) {
      snapshots.push({ accountId: id, date: statementEnd(month), balance: rupees(balance), source: 'statement', importId: IMPORT_ID });
    }
  }

  for (const id of [SBI, FEDERAL, CARD]) {
    const rows = drafts.filter((draft) => draft.accountId === id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let balance = rupees(opening[id]);
    let n = 0;
    for (const draft of rows) {
      balance += rupees(draft.amount);
      txns.push({
        id: `${id}-${n}`,
        accountId: id,
        date: draft.date,
        description: draft.description,
        ref: '',
        amount: rupees(draft.amount),
        balanceAfter: balance,
        category: draft.category,
        categorySource: draft.category === null ? null : 'default',
        kind: draft.kind ?? 'normal',
        transferPairId: draft.pairId ?? null,
        importId: IMPORT_ID,
        fingerprint: `${id}|${n++}`,
      });
    }
    // Month-end snapshots from the running balance.
    for (const month of monthsBetween(TXN_FROM, TODAY_MONTH)) {
      const end = statementEnd(month);
      const last = [...txns].reverse().find((txn) => txn.accountId === id && txn.date <= end);
      snapshots.push({ accountId: id, date: end, balance: last?.balanceAfter ?? rupees(opening[id]), source: 'statement', importId: IMPORT_ID });
    }
  }
  return { txns, snapshots };
}

// ---------- retirement: PPF and EPF ----------

function ppfSnapshots(): SnapshotRow[] {
  const out: SnapshotRow[] = [];
  let balance = rupees(700_000);
  for (const month of monthsBetween(HISTORY_FROM, TODAY_MONTH)) {
    balance += rupees(12500);
    if (month.endsWith('-03')) balance += Math.round(balance * 0.071);
    out.push({ accountId: PPF, date: month === TODAY_MONTH ? DEMO_TODAY : lastDayOf(month), balance, source: 'statement', importId: IMPORT_ID });
  }
  return out;
}

function epfRows(): { entries: EpfEntryRow[]; snapshot: SnapshotRow } {
  const entries: EpfEntryRow[] = [];
  const fyOf = (month: string): number => (Number(month.slice(5)) >= 4 ? Number(month.slice(0, 4)) : Number(month.slice(0, 4)) - 1);
  const contribution = (month: string): { ee: number; er: number } => {
    const fy = fyOf(month);
    return fy >= 2025 && month >= '2026-04' ? { ee: 12000, er: 10750 } : fy >= 2025 ? { ee: 11400, er: 10150 } : { ee: 10800, er: 9550 };
  };
  let ee = rupees(540_000);
  let er = rupees(470_000);
  const eps = rupees(90_000);
  entries.push({ accountId: EPF, fy: 2024, kind: 'opening', creditDate: '2024-04-01', ee, er, eps, importId: IMPORT_ID });
  let monthlyEpsAdded = 0;
  for (const month of monthsBetween(HISTORY_FROM, '2026-08')) {
    const c = contribution(month);
    const credit = day(monthKey(addMonths(`${month}-01`, 1)), 20);
    entries.push({ accountId: EPF, fy: fyOf(credit.slice(0, 7)), kind: 'contribution', wageMonth: month, creditDate: credit, ee: rupees(c.ee), er: rupees(c.er), eps: rupees(1250), importId: IMPORT_ID });
    ee += rupees(c.ee);
    er += rupees(c.er);
    monthlyEpsAdded += rupees(1250);
    if (credit.endsWith('-03-20') && credit.slice(0, 4) >= '2025') {
      // The FY's interest lands at year end, 8.25% on roughly the average balance.
      const total = Math.round(((ee + er) * 0.0825) / 1.04);
      const eeShare = Math.round((total * ee) / (ee + er));
      entries.push({ accountId: EPF, fy: fyOf(`${Number(credit.slice(0, 4)) - 1}-04`), kind: 'interest', creditDate: `${credit.slice(0, 4)}-03-31`, ee: eeShare, er: total - eeShare, eps: Math.round(monthlyEpsAdded * 0.04), importId: IMPORT_ID });
      ee += eeShare;
      er += total - eeShare;
    }
  }
  return { entries, snapshot: { accountId: EPF, date: '2026-09-20', balance: ee + er, source: 'statement', importId: IMPORT_ID } };
}

// ---------- the home ----------

const propertySnapshots: SnapshotRow[] = [
  { accountId: HOME, date: '2024-04-15', balance: rupees(8_800_000), source: 'manual', importId: null },
  { accountId: HOME, date: '2025-04-10', balance: rupees(9_350_000), source: 'manual', importId: null },
  { accountId: HOME, date: '2026-04-05', balance: rupees(9_800_000), source: 'manual', importId: null },
];

// ---------- prices ----------

const priceRows: PriceRow[] = [];
const priceDates = (from: string): IsoDate[] => {
  const dates: IsoDate[] = [];
  for (const month of monthsBetween(from, TODAY_MONTH)) {
    for (const d of [day(month, 5), day(month, 15), month === TODAY_MONTH ? DEMO_TODAY : lastDayOf(month)]) {
      if (d <= DEMO_TODAY && !dates.includes(d)) dates.push(d);
    }
  }
  return dates.sort();
};

/** Two market dips, as smooth bumps, so no chart is a straight line. */
function dip(date: IsoDate): number {
  const bump = (centre: IsoDate, width: number, depth: number): number =>
    -depth * Math.exp(-((daysBetween(centre, date) / width) ** 2));
  return bump('2025-03-15', 50, 0.11) + bump('2026-03-10', 40, 0.08);
}

const years = (from: IsoDate, to: IsoDate): number => daysBetween(from, to) / 365;

/**
 * A price path: steady growth, the market dips scaled by `beta`, and a little autocorrelated noise.
 * When `pin` is given the path is bent (in log terms, evenly) to end exactly there.
 */
function pricePath(dates: IsoDate[], start: number, mu: number, beta: number, noise: number, pin?: number): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  let wobble = 0;
  const raw: number[] = [];
  for (const date of dates) {
    wobble = wobble * 0.7 + noise * gauss();
    raw.push(Math.log(start) + mu * years(dates[0], date) + beta * dip(date) + wobble);
  }
  const bend = pin === undefined ? 0 : Math.log(pin) - raw[raw.length - 1];
  dates.forEach((date, i) => {
    const share = dates.length > 1 ? i / (dates.length - 1) : 1;
    out.set(date, Math.exp(raw[i] + bend * share));
  });
  return out;
}

interface FundSpec {
  key: string;
  isin: string;
  navStart: number;
  mu: number;
  beta: number;
  sigma: number;
}
const FUNDS: FundSpec[] = [
  { key: 'idx', isin: 'INF000000001', navStart: 142.6, mu: 0.115, beta: 0.9, sigma: 0.006 },
  { key: 'flexi', isin: 'INF000000002', navStart: 68.4, mu: 0.15, beta: 1, sigma: 0.01 },
  { key: 'mid', isin: 'INF000000003', navStart: 91.8, mu: 0.19, beta: 1.15, sigma: 0.014 },
  { key: 'small', isin: 'INF000000004', navStart: 54.2, mu: 0.22, beta: 1.3, sigma: 0.018 },
  { key: 'bond', isin: 'INF000000005', navStart: 38.9, mu: 0.075, beta: 0.1, sigma: 0.0015 },
];
const MF_FROM = '2023-04';

const navs = new Map<string, Map<IsoDate, number>>();
function simulateNavs(): void {
  const dates = priceDates(MF_FROM);
  for (const fund of FUNDS) {
    const series = pricePath(dates, fund.navStart, fund.mu, fund.beta, fund.sigma);
    navs.set(fund.key, series);
    for (const [date, value] of series) {
      priceRows.push({ symbol: `MF:${fund.isin}`, date, value: Math.round(value * 10_000), source: 'api' });
    }
  }
}

function mfRows(): { folios: MfFolioRow[]; txns: MfTxnRow[] } {
  const folios: MfFolioRow[] = [];
  const txns: MfTxnRow[] = [];
  const casDate: IsoDate = '2026-09-12';
  FUNDS.forEach((fund) => {
    const folioId = `folio-${fund.key}`;
    const series = navs.get(fund.key) as Map<IsoDate, number>;
    let units = 0;
    let n = 0;
    const buy = (date: IsoDate, amountRupees: number, type: 'sip' | 'purchase'): void => {
      const nav = Math.round((series.get(date) ?? [...series].filter(([d]) => d <= date).pop()?.[1] ?? fund.navStart) * 10_000);
      const bought = Math.round((amountRupees / (nav / 10_000)) * 1000);
      units += bought;
      txns.push({
        id: `${folioId}-${n}`,
        folioId,
        date,
        description: type === 'sip' ? 'Purchase - Systematic Investment' : 'Purchase',
        type,
        amount: rupees(amountRupees),
        units: bought,
        nav,
        stampDuty: Math.round(rupees(amountRupees) * 0.00005),
        importId: IMPORT_ID,
        fingerprint: `${folioId}|${n++}`,
      });
    };
    if (fund.key === 'bond') {
      buy('2023-05-08', 150000, 'purchase');
      buy('2024-06-10', 100000, 'purchase');
    } else {
      const sip = SIPS.find((candidate) => candidate.key === fund.key)?.rupees ?? 0;
      for (const month of monthsBetween(MF_FROM, TODAY_MONTH)) {
        const date = day(month, 5);
        if (date <= casDate) buy(date, sip, 'sip');
      }
      // Lump sums from bonuses add some texture to the cost basis.
      if (fund.key === 'idx') buy('2024-03-15', 100000, 'purchase');
      if (fund.key === 'flexi') buy('2025-04-08', 75000, 'purchase');
    }
    folios.push({
      id: folioId,
      folio: `${digits(7)}/${digits(2)}`,
      amc: 'Sample AMC',
      scheme: FUND_NAMES[fund.key],
      isin: fund.isin,
      amfiCode: null,
      holdingMode: 'soa',
      units,
      asOf: casDate,
      historyComplete: true,
    });
  });
  return { folios, txns };
}

// ---------- employer stock ----------

const VEST_FIRST = '2024-01-15';
const VEST_COUNT = 20;
const SHARES_PER_VEST = 8;
const WITHHELD = 3;

function equityRows(): { grants: EquityGrantRow[]; vests: VestRow[]; lots: EquityLotRow[] } {
  const dates = priceDates('2024-02');
  const acme = new Map<IsoDate, number>();
  const fx = new Map<IsoDate, number>();
  const usdPath = pricePath(dates, 21_600, 0.12, 1.2, 0.012, 31_260);
  const fxPath = pricePath(dates, 832_000, 0.022, 0, 0.002, 884_700);
  for (const date of dates) {
    acme.set(date, Math.round(usdPath.get(date) as number));
    fx.set(date, Math.round(fxPath.get(date) as number));
  }
  // Pin today's close and the day before, so the day's gain is a believable small move.
  acme.set('2026-09-29', 31_040);
  acme.set(DEMO_TODAY, 31_260);
  fx.set('2026-09-29', 884_100);
  fx.set(DEMO_TODAY, 884_700);
  for (const [date, value] of acme) priceRows.push({ symbol: SYMBOL, date, value, source: 'api' });
  for (const [date, value] of fx) priceRows.push({ symbol: 'USDINR', date, value, source: 'api' });
  const at = (series: Map<IsoDate, number>, date: IsoDate): number => [...series].filter(([d]) => d <= date).pop()?.[1] ?? 0;

  const grantNumber = 'RS-482913';
  const vests: VestRow[] = [];
  const lots: EquityLotRow[] = [];
  for (let period = 1; period <= VEST_COUNT; period++) {
    const vestDate = addMonths(VEST_FIRST, 3 * (period - 1));
    const done = vestDate <= DEMO_TODAY;
    const price = at(acme, vestDate) || at(acme, DEMO_TODAY);
    const net = SHARES_PER_VEST - WITHHELD;
    vests.push({
      id: `vest-${period}`,
      grantId: 'grant-1',
      period,
      vestDate,
      shares: SHARES_PER_VEST,
      status: done ? 'vested' : 'unvested',
      grantNumber,
      cancelledShares: 0,
      vestedShares: done ? SHARES_PER_VEST : 0,
      releasedShares: done ? net : 0,
      sellableShares: done ? net : 0,
      sharesWithheld: done ? WITHHELD : 0,
      fmvUsdCents: done ? price : null,
      taxableGainUsdCents: done ? price * SHARES_PER_VEST : null,
      taxRatePct: done ? 37.5 : null,
    });
    if (done) {
      lots.push({
        id: `lot-${period}`,
        vestId: `vest-${period}`,
        esppPurchaseId: null,
        key: `${grantNumber}#${period}`,
        acquiredDate: vestDate,
        netShares: net,
        remainingShares: net,
        costPerShareUsdCents: price,
        remainingCostUsdCents: price * net,
        usdInrOnAcquire: at(fx, vestDate),
        source: 'RSU',
      });
    }
  }
  const vestedCount = vests.filter((vest) => vest.status === 'vested').length;
  const grants: EquityGrantRow[] = [
    {
      id: 'grant-1',
      grantNumber,
      type: 'RSU',
      grantDate: '2023-10-15',
      totalShares: VEST_COUNT * SHARES_PER_VEST,
      cancelledShares: 0,
      vestedShares: vestedCount * SHARES_PER_VEST,
      unvestedShares: (VEST_COUNT - vestedCount) * SHARES_PER_VEST,
      sellableShares: vestedCount * (SHARES_PER_VEST - WITHHELD),
    },
  ];
  return { grants, vests, lots };
}

// ---------- rules, goals, settings ----------

const rules: RuleRow[] = [
  { id: 'rule-1', name: 'Swiggy and Zomato', pattern: 'SWIGGY', orPatterns: ['ZOMATO'], isRegex: false, category: 'Food delivery', priority: 10 },
  { id: 'rule-2', name: 'Streaming', pattern: 'NETFLIX', orPatterns: ['SPOTIFY', 'ICLOUD'], isRegex: false, category: 'Subscriptions', priority: 20 },
  { id: 'rule-3', name: 'Cafes and pubs', pattern: 'STARBUCKS', orPatterns: ['TOIT', 'BIG CHILL'], isRegex: false, category: 'Dining out', priority: 30 },
  { id: 'rule-4', name: 'Flights and hotels', pattern: 'INDIGO', orPatterns: ['MAKEMYTRIP', 'OYO', 'TAJ HOTELS'], isRegex: false, category: 'Travel', priority: 40 },
];

const goals: GoalRow[] = [
  { id: 'goal-1', name: 'Emergency fund', targetPaise: rupees(1_200_000), targetDate: '2027-03-31', linkedAccountIds: [SBI, FEDERAL] },
  { id: 'goal-2', name: "Child's education", targetPaise: rupees(5_000_000), targetDate: '2038-06-01', linkedAccountIds: ['mf'] },
];

const SETTINGS: { key: string; value: unknown }[] = [
  { key: EQUITY_SYMBOL_SETTING, value: SYMBOL },
  { key: 'lastBackupAt', value: '2026-08-02' },
  // A price refresh a few hours ago, so opening the app does not go to the network.
  { key: 'lastPriceRefresh', value: '2026-09-30T02:00:00.000Z' },
  { key: 'categoryConfig', value: { custom: ['Travel', 'Subscriptions', 'Dining out', 'Gifts'], excluded: ['Family'] } },
  { key: 'planDefaults', value: { ppfRatePct: 7.1, epfRatePct: 8.25, retirementAge: 58, currentAge: 36, ppfOpeningFy: 2016, epfMonthly: rupees(22750), ppfYearly: rupees(150_000) } },
];

// ---------- entry point ----------

/** Wipes the app's tables and fills them with the demo person. */
export async function seedDemo(db: FinanceDb): Promise<void> {
  drafts.length = 0;
  loanEntries.length = 0;
  priceRows.length = 0;
  simulateLoan();
  generateTransactions();
  simulateNavs();
  const { txns, snapshots } = transactionRows();
  const epf = epfRows();
  const mf = mfRows();
  const equity = equityRows();

  const loanSnapshots: SnapshotRow[] = loanEntries
    .filter((entry) => entry.kind === 'emi')
    .map((entry) => ({ accountId: LOAN, date: entry.date, balance: -entry.outstandingAfter, source: 'statement', importId: IMPORT_ID }));

  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.accounts.bulkPut(accounts);
    await db.transactions.bulkPut(txns);
    await db.balanceSnapshots.bulkPut([...snapshots, ...ppfSnapshots(), epf.snapshot, ...propertySnapshots, ...loanSnapshots]);
    await db.epfEntries.bulkAdd(epf.entries);
    await db.loanEntries.bulkPut(loanEntries);
    await db.mfFolios.bulkPut(mf.folios);
    await db.mfTxns.bulkPut(mf.txns);
    await db.equityGrants.bulkPut(equity.grants);
    await db.vests.bulkPut(equity.vests);
    await db.equityLots.bulkPut(equity.lots);
    await db.prices.bulkPut(priceRows);
    await db.rules.bulkPut(rules);
    await db.goals.bulkPut(goals);
    await db.settings.bulkPut(SETTINGS);
  });
}
