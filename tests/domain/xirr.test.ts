import { describe, expect, it } from 'vitest';
import type { IsoDate } from '../../src/parsers/types';
import { xirr } from '../../src/domain/xirr';

const DAY_MS = 86_400_000;
const TOL = 1e-6;

interface Flow {
  date: IsoDate;
  amount: number;
}

/** Independent Actual/365 NPV, built from UTC milliseconds. */
function npv(rate: number, flows: Flow[]): number {
  const base = Date.parse(`${flows[0].date}T00:00:00Z`);
  return flows.reduce((sum, f) => {
    const t = (Date.parse(`${f.date}T00:00:00Z`) - base) / DAY_MS / 365;
    return sum + f.amount / Math.pow(1 + rate, t);
  }, 0);
}

describe('xirr', () => {
  it('solves a one-year 10% return', () => {
    const flows: Flow[] = [
      { date: '2021-01-01', amount: -1000 },
      { date: '2022-01-01', amount: 1100 },
    ];
    const rate = xirr(flows);
    expect(rate).not.toBeNull();
    expect(Math.abs(rate! - 0.1)).toBeLessThan(TOL);
  });

  it('solves a one-year zero return', () => {
    const flows: Flow[] = [
      { date: '2021-01-01', amount: -1000 },
      { date: '2022-01-01', amount: 1000 },
    ];
    const rate = xirr(flows);
    expect(rate).not.toBeNull();
    expect(Math.abs(rate!)).toBeLessThan(TOL);
  });

  it('prices a monthly SIP', () => {
    const flows: Flow[] = [];
    for (let month = 1; month <= 12; month++) {
      flows.push({ date: `2021-${String(month).padStart(2, '0')}-01`, amount: -10000 });
    }
    flows.push({ date: '2022-01-01', amount: 130000 });

    const rate = xirr(flows);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0.14);
    expect(rate!).toBeLessThan(0.16);
    expect(Math.abs(npv(rate!, flows))).toBeLessThanOrEqual(1e-6 * 130000);
  });

  it('returns null with a single positive flow', () => {
    expect(xirr([{ date: '2021-01-01', amount: 100 }])).toBeNull();
  });

  it('returns null when all flows have the same sign', () => {
    expect(
      xirr([
        { date: '2021-01-01', amount: -1000 },
        { date: '2021-07-01', amount: -500 },
      ]),
    ).toBeNull();
  });

  it('finds a negative return close to -75%', () => {
    const flows: Flow[] = [
      { date: '2021-01-01', amount: -1000 },
      { date: '2021-07-01', amount: 500 },
    ];
    const rate = xirr(flows);
    expect(rate).not.toBeNull();
    expect(rate!).toBeLessThan(0);
    expect(Math.abs(rate! + 0.75)).toBeLessThan(0.01);
    expect(npv(rate!, flows)).toBeCloseTo(0, 4);
  });
});
