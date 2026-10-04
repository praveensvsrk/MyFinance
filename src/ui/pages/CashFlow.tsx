import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../styles/cashflow.css';
import type { TxnRow } from '../../db/schema';
import { excludedSet, isNotSpending } from '../../domain/categories';
import { addMonths, monthKey } from '../../domain/dates';
import { useApp } from '../AppContext';
import { CatTile } from '../common/CatTile';
import { CategorySheet } from '../common/CategorySheet';
import { Empty, ScreenSkeleton } from '../common/Empty';
import { groupByDay } from '../common/groupByDay';
import { TxnItem } from '../common/TxnItem';
import { dateShort, monthLabel, pct } from '../format';
import { Icon } from '../Icon';
import { useCashFlow, useCategoryConfig } from '../hooks';
import { Money } from '../Money';
import { RulesSheet } from '../rules/RulesSheet';

const LIMIT = 6;
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** `30 SEP · TUE` from an ISO date. */
function dayLabel(date: string): string {
  const weekday = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
  return `${dateShort(date)} · ${weekday}`;
}

const step = (month: string, by: number): string => monthKey(addMonths(`${month}-01`, by));

/** Current month, or the previous one when this month is still empty. */
function openingMonth(
  current: string,
  previous: string,
  currentCount: number | undefined,
  previousCount: number | undefined,
): string | null {
  if (currentCount === undefined) return null;
  if (currentCount > 0) return current;
  if (previousCount === undefined) return null;
  return previousCount > 0 ? previous : current;
}

