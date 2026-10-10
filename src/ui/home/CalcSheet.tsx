import { formatInr, formatUsd } from '../../domain/money';
import type { BreakdownRow, NetWorthBreakdown } from '../../services/netWorthBreakdown';
import type { Paise } from '../../parsers/types';
import { Icon } from '../Icon';
import { dateShort, usdInr as formatUsdInr } from '../format';
import { Money } from '../Money';
import { useApp } from '../AppContext';
import { useEquitySymbol } from '../hooks';
import { Sheet } from '../common/Sheet';

function basisText(row: BreakdownRow, hidden: boolean): string | null {
  const basis = row.basis;
  if (basis === undefined) return null;
  if (row.kind === 'mf') {
    const parts = [basis.navDate ? `NAV of ${dateShort(basis.navDate)}` : 'No NAV yet'];
    if (basis.provisional !== undefined && basis.provisional > 0) {
      parts.push(`includes ${hidden ? '••••' : formatInr(basis.provisional, { compact: true })} provisional`);
    }
    return parts.join(' · ');
  }
  if (row.kind === 'equity' && basis.shares !== undefined) {
    if (hidden) return `${basis.shares} shares × price × rate`;
    const price = basis.priceUsdCents == null ? '—' : formatUsd(basis.priceUsdCents);
    const rate = basis.usdInr == null ? '—' : `₹${formatUsdInr(basis.usdInr)}`;
    return `${basis.shares} shares × ${price} × ${rate}`;
  }
  return null;
}

function Group({ title, rows, hidden }: { title: string; rows: BreakdownRow[]; hidden: boolean }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <section aria-label={title}>
      <div className="grp-h" style={{ padding: '12px 0 4px' }}>
        <span>{title}</span>
        <b>
          <Money paise={total} compact />
        </b>
      </div>
      {rows.map((row) => {
        const basis = basisText(row, hidden);
        return (
          <div key={row.id} className="kv" style={{ alignItems: 'flex-start' }}>
            <span className="k" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{row.label}</span>
              <span className="sub">
                {row.stale && <span className="dot" aria-hidden="true" style={{ marginRight: 6 }} />}
                {row.asOf === null ? 'No date' : dateShort(row.asOf)}
                {row.stale && <span className="sr"> (out of date)</span>}
              </span>
              {basis !== null && <span className="sub">{basis}</span>}
            </span>
            <span className="v">
              <Money paise={row.value} compact />
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** "How this is calculated": every component behind the net-worth figure. */
export function CalcSheet({
  breakdown,
  netWorth,
  unvested,
  onClose,
}: {
  breakdown: NetWorthBreakdown | undefined;
  netWorth: Paise;
  unvested: Paise;
  onClose: () => void;
}) {
  const { hideAmounts } = useApp();
  const symbol = useEquitySymbol();
  // A loan's balance is negative, so `owed` is the amount left to pay.
  const owed = breakdown === undefined ? 0 : -sum(breakdown.liabilities);
  // The home and its loan are shown as one group: the value, the loan taken off it, and what is left.
  const homeRows =
    breakdown === undefined
      ? []
      : [...breakdown.property, ...breakdown.liabilities.map((row) => ({ ...row, label: `Loan · ${row.label}` }))];

  return (
    <Sheet
      title="Net worth breakdown"
      testId="calc-sheet"
      onClose={onClose}
      subtitle={
        hideAmounts ? (
          'Amounts hidden.'
        ) : (
          <>
            {formatInr(netWorth + owed, { compact: true })} assets
            {owed > 0 && <> − {formatInr(owed, { compact: true })} owed</>}
          </>
        )
      }
    >
      {breakdown === undefined ? (
        <div className="sk" style={{ height: 160, marginTop: 12 }} aria-busy="true" />
      ) : (
        <>
          <Group title="Liquid" rows={breakdown.liquid} hidden={hideAmounts} />
          <Group title="Retirement" rows={breakdown.retirement} hidden={hideAmounts} />
          <Group title="Market" rows={breakdown.market} hidden={hideAmounts} />
          <Group title={breakdown.property.length > 0 ? 'Home equity' : 'Home loan'} rows={homeRows} hidden={hideAmounts} />
        </>
      )}
      <div className="note" style={{ marginTop: 16 }}>
        <Icon name="info" size={20} />
        <span>
          {unvested > 0 ? (
            <>
              Not included: <Money paise={unvested} compact /> unvested {symbol} RSUs and EPS pension.
            </>
          ) : (
            'Not included: EPS pension.'
          )}
        </span>
      </div>
    </Sheet>
  );
}

function sum(rows: BreakdownRow[]): Paise {
  return rows.reduce((total, row) => total + row.value, 0);
}
