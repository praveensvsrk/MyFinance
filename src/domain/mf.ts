import type { CasTxn, IsoDate, Paise } from '../parsers/types';
import { fifoRemainingCost, type FifoTxn } from './mfFifo';

/** Current units (×1000) from transactions dated on or before `date`. */
export function unitsAt(txns: { date: IsoDate; units: number }[], date: IsoDate): number {
  let total = 0;
  for (const t of txns) {
    if (t.date <= date) total += t.units;
  }
  return total;
}

/** Value of `units` (×1000) at `nav` (×10⁴) in paise. */
export function schemeValue(units: number, nav: number): Paise {
  return Math.round((units / 1000) * (nav / 10_000) * 100);
}

/** FIFO cost still invested: amount + stamp duty of the open lots. */
export function investedCost(txns: FifoTxn[]): Paise {
  return fifoRemainingCost(txns);
}

/**
 * Cash flows for XIRR, in the investor's sign convention: money paid out is
 * negative (purchase gross = amount + stamp duty), money received — redemptions
 * (amount is already negative in a CasTxn) and the final value — is positive.
 */
export function schemeCashflows(txns: CasTxn[], valueDate: IsoDate, value: number): { date: IsoDate; amount: number }[] {
  const flows = txns.map((t) => ({ date: t.date, amount: -(t.amount + t.stampDuty) }));
  flows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  flows.push({ date: valueDate, amount: value });
  return flows;
}
