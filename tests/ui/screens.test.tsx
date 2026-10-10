// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../../src/App';
import type { TxnRow } from '../../src/db/schema';
import { FinanceDb } from '../../src/db/schema';
import { getCategoryConfig } from '../../src/services/actions/categories';
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
    const banks = await screen.findByRole('region', { name: 'Banks & cash' });
    expect(within(banks).getByText('SBI Savings')).toBeTruthy();
    expect(within(banks).getAllByText('₹2.8L')).toHaveLength(1); // the row (the group total includes cash)
    expect(within(banks).getByRole('link', { name: /SBI Savings/ }).getAttribute('href')).toBe('/accounts/sbi');
    expect(screen.getByRole('region', { name: 'Home & loan' })).toBeTruthy();
    expect(within(banks).getAllByText('Cash').length).toBeGreaterThan(0);
    expect(screen.queryByText('Out of date')).toBeNull();
  });

  it('offers to add a bank or card by hand', async () => {
    renderAt('/accounts');
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(await screen.findByRole('button', { name: /Add a bank or card/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an account' });
    fireEvent.change(within(dialog).getByLabelText('Bank'), { target: { value: 'HDFC' } });
    fireEvent.change(within(dialog).getByLabelText('Last 4 digits (optional)'), { target: { value: '1234' } });
    fireEvent.change(within(dialog).getByLabelText('Balance'), { target: { value: '5000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save account' }));
    await waitFor(async () => expect(await db.accounts.get('hdfc-1234')).toMatchObject({ kind: 'savings', institution: 'HDFC' }));
  });

  it('offers to add a cash balance when there is no cash account', async () => {
    await db.accounts.add({ id: 'sbi', kind: 'savings', institution: 'SBI', name: 'SBI Savings', maskedNumber: '', meta: {} });
    renderAt('/accounts');
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(await screen.findByRole('button', { name: /Add cash balance/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cash balance' });
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '2500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save balance' }));
    await waitFor(async () => expect((await db.balanceSnapshots.where('accountId').equals('cash').toArray())[0]?.balance).toBe(250_000));
  });
});

describe('Account detail', () => {
  it('shows the balance, transactions newest first, search, and re-categorising from the transaction', async () => {
    await seed();
    renderAt('/accounts/sbi');
    expect((await screen.findByTestId('account-balance')).textContent).toBe('₹2,80,000');
    const list = await screen.findByTestId('txn-list');
    const days = Array.from(list.querySelectorAll('.day')).map((el) => el.textContent);
    expect(days).toEqual(['2 Oct 2026', '1 Oct 2026', '15 Sep 2026']);

    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'rent' } });
    await waitFor(() => expect(within(screen.getByTestId('txn-list')).queryByText('SWIGGY')).toBeNull());
    expect(within(screen.getByTestId('txn-list')).getByText('RENT SEPTEMBER', { selector: '.mer' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^RENT SEPTEMBER, Rent\. Show details/ }));
    const dialog = await screen.findByRole('dialog', { name: 'RENT SEPTEMBER' });
    expect(within(dialog).getByText('Balance after')).toBeTruthy();
    expect(within(dialog).getByText('15 Sep 2026 · SBI Savings')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Save category' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Utilities' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save category' }));
    await waitFor(async () => expect((await db.transactions.get('t5'))?.category).toBe('Utilities'));
    expect((await db.transactions.get('t5'))?.categorySource).toBe('manual');
  });

  it('shows the loan terms for a loan account', async () => {
    await seed();
    renderAt('/accounts/loan');
    expect(await screen.findByRole('heading', { name: 'Loan details' })).toBeTruthy();
    expect(screen.getByText('Sanctioned')).toBeTruthy();
    expect((await screen.findByTestId('account-balance')).textContent).toBe('₹50,00,000');
  });

  it('deletes an account after a confirming tap and returns to the account list', async () => {
    await seed();
    renderAt('/accounts/sbi');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
    expect(await db.accounts.get('sbi')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, delete this account' }));
    await waitFor(async () => expect(await db.accounts.get('sbi')).toBeUndefined());
    expect(await db.transactions.count()).toBe(0);
    expect(await screen.findByRole('region', { name: 'Banks & cash' })).toBeTruthy();
    expect(screen.queryByText('SBI Savings')).toBeNull();
  });

  it('masks the balance when amounts are hidden', async () => {
    await seed();
    await db.settings.put({ key: 'hideAmounts', value: true });
    renderAt('/accounts/sbi');
    await waitFor(() => expect(screen.getByTestId('account-balance').textContent).toContain('••••'));
    expect(screen.getByTestId('account-balance').textContent).not.toContain('2,80,000');
  });
});

