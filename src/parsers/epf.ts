import type { EpfAmounts, EpfPassbook, EpfRow, EpfRowKind } from './types';
import { linesText, type Line } from './pdfText';
import { parseDate, parseMonthYear, parsePaise } from './normalize';
import { check, validation } from './validation';

const COL = { epfWages: 339, epsWages: 396, ee: 453, er: 511, eps: 568 };
const ROW_RE = /^([A-Z][a-z]{2}-\d{4}) (\d\d-\d\d-\d{4})/;
const MEMBER_RE = /[A-Z]{5}\d{17}/;
const NUM_RE = /^[\d,]+$/;

export function detectEpf(text: string): number {
  return /Member Passbook/.test(text) && /Establishment ID/.test(text) ? 1 : 0;
}

function amountAt(l: Line, xe: number): number {
  const c = l.cells.find((c) => Math.abs(c.xe - xe) < 6 && NUM_RE.test(c.s));
  return c ? parsePaise(c.s) : 0;
}

const amounts = (l: Line): EpfAmounts => ({ ee: amountAt(l, COL.ee), er: amountAt(l, COL.er), eps: amountAt(l, COL.eps) });

export function parseEpf(lines: Line[]): EpfPassbook {
  const all = linesText(lines);
  const memberLine = lines.find((l) => /^[A-Z]{5}\d{17}\b/.test(l.cells[0]?.s ?? ''));
  const est = all.match(/Establishment ID\/Name\s+([A-Z0-9]+)\s*\/\s*(.+)/);
  const fy = all.match(/Financial Year - (\d{4})-\d{4}/);
  const obLine = lines.find((l) => /^OB Int\. Updated upto/.test(l.text));
  const closeLine = lines.find((l) => /^Closing Balance as on/.test(l.text));
  if (!memberLine || !est || !fy || !obLine || !closeLine) throw new Error('EPF passbook: header or balances not found');
  const memberId = memberLine.cells[0].s.match(MEMBER_RE)![0];

  const section = lines.slice(lines.indexOf(obLine) + 1, lines.indexOf(closeLine));
  const rowLines = section.filter((l) => ROW_RE.test(l.text));

  // Wrapped particulars (transfer rows) sit above and below the amount line: give each to the nearest
  // non-contribution row line (contribution rows always have their particulars inline).
  const wrapTargets = rowLines.filter((l) => !/Cont\. for/.test(l.text));
  const extra = new Map<Line, Line[]>();
  for (const l of section) {
    if (ROW_RE.test(l.text) || /^Total /.test(l.text)) continue;
    const x = l.cells[0]?.x ?? 0;
    if (x < 165 || x >= 300) continue;
    let best: Line | undefined;
    for (const r of wrapTargets) {
      if (r.page !== l.page || Math.abs(r.y - l.y) >= 14) continue;
      if (!best || Math.abs(r.y - l.y) < Math.abs(best.y - l.y)) best = r;
    }
    if (best) extra.set(best, [...(extra.get(best) ?? []), l]);
  }

  const rows: EpfRow[] = rowLines.map((l) => {
    const m = l.text.match(ROW_RE)!;
    const inline = l.cells
      .filter((c) => c.x >= 165 && c.x < 300 && !NUM_RE.test(c.s))
      .map((c) => c.s)
      .join(' ');
    const parts = [...(extra.get(l) ?? []), l]
      .sort((a, b) => a.y - b.y)
      .map((p) => (p === l ? inline : p.text));
    const particulars = parts.join(' ').replace(/\s+/g, ' ').trim();
    const sign = l.cells[1]?.s === 'DR' ? -1 : 1;
    const a = amounts(l);
    const kind: EpfRowKind = /^Cont\. for/i.test(particulars) ? 'contribution' : sign < 0 ? 'withdrawal' : 'transferIn';
    const from = kind === 'contribution' ? null : particulars.match(MEMBER_RE);
    const row: EpfRow = {
      wageMonth: parseMonthYear(m[1]),
      creditDate: parseDate(m[2]),
      kind,
      particulars,
      epfWages: amountAt(l, COL.epfWages),
      epsWages: amountAt(l, COL.epsWages),
      amounts: { ee: sign * a.ee, er: sign * a.er, eps: sign * a.eps },
    };
    if (from) row.fromMemberId = from[0];
    return row;
  });

  const intLine = lines.find((l) => /^Int\. Updated upto/.test(l.text));
  const interest = intLine ? amounts(intLine) : null;
  const totLine = lines.find((l) => /^Total Contributions for the year/.test(l.text));
  const totalContributions = totLine ? amounts(totLine) : { ee: 0, er: 0, eps: 0 };
  const opening = amounts(obLine);
  const closing = amounts(closeLine);

  const checks = (['ee', 'er', 'eps'] as const).flatMap((k) => [
    check(
      `${k}: opening + Σ rows + interest = closing`,
      closing[k],
      opening[k] + rows.reduce((a, r) => a + r.amounts[k], 0) + (interest?.[k] ?? 0),
    ),
    check(
      `${k}: Σ contribution rows = Total Contributions`,
      totalContributions[k],
      rows.filter((r) => r.kind === 'contribution').reduce((a, r) => a + r.amounts[k], 0),
    ),
  ]);

  return {
    source: 'epf',
    memberId,
    establishmentId: est[1],
    establishmentName: est[2].trim(),
    fyStart: Number(fy[1]),
    opening,
    rows,
    interest,
    closing,
    totalContributions,
    validation: validation(checks),
  };
}
