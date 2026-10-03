import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '../../src/db/repos';
import {
  FinanceDb,
  type AccountRow,
  type SnapshotRow,
  type TxnRow,
} from '../../src/db/schema';
import { daysBetween } from '../../src/domain/dates';
import {
  buildNetWorthInputs,
  cashFlowMonth,
  epfSummary,
  equitySummary,
  homeSummary,
  loanSummary,
  mfSummary,
  netWorthTrend,
} from '../../src/services/dashboard';

const TODAY = '2026-10-03';
const FOLIO = 'folio-1|INF000000001';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-dashboard-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
  await seed(db);
});

afterEach(async () => {
  await db.delete();
});

function account(overrides: Partial<AccountRow> & Pick<AccountRow, 'id' | 'kind'>): AccountRow {
  return {
    institution: 'Test',
    maskedNumber: '',
    name: overrides.id,
    meta: {},
    ...overrides,
  };
}

function snapshot(accountId: string, date: string, balance: number): SnapshotRow {
  return { accountId, date, balance, source: 'statement', importId: null };
}

function txn(overrides: Partial<TxnRow> & Pick<TxnRow, 'id' | 'accountId' | 'date' | 'amount' | 'kind'>): TxnRow {
  return {
    description: 'Test',
    ref: '',
    balanceAfter: 0,
    category: 'Other',
    categorySource: 'default',
    transferPairId: null,
    importId: 'imp-1',
    fingerprint: `fp-${overrides.id}`,
    ...overrides,
  };
}

/**
 * One bank, cash, PPF, the loan (with a September interest row and an October EMI), EPF,
 * one MF scheme with a provisional, and equity. All figures are synthetic.
 */
