import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BankStatement, CardStatement, CardTxn, Validation } from '../../src/parsers/types';
import { FinanceDb } from '../../src/db/schema';
import { commitImport, previewFromParsed, previewImport, undoImport } from '../../src/services/importPipeline';
import { accountDetail, accountList } from '../../src/services/accounts';
import { buildNetWorthInputs } from '../../src/services/dashboard';
import { netWorthAt } from '../../src/domain/netWorth';
import { fixturePassword, hasFixture, readFixture } from '../helpers/fixtures';

const OK: Validation = { ok: true, checks: [], notes: [] };

function txn(date: string, description: string, ref: string, amount: number, balanceAfter: number): CardTxn {
  return { date, description, ref, amount, balanceAfter };
}

function makeCard(extra: Partial<CardStatement> = {}): CardStatement {
  return {
    source: 'icici-cc',
    institution: 'ICICI',
    cardLast4: '7004',
    periodFrom: '2026-08-27',
    periodTo: '2026-09-26',
    previousBalance: 0,
    purchases: 150_000,
    cashAdvances: 0,
    payments: 0,
    totalDue: 150_000,
    txns: [
      txn('2026-09-09', 'SHOP ONE MUMBAI', '1001', -100_000, -100_000),
      txn('2026-09-10', 'SHOP TWO MUMBAI', '1002', -50_000, -150_000),
    ],
    validation: OK,
    ...extra,
  };
}

let db: FinanceDb;

beforeEach(() => {
  db = new FinanceDb(`test-import-card-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('importing a credit card statement', () => {
  it('stores a card account, its rows and what is owed as a negative snapshot', async () => {
    const preview = await previewFromParsed(db, makeCard(), 'card-hash-1');
    await commitImport(db, preview);

    expect(await db.accounts.get('icici-card-7004')).toMatchObject({
      kind: 'card',
      institution: 'ICICI',
      maskedNumber: '7004',
      name: 'ICICI Credit Card',
    });
    const rows = await db.transactions.where('accountId').equals('icici-card-7004').sortBy('date');
    expect(rows.map((r) => [r.date, r.amount, r.balanceAfter, r.ref])).toEqual([
      ['2026-09-09', -100_000, -100_000, '1001'],
      ['2026-09-10', -50_000, -150_000, '1002'],
    ]);
    expect(await db.balanceSnapshots.toArray()).toMatchObject([
      { accountId: 'icici-card-7004', date: '2026-09-26', balance: -150_000, source: 'statement' },
    ]);
  });

  it('dedupes a re-import by the bank serial number, and keeps twin charges apart', async () => {
    const twins = makeCard({
      txns: [
        txn('2026-09-09', 'FEE', '2001', -500, -500),
        txn('2026-09-09', 'FEE', '2002', -500, -1000),
      ],
      purchases: 1000,
      totalDue: 1000,
    });
    const first = await previewFromParsed(db, twins, 'card-hash-twins');
    expect(first.mapped.tables.transactions).toHaveLength(2);
    await commitImport(db, first);
    const again = await previewFromParsed(db, twins, 'card-hash-twins');
    expect(again.alreadyImported).toBe(true);
    expect(again.mapped.summary.duplicates).toBe(2);
  });

  it('pairs the bill paid from a bank with the payment credit as a transfer', async () => {
    const bank: BankStatement = {
      source: 'sbi',
      institution: 'SBI',
      accountLast4: '1234',
      ifsc: 'SBIN0000001',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      openingBalance: 1_000_000,
      closingBalance: 850_000,
      txns: [{ date: '2026-10-14', description: 'BILLDESK ICICI CARD', ref: '', amount: -150_000, balanceAfter: 850_000 }],
      validation: OK,
    };
    await commitImport(db, await previewFromParsed(db, makeCard(), 'card-hash-a'));
    await commitImport(db, await previewFromParsed(db, bank, 'bank-hash-a'));
    const october = makeCard({
      periodFrom: '2026-09-27',
      periodTo: '2026-10-26',
      previousBalance: 150_000,
      purchases: 0,
      payments: 150_000,
      totalDue: 0,
      txns: [txn('2026-10-15', 'BBPS Payment received', '3001', 150_000, 0)],
    });
    await commitImport(db, await previewFromParsed(db, october, 'card-hash-b'));

    const rows = await db.transactions.toArray();
    const payment = rows.find((r) => r.ref === '3001');
    const debit = rows.find((r) => r.description === 'BILLDESK ICICI CARD');
    expect(payment).toMatchObject({ kind: 'transfer', transferPairId: debit?.id });
    expect(debit).toMatchObject({ kind: 'transfer', transferPairId: payment?.id });
  });

  it('lists the card under Cards with a negative balance, and subtracts it from liquid net worth', async () => {
    await commitImport(db, await previewFromParsed(db, makeCard(), 'card-hash-1'));
    const item = (await accountList(db, '2026-10-03')).find((a) => a.id === 'icici-card-7004');
    expect(item).toMatchObject({ kind: 'card', group: 'Cards', balance: -150_000, asOf: '2026-09-26', stale: false });
    expect((await accountList(db, '2026-12-31')).find((a) => a.id === 'icici-card-7004')?.stale).toBe(true);

    const detail = await accountDetail(db, 'icici-card-7004', {}, '2026-10-03');
    expect(detail?.history).toEqual([{ date: '2026-09-26', balance: -150_000 }]);
    expect(detail?.txns).toHaveLength(2);

    const inputs = await buildNetWorthInputs(db);
    expect(netWorthAt(inputs, '2026-10-03').groups.liquid).toBe(-150_000);
  });

  it('undoes cleanly', async () => {
    const id = await commitImport(db, await previewFromParsed(db, makeCard(), 'card-hash-1'));
    await undoImport(db, id);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.balanceSnapshots.count()).toBe(0);
  });
});

const CARD_FIXTURE = 'icici-cc/statement.pdf';

describe.skipIf(!hasFixture(CARD_FIXTURE))('previewImport on the real ICICI card statement', () => {
  it('unlocks, detects, maps and validates the statement end to end', async () => {
    const password = fixturePassword(CARD_FIXTURE);
    const outcome = await previewImport(db, readFixture(CARD_FIXTURE), password ? { password } : undefined);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    const { preview } = outcome;
    expect(preview.source).toBe('icici-cc');
    expect(preview.validation.ok).toBe(true);
    expect(preview.mapped.summary.period).toEqual(['2026-08-27', '2026-09-26']);
    expect(preview.mapped.summary.counts.transactions).toBe(16);

    await commitImport(db, preview);
    const item = (await accountList(db, '2026-10-04')).find((a) => a.kind === 'card');
    expect(item).toMatchObject({ balance: -488_669, group: 'Cards' });
  });

  it('asks for the password when none is given', async () => {
    const outcome = await previewImport(db, readFixture(CARD_FIXTURE));
    expect(outcome.status).toBe('password-required');
  });
});
