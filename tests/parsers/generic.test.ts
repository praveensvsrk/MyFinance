import { describe, expect, it } from 'vitest';
import { parseGeneric, mappingFromGuess } from '../../src/parsers/generic';
import { guessMapping, parseCsv } from '../../src/parsers/spreadsheet';
import { parseFile } from '../../src/parsers';

const HDFC = `Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/04/2026,UPI-SWIGGY FOOD,123,01/04/2026,450.00,,10450.00
02/04/2026,NEFT SALARY ACME,,02/04/2026,,50000.00,60450.00
03/04/2026,ACH D- SIP,456,03/04/2026,15000.00,,45450.00
`;

const SBI = `Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance
05/04/26,05/04/26,UPI OUT AMAZON,111,1200.00,,98800.00
06/04/26,06/04/26,INTEREST CREDIT, , ,210.50,99010.50
`;

function table(csv: string) {
  return { sheetName: 'CSV', rows: parseCsv(csv) };
}

describe('guessMapping', () => {
  it('recognises an HDFC savings export', () => {
    const guessed = guessMapping(table(HDFC));
    expect(guessed.preset).toBe('HDFC savings');
    expect(guessed.institution).toBe('HDFC');
    expect(guessed.dateCol).toBe(0);
    expect(guessed.descriptionCol).toBe(1);
    expect(guessed.debitCol).toBeDefined();
    expect(guessed.creditCol).toBeDefined();
    expect(guessed.balanceCol).toBeDefined();
  });

  it('recognises an SBI savings export', () => {
    const guessed = guessMapping(table(SBI));
    expect(guessed.preset).toBe('SBI savings');
    expect(guessed.kind).toBe('savings');
  });
});

describe('parseGeneric', () => {
  it('parses debit/credit rows and replays the printed balance', () => {
    const guessed = guessMapping(table(HDFC));
    const mapping = mappingFromGuess(guessed, { institution: 'HDFC', accountLast4: '4821' });
    const parsed = parseGeneric(table(HDFC), mapping);
    expect(parsed.source).toBe('generic');
    expect(parsed.institution).toBe('HDFC');
    expect(parsed.accountLast4).toBe('4821');
    expect(parsed.txns).toHaveLength(3);
    expect(parsed.txns[0]).toMatchObject({ date: '2026-04-01', amount: -45000, balanceAfter: 1045000 });
    expect(parsed.txns[1].amount).toBe(5_000_000);
    expect(parsed.validation.ok).toBe(true);
    expect(parsed.openingBalance).toBe(1_090_000);
    expect(parsed.closingBalance).toBe(4_545_000);
  });

  it('parses two-digit years', () => {
    const guessed = guessMapping(table(SBI));
    const mapping = mappingFromGuess(guessed, { institution: 'SBI', accountLast4: '1111' });
    const parsed = parseGeneric(table(SBI), mapping);
    expect(parsed.txns[0].date).toBe('2026-04-05');
    expect(parsed.txns[1].amount).toBe(21050);
  });

  it('treats a single amount column on a card as money out when positive', () => {
    const csv = `Date,Description,Amount
01/05/2026,AMAZON,1200.00
02/05/2026,PAYMENT,-1200.00
`;
    const parsed = parseGeneric(table(csv), {
      institution: 'HDFC',
      accountLast4: '9012',
      kind: 'card',
      headerRow: 0,
      dateCol: 0,
      descriptionCol: 1,
      amountCol: 2,
      amountInvertsSign: true,
    });
    expect(parsed.accountKind).toBe('card');
    expect(parsed.txns[0].amount).toBe(-120000);
    expect(parsed.txns[1].amount).toBe(120000);
  });
});

describe('parseFile generic', () => {
  it('asks for a column mapping on a CSV', async () => {
    const out = await parseFile(new TextEncoder().encode(HDFC));
    expect(out.status).toBe('need-mapping');
    if (out.status !== 'need-mapping') return;
    expect(out.table.rows.length).toBeGreaterThan(2);
  });

  it('parses a CSV once a mapping is supplied', async () => {
    const bytes = new TextEncoder().encode(HDFC);
    const first = await parseFile(bytes);
    expect(first.status).toBe('need-mapping');
    if (first.status !== 'need-mapping') return;
    const mapping = mappingFromGuess(guessMapping(first.table), { institution: 'HDFC', accountLast4: '4821' });
    const out = await parseFile(bytes, { mapping });
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.result.source).toBe('generic');
    if (out.result.source !== 'generic') return;
    expect(out.result.txns).toHaveLength(3);
  });
});
