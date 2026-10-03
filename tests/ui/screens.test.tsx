// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../../src/App';
import type { TxnRow } from '../../src/db/schema';
import { FinanceDb } from '../../src/db/schema';
import { AppProvider } from '../../src/ui/AppContext';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-screens-${crypto.randomUUID()}`);
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

function txn(id: string, date: string, description: string, amount: number, extra: Partial<TxnRow> = {}): TxnRow {
  return {
    id,
    accountId: 'sbi',
    date,
    description,
    ref: '',
    amount,
    balanceAfter: 100_000_00,
    category: null,
    categorySource: null,
    kind: 'normal',
    transferPairId: null,
    importId: 'imp',
    fingerprint: `fp-${id}`,
    ...extra,
  };
}

/** One savings account with statement data, a cash entry and a loan, seeded in a single transaction. */
async function seed() {
  await db.transaction('rw', db.tables, async () => {
    await db.accounts.bulkAdd([
      { id: 'sbi', kind: 'savings', institution: 'SBI', name: 'SBI Savings', maskedNumber: '••1234', meta: {} },
      { id: 'cash', kind: 'cash', institution: 'Cash', name: 'Cash', maskedNumber: '', meta: {} },
      { id: 'loan', kind: 'loan', institution: 'UBI', name: 'Home loan', maskedNumber: '••9', meta: { bankEmi: 5_000_000, sanctioned: 600_000_000 } },
    ]);
    await db.balanceSnapshots.bulkAdd([
      { accountId: 'sbi', date: '2026-09-30', balance: 250_000_00, source: 'statement', importId: 'imp' },
      { accountId: 'sbi', date: '2026-10-02', balance: 280_000_00, source: 'statement', importId: 'imp' },
      { accountId: 'cash', date: '2026-10-01', balance: 5_000_00, source: 'manual', importId: null },
      { accountId: 'loan', date: '2026-09-30', balance: -500_000_000, source: 'statement', importId: 'imp' },
    ]);
    await db.transactions.bulkAdd([
      txn('t1', '2026-10-01', 'UPI/123456789012/SWIGGY/food/5812', -450_00, { category: 'Food delivery', categorySource: 'default' }),
      txn('t2', '2026-10-01', 'UPI/123456789013/SWIGGY/lunch/5812', -300_00, { category: 'Food delivery', categorySource: 'default' }),
      txn('t3', '2026-10-02', 'SALARY ACME CREDIT', 1_200_00_00, { category: 'Salary', categorySource: 'default' }),
      txn('t4', '2026-10-02', 'SIP MUTUAL FUND DEBIT', -5_000_00, { kind: 'investment' }),
      txn('t5', '2026-09-15', 'RENT SEPTEMBER', -25_000_00, { category: 'Rent', categorySource: 'default' }),
    ]);
    await db.settings.put({ key: 'planDefaults', value: { loanRateOverridePct: 8.5 } });
  });
}

describe('Accounts', () => {
  it('lists accounts by group with balances and links to each one', async () => {
    await seed();
    renderAt('/accounts');
    const banks = await screen.findByRole('region', { name: 'Banks' });
    expect(within(banks).getByText('SBI Savings')).toBeTruthy();
    expect(within(banks).getAllByText('₹2.8L')).toHaveLength(2); // group total and the row
    expect(within(banks).getByRole('link').getAttribute('href')).toBe('/accounts/sbi');
    expect(screen.getByRole('region', { name: 'Loan' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Cash' })).toBeTruthy();
    expect(screen.queryByText('Out of date')).toBeNull();
  });

  it('offers to add a cash balance when there is no cash account', async () => {
    await db.accounts.add({ id: 'sbi', kind: 'savings', institution: 'SBI', name: 'SBI Savings', maskedNumber: '', meta: {} });
    renderAt('/accounts');
    fireEvent.click(await screen.findByRole('button', { name: /Add cash balance/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cash balance' });
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '2500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save balance' }));
    await waitFor(async () => expect((await db.balanceSnapshots.where('accountId').equals('cash').toArray())[0]?.balance).toBe(250_000));
  });
});

describe('Account detail', () => {
  it('shows the balance, transactions newest first, search and re-categorising', async () => {
    await seed();
    renderAt('/accounts/sbi');
    expect((await screen.findByTestId('account-balance')).textContent).toBe('₹2,80,000');
    const list = await screen.findByTestId('txn-list');
    const days = Array.from(list.querySelectorAll('.day')).map((el) => el.textContent);
    expect(days).toEqual(['2 Oct 2026', '1 Oct 2026', '15 Sep 2026']);

    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'rent' } });
    await waitFor(() => expect(within(screen.getByTestId('txn-list')).queryByText('SWIGGY')).toBeNull());
    expect(within(screen.getByTestId('txn-list')).getByText('RENT SEPTEMBER', { selector: '.mer' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Change category for/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Change category' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Utilities' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.transactions.get('t5'))?.category).toBe('Utilities'));
    expect((await db.transactions.get('t5'))?.categorySource).toBe('manual');
  });

  it('shows the loan terms for a loan account', async () => {
    await seed();
    renderAt('/accounts/loan');
    expect(await screen.findByRole('heading', { name: 'Loan details' })).toBeTruthy();
    expect(screen.getByText('Sanctioned')).toBeTruthy();
    expect((await screen.findByTestId('account-balance')).textContent).toBe('−₹50,00,000');
  });

  it('masks the balance when amounts are hidden', async () => {
    await seed();
    await db.settings.put({ key: 'hideAmounts', value: true });
    renderAt('/accounts/sbi');
    await waitFor(() => expect(screen.getByTestId('account-balance').textContent).toContain('••••'));
    expect(screen.getByTestId('account-balance').textContent).not.toContain('2,80,000');
  });
});

describe('Cash flow', () => {
  it('summarises the month, filters by category and steps between months', async () => {
    await seed();
    renderAt('/cash-flow');
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('₹1.2L')).toBeTruthy();
    // The ₹5,000 SIP debit is an investment, so only the two Swiggy orders count as spending.
    expect(within(summary).getAllByText('₹750').length).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Oct 2026' })).toBeTruthy();
    // Investments and transfers are listed but muted, and never counted as spending.
    expect(within(screen.getByTestId('txn-list')).getByText('Investment')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Food delivery/, pressed: false }));
    const filtered = screen.getByTestId('txn-list');
    expect(within(filtered).queryByText('SALARY ACME CREDIT')).toBeNull();
    expect(filtered.querySelectorAll('.txn')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByTestId('txn-list').querySelectorAll('.txn').length).toBeGreaterThan(2);

    expect(screen.getByRole('button', { name: 'Next month' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('heading', { name: 'Sep 2026' })).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId('txn-list')).getByText('RENT SEPTEMBER', { selector: '.mer' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Next month' }).hasAttribute('disabled')).toBe(false);
  });

  it('says when a month has nothing in it', async () => {
    await seed();
    renderAt('/cash-flow');
    fireEvent.click(await screen.findByRole('button', { name: 'Previous month' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('heading', { name: 'Nothing in Aug 2026' })).toBeTruthy();
  });
});

describe('Plan', () => {
  it('adds a goal with progress from its linked account', async () => {
    await seed();
    renderAt('/plan');
    fireEvent.click(await screen.findByRole('button', { name: /Add goal/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New goal' });
    fireEvent.change(within(dialog).getByLabelText('Goal'), { target: { value: 'Car' } });
    fireEvent.change(within(dialog).getByLabelText('Target amount'), { target: { value: '1000000' } });
    fireEvent.change(within(dialog).getByLabelText('Target date'), { target: { value: '2027-10-03' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'SBI Savings' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    await waitFor(async () => expect(await db.goals.count()).toBe(1));
    expect((await db.goals.toArray())[0]).toMatchObject({ name: 'Car', targetPaise: 100_000_000, linkedAccountIds: ['sbi'] });
    const card = (await screen.findByRole('heading', { name: 'Car' })).closest('.card') as HTMLElement;
    expect(within(card).getByText('28%')).toBeTruthy();
    expect(within(card).getByText(/a month to get there/)).toBeTruthy();
  });

  it('works out interest and time saved by an extra monthly payment', async () => {
    await seed();
    renderAt('/plan');
    const section = (await screen.findByRole('heading', { name: 'Home loan: pay it off sooner' })).closest('section') as HTMLElement;
    fireEvent.change(within(section).getByLabelText(/Extra every month/), { target: { value: '10000' } });
    const result = within(section).getByRole('status', { name: 'Result' });
    expect(result.textContent).toMatch(/Interest saved/);
    expect(result.textContent).toMatch(/\d+ (yr|mo)/);
    expect(result.textContent).not.toContain('₹0 ');
  });

  it('saves assumptions', async () => {
    await seed();
    renderAt('/plan');
    fireEvent.change(await screen.findByLabelText('Your age'), { target: { value: '34' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save assumptions' }));
    await screen.findByText('Saved.');
    expect((await db.settings.get('planDefaults'))?.value).toMatchObject({ currentAge: 34, retirementAge: 58, loanRateOverridePct: 8.5 });
  });
});

describe('Import', () => {
  it('starts on the picker with an empty history', async () => {
    renderAt('/import');
    expect(await screen.findByLabelText('Choose statements')).toBeTruthy();
    expect(screen.getByTestId('import-step').textContent).toBe('idle');
    expect(await within(screen.getByTestId('import-history')).findByText('Nothing imported yet.')).toBeTruthy();
  });

  it('lists a past import with an Undo', async () => {
    await db.imports.add({
      id: 'i1', fileHash: 'h', source: 'sbi', periodFrom: '2026-09-01', periodTo: '2026-09-30', importedAt: '2026-10-01',
      counts: { transactions: 12 }, verified: false, notes: [],
    });
    renderAt('/import');
    const history = await screen.findByTestId('import-history');
    await waitFor(() => expect(history.textContent).toContain('SBI savings'));
    expect(history.textContent).toContain('Unverified');
    expect(history.textContent).toContain('12 transactions');
    expect(within(history).getByRole('button', { name: 'Undo SBI savings' })).toBeTruthy();
  });
});

describe('Settings', () => {
  it('toggles hide amounts', async () => {
    renderAt('/settings');
    const toggle = await screen.findByRole('switch', { name: 'Hide amounts' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(async () => expect((await db.settings.get('hideAmounts'))?.value).toBe(true));
  });

  it('keeps Export disabled until the passphrase is long enough', async () => {
    renderAt('/settings');
    const button = await screen.findByRole('button', { name: 'Export backup' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Passphrase for the backup'), { target: { value: 'long enough pass' } });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('lists and deletes a category rule and a remembered password', async () => {
    await db.rules.add({ id: 'r1', pattern: 'SWIGGY', isRegex: false, category: 'Food delivery', priority: 10 });
    await db.settings.put({ key: 'passwords', value: { cas: 'secret' } });
    renderAt('/settings');
    expect(await screen.findByText('SWIGGY')).toBeTruthy();
    expect(screen.getByText('CAMS CAS')).toBeTruthy();
    expect(document.body.textContent).not.toContain('secret');
    fireEvent.click(screen.getByRole('button', { name: 'Delete the rule for SWIGGY' }));
    await waitFor(async () => expect(await db.rules.count()).toBe(0));
    fireEvent.click(screen.getByRole('button', { name: 'Forget the CAMS CAS password' }));
    await waitFor(async () => expect((await db.settings.get('passwords'))?.value).toEqual({}));
  });
});
