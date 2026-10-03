import type { CasStatement, Check, Validation } from '../../parsers/types';
import type { AccountRow, FinanceDb, MfFolioRow, MfTxnRow, PriceRow } from '../../db/schema';
import { newId } from '../../db/repos';
import { fingerprint } from '../hash';
import type { Mapped } from '../importPipeline';

/** Adds (or refreshes) a validation check and recomputes the overall verdict. */
function setCheck(validation: Validation, checkToAdd: Check): void {
  const index = validation.checks.findIndex((existing) => existing.name === checkToAdd.name);
  if (index === -1) validation.checks.push(checkToAdd);
  else validation.checks[index] = checkToAdd;
  validation.ok = validation.checks.every((existing) => existing.ok);
}

/**
 * Maps a CAMS/KFintech CAS: upserts the single `mf` account, replaces every folio with the
 * statement's closing units and stores each scheme's CAS NAV (keyed by ISIN) so the bank hook can
 * value a provisional before the price service has resolved the AMFI code.
 *
 * A folio whose stored `asOf` predates this statement must carry the statement's opening units;
 * otherwise the preview gets a failing `continuity:<scheme>` check. Reversals are not stored.
 */
export async function mapCas(db: FinanceDb, s: CasStatement): Promise<Mapped> {
  const account: AccountRow = {
    id: 'mf',
    kind: 'mf',
    institution: 'CAMS',
    maskedNumber: '',
    name: 'Mutual funds',
    meta: { source: 'cas' },
  };

  const folios: MfFolioRow[] = [];
  const txns: MfTxnRow[] = [];
  const prices: PriceRow[] = [];
  const replace: NonNullable<Mapped['replace']> = [];
  const priceKeys = new Set<string>();

  for (const scheme of s.schemes) {
    const folioId = `${scheme.folio}|${scheme.isin}`;
    const existing = await db.mfFolios.get(folioId);
    if (existing && existing.asOf < s.periodFrom && existing.units !== scheme.openingUnits) {
      setCheck(s.validation, {
        name: `continuity:${scheme.name}`,
        expected: scheme.openingUnits,
        actual: existing.units,
        ok: false,
      });
    }

    folios.push({
      id: folioId,
      folio: scheme.folio,
      amc: scheme.amc,
      scheme: scheme.name,
      isin: scheme.isin,
      amfiCode: existing?.amfiCode ?? null,
      holdingMode: scheme.demat ? 'demat' : 'soa',
      units: scheme.closingUnits,
      asOf: s.periodTo,
      historyComplete: scheme.openingUnits === 0 || existing?.historyComplete === true,
    });
    replace.push({ table: 'mfFolios', where: { id: folioId } });

    for (const txn of scheme.txns) {
      if (txn.type === 'reversal') continue;
      txns.push({
        id: newId(),
        folioId,
        date: txn.date,
        description: txn.description,
        type: txn.type,
        amount: txn.amount,
        units: txn.units,
        nav: txn.nav,
        stampDuty: txn.stampDuty,
        importId: '',
        fingerprint: await fingerprint([folioId, txn.date, txn.type, txn.amount, txn.units]),
      });
    }

    // The CAS NAV is the fallback for a folio whose AMFI code is not resolved yet, so it is
    // stored under the scheme's ISIN (the price service's own identifier when there is no code).
    const symbol = `MF:${scheme.isin}`;
    const priceKey = `${symbol}|${scheme.navDate}`;
    if (!priceKeys.has(priceKey)) {
      priceKeys.add(priceKey);
      prices.push({ symbol, date: scheme.navDate, value: scheme.nav, source: 'statement' });
      replace.push({ table: 'prices', where: { symbol, date: scheme.navDate } });
    }
  }

  return {
    tables: { mfFolios: folios, mfTxns: txns, prices },
    replace,
    accountsToUpsert: [account],
    summary: {
      period: [s.periodFrom, s.periodTo],
      counts: { mfFolios: folios.length, mfTxns: txns.length, prices: prices.length },
      duplicates: 0,
    },
  };
}
