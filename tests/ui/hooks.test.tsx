// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb } from '../../src/db/schema';
import { AppProvider, useApp } from '../../src/ui/AppContext';
import { useAccounts, useHome, useSetting } from '../../src/ui/hooks';
import { Money } from '../../src/ui/Money';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-ui-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
  await db.accounts.add({ id: 'cash', kind: 'cash', institution: 'Cash', name: 'Cash', maskedNumber: '', meta: {} });
  await db.balanceSnapshots.add({
    accountId: 'cash',
    date: '2026-09-30',
    balance: 123_456_700,
    source: 'manual',
    importId: null,
  });
});

afterEach(async () => {
  cleanup();
  await db.delete();
});

function Probe() {
  const accounts = useAccounts();
  const home = useHome();
  return (
    <div>
      <div data-testid="state">{accounts.loading ? 'loading' : 'ready'}</div>
      <div data-testid="accounts">{accounts.data?.map((account) => account.id).join(',')}</div>
      <div data-testid="networth">{home.data?.netWorth}</div>
    </div>
  );
}

function HideToggle() {
  const { hideAmounts, setHideAmounts } = useApp();
  const stored = useSetting('hideAmounts', false);
  return (
    <div>
      <button onClick={() => setHideAmounts(!hideAmounts)}>toggle</button>
      <Money paise={123_456_700} />
      <span data-testid="stored">{String(stored.data)}</span>
    </div>
  );
}

describe('hooks', () => {
  it('load data and re-render live when the database changes', async () => {
    render(
      <AppProvider db={db} today="2026-10-03">
        <Probe />
      </AppProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('accounts').textContent).toBe('cash'));
    await waitFor(() => expect(screen.getByTestId('networth').textContent).toBe('123456700'));

    await act(async () => {
      await db.balanceSnapshots.add({
        accountId: 'cash',
        date: '2026-10-01',
        balance: 200_000_000,
        source: 'manual',
        importId: null,
      });
    });
    await waitFor(() => expect(screen.getByTestId('networth').textContent).toBe('200000000'));
  });

  it('hides amounts everywhere and remembers the choice', async () => {
    render(
      <AppProvider db={db} today="2026-10-03">
        <HideToggle />
      </AppProvider>,
    );
    expect(screen.getByText('₹12,34,567.00')).toBeTruthy();
    await act(async () => {
      screen.getByText('toggle').click();
    });
    expect(screen.getByText('••••')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('stored').textContent).toBe('true'));
  });
});
