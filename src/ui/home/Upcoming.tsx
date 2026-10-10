import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AccountListItem } from '../../services/accounts';
import type { HomeSummary } from '../../services/dashboard';
import type { Paise } from '../../parsers/types';
import type { CashFlowState } from '../common/TxnSheet';
import { dateShort } from '../format';
import { useEquitySymbol } from '../hooks';
import { Money } from '../Money';

/** Recurring payments shown as their own cards; the rest share one. */
const RECURRING_CARDS = 5;

interface UpcomingProps {
  data: HomeSummary['upcoming'];
  emi: Paise | null;
  accounts: AccountListItem[];
}

function Card({
  to,
  state,
  when,
  title,
  detail,
  tone,
}: {
  to: string;
  state?: CashFlowState;
  when: string;
  title: string;
  detail: ReactNode;
  tone?: 'warn';
}) {
  return (
    <Link to={to} state={state} className={`card up-card${tone === 'warn' ? ' warn' : ''}`}>
      <span className="up-when">{when}</span>
      <span className="up-ttl">{title}</span>
      <span className="up-det mono">{detail}</span>
    </Link>
  );
}

/**
 * The next vest, loan EMI and PPF deposit, each linking to its account, then recurring payments
 * due within 30 days, each opening its past payments on Cash flow.
 */
export function Upcoming({ data, emi, accounts }: UpcomingProps) {
  const symbol = useEquitySymbol();
  if (data.vest === undefined && data.emiDate === undefined && data.ppfReminder === undefined && data.recurring === undefined) {
    return null;
  }
  const to = (kind: AccountListItem['kind']) => {
    const found = accounts.find((account) => account.kind === kind);
    return found === undefined ? '/accounts' : `/accounts/${found.id}`;
  };
  const loan = accounts.find((account) => account.kind === 'loan');
  const recurring = data.recurring ?? [];
  const rest = recurring.slice(RECURRING_CARDS);

  return (
    <section aria-labelledby="up-h">
      <div className="sec">
        <h2 id="up-h">Coming up</h2>
        <span className="muted">Next 30 days</span>
      </div>
      <div className="up-scroll">
        {data.vest !== undefined && (
          <Card
            to={to('equity')}
            when={dateShort(data.vest.date).toUpperCase()}
            title={`${symbol} vest`}
            detail={`${data.vest.shares} sh`}
          />
        )}
        {data.emiDate !== undefined && (
          <Card
            to={to('loan')}
            when={dateShort(data.emiDate).toUpperCase()}
            title="Loan EMI"
            detail={emi === null ? (loan?.name ?? 'Home loan') : <Money paise={emi} whole />}
          />
        )}
        {data.ppfReminder !== undefined && (
          <Card
            to={to('ppf')}
            tone="warn"
            when={`BY ${dateShort(data.ppfReminder.dueDate).toUpperCase()}`}
            title="PPF deposit"
            detail={data.ppfReminder.message}
          />
        )}
        {recurring.slice(0, RECURRING_CARDS).map((item) => (
          <Card
            key={item.payee}
            to="/cash-flow"
            state={{ search: item.payee }}
            when={dateShort(item.next).toUpperCase()}
            title={item.payee}
            detail={<Money paise={item.amount} whole />}
          />
        ))}
        {rest.length > 0 && (
          <Card
            to="/cash-flow"
            when="ALSO DUE"
            title={`${rest.length} more recurring`}
            detail={<Money paise={rest.reduce((sum, item) => sum + item.amount, 0)} whole />}
          />
        )}
      </div>
    </section>
  );
}
