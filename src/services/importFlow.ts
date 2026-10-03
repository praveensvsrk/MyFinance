/**
 * The import screen's state machine (§6.6): pick → (password | choose source) → preview → commit.
 * The reducer is pure; `runPreview` and `runCommit` do the I/O and report back as events, so a
 * hook can drive the flow and a test can walk it without a UI.
 */

import type { ParseOptions, SourceId } from '../parsers';
import type { FinanceDb } from '../db/schema';
import { commitImport, previewImport, type ImportPreview, type PreviewResult } from './importPipeline';

export type PreviewStep = {
  step: 'preview';
  fileName: string;
  bytes: Uint8Array;
  preview: ImportPreview;
  /** Bank debit id → scheme key (or `unassigned`) for debits the SIP links could not place. */
  assignments: Record<string, string>;
  /** The password that unlocked the file, if the user typed one. */
  password?: string;
  savePassword: boolean;
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
  | { type: 'previewed'; fileName: string; bytes: Uint8Array; outcome: PreviewResult; password?: string }
  | { type: 'password-submitted'; password: string }
  | { type: 'source-chosen'; source: SourceId }
  | { type: 'assign'; bankTxnId: string; schemeKey: string }
  | { type: 'toggle-save-password' }
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
            ...(event.password === undefined ? {} : { password: event.password }),
            savePassword: false,
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
    case 'toggle-save-password':
      return state.step === 'preview' ? { ...state, savePassword: !state.savePassword } : state;
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
    return {
      type: 'previewed',
      fileName,
      bytes,
      outcome,
      ...(opts.password === undefined ? {} : { password: opts.password }),
    };
  } catch (error) {
    return { type: 'failed', message: (error as Error).message };
  }
}

/** Saves the preview with the user's choices; reports `commit-finished` or `failed`. */
export async function runCommit(db: FinanceDb, state: PreviewStep): Promise<ImportEvent> {
  try {
    const importId = await commitImport(db, state.preview, {
      unverified: state.unverified,
      assignments: state.assignments,
      ...(state.savePassword && state.password !== undefined
        ? { savePasswordFor: { source: state.preview.source, password: state.password } }
        : {}),
    });
    return { type: 'commit-finished', importId, counts: { ...state.preview.mapped.summary.counts } };
  } catch (error) {
    return { type: 'failed', message: (error as Error).message };
  }
}
