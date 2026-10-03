import { describe, expect, it } from 'vitest';
import { matchTransfers, type TransferTxn } from '../../src/domain/transfers';
import type { TxnKind } from '../../src/domain/categorise';

function txn(
  id: string,
  accountId: string,
  date: string,
  amount: number,
  kind: TxnKind = 'normal',
  description = '',
): TransferTxn {
  return { id, accountId, date, amount, kind, description };
}

describe('matchTransfers', () => {
  it('pairs a debit with an equal credit in another account within ±3 days', () => {
    expect(
      matchTransfers([
        txn('d', 'sbi', '2026-04-11', -500000),
        txn('c', 'ubi', '2026-04-12', 500000),
      ]),
    ).toEqual([['d', 'c']]);
  });

  it('does not pair an equal credit five days later', () => {
    expect(
      matchTransfers([
        txn('d', 'sbi', '2026-04-11', -500000),
        txn('c', 'ubi', '2026-04-16', 500000),
      ]),
    ).toEqual([]);
  });

  it('pairs at exactly three days but not four', () => {
    expect(
      matchTransfers([
        txn('d', 'sbi', '2026-04-11', -500000),
        txn('c', 'ubi', '2026-04-14', 500000),
      ]),
    ).toEqual([['d', 'c']]);
    expect(
      matchTransfers([
        txn('d', 'sbi', '2026-04-11', -500000),
        txn('c', 'ubi', '2026-04-15', 500000),
      ]),
    ).toEqual([]);
  });

  it('picks the closest candidate first', () => {
    expect(
      matchTransfers([
        txn('d', 'sbi', '2026-04-11', -500000),
        txn('far', 'ubi', '2026-04-13', 500000),
        txn('near', 'federal', '2026-04-12', 500000),
      ]),
    ).toEqual([['d', 'near']]);
  });

  it('breaks a distance tie by the earliest date', () => {
    expect(
      matchTransfers([
        txn('d', 'sbi', '2026-04-11', -500000),
        txn('later', 'ubi', '2026-04-13', 500000),
        txn('earlier', 'federal', '2026-04-09', 500000),
      ]),
    ).toEqual([['d', 'earlier']]);
  });

  it('uses each row at most once', () => {
    expect(
      matchTransfers([
        txn('d1', 'sbi', '2026-04-11', -500000),
        txn('d2', 'sbi', '2026-04-11', -500000),
        txn('c', 'ubi', '2026-04-12', 500000),
      ]),
    ).toEqual([['d1', 'c']]);
  });

  it('skips rows already marked as transfers', () => {
    expect(
      matchTransfers([
        txn('d', 'sbi', '2026-04-11', -500000, 'transfer'),
        txn('c', 'ubi', '2026-04-12', 500000),
      ]),
    ).toEqual([]);
    expect(
      matchTransfers([
        txn('d', 'sbi', '2026-04-11', -500000),
        txn('c', 'ubi', '2026-04-12', 500000, 'transfer'),
      ]),
    ).toEqual([]);
  });

  it('does not pair inside the same account unless both are an "Ac xfr" move on the same date', () => {
    expect(
      matchTransfers([
        txn('d', 'federal', '2026-04-11', -500000, 'normal', 'UPI PAYMENT'),
        txn('c', 'federal', '2026-04-12', 500000, 'normal', 'UPI CREDIT'),
      ]),
    ).toEqual([]);
    expect(
      matchTransfers([
        txn('d', 'federal', '2026-04-11', -500000, 'normal', 'Ac xfr to branch'),
        txn('c', 'federal', '2026-04-11', 500000, 'normal', 'Ac xfr from branch'),
      ]),
    ).toEqual([['d', 'c']]);
    expect(
      matchTransfers([
        txn('d', 'federal', '2026-04-11', -500000, 'normal', 'Ac xfr to branch'),
        txn('c', 'federal', '2026-04-12', 500000, 'normal', 'Ac xfr from branch'),
      ]),
    ).toEqual([]);
  });

  it('only pairs equal and opposite amounts', () => {
    expect(
      matchTransfers([
        txn('d', 'sbi', '2026-04-11', -500000),
        txn('c', 'ubi', '2026-04-12', 499999),
      ]),
    ).toEqual([]);
  });
});
