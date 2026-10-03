import { useMemo, useState } from 'react';
import { whatIf, type AmortMode } from '../../domain/loanPlan';
import type { LoanSummary } from '../../services/dashboard';
import { useApp } from '../AppContext';
import { dateLong, durationText, pct } from '../format';
import { Money } from '../Money';

const MODES: { value: AmortMode; label: string }[] = [
  { value: 'reduce-tenure', label: 'Shorter loan' },
  { value: 'reduce-emi', label: 'Lower EMI' },
];

/** What extra payments would do to the loan: interest saved and months cut. */
export function LoanWhatIf({ loan, rateOverride }: { loan: LoanSummary; rateOverride?: number }) {
  const { today } = useApp();
  const [extra, setExtra] = useState(0);
  const [lump, setLump] = useState(0);
  const [mode, setMode] = useState<AmortMode>('reduce-tenure');
  const outstanding = loan.outstandingHistory[loan.outstandingHistory.length - 1]?.outstanding ?? 0;
  const rate = rateOverride ?? loan.planningRate;
  const emi = loan.emi;

  const result = useMemo(() => {
    if (outstanding <= 0 || rate === null || emi === null) return null;
    const base = { outstanding, annualPct: rate, emi, start: today, mode };
    try {
      return whatIf(base, {
        ...base,
        extraMonthly: extra * 100,
        lumpSums: lump > 0 ? [{ date: today, amount: lump * 100 }] : [],
      });
    } catch (error) {
      return (error as Error).message;
    }
  }, [outstanding, rate, emi, today, mode, extra, lump]);

  if (outstanding <= 0) return null;

  return (
    <section className="card" aria-labelledby="loan-plan-h">
      <h2 id="loan-plan-h" className="t-title">
        Home loan: pay it off sooner
      </h2>
      <span className="sub">
        <Money paise={outstanding} compact /> owed{rate !== null && ` at ${pct(rate, 2)}`}
        {emi !== null && (
          <>
            , EMI <Money paise={emi} />
          </>
        )}
      </span>

      {typeof result === 'string' || result === null ? (
        <div className="note warn" style={{ marginTop: 12 }}>
          {result === null
            ? 'The rate or EMI is unknown. Import the loan statement, or enter a rate under Assumptions.'
            : 'The EMI does not cover the monthly interest at this rate, so a schedule cannot be worked out. Check the rate under Assumptions.'}
        </div>
      ) : (
        <>
          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="extra-monthly">
              Extra every month: <b>₹{extra.toLocaleString('en-IN')}</b>
            </label>
            <input id="extra-monthly" className="rng" type="range" min={0} max={50_000} step={1_000} value={extra} onChange={(e) => setExtra(Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="lump-sum">
              One-time payment now: <b>₹{lump.toLocaleString('en-IN')}</b>
            </label>
            <input id="lump-sum" className="rng" type="range" min={0} max={1_000_000} step={10_000} value={lump} onChange={(e) => setLump(Number(e.target.value))} />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <span className="fl">Use the savings to</span>
            <div className="seg block" role="group" aria-label="Use the savings to">
              {MODES.map((option) => (
                <button key={option.value} type="button" className={option.value === mode ? 'on' : ''} aria-pressed={option.value === mode} onClick={() => setMode(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="stats c2" role="status" aria-label="Result">
            <div className="stat">
              <span className="lab">Interest saved</span>
              <span className="val lg res-ok">
                <Money paise={result.interestSaved} compact />
              </span>
            </div>
            <div className="stat">
              <span className="lab">Time saved</span>
              <span className="val lg res-ok">{durationText(Math.max(0, result.monthsSaved))}</span>
            </div>
          </div>
          <div className="divider" style={{ margin: '12px 0 0' }} />
          <div className="kv">
            <span className="k">Debt-free</span>
            <span className="v">{dateLong(result.scenario.endDate)}</span>
          </div>
          <div className="kv">
            <span className="k">Without extra payments</span>
            <span className="v">{dateLong(result.baseline.endDate)}</span>
          </div>
          <div className="kv">
            <span className="k">Total interest left</span>
            <span className="v">
              <Money paise={result.scenario.totalInterest} compact />
            </span>
          </div>
          {mode === 'reduce-emi' && extra === 0 && lump === 0 && (
            <span className="cap">Lowering the EMI only matters once you make a one-time payment.</span>
          )}
        </>
      )}
    </section>
  );
}

