import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addMonths, daysBetween } from '../../domain/dates';
import type { Cadence } from '../../domain/recurring';
import type { IsoDate, Paise } from '../../parsers/types';
import type { AccountListItem } from '../../services/accounts';
import type { HomeSummary } from '../../services/dashboard';
import { useApp } from '../AppContext';
import { CatTile } from '../common/CatTile';
import type { CashFlowState } from '../common/TxnSheet';
import { dateShort } from '../format';
import { useEquitySymbol } from '../hooks';
import { Icon } from '../Icon';
import { Money } from '../Money';

interface UpcomingProps {
  data: HomeSummary['upcoming'];
  emi: Paise | null;
  accounts: AccountListItem[];
}

interface Item {
  key: string;
  date: IsoDate;
  to: string;
  state?: CashFlowState;
  lead: ReactNode;
  title: string;
  sub: string;
  end: ReactNode;
  /** Replaces the usual `whenText`. */
  when?: string;
  warn?: boolean;
}

const CADENCE: Record<Cadence, string> = { monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' };

/** `Today`, `Tomorrow`, `In 5 days`, then just the date. */
function whenText(date: IsoDate, today: IsoDate): string {
  const days = daysBetween(today, date);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return days < 7 ? `In ${days} days` : dateShort(date);
}

/**
 * The next vest, loan EMI, PPF deposit and every recurring payment due within a month, soonest
 * first. Each links to its account, or to a recurring payment's past payments on Cash flow.
 */
export function Upcoming({ data, emi, accounts }: UpcomingProps) {
  const { today } = useApp();
  const symbol = useEquitySymbol();
  const to = (kind: AccountListItem['kind']) => {
    const found = accounts.find((account) => account.kind === kind);
    return found === undefined ? '/accounts' : `/accounts/${found.id}`;
  };
  const loan = accounts.find((account) => account.kind === 'loan');

  const items: Item[] = [];
  if (data.vest !== undefined) {
    items.push({
      key: 'vest',
      date: data.vest.date,
      to: to('equity'),
      lead: (
        <span className="lead good" aria-hidden="true">
          <Icon name="trend" size={20} />
        </span>
      ),
      title: `${symbol} vest`,
      sub: `${data.vest.shares} shares`,
      end: <Money paise={data.vest.value} whole />,
    });
  }
  if (data.emiDate !== undefined) {
    items.push({
      key: 'emi',
      date: data.emiDate,
      to: to('loan'),
      lead: <CatTile name="Loan EMI" />,
      title: 'Loan EMI',
      sub: loan?.name ?? 'Home loan',
      end: emi === null ? '' : <Money paise={emi} whole />,
    });
  }
  if (data.ppfReminder !== undefined) {
    items.push({
      key: 'ppf',
      date: data.ppfReminder.dueDate,
      to: to('ppf'),
      lead: (
        <span className="lead warn" aria-hidden="true">
          <Icon name="shield" size={20} />
        </span>
      ),
      title: 'PPF deposit',
      sub: data.ppfReminder.message,
      end: '',
      when: `By ${dateShort(data.ppfReminder.dueDate)}`,
      warn: true,
    });
  }
  for (const item of data.recurring ?? []) {
    items.push({
      key: `rec-${item.payee}`,
      date: item.next,
      to: '/cash-flow',
      state: { search: item.payee },
      lead: <CatTile name={item.category ?? 'Other'} />,
      title: item.payee,
      sub: CADENCE[item.cadence],
      end: <Money paise={item.amount} whole />,
    });
  }
  if (items.length === 0) return null;
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return (
    <section aria-labelledby="up-h">
      <div className="sec">
        <h2 id="up-h">Coming up</h2>
        <span className="muted">Until {dateShort(addMonths(today, 1))}</span>
      </div>
      <div className="card flat">
        <ul className="list">
          {items.map((item) => (
            <li key={item.key}>
              <Link className="row up-row" to={item.to} state={item.state}>
                {item.lead}
                <span className="mid">
                  <span className="ttl">{item.title}</span>
                  <span className="sub">{item.sub}</span>
                </span>
                <span className="end">
                  {item.end !== '' && <span className="amt">{item.end}</span>}
                  <span className={item.warn ? 'sub up-warn' : 'sub'}>{item.when ?? whenText(item.date, today)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
