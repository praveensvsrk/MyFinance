import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb, type TxnRow } from '../../src/db/schema';
import { dismissRecurring, restoreRecurring } from '../../src/services/actions/recurring';
import { recurringPayee, recurringPayments } from '../../src/services/recurring';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-recurring-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function txn(id: string, date: string, description: string, amount: number, extra: Partial<TxnRow> = {}): TxnRow {
  return {
    id,
    accountId: 'sbi',
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
    ...extra,
  };
}

describe('recurringPayee', () => {
  it('keys on the UPI payee, and drops numbers that change every month', () => {
    expect(recurringPayee('WDL TFR UPI/DR/612345678901/NETFLIX/YESB/netflix@ybl/Pay')).toBe('NETFLIX');
    expect(recurringPayee('NACH DR HDFC LIFE 48213')).toBe(recurringPayee('NACH DR HDFC LIFE 51990'));
  });
});

describe('recurringPayments', () => {
  beforeEach(async () => {
    await db.transactions.bulkAdd([
      txn('n1', '2026-07-07', 'UPI/612345678901/NETFLIX/sub/4899', -649_00, { category: 'Subscriptions' }),
      txn('n2', '2026-08-07', 'UPI/612345678902/NETFLIX/sub/4899', -649_00, { category: 'Subscriptions' }),
      txn('n3', '2026-09-07', 'UPI/612345678903/NETFLIX/sub/4899', -649_00, { category: 'Subscriptions' }),
      txn('h1', '2026-07-03', 'NACH DR HDFC LIFE 48213', -2_000_00),
      txn('h2', '2026-08-03', 'NACH DR HDFC LIFE 51990', -2_000_00),
      txn('h3', '2026-09-03', 'NACH DR HDFC LIFE 53012', -2_000_00),
      // A monthly move to your own card is a transfer, not a payment.
      txn('c1', '2026-07-10', 'CARD BILL PAYMENT', -10_000_00, { kind: 'transfer' }),
      txn('c2', '2026-08-10', 'CARD BILL PAYMENT', -10_000_00, { kind: 'transfer' }),
      txn('c3', '2026-09-10', 'CARD BILL PAYMENT', -10_000_00, { kind: 'transfer' }),
      // Salary comes in monthly but is not a payment.
      txn('s1', '2026-07-01', 'SALARY ACME', 1_00_000_00),
      txn('s2', '2026-08-01', 'SALARY ACME', 1_00_000_00),
      txn('s3', '2026-09-01', 'SALARY ACME', 1_00_000_00),
    ]);
  });

  it('finds monthly payments out, leaving out transfers and money in', async () => {
    const summary = await recurringPayments(db, '2026-10-01');
    expect(summary.items.map((item) => [item.payee, item.next])).toEqual([
      ['NACH DR HDFC LIFE', '2026-10-03'],
      ['NETFLIX', '2026-10-07'],
    ]);
    expect(summary.perMonth).toBe(2_649_00);
    expect(summary.hidden).toBe(0);
  });

  it('hides a payee the user says is not recurring, and brings it back', async () => {
    await dismissRecurring(db, 'NETFLIX');
    await dismissRecurring(db, 'NETFLIX');
    let summary = await recurringPayments(db, '2026-10-01');
    expect(summary.items.map((item) => item.payee)).toEqual(['NACH DR HDFC LIFE']);
    expect(summary.perMonth).toBe(2_000_00);
    expect(summary.hidden).toBe(1);
    await restoreRecurring(db);
    summary = await recurringPayments(db, '2026-10-01');
    expect(summary.items).toHaveLength(2);
  });

  it('is empty without transactions', async () => {
    await db.transactions.clear();
    expect(await recurringPayments(db, '2026-10-01')).toEqual({ items: [], perMonth: 0, hidden: 0 });
  });
});
