import { describe, expect, it } from 'vitest';
import { cashFlowOf } from '../../src/domain/cashFlow';

describe('cashFlowOf', () => {
  it('sets aside excluded-kind rows without dropping other rows in the same category', () => {
    const flow = cashFlowOf(
      [
        { amount: -1_000_00, category: 'Shopping', kind: 'excluded' },
        { amount: -2_000_00, category: 'Shopping', kind: 'normal' },
        { amount: 300_00, category: 'Shopping', kind: 'excluded' },
        { amount: -500_00, category: 'Family', kind: 'normal' },
      ],
      [],
      '2026-10',
      new Set(['Family']),
    );
    expect(flow.income).toBe(0);
    expect(flow.spending).toBe(2_000_00);
    expect(flow.categories).toEqual([{ category: 'Shopping', amount: 2_000_00 }]);
    expect(flow.excluded).toEqual([
      { category: 'Shopping', out: 1_000_00, in: 300_00 },
      { category: 'Family', out: 500_00, in: 0 },
    ]);
  });
});
