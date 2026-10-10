import { useMemo, useState } from 'react';
import { fyStart } from '../../domain/dates';
import { projectPpf } from '../../domain/projections';
import type { PlanDefaults } from '../../services/actions/settings';
import type { Paise } from '../../parsers/types';
import { useApp } from '../AppContext';
import { parseRupees } from '../common/amount';
import { Field } from '../common/Field';
import { fyLabel, pct } from '../format';
import { Money } from '../Money';

const PPF_CAP: Paise = 15_000_000;
const EXTENSIONS = [0, 1, 2];

/** PPF to maturity: year-by-year contribution, interest and balance. */
export function PpfProjection({
  balance,
  firstFy,
  defaults,
}: {
  balance: Paise;
  firstFy: number | null;
  defaults: PlanDefaults;
}) {
  const { today } = useApp();
  const [yearly, setYearly] = useState(String((defaults.ppfYearly ?? PPF_CAP) / 100));
  const [extensions, setExtensions] = useState(0);
  const yearlyPaise = parseRupees(yearly);
  const openingFy = defaults.ppfOpeningFy ?? firstFy ?? fyStart(today);

  const rows = useMemo(
    () =>
      yearlyPaise === null
        ? []
        : projectPpf({
            balance,
            asOf: today,
            openingFy,
            ratePct: defaults.ppfRatePct,
            yearlyContribution: yearlyPaise,
            extensions,
          }),
    [balance, today, openingFy, defaults.ppfRatePct, yearlyPaise, extensions],
  );
  const final = rows[rows.length - 1];
  const capped = yearlyPaise !== null && yearlyPaise > PPF_CAP;

  return (
    <div className="proj-body">
      <span className="sub">
        <Money paise={balance} compact /> today at {pct(defaults.ppfRatePct, 2)}. Opened in {fyLabel(openingFy)}.
      </span>
      <div style={{ marginTop: 16 }} className="stack gap12">
        <Field
          id="ppf-yearly"
          label="Deposit each year"
          prefix="₹"
          rupees
          value={yearly}
          onChange={setYearly}
          error={yearlyPaise === null ? 'Enter an amount in rupees' : undefined}
          hint={capped ? 'Only ₹1,50,000 a year counts. The projection caps it.' : 'The yearly limit is ₹1,50,000.'}
        />
        <div className="field">
          <span className="fl">Extend after maturity</span>
          <div className="seg block" role="group" aria-label="Extend after maturity">
            {EXTENSIONS.map((count) => (
              <button key={count} type="button" className={count === extensions ? 'on' : ''} aria-pressed={count === extensions} onClick={() => setExtensions(count)}>
                {count === 0 ? 'No' : `${count * 5} yr`}
              </button>
            ))}
          </div>
        </div>
      </div>
      {final === undefined ? (
        <div className="note" style={{ marginTop: 12 }}>
          This account has already matured. Extend it above to see more years.
        </div>
      ) : (
        <>
          <div className="stats c2" style={{ marginTop: 16 }} role="status" aria-label="Result">
            <div className="stat">
              <span className="lab">Balance at the end of {fyLabel(final.fy)}</span>
              <span className="val lg">
                <Money paise={final.closing} compact />
              </span>
            </div>
            <div className="stat">
              <span className="lab">Interest earned</span>
              <span className="val lg res-ok">
                <Money paise={rows.reduce((sum, row) => sum + row.interest, 0)} compact />
              </span>
            </div>
          </div>
          <details style={{ marginTop: 12 }}>
            <summary className="link">Year by year</summary>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Year</th>
                    <th scope="col">Deposit</th>
                    <th scope="col">Interest</th>
                    <th scope="col">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.fy}>
                      <td>{fyLabel(row.fy)}</td>
                      <td><Money paise={row.contribution} compact /></td>
                      <td><Money paise={row.interest} compact /></td>
                      <td><Money paise={row.closing} compact /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
