import { STALE_BANK_DAYS } from '../../domain/attention';
import { daysBetween } from '../../domain/dates';
import type { IsoDate, Paise } from '../../parsers/types';
import { useApp } from '../AppContext';
import { Icon } from '../Icon';
import { dateLong, signedPct } from '../format';
import { Money } from '../Money';

/** The net-worth headline; opens the "How this is calculated" sheet. */
export function Hero({
  netWorth,
  change,
  asOf,
  onOpen,
}: {
  netWorth: Paise;
  change: { amount: Paise; pct: number | null };
  asOf: IsoDate;
  onOpen: () => void;
}) {
  const { today } = useApp();
  const direction = change.amount > 0 ? 'up' : change.amount < 0 ? 'down' : 'flat';
  const age = daysBetween(asOf, today);
  const stale = age > STALE_BANK_DAYS;

  return (
    <button type="button" className="card hero" onClick={onOpen} aria-label="Net worth. Show how it is calculated.">
      <span className="row-between">
        <span className="lab">Net worth</span>
        <span className="chev">
          <Icon name="chevron" size={20} />
        </span>
      </span>
      <span className="hero-amt" data-testid="net-worth" data-paise={netWorth}>
        <Money paise={netWorth} whole />
      </span>
      <span className="hero-d">
        <span className={`delta ${direction}`}>
          <span aria-hidden="true">{direction === 'up' ? '▲' : direction === 'down' ? '▼' : '–'}</span>
          <span className="sr">{direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'Unchanged'} </span>
          <span>{signedPct(change.pct).replace(/^[▲▼] /, '')}</span>
          <span className="amt">
            <Money paise={change.amount} sign whole />
          </span>
        </span>
        <span className="muted">vs last month</span>
      </span>
      <span className="asof">
        {stale && <span className="dot" aria-hidden="true" />}
        As of {dateLong(asOf)}
        {stale && ` · older than ${STALE_BANK_DAYS} days`}
      </span>
    </button>
  );
}
