import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountGroup, AccountListItem } from '../../services/accounts';
import { CashBalanceSheet } from '../accounts/CashBalanceSheet';
import { PropertySheet } from '../accounts/PropertySheet';
import { KIND_META } from '../common/accountMeta';
import { Empty, ScreenSkeleton } from '../common/Empty';
import { dateShort } from '../format';
import { Icon } from '../Icon';
import { useAccounts } from '../hooks';
import { Money } from '../Money';

const ORDER: AccountGroup[] = ['Banks', 'Cards', 'Retirement', 'Market', 'Property', 'Loan', 'Cash'];

function AccountRow({ account }: { account: AccountListItem }) {
  const meta = KIND_META[account.kind];
  const details = [account.institution, account.maskedNumber].filter((part) => part !== '').join(' · ');
  return (
    <li>
      <Link className="row" to={`/accounts/${account.id}`}>
        <span className={account.kind === 'loan' ? 'lead warn' : 'lead'}>
          <Icon name={meta.icon} size={22} />
        </span>
        <span className="mid">
          <span className="ttl">{account.name}</span>
          <span className="sub">{details === '' ? meta.label : details}</span>
          <span className="asof">
            {account.stale && <span className="dot" aria-hidden="true" />}
            {account.asOf === null ? 'No statement yet' : `As of ${dateShort(account.asOf)}`}
            {account.caption !== undefined && ` · ${account.caption}`}
            {account.stale && <span className="sr"> (out of date)</span>}
          </span>
        </span>
        <span className="end">
          <span className="amt">{account.balance === null ? '—' : <Money paise={account.balance} compact />}</span>
          {account.stale && <span className="tag warn">Out of date</span>}
        </span>
        <span className="chev">
          <Icon name="chevron" size={20} />
        </span>
      </Link>
    </li>
  );
}

/** Every account by group, with its latest balance and how fresh it is. */
export function Accounts() {
  const accounts = useAccounts();
  const [cashSheet, setCashSheet] = useState(false);
  const [propertySheet, setPropertySheet] = useState(false);

  if (accounts.data === undefined) return <ScreenSkeleton heights={[160, 160, 120]} />;
  const list = accounts.data;
  const hasCash = list.some((account) => account.kind === 'cash');
  const hasProperty = list.some((account) => account.kind === 'property');
  const addButtons = (
    <>
      {!hasProperty && (
        <button type="button" className="btn out block" onClick={() => setPropertySheet(true)}>
          <Icon name="home" size={20} />
          Add your home
        </button>
      )}
      {!hasCash && (
        <button type="button" className="btn out block" onClick={() => setCashSheet(true)}>
          <Icon name="wallet" size={20} />
          Add cash balance
        </button>
      )}
      {propertySheet && <PropertySheet onClose={() => setPropertySheet(false)} />}
      {cashSheet && <CashBalanceSheet onClose={() => setCashSheet(false)} />}
    </>
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
          Accounts appear here once you import a statement.
        </Empty>
        {addButtons}
      </>
    );
  }

  return (
    <>
      {ORDER.map((group) => {
        const rows = list.filter((account) => account.group === group);
        if (rows.length === 0) return null;
        const total = rows.reduce((sum, account) => sum + (account.balance ?? 0), 0);
        return (
          <section key={group} className="card flat" aria-label={group}>
            <div className="grp-h">
              <span>{group}</span>
              <b>
                <Money paise={total} compact />
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
      {addButtons}
    </>
  );
}
