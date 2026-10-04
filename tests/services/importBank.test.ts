import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BankStatement, BankTxn, Validation } from '../../src/parsers/types';
import { FinanceDb } from '../../src/db/schema';
import {
  commitImport,
  previewFromParsed,
  previewImport,
  undoImport,
} from '../../src/services/importPipeline';
import { fixturePassword, hasFixture, readFixture } from '../helpers/fixtures';

const OK: Validation = { ok: true, checks: [], notes: [] };

function txn(date: string, description: string, amount: number, balanceAfter: number, ref = ''): BankTxn {
  return { date, description, ref, amount, balanceAfter };
}

function makeStatement(txns: BankTxn[], extra: Partial<BankStatement> = {}): BankStatement {
  const openingBalance = extra.openingBalance ?? 10_000_000;
  return {
    source: 'sbi',
    institution: 'SBI',
    accountLast4: '1234',
    ifsc: 'SBIN0000001',
    periodFrom: '2026-04-01',
    periodTo: '2026-04-30',
    openingBalance,
    closingBalance: txns.length ? txns[txns.length - 1].balanceAfter : openingBalance,
    txns,
    validation: OK,
    ...extra,
  };
}

function fourRows(): BankTxn[] {
  return [
    txn('2026-04-02', 'UPI/DR/1/SHOP/5411', -100_000, 9_900_000),
    txn('2026-04-03', 'UPI/DR/2/SHOP/5411', -200_000, 9_700_000),
    txn('2026-04-04', 'UPI/CR/3/SALARY CREDIT', 50_000, 9_750_000),
    txn('2026-04-05', 'UPI/DR/4/MERCHANT/5411', -75_000, 9_675_000),
    txn('2026-04-06', 'UPI/DR/5/MERCHANT/5411', -125_000, 9_550_000),
    txn('2026-04-07', 'UPI/CR/6/REFUND', 250_000, 9_800_000),
  ];
}

let db: FinanceDb;

beforeEach(() => {
  db = new FinanceDb(`test-import-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('previewFromParsed and commitImport', () => {
  it('marks every row as a duplicate when the same statement is imported twice', async () => {
    const statement = makeStatement(fourRows().slice(0, 4));
    const first = await previewFromParsed(db, statement, 'hash-one');
    expect(first.mapped.summary.duplicates).toBe(0);
    await commitImport(db, first);

    const second = await previewFromParsed(db, statement, 'hash-one');
    expect(second.mapped.summary.duplicates).toBe(statement.txns.length);
    expect(second.mapped.tables.transactions ?? []).toHaveLength(0);
    expect(second.alreadyImported).toBe(true);
    expect(await db.transactions.count()).toBe(4);
  });

  it('adds only the non-overlapping rows of an overlapping statement', async () => {
    const rows = fourRows();
    const first = makeStatement(rows.slice(0, 4));
    await commitImport(db, await previewFromParsed(db, first, 'hash-one'));

    const second = makeStatement(rows.slice(2, 6));
    const preview = await previewFromParsed(db, second, 'hash-two');
    expect(preview.mapped.summary.duplicates).toBe(2);
    expect(preview.mapped.tables.transactions ?? []).toHaveLength(2);
    await commitImport(db, preview);

    expect(await db.transactions.count()).toBe(6);
    expect(await db.imports.count()).toBe(2);
  });

  it('refuses an invalid preview and writes nothing', async () => {
    const statement = makeStatement(fourRows().slice(0, 1), {
      validation: { ok: false, checks: [{ name: 'closing', expected: 1, actual: 2, ok: false }], notes: [] },
    });
    const preview = await previewFromParsed(db, statement, 'hash-bad');

    await expect(commitImport(db, preview)).rejects.toThrow('validation failed');
    expect(await db.imports.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.balanceSnapshots.count()).toBe(0);
  });

  it('saves an invalid preview when unverified is set', async () => {
    const statement = makeStatement(fourRows().slice(0, 1), {
      validation: { ok: false, checks: [], notes: ['manual'] },
    });
    const preview = await previewFromParsed(db, statement, 'hash-bad');
    const importId = await commitImport(db, preview, { unverified: true });

    const row = await db.imports.get(importId);
    expect(row?.verified).toBe(false);
    expect(row?.notes).toEqual(['manual']);
    expect(await db.transactions.count()).toBe(1);
  });

  it('undoes an import, removing its transactions, snapshot and imports row', async () => {
    const statement = makeStatement(fourRows().slice(0, 2));
    const importId = await commitImport(db, await previewFromParsed(db, statement, 'hash-undo'));
    expect(await db.transactions.count()).toBe(2);
    expect(await db.balanceSnapshots.count()).toBe(1);

    await undoImport(db, importId);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.balanceSnapshots.count()).toBe(0);
    expect(await db.imports.count()).toBe(0);
  });

  it('creates the sbi-ppf account and snapshot from the SBI relationship summary', async () => {
    const statement = makeStatement(fourRows().slice(0, 1), {
      ppfBalance: { date: '2026-04-30', balance: 10_000_000 },
    });
    await commitImport(db, await previewFromParsed(db, statement, 'hash-ppf'));

    const account = await db.accounts.get('sbi-ppf');
    expect(account?.kind).toBe('ppf');
    const snapshot = await db.balanceSnapshots.where('accountId').equals('sbi-ppf').first();
    expect(snapshot).toMatchObject({ date: '2026-04-30', balance: 10_000_000, source: 'statement' });
  });

  it('marks a cross-account debit/credit pair as a transfer after commit', async () => {
    const sbi = makeStatement([txn('2026-04-11', 'IMPS/DR/123/UBIN', -500_000, 9_500_000)]);
    const ubi = makeStatement([txn('2026-04-12', 'IMPS/CR/123/SBI', 500_000, 10_500_000)], {
      source: 'ubi-savings',
      institution: 'UBI',
      accountLast4: '5678',
      ifsc: 'UBIN0000002',
    });
    await commitImport(db, await previewFromParsed(db, sbi, 'hash-sbi'));
    await commitImport(db, await previewFromParsed(db, ubi, 'hash-ubi'));

    const rows = await db.transactions.toArray();
    const debit = rows.find((r) => r.amount < 0);
    const credit = rows.find((r) => r.amount > 0);
    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    expect(debit).toMatchObject({ kind: 'transfer', transferPairId: credit!.id });
    expect(credit).toMatchObject({ kind: 'transfer', transferPairId: debit!.id });
  });
});

const SBI_FIXTURE = 'sbi/savings.pdf';

describe.skipIf(!hasFixture(SBI_FIXTURE))('previewImport on the real SBI statement', () => {
  it('parses, maps and validates the statement end to end', async () => {
    const password = fixturePassword(SBI_FIXTURE);

    const outcome = await previewImport(db, readFixture(SBI_FIXTURE), password ? { password } : undefined);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    const { preview } = outcome;
    expect(preview.source).toBe('sbi');
    expect(preview.validation.ok).toBe(true);
    expect(preview.mapped.summary.period).toEqual(['2026-04-01', '2026-10-03']);
    expect((preview.mapped.tables.transactions ?? []).length).toBeGreaterThan(0);
    expect(preview.mapped.summary.duplicates).toBe(0);

    const importId = await commitImport(db, preview);
    expect(await db.imports.get(importId)).toBeDefined();
    expect(await db.transactions.count()).toBeGreaterThan(0);
  });
});
