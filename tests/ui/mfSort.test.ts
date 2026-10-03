import { describe, expect, it } from 'vitest';
import type { MfSchemeSummary } from '../../src/services/dashboard';
import { defaultDirection, sortSchemes } from '../../src/ui/accounts/mfSort';

function scheme(name: string, over: Partial<MfSchemeSummary>): MfSchemeSummary {
  return {
    folioId: name,
    scheme: name,
    isin: '',
    amfiCode: null,
    units: 0,
    invested: 100,
    value: 100,
    gain: 0,
    nav: null,
    navDate: null,
    xirr: null,
    ...over,
  };
}

const A = scheme('Alpha', { value: 300, invested: 100, gain: 200, xirr: 0.1 });
const B = scheme('Beta', { value: 200, invested: 400, gain: -200, xirr: 0.3 });
const C = scheme('Gamma', { value: 250, invested: 0, gain: 250, xirr: null });
const names = (list: MfSchemeSummary[]) => list.map((item) => item.scheme);

describe('sortSchemes', () => {
  it('orders by current value high to low by default direction', () => {
    expect(names(sortSchemes([B, C, A], 'value', defaultDirection('value')))).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(names(sortSchemes([B, C, A], 'value', 'asc'))).toEqual(['Beta', 'Gamma', 'Alpha']);
  });

  it('orders by returns in rupees and by returns percent', () => {
    expect(names(sortSchemes([A, B, C], 'gain', 'desc'))).toEqual(['Gamma', 'Alpha', 'Beta']);
    // Gamma invested nothing, so it has no percentage and goes last either way.
    expect(names(sortSchemes([A, B, C], 'gainPct', 'desc'))).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(names(sortSchemes([A, B, C], 'gainPct', 'asc'))).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('puts funds without an XIRR last in both directions', () => {
    expect(names(sortSchemes([C, A, B], 'xirr', 'desc'))).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(names(sortSchemes([C, A, B], 'xirr', 'asc'))).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by name and does not mutate its input', () => {
    const input = [B, C, A];
    expect(names(sortSchemes(input, 'name', defaultDirection('name')))).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(names(sortSchemes(input, 'name', 'desc'))).toEqual(['Gamma', 'Beta', 'Alpha']);
    expect(names(input)).toEqual(['Beta', 'Gamma', 'Alpha']);
  });
});
