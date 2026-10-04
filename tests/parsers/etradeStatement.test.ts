import { beforeAll, describe, expect, it } from 'vitest';
import { detectEtradeStatement, parseEtradeStatement } from '../../src/parsers/etradeStatement';
import { linesText } from '../../src/parsers/pdfText';
import type { EtradeStatement } from '../../src/parsers/types';
import { fixtureLines, hasValueFixture } from '../helpers/fixtures';

const STMT = 'etrade/statement.pdf';

describe('detectEtradeStatement', () => {
  it('needs CLIENT STATEMENT and Morgan Stanley at Work or E*TRADE', () => {
    expect(detectEtradeStatement('CLIENT STATEMENT\nMorgan Stanley at Work Self-Directed Account')).toBeGreaterThan(0);
    expect(detectEtradeStatement('CLIENT STATEMENT\nSome other broker')).toBe(0);
  });
});

describe.skipIf(!hasValueFixture(STMT))('parseEtradeStatement on the real statement', () => {
  let st: EtradeStatement;
  beforeAll(async () => {
    const lines = await fixtureLines(STMT);
    expect(detectEtradeStatement(linesText(lines))).toBeGreaterThan(0);
    st = parseEtradeStatement(lines);
  });

  it('reads period and ACME holding', () => {
    expect(st).toMatchObject({
      source: 'etrade-stmt',
      periodFrom: '2026-08-01',
      periodTo: '2026-09-30',
      symbol: 'ACME',
      quantity: 100.5,
      priceUsdCents: 20000,
      totalCostUsdCents: 5000000,
      marketValueUsdCents: 2010000,
    });
    expect(st.validation.ok).toBe(true);
  });

  it('reads the potential restricted stock table', () => {
    expect(st.unvested).toEqual([
      { grantDate: '2023-01-15', grantNumber: 'RU000011', quantity: 10 },
      { grantDate: '2024-01-15', grantNumber: 'RU000012', quantity: 20 },
      { grantDate: '2025-01-15', grantNumber: 'RU000013', quantity: 30 },
      { grantDate: '2026-01-15', grantNumber: 'RU000014', quantity: 40 },
    ]);
  });
});
