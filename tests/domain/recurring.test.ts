import { describe, expect, it } from 'vitest';
import { findRecurring, type Payment } from '../../src/domain/recurring';

function pay(payee: string, date: string, amount: number, category: string | null = null): Payment {
  return { payee, date, amount, category };
}

function monthly(payee: string, dates: string[], amount: number, category: string | null = null): Payment[] {
  return dates.map((date) => pay(payee, date, amount, category));
}

describe('findRecurring', () => {
  it('finds a monthly payment and when it is next due', () => {
    const payments = monthly('NETFLIX', ['2026-06-07', '2026-07-07', '2026-08-06', '2026-09-07'], 649_00, 'Subscriptions');
    expect(findRecurring(payments, '2026-09-30', '2026-10-03')).toEqual([
      {
        payee: 'NETFLIX',
        category: 'Subscriptions',
        amount: 649_00,
        cadence: 'monthly',
        last: '2026-09-07',
        next: '2026-10-07',
        count: 4,
        perMonth: 649_00,
      },
    ]);
  });

  it('needs at least three payments a month apart', () => {
    expect(findRecurring(monthly('GYM', ['2026-08-01', '2026-09-01'], 2_000_00), '2026-09-30', '2026-10-03')).toEqual([]);
  });

  it('ignores a payee paid many times a month', () => {
    const swiggy = ['2026-07-02', '2026-07-09', '2026-07-20', '2026-08-03', '2026-08-15', '2026-09-01', '2026-09-12'];
    expect(findRecurring(monthly('SWIGGY', swiggy, 400_00), '2026-09-30', '2026-10-03')).toEqual([]);
  });

  it('ignores payments a month apart whose amounts are all over the place', () => {
    const payments = [pay('AMAZON', '2026-06-10', 300_00), pay('AMAZON', '2026-07-10', 9_000_00), pay('AMAZON', '2026-08-10', 1_500_00), pay('AMAZON', '2026-09-10', 40_00)];
    expect(findRecurring(payments, '2026-09-30', '2026-10-03')).toEqual([]);
  });

  it('allows a bill that varies, using the middle amount', () => {
    const payments = [pay('BESCOM', '2026-06-12', 1_200_00), pay('BESCOM', '2026-07-12', 1_500_00), pay('BESCOM', '2026-08-13', 1_100_00), pay('BESCOM', '2026-09-12', 1_400_00)];
    const [bill] = findRecurring(payments, '2026-09-30', '2026-10-03');
    expect(bill?.amount).toBe(1_300_00);
    expect(bill?.next).toBe('2026-10-12');
  });

  it('tolerates one odd gap, such as a skipped month', () => {
    const payments = monthly('SIP', ['2026-04-05', '2026-05-05', '2026-07-05', '2026-08-05', '2026-09-05'], 5_000_00);
    expect(findRecurring(payments, '2026-09-30', '2026-10-03')).toHaveLength(1);
  });

  it('drops a payment that has stopped', () => {
    const payments = monthly('OLD GYM', ['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'], 2_000_00);
    expect(findRecurring(payments, '2026-09-30', '2026-10-03')).toEqual([]);
  });

  it('rolls the next date past today when the statements lag', () => {
    const payments = monthly('RENT', ['2026-06-01', '2026-07-01', '2026-08-01'], 25_000_00);
    const [rent] = findRecurring(payments, '2026-08-31', '2026-10-03');
    expect(rent?.next).toBe('2026-11-01');
  });

  it('keeps the day of month after a short month', () => {
    const payments = monthly('LOAN', ['2026-12-31', '2027-01-31', '2027-02-28'], 10_000_00);
    expect(findRecurring(payments, '2027-03-01', '2027-03-01')[0]?.next).toBe('2027-03-31');
  });

  it('finds quarterly and yearly payments and spreads them per month', () => {
    const payments = [
      ...monthly('ACT FIBERNET', ['2026-01-15', '2026-04-14', '2026-07-15'], 3_000_00),
      ...monthly('LIC', ['2024-11-20', '2025-11-21'], 24_000_00, 'Insurance'),
    ];
    const found = findRecurring(payments, '2026-09-30', '2026-10-03');
    expect(found.map((item) => [item.payee, item.cadence, item.next, item.perMonth])).toEqual([
      ['ACT FIBERNET', 'quarterly', '2026-10-15', 1_000_00],
      ['LIC', 'yearly', '2026-11-21', 2_000_00],
    ]);
  });

  it('takes the latest payment’s category', () => {
    const payments = [pay('ACME', '2026-07-01', 100_00, null), pay('ACME', '2026-08-01', 100_00, 'Other'), pay('ACME', '2026-09-01', 100_00, 'Subscriptions')];
    expect(findRecurring(payments, '2026-09-30', '2026-10-03')[0]?.category).toBe('Subscriptions');
  });
});
