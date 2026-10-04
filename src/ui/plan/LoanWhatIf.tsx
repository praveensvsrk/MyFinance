import { useMemo, useState } from 'react';
import { daysBetween } from '../../domain/dates';
import { whatIf, type AmortMode } from '../../domain/loanPlan';
import type { LoanSummary } from '../../services/dashboard';
import { useApp } from '../AppContext';
import { durationText, monthLabel, pct } from '../format';
import { Money } from '../Money';

const PRESETS = [0, 5_000, 10_000, 25_000];
const MODES: { value: AmortMode; label: string }[] = [
  { value: 'reduce-tenure', label: 'Shorter loan' },
  { value: 'reduce-emi', label: 'Lower EMI' },
];

/** What extra payments would do to the loan: interest saved and months cut. */
export function LoanWhatIf({ loan, rateOverride }: { loan: LoanSummary; rateOverride?: number }) {
  const { today } = useApp();
  const [extra, setExtra] = useState(10_000);
  const [lump, setLump] = useState(0);
  const [other, setOther] = useState(false);
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

  const ok = result !== null && typeof result !== 'string' ? result : null;
  const baseDays = ok === null ? 0 : Math.max(1, daysBetween(today, ok.baseline.endDate));
  const planPct = ok === null ? 100 : Math.max(2, Math.min(100, (daysBetween(today, ok.scenario.endDate) / baseDays) * 100));

  return (
    <section aria-labelledby="loan-plan-h">
      <div className="sec">
        <h2 id="loan-plan-h">Pay off home loan sooner</h2>
      </div>
      {ok === null ? (
        <div className="card">
          <div className="mono plan-owed">
            <Money paise={outstanding} compact /> owed{rate !== null && ` · ${pct(rate, 2)}`}
          </div>
          <div className="note warn" style={{ marginTop: 12 }}>
            {result === null
              ? 'The rate or EMI is unknown. Import the loan statement, or enter a rate under Assumptions.'
              : 'The EMI does not cover the monthly interest at this rate, so a schedule cannot be worked out. Check the rate under Assumptions.'}
          </div>
        </div>
      ) : (
        <>
          <div className="loan-top" role="status" aria-label="Result">
            <div className="lt-k">Debt-free by</div>
            <div className="lt-date">{monthLabel(ok.scenario.endDate.slice(0, 7))}</div>
            <div className="lt-sub">
              {ok.monthsSaved > 0 ? <b>{durationText(ok.monthsSaved)} sooner</b> : <b>No time saved yet</b>} than{' '}
              {monthLabel(ok.baseline.endDate.slice(0, 7))}
            </div>
            <div className="lt-bars" aria-hidden="true">
              <div>
                <span>Now</span>
                <i className="bar base" />
              </div>
              <div>
                <span>With plan</span>
                <i className="track">
                  <i className="bar plan" style={{ width: `${planPct}%` }} />
                </i>
              </div>
            </div>
            <div className="lt-grid">
              <div>
                <div className="lt-k">Interest saved</div>
                <div className="mono lt-v good">
                  <Money paise={ok.interestSaved} compact />
                </div>
              </div>
              <div>
                <div className="lt-k">Interest left</div>
                <div className="mono lt-v">
                  <Money paise={ok.scenario.totalInterest} compact />
                </div>
              </div>
            </div>
          </div>
          <div className="loan-bottom">
            <div className="mono plan-owed">
              <Money paise={outstanding} compact /> owed · {pct(rate ?? 0, 2)} · EMI <Money paise={emi ?? 0} />
            </div>
            <div>
              <div className="lb-row">
                <span id="extra-lab" className="lb-lab">
                  Extra every month
                </span>
                <span className="mono lb-val">₹{extra.toLocaleString('en-IN')}</span>
              </div>
              <div className="presets" role="group" aria-labelledby="extra-lab">
                {PRESETS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    className={!other && extra === amount ? 'on' : ''}
                    aria-pressed={!other && extra === amount}
                    onClick={() => {
                      setOther(false);
                      setExtra(amount);
                    }}
                  >
                    {amount === 0 ? '0' : `${amount / 1000}k`}
                  </button>
                ))}
                <button type="button" className={other ? 'on' : ''} aria-pressed={other} aria-label="Custom amount" style={{ fontFamily: 'var(--font)' }} onClick={() => setOther(true)}>
                  Other
                </button>
              </div>
              {other && (
                <div className="inp" style={{ marginTop: 8 }}>
                  <span className="mono">₹</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={10_000_000}
                    aria-label="Extra every month, custom amount"
                    value={extra === 0 ? '' : extra}
                    onChange={(e) => setExtra(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  />
                </div>
              )}
            </div>
            <div>
              <label htmlFor="lump-sum" className="lb-row">
                <span className="lb-lab">One-time payment now</span>
                <span className="mono lb-val">₹{lump.toLocaleString('en-IN')}</span>
              </label>
              <input id="lump-sum" className="rng" type="range" min={0} max={1_000_000} step={50_000} value={lump} onChange={(e) => setLump(Number(e.target.value))} />
              <div className="mono lb-scale">
                <span>₹0</span>
                <span>₹10L</span>
              </div>
            </div>
            <div>
              <div className="lb-lab" id="mode-lab" style={{ marginBottom: 8 }}>
                Use the savings for
              </div>
              <div className="seg block" role="group" aria-labelledby="mode-lab">
                {MODES.map((option) => (
                  <button key={option.value} type="button" className={option.value === mode ? 'on' : ''} aria-pressed={option.value === mode} onClick={() => setMode(option.value)}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {mode === 'reduce-emi' && extra === 0 && lump === 0 && (
              <span className="cap" style={{ marginTop: 0 }}>Lowering the EMI only matters once you make a one-time payment.</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
