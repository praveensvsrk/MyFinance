import { beforeAll, describe, expect, it } from 'vitest';
import { detectUbiSavings, parseUbiSavings } from '../../src/parsers/ubiSavings';
import { linesText } from '../../src/parsers/pdfText';
import type { BankStatement } from '../../src/parsers/types';
import { fixtureLines, hasValueFixture } from '../helpers/fixtures';

const UBI = 'ubi/savings.pdf';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('detectUbiSavings', () => {
  it('needs the UBIN IFSC and the savings account type', () => {
    expect(detectUbiSavings('IFSC Code UBIN0000001\nAccount Type Saving Account')).toBeGreaterThan(0);
    expect(detectUbiSavings('Union Bank of India\nAccount Type : Loan Account')).toBe(0);
  });
});

describe.skipIf(!hasValueFixture(UBI))('parseUbiSavings on the real statement (fixtures/' + UBI + ')', () => {
  let st: BankStatement;
  beforeAll(async () => {
    const lines = await fixtureLines(UBI);
    expect(detectUbiSavings(linesText(lines))).toBeGreaterThan(0);
    st = parseUbiSavings(lines);
  });

  it('reads the header', () => {
    expect(st).toMatchObject({ source: 'ubi-savings', institution: 'UBI', periodFrom: '2026-04-01', periodTo: '2026-10-03' });
    expect(st.ifsc).toMatch(/^UBIN\w{7}$/);
  });

  it('reads all 7 records and derives the opening balance', () => {
    expect(st.txns).toHaveLength(7);
    expect(st.openingBalance).toBe(10000000);
    expect(st.closingBalance).toBe(11000000);
    expect(st.txns.filter((t) => t.amount > 0)).toHaveLength(4);
    expect(sum(st.txns.filter((t) => t.amount > 0).map((t) => t.amount))).toBe(50000000);
    expect(-sum(st.txns.filter((t) => t.amount < 0).map((t) => t.amount))).toBe(49000000);
    expect(st.validation.ok).toBe(true);
  });

  it('concatenates wrapped remarks without separators', () => {
    expect(st.txns[0].description).toMatch(/:Int\.Pd:01-01-2026 to 31-03-2026$/);
    expect(st.txns[2].description).toMatch(/^eTXN\/To:\d+\/emi$/);
    expect(st.txns[2].amount).toBe(-40000000);
    expect(st.txns.every((t) => !/\d\d:\d\d:\d\d/.test(t.description))).toBe(true);
  });
});
