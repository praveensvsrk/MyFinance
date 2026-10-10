import { describe, expect, it } from 'vitest';
import type { TxnRow } from '../../src/db/schema';
import { matchesSearch } from '../../src/domain/search';

function txn(description: string, amount: number, extra: Partial<TxnRow> = {}): TxnRow {
  return {
    id: 't',
    accountId: 'sbi',
    date: '2026-09-10',
    description,
    ref: '',
    amount,
    balanceAfter: 0,
    category: null,
    categorySource: null,
    kind: 'normal',
    transferPairId: null,
    importId: 'imp',
    fingerprint: 'fp',
    ...extra,
  };
}

describe('matchesSearch', () => {
  const swiggy = txn('WDL TFR UPI/DR/612345678901/SWIGGY LIMITED/YESB/swiggy@ybl/Pay', -450_00, { category: 'Food delivery' });

  it('matches the payee in any case, ignoring slashes between words', () => {
    expect(matchesSearch(swiggy, 'swiggy')).toBe(true);
    expect(matchesSearch(swiggy, 'Swiggy Limited')).toBe(true);
    expect(matchesSearch(txn('UPI/ACME/TOYS/123', -1_00), 'acme toys')).toBe(true);
    expect(matchesSearch(swiggy, 'zomato')).toBe(false);
  });

  it('needs every word, in any order', () => {
    expect(matchesSearch(swiggy, 'limited swiggy')).toBe(true);
    expect(matchesSearch(swiggy, 'swiggy zomato')).toBe(false);
  });

  it('matches the category and the reference', () => {
    expect(matchesSearch(swiggy, 'food')).toBe(true);
    expect(matchesSearch(txn('NEFT CREDIT', 5_00, { ref: 'N123456XYZ' }), 'n123456xyz')).toBe(true);
  });

  it('matches an amount in rupees, with or without the rupee sign, commas or paise', () => {
    expect(matchesSearch(swiggy, '450')).toBe(true);
    expect(matchesSearch(swiggy, '₹450')).toBe(true);
    expect(matchesSearch(swiggy, '450.00')).toBe(true);
    expect(matchesSearch(swiggy, '451')).toBe(false);
    expect(matchesSearch(txn('RENT', -25_000_00), '25,000')).toBe(true);
    expect(matchesSearch(txn('CAFE', -199_50), '199')).toBe(true);
    expect(matchesSearch(txn('CAFE', -199_50), '199.5')).toBe(true);
    expect(matchesSearch(txn('CAFE', -199_50), '199.00')).toBe(false);
    expect(matchesSearch(txn('SALARY', 1_00_000_00), '100000')).toBe(true);
  });

  it('still finds a number in the narration', () => {
    expect(matchesSearch(swiggy, '612345678901')).toBe(true);
  });

  it('matches nothing for an empty query', () => {
    expect(matchesSearch(swiggy, '   ')).toBe(false);
  });
});
