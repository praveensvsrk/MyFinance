import type { LoanCertificate } from './types';
import { linesText, type Line } from './pdfText';
import { fyStartOf, parseDate, parsePaise } from './normalize';
import { check, validation } from './validation';

export function detectUbiCertificate(text: string): number {
  return /UNION BANK OF INDIA/i.test(text) && /CERTIFICATE/.test(text) && /Limit Sanctioned/i.test(text) ? 1 : 0;
}

function need(m: RegExpMatchArray | null, what: string): RegExpMatchArray {
  if (!m) throw new Error(`UBI certificate: "${what}" not found`);
  return m;
}

export function parseUbiCertificate(lines: Line[]): LoanCertificate {
  const t = linesText(lines);
  const fy = need(t.match(/From\s*:\s*(\d\d-\d\d-\d{4})\s*To\s*:\s*(\d\d-\d\d-\d{4})/), 'financial year');
  const acct = need(t.match(/A\/c No\.\s*(\d{6,})/), 'account number');
  const sanctioned = need(t.match(/Limit Sanctioned\s*Rs\.?\s*([\d,]+)/i), 'Limit Sanctioned');
  const release = need(t.match(/Date of release\s*(\d\d-\d\d-\d{4})/i), 'Date of release');
  const emi = need(t.match(/Amount of EMI[^\n]*?Rs\.?\s*([\d,]+)/i), 'Amount of EMI');
  const balance = need(t.match(/Balance in the Loan A\/c as on (\d\d-\d\d-\d{4})\s*Rs\.?\s*([\d,]+)/i), 'Balance');
  const interest = need(t.match(/Interest charged during the Financial Year\s*Rs\.?\s*([\d,]+)/i), 'Interest charged');
  const total = need(t.match(/Total amount paid during the Financial\s*Rs\.?\s*([\d,]+)/i), 'Total amount paid');
  const principal = need(t.match(/towards\s*Principal\s*Rs\.\s*Rs\.?\s*([\d,]+)/i), 'towards Principal');
  const interestPaid = need(t.match(/towards\s*Interest\s*Rs\.\s*Rs\.?\s*([\d,]+)/i), 'towards Interest');

  const totalPaid = parsePaise(total[1]);
  const principalPaid = parsePaise(principal[1]);
  const interestPaidPaise = parsePaise(interestPaid[1]);

  return {
    source: 'ubi-cert',
    accountLast4: acct[1].slice(-4),
    fyStart: fyStartOf(parseDate(fy[1])),
    sanctioned: parsePaise(sanctioned[1]),
    releaseDate: parseDate(release[1]),
    emi: parsePaise(emi[1]),
    closingDate: parseDate(balance[1]),
    closingOutstanding: parsePaise(balance[2]),
    interestCharged: parsePaise(interest[1]),
    totalPaid,
    principalPaid,
    interestPaid: interestPaidPaise,
    validation: validation([check('principal + interest = total paid', totalPaid, principalPaid + interestPaidPaise)]),
  };
}
