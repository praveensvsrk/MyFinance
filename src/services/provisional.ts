import type { IsoDate } from '../parsers/types';
import type { FinanceDb, PriceRow } from '../db/schema';
import { pricesFor } from '../db/repos';
import { estimateUnits } from '../domain/mfProvisional';

/** NAV candidates for a provisional: the first one after the debit, else the latest on or before it. */
interface NavSeriesPick {
  after: PriceRow | null;
  before: PriceRow | null;
}

function pickAround(rows: PriceRow[], date: IsoDate): NavSeriesPick {
  let after: PriceRow | null = null;
  let before: PriceRow | null = null;
  for (const row of rows) {
    if (row.date > date) {
      after = row;
      break;
    }
    before = row;
  }
  return { after, before };
}

/**
 * The NAV (×10⁴) to value a provisional with (§5.6): the first NAV dated after the debit, and until
 * one exists the latest NAV on or before it. The scheme's AMFI price series wins a tie with the CAS
 * NAV stored under its ISIN, which is the fallback while the AMFI code is unresolved.
 */
export async function provisionalNav(
  db: FinanceDb,
  schemeKey: string,
  debitDate: IsoDate,
): Promise<PriceRow | null> {
  const folio = await db.mfFolios.get(schemeKey);
  if (!folio) return null;

  const picks: NavSeriesPick[] = [];
  if (typeof folio.amfiCode === 'number' && Number.isFinite(folio.amfiCode)) {
    picks.push(pickAround(await pricesFor(db, `MF:${folio.amfiCode}`), debitDate));
  }
  picks.push(pickAround(await pricesFor(db, `MF:${folio.isin === '' ? folio.id : folio.isin}`), debitDate));

  let after: PriceRow | null = null;
  for (const pick of picks) {
    if (pick.after !== null && (after === null || pick.after.date < after.date)) after = pick.after;
  }
  if (after !== null) return after;

  let before: PriceRow | null = null;
  for (const pick of picks) {
    if (pick.before !== null && (before === null || pick.before.date > before.date)) before = pick.before;
  }
  return before;
}

/**
 * Re-estimates the units of every assigned provisional that has not yet been valued with a NAV dated
 * after its debit: either no NAV was known at the time, or only a NAV on or before the debit date.
 * Called after a price refresh and after an undo. Returns how many provisionals changed.
 */
export async function refreshProvisionalUnits(db: FinanceDb): Promise<number> {
  const open = await db.mfProvisional
    .filter((p) => p.status !== 'confirmed' && p.schemeKey !== 'unassigned')
    .toArray();
  const changed = [];
  for (const p of open) {
    if (p.navDate !== null && p.navDate > p.date) continue;
    const nav = await provisionalNav(db, p.schemeKey, p.date);
    if (nav === null || (nav.date === p.navDate && p.estUnits > 0)) continue;
    changed.push({ ...p, estUnits: estimateUnits(p.grossPaise, nav.value), navDate: nav.date });
  }
  if (changed.length > 0) await db.mfProvisional.bulkPut(changed);
  return changed.length;
}
