import { useDeferredValue, useState } from 'react';
import type { NetWorthRange } from '../../services/dashboard';
import { Link, useParams } from 'react-router-dom';
import { BankPanel } from '../accounts/BankPanel';
import { CashBalanceSheet } from '../accounts/CashBalanceSheet';
import { EpfPanel } from '../accounts/EpfPanel';
import { EquityPanel } from '../accounts/EquityPanel';
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
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const detail = useAccountDetail(id, { search: deferredSearch });
  const accounts = useAccounts();
  const [cashSheet, setCashSheet] = useState(false);
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
  const shown = isLoan ? history.map((point) => ({ ...point, balance: -point.balance })) : history;
  const hasBalance = item?.balance !== null && item?.balance !== undefined;

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
        {account.kind === 'cash' && (
          <button type="button" className="btn tonal" style={{ marginTop: 10, alignSelf: 'flex-start' }} onClick={() => setCashSheet(true)}>
            Update balance
          </button>
        )}
      </section>

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

      {(account.kind === 'savings' || account.kind === 'ppf') && (
        <BankPanel txns={txns} search={search} onSearch={setSearch} />
      )}
      {account.kind === 'loan' && <LoanPanel />}
      {account.kind === 'epf' && <EpfPanel accountId={account.id} />}
      {account.kind === 'mf' && <MfPanel />}
      {account.kind === 'equity' && <EquityPanel />}
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
      {cashSheet && <CashBalanceSheet onClose={() => setCashSheet(false)} />}
    </>
  );
}