async function seed(database: FinanceDb): Promise<void> {
  await database.accounts.bulkAdd([
    account({ id: 'sbi-1234', kind: 'savings', institution: 'SBI', name: 'SBI Savings', maskedNumber: '1234' }),
    account({ id: 'cash', kind: 'cash', institution: 'Cash', name: 'Cash' }),
    account({ id: 'sbi-ppf', kind: 'ppf', institution: 'SBI', name: 'SBI PPF', maskedNumber: 'PPF' }),
    account({
      id: 'ubi-loan-1234',
      kind: 'loan',
      institution: 'UBI',
      name: 'UBI Home Loan',
      maskedNumber: '1234',
      meta: { sanctioned: 100_000_000, releaseDate: '2026-08-01', bankEmi: 800_000 },
    }),
    account({
      id: 'epf-00001',
      kind: 'epf',
      institution: 'EPFO',
      name: 'Test Corp EPF',
      maskedNumber: '00001',
      meta: { memberId: 'TEST00001', establishmentName: 'Test Corp' },
    }),
  ]);

  await database.balanceSnapshots.bulkAdd([
    snapshot('sbi-1234', '2026-08-31', 96_000_000),
    snapshot('sbi-1234', '2026-09-30', 100_000_000),
    snapshot('cash', '2026-08-31', 500_000),
    snapshot('cash', '2026-09-30', 500_000),
    snapshot('sbi-ppf', '2026-08-31', 20_000_000),
    snapshot('sbi-ppf', '2026-09-30', 20_000_000),
    snapshot('epf-00001', '2026-09-30', 18_000_000),
    snapshot('ubi-loan-1234', '2026-08-31', -62_000_000),
    snapshot('ubi-loan-1234', '2026-09-30', -60_000_000),
  ]);

  await database.transactions.bulkAdd([
    txn({
      id: 'txn-salary',
      accountId: 'sbi-1234',
      date: '2026-10-01',
      amount: 10_000_000,
      kind: 'normal',
      description: 'ACME SALARY',
      category: 'Salary',
    }),
    txn({
      id: 'txn-rent',
      accountId: 'sbi-1234',
      date: '2026-10-02',
      amount: -1_500_000,
      kind: 'normal',
      description: 'UPI/RENT',
      category: 'Rent',
    }),
    txn({
      id: 'txn-groceries',
      accountId: 'sbi-1234',
      date: '2026-10-02',
      amount: -500_000,
      kind: 'normal',
      description: 'UPI/GROCERY',
      category: 'Groceries',
    }),
    txn({
      id: 'txn-transfer-out',
      accountId: 'sbi-1234',
      date: '2026-10-03',
      amount: -2_000_000,
      kind: 'transfer',
      description: 'Ac xfr',
      category: null,
      transferPairId: 'txn-transfer-in',
    }),
    txn({
      id: 'txn-transfer-in',
      accountId: 'cash',
      date: '2026-10-03',
      amount: 2_000_000,
      kind: 'transfer',
      description: 'Ac xfr',
      category: null,
      transferPairId: 'txn-transfer-out',
    }),
    txn({
      id: 'txn-investment',
      accountId: 'sbi-1234',
      date: '2026-10-03',
      amount: -3_000_000,
      kind: 'investment',
      description: 'INDIAN CLEARING SIP',
      category: 'Investments',
    }),
    txn({
      id: 'txn-emi',
      accountId: 'sbi-1234',
      date: '2026-10-03',
      amount: -800_000,
      kind: 'normal',
      description: 'UBI HOME LOAN EMI',
      category: 'Loan EMI',
    }),
  ]);

  await database.loanEntries.bulkAdd([
    {
      id: 'le-disbursement',
      accountId: 'ubi-loan-1234',
      date: '2026-08-01',
      description: 'Disbursement',
      ref: 'D1',
      kind: 'disbursement',
      amount: 60_000_000,
      outstandingAfter: 60_000_000,
      importId: 'imp-loan',
      fingerprint: 'fp-le-disbursement',
    },
    {
      id: 'le-interest',
      accountId: 'ubi-loan-1234',
      date: '2026-10-01',
      description: 'Interest Sep 2026',
      ref: 'I1',
      kind: 'interest',
      amount: 295_890,
      outstandingAfter: 60_295_890,
      interestFrom: '2026-09-01',
      interestTo: '2026-09-30',
      importId: 'imp-loan',
      fingerprint: 'fp-le-interest',
    },
    {
      id: 'le-emi',
      accountId: 'ubi-loan-1234',
      date: '2026-10-03',
      description: 'EMI Oct 2026',
      ref: 'E1',
      kind: 'emi',
      amount: 800_000,
      outstandingAfter: 59_495_890,
      importId: 'imp-loan',
      fingerprint: 'fp-le-emi',
    },
    {
      id: 'le-prepayment',
      accountId: 'ubi-loan-1234',
      date: '2026-10-15',
      description: 'Prepayment',
      ref: 'P1',
      kind: 'prepayment',
      amount: 5_000_000,
      outstandingAfter: 54_495_890,
      importId: 'imp-loan',
      fingerprint: 'fp-le-prepayment',
    },
  ]);

  await database.loanYears.add({
    accountId: 'ubi-loan-1234',
    fy: 2025,
    interestCharged: 3_000_000,
    principalRepaid: 2_000_000,
    totalPaid: 5_000_000,
    closingOutstanding: 55_000_000,
    importId: 'imp-cert',
  });

  await database.epfEntries.bulkAdd([
    {
      accountId: 'epf-00001',
      fy: 2026,
      kind: 'opening',
      creditDate: '2026-04-01',
      ee: 10_000_000,
      er: 5_000_000,
      eps: 2_000_000,
      importId: 'imp-epf',
    },
    {
      accountId: 'epf-00001',
      fy: 2026,
      kind: 'contribution',
      creditDate: '2026-05-01',
      ee: 1_000_000,
      er: 500_000,
      eps: 200_000,
      importId: 'imp-epf',
    },
    {
      accountId: 'epf-00001',
      fy: 2026,
      kind: 'contribution',
      creditDate: '2026-06-01',
      ee: 1_000_000,
      er: 500_000,
      eps: 200_000,
      importId: 'imp-epf',
    },
    {
      accountId: 'epf-00001',
      fy: 2026,
      kind: 'interest',
      creditDate: '2027-03-31',
      ee: 500_000,
      er: 250_000,
      eps: 0,
      importId: 'imp-epf',
    },
  ]);

  await database.mfFolios.add({
    id: FOLIO,
    folio: 'FOLIO-1',
    amc: 'Test AMC',
    scheme: 'Test Flexi Cap',
    isin: 'INF000000001',
    amfiCode: 123456,
    holdingMode: 'soa',
    units: 20_000,
    asOf: '2026-09-30',
    historyComplete: true,
  });
  await database.mfTxns.add({
    id: 'mf-txn-1',
    folioId: FOLIO,
    date: '2024-10-03',
    description: 'Purchase',
    type: 'purchase',
    amount: 100_000,
    units: 20_000,
    nav: 500_000,
    stampDuty: 0,
    importId: 'imp-cas',
    fingerprint: 'fp-mf-txn-1',
  });
  await database.mfProvisional.add({
    id: 'prov-1',
    bankTxnId: 'txn-investment',
    schemeKey: FOLIO,
    date: '2026-10-01',
    grossPaise: 60_000,
    estUnits: 10_000,
    navDate: '2026-09-30',
    status: 'provisional',
  });

  await setSetting(database, 'equitySymbol', 'ACME');
  await database.prices.bulkAdd([
    { symbol: 'MF:123456', date: '2026-04-01', value: 500_000, source: 'statement' },
    { symbol: 'MF:123456', date: '2026-09-30', value: 605_000, source: 'api' },
    { symbol: 'ACME', date: '2026-08-31', value: 20_000, source: 'api' },
    { symbol: 'ACME', date: '2026-09-30', value: 20_000, source: 'statement' },
    { symbol: 'USDINR', date: '2026-08-31', value: 850_000, source: 'api' },
    { symbol: 'USDINR', date: '2026-09-30', value: 850_000, source: 'api' },
  ]);

  await database.equityLots.bulkAdd([
    {
      id: 'lot-1',
      vestId: null,
      esppPurchaseId: null,
      key: 'G1#1',
      acquiredDate: '2025-01-15',
      netShares: 10,
      remainingShares: 10,
      costPerShareUsdCents: 20_000,
      remainingCostUsdCents: 200_000,
      usdInrOnAcquire: 850_000,
      source: 'RSU',
    },
    {
      id: 'lot-2',
      vestId: null,
      esppPurchaseId: null,
      key: 'ESPP#2026-06-15',
      acquiredDate: '2026-06-15',
      netShares: 5,
      remainingShares: 5,
      costPerShareUsdCents: 22_000,
      remainingCostUsdCents: 110_000,
      usdInrOnAcquire: 850_000,
      source: 'ESPP',
    },
  ]);

  await database.vests.bulkAdd([
    {
      id: 'vest-past',
      grantId: 'grant-1',
      period: 1,
      vestDate: '2025-01-15',
      shares: 10,
      status: 'vested',
      grantNumber: 'G1',
    },
    {
      id: 'vest-next',
      grantId: 'grant-1',
      period: 2,
      vestDate: '2026-11-20',
      shares: 2,
      status: 'unvested',
      grantNumber: 'G1',
    },
    {
      id: 'vest-later',
      grantId: 'grant-1',
      period: 3,
      vestDate: '2027-02-20',
      shares: 1,
      status: 'unvested',
      grantNumber: 'G1',
    },
  ]);

  await setSetting(database, 'lastBackupAt', '2026-10-02');
}

