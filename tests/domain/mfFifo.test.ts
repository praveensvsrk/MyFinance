import { describe, expect, it } from 'vitest';
import { fifoLots, fifoRemainingCost, type FifoTxn } from '../../src/domain/mfFifo';

const buy = (date: string, amount: number, units: number, stampDuty = 0): FifoTxn => ({ date, type: 'sip', amount, units, stampDuty });

describe('fifoLots', () => {
  it('includes stamp duty in the cost of each lot', () => {
    expect(fifoRemainingCost([buy('2026-01-01', 999950, 100000, 50)])).toBe(1000000);
  });

  it('redeems from the oldest lot first, pro rata within a lot', () => {
    const lots = fifoLots([
      buy('2026-01-01', 100000, 1000),
      buy('2026-02-01', 300000, 2000),
      { date: '2026-03-01', type: 'redemption', amount: -250000, units: -1500, stampDuty: 0 },
    ]);
    expect(lots).toEqual([{ date: '2026-02-01', units: 1500, cost: 225000 }]);
  });

  it('removes the matching lot for a rejection instead of redeeming FIFO', () => {
    const cost = fifoRemainingCost([
      buy('2019-08-02', 500000, 280000),
      buy('2019-10-14', 500000, 300000),
      { date: '2019-10-14', type: 'reversal', amount: -500000, units: -300000, stampDuty: 0 },
    ]);
    expect(cost).toBe(500000);
  });

  it('ignores rows without units', () => {
    expect(fifoLots([{ date: '2026-01-01', type: 'dividend', amount: 100, units: 0, stampDuty: 0 }])).toEqual([]);
  });
});
