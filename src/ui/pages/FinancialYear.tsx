import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../styles/cashflow.css';
import type { YearMoney, YearView } from '../../services/financialYear';
import { addDays, fyStart } from '../../domain/dates';
import { useApp } from '../AppContext';
import { CatTile } from '../common/CatTile';
import { Empty, ScreenSkeleton } from '../common/Empty';
import { dateLong, fyLabel, pct } from '../format';
import { useYear } from '../hooks';
import { Money } from '../Money';

function active(money: YearMoney): boolean {
  return (
    money.income !== 0 ||
    money.spending !== 0 ||
    money.invested.ppf !== 0 ||
    money.invested.other !== 0 ||
    money.epf.employee !== 0 ||
    money.epf.employer !== 0 ||
    money.loan.interest !== 0 ||
    money.loan.principal !== 0
  );
}

function savedPct(money: YearMoney): number | null {
  if (money.income <= 0) return null;
  return Math.round(((money.income - money.spending) / money.income) * 100);
}

/** April–March income, spending, investments and the net-worth change, beside the same dates last year. */
export function FinancialYear() {
  const { today } = useApp();
  const currentFy = fyStart(today);
  const [fy, setFy] = useState(currentFy);
  const view = useYear(fy);
  const data = view.data;

  const years = Array.from({ length: 6 }, (_, i) => currentFy - 5 + i);
  if (!years.includes(fy)) years.unshift(fy);
  const nav = (
    <>
      <div className="cf-seg" role="group" aria-label="Period">
        <Link to="/cash-flow">Month</Link>
        <span className="on" aria-current="true">
          Financial year
        </span>
      </div>
      <h2 className="sr" aria-live="polite">
        {fyLabel(fy)}
      </h2>
      <div className="cf-months" role="group" aria-label="Financial year">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            className={y === fy ? 'cf-mo on' : 'cf-mo'}
            aria-pressed={y === fy}
            aria-label={fyLabel(y)}
            ref={y === fy ? (el) => el?.scrollIntoView?.({ inline: 'center', block: 'nearest' }) : undefined}
            onClick={() => setFy(y)}
          >
            {y === fy ? fyLabel(y) : `${y}-${String((y + 1) % 100).padStart(2, '0')}`}
          </button>
        ))}
      </div>
    </>
  );

  if (data === undefined) {
    return (
      <>
        {nav}
        <ScreenSkeleton heights={[80, 120, 200]} />
      </>
    );
  }

  const quiet =
    !active(data.current) && !active(data.previous) && data.netWorth.opening === 0 && data.netWorth.closing === 0;

  return (
    <>
      {nav}
      <p className="muted" style={{ margin: '0 4px' }}>
        {dateLong(data.from)} – {dateLong(data.to)}
        {data.partial ? ' · so far' : ''}
      </p>
      {quiet ? (
        <Empty icon="flow" title="Nothing for this year">
          Import a bank statement that covers these months to see income, spending and what you put away.
        </Empty>
      ) : (
        <YearBody data={data} />
      )}
    </>
  );
}

