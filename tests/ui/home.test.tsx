// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb } from '../../src/db/schema';
import { AppProvider, useApp } from '../../src/ui/AppContext';
import { Home } from '../../src/ui/pages/Home';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-home-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  await db.delete();
});

function HideToggle() {
  const { setHideAmounts } = useApp();
  return <button onClick={() => setHideAmounts(true)}>hide</button>;
}

function renderHome() {
  return render(
    <AppProvider db={db} today="2026-10-03">
      <MemoryRouter>
        <HideToggle />
        <Home />
      </MemoryRouter>
    </AppProvider>,
  );
}

async function seedCash(balance: number) {
  await db.accounts.add({ id: 'cash', kind: 'cash', institution: 'Cash', name: 'Cash', maskedNumber: '', meta: {} });
  await db.balanceSnapshots.add({ accountId: 'cash', date: '2026-09-30', balance, source: 'manual', importId: null });
}

describe('Home', () => {
  it('shows the first-run screen with an Import button when there are no accounts', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { name: 'Import your first statement' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Import/ }).getAttribute('href')).toBe('/import');
    expect(screen.getByRole('button', { name: 'Try with sample data' })).toBeTruthy();
    expect(screen.getByText('EPF passbook')).toBeTruthy();
    expect(screen.queryByTestId('net-worth')).toBeNull();
  });

  it('shows the net worth hero, in whole rupees, once an account exists', async () => {
    await seedCash(435_247_000);
    renderHome();
    const hero = await screen.findByTestId('net-worth');
    expect(hero.getAttribute('data-paise')).toBe('435247000');
    expect(hero.textContent).toBe('₹43,52,470');
    expect(screen.getByText(/As of /)).toBeTruthy();
  });

  it('masks every amount and says so when amounts are hidden', async () => {
    await seedCash(435_247_000);
    renderHome();
    await screen.findByTestId('net-worth');
    fireEvent.click(screen.getByText('hide'));
    await waitFor(() => expect(screen.getByText('Amounts hidden')).toBeTruthy());
    expect(screen.getByTestId('net-worth').textContent).not.toContain('43,52,470');
  });

  it('opens and closes the calculation sheet with the keyboard', async () => {
    await seedCash(435_247_000);
    renderHome();
    fireEvent.click(await screen.findByRole('button', { name: /Net worth/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Net worth breakdown' });
    expect(dialog.textContent).toContain('Not included');
    await waitFor(() => expect(dialog.textContent).toContain('Cash'));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
