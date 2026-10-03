import { beforeAll, describe, expect, it } from 'vitest';
import { detectUbiCertificate, parseUbiCertificate } from '../../src/parsers/ubiCertificate';
import { linesText } from '../../src/parsers/pdfText';
import type { LoanCertificate } from '../../src/parsers/types';
import { fixtureLines, hasFixture } from '../helpers/fixtures';

const CERT = 'ubi/ubi_loan_interest_certificate.pdf';

describe('detectUbiCertificate', () => {
  it('needs the bank name, CERTIFICATE and Limit Sanctioned', () => {
    expect(detectUbiCertificate('UNION BANK OF INDIA\nCERTIFICATE\n(a) Limit Sanctioned Rs. 1')).toBeGreaterThan(0);
    expect(detectUbiCertificate('UNION BANK OF INDIA\nStatement of Account')).toBe(0);
  });
});

describe.skipIf(!hasFixture(CERT))('parseUbiCertificate on the real certificate', () => {
  let c: LoanCertificate;
  beforeAll(async () => {
    const lines = await fixtureLines(CERT);
    expect(detectUbiCertificate(linesText(lines))).toBeGreaterThan(0);
    c = parseUbiCertificate(lines);
  });

  it('reads every labelled field', () => {
    expect(c).toMatchObject({
      source: 'ubi-cert',
      fyStart: 2025,
      sanctioned: 1000000000,
      releaseDate: '2020-01-15',
      emi: 7500000,
      closingDate: '2026-03-31',
      closingOutstanding: 980000000,
      interestCharged: 80000000,
      totalPaid: 150000000,
      principalPaid: 70000000,
      interestPaid: 80000000,
    });
    expect(c.accountLast4).toMatch(/^\d{4}$/);
    expect(c.validation.ok).toBe(true);
  });
});
