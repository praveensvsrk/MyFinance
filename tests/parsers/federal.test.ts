import { beforeAll, describe, expect, it } from 'vitest';
import { detectFederal, parseFederal } from '../../src/parsers/federal';
import { linesText } from '../../src/parsers/pdfText';
import type { BankStatement } from '../../src/parsers/types';
import { fixtureLines, hasFixture } from '../helpers/fixtures';

const FED = 'federal/federal_savings_2026-10-03.pdf';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('detectFederal', () => {
  it('needs the FDRL IFSC and bank name', () => {
    expect(detectFederal('IFSC : FDRL0000001\nThe Federal Bank Ltd.')).toBeGreaterThan(0);
    expect(detectFederal('SBIN0000002 State Bank of India')).toBe(0);
  });
});

describe.skipIf(!hasFixture(FED))('parseFederal on the real statement (fixtures/' + FED + ')', () => {
  let st: BankStatement;
  beforeAll(async () => {
    const lines = await fixtureLines(FED);
    expect(detectFederal(linesText(lines))).toBeGreaterThan(0);
    st = parseFederal(lines);
  });

  it('reads the header', () => {
    expect(st).toMatchObject({ source: 'federal', institution: 'Federal', periodFrom: '2026-04-01', periodTo: '2026-10-03' });
    expect(st.ifsc).toMatch(/^FDRL\w{7}$/);
    expect(st.accountLast4).toMatch(/^\d{4}$/);
  });

  it('reproduces GRAND TOTAL and the closing balance', () => {
    expect(st.txns).toHaveLength(100);
    expect(st.txns.filter((t) => t.amount < 0)).toHaveLength(90);
    expect(st.txns.filter((t) => t.amount > 0)).toHaveLength(10);
    expect(-sum(st.txns.filter((t) => t.amount < 0).map((t) => t.amount))).toBe(20000000);
    expect(sum(st.txns.filter((t) => t.amount > 0).map((t) => t.amount))).toBe(15000000);
    expect(st.openingBalance).toBe(10000000);
    expect(st.closingBalance).toBe(5000000);
    expect(st.validation.ok).toBe(true);
  });

  it('reads the first row', () => {
    expect(st.txns[0]).toMatchObject({ date: '2026-04-01', valueDate: '2026-04-01', amount: -100000, balanceAfter: 9900000 });
    expect(st.txns[0].description).toMatch(/^UPIOUT\/.*\/5411$/);
    expect(st.txns[0].ref).toMatch(/^\w+$/);
  });

  it('never appends the page footer to a description', () => {
    expect(st.txns.some((t) => /Federal Bank Ltd|Page \d+ Of/i.test(t.description))).toBe(false);
  });
});
