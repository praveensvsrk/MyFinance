import { STALE_BANK_DAYS } from '../../domain/attention';
import { daysBetween } from '../../domain/dates';
import type { NetWorthGroups } from '../../domain/netWorth';
import type { IsoDate, Paise } from '../../parsers/types';
import { useApp } from '../AppContext';
import { dateLong, signedPct } from '../format';
import { Money } from '../Money';
import { TrendCard } from './TrendCard';

/** The dark net-worth hero: headline, change, trend with range buttons, and the Assets / Owed / Unvested strip. */
export function Hero({
  netWorth,
  change,
  asOf,
  groups,
  unvested,
  vestDates,
  onOpen,
}: {
  netWorth: Paise;
  change: { amount: Paise; pct: number | null };
  asOf: IsoDate;
  groups: NetWorthGroups;
  unvested: Paise;
  vestDates: IsoDate[];
  onOpen: () => void;
}) {
  const { today, hideAmounts, setHideAmounts } = useApp();
  const direction = change.amount > 0 ? 'up' : change.amount < 0 ? 'down' : 'flat';
  const age = daysBetween(asOf, today);
  const stale = age > STALE_BANK_DAYS;
  const assets = groups.liquid + groups.retirement + groups.market + groups.property;
  const owed = Math.abs(groups.liabilities);

  return (
    <section className="hero-dark home-hero" aria-label="Net worth">
      <button
        type="button"
        className="hh-open"
        onClick={onOpen}
        aria-label="Net worth. Show the breakdown."
      >
        <span className="hd-lab">Net worth</span>
        <span className="hd-amt" data-testid="net-worth" data-paise={netWorth}>
          <Money paise={netWorth} whole />
        </span>
        <span className="hh-delta">
          <span className={`pill-lime ${direction === 'down' ? 'down' : ''}`}>
            <span aria-hidden="true">{direction === 'up' ? '▲' : direction === 'down' ? '▼' : '–'}</span>
            <span className="sr">{direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'Unchanged'} </span>
            <Money paise={change.amount} sign whole />
            {change.pct !== null && <span> · {signedPct(change.pct).replace(/^[▲▼] /, '')}</span>}
          </span>
          <span className="hd-sub">vs last month</span>
        </span>
        <span className="hd-sub">
          {stale && <span className="hh-dot" aria-hidden="true" />}
          As of {dateLong(asOf)}
          {stale && ` · older than ${STALE_BANK_DAYS} days`}
        </span>
      </button>
      <button
        type="button"
        className="hh-eye"
        aria-label={hideAmounts ? 'Show amounts' : 'Hide amounts'}
        aria-pressed={hideAmounts}
        onClick={() => setHideAmounts(!hideAmounts)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {hideAmounts && <path d="M4 4l16 16" />}
        </svg>
      </button>
      <TrendCard vestDates={vestDates} />
      <div className="hd-grid">
        <div>
          <div className="hd-k">Assets</div>
          <div className="hd-v">
            <Money paise={assets} compact />
          </div>
        </div>
        <div>
          <div className="hd-k">Owed</div>
          <div className="hd-v loss">
            <Money paise={-owed} compact />
          </div>
        </div>
        <div>
          <div className="hd-k">Unvested</div>
          <div className="hd-v dim">
            <Money paise={unvested} compact />
          </div>
        </div>
      </div>
    </section>
  );
}
