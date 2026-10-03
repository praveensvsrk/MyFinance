import { Link } from 'react-router-dom';
import type { AccountListItem } from '../../services/accounts';
import type { HomeSummary } from '../../services/dashboard';
import type { Paise } from '../../parsers/types';
import { Icon, type IconName } from '../Icon';
import { dateShort } from '../format';
import { useEquitySymbol } from '../hooks';
import { Money } from '../Money';

interface UpcomingProps {
  data: HomeSummary['upcoming'];
  emi: Paise | null;
  accounts: AccountListItem[];
}

function Row({
  to,
  icon,
  tone,
  title,
  sub,
  amount,
  amountNote,
}: {
  to: string;
  icon: IconName;
  tone?: 'warn';
  title: string;
  sub: string;
  amount?: Paise;
  amountNote?: string;
}) {
  return (
    <Link to={to} className="row">
      <span className={`lead ${tone ?? ''}`}>
        <Icon name={icon} size={22} />
      </span>
      <span className="mid">
        <span className="ttl">{title}</span>
        <span className="sub">{sub}</span>
      </span>
      {amount !== undefined && (
        <span className="end">
          <span className="amt num">
            <Money paise={amount} compact />
          </span>
          {amountNote !== undefined && <span className="sub">{amountNote}</span>}
        </span>
      )}
      <span className="chev">
        <Icon name="chevron" size={20} />
      </span>
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
    <section className="card flat" aria-labelledby="up-h">
      <h2 id="up-h" className="t-title" style={{ padding: '16px 16px 4px' }}>
        Upcoming
      </h2>
      {data.vest !== undefined && (
        <Row
          to={to('equity')}
          icon="calendar"
          title={`${symbol} vest · ${dateShort(data.vest.date)}`}
          sub={`${data.vest.shares} shares`}
          amount={data.vest.value}
          amountNote="at today’s price"
        />
      )}
      {data.emiDate !== undefined && (
        <Row
          to={to('loan')}
          icon="home"
          title={`Loan EMI · ${dateShort(data.emiDate)}`}
          sub={loan === undefined ? 'Home loan' : loan.name}
          {...(emi === null ? {} : { amount: emi })}
        />
      )}
      {data.ppfReminder !== undefined && (
        <Row
          to={to('ppf')}
          icon="shield"
          tone="warn"
          title={`PPF deposit · by ${dateShort(data.ppfReminder.dueDate)}`}
          sub={data.ppfReminder.message}
        />
      )}
    </section>
  );
}
