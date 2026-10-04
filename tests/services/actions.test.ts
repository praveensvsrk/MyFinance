import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSetting, latestSnapshot, setSetting } from '../../src/db/repos';
import { FinanceDb, type GoalRow, type TxnRow } from '../../src/db/schema';
import { setCashBalance } from '../../src/services/actions/cash';
import { getCategoryConfig } from '../../src/services/actions/categories';
import { saveProperty } from '../../src/services/actions/property';
import { accountList } from '../../src/services/accounts';
import { loadSecret } from '../../src/services/secrets';
import { goalProgress, saveGoal, listGoals, deleteGoal } from '../../src/services/actions/goals';
import { discardProvisional, reassignProvisional } from '../../src/services/actions/provisional';
import {
  deleteRule,
  listRules,
  moveRule,
  recategorise,
  rulePatternFor,
  saveRule,
  setRuleEnabled,
} from '../../src/services/actions/rules';
import type { RuleDraft } from '../../src/domain/ruleDraft';
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

describe('saveProperty', () => {
  it('keeps each valuation and grows the balance to today', async () => {
    await saveProperty(db, { name: 'Motinagar', balance: 100_000_000, date: '2025-10-03', annualPct: 5 });
    await saveProperty(db, { name: 'Motinagar', balance: 110_000_000, date: '2026-04-01', annualPct: 0 });
    expect(await db.balanceSnapshots.where('accountId').equals('property').count()).toBe(2);
    const row = (await accountList(db, '2026-10-03')).find((item) => item.id === 'property');
    // The April entry is later, and the rate was cleared, so the figure stays ₹11,00,000.
    expect(row).toMatchObject({ group: 'Property', name: 'Motinagar', balance: 110_000_000, asOf: '2026-04-01' });
    expect(row?.caption).toBeUndefined();
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

describe('saveRule', () => {
  const clearing = 'ACH D- INDIAN CLEARING CORP 123456789012';
  const draft: RuleDraft = {
    words: ['INDIAN CLEARING'],
    isRegex: false,
    exceptWords: [],
    direction: 'debit',
    category: 'Mutual funds',
    kind: 'investment',
  };

  it('saves a rule on top and re-files matching rows, sparing manual, credit and transfer rows', async () => {
    await db.rules.add({ id: 'old', pattern: 'X', isRegex: false, category: 'Other', priority: 30 });
    await db.transactions.bulkAdd([
      txn('a', clearing, { category: 'Investments', kind: 'investment' }),
      txn('b', clearing, { category: 'Other', kind: 'normal' }),
      txn('manual', clearing, { category: 'Rent', categorySource: 'manual' }),
      txn('credit', clearing, { amount: 50000 }),
      txn('moved', clearing, { kind: 'transfer', transferPairId: 'z' }),
      txn('other', 'UPIOUT/123456789019/ZOMATO/dinner/5812'),
    ]);
    const result = await saveRule(db, draft, { applyToExisting: true });
    expect(result.changed).toBe(2);
    const rule = (await db.rules.get(result.ruleId))!;
    expect(rule).toMatchObject({
      pattern: 'INDIAN CLEARING',
      category: 'Mutual funds',
      kind: 'investment',
      direction: 'debit',
      priority: 40,
    });
    expect(await db.transactions.get('a')).toMatchObject({ category: 'Mutual funds', categorySource: 'rule', kind: 'investment' });
    expect(await db.transactions.get('b')).toMatchObject({ category: 'Mutual funds', kind: 'investment' });
    expect(await db.transactions.get('manual')).toMatchObject({ category: 'Rent', categorySource: 'manual' });
    expect((await db.transactions.get('credit'))?.category).toBe('Other');
    expect(await db.transactions.get('moved')).toMatchObject({ category: 'Other', kind: 'transfer' });
    expect((await db.transactions.get('other'))?.category).toBe('Other');
  });

  it('registers a new category and sets its not-spending flag, keeping the existing spelling after that', async () => {
    await saveRule(db, { ...draft, kind: 'normal' }, { applyToExisting: false, categoryExcluded: true });
    expect(await getCategoryConfig(db)).toEqual({ custom: ['Mutual funds'], excluded: ['Family', 'Mutual funds'] });

    const again = await saveRule(
      db,
      { ...draft, category: 'mutual FUNDS', words: ['SOMETHING ELSE'], kind: 'normal' },
      { applyToExisting: false, categoryExcluded: false },
    );
    expect((await db.rules.get(again.ruleId))?.category).toBe('Mutual funds');
    expect(await getCategoryConfig(db)).toEqual({ custom: ['Mutual funds'], excluded: ['Family'] });
  });

  it('leaves the category flag alone when the choice is Investment', async () => {
    await saveRule(db, draft, { applyToExisting: false });
    expect(await getCategoryConfig(db)).toEqual({ custom: ['Mutual funds'], excluded: ['Family'] });
  });

  it('does not touch existing rows unless asked', async () => {
    await db.transactions.add(txn('a', clearing));
    const result = await saveRule(db, draft, { applyToExisting: false });
    expect(result.changed).toBe(0);
    expect((await db.transactions.get('a'))?.category).toBe('Other');
    expect(await db.rules.count()).toBe(1);
  });

  it('updates a rule in place, keeping its priority and on/off state', async () => {
    const { ruleId } = await saveRule(db, draft, { applyToExisting: false });
    await db.rules.update(ruleId, { enabled: false });
    await saveRule(db, { ...draft, id: ruleId, name: 'Funds', category: 'SIPs' }, { applyToExisting: false });
    expect(await db.rules.get(ruleId)).toMatchObject({ name: 'Funds', category: 'SIPs', priority: 10, enabled: false });
    expect(await db.rules.count()).toBe(1);
  });

  it('does not apply a disabled rule to existing rows', async () => {
    const { ruleId } = await saveRule(db, draft, { applyToExisting: false });
    await db.rules.update(ruleId, { enabled: false });
    await db.transactions.add(txn('a', clearing));
    expect((await saveRule(db, { ...draft, id: ruleId }, { applyToExisting: true })).changed).toBe(0);
  });

  it('adds a provisional when a row becomes an investment, and drops unconfirmed ones when it stops', async () => {
    await db.transactions.add(txn('a', 'ZERODHA COIN', { amount: -300000 }));
    const toInvest: RuleDraft = { ...draft, words: ['ZERODHA'], category: 'Stocks' };
    const { ruleId } = await saveRule(db, toInvest, { applyToExisting: true });
    expect((await db.transactions.get('a'))?.kind).toBe('investment');
    const created = await db.mfProvisional.toArray();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ bankTxnId: 'a', schemeKey: 'unassigned', grossPaise: 300000 });

    await db.mfProvisional.add({ ...created[0], id: 'kept', bankTxnId: 'a', status: 'confirmed' });
    await saveRule(db, { ...toInvest, id: ruleId, kind: 'normal' }, { applyToExisting: true });
    expect((await db.transactions.get('a'))?.kind).toBe('normal');
    expect((await db.mfProvisional.toArray()).map((row) => row.id)).toEqual(['kept']);
  });

  it('rejects a draft with no condition, no category or an inverted range', async () => {
    await expect(saveRule(db, { ...draft, words: [] }, { applyToExisting: false })).rejects.toThrow(/condition/i);
    await expect(saveRule(db, { ...draft, category: ' ' }, { applyToExisting: false })).rejects.toThrow(/category/i);
    await expect(
      saveRule(db, { ...draft, minAmount: 500, maxAmount: 100 }, { applyToExisting: false }),
    ).rejects.toThrow(/amount/i);
    await expect(saveRule(db, { ...draft, words: ['('], isRegex: true }, { applyToExisting: false })).rejects.toThrow(/pattern/i);
    expect(await db.rules.count()).toBe(0);
  });

  it('moves a rule up or down by swapping priorities, and stops at the ends', async () => {
    const a = (await saveRule(db, { ...draft, words: ['A'] }, { applyToExisting: false })).ruleId;
    const b = (await saveRule(db, { ...draft, words: ['B'] }, { applyToExisting: false })).ruleId;
    const c = (await saveRule(db, { ...draft, words: ['C'] }, { applyToExisting: false })).ruleId;
    expect((await listRules(db)).map((r) => r.id)).toEqual([c, b, a]);
    await moveRule(db, a, 'up');
    expect((await listRules(db)).map((r) => r.id)).toEqual([c, a, b]);
    await moveRule(db, c, 'up');
    await moveRule(db, b, 'down');
    expect((await listRules(db)).map((r) => r.id)).toEqual([c, a, b]);
    await moveRule(db, c, 'down');
    expect((await listRules(db)).map((r) => r.id)).toEqual([a, c, b]);
  });

  it('turns a rule off and on without touching rows', async () => {
    const { ruleId } = await saveRule(db, draft, { applyToExisting: false });
    await setRuleEnabled(db, ruleId, false);
    expect((await db.rules.get(ruleId))?.enabled).toBe(false);
    await setRuleEnabled(db, ruleId, true);
    expect((await db.rules.get(ruleId))?.enabled).toBe(true);
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
