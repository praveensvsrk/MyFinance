import { useState } from 'react';
import type { YearMoney, YearView } from '../../services/financialYear';
import { addDays, fyStart } from '../../domain/dates';
import { useApp } from '../AppContext';
import { Empty, ScreenSkeleton } from '../common/Empty';
import { dateLong, fyLabel, pct } from '../format';
import { Icon } from '../Icon';
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

  const nav = (
    <div className="month-nav">
      <button type="button" className="ib" aria-label="Previous year" onClick={() => setFy((value) => value - 1)}>
        <Icon name="prev" />
      </button>
      <h2 aria-live="polite">{fyLabel(fy)}</h2>
      <button type="button" className="ib" aria-label="Next year" disabled={fy >= currentFy} onClick={() => setFy((value) => value + 1)}>
        <Icon name="chevron" />
      </button>
    </div>
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
      <p className="muted" style={{ margin: '4px 4px 0' }}>
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
      <section className="card" aria-label="Summary" style={{ marginTop: 12 }}>
        <div className="stats c3">
          <div className="stat">
            <span className="lab">Income</span>
            <span className="val">
              <Money paise={current.income} compact />
            </span>
          </div>
          <div className="stat">
            <span className="lab">Spent</span>
            <span className="val">
              <Money paise={current.spending} compact />
            </span>
          </div>
          <div className="stat">
            <span className="lab">Saved</span>
            <span className="val">{pct(savedPct(current), 0)}</span>
          </div>
        </div>
        <div className="row-between" style={{ marginTop: 12 }}>
          <span className="muted">{saved >= 0 ? 'Left over' : 'Overspent by'}</span>
          <b className={saved >= 0 ? 'res-ok' : 'res-bad'}>
            <Money paise={Math.abs(saved)} whole />
          </b>
        </div>
        {compare && (
          <span className="cap">
            {dateLong(data.previousFrom)} – {dateLong(data.previousTo)}: income <Money paise={previous.income} compact />, spent{' '}
            <Money paise={previous.spending} compact />.
          </span>
        )}
        {current.loan.interest > 0 && (
          <span className="cap">
            Home-loan interest charged: <Money paise={current.loan.interest} whole />. It is part of Spent when the EMI left your bank.
          </span>
        )}
      </section>

      {showWorth && (
        <section className="card" aria-label="Net worth">
          <h2 className="t-title" style={{ marginBottom: 8 }}>
            Net worth
          </h2>
          <div className="kv">
            <span className="k">On {dateLong(addDays(data.from, -1))}</span>
            <span className="v">
              <Money paise={data.netWorth.opening} compact />
            </span>
          </div>
          <div className="kv">
            <span className="k">On {dateLong(data.to)}</span>
            <span className="v">
              <Money paise={data.netWorth.closing} compact />
            </span>
          </div>
          <div className="kv">
            <span className="k">Change</span>
            <span className="v">
              <Money paise={data.netWorth.closing - data.netWorth.opening} compact sign />
            </span>
          </div>
        </section>
      )}

      {data.categories.length > 0 && (
        <section className="card" aria-labelledby="year-cat">
          <h2 id="year-cat" className="t-title" style={{ marginBottom: 8 }}>
            Where it went
          </h2>
          {data.categories.map((row) => (
            <div key={row.category} className="cb">
              <span className="l">
                <span>
                  {row.category}
                  <span className="p">{current.spending > 0 && row.amount > 0 ? `${Math.round((row.amount / current.spending) * 100)}%` : ''}</span>
                </span>
                <b className="num">
                  <Money paise={row.amount} whole />
                </b>
              </span>
              <span className="t">
                <i style={{ width: `${biggest > 0 ? (row.amount / biggest) * 100 : 0}%` }} />
              </span>
              {row.previous > 0 && (
                <span className="sub">
                  Last year <Money paise={row.previous} whole />
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {putAway.length > 0 && (
        <section className="card" aria-labelledby="year-away">
          <h2 id="year-away" className="t-title" style={{ marginBottom: 4 }}>
            Put away
          </h2>
          {putAway.map((row) => (
            <div key={row.label} className="kv">
              <span className="k">
                {row.label}
                {row.previous > 0 && (
                  <>
                    <br />
                    <span className="sub">
                      Last year <Money paise={row.previous} whole />
                    </span>
                  </>
                )}
              </span>
              <span className="v">
                <Money paise={row.amount} whole />
              </span>
            </div>
          ))}
          {(current.epf.employee > 0 || current.epf.employer > 0) && (
            <span className="cap">EPF is on top of take-home pay. It does not pass through the bank.</span>
          )}
        </section>
      )}
    </>
  );
}
