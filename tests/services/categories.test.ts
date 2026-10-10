import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb, type LoanEntryRow, type TxnRow } from '../../src/db/schema';
import {
  addCategory,
  backfillFamily,
  refileDefaults,
  deleteCategory,
  getCategoryConfig,
  setCategoryExcluded,
} from '../../src/services/actions/categories';
import { fileLoanEmis } from '../../src/services/loanEmis';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-categories-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function txn(id: string, description: string, overrides: Partial<TxnRow> = {}): TxnRow {
  return {
    id,
    accountId: 'sbi-1',
    date: '2026-09-10',
    description,
    ref: '',
    amount: -50000,
    balanceAfter: 0,
    category: 'Other',
    categorySource: 'default',
    kind: 'normal',
    transferPairId: null,
    importId: 'imp-1',
    fingerprint: `fp-${id}`,
    ...overrides,
  };
}

describe('category config', () => {
  it('starts with Family excluded and no custom categories', async () => {
    expect(await getCategoryConfig(db)).toEqual({ custom: [], excluded: ['Family'] });
  });

  it('adds a custom category, optionally excluded, and refuses empty or duplicate names', async () => {
    expect(await addCategory(db, '  Parents   support ', true)).toBe('Parents support');
    expect(await addCategory(db, 'Hobbies', false)).toBe('Hobbies');
    expect(await addCategory(db, 'parents support', false)).toBeNull();
    expect(await addCategory(db, 'rent', false)).toBeNull();
    expect(await addCategory(db, '   ', false)).toBeNull();
    expect(await getCategoryConfig(db)).toEqual({
      custom: ['Parents support', 'Hobbies'],
      excluded: ['Family', 'Parents support'],
    });
  });

  it('toggles exclusion on any category', async () => {
    await setCategoryExcluded(db, 'Family', false);
    await setCategoryExcluded(db, 'Rent', true);
    await setCategoryExcluded(db, 'Rent', true);
    expect((await getCategoryConfig(db)).excluded).toEqual(['Rent']);
  });

  it('deletes a custom category, its rules and its flag, and re-files its rows', async () => {
    await addCategory(db, 'Parents support', true);
    await db.rules.add({ id: 'r1', pattern: 'ZZZ', isRegex: false, category: 'Parents support', priority: 1 });
    await db.transactions.bulkAdd([
      txn('a', 'ZZZ monthly', { category: 'Parents support', categorySource: 'rule' }),
      txn('b', 'Transfer to Family or Friends', { category: 'Parents support', categorySource: 'manual' }),
    ]);

    await deleteCategory(db, 'Parents support');

    expect(await getCategoryConfig(db)).toEqual({ custom: [], excluded: ['Family'] });
    expect(await db.rules.count()).toBe(0);
    expect((await db.transactions.get('a'))?.category).toBe('Other');
    expect((await db.transactions.get('b'))?.category).toBe('Family');
  });

  it('never deletes a built-in category', async () => {
    await deleteCategory(db, 'Rent');
    expect((await getCategoryConfig(db)).excluded).toEqual(['Family']);
  });
});

describe('backfillFamily', () => {
  it('files default-categorised Transfer to Family rows once and leaves hand-filed rows alone', async () => {
    await db.transactions.bulkAdd([
      txn('a', 'WDL TFR SBIY1/M/ Transfer to Family or 0062 OF Mrs. X'),
      txn('b', 'WDL TFR SBIY2/M/ Transfer to Family or 0062 OF Mrs. X', { category: 'Rent', categorySource: 'manual' }),
      txn('c', 'WDL TFR SBIY3/M/ Transfer to Family or 0062 OF Mrs. X', { category: 'Rent', categorySource: 'rule' }),
      txn('d', 'UPIOUT/1/SWIGGY/x/5814'),
    ]);

    expect(await backfillFamily(db)).toBe(1);
    expect((await db.transactions.get('a'))?.category).toBe('Family');
    expect((await db.transactions.get('b'))?.category).toBe('Rent');
    expect((await db.transactions.get('c'))?.category).toBe('Rent');
    expect((await db.transactions.get('d'))?.category).toBe('Other');

    await db.transactions.add(txn('e', 'Transfer to Family or Friends'));
    expect(await backfillFamily(db)).toBe(0);
    expect((await db.transactions.get('e'))?.category).toBe('Other');
  });
});

