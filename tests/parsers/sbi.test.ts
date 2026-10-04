import { beforeAll, describe, expect, it } from 'vitest';
import { detectSbi, parseSbi } from '../../src/parsers/sbi';
import type { BankStatement } from '../../src/parsers/types';
import { fixtureLines, hasValueFixture } from '../helpers/fixtures';
import { linesText } from '../../src/parsers/pdfText';

const SBI = 'sbi/savings.pdf';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('detectSbi', () => {
  it('needs the SBI IFSC, bank name and statement summary', () => {
    expect(detectSbi('IFSC Code : SBIN0000001\nState Bank of India\nBrought Forward')).toBeGreaterThan(0);
    expect(detectSbi('IFSC : FDRL0000001 Federal Bank')).toBe(0);
  });
});

describe.skipIf(!hasValueFixture(SBI))('parseSbi on the real statement (fixtures/' + SBI + ')', () => {
  let st: BankStatement;
  beforeAll(async () => {
    const lines = await fixtureLines(SBI);
    expect(detectSbi(linesText(lines))).toBeGreaterThan(0);
    st = parseSbi(lines);
  });

  it('reads the header', () => {
    expect(st.source).toBe('sbi');
    expect(st.institution).toBe('SBI');
    expect(st.periodFrom).toBe('2026-04-01');
    expect(st.periodTo).toBe('2026-10-03');
    expect(st.accountLast4).toMatch(/^\d{4}$/);
    expect(st.ifsc).toMatch(/^SBIN\w{7}$/);
  });

  it('reproduces the Statement Summary exactly', () => {
    expect(st.txns).toHaveLength(100);
    expect(st.txns.filter((t) => t.amount < 0)).toHaveLength(80);
    expect(st.txns.filter((t) => t.amount > 0)).toHaveLength(20);
    expect(-sum(st.txns.filter((t) => t.amount < 0).map((t) => t.amount))).toBe(200000000);
    expect(sum(st.txns.filter((t) => t.amount > 0).map((t) => t.amount))).toBe(150000000);
    expect(st.openingBalance).toBe(100000000);
    expect(st.closingBalance).toBe(50000000);
    expect(st.validation.ok).toBe(true);
    expect(st.validation.checks.find((c) => c.name === 'running balance mismatches')?.actual).toBe(0);
  });

  it('attaches the prefix line above the date line to the description', () => {
    const first = st.txns[0];
    expect(first.date).toBe('2026-04-02');
    expect(first.amount).toBe(-100000);
    expect(first.balanceAfter).toBe(99900000);
    expect(first.description).toMatch(/^DEBIT ACHDr XBNK/);
    const imps = st.txns.find((t) => t.description.includes('IMPS/') && t.description.includes('UBIN'));
    expect(imps).toMatchObject({ date: '2026-04-11', amount: -10000000 });
  });

  it('reads the PPF balance from the Relationship Summary', () => {
    expect(st.ppfBalance).toEqual({ date: '2026-10-03', balance: 10000000 });
  });
});
