import * as XLSX from 'xlsx';

/** Held shares after the synthetic workbook: two vests of 4, 1 withheld each → 3 sellable each. */
export const SYNTHETIC_HELD_SHARES = 6;
/** Unvested shares in the synthetic workbook: two future vests of 4. */
export const SYNTHETIC_UNVESTED_SHARES = 8;

const HEADERS = [
  'Record Type',
  'Grant Date',
  'Granted Qty.',
  'Vested Qty.',
  'Sellable Qty.',
  'Grant Number',
  'Unvested Qty.',
  'Cancelled Qty.',
  'Date',
  'Event Type',
  'Vest Period',
  'Vest Date',
  'Granted Qty.',
  'Cancelled Qty.',
  'Vested Qty.',
  'Released Qty',
  'Sellable Qty.',
  'Taxable Gain',
  'Effective Tax Rate',
  'Withholding Amount',
  'Symbol',
];

function row(cells: Record<number, string>): string[] {
  return HEADERS.map((_, index) => cells[index] ?? '');
}

/**
 * A tiny, entirely synthetic E*TRADE "Benefit History" workbook: one RSU grant of 16 shares in four
 * quarterly vests (two vested at a $300 FMV with one share withheld each, two still unvested).
 * It passes every parser check, so imports of it validate. No real data is involved.
 */
export function buildBenefitHistoryXlsx(): Uint8Array {
  const grant = row({
    0: 'Grant',
    1: '24-JAN-2025',
    2: '16',
    3: '8',
    4: '6',
    5: 'RU000001',
    6: '8',
    7: '0',
    20: 'ACME',
  });
  const schedule = (period: number, date: string, vested: number, sellable: number): string[] =>
    row({
      0: 'Vest Schedule',
      5: 'RU000001',
      10: String(period),
      11: date,
      12: '4',
      13: '0',
      14: String(vested),
      15: String(vested),
      16: String(sellable),
    });
  const tax = (period: number): string[] =>
    row({ 0: 'Tax Withholding', 5: 'RU000001', 10: String(period), 17: '1200.00', 18: '34.32%', 19: '411.84' });

  const rows = [
    HEADERS,
    grant,
    schedule(1, '04/15/2025', 4, 3),
    tax(1),
    schedule(2, '07/15/2025', 4, 3),
    tax(2),
    schedule(3, '10/15/2099', 0, 0),
    schedule(4, '01/15/2100', 0, 0),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Restricted Stock');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
