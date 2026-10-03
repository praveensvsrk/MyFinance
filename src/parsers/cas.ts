import type { CasScheme, CasStatement, CasTxn, CasTxnType, Check } from './types';
import { linesText, nearestColumn, type Line } from './pdfText';
import { isAmount, parseDate, parsePaise, parseScaled, parseScaledOrNull } from './normalize';
import { check, validation } from './validation';
import { fifoRemainingCost } from '../domain/mfFifo';

const COLS = { amount: 373, units: 430, price: 489, balance: 567 };
const DATE_RE = /^\d\d-[A-Za-z]{3}-\d{4}$/;
const SCHEME_START_RE = /^[A-Z0-9]{2,12}-\S/;
const SCHEME_RE = /^([A-Z0-9]+)-(.+?)\s*\((Non-Demat|Non Demat|Demat)\)\s*-\s*ISIN:\s*([A-Z0-9]{12})/;

export function detectCas(text: string): number {
  return /Consolidated Account Statement/.test(text) && /CAMSCASWS/.test(text) ? 1 : 0;
}

export function classifyCasTxn(description: string, units: number): CasTxnType {
  const d = description;
  if (/rejection|reversal/i.test(d)) return 'reversal';
  if (/switch[\s-]*in/i.test(d)) return 'switch_in';
  if (/switch[\s-]*out/i.test(d)) return 'switch_out';
  if (/redemption|withdrawal/i.test(d)) return 'redemption';
  if (/IDCW|dividend/i.test(d)) return 'dividend';
  if (/systematic|\bSIP\b/i.test(d)) return 'sip';
  if (/purchase/i.test(d)) return 'purchase';
  return units < 0 ? 'redemption' : 'purchase';
}

interface SchemeDraft {
  amc: string;
  folio: string;
  header: string;
  registrarText: string;
  openingUnits: number;
  txns: CasTxn[];
}

function appendHeader(d: SchemeDraft, l: Line) {
  // Wrapped header parts split mid-token (e.g. an ISIN), so they are joined without a separator.
  d.header += l.cells.filter((c) => c.x < 500).map((c) => c.s).join(' ');
  d.registrarText += ' ' + l.cells.filter((c) => c.x >= 500).map((c) => c.s).join(' ');
}

function finishScheme(d: SchemeDraft, l: Line): CasScheme {
  const m = d.header.match(SCHEME_RE);
  if (!m) throw new Error(`CAS: cannot read scheme header "${d.header.slice(0, 80)}"`);
  const t = l.text;
  const closing = t.match(/Closing Unit Balance:\s*([\d,.]+)/);
  const nav = t.match(/NAV on (\d\d-[A-Za-z]{3}-\d{4}):\s*INR\s*([\d,.]+)/);
  const cost = t.match(/Total Cost Value:\s*([\d,.]+)/);
  const mv = t.match(/Market Value on (\d\d-[A-Za-z]{3}-\d{4}):\s*INR\s*([\d,.]+)/);
  if (!closing || !nav || !cost || !mv) throw new Error(`CAS: cannot read closing line for ${m[2]}`);
  return {
    amc: d.amc,
    folio: d.folio,
    schemeCode: m[1],
    name: m[2].trim(),
    isin: m[4],
    registrar: /KFINTECH/i.test(d.registrarText) ? 'KFINTECH' : 'CAMS',
    demat: m[3] === 'Demat',
    openingUnits: d.openingUnits,
    closingUnits: parseScaled(closing[1], 3),
    nav: parseScaled(nav[2], 4),
    navDate: parseDate(nav[1]),
    totalCost: parsePaise(cost[1]),
    marketValue: parsePaise(mv[2]),
    txns: d.txns,
  };
}

