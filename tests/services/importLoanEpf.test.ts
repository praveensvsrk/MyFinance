import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  EpfAmounts,
  EpfPassbook,
  EpfRow,
  LoanCertificate,
  LoanRow,
  LoanStatement,
  Validation,
} from '../../src/parsers/types';
import { FinanceDb, type LoanEntryRow, type SnapshotRow } from '../../src/db/schema';
import { epfBalanceAt } from '../../src/domain/epf';
import { fyEndDate, todayIso } from '../../src/domain/dates';
import { commitImport, previewFromParsed } from '../../src/services/importPipeline';

function ok(): Validation {
  return { ok: true, checks: [], notes: [] };
}

// ---------- loan builders ----------

function loanRow(
  kind: LoanRow['kind'],
  date: string,
  amount: number,
  outstandingAfter: number,
  extra: Partial<LoanRow> = {},
): LoanRow {
  return {
    date,
    description: `${kind.toUpperCase()} ${date}`,
    ref: `${kind}-${date}`,
    kind,
    amount,
    outstandingAfter,
    printedOutstanding: outstandingAfter,
    ...extra,
  };
}

function statement(
  rows: LoanRow[],
  opts: { openingOutstanding?: number; periodFrom?: string; periodTo?: string; validation?: Validation } = {},
): LoanStatement {
  const openingOutstanding = opts.openingOutstanding ?? 0;
  const last = rows[rows.length - 1];
  return {
    source: 'ubi-loan',
    accountLast4: '4321',
    periodFrom: opts.periodFrom ?? rows[0]?.date ?? '2026-04-01',
    periodTo: opts.periodTo ?? last?.date ?? '2026-04-30',
    rows,
    openingOutstanding,
    closingOutstanding: last ? last.outstandingAfter : openingOutstanding,
    validation: opts.validation ?? ok(),
  };
}

function certificate(extra: Partial<LoanCertificate> = {}): LoanCertificate {
  return {
    source: 'ubi-cert',
    accountLast4: '4321',
    fyStart: 2025,
    sanctioned: 1_000_000_000,
    releaseDate: '2020-01-15',
    emi: 8_000_000,
    closingDate: '2026-03-31',
    closingOutstanding: 980_000_000,
    interestCharged: 80_000_000,
    totalPaid: 150_000_000,
    principalPaid: 70_000_000,
    interestPaid: 80_000_000,
    validation: ok(),
    ...extra,
  };
}

// ---------- EPF builders ----------

function epfRow(
  kind: EpfRow['kind'],
  creditDate: string,
  ee: number,
  er: number,
  extra: Partial<EpfRow> = {},
): EpfRow {
  return {
    wageMonth: creditDate.slice(0, 7),
    creditDate,
    kind,
    particulars: '',
    epfWages: 0,
    epsWages: 0,
    amounts: { ee, er, eps: 0 },
    ...extra,
  };
}

function passbook(
  memberId: string,
  fyStart: number,
  opening: EpfAmounts,
  rows: EpfRow[],
  interest: EpfAmounts | null = null,
): EpfPassbook {
  let closing = opening;
  for (const row of rows) {
    closing = { ee: closing.ee + row.amounts.ee, er: closing.er + row.amounts.er, eps: closing.eps + row.amounts.eps };
  }
  if (interest) {
    closing = { ee: closing.ee + interest.ee, er: closing.er + interest.er, eps: closing.eps + interest.eps };
  }
  return {
    source: 'epf',
    memberId,
    establishmentId: 'EST00001',
    establishmentName: 'Acme Pvt Ltd',
    fyStart,
    opening,
    rows,
    interest,
    closing,
    totalContributions: { ee: 0, er: 0, eps: 0 },
    validation: ok(),
  };
}

let db: FinanceDb;

