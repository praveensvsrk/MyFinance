import * as XLSX from 'xlsx';
import type { BenefitHistory, Check, EquityGrantRec, EsppPurchaseRec, LotRec, SaleEventRec, VestRec } from './types';
import { parseDate, parseScaled, parseUsDate } from './normalize';
import { check, validation } from './validation';

export type WorkBook = XLSX.WorkBook;
type Row = string[];

export function readWorkbook(bytes: Uint8Array): WorkBook {
  return XLSX.read(bytes, { type: 'array' });
}

function rowsOf(wb: WorkBook, name: string): Row[] | null {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils
    .sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' })
    .map((r) => r.map((c) => String(c).trim()));
}

export function detectBenefitHistory(wb: WorkBook): number {
  for (const name of ['Restricted Stock', 'ESPP']) {
    const rows = rowsOf(wb, name);
    if (rows && rows[0]?.[0] === 'Record Type') return 1;
  }
  return 0;
}

function col(headers: Row, name: string, after?: string): number {
  const from = after === undefined ? 0 : headers.indexOf(after);
  const i = from < 0 ? -1 : headers.indexOf(name, from);
  if (i < 0) throw new Error(`Benefit History: column "${name}"${after ? ` after "${after}"` : ''} not found`);
  return i;
}

/** Values of the optional "Symbol" column on the rows of a sheet that carry one. */
function symbolsOf(rows: Row[] | null): string[] {
  const i = rows?.[0]?.indexOf('Symbol') ?? -1;
  if (!rows || i < 0) return [];
  return rows.slice(1).map((r) => (r[i] ?? '').toUpperCase()).filter((v) => v !== '');
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const qty = (s: string) => (s ? round4(Number(s.replace(/,/g, ''))) : 0);
const cents = (s: string) => (s ? parseScaled(s, 2) : 0);
const pct = (s: string) => (s ? Number(s.replace('%', '')) : null);
const sum = (xs: number[]) => round4(xs.reduce((a, b) => a + b, 0));

export function parseBenefitHistory(wb: WorkBook): BenefitHistory {
  const grants: EquityGrantRec[] = [];
  const vests: VestRec[] = [];
  const esppPurchases: EsppPurchaseRec[] = [];
  const lots: LotRec[] = [];
  const sales: SaleEventRec[] = [];
  const checks: Check[] = [];

  const rs = rowsOf(wb, 'Restricted Stock');
  if (rs) {
    const H = rs[0];
    const c = {
      grantDate: col(H, 'Grant Date'),
      granted: col(H, 'Granted Qty.'),
      vested: col(H, 'Vested Qty.'),
      sellable: col(H, 'Sellable Qty.'),
      grantNumber: col(H, 'Grant Number'),
      unvested: col(H, 'Unvested Qty.'),
      cancelled: col(H, 'Cancelled Qty.'),
      evDate: col(H, 'Date'),
      evType: col(H, 'Event Type'),
      period: col(H, 'Vest Period'),
      vestDate: col(H, 'Vest Date'),
      vGranted: col(H, 'Granted Qty.', 'Vest Period'),
      vCancelled: col(H, 'Cancelled Qty.', 'Vest Period'),
      vVested: col(H, 'Vested Qty.', 'Vest Period'),
      vReleased: col(H, 'Released Qty', 'Vest Period'),
      vSellable: col(H, 'Sellable Qty.', 'Vest Period'),
      taxableGain: col(H, 'Taxable Gain'),
      taxRate: col(H, 'Effective Tax Rate'),
      withholding: col(H, 'Withholding Amount'),
    };
    const byKey = new Map<string, VestRec>();
    const withholding = new Map<string, number>();
    for (const r of rs.slice(1)) {
      const key = `${r[c.grantNumber]}#${Number(r[c.period])}`;
      switch (r[0]) {
        case 'Grant':
          grants.push({
            grantNumber: r[c.grantNumber],
            type: 'RSU',
            grantDate: parseDate(r[c.grantDate]),
            totalShares: qty(r[c.granted]),
            cancelledShares: qty(r[c.cancelled]),
            vestedShares: qty(r[c.vested]),
            unvestedShares: qty(r[c.unvested]),
            sellableShares: qty(r[c.sellable]),
          });
          break;
        case 'Vest Schedule': {
          const v: VestRec = {
            grantNumber: r[c.grantNumber],
            period: Number(r[c.period]),
            vestDate: parseUsDate(r[c.vestDate]),
            shares: qty(r[c.vGranted]),
            cancelledShares: qty(r[c.vCancelled]),
            vestedShares: qty(r[c.vVested]),
            releasedShares: qty(r[c.vReleased]),
            sellableShares: qty(r[c.vSellable]),
            sharesWithheld: 0,
            fmvUsdCents: null,
            taxableGainUsdCents: null,
            taxRatePct: null,
            status: 'unvested',
          };
          vests.push(v);
          byKey.set(key, v);
          break;
        }
        case 'Tax Withholding': {
          const v = byKey.get(key);
          if (v) {
            v.taxableGainUsdCents = cents(r[c.taxableGain]);
            v.taxRatePct = pct(r[c.taxRate]);
            withholding.set(key, cents(r[c.withholding]));
          }
          break;
        }
        case 'Event':
          if (r[c.evType] === 'Shares sold') sales.push({ date: parseUsDate(r[c.evDate]), plan: 'RSU', grantNumber: r[c.grantNumber] });
          break;
      }
    }

    for (const v of vests) {
      const key = `${v.grantNumber}#${v.period}`;
      if (v.vestedShares > 0) {
        v.status = 'vested';
        if (v.taxableGainUsdCents) {
          v.fmvUsdCents = Math.round(v.taxableGainUsdCents / v.vestedShares);
          v.sharesWithheld = Math.round((withholding.get(key) ?? 0) / (v.taxableGainUsdCents / v.vestedShares));
        }
        lots.push({
          key,
          source: 'RSU',
          acquiredDate: v.vestDate,
          netShares: round4(v.vestedShares - v.sharesWithheld),
          remainingShares: v.sellableShares,
          costPerShareUsdCents: v.fmvUsdCents ?? 0,
          remainingCostUsdCents: v.taxableGainUsdCents
            ? Math.round((v.taxableGainUsdCents * v.sellableShares) / v.vestedShares)
            : 0,
        });
      } else if (v.cancelledShares > 0 && v.cancelledShares >= v.shares) {
        v.status = 'cancelled';
      }
    }

    for (const g of grants) {
      const vs = vests.filter((v) => v.grantNumber === g.grantNumber);
      checks.push(check(`${g.grantNumber}: Σ schedule = granted`, g.totalShares, sum(vs.map((v) => v.shares))));
      checks.push(check(`${g.grantNumber}: Σ vested`, g.vestedShares, sum(vs.map((v) => v.vestedShares))));
      checks.push(
        check(
          `${g.grantNumber}: Σ future vests = unvested`,
          g.unvestedShares,
          sum(vs.filter((v) => v.status === 'unvested').map((v) => v.shares - v.cancelledShares)),
        ),
      );
      checks.push(check(`${g.grantNumber}: Σ sellable`, g.sellableShares, sum(vs.map((v) => v.sellableShares))));
    }
    const missingFmv = vests.filter((v) => v.status === 'vested' && v.fmvUsdCents === null).length;
    checks.push(check('every vested RSU has an FMV', 0, missingFmv));
  }

  const es = rowsOf(wb, 'ESPP');
  if (es) {
    const H = es[0];
    const c = {
      purchaseDate: col(H, 'Purchase Date'),
      price: col(H, 'Purchase Price'),
      purchased: col(H, 'Purchased Qty.'),
      sellable: col(H, 'Sellable Qty.'),
      offering: col(H, 'Grant Date'),
      discount: col(H, 'Discount Percent'),
      grantFmv: col(H, 'Grant Date FMV'),
      purchaseFmv: col(H, 'Purchase Date FMV'),
      evDate: col(H, 'Date'),
      evType: col(H, 'Event Type'),
      evQty: col(H, 'Qty'),
    };
    let totals: number | null = null;
    for (const r of es.slice(1)) {
      if (r[0] === 'Purchase') {
        const p: EsppPurchaseRec = {
          offeringDate: parseDate(r[c.offering]),
          purchaseDate: parseDate(r[c.purchaseDate]),
          purchasePriceUsdCents: cents(r[c.price]),
          purchasedShares: qty(r[c.purchased]),
          sellableShares: qty(r[c.sellable]),
          grantDateFmvUsdCents: cents(r[c.grantFmv]),
          purchaseDateFmvUsdCents: cents(r[c.purchaseFmv]),
          discountPct: pct(r[c.discount]),
        };
        esppPurchases.push(p);
        lots.push({
          key: `ESPP#${p.purchaseDate}`,
          source: 'ESPP',
          acquiredDate: p.purchaseDate,
          netShares: p.purchasedShares,
          remainingShares: p.sellableShares,
          costPerShareUsdCents: p.purchasePriceUsdCents,
          remainingCostUsdCents: Math.round(p.purchasePriceUsdCents * p.sellableShares),
        });
      } else if (r[0] === 'Event' && r[c.evType] === 'SELL') {
        sales.push({ date: parseUsDate(r[c.evDate]), plan: 'ESPP', shares: qty(r[c.evQty]) });
      } else if (r[0] === 'Totals') {
        totals = qty(r[c.purchased]);
      }
    }
    const byOffering = new Map<string, EsppPurchaseRec[]>();
    for (const p of esppPurchases) byOffering.set(p.offeringDate, [...(byOffering.get(p.offeringDate) ?? []), p]);
    for (const [offering, ps] of byOffering) {
      const purchased = sum(ps.map((p) => p.purchasedShares));
      grants.push({
        grantNumber: offering,
        type: 'ESPP',
        grantDate: offering,
        totalShares: purchased,
        cancelledShares: 0,
        vestedShares: purchased,
        unvestedShares: 0,
        sellableShares: sum(ps.map((p) => p.sellableShares)),
      });
    }
    if (totals !== null) checks.push(check('ESPP Σ purchased = Totals', totals, sum(esppPurchases.map((p) => p.purchasedShares))));
  }

  if (!rs && !es) throw new Error('Benefit History: no Restricted Stock or ESPP sheet');
  const symbols = [...new Set([...symbolsOf(rs), ...symbolsOf(es)])];
  if (symbols.length > 1) checks.push(check(`one stock symbol (found ${symbols.join(', ')})`, 1, symbols.length));
  return { source: 'etrade-xlsx', symbol: symbols[0] ?? '', grants, vests, esppPurchases, lots, sales, validation: validation(checks) };
}