/** One month's income, spending, categories and transactions, with month-by-month navigation. */
export function CashFlow() {
  const { today } = useApp();
  const current = today.slice(0, 7);
  const previous = step(current, -1);
  const [picked, setPicked] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<TxnRow | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const currentFlow = useCashFlow(current);
  const previousFlow = useCashFlow(previous);
  const browsing = picked !== null && picked !== current && picked !== previous ? picked : current;
  const browsingFlow = useCashFlow(browsing);
  const auto = openingMonth(
    current,
    previous,
    currentFlow.data?.transactions.length,
    previousFlow.data?.transactions.length,
  );
  const month = picked ?? auto ?? current;
  const flow = month === current ? currentFlow : month === previous ? previousFlow : browsingFlow;
  const prevOfMonth = useCashFlow(step(month, -1));
  const excluded = excludedSet(useCategoryConfig());
  const data = flow.data;
  const isCurrent = month >= current;

  function go(by: number) {
    setPicked(step(month, by));
    setSelected(null);
  }

  const months = Array.from({ length: 12 }, (_, i) => step(current, i - 11));
  if (!months.includes(month)) months.unshift(month);
  const nav = (
    <>
      <div className="cf-seg" role="group" aria-label="Period">
        <span className="on" aria-current="true">
          Month
        </span>
        <Link to="/cash-flow/year">Financial year</Link>
      </div>
      <h2 className="sr" aria-live="polite">
        {monthLabel(month)}
      </h2>
      <div className="cf-months" role="group" aria-label="Month">
        {months.map((m) => (
          <button
            key={m}
            type="button"
            className={m === month ? 'cf-mo on' : 'cf-mo'}
            aria-pressed={m === month}
            aria-label={monthLabel(m)}
            ref={m === month ? (el) => el?.scrollIntoView?.({ inline: 'center', block: 'nearest' }) : undefined}
            onClick={() => {
              setPicked(m);
              setSelected(null);
            }}
          >
            {m === month ? monthLabel(m) : monthLabel(m).slice(0, 3)}
          </button>
        ))}
      </div>
    </>
  );

  if ((picked === null && auto === null) || data === undefined || data.month !== month) {
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

  const prevFlow = prevOfMonth.data;
  const prevPct =
    prevFlow !== undefined && prevFlow.month === step(month, -1) && prevFlow.income > 0
      ? Math.round(((prevFlow.income - prevFlow.spending) / prevFlow.income) * 100)
      : null;
  const monthName = monthLabel(month).slice(0, -5);
  const prevName = monthLabel(step(month, -1)).slice(0, -5);
  const diffPts = savedPct !== null && prevPct !== null ? savedPct - prevPct : null;
  const barMax = Math.max(data.income, data.spending, 1);
  const shownCats = expanded || selected !== null ? data.categories : data.categories.slice(0, LIMIT);
  const hiddenCats = data.categories.slice(LIMIT);
  const hiddenTotal = hiddenCats.reduce((sum, row) => sum + row.amount, 0);
  const excludedTotal = data.excluded.reduce((sum, row) => sum + row.out, 0) || data.excluded.reduce((sum, row) => sum + row.in, 0);
  const tools = (
    <div className="cf-tools">
      <button type="button" className="link" onClick={() => setShowRules(true)}>
        Rules
      </button>
      <Link to="/settings" state={{ newCategory: true, returnTo: '/cash-flow' }} className="link">
        New category
      </Link>
    </div>
  );

  return (
    <>
      {nav}
      <section className="hero-dark" aria-label="Summary">
        <div className="hd-lab">{saved >= 0 ? `Left over in ${monthName}` : `Overspent in ${monthName}`}</div>
        <div className={`hd-amt ${saved >= 0 ? 'cf-gain' : 'cf-loss'}`}>
          <Money paise={saved} whole sign />
        </div>
        {savedPct !== null && (
          <div className="hd-sub">
            You saved <b style={{ color: 'var(--hero-text)' }}>{pct(savedPct, 0)}</b> of what came in
            {diffPts !== null && diffPts !== 0 && ` · ${Math.abs(diffPts)} pts ${diffPts > 0 ? 'better' : 'lower'} than ${prevName}`}
          </div>
        )}
        <div className="cf-bars">
          <div>
            <div className="cf-bar-h">
              <span className="k">Income</span>
              <Money paise={data.income} compact />
            </div>
            <div className="cf-bar">
              <i style={{ width: `${(data.income / barMax) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="cf-bar-h">
              <span className="k">Spent</span>
              <Money paise={data.spending} compact />
            </div>
            <div className="cf-bar spent">
              <i style={{ width: `${(data.spending / barMax) * 100}%` }} />
            </div>
          </div>
        </div>
        <div className="cf-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8v.5" />
          </svg>
          Moves between your own accounts and into investments are left out.
        </div>
      </section>

      {data.categories.length > 0 ? (
        <section aria-labelledby="cat-h">
          <div className="cf-sec">
            <h2 id="cat-h">Expenses</h2>
            {selected !== null ? (
              <button type="button" className="link" onClick={() => setSelected(null)}>
                Show all
              </button>
            ) : (
              <span className="meta">{data.categories.length} categories</span>
            )}
          </div>
          <div className="cf-card">
            {shownCats.map((row) => (
              <button
                key={row.category}
                type="button"
                className={`cf-cat${selected === row.category ? ' sel' : ''}${selected !== null && selected !== row.category ? ' dim' : ''}`}
                aria-pressed={selected === row.category}
                onClick={() => setSelected(selected === row.category ? null : row.category)}
              >
                <CatTile name={row.category} />
                <span>
                  <span className="nm">{row.category}</span>
                </span>
                <span className="en">
                  <Money paise={row.amount} whole />
                  <span className="p">{data.spending > 0 ? `${Math.round((row.amount / data.spending) * 100)}%` : ''}</span>
                </span>
                <span className="bar">
                  <i style={{ width: `${biggest > 0 ? (row.amount / biggest) * 100 : 0}%` }} />
                </span>
              </button>
            ))}
            {hiddenCats.length > 0 && selected === null && (
              <button type="button" className="cf-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                {expanded ? (
                  'Show fewer'
                ) : (
                  <>
                    Show {hiddenCats.length} more · <Money paise={hiddenTotal} whole />
                  </>
                )}
              </button>
            )}
          </div>
          {tools}
        </section>
      ) : (
        tools
      )}

      {data.excluded.length > 0 && (
        <section className="cf-card" aria-label="Not counted as spending" data-testid="excluded" style={{ padding: 0 }}>
          <button type="button" className="cf-exc" aria-expanded={showExcluded} onClick={() => setShowExcluded(!showExcluded)}>
            <span className="cf-tile" aria-hidden="true" style={{ background: '#EEF0ED', color: '#5B6661' }}>
              <Icon name="flow" />
            </span>
            <span className="mid">
              <span className="nm">Not counted as spending</span>
              <span className="sb">{data.excluded.map((row) => row.category).join(', ')}</span>
            </span>
            <Money paise={excludedTotal} whole />
          </button>
          {showExcluded && (
            <div className="cf-exc-d">
              {data.excluded.map((row) => (
                <div key={row.category} className="r">
                  <span>{row.category}</span>
                  <span className="muted">
                    {row.out > 0 && (
                      <>
                        Out <Money paise={row.out} whole />
                      </>
                    )}
                    {row.out > 0 && row.in > 0 && ' · '}
                    {row.in > 0 && (
                      <>
                        In <Money paise={row.in} whole />
                      </>
                    )}
                  </span>
                </div>
              ))}
              <span className="cap">Left out of spending. Tap a category on a transaction to move it.</span>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="tx-h">
        <div className="cf-sec">
          <h2 id="tx-h">{selected === null ? 'Recent' : `${selected} transactions`}</h2>
        </div>
        {transactions.length === 0 ? (
          <p className="muted" style={{ padding: '0 4px' }}>
            No spending in this category.
          </p>
        ) : (
          <div className="cf-card cf-list" data-testid="txn-list">
            {groups.map((group) => (
              <div key={group.date}>
                <div className="cf-day">{dayLabel(group.date)}</div>
                <ul>
                  {group.items.map((txn) => (
                    <TxnItem key={txn.id} txn={txn} onCategory={setEditing} excluded={isNotSpending(txn, excluded)} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      {editing !== null && <CategorySheet txn={editing} onClose={() => setEditing(null)} />}
      {showRules && <RulesSheet onClose={() => setShowRules(false)} />}
    </>
  );
}
