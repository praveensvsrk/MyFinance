import type { EpfPassbook, IsoDate, Paise } from '../parsers/types';
import { addDays, fyEndDate, fyStart } from './dates';

export type EpfEntryKind =
  | 'opening'
  | 'contribution'
  | 'transferIn'
  | 'transferOut'
  | 'withdrawal'
  | 'interest';

export interface EpfEntry {
  accountId: string;
  fy: number;
  kind: EpfEntryKind;
  wageMonth?: string;
  creditDate: IsoDate;
  ee: Paise;
  er: Paise;
  eps: Paise;
  linkedMemberId?: string;
  inferred?: boolean;
}

export interface EpfBalance {
  ee: Paise;
  er: Paise;
  eps: Paise;
  total: Paise;
}

export interface EpfAccountLink {
  accountId: string;
  memberId: string;
}

/** Maps a passbook into stored entries: opening, one per row, then the FY-end interest entry. */
export function passbookToEntries(accountId: string, p: EpfPassbook): EpfEntry[] {
  const entries: EpfEntry[] = [
    {
      accountId,
      fy: p.fyStart,
      kind: 'opening',
      creditDate: `${p.fyStart}-04-01`,
      ee: p.opening.ee,
      er: p.opening.er,
      eps: p.opening.eps,
    },
  ];
  for (const row of p.rows) {
    entries.push({
      accountId,
      fy: p.fyStart,
      kind: row.kind,
      wageMonth: row.wageMonth,
      creditDate: row.creditDate,
      ee: row.amounts.ee,
      er: row.amounts.er,
      eps: row.amounts.eps,
      ...(row.fromMemberId === undefined ? {} : { linkedMemberId: row.fromMemberId }),
    });
  }
  if (p.interest !== null) {
    entries.push({
      accountId,
      fy: p.fyStart,
      kind: 'interest',
      creditDate: fyEndDate(p.fyStart),
      ee: p.interest.ee,
      er: p.interest.er,
      eps: p.interest.eps,
    });
  }
  return entries;
}

/**
 * The balance on `date`: the latest FY opening entry on or before it is the base, then the entries of
 * that FY credited on or before it (rows and, once dated, the interest). `total` is EE + ER; EPS is
 * pension and tracked separately.
 */
export function epfBalanceAt(entries: EpfEntry[], date: IsoDate): EpfBalance {
  let base: EpfEntry | null = null;
  for (const entry of entries) {
    if (entry.kind !== 'opening' || entry.creditDate > date) continue;
    if (base === null || entry.creditDate >= base.creditDate) base = entry;
  }
  if (base === null) return { ee: 0, er: 0, eps: 0, total: 0 };

  let ee = 0;
  let er = 0;
  let eps = 0;
  for (const entry of entries) {
    if (entry.fy !== base.fy || entry.creditDate > date) continue;
    ee += entry.ee;
    er += entry.er;
    eps += entry.eps;
  }
  return { ee, er, eps, total: ee + er };
}

/** True when `entries` already carries the synthetic entries for this transfer. */
function hasSynthetic(entries: EpfEntry[], accountId: string, transferDate: IsoDate): boolean {
  const dayBefore = addDays(transferDate, -1);
  return entries.some(
    (entry) =>
      entry.accountId === accountId &&
      ((entry.kind === 'transferOut' && entry.creditDate === transferDate) ||
        (entry.inferred === true && (entry.creditDate === transferDate || entry.creditDate === dayBefore))),
  );
}

/**
 * Builds the synthetic entries that reconcile passbook transfers between accounts.
 *
 * Each `transferIn` linked to another account closes that old account with a `transferOut` on the
 * transfer date. When the transfer exceeds the old balance, the difference is first booked as an
 * inferred interest entry dated the day before (split EE/ER proportionally to the transfer), so the
 * old account lands exactly on 0. Already-synthesised transfers are skipped.
 */
export function linkTransfers(accounts: EpfAccountLink[], entries: EpfEntry[]): EpfEntry[] {
  const accountByMember = new Map(accounts.map((account) => [account.memberId, account.accountId]));
  const synthetic: EpfEntry[] = [];
  const working = [...entries];

  for (const transfer of entries) {
    if (transfer.kind !== 'transferIn' || transfer.linkedMemberId === undefined) continue;
    const oldAccountId = accountByMember.get(transfer.linkedMemberId);
    if (oldAccountId === undefined || oldAccountId === transfer.accountId) continue;
    if (hasSynthetic(working, oldAccountId, transfer.creditDate)) continue;

    const before = epfBalanceAt(
      working.filter((entry) => entry.accountId === oldAccountId),
      transfer.creditDate,
    );
    const transferTotal = transfer.ee + transfer.er;
    let closingEe = before.ee;
    let closingEr = before.er;
    let closingEps = before.eps;

    if (transferTotal > before.total) {
      const difference = transferTotal - before.total;
      const eeShare = Math.round((difference * transfer.ee) / transferTotal);
      const erShare = difference - eeShare;
      const inferred: EpfEntry = {
        accountId: oldAccountId,
        // Dated the day before, but grouped into the transfer's FY so that `epfBalanceAt` adds it
        // together with the transferOut when the transfer falls on April 1.
        fy: fyStart(transfer.creditDate),
        kind: 'interest',
        creditDate: addDays(transfer.creditDate, -1),
        ee: eeShare,
        er: erShare,
        eps: 0,
        inferred: true,
      };
      synthetic.push(inferred);
      working.push(inferred);
      closingEe += eeShare;
      closingEr += erShare;
    }

    const transferOut: EpfEntry = {
      accountId: oldAccountId,
      fy: fyStart(transfer.creditDate),
      kind: 'transferOut',
      creditDate: transfer.creditDate,
      ee: -closingEe,
      er: -closingEr,
      eps: -closingEps,
      inferred: true,
    };
    synthetic.push(transferOut);
    working.push(transferOut);
  }
  return synthetic;
}
