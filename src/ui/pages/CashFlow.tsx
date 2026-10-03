import { useState } from 'react';
import type { TxnRow } from '../../db/schema';
import { addMonths, monthKey } from '../../domain/dates';
import { useApp } from '../AppContext';
import { CategorySheet } from '../common/CategorySheet';
import { Empty, ScreenSkeleton } from '../common/Empty';
import { groupByDay } from '../common/groupByDay';
import { TxnItem } from '../common/TxnItem';
import { dateLong, monthLabel, pct } from '../format';
import { Icon } from '../Icon';
import { useCashFlow } from '../hooks';
import { Money } from '../Money';

const step = (month: string, by: number): string => monthKey(addMonths(`${month}-01`, by));

/** One month's income, spending, categories and transactions, with month-by-month navigation. */
export function CashFlow() {
  const { today } = useApp();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<TxnRow | null>(null);
  const flow = useCashFlow(month);
  const data = flow.data;
  const isCurrent = month >= current;

  function go(by: number) {
    setMonth((value) => step(value, by));
    setSelected(null);
  }

  const nav = (
    <div className="month-nav">
      <button type="button" className="ib" aria-label="Previous month" onClick={() => go(-1)}>
        <Icon name="prev" />
      </button>
      <h2 aria-live="polite">{monthLabel(month)}</h2>
      <button type="button" className="ib" aria-label="Next month" disabled={isCurrent} onClick={() => go(1)}>
        <Icon name="chevron" />
      </button>
    </div>
  );

  if (data === undefined) {
    return (
      <>
        {nav}
        <ScreenSkeleton heights={[110, 200, 220]} />
      </>
    );
  }

  const saved = data.income - data.spending;
  const savedPct = data.income > 0 ? Math.round((saved / data.income) * 100) : null;
  const biggest = data.categories[0]?.amount ?? 0;
  const transactions = (selected === null
    ? data.transactions
    : data.transactions.filter((txn) => (txn.category ?? 'Other') === selected && txn.amount < 0)
  )
    .slice()
    .reverse();
  const groups = groupByDay(transactions);

  if (data.transactions.length === 0) {
    return (
      <>
        {nav}
        <Empty icon="flow" title={`Nothing in ${monthLabel(month)}`}>
          Import a bank statement that covers this month to see where the money went.
        </Empty>
      </>
    );
  }

  return (
    <>
      {nav}
      <section className="card" aria-label="Summary">
        <div className="stats c3">
          <div className="stat">
            <span className="lab">Income</span>
            <span className="val">
              <Money paise={data.income} compact />
            </span>
          </div>
          <div className="stat">
            <span className="lab">Spent</span>
            <span className="val">
              <Money paise={data.spending} compact />
            </span>
          </div>
          <div className="stat">
            <span className="lab">Saved</span>
            <span className="val">{pct(savedPct, 0)}</span>
          </div>
        </div>
        <div className="row-between" style={{ marginTop: 12 }}>
          <span className="muted">{saved >= 0 ? 'Left over' : 'Overspent by'}</span>
          <b className={saved >= 0 ? 'res-ok' : 'res-bad'}>
            <Money paise={Math.abs(saved)} whole />
          </b>
        </div>
        <span className="cap">Transfers between your accounts and investments are not counted as spending.</span>
      </section>

      {data.categories.length > 0 && (
        <section className="card" aria-labelledby="cat-h">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h2 id="cat-h" className="t-title">
              Where it went
            </h2>
            {selected !== null && (
              <button type="button" className="link" onClick={() => setSelected(null)}>
                Show all
              </button>
            )}
          </div>
          {data.categories.map((row) => (
            <button
              key={row.category}
              type="button"
              className={`cb${row.category === 'Other' ? ' other' : ''}${selected === row.category ? ' sel' : ''}${selected !== null && selected !== row.category ? ' dim' : ''}`}
              aria-pressed={selected === row.category}
              onClick={() => setSelected(selected === row.category ? null : row.category)}
            >
              <span className="l">
                <span>
                  {row.category}
                  <span className="p">{data.spending > 0 ? `${Math.round((row.amount / data.spending) * 100)}%` : ''}</span>
                </span>
                <b className="num">
                  <Money paise={row.amount} whole />
                </b>
              </span>
              <span className="t">
                <i style={{ width: `${biggest > 0 ? (row.amount / biggest) * 100 : 0}%` }} />
              </span>
            </button>
          ))}
        </section>
      )}

      <section aria-labelledby="tx-h" className="stack gap12">
        <h2 id="tx-h" className="t-title" style={{ padding: '0 4px' }}>
          {selected === null ? 'Transactions' : `${selected} transactions`}
        </h2>
        {transactions.length === 0 ? (
          <p className="muted" style={{ padding: '0 4px' }}>
            No spending in this category.
          </p>
        ) : (
          <div className="card flat" data-testid="txn-list">
            {groups.map((group, index) => (
              <div key={group.date}>
                <div className={index === 0 ? 'day first' : 'day'}>{dateLong(group.date)}</div>
                <ul>
                  {group.items.map((txn) => (
                    <TxnItem key={txn.id} txn={txn} onCategory={setEditing} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      {editing !== null && <CategorySheet txn={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
