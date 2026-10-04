import { Link } from 'react-router-dom';
import { formatInr } from '../../domain/money';
import type { NetWorthGroups } from '../../domain/netWorth';
import { useApp } from '../AppContext';
import { pct } from '../format';
import { Money } from '../Money';

type GroupKey = 'liquid' | 'retirement' | 'market' | 'property';
const GROUPS: { key: GroupKey; label: string; sub: string; color: string }[] = [
  { key: 'liquid', label: 'Liquid', sub: 'Banks and cash', color: 'var(--asset-liquid)' },
  { key: 'retirement', label: 'Retirement', sub: 'EPF · PPF', color: 'var(--asset-retirement)' },
  { key: 'market', label: 'Market', sub: 'Funds and shares', color: 'var(--asset-market)' },
  { key: 'property', label: 'Property', sub: 'Home', color: 'var(--asset-property)' },
];

/** Accounts by group: one segmented bar, then a row per group with its share; the loan comes off net worth. */
export function Composition({ groups, onOpen }: { groups: NetWorthGroups; onOpen: () => void }) {
  const { hideAmounts } = useApp();
  const shown = GROUPS.filter((group) => group.key !== 'property' || groups.property > 0);
  const assets = groups.liquid + groups.retirement + groups.market + groups.property;
  const owed = Math.abs(groups.liabilities);
  const label = hideAmounts
    ? 'Composition. Amounts hidden.'
    : shown.map((g) => `${g.label} ${formatInr(groups[g.key], { compact: true })}`).join(', ');

  return (
    <section aria-labelledby="comp-h">
      <div className="sec">
        <h2 id="comp-h">Accounts</h2>
        <Link to="/accounts" className="link">
          See all
        </Link>
      </div>
      <div className="card flat home-comp">
        <div className="hc-bar" role="img" aria-label={label}>
          {shown.map((g) => (
            <span
              key={g.key}
              style={{ flex: Math.max(groups[g.key], 0) / (assets || 1), minWidth: groups[g.key] > 0 ? 4 : 0, background: g.color }}
            />
          ))}
        </div>
        <ul className="list">
          {shown.map((g) => (
            <li key={g.key}>
              <button type="button" className="row hc-row" onClick={onOpen}>
                <span className="hc-sw" style={{ background: g.color }} aria-hidden="true" />
                <span className="mid">
                  <span className="ttl">{g.label}</span>
                  <span className="sub">{g.sub}</span>
                </span>
                <span className="end">
                  <span className="amt">
                    <Money paise={groups[g.key]} compact />
                  </span>
                  <span className="sub mono">{hideAmounts || assets <= 0 ? '' : pct((groups[g.key] / assets) * 100)}</span>
                </span>
              </button>
            </li>
          ))}
          {owed > 0 && (
            <li>
              <button type="button" className="row hc-row hc-debt" onClick={onOpen}>
                <span className="hc-sw hollow" aria-hidden="true" />
                <span className="mid">
                  <span className="ttl">Home loan</span>
                  <span className="sub">Taken off net worth</span>
                </span>
                <span className="end">
                  <span className="amt hc-loss">
                    <Money paise={-owed} compact />
                  </span>
                </span>
              </button>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
