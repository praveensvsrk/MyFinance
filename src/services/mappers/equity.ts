import type { BenefitHistory, Check, EtradeStatement, Validation, VestRec } from '../../parsers/types';
import { crossCheck } from '../../domain/equity';
import { todayIso } from '../../domain/dates';
import type { AccountRow, EquityGrantRow, EquityLotRow, FinanceDb, VestRow } from '../../db/schema';
import { newId } from '../../db/repos';
import type { Mapped } from '../importPipeline';

/** Adds (or refreshes) a validation check and recomputes the overall verdict. */
function setCheck(validation: Validation, checkToAdd: Check): void {
  const index = validation.checks.findIndex((existing) => existing.name === checkToAdd.name);
  if (index === -1) validation.checks.push(checkToAdd);
  else validation.checks[index] = checkToAdd;
  validation.ok = validation.checks.every((existing) => existing.ok);
}

const EQUITY_ACCOUNT: AccountRow = {
  id: 'equity',
  kind: 'equity',
  institution: 'E*TRADE',
  maskedNumber: '',
  name: 'ACME',
  meta: { symbol: 'ACME' },
};

/** Stored vest row → the parser shape `crossCheck` consumes. */
function asVestRec(row: VestRow): VestRec {
  return {
    grantNumber: row.grantNumber ?? '',
    period: row.period,
    vestDate: row.vestDate,
    shares: row.shares,
    cancelledShares: row.cancelledShares ?? 0,
    vestedShares: row.vestedShares ?? 0,
    releasedShares: row.releasedShares ?? 0,
    sellableShares: row.sellableShares ?? 0,
    sharesWithheld: row.sharesWithheld ?? 0,
    fmvUsdCents: row.fmvUsdCents ?? null,
    taxableGainUsdCents: row.taxableGainUsdCents ?? null,
    taxRatePct: row.taxRatePct ?? null,
    status: row.status,
  };
}

/**
 * Maps the E*TRADE Benefit History: replaces the whole grant/vest/lot history with the workbook's
 * rows. Lots carry the USDINR rate stored for their acquisition date, or null for the price
 * service to backfill. ESPP lots have no stored purchase row, so `esppPurchaseId` is null.
 */
export async function mapBenefitHistory(db: FinanceDb, b: BenefitHistory): Promise<Mapped> {
  const grantIds = new Map<string, string>();
  const grants: EquityGrantRow[] = b.grants.map((g) => {
    const id = newId();
    grantIds.set(g.grantNumber, id);
    return {
      id,
      grantNumber: g.grantNumber,
      type: g.type,
      grantDate: g.grantDate,
      totalShares: g.totalShares,
      cancelledShares: g.cancelledShares,
      vestedShares: g.vestedShares,
      unvestedShares: g.unvestedShares,
      sellableShares: g.sellableShares,
    };
  });

  const vestIdByKey = new Map<string, string>();
  const vestRows: VestRow[] = b.vests.map((v) => {
    const id = newId();
    vestIdByKey.set(`${v.grantNumber}#${v.period}`, id);
    return {
      id,
      grantId: grantIds.get(v.grantNumber) ?? '',
      period: v.period,
      vestDate: v.vestDate,
      shares: v.shares,
      status: v.status,
      grantNumber: v.grantNumber,
      cancelledShares: v.cancelledShares,
      vestedShares: v.vestedShares,
      releasedShares: v.releasedShares,
      sellableShares: v.sellableShares,
      sharesWithheld: v.sharesWithheld,
      fmvUsdCents: v.fmvUsdCents,
      taxableGainUsdCents: v.taxableGainUsdCents,
      taxRatePct: v.taxRatePct,
    };
  });

  const lotRows: EquityLotRow[] = [];
  for (const lot of b.lots) {
    const price = await db.prices.get(['USDINR', lot.acquiredDate]);
    lotRows.push({
      id: newId(),
      vestId: lot.source === 'RSU' ? (vestIdByKey.get(lot.key) ?? null) : null,
      esppPurchaseId: null,
      key: lot.key,
      acquiredDate: lot.acquiredDate,
      netShares: lot.netShares,
      remainingShares: lot.remainingShares,
      costPerShareUsdCents: lot.costPerShareUsdCents,
      remainingCostUsdCents: lot.remainingCostUsdCents,
      usdInrOnAcquire: price && Number.isFinite(price.value) ? price.value : null,
      source: lot.source,
    });
  }

  return {
    tables: { equityGrants: grants, vests: vestRows, equityLots: lotRows },
    replace: [
      { table: 'equityGrants', where: {} },
      { table: 'vests', where: {} },
      { table: 'equityLots', where: {} },
    ],
    accountsToUpsert: [{ ...EQUITY_ACCOUNT }],
    summary: {
      period: [todayIso(), todayIso()],
      counts: { equityGrants: grants.length, vests: vestRows.length, equityLots: lotRows.length },
      duplicates: 0,
    },
  };
}

/**
 * Maps an E*TRADE statement: stores the statement price and cross-checks the held quantity, cost
 * and unvested shares against the Benefit History rows. A quantity mismatch is kept in the
 * `etradeMismatch` setting for Needs attention.
 */
export async function mapEtradeStatement(db: FinanceDb, s: EtradeStatement): Promise<Mapped> {
  const lots = await db.equityLots.toArray();
  const vestRows = await db.vests.toArray();
  for (const check of crossCheck(s, lots, vestRows.map(asVestRec))) setCheck(s.validation, check);

  const tables: Mapped['tables'] = {
    prices: [{ symbol: s.symbol, date: s.periodTo, value: s.priceUsdCents, source: 'statement' }],
  };
  const replace: NonNullable<Mapped['replace']> = [
    { table: 'prices', where: { symbol: s.symbol, date: s.periodTo } },
    // An agreeing statement resolves any earlier mismatch.
    { table: 'settings', where: { key: 'etradeMismatch' } },
  ];
  const quantity = s.validation.checks.find((check) => check.name === 'quantity');
  if (quantity && !quantity.ok) {
    tables.settings = [
      {
        key: 'etradeMismatch',
        value: { statement: Number(quantity.expected), xlsx: Number(quantity.actual) },
      },
    ];
  }

  return {
    tables,
    replace,
    accountsToUpsert: [{ ...EQUITY_ACCOUNT }],
    summary: { period: [s.periodFrom, s.periodTo], counts: { prices: 1 }, duplicates: 0 },
  };
}
