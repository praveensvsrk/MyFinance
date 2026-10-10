import { useState } from 'react';
import type { PlanDefaults } from '../../services/actions/settings';
import { useActions } from '../actions';
import { parseNumber, parseRupees, rupeesText } from '../common/amount';
import { Field } from '../common/Field';

const text = (value: number | undefined): string => (value === undefined ? '' : String(value));

/** The rates and ages every projection starts from; blank fields fall back to what the app works out. */
export function Assumptions({ defaults }: { defaults: PlanDefaults }) {
  const actions = useActions();
  const [ppfRate, setPpfRate] = useState(String(defaults.ppfRatePct));
  const [epfRate, setEpfRate] = useState(String(defaults.epfRatePct));
  const [age, setAge] = useState(text(defaults.currentAge));
  const [retire, setRetire] = useState(String(defaults.retirementAge));
  const [epfMonthly, setEpfMonthly] = useState(defaults.epfMonthly === undefined ? '' : rupeesText(defaults.epfMonthly));
  const [ppfYearly, setPpfYearly] = useState(defaults.ppfYearly === undefined ? '' : rupeesText(defaults.ppfYearly));
  const [ppfFy, setPpfFy] = useState(text(defaults.ppfOpeningFy));
  const [loanRate, setLoanRate] = useState(text(defaults.loanRateOverridePct));
  const [saved, setSaved] = useState(false);

  const ppfRateN = parseNumber(ppfRate);
  const epfRateN = parseNumber(epfRate);
  const retireN = parseNumber(retire);
  const ageN = age.trim() === '' ? undefined : parseNumber(age);
  const loanN = loanRate.trim() === '' ? undefined : parseNumber(loanRate);
  const monthlyN = epfMonthly.trim() === '' ? undefined : parseRupees(epfMonthly);
  const yearlyN = ppfYearly.trim() === '' ? undefined : parseRupees(ppfYearly);
  const fyN = ppfFy.trim() === '' ? undefined : parseNumber(ppfFy);

  const errors = {
    ppfRate: ppfRateN === null ? 'Enter a rate, like 7.1' : undefined,
    epfRate: epfRateN === null ? 'Enter a rate, like 8.25' : undefined,
    retire: retireN === null ? 'Enter an age' : undefined,
    age: ageN === null ? 'Enter your age in years' : undefined,
    loanRate: loanN === null ? 'Enter a rate, like 8.5' : undefined,
    epfMonthly: monthlyN === null ? 'Enter an amount in rupees' : undefined,
    ppfYearly: yearlyN === null ? 'Enter an amount in rupees' : undefined,
    ppfFy: fyN === null || (fyN !== undefined && fyN < 1968) ? 'Enter the year, like 2015' : undefined,
  };
  const valid = Object.values(errors).every((error) => error === undefined);

  async function save() {
    if (!valid || ppfRateN === null || epfRateN === null || retireN === null) return;
    const next: PlanDefaults = { ppfRatePct: ppfRateN, epfRatePct: epfRateN, retirementAge: retireN };
    if (ageN !== undefined && ageN !== null) next.currentAge = ageN;
    if (monthlyN !== undefined && monthlyN !== null) next.epfMonthly = monthlyN;
    if (yearlyN !== undefined && yearlyN !== null) next.ppfYearly = yearlyN;
    if (fyN !== undefined && fyN !== null) next.ppfOpeningFy = fyN;
    if (loanN !== undefined && loanN !== null) next.loanRateOverridePct = loanN;
    await actions.savePlanDefaults(next);
    setSaved(true);
  }

  const touch = (set: (value: string) => void) => (value: string) => {
    set(value);
    setSaved(false);
  };

  return (
    <div className="proj-body">
      <form
        className="stack gap16"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="stats c2">
          <Field id="as-age" label="Your age" inputMode="numeric" value={age} onChange={touch(setAge)} error={errors.age} />
          <Field id="as-retire" label="Retire at" inputMode="numeric" value={retire} onChange={touch(setRetire)} error={errors.retire} />
        </div>
        <div className="stats c2">
          <Field id="as-epf-rate" label="EPF rate" suffix="%" inputMode="decimal" value={epfRate} onChange={touch(setEpfRate)} error={errors.epfRate} />
          <Field id="as-ppf-rate" label="PPF rate" suffix="%" inputMode="decimal" value={ppfRate} onChange={touch(setPpfRate)} error={errors.ppfRate} />
        </div>
        <Field id="as-epf-monthly" label="EPF each month" prefix="₹" rupees value={epfMonthly} onChange={touch(setEpfMonthly)} error={errors.epfMonthly} hint="Blank uses the average of your last six months." />
        <Field id="as-ppf-yearly" label="PPF each year" prefix="₹" rupees value={ppfYearly} onChange={touch(setPpfYearly)} error={errors.ppfYearly} hint="Blank uses the ₹1,50,000 limit." />
        <Field id="as-ppf-fy" label="PPF opened in the year" inputMode="numeric" value={ppfFy} onChange={touch(setPpfFy)} error={errors.ppfFy} hint="Blank uses your earliest statement." />
        <Field id="as-loan-rate" label="Home loan rate" suffix="%" inputMode="decimal" value={loanRate} onChange={touch(setLoanRate)} error={errors.loanRate} hint="Blank uses the rate in your statements." />
        <button type="submit" className={valid ? 'btn block fill' : 'btn block dis'} disabled={!valid}>
          Save assumptions
        </button>
        {saved && (
          <span role="status" className="hint">
            Saved.
          </span>
        )}
      </form>
    </div>
  );
}
