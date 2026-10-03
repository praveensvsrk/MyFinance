import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  BankStatement,
  BankTxn,
  BenefitHistory,
  CasScheme,
  CasStatement,
  CasTxn,
  EquityGrantRec,
  EsppPurchaseRec,
  EtradeStatement,
  LotRec,
  Validation,
  VestRec,
} from '../../src/parsers/types';
import { FinanceDb, type TxnRow } from '../../src/db/schema';
import { getSetting } from '../../src/db/repos';
import { estimateUnits } from '../../src/domain/mfProvisional';
import { commitImport, previewFromParsed, undoImport } from '../../src/services/importPipeline';
import { refreshProvisionalUnits } from '../../src/services/provisional';

function okValidation(): Validation {
  return { ok: true, checks: [], notes: [] };
}

// ---------- CAS builders ----------

function casTxn(
  date: string,
  type: CasTxn['type'],
  amount: number,
  units: number,
  extra: Partial<CasTxn> = {},
): CasTxn {
  return {
    date,
    description: `${type} ${date}`,
    type,
    amount,
    units,
    nav: 250_000,
    unitBalance: units,
    stampDuty: 0,
    stt: 0,
    tds: 0,
    ...extra,
  };
}

function casScheme(folio: string, extra: Partial<CasScheme> = {}): CasScheme {
  return {
    amc: 'Axis',
    folio,
    schemeCode: 'CAMSCODE',
    name: `Scheme ${folio}`,
    isin: `INF${folio}`,
    registrar: 'CAMS',
    demat: false,
    openingUnits: 0,
    closingUnits: 0,
    nav: 250_000,
    navDate: '2026-04-30',
    totalCost: 0,
    marketValue: 0,
    txns: [],
    ...extra,
  };
}

function casStatement(schemes: CasScheme[], extra: Partial<CasStatement> = {}): CasStatement {
  return {
    source: 'cas',
    periodFrom: '2026-04-01',
    periodTo: '2026-04-30',
    portfolio: [],
    total: { cost: 0, marketValue: 0 },
    schemes,
    validation: okValidation(),
    ...extra,
  };
}

// ---------- bank builders ----------

function bankTxn(date: string, description: string, amount: number, balanceAfter = 1_000_000): BankTxn {
  return { date, description, ref: '', amount, balanceAfter };
}

function bankStatement(txns: BankTxn[], extra: Partial<BankStatement> = {}): BankStatement {
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
    validation: okValidation(),
    ...extra,
  };
}

const INVESTMENT_NARRATION = 'ACH DR 123456 INDIAN CLEARING';

// ---------- equity builders ----------

function grant(): EquityGrantRec {
  return {
    grantNumber: 'RU0001',
    type: 'RSU',
    grantDate: '2024-01-15',
    totalShares: 300,
    cancelledShares: 0,
    vestedShares: 100,
    unvestedShares: 100,
    sellableShares: 100,
  };
}

function vests(): VestRec[] {
  return [
    {
      grantNumber: 'RU0001',
      period: 1,
      vestDate: '2025-01-15',
      shares: 100,
      cancelledShares: 0,
      vestedShares: 100,
      releasedShares: 100,
      sellableShares: 100,
      sharesWithheld: 0,
      fmvUsdCents: 30_000,
      taxableGainUsdCents: 500_000,
      taxRatePct: 30,
      status: 'vested',
    },
    {
      grantNumber: 'RU0001',
      period: 2,
      vestDate: '2026-01-15',
      shares: 100,
      cancelledShares: 0,
      vestedShares: 0,
      releasedShares: 0,
      sellableShares: 0,
      sharesWithheld: 0,
      fmvUsdCents: null,
      taxableGainUsdCents: null,
      taxRatePct: null,
      status: 'unvested',
    },
  ];
}

function esppPurchase(): EsppPurchaseRec {
  return {
    offeringDate: '2025-01-01',
    purchaseDate: '2025-06-30',
    purchasePriceUsdCents: 20_000,
    purchasedShares: 50,
    sellableShares: 50,
    grantDateFmvUsdCents: 25_000,
    purchaseDateFmvUsdCents: 30_000,
    discountPct: 15,
  };
}

