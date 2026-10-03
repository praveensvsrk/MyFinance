import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listImports } from '../../src/db/repos';
import { FinanceDb } from '../../src/db/schema';
import type { ImportPreview } from '../../src/services/importPipeline';
import {
  canCommit,
  reduce,
  runCommit,
  runPreview,
  type ImportState,
} from '../../src/services/importFlow';
import { buildBenefitHistoryXlsx } from '../helpers/syntheticBenefitHistory';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-flow-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

const bytes = new Uint8Array([1, 2, 3]);

function fakePreview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    fileHash: 'h',
    source: 'sbi',
    parsed: {} as never,
    mapped: {} as never,
    validation: { ok: true, checks: [], notes: [] },
    alreadyImported: false,
    ambiguous: [],
    ...overrides,
  };
}

function previewState(preview: ImportPreview): Extract<ImportState, { step: 'preview' }> {
  const state = reduce(
    reduce({ step: 'idle' }, { type: 'picked', fileName: 'a.pdf' }),
    { type: 'previewed', fileName: 'a.pdf', bytes, outcome: { status: 'ok', preview } },
  );
  if (state.step !== 'preview') throw new Error(`expected preview, got ${state.step}`);
  return state;
}

describe('reduce', () => {
  it('walks idle → reading → preview → committing → done', () => {
    let state: ImportState = reduce({ step: 'idle' }, { type: 'picked', fileName: 'a.pdf' });
    expect(state).toEqual({ step: 'reading', fileName: 'a.pdf' });
    state = previewState(fakePreview());
    expect(state).toMatchObject({ step: 'preview', fileName: 'a.pdf', unverified: false, savePassword: false });
    state = reduce(state, { type: 'commit-started' });
    expect(state).toEqual({ step: 'committing' });
    state = reduce(state, { type: 'commit-finished', importId: 'i1', counts: { transactions: 3 } });
    expect(state).toEqual({ step: 'done', importId: 'i1', counts: { transactions: 3 } });
    expect(reduce(state, { type: 'reset' })).toEqual({ step: 'idle' });
  });

  it('asks for a password and flags a wrong one', () => {
    const reading = reduce({ step: 'idle' }, { type: 'picked', fileName: 'a.pdf' });
    const need = reduce(reading, {
      type: 'previewed',
      fileName: 'a.pdf',
      bytes,
      outcome: { status: 'password-required' },
    });
    expect(need).toMatchObject({ step: 'need-password', wrong: false });
    const again = reduce(need, { type: 'password-submitted', password: 'x' });
    expect(again).toEqual({ step: 'reading', fileName: 'a.pdf' });
    const wrong = reduce(again, {
      type: 'previewed',
      fileName: 'a.pdf',
      bytes,
      outcome: { status: 'password-incorrect' },
      password: 'x',
    });
    expect(wrong).toMatchObject({ step: 'need-password', wrong: true });
  });

  it('offers a source choice for an unknown file and errors on a failed parse', () => {
    const reading = reduce({ step: 'idle' }, { type: 'picked', fileName: 'a.pdf' });
    expect(
      reduce(reading, {
        type: 'previewed',
        fileName: 'a.pdf',
        bytes,
        outcome: { status: 'unknown', reason: 'no match' },
      }),
    ).toMatchObject({ step: 'choose-source', reason: 'no match' });
    expect(
      reduce(reading, {
        type: 'previewed',
        fileName: 'a.pdf',
        bytes,
        outcome: { status: 'error', source: 'sbi', message: 'bad' },
      }),
    ).toEqual({ step: 'error', message: 'bad' });
    expect(reduce(reading, { type: 'failed', message: 'boom' })).toEqual({ step: 'error', message: 'boom' });
  });

  it('records assignments and toggles', () => {
    let state: ImportState = previewState(fakePreview({ ambiguous: [{ bankTxnId: 't1', candidates: ['f1', 'f2'] }] }));
    state = reduce(state, { type: 'assign', bankTxnId: 't1', schemeKey: 'f2' });
    state = reduce(state, { type: 'toggle-save-password' });
    state = reduce(state, { type: 'toggle-unverified' });
    expect(state).toMatchObject({ assignments: { t1: 'f2' }, savePassword: true, unverified: true });
  });
});

describe('canCommit', () => {
  it('needs every ambiguous debit answered', () => {
    const preview = fakePreview({ ambiguous: [{ bankTxnId: 't1', candidates: ['f1', 'f2'] }] });
    let state: ImportState = previewState(preview);
    expect(canCommit(state)).toBe(false);
    state = reduce(state, { type: 'assign', bankTxnId: 't1', schemeKey: 'unassigned' });
    expect(canCommit(state)).toBe(true);
  });

  it('blocks a failed validation unless saved as unverified', () => {
    const preview = fakePreview({ validation: { ok: false, checks: [], notes: [] } });
    let state: ImportState = previewState(preview);
    expect(canCommit(state)).toBe(false);
    state = reduce(state, { type: 'toggle-unverified' });
    expect(canCommit(state)).toBe(true);
  });

  it('blocks a file that was already imported, and any non-preview state', () => {
    expect(canCommit(previewState(fakePreview({ alreadyImported: true })))).toBe(false);
    expect(canCommit({ step: 'idle' })).toBe(false);
  });
});

describe('runPreview and runCommit', () => {
  it('imports the synthetic Benefit History once, then reports it as already imported', async () => {
    const file = buildBenefitHistoryXlsx();
    const event = await runPreview(db, file, 'BenefitHistory.xlsx', {});
    expect(event.type).toBe('previewed');
    let state = reduce(reduce({ step: 'idle' }, { type: 'picked', fileName: 'BenefitHistory.xlsx' }), event);
    expect(state).toMatchObject({ step: 'preview' });
    if (state.step !== 'preview') return;
    expect(state.preview.source).toBe('etrade-xlsx');
    expect(state.preview.validation.ok).toBe(true);
    expect(canCommit(state)).toBe(true);

    const done = await runCommit(db, state);
    expect(done.type).toBe('commit-finished');
    expect(await listImports(db)).toHaveLength(1);

    const second = await runPreview(db, file, 'BenefitHistory.xlsx', {});
    state = reduce(reduce({ step: 'idle' }, { type: 'picked', fileName: 'BenefitHistory.xlsx' }), second);
    expect(state).toMatchObject({ step: 'preview' });
    if (state.step === 'preview') {
      expect(state.preview.alreadyImported).toBe(true);
      expect(canCommit(state)).toBe(false);
    }
  });

  it('turns an unrecognised file into a choose-source step', async () => {
    const event = await runPreview(db, new Uint8Array([0, 1, 2, 3]), 'mystery.bin', {});
    expect(event.type).toBe('previewed');
    const state = reduce(reduce({ step: 'idle' }, { type: 'picked', fileName: 'mystery.bin' }), event);
    expect(['choose-source', 'error']).toContain(state.step);
  });
});