describe('refileDefaults', () => {
  const sbiUpi = (payee: string): string => `WDL TFR UPI/DR/512345678901/${payee}/YESB/x.pay/661`;

  it('re-files rows left on Other by an older categoriser, once, and leaves chosen rows alone', async () => {
    await db.rules.add({ id: 'old', pattern: 'WDL TFR UPI DR ACME TOYS YESB X.PAY 661', isRegex: false, category: 'Gifts', priority: 10 });
    await db.transactions.bulkAdd([
      txn('swiggy', sbiUpi('SWIGGY')),
      txn('toys', sbiUpi('ACME TOYS')),
      txn('groww', sbiUpi('GROWW')),
      txn('manual', sbiUpi('ZOMATO'), { categorySource: 'manual' }),
      txn('transfer', sbiUpi('AMAZON'), { kind: 'transfer', category: null }),
      txn('mcc', 'UPIOUT/123456789012/AMAZON/x/5411', { category: 'Groceries' }),
      txn('person', sbiUpi('JANE DOE')),
    ]);

    expect(await refileDefaults(db)).toBe(3);
    expect(await db.transactions.get('swiggy')).toMatchObject({ category: 'Food delivery', categorySource: 'default', kind: 'normal' });
    expect(await db.transactions.get('toys')).toMatchObject({ category: 'Gifts', categorySource: 'rule' });
    expect(await db.transactions.get('groww')).toMatchObject({ category: 'Investments', kind: 'investment' });
    expect(await db.mfProvisional.where('bankTxnId').equals('groww').count()).toBe(1);
    expect(await db.transactions.get('manual')).toMatchObject({ category: 'Other' });
    expect(await db.transactions.get('transfer')).toMatchObject({ category: null, kind: 'transfer' });
    expect(await db.transactions.get('mcc')).toMatchObject({ category: 'Groceries' });
    expect(await db.transactions.get('person')).toMatchObject({ category: 'Other' });

    await db.transactions.add(txn('later', sbiUpi('ZOMATO')));
    expect(await refileDefaults(db)).toBe(0);
    expect((await db.transactions.get('later'))?.category).toBe('Other');
  });
});

describe('fileLoanEmis', () => {
  const emi = (id: string, date: string, amount: number): LoanEntryRow => ({
    id,
    accountId: 'loan-1',
    date,
    description: 'EMI',
    ref: '',
    kind: 'emi',
    amount,
    outstandingAfter: 0,
    importId: 'imp-loan',
    fingerprint: `fp-${id}`,
  });

  it('files a debit paying a loan EMI near its date, and nothing else', async () => {
    await db.loanEntries.bulkAdd([emi('e1', '2026-09-05', 7_978_700), emi('e2', '2026-09-20', 7_978_700)]);
    await db.transactions.bulkAdd([
      txn('ach', 'ACH D- UNIONBANKOFIND 1234567', { date: '2026-09-07', amount: -8_000_000 }),
      txn('far', 'ACH D- UNIONBANKOFIND 1234568', { date: '2026-11-07', amount: -8_000_000 }),
      txn('off', 'ACH D- UNIONBANKOFIND 1234569', { date: '2026-09-07', amount: -9_000_000 }),
      txn('mine', 'ACH D- UNIONBANKOFIND 1234570', { date: '2026-09-07', amount: -8_000_000, categorySource: 'manual' }),
      txn('credit', 'ACH CR UNIONBANKOFIND', { date: '2026-09-07', amount: 8_000_000 }),
    ]);

    expect(await fileLoanEmis(db)).toBe(1);
    expect(await db.transactions.get('ach')).toMatchObject({ category: 'Loan EMI', categorySource: 'default' });
    for (const id of ['far', 'off', 'mine', 'credit']) {
      expect((await db.transactions.get(id))?.category, id).toBe('Other');
    }
  });

  it('runs as part of the re-file', async () => {
    await db.loanEntries.add(emi('e1', '2026-09-05', 7_978_700));
    await db.transactions.add(txn('ach', 'ACH D- UNIONBANKOFIND 1234567', { date: '2026-09-07', amount: -8_000_000 }));
    expect(await refileDefaults(db)).toBe(1);
    expect((await db.transactions.get('ach'))?.category).toBe('Loan EMI');
  });
});
