import { Link } from 'react-router-dom';
import type { HomeSummary } from '../../services/dashboard';
import { Icon } from '../Icon';
import { monthLabel, pct } from '../format';
import { Money } from '../Money';
import { useApp } from '../AppContext';

/** This month's income, spending, savings rate and top categories; opens Cash flow. */
export function ThisMonth({ data }: { data: HomeSummary['thisMonth'] }) {
  const { today } = useApp();
  if (data.income === 0 && data.spending === 0) return null;
  const top = data.topCategories.slice(0, 3);
  const biggest = top[0]?.amount ?? 0;

  return (
    <Link to="/cash-flow" className="card" aria-label="This month, open Cash flow">
      <div className="row-between" style={{ marginBottom: 14 }}>
        <span>
          <h2 className="t-title">This month</h2>
          <span className="sub">{monthLabel(today.slice(0, 7))}</span>
        </span>
        <span className="chev">
          <Icon name="chevron" size={20} />
        </span>
      </div>
      <div className="stats c3">
        <div className="stat">
          <span className="lab">Income</span>
          <span className="val">
            <Money paise={data.income} whole />
          </span>
        </div>
        <div className="stat">
          <span className="lab">Spent</span>
          <span className="val">
            <Money paise={data.spending} whole />
          </span>
        </div>
        <div className="stat">
          <span className="lab">Saved</span>
          <span className="val">{pct(data.savingsRatePct === null ? null : Math.round(data.savingsRatePct), 0)}</span>
        </div>
      </div>
      {top.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {top.map((row) => (
            <div key={row.category} className="cb">
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
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
