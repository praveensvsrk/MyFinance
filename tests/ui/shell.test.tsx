// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/App';
import { FinanceDb } from '../../src/db/schema';
import { AppProvider } from '../../src/ui/AppContext';
import { ErrorBoundary } from '../../src/ui/shell/ErrorBoundary';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-shell-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  await db.delete();
});

function renderAt(path: string) {
  return render(
    <AppProvider db={db} today="2026-10-03">
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProvider>,
  );
}

describe('routes', () => {
  it.each([
    ['/', 'Home'],
    ['/cash-flow', 'Cash flow'],
    ['/accounts', 'Accounts'],
    ['/accounts/abc', 'Account'],
    ['/plan', 'Plan'],
    ['/import', 'Import'],
    ['/settings', 'Settings'],
  ])('%s renders the %s screen and its data', async (path, title) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('debug').textContent).not.toBe('loading'));
  });

  it('sends an unknown route to Home', () => {
    renderAt('/nowhere');
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  });

  it('marks Accounts as the active tab on an account page and Home only on /', () => {
    renderAt('/accounts/abc');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const current = Array.from(nav.querySelectorAll('[aria-current="page"]')).map((el) => el.textContent);
    expect(current).toEqual(['Accounts']);
  });

  it('links the header to Import and Settings', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Import' }).getAttribute('href')).toBe('/import');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  });
});

describe('ErrorBoundary', () => {
  it('shows a recovery message when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Boom(): never {
      throw new Error('kaboom');
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('kaboom')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    spy.mockRestore();
  });
});
