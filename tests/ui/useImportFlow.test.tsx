// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listImports } from '../../src/db/repos';
import { FinanceDb } from '../../src/db/schema';
import { AppProvider } from '../../src/ui/AppContext';
import { useImportFlow, type ImportFlow } from '../../src/ui/useImportFlow';
import { buildBenefitHistoryXlsx } from '../helpers/syntheticBenefitHistory';

let db: FinanceDb;
let flow: ImportFlow;

beforeEach(async () => {
  db = new FinanceDb(`test-flow-ui-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  await db.delete();
});

function Harness() {
  flow = useImportFlow();
  return (
    <div>
      <span data-testid="step">{flow.state.step}</span>
      <span data-testid="queue">{flow.queue.join(',')}</span>
    </div>
  );
}

function xlsxFile(name: string): File {
  return new File([buildBenefitHistoryXlsx() as BlobPart], name);
}

describe('useImportFlow', () => {
  it('walks two files one at a time: preview → commit → next file', async () => {
    render(
      <AppProvider db={db} today="2026-10-03">
        <Harness />
      </AppProvider>,
    );
    await act(async () => {
      await flow.pickFiles([xlsxFile('a.xlsx'), xlsxFile('b.xlsx')]);
    });

    await waitFor(() => expect(screen.getByTestId('step').textContent).toBe('preview'));
    expect(screen.getByTestId('queue').textContent).toBe('b.xlsx');
    expect(flow.canCommit).toBe(true);

    act(() => flow.commit());
    await waitFor(() => expect(screen.getByTestId('step').textContent).toBe('done'));
    expect(await listImports(db)).toHaveLength(1);

    act(() => flow.reset());
    await waitFor(() => expect(screen.getByTestId('step').textContent).toBe('preview'));
    // The second file has the same bytes, so it is recognised as already imported.
    expect(flow.state.step === 'preview' && flow.state.preview.alreadyImported).toBe(true);
    expect(flow.canCommit).toBe(false);
    expect(screen.getByTestId('queue').textContent).toBe('');
  });

  it('turns an unrecognised file into a choose-source step', async () => {
    render(
      <AppProvider db={db} today="2026-10-03">
        <Harness />
      </AppProvider>,
    );
    await act(async () => {
      await flow.pickFiles([new File([new Uint8Array([0, 1, 2, 3])], 'mystery.bin')]);
    });
    await waitFor(() => expect(['choose-source', 'error']).toContain(screen.getByTestId('step').textContent));
  });
});
