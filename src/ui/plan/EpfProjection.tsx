import { useMemo } from 'react';
import { addMonths } from '../../domain/dates';
import { projectEpf } from '../../domain/projections';
import type { EpfSummary } from '../../services/dashboard';
import type { PlanDefaults } from '../../services/actions/settings';
import type { Paise } from '../../parsers/types';
import { useApp } from '../AppContext';
import { fyLabel, pct } from '../format';
import { Money } from '../Money';

/** The mean of the last six EE + ER contributions across all EPF accounts; 0 with none. */
export function recentMonthlyEpf(epf: EpfSummary): Paise {
  const recent = epf.accounts
    .flatMap((account) => account.contributions)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-6);
  if (recent.length === 0) return 0;
  return Math.round(recent.reduce((sum, row) => sum + row.ee + row.er, 0) / recent.length);
}

/** EPF at retirement, from today's balance and the usual monthly contribution. */
export function EpfProjection({ epf, defaults }: { epf: EpfSummary; defaults: PlanDefaults }) {
  const { today } = useApp();
  const balance = epf.totals.ee + epf.totals.er;
  const monthly = defaults.epfMonthly ?? recentMonthlyEpf(epf);
  const { currentAge, retirementAge, epfRatePct } = defaults;

  const retireDate =
    currentAge === undefined || retirementAge <= currentAge ? null : addMonths(today, Math.round((retirementAge - currentAge) * 12));
  const rows = useMemo(
    () =>
      retireDate === null
        ? []
        : projectEpf({ balance, asOf: today, ratePct: epfRatePct, monthlyContribution: monthly, retireDate }),
    [balance, today, epfRatePct, monthly, retireDate],
  );
  const final = rows[rows.length - 1];

  return (
    <section className="card" aria-labelledby="epf-plan-h">
      <h2 id="epf-plan-h" className="t-title">
        EPF at retirement
      </h2>
      <span className="sub">
        <Money paise={balance} compact /> today, adding <Money paise={monthly} compact /> a month at {pct(epfRatePct, 2)}.
      </span>
      {final === undefined ? (
        <div className="note" style={{ marginTop: 12 }}>
          {currentAge === undefined
            ? 'Add your age under Assumptions to see the balance at retirement.'
            : 'Your retirement age is not after your current age. Change it under Assumptions.'}
        </div>
      ) : (
        <>
          <div className="stats c2" style={{ marginTop: 16 }} role="status" aria-label="Result">
            <div className="stat">
              <span className="lab">At age {retirementAge}</span>
              <span className="val lg">
                <Money paise={final.closing} compact />
              </span>
            </div>
            <div className="stat">
              <span className="lab">Growth over today</span>
              <span className="val lg res-ok">
                <Money paise={final.closing - balance} compact />
              </span>
            </div>
          </div>
          <span className="cap">Pension (EPS) is not included. Contributions are assumed to stay the same.</span>
          <details style={{ marginTop: 12 }}>
            <summary className="link">Year by year</summary>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.fy}>
                    <td>{fyLabel(row.fy)}</td>
                    <td><Money paise={row.closing} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
