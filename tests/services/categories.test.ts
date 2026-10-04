import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb, type TxnRow } from '../../src/db/schema';
import {
  addCategory,
  backfillFamily,
  deleteCategory,
  getCategoryConfig,
  setCategoryExcluded,
} from '../../src/services/actions/categories';

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
