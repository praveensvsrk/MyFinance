import type { Check, EtradeStatement, IsoDate, LotRec, Paise, VestRec } from '../parsers/types';

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

/** INR value (paise) of the remaining shares at a USD price (cents) and a USDINR rate (×10⁴). */
export function releasedValueInr(
  lots: { remainingShares: number }[],
  priceUsdCents: number,
  usdInr: number,
): Paise {
  let usdCents = 0;
  for (const lot of lots) usdCents += lot.remainingShares * priceUsdCents;
  return Math.round((usdCents * usdInr) / 10_000);
}

/** Shares of vests that are still unvested and vest after `today`. */
export function unvestedShares(vests: VestRec[], today: IsoDate): number {
  let total = 0;
  for (const v of vests) {
    if (v.status === 'unvested' && v.vestDate > today) total += v.shares;
  }
  return total;
}

/** The next future vest date, with all grants vesting that day summed. */
export function upcomingVest(vests: VestRec[], today: IsoDate): { date: IsoDate; shares: number } | null {
  let date: IsoDate | null = null;
  let shares = 0;
  for (const v of vests) {
    if (v.status !== 'unvested' || v.vestDate <= today) continue;
    if (date === null || v.vestDate < date) {
      date = v.vestDate;
      shares = v.shares;
    } else if (v.vestDate === date) {
      shares += v.shares;
    }
  }
  return date === null ? null : { date, shares };
}

/**
 * INR gain (paise) on a lot: today's value (current price at the current USDINR rate)
 * minus the cost basis (acquire-rate USDINR). Positive on appreciation.
 */
export function lotGainInr(
  lot: { remainingShares: number; costPerShareUsdCents: number; usdInrOnAcquire: number },
  priceUsdCents: number,
  usdInr: number,
): Paise {
  const value = Math.round((lot.remainingShares * priceUsdCents * usdInr) / 10_000);
  const cost = Math.round((lot.remainingShares * lot.costPerShareUsdCents * lot.usdInrOnAcquire) / 10_000);
  return value - cost;
}

/**
 * Cross-checks an E*TRADE statement against the stored lots and vests:
 * held quantity to 4 dp, total cost within ±100 cents, and unvested quantity per grant.
 */
export function crossCheck(stmt: EtradeStatement, lots: LotRec[], vests: VestRec[]): Check[] {
  const checks: Check[] = [];

  const heldShares = round4(lots.reduce((a, l) => a + l.remainingShares, 0));
  const stmtQuantity = round4(stmt.quantity);
  checks.push({ name: 'quantity', expected: stmtQuantity, actual: heldShares, ok: heldShares === stmtQuantity });

  const remainingCost = lots.reduce((a, l) => a + l.remainingCostUsdCents, 0);
  checks.push({
    name: 'cost',
    expected: stmt.totalCostUsdCents,
    actual: remainingCost,
    ok: Math.abs(remainingCost - stmt.totalCostUsdCents) <= 100,
  });

  const unvestedByGrant = new Map<string, number>();
  for (const v of vests) {
    if (v.status !== 'unvested') continue;
    unvestedByGrant.set(v.grantNumber, (unvestedByGrant.get(v.grantNumber) ?? 0) + v.shares);
  }
  for (const u of stmt.unvested) {
    const expected = round4(u.quantity);
    const actual = round4(unvestedByGrant.get(u.grantNumber) ?? 0);
    checks.push({ name: `unvested:${u.grantNumber}`, expected, actual, ok: actual === expected });
  }

  return checks;
}
