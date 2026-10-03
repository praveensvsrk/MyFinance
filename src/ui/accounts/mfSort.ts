import type { MfSchemeSummary } from '../../services/dashboard';

/** The ways the scheme list can be ordered, as in a broker's holdings sort. */
export type MfSortKey = 'value' | 'invested' | 'gain' | 'gainPct' | 'xirr' | 'name';
export type SortDirection = 'asc' | 'desc';

export const MF_SORT_LABELS: Record<MfSortKey, string> = {
  value: 'Current value',
  invested: 'Invested amount',
  gain: 'Returns (₹)',
  gainPct: 'Returns (%)',
  xirr: 'XIRR',
  name: 'Name (A–Z)',
};

/** Numbers read best biggest-first; names read A to Z. */
export function defaultDirection(key: MfSortKey): SortDirection {
  return key === 'name' ? 'asc' : 'desc';
}

function numberFor(scheme: MfSchemeSummary, key: Exclude<MfSortKey, 'name'>): number | null {
  switch (key) {
    case 'value':
      return scheme.value;
    case 'invested':
      return scheme.invested;
    case 'gain':
      return scheme.gain;
    case 'gainPct':
      return scheme.invested > 0 ? scheme.gain / scheme.invested : null;
    case 'xirr':
      return scheme.xirr;
  }
}

/**
 * The schemes ordered by `key`. Funds with no figure for the key (no XIRR yet, nothing invested)
 * always go last, whichever way the list runs, and ties fall back to the name.
 */
export function sortSchemes(
  schemes: readonly MfSchemeSummary[],
  key: MfSortKey,
  direction: SortDirection,
): MfSchemeSummary[] {
  const sign = direction === 'asc' ? 1 : -1;
  const byName = (a: MfSchemeSummary, b: MfSchemeSummary) => a.scheme.localeCompare(b.scheme);
  return [...schemes].sort((a, b) => {
    if (key === 'name') return sign * byName(a, b);
    const left = numberFor(a, key);
    const right = numberFor(b, key);
    if (left === null || right === null) {
      if (left === right) return byName(a, b);
      return left === null ? 1 : -1;
    }
    return sign * (left - right) || byName(a, b);
  });
}
