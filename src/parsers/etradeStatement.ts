import type { EtradeStatement } from './types';
import { EQUITY_COMPANY, EQUITY_SYMBOL } from '../config';
import { linesText, type Line } from './pdfText';
import { isoDate, monthNumber, parseScaled, parseUsDate } from './normalize';
import { check, validation } from './validation';

export function detectEtradeStatement(text: string): number {
  return /CLIENT STATEMENT/.test(text) && /(Morgan Stanley at Work|E\*TRADE)/.test(text) ? 1 : 0;
}

const shares = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 1e4) / 1e4;

export function parseEtradeStatement(lines: Line[]): EtradeStatement {
  const all = linesText(lines);
  const p = all.match(/For the Period ([A-Za-z]+) (\d{1,2})\s*-\s*([A-Za-z]+) (\d{1,2}), (\d{4})/);
  if (!p) throw new Error('E*TRADE: statement period not found');
  const fromMonth = monthNumber(p[1]);
  const toMonth = monthNumber(p[3]);
  const year = Number(p[5]);
  const periodFrom = isoDate(fromMonth > toMonth ? year - 1 : year, fromMonth, Number(p[2]));
  const periodTo = isoDate(year, toMonth, Number(p[4]));

  const holding = lines.find((l) => (l.cells[0]?.s ?? '').startsWith(`${EQUITY_COMPANY} (${EQUITY_SYMBOL})`));
  if (!holding || holding.cells.length < 5) throw new Error(`E*TRADE: ${EQUITY_SYMBOL} holding not found`);
  const [, q, price, cost, mv] = holding.cells.map((c) => c.s);
  const quantity = shares(q);
  const priceUsdCents = parseScaled(price, 2);
  const marketValueUsdCents = parseScaled(mv, 2);

  const startIdx = lines.findIndex((l) => /^Potential Restricted Stock/.test(l.text));
  const unvested: EtradeStatement['unvested'] = [];
  if (startIdx >= 0) {
    const page = lines[startIdx].page;
    for (const l of lines.slice(startIdx + 1)) {
      if (l.page !== page) break;
      const [d, grant, , , qty] = l.cells.map((c) => c.s);
      if (/^\d\d\/\d\d\/\d\d$/.test(d ?? '') && /^RU\d+$/.test(grant ?? '') && qty) {
        unvested.push({ grantDate: parseUsDate(d), grantNumber: grant, quantity: shares(qty) });
      }
    }
  }

  return {
    source: 'etrade-stmt',
    periodFrom,
    periodTo,
    symbol: EQUITY_SYMBOL,
    quantity,
    priceUsdCents,
    totalCostUsdCents: parseScaled(cost, 2),
    marketValueUsdCents,
    unvested,
    validation: validation([
      check('quantity × price = market value', marketValueUsdCents, Math.round(quantity * priceUsdCents), 1),
    ]),
  };
}