describe('homeSummary', () => {
  it('computes net worth by hand, the month change, as-of date and upcoming items', async () => {
    const summary = await homeSummary(db, TODAY);

    // Liquid 10,00,000 + 5,000; retirement 2,00,000 + 1,80,000; market 1,215 + 2,55,000;
    // liabilities −6,00,000, reported but not subtracted (all rupees in paise below).
    expect(summary.netWorth).toBe(164_181_500);
    expect(summary.groups).toEqual({
      liquid: 100_500_000,
      retirement: 38_000_000,
      market: 25_681_500,
      liabilities: -60_000_000,
    });
    expect(
      summary.groups.liquid +
        summary.groups.retirement +
        summary.groups.market,
    ).toBe(summary.netWorth);

    // Same day last month: bank 9,60,000; MF 1,000 at the April NAV; loan 6,20,000.
    expect(summary.change.amount).toBe(4_081_500);
    expect(summary.change.pct).toBeCloseTo((4_081_500 / 160_100_000) * 100, 10);
    expect(summary.asOf).toBe('2026-09-30');
    expect(summary.unvestedInr).toBe(5_100_000);
    expect(summary.attention).toEqual([]);

    expect(summary.upcoming.vest).toEqual({ date: '2026-11-20', shares: 2, value: 3_400_000 });
    expect(summary.upcoming.emiDate).toBe('2026-11-03');
    expect(summary.upcoming.ppfReminder?.dueDate).toBe('2026-10-05');
  });

  it('excludes a paired transfer and an investment debit from this month', async () => {
    const summary = await homeSummary(db, TODAY);

    // Salary credit only; the paired +₹20,000 transfer credit is not income.
    expect(summary.thisMonth.income).toBe(10_000_000);
    // Rent ₹15,000 + groceries ₹5,000 + the EMI's interest part ₹2,958.90; the −₹20,000
    // transfer and the −₹30,000 investment debit are not spending.
    expect(summary.thisMonth.spending).toBe(2_295_890);
    expect(summary.thisMonth.savingsRatePct).toBeCloseTo(77.0411, 6);
    expect(summary.thisMonth.topCategories).toEqual([
      { category: 'Rent', amount: 1_500_000 },
      { category: 'Groceries', amount: 500_000 },
      { category: 'Loan EMI', amount: 295_890 },
    ]);
  });

  it('splits the EMI debit: the September interest is spending, the principal is not', async () => {
    const october = await cashFlowMonth(db, '2026-10');
    const emi = october.transactions.find((row) => row.id === 'txn-emi');
    expect(emi?.amount).toBe(-800_000);
    // Without the split the EMI alone would add ₹8,000 of spending.
    expect(october.spending).toBe(2_295_890);
    expect(october.categories.find((row) => row.category === 'Loan EMI')?.amount).toBe(295_890);
  });

  it('flags a 40-day-old bank statement through needsAttention', async () => {
    await db.accounts.add(
      account({ id: 'sbi-old', kind: 'savings', institution: 'SBI', name: 'Old SBI', maskedNumber: '9999' }),
    );
    await db.balanceSnapshots.add(snapshot('sbi-old', '2026-08-24', 1));

    const summary = await homeSummary(db, TODAY);
    expect(summary.attention.map((item) => item.id)).toEqual(['stale-bank:sbi-old']);
    expect(summary.attention[0]).toMatchObject({ kind: 'stale-bank', target: '/accounts/sbi-old' });
  });

  it('flags a stale EPF passbook, but not one whose balance was transferred out', async () => {
    await db.accounts.bulkAdd([
      account({ id: 'epf-old', kind: 'epf', institution: 'EPFO', name: 'Old Corp EPF', maskedNumber: 'OLD01', meta: {} }),
      account({ id: 'epf-live', kind: 'epf', institution: 'EPFO', name: 'Live Corp EPF', maskedNumber: 'LIV01', meta: {} }),
    ]);
    await db.balanceSnapshots.bulkAdd([snapshot('epf-old', '2020-03-31', 1), snapshot('epf-live', '2020-03-31', 1)]);

    const before = await homeSummary(db, TODAY);
    expect(before.attention.map((item) => item.id)).toEqual(['stale-epf:epf-live', 'stale-epf:epf-old']);

    await db.epfEntries.add({
      accountId: 'epf-old',
      fy: 2020,
      kind: 'transferOut',
      creditDate: '2020-04-01',
      ee: -1,
      er: 0,
      eps: 0,
      inferred: true,
      importId: 'imp-epf',
    });

    const after = await homeSummary(db, TODAY);
    expect(after.attention.map((item) => item.id)).toEqual(['stale-epf:epf-live']);
  });
});

