import { beforeAll, describe, expect, it } from 'vitest';
import { detectEpf, parseEpf } from '../../src/parsers/epf';
import { linesText } from '../../src/parsers/pdfText';
import type { EpfPassbook } from '../../src/parsers/types';
import { fixtureLines, hasValueFixture } from '../helpers/fixtures';

const R = 100; // rupees → paise
const CASES = [
  { file: 'epf/epf_AAAAA_FY2018.pdf', prefix: 'AAAAA', fy: 2018, rows: 8, cont: 100000, interest: 5000, closing: 100000 },
  { file: 'epf/epf_AAAAA_FY2019.pdf', prefix: 'AAAAA', fy: 2019, rows: 12, cont: 100000, interest: 5000, closing: 200000 },
  { file: 'epf/epf_AAAAA_FY2020.pdf', prefix: 'AAAAA', fy: 2020, rows: 12, cont: 100000, interest: 5000, closing: 300000 },
  { file: 'epf/epf_AAAAA_FY2021.pdf', prefix: 'AAAAA', fy: 2021, rows: 5, cont: 100000, interest: 5000, closing: 400000 },
  { file: 'epf/epf_BBBBB_FY2021.pdf', prefix: 'BBBBB', fy: 2021, rows: 5, cont: 100000, interest: 5000, closing: 500000 },
  { file: 'epf/epf_BBBBB_FY2022.pdf', prefix: 'BBBBB', fy: 2022, rows: 12, cont: 100000, interest: 5000, closing: 600000 },
  { file: 'epf/epf_BBBBB_FY2023.pdf', prefix: 'BBBBB', fy: 2023, rows: 12, cont: 100000, interest: 5000, closing: 700000 },
  { file: 'epf/epf_BBBBB_FY2024.pdf', prefix: 'BBBBB', fy: 2024, rows: 14, cont: 100000, interest: 5000, closing: 800000 },
  { file: 'epf/epf_BBBBB_FY2025.pdf', prefix: 'BBBBB', fy: 2025, rows: 12, cont: 100000, interest: 5000, closing: 900000 },
  { file: 'epf/epf_BBBBB_FY2026.pdf', prefix: 'BBBBB', fy: 2026, rows: 6, cont: 100000, interest: null, closing: 1000000 },
] as const;

describe('detectEpf', () => {
  it('needs the passbook title and the establishment label', () => {
    expect(detectEpf('Member Passbook\n| Establishment ID/Name X / Y')).toBeGreaterThan(0);
    expect(detectEpf('Consolidated Account Statement')).toBe(0);
  });
});

describe.skipIf(!CASES.every((c) => hasValueFixture(c.file)))('parseEpf on all 10 real passbooks', () => {
  const parsed = new Map<string, EpfPassbook>();
  beforeAll(async () => {
    for (const c of CASES) {
      const lines = await fixtureLines(c.file);
      expect(detectEpf(linesText(lines))).toBeGreaterThan(0);
      parsed.set(c.file, parseEpf(lines));
    }
  });

  it.each(CASES)('$file validates and matches the printed totals', (c) => {
    const p = parsed.get(c.file)!;
    expect(p.source).toBe('epf');
    expect(p.memberId).toMatch(new RegExp(`^${c.prefix}\\d{17}$`));
    expect(p.fyStart).toBe(c.fy);
    expect(p.rows).toHaveLength(c.rows);
    expect(p.totalContributions.ee).toBe(c.cont * R);
    expect(p.interest?.ee ?? null).toBe(c.interest === null ? null : c.interest * R);
    expect(p.closing.ee).toBe(c.closing * R);
    expect(p.closing.er).toBe(c.closing * R);
    expect(p.validation.ok).toBe(true);
  });

  it('joins financial years: opening = previous closing', () => {
    for (let i = 1; i < CASES.length; i++) {
      const prev = CASES[i - 1];
      const cur = CASES[i];
      if (prev.prefix !== cur.prefix) continue;
      expect(parsed.get(cur.file)!.opening.ee).toBe(prev.closing * R);
    }
  });

  it('reads transfers in with the old member ID', () => {
    const fy21 = parsed.get('epf/epf_BBBBB_FY2021.pdf')!.rows.filter((r) => r.kind === 'transferIn');
    expect(fy21).toHaveLength(1);
    expect(fy21[0].amounts.ee).toBe(50000 * R);
    expect(fy21[0].fromMemberId).toMatch(/^BBBBB\d{12}00001$/);

    const fy24 = parsed.get('epf/epf_BBBBB_FY2024.pdf')!.rows.filter((r) => r.kind === 'transferIn');
    expect(fy24.map((r) => r.amounts.ee)).toEqual([200000 * R, 10000 * R]);
    const memberA = parsed.get('epf/epf_AAAAA_FY2021.pdf')!.memberId;
    expect(fy24.every((r) => r.fromMemberId === memberA)).toBe(true);
    expect(fy24[1].particulars).toMatch(/INTEREST AMOUNT ONLY/);
  });

  it('reads contribution rows', () => {
    const r = parsed.get('epf/epf_BBBBB_FY2025.pdf')!.rows[0];
    expect(r).toMatchObject({ wageMonth: '2025-03', creditDate: '2025-04-01', kind: 'contribution', epfWages: 100000 * R });
    expect(r.amounts).toEqual({ ee: 12000 * R, er: 12000 * R, eps: 0 });
  });
});
