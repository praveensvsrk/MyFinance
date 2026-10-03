import { useCallback } from 'react';
import type { ImportRow } from '../db/schema';
import type { SourceId } from '../parsers';
import { undoImport } from '../services/importPipeline';
import { useApp } from './AppContext';
import { useImports } from './hooks';

export const SOURCE_LABELS: Record<SourceId, string> = {
  sbi: 'SBI savings',
  federal: 'Federal savings',
  'ubi-savings': 'UBI savings',
  'ubi-loan': 'UBI home loan',
  'ubi-cert': 'UBI interest certificate',
  epf: 'EPF passbook',
  cas: 'CAMS CAS',
  'etrade-xlsx': 'E*TRADE Benefit History',
  'etrade-stmt': 'E*TRADE statement',
};

export type ImportHistoryItem = ImportRow & { label: string };

/** Import history, newest first, with a human label per source, and an undo action (§6.6). */
export function useImportHistory(): {
  items: ImportHistoryItem[];
  loading: boolean;
  undo: (importId: string) => Promise<void>;
} {
  const { db, refresh } = useApp();
  const { data, loading } = useImports();
  const undo = useCallback(
    async (importId: string) => {
      await undoImport(db, importId);
      refresh();
    },
    [db, refresh],
  );
  const items = (data ?? []).map((row) => ({ ...row, label: SOURCE_LABELS[row.source] ?? row.source }));
  return { items, loading, undo };
}
