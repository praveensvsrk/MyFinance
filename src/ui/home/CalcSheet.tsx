import { useEffect, useRef, type PointerEvent } from 'react';
import { formatInr, formatUsd } from '../../domain/money';
import type { BreakdownRow, NetWorthBreakdown } from '../../services/netWorthBreakdown';
import type { Paise } from '../../parsers/types';
import { EQUITY_SYMBOL } from '../../config';
import { Icon } from '../Icon';
import { dateShort, usdInr as formatUsdInr } from '../format';
import { Money } from '../Money';
import { useApp } from '../AppContext';

const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])';
const DRAG_CLOSE_PX = 80;

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
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheet.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || sheet.current === null) return;
    const items = Array.from(sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const onDown = (event: PointerEvent) => {
    drag.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent) => {
    if (drag.current !== null && event.clientY - drag.current > DRAG_CLOSE_PX) {
      drag.current = null;
      onClose();
    }
  };
  const onUp = () => {
    drag.current = null;
  };

  const assets = breakdown === undefined ? 0 : sum(breakdown.liquid) + sum(breakdown.retirement) + sum(breakdown.market);
  const owed = breakdown === undefined ? 0 : sum(breakdown.liabilities);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calc-h"
        data-testid="calc-sheet"
        onKeyDown={onKeyDown}
      >
        <div
          className="handle"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-hidden="true"
        />
        <div className="row-between">
          <h2 id="calc-h">How this is calculated</h2>
          <button type="button" className="ib sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <p className="sub">
          {hideAmounts ? (
            'Amounts hidden.'
          ) : (
            <>
              {formatInr(assets, { compact: true })} assets − {formatInr(-owed, { compact: true }).replace('-', '')} owed ={' '}
              {formatInr(netWorth, { compact: true })}
            </>
          )}
        </p>
        {breakdown === undefined ? (
          <div className="sk" style={{ height: 160, marginTop: 12 }} aria-busy="true" />
        ) : (
          <>
            <Group title="Liquid" rows={breakdown.liquid} hidden={hideAmounts} />
            <Group title="Retirement" rows={breakdown.retirement} hidden={hideAmounts} />
            <Group title="Market" rows={breakdown.market} hidden={hideAmounts} />
            <Group title="Owed" rows={breakdown.liabilities.map((row) => ({ ...row, value: -row.value }))} hidden={hideAmounts} />
          </>
        )}
        <div className="note" style={{ marginTop: 16 }}>
          <Icon name="info" size={20} />
          <span>
            {unvested > 0 ? (
              <>
                Not included: <Money paise={unvested} compact /> unvested {EQUITY_SYMBOL} RSUs and EPS pension.
              </>
            ) : (
              'Not included: EPS pension.'
            )}
          </span>
        </div>
      </div>
    </>
  );
}

function sum(rows: BreakdownRow[]): Paise {
  return rows.reduce((total, row) => total + row.value, 0);
}