function lots(): LotRec[] {
  return [
    {
      key: 'RU0001#1',
      source: 'RSU',
      acquiredDate: '2025-01-15',
      netShares: 100,
      remainingShares: 100,
      costPerShareUsdCents: 25_000,
      remainingCostUsdCents: 2_500_000,
    },
    {
      key: 'ESPP#2025-06-30',
      source: 'ESPP',
      acquiredDate: '2025-06-30',
      netShares: 50,
      remainingShares: 50,
      costPerShareUsdCents: 20_000,
      remainingCostUsdCents: 1_000_000,
    },
  ];
}

function benefitHistory(): BenefitHistory {
  return {
    source: 'etrade-xlsx',
    symbol: 'ACME',
    grants: [grant()],
    vests: vests(),
    esppPurchases: [esppPurchase()],
    lots: lots(),
    sales: [],
    validation: okValidation(),
  };
}

function etradeStatement(extra: Partial<EtradeStatement> = {}): EtradeStatement {
  return {
    source: 'etrade-stmt',
    periodFrom: '2026-06-01',
    periodTo: '2026-06-30',
    symbol: 'ACME',
    quantity: 150,
    priceUsdCents: 30_000,
    totalCostUsdCents: 3_500_000,
    marketValueUsdCents: 4_500_000,
    unvested: [{ grantDate: '2024-01-15', grantNumber: 'RU0001', quantity: 100 }],
    validation: okValidation(),
    ...extra,
  };
}

let db: FinanceDb;

