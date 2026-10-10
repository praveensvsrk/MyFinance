import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountGroup, AccountListItem } from '../../services/accounts';
import { CashBalanceSheet } from '../accounts/CashBalanceSheet';
import { ManualAccountSheet } from '../accounts/ManualAccountSheet';
import { PropertySheet } from '../accounts/PropertySheet';
import { accountInitials, KIND_META } from '../common/accountMeta';
import { Empty, ScreenSkeleton } from '../common/Empty';
import { Sheet } from '../common/Sheet';
import { dateShort } from '../format';
import { Icon } from '../Icon';
import { useAccounts } from '../hooks';
import { Money } from '../Money';
import '../styles/accounts.css';

interface Section {
  key: string;
  title: string;
  chip: string;
  groups: AccountGroup[];
}

const SECTIONS: Section[] = [
  { key: 'banks', title: 'Banks & cash', chip: 'Banks', groups: ['Banks', 'Cash'] },
  { key: 'cards', title: 'Cards', chip: 'Cards', groups: ['Cards'] },
  { key: 'retirement', title: 'Retirement', chip: 'Retirement', groups: ['Retirement'] },
  { key: 'market', title: 'Market', chip: 'Market', groups: ['Market'] },
  { key: 'home', title: 'Home & loan', chip: 'Home & loan', groups: ['Property', 'Loan'] },
];

function AccountRow({ account }: { account: AccountListItem }) {
  const meta = KIND_META[account.kind];
  const details = [account.institution, account.maskedNumber].filter((part) => part !== '').join(' · ');
  const when = account.asOf === null ? 'No statement yet' : account.stale ? `Last statement ${dateShort(account.asOf)}` : dateShort(account.asOf);
  const sub = [details === '' ? meta.label : details, account.caption].filter((part) => part !== undefined && part !== '');
  return (
    <li>
      <Link className="acct-row" to={`/accounts/${account.id}`}>
        <span className={`logo tone-${meta.tone}`} aria-hidden="true">
          {meta.useIcon ? <Icon name={meta.icon} size={20} /> : accountInitials(account)}
        </span>
        <span className="mid">
          <span className="ttl">{account.name}</span>
          <span className="sub">{sub.join(' · ')}</span>
          <span className={account.stale ? 'when stale' : 'when'}>
            {account.stale && <span className="dot" aria-hidden="true" />}
            {when}
            {account.stale && <span className="tag warn">Out of date</span>}
          </span>
        </span>
        <span className={account.balance !== null && account.balance < 0 ? 'amt neg' : 'amt'}>
          {account.balance === null ? '—' : <Money paise={account.balance} compact scaled />}
        </span>
      </Link>
    </li>
  );
}

/** Every account by group, with its latest balance and how fresh it is. */
export function Accounts() {
  const accounts = useAccounts();
  const [filter, setFilter] = useState<string>('all');
  const [addSheet, setAddSheet] = useState(false);
  const [cashSheet, setCashSheet] = useState(false);
  const [propertySheet, setPropertySheet] = useState(false);
  const [manualSheet, setManualSheet] = useState(false);

  if (accounts.data === undefined) return <ScreenSkeleton heights={[88, 40, 160, 160]} />;
  const list = accounts.data;
  const hasCash = list.some((account) => account.kind === 'cash');
  const hasProperty = list.some((account) => account.kind === 'property');
  const addOption = (label: string, icon: 'home' | 'wallet' | 'bank', open: () => void) => (
    <button
      type="button"
      className="btn out block"
      onClick={() => {
        setAddSheet(false);
        open();
      }}
    >
      <Icon name={icon} size={20} />
      {label}
    </button>
  );
  const sheets = (
    <>
      {addSheet && (
        <Sheet title="Add an account" onClose={() => setAddSheet(false)}>
          <div className="stack gap12" style={{ marginTop: 16 }}>
            {!hasProperty && addOption('Add your home', 'home', () => setPropertySheet(true))}
            {!hasCash && addOption('Add cash balance', 'wallet', () => setCashSheet(true))}
            {addOption('Add a bank or card', 'bank', () => setManualSheet(true))}
          </div>
        </Sheet>
      )}
      {propertySheet && <PropertySheet onClose={() => setPropertySheet(false)} />}
      {cashSheet && <CashBalanceSheet onClose={() => setCashSheet(false)} />}
      {manualSheet && <ManualAccountSheet onClose={() => setManualSheet(false)} />}
    </>
  );
  const addButton = (
    <button type="button" className="btn fill acct-add" onClick={() => setAddSheet(true)}>
      <Icon name="plus" size={18} />
      Add
    </button>
  );

  if (list.length === 0) {
    return (
      <>
        <Empty
          icon="bank"
          title="No accounts yet"
          action={
            <Link to="/import" className="btn fill">
              <Icon name="import" size={20} />
              Import a statement
            </Link>
          }
        >
          Import a statement to see accounts here.
        </Empty>
        <div className="acct-addrow">{addButton}</div>
        {sheets}
      </>
    );
  }

  const total = list.reduce((sum, account) => sum + (account.balance ?? 0), 0);
  const staleCount = list.filter((account) => account.stale).length;
  const present = SECTIONS.filter((section) => list.some((account) => section.groups.includes(account.group)));
  const active = filter === 'stale' || filter === 'all' || present.some((section) => section.key === filter) ? filter : 'all';

  return (
    <>
      <section className="card acct-sum" aria-label="All accounts">
        <div>
          <div className="k">
            Across {list.length} {list.length === 1 ? 'account' : 'accounts'}
          </div>
          <div className={total < 0 ? 'big mono neg' : 'big mono'} data-testid="accounts-total">
            <Money paise={total} whole />
          </div>
        </div>
        {staleCount > 0 && (
          <button type="button" className="acct-stale" onClick={() => setFilter('stale')} aria-label={`${staleCount} out of date, show them`}>
            <span className="dot" aria-hidden="true" />
            {staleCount} out of date
          </button>
        )}
      </section>

      <div className="acct-bar">
        <div className="chips scroll" role="group" aria-label="Filter accounts">
          <button type="button" className={active === 'all' ? 'chip on' : 'chip'} aria-pressed={active === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
          {present.map((section) => (
            <button
              key={section.key}
              type="button"
              className={active === section.key ? 'chip on' : 'chip'}
              aria-pressed={active === section.key}
              onClick={() => setFilter(section.key)}
            >
              {section.chip}
            </button>
          ))}
          {active === 'stale' && (
            <button type="button" className="chip on" aria-pressed="true" onClick={() => setFilter('all')}>
              Out of date
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        {addButton}
      </div>

      {present.map((section) => {
        if (active !== 'all' && active !== 'stale' && active !== section.key) return null;
        let rows = list.filter((account) => section.groups.includes(account.group));
        if (active === 'stale') rows = rows.filter((account) => account.stale);
        if (rows.length === 0) return null;
        const sum = rows.reduce((acc, account) => acc + (account.balance ?? 0), 0);
        const hasLoan = section.key === 'home' && rows.some((account) => account.kind === 'loan') && rows.some((account) => account.kind === 'property');
        return (
          <section key={section.key} className="card flat" aria-label={section.title}>
            <div className="grp-h">
              <span>{section.title}</span>
              <b className={sum < 0 ? 'mono neg' : 'mono'}>
                <Money paise={sum} compact scaled />
                {hasLoan && ' equity'}
              </b>
            </div>
            <ul className="list">
              {rows.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </ul>
          </section>
        );
      })}
      {sheets}
    </>
  );
}
