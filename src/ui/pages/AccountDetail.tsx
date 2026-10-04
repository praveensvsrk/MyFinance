import { useDeferredValue, useState } from 'react';
import type { NetWorthRange } from '../../services/dashboard';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useActions } from '../actions';
import { BankPanel } from '../accounts/BankPanel';
import { CashBalanceSheet } from '../accounts/CashBalanceSheet';
import { PropertySheet } from '../accounts/PropertySheet';
import { annualPctOf, gainSince, propertySeries, purchaseOf } from '../../domain/property';
import { useApp } from '../AppContext';
import { EpfPanel } from '../accounts/EpfPanel';
import { EquityPanel, EquitySummaryRows } from '../accounts/EquityPanel';
import { LoanPanel } from '../accounts/LoanPanel';
import { MfPanel } from '../accounts/MfPanel';
import { KIND_META } from '../common/accountMeta';
import { Empty, ScreenSkeleton } from '../common/Empty';
import { HistoryChart } from '../common/HistoryChart';
import { RangeTabs, sliceRange } from '../common/RangeTabs';
import { dateLong, dateShort } from '../format';
import { Icon } from '../Icon';
import { useAccountDetail, useAccounts } from '../hooks';
import { Money } from '../Money';

/** One account: its balance and history, then the detail that kind of account has. */
export function AccountDetail() {
  const { id = '' } = useParams();
  const { today, refresh } = useApp();
  const actions = useActions();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const detail = useAccountDetail(id, { search: deferredSearch });
  const accounts = useAccounts();
  const [cashSheet, setCashSheet] = useState(false);
  const [propertySheet, setPropertySheet] = useState(false);
  const [range, setRange] = useState<NetWorthRange>('All');

  if (detail.data === undefined || accounts.data === undefined) return <ScreenSkeleton />;
  if (detail.data === null) {
    return (
      <Empty
        icon="bank"
        title="Account not found"
        action={
          <Link to="/accounts" className="btn tonal">
            Back to accounts
          </Link>
        }
      >
        It may have been removed by an undo.
      </Empty>
    );
  }

  const { account, history, txns } = detail.data;
  const item = accounts.data.find((candidate) => candidate.id === account.id);
  const meta = KIND_META[account.kind];
  const details = [account.institution, account.maskedNumber].filter((part) => part !== '').join(' · ');
  // A loan is stored as a negative balance (it reduces net worth); on its own page show what is left to pay.
  const isLoan = account.kind === 'loan';
  const annualPct = account.kind === 'property' ? annualPctOf(account.meta) : 0;
  const purchase = account.kind === 'property' ? purchaseOf(account.meta) : null;
  const shown = isLoan
    ? history.map((point) => ({ ...point, balance: -point.balance }))
    : account.kind === 'property'
      ? propertySeries(history, annualPct, today, purchase)
      : history;
  const hasBalance = item?.balance !== null && item?.balance !== undefined;
  const latestEntry = history[history.length - 1];
  // A loan's balance is negative; what is left to pay on all loans is what the home's equity gives up.
  const loanLeft = accounts.data.reduce((sum, row) => (row.kind === 'loan' && row.balance !== null ? sum - row.balance : sum), 0);
  const homeValue = account.kind === 'property' && hasBalance ? (item.balance as number) : 0;
  const home = accounts.data.find((row) => row.kind === 'property');
  const gain = purchase !== null && homeValue > 0 ? gainSince(homeValue, purchase) : null;
  // Statement accounts come back by importing the same file again; cash and the home are typed in.
  const restorable = account.kind !== 'cash' && account.kind !== 'property';

  async function remove() {
    setDeleting(true);
    try {
      await actions.deleteAccount(account.id);
      refresh();
      navigate('/accounts', { replace: true });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <section className="card hero" aria-labelledby="acct-h">
        <span className="row-between">
          <span className="tag acc">
            <Icon name={meta.icon} size={14} />
            {meta.label}
          </span>
          {item?.stale === true && <span className="tag warn">Out of date</span>}
        </span>
        <h2 id="acct-h" className="t-title" style={{ marginTop: 6 }}>
          {account.name}
        </h2>
        {details !== '' && <span className="sub">{details}</span>}
        {isLoan && home !== undefined && <span className="sub">Secured on {home.name}</span>}
        {isLoan && hasBalance && (
          <span className="sub" style={{ marginTop: 6 }}>
            Left to pay
          </span>
        )}
        <span className="hero-amt" data-testid="account-balance" style={{ marginTop: 6 }}>
          {hasBalance ? <Money paise={isLoan ? -(item.balance as number) : (item.balance as number)} whole /> : '—'}
        </span>
        <span className="asof">
          {item?.stale === true && <span className="dot" aria-hidden="true" />}
          {item?.asOf ? `As of ${dateLong(item.asOf)}` : 'No statement imported yet'}
        </span>
        {account.kind === 'equity' && <EquitySummaryRows />}
        {account.kind === 'property' && annualPct !== 0 && (
          <span className="sub">Growing at {annualPct}% a year from the value you entered.</span>
        )}
        {purchase !== null && (
          <span className="sub" data-testid="home-purchase">
            Bought for <Money paise={purchase.price} whole />
            {purchase.date !== null && ` on ${dateLong(purchase.date)}`}
            {gain !== null && (
              <>
                {' · '}
                {gain.amount >= 0 ? 'Up ' : 'Down '}
                <Money paise={Math.abs(gain.amount)} whole /> ({Math.abs(gain.pct).toFixed(1)}%)
              </>
            )}
          </span>
        )}
        {account.kind === 'cash' && (
          <button type="button" className="btn tonal" style={{ marginTop: 10, alignSelf: 'flex-start' }} onClick={() => setCashSheet(true)}>
            Update balance
          </button>
        )}
        {account.kind === 'property' && (
          <button type="button" className="btn tonal" style={{ marginTop: 10, alignSelf: 'flex-start' }} onClick={() => setPropertySheet(true)}>
            Update value
          </button>
        )}
      </section>

      {account.kind === 'property' && homeValue > 0 && loanLeft > 0 && (
        <section className="card" aria-labelledby="eq-h">
          <h2 id="eq-h" className="t-title" style={{ marginBottom: 8 }}>
            Home equity
          </h2>
          <div className="kv">
            <span className="k">Home value</span>
            <span className="v">
              <Money paise={homeValue} whole />
            </span>
          </div>
          <div className="kv">
            <span className="k">Loan left to pay</span>
            <span className="v">
              <Money paise={loanLeft} whole />
            </span>
          </div>
          <div className="kv">
            <span className="k">Your equity</span>
            <span className="v">
              <Money paise={homeValue - loanLeft} whole />
            </span>
          </div>
          <span className="cap">Loan is {((loanLeft / homeValue) * 100).toFixed(1)}% of the value</span>
        </section>
      )}

      {history.length >= 2 && (
        <section className="card" aria-labelledby="hist-h">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 id="hist-h" className="t-title">
              {isLoan ? 'Left to pay' : 'Balance history'}
            </h2>
            <RangeTabs range={range} onChange={setRange} />
          </div>
          <HistoryChart points={sliceRange(shown, range)} label={`${account.name} ${isLoan ? 'amount left to pay' : 'balance'} over time`} />
        </section>
      )}

      {(account.kind === 'savings' || account.kind === 'card' || account.kind === 'ppf') && (
        <BankPanel txns={txns} search={search} onSearch={setSearch} />
      )}
      {account.kind === 'loan' && <LoanPanel />}
      {account.kind === 'epf' && <EpfPanel accountId={account.id} />}
      {account.kind === 'mf' && <MfPanel />}
      {account.kind === 'equity' && <EquityPanel />}
      {account.kind === 'property' && history.length > 0 && (
        <section className="card flat" aria-labelledby="home-h">
          <h2 id="home-h" className="t-title" style={{ padding: '16px 16px 4px' }}>
            Valuations
          </h2>
          <ul className="list">
            {[...history].reverse().map((point) => (
              <li key={point.date} className="row" style={{ minHeight: 56 }}>
                <span className="mid">
                  <span className="ttl">{dateLong(point.date)}</span>
                </span>
                <span className="amt">
                  <Money paise={point.balance} />
                </span>
              </li>
            ))}
          </ul>
          <span className="cap">Each line is a value you entered. The balance above is that value grown to today.</span>
        </section>
      )}
      {account.kind === 'cash' && (
        <section className="card flat" aria-labelledby="cashh-h">
          <h2 id="cashh-h" className="t-title" style={{ padding: '16px 16px 4px' }}>
            Entries
          </h2>
          <ul className="list">
            {[...history].reverse().map((point) => (
              <li key={point.date} className="row" style={{ minHeight: 56 }}>
                <span className="mid">
                  <span className="ttl">{dateShort(point.date)} {point.date.slice(0, 4)}</span>
                </span>
                <span className="amt">
                  <Money paise={point.balance} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card" aria-labelledby="del-h">
        <h2 id="del-h" className="t-title" style={{ marginBottom: 8 }}>
          Delete account
        </h2>
        <span className="cap" style={{ display: 'block', marginBottom: 12 }}>
          {restorable
            ? 'Removes this account and everything stored for it. Importing the same statement again brings it back.'
            : 'Removes this account and every value you entered for it. This cannot be undone.'}
        </span>
        {confirmDelete ? (
          <button type="button" className="btn block danger" disabled={deleting} onClick={() => void remove()}>
            Yes, delete this account
          </button>
        ) : (
          <button type="button" className="btn block text" style={{ color: 'var(--bad)' }} onClick={() => setConfirmDelete(true)}>
            Delete account
          </button>
        )}
      </section>
      {cashSheet && <CashBalanceSheet onClose={() => setCashSheet(false)} />}
      {propertySheet && (
        <PropertySheet
          initial={{
            name: account.name,
            balancePaise: latestEntry?.balance ?? null,
            date: latestEntry?.date ?? today,
            annualPct,
            purchasePaise: purchase?.price ?? null,
            purchaseDate: purchase?.date ?? null,
          }}
          onClose={() => setPropertySheet(false)}
        />
      )}
    </>
  );
}
