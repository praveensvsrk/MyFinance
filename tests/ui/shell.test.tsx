// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
    ['/', 'Home', 'Import your first statement'],
    ['/cash-flow', 'Cash flow', 'Nothing in Oct 2026'],
    ['/cash-flow/year', 'Financial year', 'Nothing for this year'],
    ['/accounts', 'Accounts', 'No accounts yet'],
    ['/accounts/abc', 'Account', 'Account not found'],
    ['/plan', 'Plan', 'Plan needs your numbers'],
    ['/import', 'Import', 'Add your statements'],
    ['/settings', 'Settings', 'Share prices'],
  ])('%s renders the %s screen with its empty state', async (path, title, content) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    await screen.findByRole('heading', { name: content });
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
