import { formatInr } from '../../domain/money';
import type { NetWorthGroups } from '../../domain/netWorth';
import type { Paise } from '../../parsers/types';
import { useApp } from '../AppContext';
import { useEquitySymbol } from '../hooks';
import { Icon } from '../Icon';
import { Money } from '../Money';

type GroupKey = 'liquid' | 'retirement' | 'market' | 'property';
const GROUPS: { key: GroupKey; label: string; tone: 't1' | 't2' | 't3' | 't4' }[] = [
  { key: 'liquid', label: 'Liquid', tone: 't1' },
  { key: 'retirement', label: 'Retirement', tone: 't2' },
  { key: 'market', label: 'Market', tone: 't3' },
  { key: 'property', label: 'Property', tone: 't4' },
];

/** Assets by group as one stacked bar, with the loan on the same scale. */
export function Composition({
  groups,
  unvested,
  onOpen,
}: {
  groups: NetWorthGroups;
  unvested: Paise;
  onOpen: () => void;
}) {
  const { hideAmounts } = useApp();
  const symbol = useEquitySymbol();
  const shown = GROUPS.filter((group) => group.key !== 'property' || groups.property > 0);
  const assets = groups.liquid + groups.retirement + groups.market + groups.property;
  const owed = Math.abs(groups.liabilities);
  const debtShare = assets > 0 ? Math.min(100, (owed / assets) * 100) : owed > 0 ? 100 : 0;
  const label = hideAmounts
    ? 'Composition. Amounts hidden.'
    : shown.map((g) => `${g.label} ${formatInr(groups[g.key], { compact: true })}`).join(', ');

  return (
    <section className="card" aria-labelledby="comp-h">
      <h2 id="comp-h" className="t-title" style={{ marginBottom: 12 }}>
        Composition
      </h2>
      <div className="sb-bar" role="img" aria-label={label}>
        {shown.map((g) => (
          <span
            key={g.key}
            className={`sb-seg ${g.tone}`}
            style={{ flex: Math.max(groups[g.key], 0) / (assets || 1), minWidth: groups[g.key] > 0 ? 4 : 0 }}
          />
        ))}
      </div>
      <div className={shown.length > 3 ? 'sb-legend c4' : 'sb-legend c3'}>
        {shown.map((g) => (
          <button key={g.key} type="button" className="sb-item" onClick={onOpen}>
            <span className="k">
              <span className={`sw8 ${g.tone}`} />
              {g.label}
            </span>
            <span className="v">
              <Money paise={groups[g.key]} compact />
            </span>
          </button>
        ))}
      </div>
      {owed > 0 && (
        <>
          <div className="divider" style={{ margin: '14px 0 12px' }} />
          <div className="row-between">
            <span className="t-label muted">Owed · Home loan</span>
            <b>
              <Money paise={-owed} compact />
            </b>
          </div>
          <div
            className="sb-bar sm"
            style={{ marginTop: 8 }}
            role="img"
            aria-label="Home loan, drawn on the same scale as assets"
          >
            <span className="sb-seg debt" style={{ flex: `0 0 ${debtShare}%` }} />
          </div>
          <span className="hint" style={{ display: 'block', marginTop: 4 }}>
            Hatched = money owed. Same scale as the bar above.
          </span>
        </>
      )}
      {unvested > 0 && (
        <div className="note" style={{ marginTop: 12 }}>
          <Icon name="info" size={20} />
          <div>
            <b>
              + <Money paise={unvested} compact /> unvested
            </b>
            <br />
            <span className="muted">{symbol} RSUs not yet vested. Not part of net worth.</span>
          </div>
        </div>
      )}
    </section>
  );
}