describe('buildNetWorthInputs', () => {
  it('builds every component from the stored rows', async () => {
    const inputs = await buildNetWorthInputs(db);

    expect(inputs.banks.map((series) => series.accountId)).toEqual(['sbi-1234']);
    expect(inputs.banks[0]?.snapshots).toEqual([
      { date: '2026-08-31', balance: 96_000_000 },
      { date: '2026-09-30', balance: 100_000_000 },
    ]);
    expect(inputs.cash.map((series) => series.accountId)).toEqual(['cash']);
    expect(inputs.ppf.map((series) => series.accountId)).toEqual(['sbi-ppf']);

    expect(inputs.epfTotals).toHaveLength(1);
    expect(inputs.epfTotals[0]?.accountId).toBe('epf-00001');
    expect(inputs.epfTotals[0]?.at('2026-10-03')).toBe(18_000_000);
    expect(inputs.epfTotals[0]?.at('2026-04-15')).toBe(15_000_000);
    expect(inputs.epfTotals[0]?.at('2026-03-01')).toBe(0);

    // Confirmed 20 units at ₹60.5 plus 10 provisional units at ₹60.5.
    expect(inputs.mf('2026-10-03')).toBe(181_500);
    // Before the provisional and at the April NAV of ₹50.
    expect(inputs.mf('2026-09-03')).toBe(100_000);

    expect(inputs.equity.lots).toEqual([
      { acquiredDate: '2025-01-15', remainingShares: 10 },
      { acquiredDate: '2026-06-15', remainingShares: 5 },
    ]);
    expect(inputs.equity.acme).toHaveLength(2);
    expect(inputs.equity.usdInr).toHaveLength(2);

    expect(inputs.loanOutstanding('2026-10-03')).toBe(60_000_000);
    expect(inputs.loanOutstanding('2026-09-03')).toBe(62_000_000);
  });

  it('falls back to loan entries and interpolated certificate points without snapshots', async () => {
    await db.balanceSnapshots.where('accountId').equals('ubi-loan-1234').delete();
    const inputs = await buildNetWorthInputs(db);

    expect(inputs.loanOutstanding('2026-03-31')).toBe(55_000_000); // certificate 31-Mar point
    expect(inputs.loanOutstanding('2026-01-01')).toBe(55_000_000); // clamped before the first point
    expect(inputs.loanOutstanding('2026-08-01')).toBe(60_000_000); // disbursement entry
    expect(inputs.loanOutstanding('2026-10-31')).toBe(54_495_890); // last entry
    const span = daysBetween('2026-03-31', '2026-08-01');
    const expected = Math.round(
      55_000_000 + (5_000_000 * daysBetween('2026-03-31', '2026-05-31')) / span,
    );
    expect(inputs.loanOutstanding('2026-05-31')).toBe(expected);
  });
});

