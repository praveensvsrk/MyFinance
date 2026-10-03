import { describe, expect, it } from 'vitest';
import { applyHistoryView, DEFAULT_VIEW } from '../../src/ui/import/historyView';
import type { ImportHistoryItem } from '../../src/ui/useImportHistory';

const item = (id: string, source: ImportHistoryItem['source'], label: string, importedAt: string, rows: number, verified = true): ImportHistoryItem => ({
  id, fileHash: id, source, label, periodFrom: '2026-09-01', periodTo: importedAt, importedAt, counts: { transactions: rows }, verified, notes: [],
});
const items = [
  item('a', 'sbi', 'SBI savings', '2026-09-30', 5),
  item('b', 'epf', 'EPF passbook', '2026-10-02', 50, false),
  item('c', 'sbi', 'SBI savings', '2026-10-05', 20),
];
const ids = (g: ReturnType<typeof applyHistoryView>) => g.flatMap((x) => x.items.map((i) => i.id));

describe('applyHistoryView', () => {
  it('sorts', () => {
    expect(ids(applyHistoryView(items, DEFAULT_VIEW))).toEqual(['c', 'b', 'a']);
    expect(ids(applyHistoryView(items, { ...DEFAULT_VIEW, sort: 'added-asc' }))).toEqual(['a', 'b', 'c']);
    expect(ids(applyHistoryView(items, { ...DEFAULT_VIEW, sort: 'rows-desc' }))).toEqual(['b', 'c', 'a']);
  });
  it('searches and filters', () => {
    expect(ids(applyHistoryView(items, { ...DEFAULT_VIEW, search: 'epf' }))).toEqual(['b']);
    expect(ids(applyHistoryView(items, { ...DEFAULT_VIEW, verified: 'unverified' }))).toEqual(['b']);
    expect(ids(applyHistoryView(items, { ...DEFAULT_VIEW, sources: ['sbi'] }))).toEqual(['c', 'a']);
  });
  it('groups', () => {
    const g = applyHistoryView(items, { ...DEFAULT_VIEW, group: 'source' });
    expect(g.map((x) => x.title)).toEqual(['SBI savings', 'EPF passbook']);
    expect(applyHistoryView(items, { ...DEFAULT_VIEW, group: 'month' }).map((x) => x.title)).toEqual(['Oct 2026', 'Sep 2026']);
  });
});
