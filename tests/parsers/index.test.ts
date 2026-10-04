import { describe, expect, it } from 'vitest';
import { detectSource, parseFile } from '../../src/parsers';
import { fixturePassword, hasFixture, readFixture } from '../helpers/fixtures';

const CASES = [
  ['sbi/savings.pdf', 'sbi'],
  ['federal/savings.pdf', 'federal'],
  ['ubi/savings.pdf', 'ubi-savings'],
  ['icici-cc/statement.pdf', 'icici-cc'],
  ['ubi/loan_current.pdf', 'ubi-loan'],
  ['ubi/loan_certificate.pdf', 'ubi-cert'],
  ['epf/epf_BBBBB_FY2025.pdf', 'epf'],
  ['cas/cams_detailed.pdf', 'cas'],
  ['etrade/statement.pdf', 'etrade-stmt'],
  ['etrade/benefit_history.xlsx', 'etrade-xlsx'],
] as const;

describe('detectSource', () => {
  it('returns null for unrelated text', () => {
    expect(detectSource('hello world')).toBeNull();
  });
  it('prefers the loan over UBI savings when both bank markers appear', () => {
    expect(detectSource('Union Bank of India UBIN0000001\nAccount Type : Loan Account')).toBe('ubi-loan');
  });
});

describe('parseFile', () => {
  it('reports unknown for bytes that are neither PDF nor XLSX', async () => {
    const out = await parseFile(new TextEncoder().encode('just some text'));
    expect(out.status).toBe('unknown');
  });

  for (const [file, source] of CASES) {
    it.skipIf(!hasFixture(file))(`detects and parses ${file} as ${source}`, async () => {
      const pw = fixturePassword(file);
      const out = await parseFile(readFixture(file), pw ? { password: pw } : {});
      expect(out.status).toBe('ok');
      if (out.status !== 'ok') return;
      expect(out.result.source).toBe(source);
      expect(out.result.validation.ok).toBe(true);
      expect(out.passwordUsed === pw).toBe(true);
    });
  }

  it.skipIf(!hasFixture('sbi/savings.pdf'))('asks for a password when none works', async () => {
    const bytes = readFixture('sbi/savings.pdf');
    expect((await parseFile(bytes)).status).toBe('password-required');
    expect((await parseFile(bytes, { password: 'nope' })).status).toBe('password-incorrect');
  });

  it.skipIf(!hasFixture('federal/savings.pdf'))('reports a parse error for a forced wrong source', async () => {
    const out = await parseFile(readFixture('federal/savings.pdf'), { forceSource: 'epf' });
    expect(out).toMatchObject({ status: 'error', source: 'epf' });
  });
});