describe('netWorthTrend', () => {
  it('returns month-end points for 12M, 3Y and All', async () => {
    const twelve = await netWorthTrend(db, '12M', TODAY);
    expect(twelve.map((point) => point.date)).toEqual([
      '2025-11-30',
      '2025-12-31',
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-03',
    ]);
    // 30 Sep: bank 10,00,000 + cash 5,000 + PPF 2,00,000 + EPF 1,80,000
    // + MF 1,215 + equity 2,55,000 (the 6,00,000 loan is not subtracted).
    expect(twelve[10]).toEqual({ date: '2026-09-30', total: 164_121_000 });
    expect(twelve[11]).toEqual({ date: '2026-10-03', total: 164_181_500 });

    const threeYears = await netWorthTrend(db, '3Y', TODAY);
    expect(threeYears).toHaveLength(36);
    expect(threeYears[0]?.date).toBe('2023-11-30');
    expect(threeYears[35]).toEqual({ date: TODAY, total: 164_181_500 });

    // "All" starts at the earliest stored point: the April 2026 MF NAV.
    const all = await netWorthTrend(db, 'All', TODAY);
    expect(all.map((point) => point.date)).toEqual([
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-03',
    ]);
  });
});

describe('cashFlowMonth', () => {
  it('returns income, spending, sorted categories and the transaction list', async () => {
    const october = await cashFlowMonth(db, '2026-10');

    expect(october.month).toBe('2026-10');
    expect(october.income).toBe(10_000_000);
    expect(october.spending).toBe(2_295_890);
    expect(october.categories).toEqual([
      { category: 'Rent', amount: 1_500_000 },
      { category: 'Groceries', amount: 500_000 },
      { category: 'Loan EMI', amount: 295_890 },
    ]);
    expect(october.transactions.map((row) => row.id)).toEqual([
      'txn-salary',
      'txn-groceries',
      'txn-rent',
      'txn-emi',
      'txn-investment',
      'txn-transfer-in',
      'txn-transfer-out',
    ]);

    const september = await cashFlowMonth(db, '2026-09');
    expect(september.income).toBe(0);
    expect(september.spending).toBe(0);
    expect(september.categories).toEqual([]);
    expect(september.transactions).toEqual([]);
  });
});

describe('mfSummary', () => {
  it('reports per-scheme and portfolio units, cost, value, gain and XIRR', async () => {
    const summary = await mfSummary(db, TODAY);

    expect(summary.schemes).toHaveLength(1);
    expect(summary.schemes[0]).toMatchObject({
      folioId: FOLIO,
      scheme: 'Test Flexi Cap',
      isin: 'INF000000001',
      amfiCode: 123456,
      units: 20_000,
      invested: 100_000,
      value: 121_000,
      gain: 21_000,
      nav: 605_000,
      navDate: '2026-09-30',
    });
    // ₹1,000 for 20 units two years ago, now ₹1,210 → exactly 10% a year.
    expect(summary.schemes[0]?.xirr).toBeCloseTo(0.1, 6);
    expect(summary.portfolio).toMatchObject({ invested: 100_000, value: 121_000, gain: 21_000 });
    expect(summary.portfolio.xirr).toBeCloseTo(0.1, 6);
    expect(summary.provisionals.map((row) => row.id)).toEqual(['prov-1']);
  });
});