export function parseCas(lines: Line[]): CasStatement {
  const all = linesText(lines);
  const period = all.match(/(\d\d-[A-Za-z]{3}-\d{4}) To (\d\d-[A-Za-z]{3}-\d{4})/);
  const psIdx = lines.findIndex((l) => l.text === 'PORTFOLIO SUMMARY');
  if (!period || psIdx < 0) throw new Error('CAS: period or portfolio summary not found');

  const portfolio: CasStatement['portfolio'] = [];
  let total = { cost: 0, marketValue: 0 };
  let totalIdx = -1;
  for (let i = psIdx + 1; i < lines.length; i++) {
    const c = lines[i].cells;
    if (c.length !== 3 || !isAmount(c[1].s) || !isAmount(c[2].s)) continue;
    const row = { amc: c[0].s, cost: parsePaise(c[1].s), marketValue: parsePaise(c[2].s) };
    if (row.amc === 'Total') {
      total = { cost: row.cost, marketValue: row.marketValue };
      totalIdx = i;
      break;
    }
    portfolio.push(row);
  }
  if (totalIdx < 0) throw new Error('CAS: portfolio summary total not found');

  const amcs = new Set(portfolio.map((p) => p.amc));
  const schemes: CasScheme[] = [];
  const notes: string[] = [];
  let amc = '';
  let folio = '';
  let state: 'idle' | 'header' | 'scheme' = 'idle';
  let draft: SchemeDraft | null = null;

  for (const l of lines.slice(totalIdx + 1)) {
    const first = l.cells[0]?.s ?? '';
    if (state !== 'scheme' && l.cells.length === 1 && amcs.has(first)) {
      amc = first;
      state = 'idle';
      continue;
    }
    const folioM = l.text.match(/^Folio No:\s*(.+?)\s+PAN:/);
    if (folioM) {
      folio = folioM[1].replace(/\s+/g, '');
      state = 'idle';
      continue;
    }
    if (state === 'idle') {
      if (folio && !DATE_RE.test(first) && SCHEME_START_RE.test(first)) {
        draft = { amc, folio, header: '', registrarText: '', openingUnits: 0, txns: [] };
        appendHeader(draft, l);
        state = 'header';
      }
      continue;
    }
    if (state === 'header') {
      const open = l.text.match(/Opening Unit Balance:\s*([\d,.]+)/);
      if (open) {
        draft!.openingUnits = parseScaled(open[1], 3);
        state = 'scheme';
      } else if (!/^Nominee/.test(first)) {
        appendHeader(draft!, l);
      }
      continue;
    }
    // state === 'scheme'
    if (/^Closing Unit Balance/.test(l.text)) {
      schemes.push(finishScheme(draft!, l));
      draft = null;
      state = 'idle';
      continue;
    }
    if (!DATE_RE.test(first)) continue;

    const date = parseDate(first);
    const desc = l.cells.filter((c) => c.x >= 70 && c.x < 330).map((c) => c.s).join(' ');
    const nums: Partial<Record<keyof typeof COLS, string>> = {};
    for (const c of l.cells) {
      if (c.x >= 330 && parseScaledOrNull(c.s, 4) !== null) nums[nearestColumn(c.xe, COLS)] = c.s;
    }
    if (/^\*+.*\*+$/.test(desc)) {
      if (!nums.amount) continue; // informational row (KYC, nominee, address)
      const charge = Math.abs(parsePaise(nums.amount));
      const parent = draft!.txns[draft!.txns.length - 1];
      if (!parent || parent.date !== date) {
        notes.push(`charge "${desc}" on ${date} has no parent transaction`);
        continue;
      }
      if (/stamp/i.test(desc)) parent.stampDuty += charge;
      else if (/STT/i.test(desc)) parent.stt += charge;
      else if (/TDS/i.test(desc)) parent.tds += charge;
      else notes.push(`unknown charge row "${desc}" on ${date}`);
      continue;
    }
    if (!nums.units && !nums.amount) continue;
    const units = nums.units ? parseScaled(nums.units, 3) : 0;
    draft!.txns.push({
      date,
      description: desc,
      type: classifyCasTxn(desc, units),
      amount: nums.amount ? parsePaise(nums.amount) : 0,
      units,
      nav: nums.price ? parseScaled(nums.price, 4) : 0,
      unitBalance: nums.balance ? parseScaled(nums.balance, 3) : 0,
      stampDuty: 0,
      stt: 0,
      tds: 0,
    });
  }

  const checks: Check[] = [];
  for (const s of schemes) {
    const label = s.isin;
    checks.push(check(`${label}: opening + Σ units = closing`, s.closingUnits, s.openingUnits + s.txns.reduce((a, t) => a + t.units, 0)));
    let run = s.openingUnits;
    let bad = 0;
    for (const t of s.txns) {
      run += t.units;
      if (t.unitBalance !== run) bad++;
    }
    checks.push(check(`${label}: running unit balance mismatches`, 0, bad));
    checks.push(check(`${label}: closing units × NAV = market value`, s.marketValue, Math.round((s.closingUnits * s.nav) / 1e5), 100));
    checks.push(check(`${label}: FIFO cost = Total Cost Value`, s.totalCost, fifoRemainingCost(s.txns), 100));
  }
  for (const p of portfolio) {
    const ss = schemes.filter((s) => s.amc === p.amc);
    checks.push(check(`${p.amc}: Σ scheme cost = summary`, p.cost, ss.reduce((a, s) => a + s.totalCost, 0)));
    checks.push(check(`${p.amc}: Σ scheme market value = summary`, p.marketValue, ss.reduce((a, s) => a + s.marketValue, 0)));
  }
  checks.push(check('Σ AMC cost = Total', total.cost, portfolio.reduce((a, p) => a + p.cost, 0)));
  checks.push(check('Σ AMC market value = Total', total.marketValue, portfolio.reduce((a, p) => a + p.marketValue, 0), 1));

  return {
    source: 'cas',
    periodFrom: parseDate(period[1]),
    periodTo: parseDate(period[2]),
    portfolio,
    total,
    schemes,
    validation: validation(checks, notes),
  };
}
