import { Link } from 'react-router-dom';
import type { HomeSummary } from '../../services/dashboard';
import { monthLabel, pct } from '../format';
import { Money } from '../Money';
import { useApp } from '../AppContext';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "<Month> so far": In / Out / Saved, the spent share and what is left over; opens Cash flow. */
export function ThisMonth({ data }: { data: HomeSummary['thisMonth'] }) {
  const { today } = useApp();
  if (data.income === 0 && data.spending === 0) return null;
  const name = MONTH_NAMES[Number(today.slice(5, 7)) - 1] ?? monthLabel(today.slice(0, 7));
  const spentPct = data.income > 0 ? Math.min(100, Math.round((data.spending / data.income) * 100)) : 100;
  const left = data.income - data.spending;

  return (
    <section aria-labelledby="tm-h">
      <div className="sec">
        <h2 id="tm-h">{name} so far</h2>
        <Link to="/cash-flow" className="link">
          Cash flow
        </Link>
      </div>
      <Link to="/cash-flow" className="card home-month" aria-label="This month, open Cash flow">
        <div className="hm-grid">
          <div>
            <div className="hm-k">In</div>
            <div className="hm-v">
              <Money paise={data.income} compact />
            </div>
          </div>
          <div>
            <div className="hm-k">Out</div>
            <div className="hm-v">
              <Money paise={data.spending} compact />
            </div>
          </div>
          <div>
            <div className="hm-k">Saved</div>
            <div className="hm-v hm-good">{pct(data.savingsRatePct === null ? null : Math.round(data.savingsRatePct), 0)}</div>
          </div>
        </div>
        <div className="hm-bar" aria-hidden="true">
          <i style={{ width: `${spentPct}%` }} />
        </div>
        <div className="hm-foot">
          <span>Spent {spentPct}%</span>
          <span>
            {left >= 0 ? (
              <>
                <Money paise={left} whole /> left over
              </>
            ) : (
              <>
                <Money paise={-left} whole /> over income
              </>
            )}
          </span>
        </div>
      </Link>
    </section>
  );
}