describe('loanSummary', () => {
  it('reports history, per-FY interest/principal, rates, undisbursed and prepayments', async () => {
    const summary = await loanSummary(db);

    expect(summary.sanctioned).toBe(100_000_000);
    expect(summary.emi).toBe(800_000);
    expect(summary.disbursed).toBe(60_000_000);
    expect(summary.undisbursed).toBe(40_000_000);

    expect(summary.outstandingHistory).toContainEqual({ date: '2026-09-30', outstanding: 60_000_000 });
    expect(summary.outstandingHistory).toContainEqual({ date: '2026-10-15', outstanding: 54_495_890 });

    // Interest derived from the September row: 2,95,890 × 365 × 100 / (30 × 6,00,00,000).
    expect(summary.rateHistory).toEqual([{ from: '2026-10-01', ratePct: 6 }]);
    expect(summary.planningRate).toBe(6);

    // FY2026 comes from entries: EMI 8,000 + prepayment 50,000 − interest 2,958.90.
    expect(summary.years.find((year) => year.fy === 2026)).toEqual({
      fy: 2026,
      interest: 295_890,
      principal: 5_504_110,
      source: 'entries',
    });
    // FY2025 has no entries, so the certificate's loanYears row is used.
    expect(summary.years.find((year) => year.fy === 2025)).toEqual({
      fy: 2025,
      interest: 3_000_000,
      principal: 2_000_000,
      source: 'certificate',
    });

    expect(summary.prepayments).toEqual([
      { id: 'le-prepayment', date: '2026-10-15', amount: 5_000_000, description: 'Prepayment' },
    ]);
  });
});

describe('epfSummary', () => {
  it('reports the as-of balance, EE/ER/EPS split and contribution history', async () => {
    const summary = await epfSummary(db);

    expect(summary.accounts).toHaveLength(1);
    expect(summary.accounts[0]).toMatchObject({
      accountId: 'epf-00001',
      name: 'Test Corp EPF',
      asOf: '2027-03-31',
      balance: { ee: 12_500_000, er: 6_250_000, eps: 2_400_000, total: 18_750_000 },
    });
    expect(summary.accounts[0]?.contributions).toEqual([
      { date: '2026-05-01', ee: 1_000_000, er: 500_000, eps: 200_000 },
      { date: '2026-06-01', ee: 1_000_000, er: 500_000, eps: 200_000 },
    ]);
    expect(summary.totals).toEqual({ ee: 12_500_000, er: 6_250_000, eps: 2_400_000, total: 18_750_000 });
  });
});

describe('equitySummary', () => {
  it('reports released and unvested value, the vest timeline, lots and ESPP purchases', async () => {
    const summary = await equitySummary(db, TODAY);

    expect(summary.releasedShares).toBe(15);
    expect(summary.valueInr).toBe(25_500_000); // 15 × $200 × ₹85
    expect(summary.unvestedShares).toBe(3);
    expect(summary.unvestedValueInr).toBe(5_100_000); // 3 × $200 × ₹85
    expect(summary.priceUsdCents).toBe(20_000);
    expect(summary.priceDate).toBe('2026-09-30');
    expect(summary.usdInr).toBe(850_000);
    expect(summary.upcoming).toEqual({ date: '2026-11-20', shares: 2, valueInr: 3_400_000 });
    expect(summary.lots.map((lot) => [lot.id, lot.gainInr])).toEqual([
      ['lot-1', 0],
      ['lot-2', -850_000], // bought ESPP at $220, now $200
    ]);
    expect(summary.esppLots.map((lot) => lot.id)).toEqual(['lot-2']);
    expect(summary.vests).toHaveLength(3);
    expect(summary.vests.find((vest) => vest.id === 'vest-next')).toMatchObject({
      vestDate: '2026-11-20',
      shares: 2,
      status: 'unvested',
      valueInr: 3_400_000,
    });
  });
});