/** The seeded ₹50L loan plus an ₹80L home, so the equity is ₹30L. */
async function seedHome() {
  await seed();
  await db.accounts.add({ id: 'home', kind: 'property', institution: 'Home', name: 'Motinagar', maskedNumber: '', meta: { appreciationPct: 0 } });
  await db.balanceSnapshots.add({ accountId: 'home', date: '2026-04-01', balance: 800_000_000, source: 'manual', importId: null });
}

describe('Home equity', () => {
  it('nets the loan against the home in the net-worth breakdown', async () => {
    await seedHome();
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: /Net worth\. Show how/ }));
    const equity = await screen.findByRole('region', { name: 'Home equity' });
    expect(within(equity).getByText('Motinagar')).toBeTruthy();
    expect(within(equity).getByText(/^Loan · UBI/)).toBeTruthy();
    // Group total: ₹80L home less the ₹50L loan.
    expect(within(equity).getByText('₹30L')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Property' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Owed' })).toBeNull();
  });

  it('shows value, loan left to pay and equity on the home page', async () => {
    await seedHome();
    renderAt('/accounts/home');
    const equity = await screen.findByRole('region', { name: 'Home equity' });
    expect(within(equity).getByText('Home value').nextSibling?.textContent).toBe('₹80,00,000');
    expect(within(equity).getByText('Loan left to pay').nextSibling?.textContent).toBe('₹50,00,000');
    expect(within(equity).getByText('Your equity').nextSibling?.textContent).toBe('₹30,00,000');
    expect(within(equity).getByText('Loan is 62.5% of the value')).toBeTruthy();
  });

  it('leaves the equity card off a home with no loan', async () => {
    await db.accounts.add({ id: 'home', kind: 'property', institution: 'Home', name: 'Motinagar', maskedNumber: '', meta: { appreciationPct: 0 } });
    await db.balanceSnapshots.add({ accountId: 'home', date: '2026-04-01', balance: 800_000_000, source: 'manual', importId: null });
    renderAt('/accounts/home');
    await screen.findByTestId('account-balance');
    expect(screen.queryByRole('region', { name: 'Home equity' })).toBeNull();
  });

  it('shows what the home was bought for and the gain since', async () => {
    await seedHome();
    await db.accounts.update('home', { meta: { appreciationPct: 0, purchasePrice: 640_000_000, purchaseDate: '2019-03-12' } });
    renderAt('/accounts/home');
    const line = await screen.findByTestId('home-purchase');
    expect(line.textContent).toBe('Bought for ₹64,00,000 on 12 Mar 2019 · Up ₹16,00,000 (25.0%)');
  });

  it('saves a purchase price and date from the sheet', async () => {
    // The sheet always writes the account called `property`, so seed the home under that id.
    await db.accounts.add({ id: 'property', kind: 'property', institution: '', name: 'Motinagar', maskedNumber: '', meta: { appreciationPct: 0 } });
    await db.balanceSnapshots.add({ accountId: 'property', date: '2026-04-01', balance: 800_000_000, source: 'manual', importId: null });
    renderAt('/accounts/property');
    fireEvent.click(await screen.findByRole('button', { name: 'Update value' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your home' });
    fireEvent.change(within(dialog).getByLabelText('Purchase price (optional)'), { target: { value: '6400000' } });
    fireEvent.change(within(dialog).getByLabelText('Purchased on (optional)'), { target: { value: '2019-03-12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save value' }));
    await waitFor(async () => expect((await db.accounts.get('property'))?.meta).toMatchObject({ purchasePrice: 640_000_000, purchaseDate: '2019-03-12' }));
    expect((await screen.findByTestId('home-purchase')).textContent).toContain('Bought for ₹64,00,000');
  });

  it('names the home a loan is secured on', async () => {
    await seedHome();
    renderAt('/accounts/loan');
    expect(await screen.findByText('Secured on Motinagar')).toBeTruthy();
  });
});

describe('Home and the financial year', () => {
  it('adds a home and counts it on the dashboard', async () => {
    renderAt('/accounts');
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(await screen.findByRole('button', { name: /Add your home/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Your home' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Motinagar' } });
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: '10000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save value' }));

    const property = await screen.findByRole('region', { name: 'Home & loan' });
    expect(within(property).getByText('Motinagar')).toBeTruthy();
    expect(within(property).getAllByText('₹1Cr').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByRole('button', { name: /Property/ })).toBeTruthy();
  });

  it('opens the financial year from cash flow', async () => {
    await seed();
    renderAt('/cash-flow');
    fireEvent.click(await screen.findByRole('link', { name: 'Financial year' }));
    expect(await screen.findByRole('heading', { name: 'FY 2026-27' })).toBeTruthy();
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('₹1.2L')).toBeTruthy();
    expect(screen.getByText('Mutual funds and other')).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: 'Sep 2026' }));
    expect(await screen.findByRole('heading', { name: 'Sep 2026' })).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId('txn-list')).getByText('RENT SEPTEMBER', { selector: '.mer' })).toBeTruthy());
  });

  it('writes a rule by hand, previews what it would move, and re-files those rows on save', async () => {
    await seed();
    await db.transactions.bulkAdd([
      txn('c1', '2026-10-02', 'ACH D- INDIAN CLEARING CORP 111', -10_000_00, { category: 'Investments', categorySource: 'default', kind: 'investment' }),
      txn('c2', '2026-09-02', 'ACH D- INDIAN CLEARING CORP 222', -20_000_00, { category: 'Investments', categorySource: 'default', kind: 'investment' }),
      txn('c3', '2026-09-03', 'ACH D- INDIAN CLEARING CORP 333', -5_000_00, { category: 'Rent', categorySource: 'manual', kind: 'investment' }),
      txn('c4', '2026-09-04', 'INDIAN CLEARING REFUND', 1_000_00, { category: 'Other', categorySource: 'default' }),
    ]);
    renderAt('/cash-flow');
    fireEvent.click(await screen.findByRole('button', { name: 'Rules' }));
    fireEvent.click(await screen.findByRole('button', { name: /New rule/ }));
    const editor = await screen.findByRole('dialog', { name: 'New rule' });

    expect(within(editor).getByTestId('rule-preview').textContent).toMatch(/Add a word/);
    fireEvent.change(within(editor).getByLabelText('Narration contains any of'), { target: { value: 'indian clearing' } });
    fireEvent.click(within(editor).getByRole('radio', { name: 'Debit' }));
    fireEvent.change(within(editor).getByLabelText('File it under'), { target: { value: 'Mutual funds' } });
    fireEvent.click(within(editor).getByRole('radio', { name: 'Investment' }));

    const preview = within(editor).getByTestId('rule-preview');
    await waitFor(() => expect(preview.textContent).toMatch(/2 transactions would move to Mutual funds/));
    expect(preview.textContent).toMatch(/1 kept because you set them by hand/);
    expect(within(preview).getAllByRole('listitem')).toHaveLength(2);
    expect(await db.rules.count()).toBe(0);
    expect((await db.transactions.get('c1'))?.category).toBe('Investments');

    fireEvent.click(within(editor).getByRole('button', { name: 'Save rule' }));
    await waitFor(async () => expect((await db.transactions.get('c1'))?.category).toBe('Mutual funds'));
    expect(await db.transactions.get('c2')).toMatchObject({ category: 'Mutual funds', categorySource: 'rule', kind: 'investment' });
    expect(await db.transactions.get('c3')).toMatchObject({ category: 'Rent', categorySource: 'manual' });
    expect((await db.transactions.get('c4'))?.category).toBe('Other');
    expect(await db.rules.toArray()).toMatchObject([{ pattern: 'indian clearing', category: 'Mutual funds', direction: 'debit', kind: 'investment' }]);

    const list = await screen.findByRole('dialog', { name: 'Rules' });
    expect(within(list).getByText(/“indian clearing” · debits → Mutual funds \(investment\)/)).toBeTruthy();
  });

  it('defaults a rule’s "Counts as" from the category, and saves not-spending on the rule', async () => {
    await seed();
    renderAt('/cash-flow');
    fireEvent.click(await screen.findByRole('button', { name: 'Rules' }));
    fireEvent.click(await screen.findByRole('button', { name: /New rule/ }));
    const editor = await screen.findByRole('dialog', { name: 'New rule' });
    fireEvent.change(within(editor).getByLabelText('Narration contains any of'), { target: { value: 'gift' } });

    // Family is already "not spending" in Settings, so choosing it selects that without a click.
    fireEvent.click(within(editor).getByRole('button', { name: 'Family' }));
    expect(within(editor).getByRole('radio', { name: 'Not spending' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(editor).getByRole('button', { name: 'Shopping' }));
    expect(within(editor).getByRole('radio', { name: 'Spending' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.change(within(editor).getByLabelText('File it under'), { target: { value: 'Gifts' } });
    fireEvent.click(within(editor).getByRole('radio', { name: 'Not spending' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save rule' }));
    await waitFor(async () => expect(await db.rules.count()).toBe(1));
    const config = await getCategoryConfig(db);
    expect(config.custom).toContain('Gifts');
    expect(config.excluded).toEqual(['Family']);
    expect(await db.rules.toArray()).toMatchObject([{ category: 'Gifts', kind: 'excluded' }]);
  });

  it('marks only matching rows not-spending when the destination category already has other transactions', async () => {
    await seed();
    await db.transactions.bulkAdd([
      txn('s1', '2026-10-01', 'AMAZON REIMBURSE WORK', -1_000_00, { category: 'Shopping', categorySource: 'default' }),
      txn('s2', '2026-10-01', 'AMAZON STORE PURCHASE', -2_000_00, { category: 'Shopping', categorySource: 'default' }),
    ]);
    renderAt('/cash-flow');
    fireEvent.click(await screen.findByRole('button', { name: 'Rules' }));
    fireEvent.click(await screen.findByRole('button', { name: /New rule/ }));
    const editor = await screen.findByRole('dialog', { name: 'New rule' });
    fireEvent.change(within(editor).getByLabelText('Narration contains any of'), { target: { value: 'amazon reimburse' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Shopping' }));
    fireEvent.click(within(editor).getByRole('radio', { name: 'Not spending' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save rule' }));
    await waitFor(async () => expect((await db.transactions.get('s1'))?.kind).toBe('excluded'));
    expect(await db.transactions.get('s1')).toMatchObject({ category: 'Shopping', kind: 'excluded', categorySource: 'rule' });
    expect(await db.transactions.get('s2')).toMatchObject({ category: 'Shopping', kind: 'normal' });
    expect((await getCategoryConfig(db)).excluded).toEqual(['Family']);
  });

  it('reorders, turns off and deletes rules from the rules sheet', async () => {
    await seed();
    await db.rules.bulkAdd([
      { id: 'a', pattern: 'AAA', isRegex: false, category: 'Rent', priority: 20 },
      { id: 'b', pattern: 'BBB', isRegex: false, category: 'Fuel', priority: 10 },
    ]);
    renderAt('/cash-flow');
    fireEvent.click(await screen.findByRole('button', { name: 'Rules' }));
    const list = await screen.findByRole('dialog', { name: 'Rules' });
    const titles = () => Array.from(list.querySelectorAll('.ttl')).map((el) => el.textContent);
    await waitFor(() => expect(titles()).toEqual(['AAA', 'BBB']));
    fireEvent.click(within(list).getByRole('button', { name: 'Move BBB up' }));
    await waitFor(() => expect(titles()).toEqual(['BBB', 'AAA']));
    fireEvent.click(within(list).getByRole('switch', { name: 'Rule AAA is on' }));
    await waitFor(async () => expect((await db.rules.get('a'))?.enabled).toBe(false));
    fireEvent.click(within(list).getByRole('button', { name: 'Delete rule AAA' }));
    await waitFor(async () => expect(await db.rules.count()).toBe(1));
  });

  it('searches every month and account, and totals what it finds', async () => {
    await seed();
    await db.accounts.add({ id: 'card', kind: 'card', institution: 'HDFC', name: 'HDFC Card', maskedNumber: '', meta: {} });
    await db.transactions.bulkAdd([
      txn('t6', '2025-12-20', 'SWIGGY BANGALORE', -250_00, { accountId: 'card', category: 'Food delivery' }),
      txn('t7', '2026-09-20', 'SWIGGY REFUND', 100_00, { category: 'Food delivery' }),
    ]);
    renderAt('/cash-flow');
    await screen.findByRole('heading', { name: 'Oct 2026' });
    fireEvent.change(screen.getByLabelText('Search all transactions'), { target: { value: 'swiggy' } });
    expect(await screen.findByRole('heading', { name: '4 matches' })).toBeTruthy();
    const total = screen.getByTestId('search-total');
    expect(total.textContent).toContain('Paid out₹1,000');
    expect(total.textContent).toContain('Received₹100');
    const list = screen.getByTestId('search-list');
    expect(Array.from(list.querySelectorAll('.cf-day')).map((el) => el.textContent)).toEqual([
      '1 Oct 2026',
      '20 Sep 2026',
      '20 Dec 2025',
    ]);
    expect(within(list).getByText('HDFC Card')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search all transactions'), { target: { value: '250' } });
    expect(await screen.findByRole('heading', { name: '1 match' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search all transactions'), { target: { value: 'nothing like this' } });
    expect(await screen.findByText(/Nothing matches “nothing like this”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByRole('heading', { name: 'Oct 2026' })).toBeTruthy();
  });

  it('opens a transaction from an account and shows everything from that payee on Cash flow', async () => {
    await seed();
    await db.transactions.add(txn('t6', '2026-08-20', 'UPI/123456789099/SWIGGY/dinner/5812', -250_00, { category: 'Food delivery' }));
    renderAt('/accounts/sbi');
    fireEvent.click((await screen.findAllByRole('button', { name: /^SWIGGY, Food delivery\. Show details/ }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'SWIGGY' });
    expect(within(dialog).getByText('UPI/123456789013/SWIGGY/lunch/5812')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show all from SWIGGY' }));
    expect(await screen.findByRole('heading', { name: '3 matches' })).toBeTruthy();
    expect((screen.getByLabelText('Search all transactions') as HTMLInputElement).value).toBe('SWIGGY');
  });

  it('says when a month has nothing in it', async () => {
    await seed();
    renderAt('/cash-flow');
    fireEvent.click(await screen.findByRole('button', { name: 'Aug 2026' }));
    expect(await screen.findByRole('heading', { name: 'Nothing in Aug 2026' })).toBeTruthy();
  });

  it('opens the previous month when the current one is empty', async () => {
    await db.transaction('rw', db.tables, async () => {
      await db.accounts.add({
        id: 'sbi',
        kind: 'savings',
        institution: 'SBI',
        name: 'SBI Savings',
        maskedNumber: '••1234',
        meta: {},
      });
      await db.transactions.add(txn('t5', '2026-09-15', 'RENT SEPTEMBER', -25_000_00, { category: 'Rent', categorySource: 'default' }));
    });
    renderAt('/cash-flow');
    expect(await screen.findByRole('heading', { name: 'Sep 2026' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('RENT SEPTEMBER')).toBeTruthy());
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
    const section = (await screen.findByRole('heading', { name: 'Pay off home loan sooner' })).closest('section') as HTMLElement;
    fireEvent.click(within(section).getByRole('button', { name: '10k' }));
    const result = within(section).getByRole('status', { name: 'Result' });
    expect(result.textContent).toMatch(/Interest saved/);
    expect(result.textContent).toMatch(/\d+ (yr|mo)/);
    expect(result.textContent).not.toContain('₹0 ');
  });

  it('saves assumptions', async () => {
    await seed();
    renderAt('/plan');
    fireEvent.click(await screen.findByRole('button', { name: /Assumptions/ }));
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

  it('creates a category here, and returns to Cash flow when it was opened from there', async () => {
    await seed();
    renderAt('/cash-flow');
    fireEvent.click(await screen.findByRole('link', { name: 'New category' }));
    const name = await screen.findByLabelText('Category name');
    fireEvent.change(name, { target: { value: 'Gifts' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Doesn.t count as spending/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    await waitFor(async () => expect((await getCategoryConfig(db)).excluded).toContain('Gifts'));
    expect((await getCategoryConfig(db)).custom).toContain('Gifts');
    expect(await screen.findByRole('heading', { name: 'Oct 2026' })).toBeTruthy();
  });

  it('keeps the form closed unless asked, and refuses an empty or duplicate name', async () => {
    renderAt('/settings');
    expect(screen.queryByLabelText('Category name')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'New category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    expect(await screen.findByText('Enter a name')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'rent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    expect(await screen.findByText('That name is already used')).toBeTruthy();
  });

  it('lists category rules and manages them in the rules sheet', async () => {
    await db.rules.add({ id: 'r1', pattern: 'SWIGGY', isRegex: false, category: 'Food delivery', priority: 10 });
    renderAt('/settings');
    expect(await screen.findByText('SWIGGY')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage rules' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rules' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Delete rule SWIGGY' }));
    await waitFor(async () => expect(await db.rules.count()).toBe(0));
  });
});
