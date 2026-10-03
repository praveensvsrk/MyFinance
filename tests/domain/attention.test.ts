import { describe, expect, it } from 'vitest';
import { needsAttention, type Attention, type AttentionState, type StatementFreshness } from '../../src/domain/attention';

/** A quiet state: recent CAS and backup, persistent storage, nothing failing. */
function state(over: Partial<AttentionState> = {}): AttentionState {
  return {
    today: '2026-10-03',
    lastStatementByAccount: [],
    lastCasDate: '2026-10-01',
    lastBackupAt: '2026-10-01',
    priceFailures: [],
    unverifiedImports: [],
    staleProvisionals: 0,
    storagePersisted: true,
    ...over,
  };
}

function kinds(items: Attention[]): string[] {
  return items.map((item) => item.kind);
}

describe('needsAttention (quiet)', () => {
  it('returns no items when everything is fresh', () => {
    expect(needsAttention(state())).toEqual([]);
  });
});

describe('needsAttention — statement freshness', () => {
  const bank = (date: string): StatementFreshness => ({ accountId: 'sbi-1234', kind: 'bank', name: 'SBI Savings', date });
  const epf = (date: string): StatementFreshness => ({ accountId: 'epf-00001', kind: 'epf', name: 'EPF', date });

  it('flags a bank statement older than 35 days', () => {
    const items = needsAttention(state({ lastStatementByAccount: [bank('2026-08-28')] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'stale-bank', target: '/accounts/sbi-1234' });
    expect(items[0].message).toContain('36');
  });

  it('does not flag a bank statement exactly 35 days old', () => {
    expect(needsAttention(state({ lastStatementByAccount: [bank('2026-08-29')] }))).toEqual([]);
  });

  it('flags an EPF account older than 90 days (not the 35-day bank threshold)', () => {
    const items = needsAttention(state({ lastStatementByAccount: [epf('2026-07-04')] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'stale-epf', target: '/accounts/epf-00001' });
    expect(items[0].message).toContain('91');
  });

  it('does not flag an EPF account exactly 90 days old', () => {
    expect(needsAttention(state({ lastStatementByAccount: [epf('2026-07-05')] }))).toEqual([]);
  });

  it('emits one item per stale account', () => {
    const items = needsAttention(
      state({
        lastStatementByAccount: [bank('2026-08-28'), epf('2026-07-04'), bank('2026-08-28')],
      }),
    );
    expect(kinds(items)).toEqual(['stale-bank', 'stale-epf', 'stale-bank']);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it('ignores account kinds without a staleness rule', () => {
    const items = needsAttention(
      state({
        lastStatementByAccount: [{ accountId: 'ubi-loan-1234', kind: 'loan', name: 'Home loan', date: '2025-01-01' }],
      }),
    );
    expect(items).toEqual([]);
  });
});

describe('needsAttention — CAS and backup', () => {
  it('flags when no CAS has ever been imported', () => {
    const items = needsAttention(state({ lastCasDate: null }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'stale-cas', target: '/import' });
  });

  it('flags a CAS older than 35 days and not one exactly 35 days old', () => {
    expect(kinds(needsAttention(state({ lastCasDate: '2026-08-28' })))).toEqual(['stale-cas']);
    expect(needsAttention(state({ lastCasDate: '2026-08-29' }))).toEqual([]);
  });

  it('flags when no backup has ever been taken', () => {
    const items = needsAttention(state({ lastBackupAt: null }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'backup-overdue', target: '/settings#backup' });
  });

  it('flags a backup older than 30 days and not one exactly 30 days old', () => {
    expect(kinds(needsAttention(state({ lastBackupAt: '2026-09-02' })))).toEqual(['backup-overdue']);
    expect(needsAttention(state({ lastBackupAt: '2026-09-03' }))).toEqual([]);
  });
});

describe('needsAttention — imports, prices and storage', () => {
  it('flags each failed price symbol once', () => {
    const items = needsAttention(state({ priceFailures: ['ACME', 'USDINR', 'ACME'] }));
    expect(kinds(items)).toEqual(['price-failed', 'price-failed']);
    expect(items.map((item) => item.target)).toEqual(['/settings#backup', '/settings#backup']);
    expect(items.map((item) => item.message).join(' ')).toContain('ACME');
    expect(items.map((item) => item.message).join(' ')).toContain('USDINR');
  });

  it('flags every unverified import', () => {
    const items = needsAttention(
      state({
        unverifiedImports: [
          { id: 'imp-1', source: 'sbi' },
          { id: 'imp-2', source: 'cas' },
        ],
      }),
    );
    expect(kinds(items)).toEqual(['unverified-import', 'unverified-import']);
    expect(items.map((item) => item.target)).toEqual(['/import', '/import']);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it('flags stale provisional entries as one item', () => {
    const items = needsAttention(state({ staleProvisionals: 2 }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'stale-provisional', target: '/import' });
    expect(items[0].message).toContain('2');
    expect(needsAttention(state({ staleProvisionals: 0 }))).toEqual([]);
  });

  it('flags when storage is not persisted', () => {
    const items = needsAttention(state({ storagePersisted: false }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'storage-not-persisted', target: '/settings#backup' });
  });

  it('does not flag when storage is persisted', () => {
    expect(needsAttention(state({ storagePersisted: true }))).toEqual([]);
  });
});

describe('needsAttention — E*TRADE mismatch', () => {
  it('flags a quantity mismatch between the statement and the Benefit History', () => {
    const items = needsAttention(state({ etradeMismatch: { statement: 100.5, xlsx: 180 } }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'etrade-mismatch', target: '/accounts/equity' });
    expect(items[0].message).toContain('100.5');
    expect(items[0].message).toContain('180');
  });

  it('does not flag when there is no mismatch', () => {
    expect(needsAttention(state())).toEqual([]);
  });
});

describe('needsAttention — combined', () => {
  it('covers every attention kind in one pass', () => {
    const items = needsAttention(
      state({
        lastStatementByAccount: [
          { accountId: 'sbi-1234', kind: 'bank', name: 'SBI Savings', date: '2026-08-28' },
          { accountId: 'epf-00001', kind: 'epf', name: 'EPF', date: '2026-07-04' },
        ],
        lastCasDate: '2026-08-28',
        lastBackupAt: null,
        priceFailures: ['ACME'],
        unverifiedImports: [{ id: 'imp-1', source: 'sbi' }],
        staleProvisionals: 1,
        storagePersisted: false,
        etradeMismatch: { statement: 100.5, xlsx: 180 },
      }),
    );
    expect(kinds(items).sort()).toEqual(
      [
        'stale-bank',
        'stale-epf',
        'stale-cas',
        'backup-overdue',
        'price-failed',
        'unverified-import',
        'stale-provisional',
        'storage-not-persisted',
        'etrade-mismatch',
      ].sort(),
    );
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});

describe('price failure notes', () => {
  it('appends what failed when a note is known', () => {
    const items = needsAttention(
      state({ priceFailures: ['MF:INF1'], priceFailureNotes: { 'MF:INF1': 'Fund X: no matching fund found on mfapi.in' } }),
    );
    expect(items[0].message).toBe('Could not refresh the price for MF:INF1 (Fund X: no matching fund found on mfapi.in)');
  });
});
