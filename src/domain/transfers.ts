import type { IsoDate } from '../parsers/types';
import type { TxnKind } from './categorise';
import { daysBetween } from './dates';

export interface TransferTxn {
  id: string;
  accountId: string;
  date: IsoDate;
  amount: number;
  kind: TxnKind;
  description?: string;
}

const MAX_DAY_GAP = 3;

/** A Federal branch move: both legs sit in the same account on the same date and say "Ac xfr". */
function isBranchMove(a: TransferTxn, b: TransferTxn): boolean {
  return (
    a.accountId === b.accountId &&
    a.date === b.date &&
    (a.description ?? '').startsWith('Ac xfr') &&
    (b.description ?? '').startsWith('Ac xfr')
  );
}

/**
 * Pairs each debit with the best equal-and-opposite credit in another account within ±3 days,
 * closest date first, then earliest. Each transaction is used at most once and rows already marked
 * as `transfer` are skipped. A same-account pair is only allowed for a same-date "Ac xfr" move.
 * Returns `[debitId, creditId]` pairs.
 */
export function matchTransfers(txns: TransferTxn[]): [string, string][] {
  const indexed = txns
    .map((txn, index) => ({ txn, index }))
    .filter(({ txn }) => txn.kind !== 'transfer');
  const debits = indexed.filter(({ txn }) => txn.amount < 0);
  const credits = indexed.filter(({ txn }) => txn.amount > 0);
  const used = new Set<number>();
  const pairs: [string, string][] = [];

  for (const debit of debits) {
    let best: { txn: TransferTxn; index: number; distance: number } | null = null;
    for (const credit of credits) {
      if (used.has(credit.index)) continue;
      if (credit.txn.amount !== -debit.txn.amount) continue;
      const distance = Math.abs(daysBetween(debit.txn.date, credit.txn.date));
      if (distance > MAX_DAY_GAP) continue;
      if (credit.txn.accountId === debit.txn.accountId && !isBranchMove(debit.txn, credit.txn)) continue;
      if (
        best === null ||
        distance < best.distance ||
        (distance === best.distance && credit.txn.date < best.txn.date)
      ) {
        best = { txn: credit.txn, index: credit.index, distance };
      }
    }
    if (best !== null) {
      used.add(debit.index);
      used.add(best.index);
      pairs.push([debit.txn.id, best.txn.id]);
    }
  }
  return pairs;
}
