import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb } from '../../src/db/schema';
import { latestSnapshot } from '../../src/db/repos';
import { saveManualAccount } from '../../src/services/actions/manualAccount';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-manual-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('saveManualAccount', () => {
  it('creates a savings account with a snapshot', async () => {
    const id = await saveManualAccount(db, {
      kind: 'savings',
      institution: 'HDFC',
      maskedNumber: '1234',
      balance: 25_000_00,
      date: '2026-10-01',
    });
    expect(id).toBe('hdfc-1234');
    const account = await db.accounts.get(id);
    expect(account).toMatchObject({ kind: 'savings', name: 'HDFC Savings', meta: { source: 'manual' } });
    expect((await latestSnapshot(db, id))?.balance).toBe(25_000_00);
  });

  it('stores a card balance as amount owed (negative)', async () => {
    const id = await saveManualAccount(db, {
      kind: 'card',
      institution: 'Axis',
      maskedNumber: '7788',
      balance: 8_000_00,
      date: '2026-10-01',
    });
    expect(id).toBe('axis-card-7788');
    expect((await latestSnapshot(db, id))?.balance).toBe(-8_000_00);
  });
});
