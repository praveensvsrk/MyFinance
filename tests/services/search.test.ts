import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb, type TxnRow } from '../../src/db/schema';
import { searchTransactions } from '../../src/services/search';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-search-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function txn(id: string, accountId: string, date: string, description: string, amount: number): TxnRow {
  return {
    id,
    accountId,
    date,
    description,
    ref: '',
    amount,
    balanceAfter: 0,
    category: null,
    categorySource: null,
    kind: 'normal',
    transferPairId: null,
    importId: 'imp',
    fingerprint: `fp-${id}`,
  };
}

describe('searchTransactions', () => {
  beforeEach(async () => {
    await db.accounts.bulkAdd([
      { id: 'sbi', kind: 'savings', institution: 'SBI', name: 'SBI Savings', maskedNumber: '', meta: {} },
      { id: 'card', kind: 'card', institution: 'HDFC', name: 'HDFC Card', maskedNumber: '', meta: {} },
    ]);
    await db.transactions.bulkAdd([
      txn('a', 'sbi', '2025-01-05', 'UPI/1/SWIGGY/food', -300_00),
      txn('b', 'card', '2026-09-10', 'SWIGGY BANGALORE', -450_00),
      txn('c', 'sbi', '2026-09-12', 'SWIGGY REFUND', 100_00),
      txn('d', 'sbi', '2026-09-12', 'RENT SEPTEMBER', -25_000_00),
    ]);
  });

  it('finds matches in every account and month, newest first, with totals', async () => {
    const result = await searchTransactions(db, 'swiggy');
    expect(result.matches.map((row) => row.id)).toEqual(['c', 'b', 'a']);
    expect(result.count).toBe(3);
    expect(result.out).toBe(750_00);
    expect(result.in).toBe(100_00);
    expect(result.accountNames).toEqual({ sbi: 'SBI Savings', card: 'HDFC Card' });
  });

  it('caps the rows but not the count or totals', async () => {
    const result = await searchTransactions(db, 'swiggy', 2);
    expect(result.matches.map((row) => row.id)).toEqual(['c', 'b']);
    expect(result.count).toBe(3);
    expect(result.out).toBe(750_00);
  });

  it('finds nothing for an empty query', async () => {
    expect((await searchTransactions(db, '')).count).toBe(0);
  });
});
