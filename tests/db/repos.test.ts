import Dexie, { type BulkError } from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteImport,
  getSetting,
  latestSnapshot,
  listAccounts,
  listImports,
  newId,
  pricesFor,
  putPrice,
  setSetting,
  snapshotsFor,
  txnsForAccount,
  txnsForMonth,
  upsertAccount,
} from '../../src/db/repos';
import {
  FinanceDb,
  type AccountRow,
  type EpfEntryRow,
  type ImportRow,
  type LoanEntryRow,
  type LoanYearRow,
  type MfProvisionalRow,
  type MfTxnRow,
  type SnapshotRow,
  type TxnRow,
} from '../../src/db/schema';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`myfinance-test-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function account(id: string): AccountRow {
  return {
    id,
    kind: 'savings',
    institution: 'SBI',
    maskedNumber: '1234',
    name: 'SBI savings',
    meta: {},
  };
}

function txn(overrides: Partial<TxnRow> & Pick<TxnRow, 'id'>): TxnRow {
  return {
    accountId: 'acct-1',
    date: '2026-01-05',
    description: 'UPI/SHOP',
    ref: '',
    amount: -10000,
    balanceAfter: 990000,
    category: 'Groceries',
    categorySource: 'rule',
    kind: 'normal',
    transferPairId: null,
    importId: 'imp-1',
    fingerprint: `fp-${overrides.id}`,
    ...overrides,
  };
}

function snapshot(overrides: Partial<SnapshotRow> & Pick<SnapshotRow, 'accountId' | 'date'>): SnapshotRow {
  return { balance: 100000, source: 'statement', importId: null, ...overrides };
}

function importRow(id: string, fileHash: string, importedAt: string): ImportRow {
  return {
    id,
    fileHash,
    source: 'sbi',
    periodFrom: '2026-01-01',
    periodTo: '2026-01-31',
    importedAt,
    counts: { transactions: 1 },
    verified: true,
    notes: [],
  };
}

function mfTxn(id: string, importId: string): MfTxnRow {
  return {
    id,
    folioId: 'folio-1|INF000000001',
    date: '2026-01-05',
    description: 'SIP purchase',
    type: 'sip',
    amount: 2200000,
    units: 879956,
    nav: 250000,
    stampDuty: 110,
    importId,
    fingerprint: `fp-${id}`,
  };
}

function epfEntry(accountId: string, importId: string): EpfEntryRow {
  return {
    accountId,
    fy: 2026,
    kind: 'contribution',
    creditDate: '2026-05-01',
    ee: 100000,
    er: 100000,
    eps: 0,
    importId,
  };
}

function loanYear(accountId: string, importId: string): LoanYearRow {
  return {
    accountId,
    fy: 2026,
    interestCharged: 1000000,
    principalRepaid: 2000000,
    totalPaid: 3000000,
    closingOutstanding: 50000000,
    importId,
  };
}

function loanEntry(id: string, importId: string): LoanEntryRow {
  return {
    id,
    accountId: 'ubi-loan-1234',
    date: '2026-01-05',
    description: 'EMI debit',
    ref: 'R1',
    kind: 'emi',
    amount: 8000000,
    outstandingAfter: 900000000,
    importId,
    fingerprint: `fp-${id}`,
  };
}

function provisional(id: string, bankTxnId: string): MfProvisionalRow {
  return {
    id,
    bankTxnId,
    schemeKey: 'folio-1|INF000000001',
    date: '2026-01-05',
    grossPaise: 2200000,
    estUnits: 879956,
    navDate: '2026-01-05',
    status: 'provisional',
  };
}

describe('schema', () => {
  it('creates every table and returns a v4 uuid from newId()', async () => {
    const tableNames = db.tables.map((table) => table.name).sort();
    expect(tableNames).toEqual(
      [
        'accounts',
        'balanceSnapshots',
        'epfEntries',
        'equityGrants',
        'equityLots',
        'goals',
        'imports',
        'loanEntries',
        'loanYears',
        'mfFolios',
        'mfProvisional',
        'mfSipLinks',
        'mfTxns',
        'prices',
        'rules',
        'settings',
        'transactions',
        'vests',
      ].sort(),
    );
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(newId());
  });

  it('makes the fingerprint index unique: bulkAdd rejects with Dexie ConstraintError', async () => {
    const failure: unknown = await db.transactions
      .bulkAdd([txn({ id: 't1', fingerprint: 'same' }), txn({ id: 't2', fingerprint: 'same' })])
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(Dexie.BulkError);
    const bulk = failure as BulkError;
    expect(bulk.failures.map((error) => error.name)).toContain('ConstraintError');
    expect(await db.transactions.where('fingerprint').equals('same').count()).toBe(1);
  });
});

describe('accounts and settings', () => {
  it('upserts accounts by id and lists them', async () => {
    await upsertAccount(db, account('a1'));
    await upsertAccount(db, { ...account('a1'), name: 'Renamed' });
    await upsertAccount(db, account('a2'));

    const accounts = await listAccounts(db);
    expect(accounts.map((row) => row.id)).toEqual(['a1', 'a2']);
    expect(accounts[0]?.name).toBe('Renamed');
  });

  it('getSetting returns the fallback for a missing key and the stored value otherwise', async () => {
    expect(await getSetting(db, 'missing', 'fallback')).toBe('fallback');
    expect(await getSetting(db, 'missing', 42)).toBe(42);

    await setSetting(db, 'finnhubKey', 'key-123');
    await setSetting(db, 'hideAmounts', false);
    expect(await getSetting(db, 'finnhubKey', '')).toBe('key-123');
    expect(await getSetting(db, 'hideAmounts', true)).toBe(false);
  });
});

describe('balance snapshots', () => {
  it('latestSnapshot picks the newest snapshot on or before the date', async () => {
    await db.balanceSnapshots.bulkAdd([
      snapshot({ accountId: 'a1', date: '2026-01-31', balance: 100 }),
      snapshot({ accountId: 'a1', date: '2026-02-28', balance: 200 }),
      snapshot({ accountId: 'a1', date: '2026-03-31', balance: 300 }),
      snapshot({ accountId: 'a2', date: '2026-03-31', balance: 999 }),
    ]);

    expect(await latestSnapshot(db, 'a1')).toMatchObject({ date: '2026-03-31', balance: 300 });
    expect(await latestSnapshot(db, 'a1', '2026-02-28')).toMatchObject({
      date: '2026-02-28',
      balance: 200,
    });
    expect(await latestSnapshot(db, 'a1', '2026-02-27')).toMatchObject({ date: '2026-01-31' });
    expect(await latestSnapshot(db, 'a1', '2025-12-31')).toBeNull();
    expect(await latestSnapshot(db, 'missing')).toBeNull();
  });

  it('snapshotsFor returns one account oldest first', async () => {
    await db.balanceSnapshots.bulkAdd([
      snapshot({ accountId: 'a1', date: '2026-03-31' }),
      snapshot({ accountId: 'a1', date: '2026-01-31' }),
      snapshot({ accountId: 'a2', date: '2026-02-28' }),
    ]);

    const rows = await snapshotsFor(db, 'a1');
    expect(rows.map((row) => row.date)).toEqual(['2026-01-31', '2026-03-31']);
  });
});

describe('transactions', () => {
  it('txnsForMonth returns the month oldest first', async () => {
    await db.transactions.bulkAdd([
      txn({ id: 't2', date: '2026-01-20' }),
      txn({ id: 't1', date: '2026-01-05' }),
      txn({ id: 't3', date: '2026-02-01' }),
      txn({ id: 't4', date: '2025-12-31' }),
    ]);

    const january = await txnsForMonth(db, '2026-01');
    expect(january.map((row) => row.id)).toEqual(['t1', 't2']);
  });

  it('txnsForAccount pages, filters and separates accounts', async () => {
    await db.transactions.bulkAdd([
      txn({ id: 't1', accountId: 'a1', date: '2026-01-01', description: 'GROCERY MART' }),
      txn({ id: 't2', accountId: 'a1', date: '2026-01-02', description: 'FUEL STATION' }),
      txn({ id: 't3', accountId: 'a1', date: '2026-01-03', description: 'GROCERY MART' }),
      txn({ id: 't4', accountId: 'a2', date: '2026-01-01', description: 'GROCERY MART' }),
    ]);

    expect((await txnsForAccount(db, 'a1')).map((row) => row.id)).toEqual(['t1', 't2', 't3']);
    expect((await txnsForAccount(db, 'a1', { limit: 2 })).map((row) => row.id)).toEqual(['t1', 't2']);
    expect((await txnsForAccount(db, 'a1', { offset: 1, limit: 1 })).map((row) => row.id)).toEqual([
      't2',
    ]);
    expect((await txnsForAccount(db, 'a1', { search: 'grocery' })).map((row) => row.id)).toEqual([
      't1',
      't3',
    ]);
    expect((await txnsForAccount(db, 'missing')).length).toBe(0);
  });
});

describe('prices', () => {
  it('putPrice upserts by [symbol+date] and pricesFor sorts by date', async () => {
    await putPrice(db, { symbol: 'ACME', date: '2026-01-02', value: 20000, source: 'api' });
    await putPrice(db, { symbol: 'ACME', date: '2026-01-01', value: 23900, source: 'statement' });
    await putPrice(db, { symbol: 'ACME', date: '2026-01-02', value: 24000, source: 'api' });
    await putPrice(db, { symbol: 'USDINR', date: '2026-01-01', value: 850000, source: 'api' });

    const acme = await pricesFor(db, 'ACME');
    expect(acme.map((price) => [price.date, price.value])).toEqual([
      ['2026-01-01', 23900],
      ['2026-01-02', 24000],
    ]);
    expect(await db.prices.count()).toBe(3);
  });
});

describe('deleteImport', () => {
  it('removes only the target import across every table and cleans up provisionals', async () => {
    await db.imports.bulkAdd([
      importRow('imp-1', 'hash-1', '2026-02-01'),
      importRow('imp-2', 'hash-2', '2026-02-02'),
    ]);
    await db.transactions.bulkAdd([
      txn({ id: 't1', importId: 'imp-1', fingerprint: 'fp-t1' }),
      txn({ id: 't2', importId: 'imp-2', fingerprint: 'fp-t2' }),
    ]);
    await db.balanceSnapshots.bulkAdd([
      snapshot({ accountId: 'acct-1', date: '2026-01-31', importId: 'imp-1' }),
      snapshot({ accountId: 'acct-1', date: '2026-02-28', importId: 'imp-2' }),
    ]);
    await db.mfTxns.bulkAdd([mfTxn('mf-1', 'imp-1'), mfTxn('mf-2', 'imp-2')]);
    await db.epfEntries.bulkAdd([epfEntry('epf-a', 'imp-1'), epfEntry('epf-b', 'imp-2')]);
    await db.loanYears.bulkAdd([loanYear('loan-a', 'imp-1'), loanYear('loan-b', 'imp-2')]);
    await db.loanEntries.bulkAdd([loanEntry('le-1', 'imp-1'), loanEntry('le-2', 'imp-2')]);
    await db.mfProvisional.bulkAdd([
      provisional('prov-1', 't1'),
      provisional('prov-2', 't2'),
    ]);

    await deleteImport(db, 'imp-1');

    expect((await db.transactions.toArray()).map((row) => row.id)).toEqual(['t2']);
    expect((await db.balanceSnapshots.toArray()).map((row) => row.importId)).toEqual(['imp-2']);
    expect((await db.mfTxns.toArray()).map((row) => row.id)).toEqual(['mf-2']);
    expect((await db.epfEntries.toArray()).map((row) => row.importId)).toEqual(['imp-2']);
    expect((await db.loanYears.toArray()).map((row) => row.importId)).toEqual(['imp-2']);
    expect((await db.loanEntries.toArray()).map((row) => row.id)).toEqual(['le-2']);
    expect((await db.mfProvisional.toArray()).map((row) => row.id)).toEqual(['prov-2']);
    expect(await db.imports.get('imp-1')).toBeUndefined();
    expect(await db.imports.get('imp-2')).toBeDefined();
  });

  it('unpairs the transfer counterpart left in another import', async () => {
    await db.imports.bulkAdd([
      importRow('imp-1', 'hash-1', '2026-02-01'),
      importRow('imp-2', 'hash-2', '2026-02-02'),
    ]);
    await db.transactions.bulkAdd([
      txn({ id: 't1', importId: 'imp-1', kind: 'transfer', transferPairId: 't2' }),
      txn({ id: 't2', importId: 'imp-2', kind: 'transfer', transferPairId: 't1', amount: 10000 }),
    ]);

    await deleteImport(db, 'imp-1');

    const counterpart = await db.transactions.get('t2');
    expect(counterpart?.transferPairId).toBeNull();
    expect(counterpart?.kind).not.toBe('transfer');
  });

  it('resets provisionals that the deleted CAS rows had confirmed', async () => {
    await db.imports.add(importRow('imp-cas', 'hash-cas', '2026-02-01'));
    await db.mfTxns.add(mfTxn('mf-1', 'imp-cas'));
    await db.mfProvisional.add({
      ...provisional('prov-1', 't1'),
      status: 'confirmed',
      confirmedByMfTxnId: 'mf-1',
    });

    await deleteImport(db, 'imp-cas');

    const reset = await db.mfProvisional.get('prov-1');
    expect(reset?.status).toBe('provisional');
    expect(reset?.confirmedByMfTxnId).toBeUndefined();
  });

  it('puts back replaced rows and removes inserted ones, unless a later import superseded them', async () => {
    const folio = (id: string, units: number, importId?: string) => ({
      id,
      folio: id,
      amc: 'AMC',
      scheme: 'Scheme',
      isin: `INF-${id}`,
      holdingMode: 'soa' as const,
      units,
      asOf: '2026-04-30',
      historyComplete: true,
      ...(importId === undefined ? {} : { importId }),
    });
    // imp-2 replaced folio f1 (units 100 → 200) and created f2; a later import imp-3 replaced f2.
    await db.imports.add({
      ...importRow('imp-2', 'hash-2', '2026-02-02'),
      undo: { replaced: { mfFolios: [folio('f1', 100)] }, inserted: { mfFolios: ['f1', 'f2'] } },
    });
    await db.mfFolios.bulkAdd([folio('f1', 200, 'imp-2'), folio('f2', 50, 'imp-3')]);

    await deleteImport(db, 'imp-2');

    expect(await db.mfFolios.get('f1')).toMatchObject({ units: 100 });
    expect(await db.mfFolios.get('f2')).toMatchObject({ units: 50, importId: 'imp-3' });
  });

  it('is a no-op for an unknown import id', async () => {
    await db.transactions.add(txn({ id: 't1' }));
    await deleteImport(db, 'missing');
    expect(await db.transactions.count()).toBe(1);
  });
});

describe('listImports', () => {
  it('returns imports newest first', async () => {
    await db.imports.bulkAdd([
      importRow('imp-1', 'hash-1', '2026-02-01'),
      importRow('imp-2', 'hash-2', '2026-02-03'),
      importRow('imp-3', 'hash-3', '2026-02-02'),
    ]);

    expect((await listImports(db)).map((row) => row.id)).toEqual(['imp-2', 'imp-3', 'imp-1']);
  });
});