function YearBody({ data }: { data: YearView }) {
  const { current, previous } = data;
  const saved = current.income - current.spending;
  const compare = active(previous);
  const barMax = Math.max(current.income, current.spending, 1);
  const biggest = data.categories.reduce((max, row) => Math.max(max, row.amount), 0);
  const putAway = [
    { label: 'Mutual funds and other', amount: current.invested.other, previous: previous.invested.other },
    { label: 'PPF', amount: current.invested.ppf, previous: previous.invested.ppf },
    { label: 'EPF, your share', amount: current.epf.employee, previous: previous.epf.employee },
    { label: 'EPF, employer', amount: current.epf.employer, previous: previous.epf.employer },
    { label: 'Loan principal', amount: current.loan.principal, previous: previous.loan.principal },
  ].filter((row) => row.amount > 0 || row.previous > 0);
  const showWorth = data.netWorth.opening !== 0 || data.netWorth.closing !== 0;

  return (
    <>
      <section className="hero-dark" aria-label="Summary">
        <div className="hd-lab">{saved >= 0 ? 'Left over this year' : 'Overspent this year'}</div>
        <div className={`hd-amt ${saved >= 0 ? 'cf-gain' : 'cf-loss'}`}>
          <Money paise={saved} whole sign />
        </div>
        {savedPct(current) !== null && (
          <div className="hd-sub">
            You saved <b style={{ color: 'var(--hero-text)' }}>{pct(savedPct(current), 0)}</b> of what came in
          </div>
        )}
        <div className="cf-bars">
          <div>
            <div className="cf-bar-h">
              <span className="k">Income</span>
              <Money paise={current.income} compact />
            </div>
            <div className="cf-bar">
              <i style={{ width: `${(current.income / barMax) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="cf-bar-h">
              <span className="k">Spent</span>
              <Money paise={current.spending} compact />
            </div>
            <div className="cf-bar spent">
              <i style={{ width: `${(current.spending / barMax) * 100}%` }} />
            </div>
          </div>
        </div>
        {compare && (
          <div className="cf-note">
            {dateLong(data.previousFrom)} – {dateLong(data.previousTo)}: income <Money paise={previous.income} compact />, spent{' '}
            <Money paise={previous.spending} compact />.
          </div>
        )}
        {current.loan.interest > 0 && (
          <div className="cf-note">
            Home-loan interest charged: <Money paise={current.loan.interest} whole />. It is part of Spent when the EMI left your bank.
          </div>
        )}
      </section>

      {showWorth && (
        <section aria-labelledby="year-nw">
          <div className="cf-sec">
            <h2 id="year-nw">Net worth</h2>
          </div>
          <div className="cf-card">
            <div className="cf-yr-row">
              <span>On {dateLong(addDays(data.from, -1))}</span>
              <Money paise={data.netWorth.opening} compact />
            </div>
            <div className="cf-yr-row">
              <span>On {dateLong(data.to)}</span>
              <Money paise={data.netWorth.closing} compact />
            </div>
            <div className="cf-yr-row">
              <span>Change</span>
              <Money paise={data.netWorth.closing - data.netWorth.opening} compact sign />
            </div>
          </div>
        </section>
      )}

      {data.categories.length > 0 && (
        <section aria-labelledby="year-cat">
          <div className="cf-sec">
            <h2 id="year-cat">Expenses</h2>
            <span className="meta">{data.categories.length} categories</span>
          </div>
          <div className="cf-card">
            {data.categories.map((row) => (
              <div key={row.category} className="cf-cat">
                <CatTile name={row.category} />
                <span>
                  <span className="nm">{row.category}</span>
                  {row.previous > 0 && (
                    <span className="sb">
                      Last year <Money paise={row.previous} whole />
                    </span>
                  )}
                </span>
                <span className="en">
                  <Money paise={row.amount} whole />
                  <span className="p">{current.spending > 0 && row.amount > 0 ? `${Math.round((row.amount / current.spending) * 100)}%` : ''}</span>
                </span>
                <span className="bar">
                  <i style={{ width: `${biggest > 0 ? (row.amount / biggest) * 100 : 0}%` }} />
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {putAway.length > 0 && (
        <section aria-labelledby="year-away">
          <div className="cf-sec">
            <h2 id="year-away">Put away</h2>
          </div>
          <div className="cf-card">
            {putAway.map((row) => (
              <div key={row.label} className="cf-yr-row">
                <span>
                  {row.label}
                  {row.previous > 0 && (
                    <span className="sub">
                      Last year <Money paise={row.previous} whole />
                    </span>
                  )}
                </span>
                <Money paise={row.amount} whole />
              </div>
            ))}
            {(current.epf.employee > 0 || current.epf.employer > 0) && (
              <div className="cf-pad">EPF is on top of take-home pay. It does not pass through the bank.</div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
