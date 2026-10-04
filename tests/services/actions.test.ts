import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSetting, latestSnapshot, setSetting } from '../../src/db/repos';
import { FinanceDb, type GoalRow, type TxnRow } from '../../src/db/schema';
import { setCashBalance } from '../../src/services/actions/cash';
import { loadSecret } from '../../src/services/secrets';
import { goalProgress, saveGoal, listGoals, deleteGoal } from '../../src/services/actions/goals';
import { discardProvisional, reassignProvisional } from '../../src/services/actions/provisional';
import { deleteRule, listRules, recategorise, rulePatternFor } from '../../src/services/actions/rules';
import {
  getPlanDefaults,
  saveFinnhubKey,
  savePlanDefaults,
} from '../../src/services/actions/settings';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-actions-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function txn(id: string, description: string, overrides: Partial<TxnRow> = {}): TxnRow {
  return {
    id,
    accountId: 'federal-1234',
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

describe('setCashBalance', () => {
  it('creates the cash account once and keeps every dated snapshot', async () => {
    await setCashBalance(db, 500000, '2026-09-01', 'wallet');
    await setCashBalance(db, 350000, '2026-10-01');
    expect(await db.accounts.where('kind').equals('cash').count()).toBe(1);
    expect(await db.balanceSnapshots.count()).toBe(2);
    expect((await latestSnapshot(db, 'cash'))?.balance).toBe(350000);
    expect(await getSetting(db, 'cashNotes', {})).toEqual({ '2026-09-01': 'wallet' });
  });
});

describe('recategorise', () => {
  const swiggy = (n: number): string => `UPIOUT/12345678901${n}/SWIGGY/lunch ${n}/5812`;

  it('derives a rule pattern from the UPI payee, or the cleaned narration', () => {
    expect(rulePatternFor(swiggy(1))).toBe('SWIGGY');
    expect(rulePatternFor('ACH D- ACME LIFE 123456789012')).toBe('ACH D- ACME LIFE');
    expect(rulePatternFor('ACH 1234567 /1234')).toBeNull();
  });

  it('changes only the one transaction without applyToAll', async () => {
    await db.transactions.bulkAdd([txn('a', swiggy(1)), txn('b', swiggy(2))]);
    expect(await recategorise(db, 'a', 'Food delivery', { applyToAll: false })).toEqual({
      changed: 1,
      ruleId: null,
    });
    expect((await db.transactions.get('b'))?.category).toBe('Other');
    expect(await db.rules.count()).toBe(0);
  });

  it('applies to all like this, sparing manual rows and unrelated ones', async () => {
    await db.transactions.bulkAdd([
      txn('a', swiggy(1)),
      txn('b', swiggy(2)),
      txn('c', swiggy(3), { category: 'Shopping', categorySource: 'manual' }),
      txn('d', 'UPIOUT/123456789019/ZOMATO/dinner/5812'),
    ]);
    const result = await recategorise(db, 'a', 'Food delivery', { applyToAll: true });
    expect(result.changed).toBe(1);
    expect(result.ruleId).not.toBeNull();
    expect((await db.transactions.get('a'))?.categorySource).toBe('manual');
    expect(await db.transactions.get('b')).toMatchObject({ category: 'Food delivery', categorySource: 'rule' });
    expect(await db.transactions.get('c')).toMatchObject({ category: 'Shopping', categorySource: 'manual' });
    expect((await db.transactions.get('d'))?.category).toBe('Other');
    const rules = await listRules(db);
    expect(rules).toHaveLength(1);
    await deleteRule(db, rules[0].id);
    expect(await listRules(db)).toHaveLength(0);
    expect((await db.transactions.get('b'))?.category).toBe('Food delivery');
  });

  it('refuses to create an over-broad rule', async () => {
    await db.transactions.bulkAdd([txn('a', 'ACH 1234567 /1234'), txn('b', 'ACH 7654321 /1234')]);
    expect(await recategorise(db, 'a', 'Utilities', { applyToAll: true })).toEqual({
      changed: 0,
      ruleId: null,
    });
    expect(await db.rules.count()).toBe(0);
    expect((await db.transactions.get('a'))?.category).toBe('Utilities');
  });
});

describe('goals', () => {
  const base = { name: 'Car', targetPaise: 1_000_000, targetDate: '2027-10-03', linkedAccountIds: ['a', 'b'] };

  it('saves, lists and deletes', async () => {
    const id = await saveGoal(db, base);
    expect((await listGoals(db)).map((goal) => goal.id)).toEqual([id]);
    await saveGoal(db, { ...base, id, name: 'New car' });
    expect((await listGoals(db))[0].name).toBe('New car');
    await deleteGoal(db, id);
    expect(await listGoals(db)).toEqual([]);
  });

  it('sums linked balances, caps pct at 100 and computes the monthly saving', () => {
    const goal: GoalRow = { id: 'g', ...base };
    expect(goalProgress(goal, { a: 100_000, b: 150_000, c: 9_000_000 }, '2026-10-03')).toEqual({
      current: 250_000,
      pct: 25,
      monthlyRequired: 62_500,
    });
    expect(goalProgress(goal, { a: 5_000_000 }, '2026-10-03').pct).toBe(100);
  });
});

describe('provisional actions', () => {
  it('reassigns an unassigned entry, values it, and learns a user link', async () => {
    await db.transactions.add(
      txn('bank-1', 'ACH D- INDIAN CLEARING BROKER 123456789012', {
        kind: 'investment',
        amount: -1_000_000,
        date: '2026-09-28',
      }),
    );
    await db.prices.bulkAdd([
      { symbol: 'MF:100', date: '2026-09-29', value: 250_000, source: 'api' },
    ]);
    await db.mfProvisional.add({
      id: 'p1',
      bankTxnId: 'bank-1',
      schemeKey: 'unassigned',
      date: '2026-09-28',
      grossPaise: 1_000_000,
      estUnits: 0,
      navDate: null,
      status: 'stale',
    });
    await db.mfFolios.add({
      id: 'f1|INF1',
      folio: 'f1',
      amc: 'AMC',
      scheme: 'Fund',
      isin: 'INF1',
      amfiCode: 100,
      holdingMode: 'soa',
      units: 0,
      asOf: '2026-08-31',
      historyComplete: true,
    } as never);
    await reassignProvisional(db, 'p1', 'f1|INF1');
    const row = await db.mfProvisional.get('p1');
    expect(row).toMatchObject({ schemeKey: 'f1|INF1', status: 'provisional' });
    expect(row?.estUnits).toBeGreaterThan(0);
    const links = await db.mfSipLinks.toArray();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ schemeKey: 'f1|INF1', source: 'user' });
    await discardProvisional(db, 'p1');
    expect(await db.mfProvisional.count()).toBe(0);
  });
});

describe('settings actions', () => {
  it('trims the Finnhub key, stores it encrypted and merges plan defaults', async () => {
    await saveFinnhubKey(db, '  abc123  ');
    expect(JSON.stringify(await getSetting(db, 'finnhubKey', ''))).not.toContain('abc123');
    expect(await loadSecret(db, 'finnhubKey')).toBe('abc123');
    expect(await getPlanDefaults(db)).toEqual({ ppfRatePct: 7.1, epfRatePct: 8.25, retirementAge: 58 });
    await savePlanDefaults(db, { ppfRatePct: 7.5, epfRatePct: 8.25, retirementAge: 60, epfMonthly: 400000 });
    expect(await getPlanDefaults(db)).toMatchObject({ ppfRatePct: 7.5, retirementAge: 60, epfMonthly: 400000 });
    await setSetting(db, 'planDefaults', {});
    expect((await getPlanDefaults(db)).retirementAge).toBe(58);
  });
});
