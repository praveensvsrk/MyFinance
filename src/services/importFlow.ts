/**
 * The import screen's state machine (§6.6): pick → (password | choose source) → preview → commit.
 * The reducer is pure; `runPreview` and `runCommit` do the I/O and report back as events, so a
 * hook can drive the flow and a test can walk it without a UI.
 */

import type { ParseOptions, SourceId } from '../parsers';
import type { FinanceDb } from '../db/schema';
import { equitySymbol } from '../db/repos';
import { refreshPrices } from './prices';
import { commitImport, previewImport, type ImportPreview, type PreviewResult } from './importPipeline';

export type PreviewStep = {
  step: 'preview';
  fileName: string;
  bytes: Uint8Array;
  preview: ImportPreview;
  /** Bank debit id → scheme key (or `unassigned`) for debits the SIP links could not place. */
  assignments: Record<string, string>;
  unverified: boolean;
};

export type ImportState =
  | { step: 'idle' }
  | { step: 'reading'; fileName: string }
  | { step: 'need-password'; fileName: string; bytes: Uint8Array; wrong: boolean }
  | { step: 'choose-source'; fileName: string; bytes: Uint8Array; reason: string }
  | PreviewStep
  | { step: 'committing' }
  | { step: 'done'; importId: string; counts: Record<string, number> }
  | { step: 'error'; message: string };

export type ImportEvent =
  | { type: 'picked'; fileName: string }
  | { type: 'previewed'; fileName: string; bytes: Uint8Array; outcome: PreviewResult }
  | { type: 'password-submitted'; password: string }
  | { type: 'source-chosen'; source: SourceId }
  | { type: 'assign'; bankTxnId: string; schemeKey: string }
  | { type: 'toggle-unverified' }
  | { type: 'commit-started' }
  | { type: 'commit-finished'; importId: string; counts: Record<string, number> }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

export function reduce(state: ImportState, event: ImportEvent): ImportState {
  switch (event.type) {
    case 'picked':
      return { step: 'reading', fileName: event.fileName };
    case 'previewed': {
      const { outcome, fileName, bytes } = event;
      switch (outcome.status) {
        case 'ok':
          return {
            step: 'preview',
            fileName,
            bytes,
            preview: outcome.preview,
            assignments: {},
            unverified: false,
          };
        case 'password-required':
          return { step: 'need-password', fileName, bytes, wrong: false };
        case 'password-incorrect':
          return { step: 'need-password', fileName, bytes, wrong: true };
        case 'unknown':
          return { step: 'choose-source', fileName, bytes, reason: outcome.reason };
        case 'error':
          return { step: 'error', message: outcome.message };
      }
      return state;
    }
    case 'password-submitted':
      return state.step === 'need-password' ? { step: 'reading', fileName: state.fileName } : state;
    case 'source-chosen':
      return state.step === 'choose-source' ? { step: 'reading', fileName: state.fileName } : state;
    case 'assign':
      return state.step === 'preview'
        ? { ...state, assignments: { ...state.assignments, [event.bankTxnId]: event.schemeKey } }
        : state;
    case 'toggle-unverified':
      return state.step === 'preview' ? { ...state, unverified: !state.unverified } : state;
    case 'commit-started':
      return state.step === 'preview' ? { step: 'committing' } : state;
    case 'commit-finished':
      return { step: 'done', importId: event.importId, counts: event.counts };
    case 'failed':
      return { step: 'error', message: event.message };
    case 'reset':
      return { step: 'idle' };
  }
}

/** True when the preview can be saved: not a repeat, validated (or saved as unverified), all SIP debits answered. */
export function canCommit(state: ImportState): boolean {
  if (state.step !== 'preview') return false;
  const { preview, unverified, assignments } = state;
  if (preview.alreadyImported) return false;
  if (!preview.validation.ok && !unverified) return false;
  return preview.ambiguous.every((debit) => assignments[debit.bankTxnId] !== undefined);
}

/** Parses and maps a file, reporting the result as a `previewed` (or `failed`) event. */
export async function runPreview(
  db: FinanceDb,
  bytes: Uint8Array,
  fileName: string,
  opts: ParseOptions,
): Promise<ImportEvent> {
  try {
    const outcome = await previewImport(db, bytes, opts);
    return { type: 'previewed', fileName, bytes, outcome };
  } catch (error) {
    return { type: 'failed', message: (error as Error).message };
  }
}

/**
 * Saves the preview with the user's choices; reports `commit-finished` or `failed`. When the import
 * names a different employer stock than before and a `fetch` is given, its quote is fetched at
 * once: the daily refresh ran without knowing the ticker, so it would otherwise wait a day.
 */
export async function runCommit(db: FinanceDb, state: PreviewStep, doFetch?: typeof fetch): Promise<ImportEvent> {
  try {
    const symbolBefore = await equitySymbol(db);
    const importId = await commitImport(db, state.preview, {
      unverified: state.unverified,
      assignments: state.assignments,
    });
    if (doFetch !== undefined && (await equitySymbol(db)) !== symbolBefore) {
      try {
        await refreshPrices(db, { fetch: doFetch, force: true });
      } catch {
        // Best effort: a failed refresh is recorded for Needs attention and retried daily.
      }
    }
    return { type: 'commit-finished', importId, counts: { ...state.preview.mapped.summary.counts } };
  } catch (error) {
    return { type: 'failed', message: (error as Error).message };
  }
}
