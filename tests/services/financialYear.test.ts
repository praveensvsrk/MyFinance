import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb, type TxnRow } from '../../src/db/schema';
import { yearView } from '../../src/services/financialYear';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-year-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function txn(id: string, date: string, amount: number, extra: Partial<TxnRow> = {}): TxnRow {
  return {
    id,
    accountId: 'sbi',
    date,
    description: 'UPI',
    ref: '',
    amount,
    balanceAfter: 0,
    category: amount > 0 ? 'Salary' : 'Groceries',
    categorySource: 'default',
    kind: 'normal',
    transferPairId: null,
    importId: 'imp',
    fingerprint: id,
    ...extra,
  };
}

describe('yearView', () => {
  it('compares the year so far with the same dates last year, and stops mid-month', async () => {
    await db.accounts.add({ id: 'sbi', kind: 'savings', institution: 'SBI', name: 'SBI', maskedNumber: '', meta: {} });
    await db.transactions.bulkAdd([
      txn('now-pay', '2026-05-01', 50_000_00),
      txn('now-spend', '2026-10-03', -1_000_00),
      txn('now-late', '2026-10-20', -9_000_00),
      txn('then-pay', '2025-05-01', 40_000_00),
      txn('then-spend', '2025-10-03', -500_00),
      txn('then-late', '2025-10-20', -8_000_00),
    ]);

    const view = await yearView(db, 2026, '2026-10-04');
    expect(view.partial).toBe(true);
    expect(view.to).toBe('2026-10-04');
    expect(view.current.income).toBe(50_000_00);
    expect(view.current.spending).toBe(1_000_00);
    expect(view.previous.income).toBe(40_000_00);
    expect(view.previous.spending).toBe(500_00);
    expect(view.categories.map((row) => row.category)).toEqual(['Groceries']);
    expect(view.categories[0]).toMatchObject({ amount: 1_000_00, previous: 500_00 });
  });
});