beforeEach(() => {
  db = new FinanceDb(`test-import-loan-epf-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('loan mapper', () => {
  it('classifies a credit at the 1% EMI boundary as emi or prepayment', async () => {
    await commitImport(db, await previewFromParsed(db, certificate(), 'hash-cert-emi'));

    const s = statement(
      [
        loanRow('interest', '2026-04-01', 600_000, 100_600_000, {
          interestFrom: '2026-03-01',
          interestTo: '2026-03-31',
        }),
        loanRow('repayment', '2026-04-02', 8_079_000, 92_521_000),
        loanRow('repayment', '2026-04-03', 8_090_000, 84_431_000),
      ],
      { openingOutstanding: 100_000_000 },
    );
    const preview = await previewFromParsed(db, s, 'hash-stmt-emi');

    const entries = (preview.mapped.tables.loanEntries ?? []) as LoanEntryRow[];
    expect(entries.map((e) => e.kind)).toEqual(['interest', 'emi', 'prepayment']);
    expect(entries[0]).toMatchObject({ interestFrom: '2026-03-01', interestTo: '2026-03-31' });
    expect(preview.validation.ok).toBe(true);

    const snapshots = (preview.mapped.tables.balanceSnapshots ?? []) as SnapshotRow[];
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      accountId: 'ubi-loan-4321',
      date: '2026-04-03',
      balance: -84_431_000,
      source: 'statement',
    });
  });

  it('skips duplicate loan rows when statements overlap', async () => {
    const first = statement(
      [
        loanRow('repayment', '2026-04-02', 8_079_000, 91_921_000),
        loanRow('interest', '2026-04-03', 600_000, 92_521_000),
        loanRow('disbursement', '2026-04-04', 10_000_000, 102_521_000),
        loanRow('repayment', '2026-04-05', 8_000_000, 94_521_000),
      ],
      { openingOutstanding: 100_000_000 },
    );
    await commitImport(db, await previewFromParsed(db, first, 'hash-overlap-1'));

    const second = statement(
      [
        loanRow('disbursement', '2026-04-04', 10_000_000, 102_521_000),
        loanRow('repayment', '2026-04-05', 8_000_000, 94_521_000),
        loanRow('charge', '2026-04-06', 25_000, 94_546_000),
        loanRow('repayment', '2026-04-07', 5_000_000, 89_546_000),
      ],
      { openingOutstanding: 92_521_000, periodFrom: '2026-04-04' },
    );
    const preview = await previewFromParsed(db, second, 'hash-overlap-2');
    expect(preview.mapped.summary.duplicates).toBe(2);
    expect(preview.mapped.tables.loanEntries ?? []).toHaveLength(2);
    await commitImport(db, preview);

    expect(await db.loanEntries.count()).toBe(6);
    const stored = await db.loanEntries.orderBy('date').toArray();
    expect(stored.map((e) => e.kind)).toEqual([
      'emi',
      'interest',
      'disbursement',
      'emi',
      'charge',
      'prepayment',
    ]);
  });

  it('adds a failing join check when the stored outstanding does not chain', async () => {
    const first = statement([loanRow('repayment', '2026-04-02', 8_000_000, 92_000_000)], {
      openingOutstanding: 100_000_000,
    });
    await commitImport(db, await previewFromParsed(db, first, 'hash-join-1'));

    const second = statement([loanRow('interest', '2026-04-03', 500_000, 91_500_000)], {
      openingOutstanding: 91_000_000,
      periodFrom: '2026-04-03',
    });
    const preview = await previewFromParsed(db, second, 'hash-join-2');

    const join = preview.validation.checks.find((c) => c.name === 'join');
    expect(join).toMatchObject({ ok: false, expected: 91_000_000, actual: 92_000_000 });
    expect(preview.validation.ok).toBe(false);
    await expect(commitImport(db, preview)).rejects.toThrow('validation failed');
    expect(await db.loanEntries.count()).toBe(1);
  });

  it('upserts certificate meta, a loan year and a negative FY-end snapshot', async () => {
    await commitImport(db, await previewFromParsed(db, certificate(), 'hash-cert'));

    const account = await db.accounts.get('ubi-loan-4321');
    expect(account?.kind).toBe('loan');
    expect(account?.meta).toMatchObject({
      sanctioned: 1_000_000_000,
      releaseDate: '2020-01-15',
      bankEmi: 8_000_000,
    });

    const year = await db.loanYears.get(['ubi-loan-4321', 2025]);
    expect(year).toMatchObject({
      interestCharged: 80_000_000,
      principalRepaid: 70_000_000,
      totalPaid: 150_000_000,
      closingOutstanding: 980_000_000,
    });

    const snapshot = await db.balanceSnapshots.get(['ubi-loan-4321', '2026-03-31']);
    expect(snapshot).toMatchObject({ balance: -980_000_000, source: 'statement' });

    // A re-import replaces the year and the snapshot instead of duplicating them.
    await commitImport(db, await previewFromParsed(db, certificate(), 'hash-cert-2'));
    expect(await db.loanYears.count()).toBe(1);
    expect(await db.balanceSnapshots.count()).toBe(1);
    expect(await db.accounts.count()).toBe(1);
  });
});

describe('EPF mapper', () => {
  it('replaces the same FY rows on re-import so the count stays stable', async () => {
    const p = passbook(
      'MEMBER00001',
      2025,
      { ee: 1_000_000, er: 500_000, eps: 0 },
      [epfRow('contribution', '2025-05-10', 100_000, 50_000)],
      { ee: 40_000, er: 10_000, eps: 0 },
    );
    await commitImport(db, await previewFromParsed(db, p, 'hash-epf-1'));
    expect(await db.epfEntries.count()).toBe(3);

    const again = passbook(
      'MEMBER00001',
      2025,
      { ee: 1_000_000, er: 500_000, eps: 0 },
      [epfRow('contribution', '2025-05-10', 100_000, 50_000)],
      { ee: 40_000, er: 10_000, eps: 0 },
    );
    const preview = await previewFromParsed(db, again, 'hash-epf-2');
    expect(preview.mapped.tables.epfEntries ?? []).toHaveLength(3);
    await commitImport(db, preview);

    expect(await db.epfEntries.count()).toBe(3);
    expect(await db.balanceSnapshots.count()).toBe(1);

    const account = await db.accounts.get('epf-00001');
    expect(account?.meta).toMatchObject({ memberId: 'MEMBER00001', establishmentName: 'Acme Pvt Ltd' });

    const expectedDate = todayIso() < fyEndDate(2025) ? todayIso() : fyEndDate(2025);
    const snapshot = await db.balanceSnapshots.where('accountId').equals('epf-00001').first();
    expect(snapshot).toMatchObject({ date: expectedDate, balance: 1_700_000, source: 'statement' });
  });

  it('links a transferIn to an existing member with an inferred interest and a transferOut', async () => {
    const oldP = passbook('OLDMEMBER00001', 2024, { ee: 10_000_000, er: 500_000, eps: 0 }, []);
    await commitImport(db, await previewFromParsed(db, oldP, 'hash-epf-old'));

    const newP = passbook('NEWMEMBER00002', 2024, { ee: 0, er: 0, eps: 0 }, [
      epfRow('transferIn', '2024-06-15', 12_000_000, 0, { fromMemberId: 'OLDMEMBER00001' }),
    ]);
    await commitImport(db, await previewFromParsed(db, newP, 'hash-epf-new'));

    const oldRows = await db.epfEntries.where('accountId').equals('epf-00001').toArray();
    const inferred = oldRows.find((e) => e.kind === 'interest' && e.inferred === true);
    expect(inferred).toMatchObject({ creditDate: '2024-06-14', inferred: true });
    expect((inferred?.ee ?? 0) + (inferred?.er ?? 0)).toBe(1_500_000);

    const transferOut = oldRows.find((e) => e.kind === 'transferOut');
    expect(transferOut).toMatchObject({ creditDate: '2024-06-15' });
    expect((transferOut?.ee ?? 0) + (transferOut?.er ?? 0)).toBe(-12_000_000);
    expect(epfBalanceAt(oldRows, '2024-06-15').total).toBe(0);

    const newRows = await db.epfEntries.where('accountId').equals('epf-00002').toArray();
    expect(epfBalanceAt(newRows, '2024-06-15').total).toBe(12_000_000);
  });
});
