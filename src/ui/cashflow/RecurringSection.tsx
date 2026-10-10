import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Cadence } from '../../domain/recurring';
import { useActions } from '../actions';
import { CatTile } from '../common/CatTile';
import type { CashFlowState } from '../common/TxnSheet';
import { dateShort } from '../format';
import { useRecurring } from '../hooks';
import { Icon } from '../Icon';
import { Money } from '../Money';

const CADENCE: Record<Cadence, string> = { monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' };

/**
 * Payments that come round every month, quarter or year, with what they cost a month. Tapping one
 * searches its past payments; "not recurring" hides a payee that only looks regular.
 */
export function RecurringSection() {
  const data = useRecurring().data;
  const actions = useActions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (data === undefined || (data.items.length === 0 && data.hidden === 0)) return null;
  const first = data.items[0];

  return (
    <section className="cf-card" aria-labelledby="rec-h" data-testid="recurring" style={{ padding: 0 }}>
      <button type="button" className="cf-exc" aria-expanded={open} onClick={() => setOpen(!open)}>
        <CatTile name="Subscriptions" />
        <span className="mid">
          <span className="nm" id="rec-h">
            Recurring
          </span>
          <span className="sb">
            {first === undefined
              ? 'None left'
              : `${data.items.length} ${data.items.length === 1 ? 'payment' : 'payments'} · next ${first.payee} on ${dateShort(first.next)}`}
          </span>
        </span>
        <span className="cf-rec-tot">
          <Money paise={data.perMonth} whole />
          <span className="p">a month</span>
        </span>
      </button>
      {open && (
        <div className="cf-exc-d">
          <ul className="cf-rec">
            {data.items.map((item) => (
              <li key={item.payee}>
                <button
                  type="button"
                  className="cf-rec-main"
                  onClick={() => navigate('/cash-flow', { state: { search: item.payee } satisfies CashFlowState })}
                >
                  <CatTile name={item.category ?? 'Other'} />
                  <span className="mid">
                    <span className="nm">{item.payee}</span>
                    <span className="sb">
                      {CADENCE[item.cadence]} · next {dateShort(item.next)}
                    </span>
                  </span>
                  <Money paise={item.amount} whole />
                </button>
                <button
                  type="button"
                  className="ib plain"
                  aria-label={`${item.payee} is not recurring`}
                  title="Not recurring"
                  onClick={() => void actions.dismissRecurring(item.payee)}
                >
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <span className="cap">
            Found from payments that repeat at a steady amount. Tap one to see every payment.
            {data.hidden > 0 && (
              <>
                {' '}
                <button type="button" className="link" onClick={() => void actions.restoreRecurring()}>
                  Show the {data.hidden} you hid
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </section>
  );
}
