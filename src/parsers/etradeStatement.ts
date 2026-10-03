import type { EtradeStatement } from './types';
import { linesText, type Line } from './pdfText';
import { isoDate, monthNumber, parseScaled, parseUsDate } from './normalize';
import { check, validation } from './validation';

export function detectEtradeStatement(text: string): number {
  return /CLIENT STATEMENT/.test(text) && /(Morgan Stanley at Work|E\*TRADE)/.test(text) ? 1 : 0;
}

/** "ADOBE INC (ADBE)" → the ticker in brackets. */
const HOLDING = /^.+?\s\(([A-Z][A-Z0-9.-]{0,9})\)/;
const NUMBER = /^\$?\(?-?[\d,]+(\.\d+)?\)?$/;

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

  // Potential Restricted Stock rows ("01/24/25 RU426480 RSU ADBE 67.000 …") name the employer ticker.
  const startIdx = lines.findIndex((l) => /^Potential Restricted Stock/.test(l.text));
  const unvested: EtradeStatement['unvested'] = [];
  const rsuSymbols = new Set<string>();
  if (startIdx >= 0) {
    const page = lines[startIdx].page;
    for (const l of lines.slice(startIdx + 1)) {
      if (l.page !== page) break;
      const [d, grant, , sym, qty] = l.cells.map((c) => c.s);
      if (/^\d\d\/\d\d\/\d\d$/.test(d ?? '') && /^RU\d+$/.test(grant ?? '') && qty) {
        unvested.push({ grantDate: parseUsDate(d), grantNumber: grant, quantity: shares(qty) });
        if (sym) rsuSymbols.add(sym);
      }
    }
  }

  // The employer holding row reads "<COMPANY> (<SYMBOL>)  qty  price  cost  market value". Other
  // positions share the shape, so prefer the ticker the RSU table names, then a row whose
  // quantity × price is its market value.
  const holdings = lines.flatMap((l) => {
    const m = HOLDING.exec(l.cells[0]?.s ?? '');
    if (!m || l.cells.length < 5) return [];
    const [, q, price, cost, mv] = l.cells.map((c) => c.s);
    const numeric = [q, price, cost, mv].every((c) => NUMBER.test(c ?? ''));
    return numeric ? [{ symbol: m[1], q, price, cost, mv }] : [];
  });
  const consistent = (h: (typeof holdings)[number]) =>
    Math.abs(parseScaled(h.mv, 2) - Math.round(shares(h.q) * parseScaled(h.price, 2))) <= 1;
  const holding =
    holdings.find((h) => rsuSymbols.has(h.symbol)) ?? holdings.find(consistent) ?? holdings[0];
  if (!holding) throw new Error('E*TRADE: employer stock holding not found');
  const { symbol, q, price, cost, mv } = holding;
  const quantity = shares(q);
  const priceUsdCents = parseScaled(price, 2);
  const marketValueUsdCents = parseScaled(mv, 2);

  return {
    source: 'etrade-stmt',
    periodFrom,
    periodTo,
    symbol,
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
