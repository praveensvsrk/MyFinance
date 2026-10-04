import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_DATA_SETTING } from '../../src/config';
import { FinanceDb } from '../../src/db/schema';
import { getSetting } from '../../src/db/repos';
import { todayIso } from '../../src/domain/dates';
import { clearAllData, loadSampleData } from '../../src/services/actions/sample';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-sample-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('sample data', () => {
  it('loads the demo person and marks it as sample data', async () => {
    await loadSampleData(db);
    expect(await db.accounts.count()).toBeGreaterThan(5);
    expect(await db.transactions.count()).toBeGreaterThan(50);
    expect(await getSetting(db, SAMPLE_DATA_SETTING, false)).toBe(true);
    expect(await db.accounts.get('sbi-4821')).toMatchObject({ kind: 'savings', institution: 'SBI' });
    expect(await db.accounts.get('home')).toMatchObject({ kind: 'property' });
    expect(await getSetting(db, 'lastBackupAt', null)).toBe(todayIso());
  });

  it('wipes every table', async () => {
    await loadSampleData(db);
    await clearAllData(db);
    expect(await db.accounts.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
    expect(await getSetting(db, SAMPLE_DATA_SETTING, false)).toBe(false);
  });
});