beforeEach(() => {
  db = new FinanceDb(`test-import-cas-equity-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

const FOLIO_A = '1001|INF1001';
const FOLIO_B = '2001|INF2001';describe('CAS mapper', () => {
  it('skips duplicate rows on an overlapping re-import and keeps continuity', async () => {
    const first = casStatement([
      casScheme('1001', {
        isin: 'INF1001',
        closingUnits: 40_000,
        nav: 250_000,
        navDate: '2026-04-30',
        txns: [casTxn('2026-04-10', 'purchase', 100_000, 40_000, { stampDuty: 5, nav: 250_000 })],
      }),
    ]);
    await commitImport(db, await previewFromParsed(db, first, 'cas-hash-1'));

    const stored = await db.mfFolios.get(FOLIO_A);
    expect(stored).toMatchObject({
      units: 40_000,
      asOf: '2026-04-30',
      historyComplete: true,
      amfiCode: null,
    });

    const second = casStatement(
      [
        casScheme('1001', {
          isin: 'INF1001',
          openingUnits: 40_000,
          closingUnits: 49_000,
          nav: 251_000,
          navDate: '2026-05-31',
          txns: [
            // Identical to the first statement: the fingerprint must drop it.
            casTxn('2026-04-10', 'purchase', 100_000, 40_000, { stampDuty: 5, nav: 250_000 }),
            casTxn('2026-05-10', 'sip', 22_000, 8_760, { stampDuty: 1, nav: 251_000 }),
          ],
        }),
      ],
      { periodFrom: '2026-05-01', periodTo: '2026-05-31' },
    );
    const preview = await previewFromParsed(db, second, 'cas-hash-2');
    expect(preview.mapped.summary.duplicates).toBe(1);
    expect(preview.mapped.tables.mfTxns ?? []).toHaveLength(1);
    expect(preview.validation.ok).toBe(true);
    await commitImport(db, preview);

    expect(await db.mfTxns.count()).toBe(2);
    expect(await db.mfFolios.get(FOLIO_A)).toMatchObject({ units: 49_000, asOf: '2026-05-31' });
  });

  it('flags a continuity break with a failing continuity check', async () => {
    const first = casStatement([
      casScheme('2001', {
        isin: 'INF2001',
        closingUnits: 40_000,
        txns: [casTxn('2026-04-10', 'purchase', 100_000, 40_000)],
      }),
    ]);
    await commitImport(db, await previewFromParsed(db, first, 'cas-break-1'));

    const second = casStatement(
      [
        casScheme('2001', {
          isin: 'INF2001',
          openingUnits: 39_000,
          closingUnits: 48_000,
        }),
      ],
      { periodFrom: '2026-05-01', periodTo: '2026-05-31' },
    );
    const preview = await previewFromParsed(db, second, 'cas-break-2');

    const check = preview.validation.checks.find((c) => c.name.startsWith('continuity:'));
    expect(check).toMatchObject({ ok: false, expected: 39_000, actual: 40_000 });
    expect(preview.validation.ok).toBe(false);
    await expect(commitImport(db, preview)).rejects.toThrow('validation failed');
    expect(await db.mfTxns.count()).toBe(1);
  });

  it('learns a link, creates a provisional from the next debit and confirms it with the next CAS', async () => {
    await commitImport(
      db,
      await previewFromParsed(
        db,
        bankStatement([bankTxn('2026-04-05', INVESTMENT_NARRATION, -2_200_000)]),
        'link-bank-1',
      ),
    );

    const firstCas = casStatement([
      casScheme('2001', {
        isin: 'INF2001',
        closingUnits: 8_800,
        nav: 250_000,
        navDate: '2026-04-30',
        txns: [casTxn('2026-04-08', 'sip', 2_199_890, 8_800, { stampDuty: 110, nav: 250_000 })],
      }),
    ]);
    await commitImport(db, await previewFromParsed(db, firstCas, 'link-cas-1'));

    const learned = await db.mfSipLinks.toArray();
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({
      schemeKey: FOLIO_B,
      source: 'learned',
      dayOfMonth: 5,
      grossPaise: 2_200_000,
    });
    expect(learned[0].narrationPattern).toContain('INDIAN CLEARING');

    const laterBank = bankStatement([bankTxn('2026-05-05', INVESTMENT_NARRATION, -2_200_000)], {
      periodFrom: '2026-05-01',
      periodTo: '2026-05-31',
    });
    const bankPreview = await previewFromParsed(db, laterBank, 'link-bank-2');
    const bankRow = (bankPreview.mapped.tables.transactions as TxnRow[])[0];
    expect(bankPreview.ambiguous).toEqual([]);
    await commitImport(db, bankPreview);

    const provisional = await db.mfProvisional.where('bankTxnId').equals(bankRow.id).first();
    expect(provisional).toMatchObject({
      schemeKey: FOLIO_B,
      status: 'provisional',
      grossPaise: 2_200_000,
      navDate: '2026-04-30',
    });
    expect(provisional?.estUnits).toBe(estimateUnits(2_200_000, 250_000));

    const secondCas = casStatement(
      [
        casScheme('2001', {
          isin: 'INF2001',
          openingUnits: 8_800,
          closingUnits: 17_600,
          nav: 252_000,
          navDate: '2026-05-31',
          txns: [casTxn('2026-05-08', 'sip', 2_199_890, 8_800, { stampDuty: 110, nav: 252_000 })],
        }),
      ],
      { periodFrom: '2026-05-01', periodTo: '2026-05-31' },
    );
    await commitImport(db, await previewFromParsed(db, secondCas, 'link-cas-2'));

    const mayTxn = await db.mfTxns.where('date').equals('2026-05-08').first();
    expect(await db.mfProvisional.get(provisional!.id)).toMatchObject({
      status: 'confirmed',
      confirmedByMfTxnId: mayTxn?.id,
    });
  });

  it('exposes an ambiguous debit in the preview and saves the assigned scheme as a user link', async () => {
    await commitImport(
      db,
      await previewFromParsed(
        db,
        bankStatement([bankTxn('2026-04-05', INVESTMENT_NARRATION, -2_200_000)]),
        'amb-bank-1',
      ),
    );

    const cas = casStatement([
      casScheme('3001', {
        isin: 'INF3001',
        closingUnits: 8_800,
        txns: [casTxn('2026-04-08', 'sip', 2_199_890, 8_800, { stampDuty: 110 })],
      }),
      casScheme('3002', {
        isin: 'INF3002',
        closingUnits: 8_800,
        txns: [casTxn('2026-04-08', 'sip', 2_199_890, 8_800, { stampDuty: 110 })],
      }),
    ]);
    await commitImport(db, await previewFromParsed(db, cas, 'amb-cas-1'));
    expect(await db.mfSipLinks.count()).toBe(2);

    const laterBank = bankStatement([bankTxn('2026-05-05', INVESTMENT_NARRATION, -2_200_000)], {
      periodFrom: '2026-05-01',
      periodTo: '2026-05-31',
    });
    const preview = await previewFromParsed(db, laterBank, 'amb-bank-2');
    const row = (preview.mapped.tables.transactions as TxnRow[])[0];
    expect(preview.ambiguous).toEqual([
      { bankTxnId: row.id, candidates: ['3001|INF3001', '3002|INF3002'] },
    ]);

    await commitImport(db, preview, { assignments: { [row.id]: '3001|INF3001' } });

    expect(await db.mfProvisional.where('bankTxnId').equals(row.id).first()).toMatchObject({
      schemeKey: '3001|INF3001',
      status: 'provisional',
    });
    const user = (await db.mfSipLinks.toArray()).find((link) => link.source === 'user');
    expect(user).toMatchObject({
      schemeKey: '3001|INF3001',
      dayOfMonth: 5,
      grossPaise: 2_200_000,
    });
  });
});

describe('equity mappers', () => {
  it('replaces every equity row on a Benefit History re-import so the counts stay the same', async () => {
    await db.prices.put({ symbol: 'USDINR', date: '2025-01-15', value: 850_000, source: 'api' });

    await commitImport(db, await previewFromParsed(db, benefitHistory(), 'bh-1'));
    expect(await db.equityGrants.count()).toBe(1);
    expect(await db.vests.count()).toBe(2);
    expect(await db.equityLots.count()).toBe(2);

    const account = await db.accounts.get('equity');
    expect(account).toMatchObject({ kind: 'equity', name: 'ACME' });

    const storedLots = await db.equityLots.toArray();
    const rsuLot = storedLots.find((lot) => lot.key === 'RU0001#1');
    const esppLot = storedLots.find((lot) => lot.key === 'ESPP#2025-06-30');
    expect(rsuLot).toMatchObject({ usdInrOnAcquire: 850_000 });
    expect(esppLot).toMatchObject({ usdInrOnAcquire: null });
    expect(rsuLot?.vestId).not.toBeNull();
    expect(esppLot?.vestId).toBeNull();

    await commitImport(db, await previewFromParsed(db, benefitHistory(), 'bh-2'));
    expect(await db.equityGrants.count()).toBe(1);
    expect(await db.vests.count()).toBe(2);
    expect(await db.equityLots.count()).toBe(2);
  });

  it('records the ticker from the Benefit History, and a statement can change it', async () => {
    expect(await getSetting(db, 'equitySymbol', '')).toBe('');

    const bhId = await commitImport(db, await previewFromParsed(db, benefitHistory(), 'sym-bh'));
    expect(await getSetting(db, 'equitySymbol', '')).toBe('ACME');

    // A workbook without a Symbol column leaves the known ticker alone.
    const bare = benefitHistory();
    bare.symbol = '';
    await commitImport(db, await previewFromParsed(db, bare, 'sym-bare'));
    expect(await getSetting(db, 'equitySymbol', '')).toBe('ACME');
    expect(await db.accounts.get('equity')).toMatchObject({ name: 'ACME', meta: { symbol: 'ACME' } });

    // A statement for a different ticker (e.g. a rename) takes over, prices included.
    const stmtId = await commitImport(
      db,
      await previewFromParsed(db, etradeStatement({ symbol: 'NEWCO' }), 'sym-stmt'),
      { unverified: true },
    );
    expect(await getSetting(db, 'equitySymbol', '')).toBe('NEWCO');
    expect(await db.accounts.get('equity')).toMatchObject({ name: 'NEWCO' });
    expect(await db.prices.get(['NEWCO', '2026-06-30'])).toMatchObject({ value: 30_000 });

    await undoImport(db, stmtId);
    expect(await getSetting(db, 'equitySymbol', '')).toBe('ACME');
    void bhId;
  });

  it('stores a price on a valid E*TRADE statement and no mismatch setting', async () => {
    await commitImport(db, await previewFromParsed(db, benefitHistory(), 'bh-agree'));

    const statement = etradeStatement();
    const preview = await previewFromParsed(db, statement, 'stmt-agree');
    expect(preview.validation.ok).toBe(true);
    await commitImport(db, preview);

    expect(await db.prices.get(['ACME', '2026-06-30'])).toMatchObject({
      value: 30_000,
      source: 'statement',
    });
    expect(await getSetting(db, 'etradeMismatch', null)).toBeNull();
  });

  it('stores the etradeMismatch setting when a statement quantity disagrees', async () => {
    await commitImport(db, await previewFromParsed(db, benefitHistory(), 'bh-mismatch'));

    const statement = etradeStatement({
      quantity: 140,
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
    });
    const preview = await previewFromParsed(db, statement, 'stmt-mismatch');
    const quantity = preview.validation.checks.find((c) => c.name === 'quantity');
    expect(quantity).toMatchObject({ ok: false, expected: 140, actual: 150 });
    expect(preview.validation.ok).toBe(false);

    await commitImport(db, preview, { unverified: true });
    expect(await getSetting(db, 'etradeMismatch', null)).toEqual({ statement: 140, xlsx: 150 });
    expect(await db.prices.get(['ACME', '2026-07-31'])).toMatchObject({ value: 30_000 });

    // A later statement that agrees with the workbook clears the stale mismatch.
    const agreeing = etradeStatement({
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
    });
    const next = await previewFromParsed(db, agreeing, 'stmt-after-mismatch');
    expect(next.validation.ok).toBe(true);
    await commitImport(db, next);
    expect(await getSetting(db, 'etradeMismatch', null)).toBeNull();
  });
});

describe('provisionals and CAS coverage', () => {
  it('confirms an unassigned provisional against a later CAS buy instead of leaving it to double-count', async () => {
    const bank = bankStatement([bankTxn('2026-04-05', INVESTMENT_NARRATION, -2_200_000)]);
    await commitImport(db, await previewFromParsed(db, bank, 'cov-bank'));
    const before = await db.mfProvisional.toArray();
    expect(before).toHaveLength(1);
    expect(before[0].schemeKey).toBe('unassigned');

    const cas = casStatement([
      casScheme('2001', {
        isin: 'INF2001',
        closingUnits: 8_800,
        txns: [casTxn('2026-04-08', 'sip', 2_199_890, 8_800, { stampDuty: 110 })],
      }),
    ]);
    await commitImport(db, await previewFromParsed(db, cas, 'cov-cas'));

    const mfTxns = await db.mfTxns.toArray();
    expect(await db.mfProvisional.get(before[0].id)).toMatchObject({
      status: 'confirmed',
      schemeKey: FOLIO_B,
      confirmedByMfTxnId: mfTxns[0].id,
    });
  });

  it('creates no provisional for a debit that an already-imported CAS covers', async () => {
    const cas = casStatement([
      casScheme('2001', {
        isin: 'INF2001',
        closingUnits: 8_800,
        txns: [casTxn('2026-04-08', 'sip', 2_199_890, 8_800, { stampDuty: 110 })],
      }),
    ]);
    await commitImport(db, await previewFromParsed(db, cas, 'late-cas'));

    const bank = bankStatement([
      bankTxn('2026-04-05', INVESTMENT_NARRATION, -2_200_000), // covered: the units are in the CAS
      bankTxn('2026-04-28', INVESTMENT_NARRATION, -1_500_000, 900_000), // within 7 days of the coverage end
    ]);
    await commitImport(db, await previewFromParsed(db, bank, 'late-bank'));

    const provisionals = await db.mfProvisional.toArray();
    expect(provisionals.map((p) => p.date)).toEqual(['2026-04-28']);
  });

  it('re-estimates a provisional with the first NAV after its debit once one exists', async () => {
    await commitImport(
      db,
      await previewFromParsed(
        db,
        bankStatement([bankTxn('2026-04-05', INVESTMENT_NARRATION, -2_200_000)]),
        'nav-bank-1',
      ),
    );
    const cas = casStatement([
      casScheme('2001', {
        isin: 'INF2001',
        closingUnits: 8_800,
        txns: [casTxn('2026-04-08', 'sip', 2_199_890, 8_800, { stampDuty: 110 })],
      }),
    ]);
    await commitImport(db, await previewFromParsed(db, cas, 'nav-cas-1'));
    await commitImport(
      db,
      await previewFromParsed(
        db,
        bankStatement([bankTxn('2026-05-05', INVESTMENT_NARRATION, -2_200_000)], {
          periodFrom: '2026-05-01',
          periodTo: '2026-05-31',
        }),
        'nav-bank-2',
      ),
    );
    const created = (await db.mfProvisional.toArray()).find((p) => p.date === '2026-05-05');
    expect(created).toMatchObject({ navDate: '2026-04-30', estUnits: estimateUnits(2_200_000, 250_000) });

    // A NAV dated after the debit arrives: the next refresh re-estimates with it.
    await db.prices.put({ symbol: 'MF:INF2001', date: '2026-05-06', value: 260_000, source: 'api' });
    expect(await refreshProvisionalUnits(db)).toBe(1);
    expect(await db.mfProvisional.get(created!.id)).toMatchObject({
      navDate: '2026-05-06',
      estUnits: estimateUnits(2_200_000, 260_000),
    });
    // Already valued with a post-debit NAV: left alone.
    expect(await refreshProvisionalUnits(db)).toBe(0);
  });
});

describe('CAS ordering and undo', () => {
  it('keeps the newer folio when an older statement is imported afterwards', async () => {
    const may = casStatement(
      [
        casScheme('4001', {
          isin: 'INF4001',
          openingUnits: 8_800,
          closingUnits: 17_600,
          txns: [casTxn('2026-05-08', 'sip', 2_199_890, 8_800, { stampDuty: 110 })],
        }),
      ],
      { periodFrom: '2026-05-01', periodTo: '2026-05-31' },
    );
    await commitImport(db, await previewFromParsed(db, may, 'order-may'));

    const april = casStatement([
      casScheme('4001', {
        isin: 'INF4001',
        openingUnits: 0,
        closingUnits: 8_800,
        txns: [casTxn('2026-04-08', 'sip', 2_199_890, 8_800, { stampDuty: 110 })],
      }),
    ]);
    const preview = await previewFromParsed(db, april, 'order-april');
    expect(preview.validation.notes.join(' ')).toContain('kept the newer units');
    await commitImport(db, preview);

    expect(await db.mfFolios.get('4001|INF4001')).toMatchObject({ units: 17_600, asOf: '2026-05-31' });
    expect(await db.mfTxns.count()).toBe(2);
  });

  it('undoing a CAS restores the previous folio and reopens the provisionals it confirmed', async () => {
    await commitImport(
      db,
      await previewFromParsed(
        db,
        bankStatement([bankTxn('2026-04-05', INVESTMENT_NARRATION, -2_200_000)]),
        'undo-bank-1',
      ),
    );
    const first = casStatement([
      casScheme('2001', {
        isin: 'INF2001',
        closingUnits: 8_800,
        txns: [casTxn('2026-04-08', 'sip', 2_199_890, 8_800, { stampDuty: 110 })],
      }),
    ]);
    await commitImport(db, await previewFromParsed(db, first, 'undo-cas-1'));
    await commitImport(
      db,
      await previewFromParsed(
        db,
        bankStatement([bankTxn('2026-05-05', INVESTMENT_NARRATION, -2_200_000)], {
          periodFrom: '2026-05-01',
          periodTo: '2026-05-31',
        }),
        'undo-bank-2',
      ),
    );
    const second = casStatement(
      [
        casScheme('2001', {
          isin: 'INF2001',
          openingUnits: 8_800,
          closingUnits: 17_600,
          nav: 252_000,
          navDate: '2026-05-31',
          txns: [casTxn('2026-05-08', 'sip', 2_199_890, 8_800, { stampDuty: 110, nav: 252_000 })],
        }),
      ],
      { periodFrom: '2026-05-01', periodTo: '2026-05-31' },
    );
    const secondId = await commitImport(db, await previewFromParsed(db, second, 'undo-cas-2'));
    const mayProvisional = (await db.mfProvisional.toArray()).find((p) => p.date === '2026-05-05');
    expect(mayProvisional?.status).toBe('confirmed');

    await undoImport(db, secondId);

    expect(await db.mfFolios.get(FOLIO_B)).toMatchObject({ units: 8_800, asOf: '2026-04-30' });
    expect(await db.prices.get(['MF:INF2001', '2026-05-31'])).toBeUndefined();
    expect(await db.mfTxns.count()).toBe(1);
    const reopened = await db.mfProvisional.get(mayProvisional!.id);
    expect(reopened?.status).not.toBe('confirmed');
    expect(reopened?.confirmedByMfTxnId).toBeUndefined();
  });

  it('undoing a Benefit History restores the previous grants, vests and lots', async () => {
    await commitImport(db, await previewFromParsed(db, benefitHistory(), 'bh-undo-1'));
    const smaller = benefitHistory();
    smaller.lots = smaller.lots.slice(0, 1);
    const secondId = await commitImport(db, await previewFromParsed(db, smaller, 'bh-undo-2'));
    expect(await db.equityLots.count()).toBe(1);

    await undoImport(db, secondId);

    expect(await db.equityLots.count()).toBe(2);
    expect(await db.equityGrants.count()).toBe(1);
    expect(await db.vests.count()).toBe(2);
  });

  it('undoing a statement import brings back the mismatch setting it cleared', async () => {
    await commitImport(db, await previewFromParsed(db, benefitHistory(), 'mm-bh'));
    await commitImport(
      db,
      await previewFromParsed(
        db,
        etradeStatement({ quantity: 140, periodFrom: '2026-07-01', periodTo: '2026-07-31' }),
        'mm-bad',
      ),
      { unverified: true },
    );
    const agreeingId = await commitImport(
      db,
      await previewFromParsed(db, etradeStatement({ periodFrom: '2026-08-01', periodTo: '2026-08-31' }), 'mm-good'),
    );
    expect(await getSetting(db, 'etradeMismatch', null)).toBeNull();

    await undoImport(db, agreeingId);

    expect(await getSetting(db, 'etradeMismatch', null)).toEqual({ statement: 140, xlsx: 150 });
    expect(await db.prices.get(['ACME', '2026-08-31'])).toBeUndefined();
  });
});

describe('import robustness', () => {
  it('imports two identical rows of one file and dedupes the file on re-import', async () => {
    const row = bankTxn('2026-04-10', 'BANK CHARGES', -1_000, 999_000);
    const statement = bankStatement([row, { ...row }]);
    const preview = await previewFromParsed(db, statement, 'dup-file');
    expect(preview.mapped.summary.duplicates).toBe(0);
    await commitImport(db, preview);
    expect(await db.transactions.count()).toBe(2);

    const again = await previewFromParsed(db, statement, 'dup-file-2');
    expect(again.mapped.summary.duplicates).toBe(2);
    expect(again.mapped.tables.transactions ?? []).toHaveLength(0);
  });

  it('accepts an E*TRADE statement before the Benefit History, with a note', async () => {
    const preview = await previewFromParsed(db, etradeStatement(), 'early-stmt');
    expect(preview.validation.ok).toBe(true);
    expect(preview.validation.notes.join(' ')).toContain('Benefit History');
    await commitImport(db, preview);
    expect(await db.prices.get(['ACME', '2026-06-30'])).toMatchObject({ value: 30_000 });
    expect(await getSetting(db, 'etradeMismatch', null)).toBeNull();
  });
});
