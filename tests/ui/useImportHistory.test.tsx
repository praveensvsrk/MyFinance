// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb } from '../../src/db/schema';
import { reduce, runCommit, runPreview, type ImportState } from '../../src/services/importFlow';
import { AppProvider } from '../../src/ui/AppContext';
import { SOURCE_LABELS, useImportHistory } from '../../src/ui/useImportHistory';
import { buildBenefitHistoryXlsx } from '../helpers/syntheticBenefitHistory';

let db: FinanceDb;
let history: ReturnType<typeof useImportHistory>;

beforeEach(async () => {
  db = new FinanceDb(`test-history-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  await db.delete();
});

function Harness() {
  history = useImportHistory();
  return <span data-testid="labels">{history.items.map((item) => item.label).join('|')}</span>;
}

async function importSynthetic(): Promise<void> {
  const event = await runPreview(db, buildBenefitHistoryXlsx(), 'BenefitHistory.xlsx', {});
  const state: ImportState = reduce(reduce({ step: 'idle' }, { type: 'picked', fileName: 'b.xlsx' }), event);
  if (state.step !== 'preview') throw new Error(`expected preview, got ${state.step}`);
  await runCommit(db, state);
}

describe('useImportHistory', () => {
  it('lists imports with a readable label and removes one on undo', async () => {
    await importSynthetic();
    render(
      <AppProvider db={db} today="2026-10-03">
        <Harness />
      </AppProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('labels').textContent).toBe('E*TRADE Benefit History'));
    expect(await db.equityLots.count()).toBeGreaterThan(0);

    const id = history.items[0]!.id;
    await act(async () => {
      await history.undo(id);
    });
    await waitFor(() => expect(screen.getByTestId('labels').textContent).toBe(''));
    expect(await db.equityLots.count()).toBe(0);
  });

  it('has a label for every source', () => {
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual(
      ['cas', 'epf', 'etrade-stmt', 'etrade-xlsx', 'federal', 'generic', 'icici-cc', 'sbi', 'ubi-cert', 'ubi-loan', 'ubi-savings'].sort(),
    );
  });
});
