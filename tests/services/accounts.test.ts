import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb, type AccountRow, type SnapshotRow, type TxnRow } from '../../src/db/schema';
import { accountDetail, accountList } from '../../src/services/accounts';
import { netWorthBreakdown } from '../../src/services/netWorthBreakdown';

const TODAY = '2026-10-03';
const FOLIO = 'folio-1|INF000000001';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-accounts-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
  await seed(db);
});

afterEach(async () => {
  await db.delete();
});

function account(overrides: Partial<AccountRow> & Pick<AccountRow, 'id' | 'kind'>): AccountRow {
  return { institution: 'Test', maskedNumber: '', name: overrides.id, meta: {}, ...overrides };
}

function snapshot(accountId: string, date: string, balance: number): SnapshotRow {
  return { accountId, date, balance, source: 'statement', importId: null };
}

function txn(id: string, date: string, amount: number, description: string): TxnRow {
  return {
    id,
    accountId: 'sbi-1234',
    date,
    amount,
    kind: 'normal',
    description,
    ref: '',
    balanceAfter: 0,
    category: 'Other',
    categorySource: 'default',
    transferPairId: null,
    importId: 'imp-1',
    fingerprint: `fp-${id}`,
  };
}

/** A bank, cash, PPF, a loan, EPF and one MF scheme. All figures are synthetic. */
async function seed(database: FinanceDb): Promise<void> {
  await database.accounts.bulkAdd([
    account({ id: 'sbi-1234', kind: 'savings', institution: 'SBI', name: 'SBI Savings', maskedNumber: '1234' }),
    account({ id: 'cash', kind: 'cash', institution: 'Cash', name: 'Cash' }),
    account({ id: 'sbi-ppf', kind: 'ppf', institution: 'SBI', name: 'SBI PPF' }),
    account({
      id: 'ubi-loan-1234',
      kind: 'loan',
      institution: 'UBI',
      name: 'UBI Home Loan',
      meta: { sanctioned: 100_000_000, releaseDate: '2026-08-01', bankEmi: 800_000 },
    }),
    account({
      id: 'epf-00001',
      kind: 'epf',
      institution: 'EPFO',
      name: 'Test Corp EPF',
      meta: { memberId: 'TEST00001', establishmentName: 'Test Corp' },
    }),
    account({ id: 'mf-cas', kind: 'mf', institution: 'CAS', name: 'Mutual funds' }),
  ]);
  await database.balanceSnapshots.bulkAdd([
    snapshot('sbi-1234', '2026-08-31', 96_000_000),
    snapshot('sbi-1234', '2026-09-30', 100_000_000),
    snapshot('cash', '2026-09-30', 500_000),
    snapshot('sbi-ppf', '2026-09-30', 20_000_000),
  ]);
  await database.transactions.bulkAdd([
    txn('t1', '2026-09-10', -500_000, 'UPI/GROCERY'),
    txn('t2', '2026-09-11', -1_500_000, 'UPI/RENT'),
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
      id: 'le-emi',
      accountId: 'ubi-loan-1234',
      date: '2026-10-03',
      description: 'EMI Oct 2026',
      ref: 'E1',
      kind: 'emi',
      amount: 800_000,
      outstandingAfter: 59_200_000,
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
      outstandingAfter: 54_200_000,
      importId: 'imp-loan',
      fingerprint: 'fp-le-prepayment',
    },
  ]);
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
  await database.prices.bulkAdd([
    { symbol: 'MF:123456', date: '2024-10-03', value: 500_000, source: 'statement' },
    { symbol: 'MF:123456', date: '2026-09-30', value: 605_000, source: 'api' },
  ]);
}

describe('accountList', () => {
  it('groups every kind with a signed balance and as-of date', async () => {
    const list = await accountList(db, TODAY);
    const byId = new Map(list.map((item) => [item.id, item]));
    expect(byId.get('sbi-1234')).toMatchObject({ group: 'Banks', balance: 100_000_000, asOf: '2026-09-30', stale: false });
    expect(byId.get('cash')).toMatchObject({ group: 'Cash', balance: 500_000 });
    expect(byId.get('sbi-ppf')).toMatchObject({ group: 'Retirement', balance: 20_000_000 });
    expect(byId.get('epf-00001')).toMatchObject({ group: 'Retirement' });
    expect(byId.get('mf-cas')).toMatchObject({ group: 'Market', asOf: '2026-09-30' });
    expect(byId.get('mf-cas')?.balance).toBeGreaterThan(0);
  });

  it('shows the loan as negative using only entries up to today', async () => {
    const loan = (await accountList(db, TODAY)).find((item) => item.id === 'ubi-loan-1234');
    expect(loan).toMatchObject({ group: 'Loan', balance: -59_200_000, asOf: '2026-10-03' });
  });

  it('marks a bank account stale once its statement is old', async () => {
    const bank = (await accountList(db, '2026-12-31')).find((item) => item.id === 'sbi-1234');
    expect(bank?.stale).toBe(true);
  });

  it('orders by kind then name', async () => {
    const kinds = (await accountList(db, TODAY)).map((item) => item.kind);
    expect(kinds).toEqual(['savings', 'ppf', 'epf', 'mf', 'loan', 'cash']);
  });
});

describe('accountDetail', () => {
  it('returns snapshot history and transactions for a bank account, with search', async () => {
    const detail = await accountDetail(db, 'sbi-1234', {}, TODAY);
    expect(detail?.history.map((point) => point.balance)).toEqual([96_000_000, 100_000_000]);
    expect(detail?.txns).toHaveLength(2);
    const searched = await accountDetail(db, 'sbi-1234', { search: 'rent' }, TODAY);
    expect(searched?.txns.map((row) => row.id)).toEqual(['t2']);
  });

  it('replays MF value month by month and has no transactions', async () => {
    const detail = await accountDetail(db, 'mf-cas', {}, TODAY);
    expect(detail?.txns).toEqual([]);
    expect(detail?.history.length).toBeGreaterThan(1);
    const last = detail?.history[detail.history.length - 1];
    expect(last !== undefined && last.date <= TODAY).toBe(true);
  });

  it('gives a negative loan history and null for an unknown account', async () => {
    const detail = await accountDetail(db, 'ubi-loan-1234', {}, TODAY);
    expect(detail?.history.every((point) => point.balance <= 0)).toBe(true);
    expect(detail?.history.some((point) => point.date > TODAY)).toBe(false);
    expect(await accountDetail(db, 'nope', {}, TODAY)).toBeNull();
  });
});

describe('netWorthBreakdown', () => {
  it('gives mutual funds as one row, without a per-scheme breakup', async () => {
    const breakdown = await netWorthBreakdown(db, TODAY);
    const mf = breakdown.market.find((row) => row.kind === 'mf');
    expect(mf?.label).toBe('Mutual funds');
    expect(mf).not.toHaveProperty('parts');
  });
});
