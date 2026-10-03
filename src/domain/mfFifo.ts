/** A unit-moving MF transaction. amount/stampDuty in paise, units ×1000 (signed). */
export interface FifoTxn {
  date: string;
  type: string;
  amount: number;
  units: number;
  stampDuty: number;
}

export interface FifoLot {
  date: string;
  units: number;
  /** Paise, unrounded (pro-rata splits leave fractions). */
  cost: number;
}

/**
 * Open lots after replaying transactions FIFO. Inflows create lots at amount + stamp duty.
 * A 'reversal' (e.g. SIP rejection) removes the most recent lot with exactly the same units; other outflows
 * consume the oldest lots first, reducing a partly consumed lot's cost pro rata.
 */
export function fifoLots(txns: FifoTxn[]): FifoLot[] {
  const lots: FifoLot[] = [];
  for (const t of txns) {
    if (t.units > 0) {
      lots.push({ date: t.date, units: t.units, cost: t.amount + t.stampDuty });
      continue;
    }
    if (t.units === 0) continue;
    if (t.type === 'reversal') {
      let idx = -1;
      for (let i = lots.length - 1; i >= 0; i--) {
        if (lots[i].units === -t.units) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        lots.splice(idx, 1);
        continue;
      }
    }
    let toSell = -t.units;
    while (toSell > 0 && lots.length) {
      const lot = lots[0];
      if (lot.units <= toSell) {
        toSell -= lot.units;
        lots.shift();
      } else {
        lot.cost = (lot.cost * (lot.units - toSell)) / lot.units;
        lot.units -= toSell;
        toSell = 0;
      }
    }
  }
  return lots;
}

export function fifoRemainingCost(txns: FifoTxn[]): number {
  return Math.round(fifoLots(txns).reduce((a, l) => a + l.cost, 0));
}
