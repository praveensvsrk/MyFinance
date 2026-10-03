import { beforeAll, describe, expect, it } from 'vitest';
import { classifyCasTxn, detectCas, parseCas } from '../../src/parsers/cas';
import { linesText } from '../../src/parsers/pdfText';
import type { CasScheme, CasStatement } from '../../src/parsers/types';
import { fixtureLines, hasFixture } from '../helpers/fixtures';

const CAS = 'cas/cams_detailed_2018-2026.pdf';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('classifyCasTxn', () => {
  it.each([
    ['Systematic Investment New Purchase with SIP (1/999)', 1, 'sip'],
    ['SIP Purchase-BSE - Instalment No - 1 - INZ000000000', 1, 'sip'],
    ['Purchase Systematic-BSE - Instalment No - 1', 1, 'sip'],
    ['Purchase - Systematic-BSE - Instalment No - 2/999-Exchange', 1, 'sip'],
    ['Purchase', 1, 'purchase'],
    ['Purchase (New Fund Offer)', 1, 'purchase'],
    ['Redemption less TDS, STT', -1, 'redemption'],
    ['Redemption - ELECTRONIC PAYMENT-BSE - - N000000000000000', -1, 'redemption'],
    ['Systematic Investment Rejection (1)', -1, 'reversal'],
    ['Switch In - From XYZ', 1, 'switch_in'],
    ['Switch-Out - To XYZ', -1, 'switch_out'],
    ['IDCW Reinvestment', 1, 'dividend'],
  ] as const)('%s → %s', (desc, units, type) => {
    expect(classifyCasTxn(desc, units)).toBe(type);
  });
});

describe('detectCas', () => {
  it('needs the title and the CAMSCASWS footer', () => {
    expect(detectCas('Consolidated Account Statement\nCAMSCASWS-1 Version:V3.5')).toBeGreaterThan(0);
    expect(detectCas('Consolidated Account Statement (MF Central)')).toBe(0);
  });
});

describe.skipIf(!hasFixture(CAS))('parseCas on the real CAMS CAS (fixtures/' + CAS + ')', () => {
  let cas: CasStatement;
  const byIsin = (isin: string): CasScheme => {
    const s = cas.schemes.find((x) => x.isin === isin);
    if (!s) throw new Error(`scheme ${isin} not parsed`);
    return s;
  };
  beforeAll(async () => {
    const lines = await fixtureLines(CAS);
    expect(detectCas(linesText(lines))).toBeGreaterThan(0);
    cas = parseCas(lines);
  });

  it('reads the period and portfolio summary', () => {
    expect(cas.periodFrom).toBe('2019-01-01');
    expect(cas.periodTo).toBe('2026-10-03');
    expect(cas.portfolio).toHaveLength(10);
    expect(sum(cas.portfolio.map((p) => p.cost))).toBe(90000000);
    // The source document has a 1-paise rounding drift: the ten AMC rows sum to 110000000 while the
    // printed Total says 110000001. That is within the spec's ±₹1 tolerance for CAS aggregate figures.
    expect(sum(cas.portfolio.map((p) => p.marketValue))).toBe(110000000);
    expect(cas.total).toEqual({ cost: 90000000, marketValue: 110000001 });
  });

  it('reads all 10 schemes from opening balance 0 and validates', () => {
    expect(cas.schemes).toHaveLength(10);
    expect(cas.schemes.every((s) => s.openingUnits === 0)).toBe(true);
    const failed = cas.validation.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(cas.validation.ok).toBe(true);
  });

  it('reads a plain SIP scheme with stamp duty attached', () => {
    const sipScheme = byIsin('INF000000001');
    expect(sipScheme).toMatchObject({
      registrar: 'CAMS',
      demat: false,
      closingUnits: 2000000,
      nav: 250000,
      navDate: '2026-10-01',
      totalCost: 5000000,
      marketValue: 5000000,
    });
    expect(sipScheme.txns).toHaveLength(5);
    expect(sipScheme.txns.every((t) => t.type === 'sip' && t.amount === 999950 && t.stampDuty === 50)).toBe(true);
  });

  it('handles KFintech registrar, rejection, redemption, demat and wrapped ISIN', () => {
    expect(byIsin('INF000000002').registrar).toBe('KFINTECH');

    const fundB = byIsin('INF000000003');
    expect(fundB.registrar).toBe('KFINTECH');
    expect(fundB.txns.filter((t) => t.type === 'reversal')).toHaveLength(1);
    expect(fundB.txns.find((t) => t.type === 'reversal')!.units).toBe(-300000);
    expect(fundB.closingUnits).toBe(3000000);
    expect(fundB.totalCost).toBe(5500000);

    const fundC = byIsin('INF000000004');
    const red = fundC.txns.find((t) => t.type === 'redemption')!;
    expect(red).toMatchObject({ amount: -1300000, units: -1000000, stt: 13 });
    expect(fundC.totalCost).toBe(2000000);

    const fundD = byIsin('INF000000005');
    expect(fundD.demat).toBe(true);
    expect(fundD.txns[0]).toMatchObject({ type: 'purchase', amount: 1499925, stampDuty: 75 });

    const fundE = byIsin('INF000000006');
    expect(fundE.txns.some((t) => t.type === 'redemption' && t.unitBalance === 0)).toBe(true);
  });
});
