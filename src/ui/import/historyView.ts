import type { SourceId } from '../../parsers';
import { monthLabel } from '../format';
import type { ImportHistoryItem } from '../useImportHistory';

export type HistorySort = 'added-desc' | 'added-asc' | 'period-desc' | 'rows-desc';
export type HistoryGroup = 'none' | 'source' | 'month';
export type VerifiedFilter = 'all' | 'verified' | 'unverified';

export interface HistoryView {
  search: string;
  sort: HistorySort;
  group: HistoryGroup;
  verified: VerifiedFilter;
  sources: SourceId[];
}

export const DEFAULT_VIEW: HistoryView = { search: '', sort: 'added-desc', group: 'none', verified: 'all', sources: [] };

export const SORT_LABELS: Record<HistorySort, string> = {
  'added-desc': 'Newest added',
  'added-asc': 'Oldest added',
  'period-desc': 'Latest period',
  'rows-desc': 'Most rows',
};

export const GROUP_LABELS: Record<HistoryGroup, string> = { none: 'No grouping', source: 'By source', month: 'By month added' };

const totalRows = (item: ImportHistoryItem) => Object.values(item.counts).reduce((sum, n) => sum + n, 0);

function matches(item: ImportHistoryItem, query: string): boolean {
  if (query === '') return true;
  const haystack = [item.label, item.periodFrom, item.periodTo, item.importedAt, ...item.notes].join(' ').toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

const COMPARE: Record<HistorySort, (a: ImportHistoryItem, b: ImportHistoryItem) => number> = {
  'added-desc': (a, b) => b.importedAt.localeCompare(a.importedAt),
  'added-asc': (a, b) => a.importedAt.localeCompare(b.importedAt),
  'period-desc': (a, b) => b.periodTo.localeCompare(a.periodTo),
  'rows-desc': (a, b) => totalRows(b) - totalRows(a),
};

/** Filter, sort and group import history; groups keep first-seen order of the sorted list. */
export function applyHistoryView(items: ImportHistoryItem[], view: HistoryView): { title: string | null; items: ImportHistoryItem[] }[] {
  const query = view.search.trim().toLowerCase();
  const kept = items
    .filter((item) => matches(item, query))
    .filter((item) => view.verified === 'all' || item.verified === (view.verified === 'verified'))
    .filter((item) => view.sources.length === 0 || view.sources.includes(item.source))
    .sort(COMPARE[view.sort]);
  if (view.group === 'none') return kept.length === 0 ? [] : [{ title: null, items: kept }];
  const groups = new Map<string, ImportHistoryItem[]>();
  for (const item of kept) {
    const title = view.group === 'source' ? item.label : monthLabel(item.importedAt.slice(0, 7));
    groups.set(title, [...(groups.get(title) ?? []), item]);
  }
  return [...groups].map(([title, list]) => ({ title, items: list }));
}
