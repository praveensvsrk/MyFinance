import { describe, expect, it } from 'vitest';
import {
  cashFlowBetween,
  epfContributed,
  fyRange,
  investedBetween,
  loanRepaid,
  previousRange,
  type InvestTxn,
} from '../../src/domain/financialYear';

const RANGE = { from: '2026-04-01', to: '2026-10-04' } as const;

function txn(partial: Partial<InvestTxn> & Pick<InvestTxn, 'amount' | 'date'>): InvestTxn {
  return {
    accountId: 'sbi',
    description: 'UPI',
    category: 'Other',
    kind: 'normal',
    ...partial,
  };
}

describe('fyRange', () => {
  it('cuts the open year off at today and keeps a finished year whole', () => {
    expect(fyRange(2026, '2026-10-04')).toEqual({ from: '2026-04-01', to: '2026-10-04', partial: true });
    expect(fyRange(2025, '2026-10-04')).toEqual({ from: '2025-04-01', to: '2026-03-31', partial: false });
  });

  it('steps back the same calendar span, not the whole previous year', () => {
    expect(previousRange(fyRange(2026, '2026-10-04'))).toEqual({ from: '2025-04-01', to: '2025-10-04' });
    expect(previousRange(fyRange(2025, '2026-10-04'))).toEqual({ from: '2024-04-01', to: '2025-03-31' });
  });
});

describe('cashFlowBetween', () => {
  it('stops a partial month on the range end and still splits that month’s EMI', () => {
    const flow = cashFlowBetween(
      [
        txn({ date: '2026-10-03', amount: -80_000_00, category: 'Loan EMI' }),
        txn({ date: '2026-10-20', amount: -9_999_00, category: 'Shopping' }),
        txn({ date: '2026-05-02', amount: 1_000_00_00, category: 'Salary', kind: 'normal' }),
        txn({ date: '2026-05-03', amount: -5_000_00, category: 'Investments', kind: 'investment' }),
      ],
      [
        { date: '2026-10-03', kind: 'emi', amount: 80_000_00 },
        { date: '2026-10-03', kind: 'interest', amount: 30_000_00 },
        { date: '2026-10-25', kind: 'interest', amount: 99_000_00 },
      ],
      RANGE,
    );
    expect(flow.income).toBe(1_000_00_00);
    // The 25 Oct interest is after the range, so only ₹30,000 of the EMI is spending. The SIP is not.
    expect(flow.spending).toBe(30_000_00);
    expect(flow.categories).toEqual([{ category: 'Loan EMI', amount: 30_000_00 }]);
  });

  it('sets aside excluded categories across months instead of counting them', () => {
    const flow = cashFlowBetween(
      [
        txn({ date: '2026-05-02', amount: -2_000_00, category: 'Family' }),
        txn({ date: '2026-06-02', amount: -3_000_00, category: 'Family' }),
        txn({ date: '2026-06-03', amount: 500_00, category: 'Family' }),
        txn({ date: '2026-06-04', amount: -700_00, category: 'Shopping' }),
      ],
      [],
      RANGE,
      new Set(['Family']),
    );
    expect(flow.spending).toBe(700_00);
    expect(flow.income).toBe(0);
    expect(flow.excluded).toEqual([{ category: 'Family', out: 5_000_00, in: 500_00 }]);
  });

  it('sets aside excluded-kind rows across months without dropping the rest of that category', () => {
    const flow = cashFlowBetween(
      [
        txn({ date: '2026-05-02', amount: -1_000_00, category: 'Shopping', kind: 'excluded' }),
        txn({ date: '2026-06-02', amount: -2_000_00, category: 'Shopping' }),
      ],
      [],
      RANGE,
    );
    expect(flow.spending).toBe(2_000_00);
    expect(flow.categories).toEqual([{ category: 'Shopping', amount: 2_000_00 }]);
    expect(flow.excluded).toEqual([{ category: 'Shopping', out: 1_000_00, in: 0 }]);
  });
});

describe('investedBetween', () => {
  it('splits PPF from other investments and counts a PPF credit only once', () => {
    const ppf = new Set(['ppf']);
    const split = investedBetween(
      [
        txn({ date: '2026-05-05', amount: -10_000_00, kind: 'investment', description: 'ACH GROWW MUTUAL FUND' }),
        txn({ date: '2026-06-04', amount: -1_50_000_00, kind: 'investment', description: 'PPF DEPOSIT' }),
        txn({ date: '2026-06-04', accountId: 'ppf', amount: 1_50_000_00, kind: 'transfer', description: 'PPF credit' }),
        txn({ date: '2026-07-01', accountId: 'ppf', amount: 20_000_00, kind: 'normal', description: 'Deposit' }),
        txn({ date: '2026-03-31', accountId: 'ppf', amount: 5_000_00, kind: 'interest', description: 'Interest' }),
      ],
      ppf,
      RANGE,
    );
    expect(split).toEqual({ other: 10_000_00, ppf: 1_50_000_00 + 20_000_00 });
  });
});

describe('epfContributed and loanRepaid', () => {
  it('keeps contribution shares and drops interest and transfers', () => {
    expect(
      epfContributed(
        [
          { kind: 'contribution', creditDate: '2026-05-15', ee: 10_000_00, er: 10_000_00 },
          { kind: 'interest', creditDate: '2026-03-31', ee: 50_000_00, er: 50_000_00 },
          { kind: 'transferIn', creditDate: '2026-06-01', ee: 1_000_00, er: 1_000_00 },
          { kind: 'contribution', creditDate: '2025-05-15', ee: 9_000_00, er: 9_000_00 },
        ],
        RANGE,
      ),
    ).toEqual({ employee: 10_000_00, employer: 10_000_00 });
  });

  it('treats principal as payments minus interest when the entry has no split', () => {
    expect(
      loanRepaid(
        [
          { date: '2026-05-25', kind: 'interest', amount: 40_000_00 },
          { date: '2026-05-25', kind: 'emi', amount: 80_000_00 },
          { date: '2026-06-01', kind: 'prepayment', amount: 1_000_00_00 },
          { date: '2025-05-25', kind: 'emi', amount: 80_000_00 },
        ],
        RANGE,
      ),
    ).toEqual({ interest: 40_000_00, principal: 80_000_00 - 40_000_00 + 1_000_00_00 });
  });
});
