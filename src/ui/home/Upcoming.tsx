import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AccountListItem } from '../../services/accounts';
import type { HomeSummary } from '../../services/dashboard';
import type { Paise } from '../../parsers/types';
import { dateShort } from '../format';
import { useEquitySymbol } from '../hooks';
import { Money } from '../Money';

interface UpcomingProps {
  data: HomeSummary['upcoming'];
  emi: Paise | null;
  accounts: AccountListItem[];
}

function Card({
  to,
  when,
  title,
  detail,
  tone,
}: {
  to: string;
  when: string;
  title: string;
  detail: ReactNode;
  tone?: 'warn';
}) {
  return (
    <Link to={to} className={`card up-card${tone === 'warn' ? ' warn' : ''}`}>
      <span className="up-when">{when}</span>
      <span className="up-ttl">{title}</span>
      <span className="up-det mono">{detail}</span>
    </Link>
  );
}

/** The next vest, loan EMI and PPF deposit, each linking to its account. */
export function Upcoming({ data, emi, accounts }: UpcomingProps) {
  const symbol = useEquitySymbol();
  if (data.vest === undefined && data.emiDate === undefined && data.ppfReminder === undefined) return null;
  const to = (kind: AccountListItem['kind']) => {
    const found = accounts.find((account) => account.kind === kind);
    return found === undefined ? '/accounts' : `/accounts/${found.id}`;
  };
  const loan = accounts.find((account) => account.kind === 'loan');

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
      </div>
    </section>
  );
}
