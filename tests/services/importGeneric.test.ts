import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb } from '../../src/db/schema';
import { mappingFromGuess, parseGeneric } from '../../src/parsers/generic';
import { guessMapping, parseCsv } from '../../src/parsers/spreadsheet';
import { commitImport, previewFromParsed } from '../../src/services/importPipeline';

const CSV = `Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/04/2026,UPI-SWIGGY,1,01/04/2026,450.00,,10000.00
02/04/2026,SALARY,,02/04/2026,,50000.00,60000.00
`;

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-generic-import-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('generic CSV import', () => {
  it('commits a mapped HDFC-style export as a savings account', async () => {
    const table = { sheetName: 'CSV', rows: parseCsv(CSV) };
    const parsed = parseGeneric(
      table,
      mappingFromGuess(guessMapping(table), { institution: 'HDFC', accountLast4: '4821' }),
    );
    const preview = await previewFromParsed(db, parsed, 'hash-generic');
    expect(preview.source).toBe('generic');
    expect(preview.mapped.summary.counts.transactions).toBe(2);
    await commitImport(db, preview);
    const account = await db.accounts.get('hdfc-4821');
    expect(account).toMatchObject({ kind: 'savings', institution: 'HDFC', name: 'HDFC Savings' });
    expect(await db.transactions.where('accountId').equals('hdfc-4821').count()).toBe(2);
  });
});
