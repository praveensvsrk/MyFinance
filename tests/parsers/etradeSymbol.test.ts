import { describe, expect, it } from 'vitest';
import { parseEtradeStatement } from '../../src/parsers/etradeStatement';
import { parseBenefitHistory, readWorkbook } from '../../src/parsers/benefitHistory';
import type { Line } from '../../src/parsers/pdfText';
import { buildBenefitHistoryXlsx } from '../helpers/syntheticBenefitHistory';

/** A statement line made of the given cells; positions are irrelevant to the parser. */
function line(...cells: string[]): Line {
  return {
    page: 1,
    y: 0,
    cells: cells.map((s, i) => ({ x: i * 100, xe: i * 100 + 90, s })),
    text: cells.join(' '),
  };
}

const PERIOD = line('For the Period September 1 - September 30, 2026');

describe('employer stock symbol on the E*TRADE statement', () => {
  it('is read from the "<COMPANY> (<SYMBOL>)" holding row, whatever the company', () => {
    const statement = parseEtradeStatement([
      PERIOD,
      line('SOME FUND (FUNDX)', '10.000', '$50.000', '$400.00', '$500.00'),
      line('GLOBEX CORP (GBX)', '10.000', '$200.000', '$1,500.00', '$2,000.00'),
      line('Potential Restricted Stock Units'),
      line('01/15/26', 'RU000001', 'RSU', 'GBX', '4.000'),
    ]);
    expect(statement.symbol).toBe('GBX');
    expect(statement.quantity).toBe(10);
    expect(statement.marketValueUsdCents).toBe(200_000);
    expect(statement.validation.ok).toBe(true);
    expect(statement.unvested).toEqual([{ grantDate: '2026-01-15', grantNumber: 'RU000001', quantity: 4 }]);
  });

  it('fails clearly when no holding row is present', () => {
    expect(() => parseEtradeStatement([PERIOD, line('Cash', '$1.00')])).toThrow(/holding not found/);
  });
});

describe('employer stock symbol on the Benefit History', () => {
  it('is read from the Symbol column', () => {
    const history = parseBenefitHistory(readWorkbook(buildBenefitHistoryXlsx()));
    expect(history.symbol).toBe('ACME');
    expect(history.validation.ok).toBe(true);
  });
});
