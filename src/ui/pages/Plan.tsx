import { Link } from 'react-router-dom';
import { Assumptions } from '../plan/Assumptions';
import { EpfProjection } from '../plan/EpfProjection';
import { GoalsSection } from '../plan/GoalsSection';
import { LoanWhatIf } from '../plan/LoanWhatIf';
import { PpfProjection } from '../plan/PpfProjection';
import { Empty, ScreenSkeleton } from '../common/Empty';
import { Icon } from '../Icon';
import { useAccounts, usePlanInputs } from '../hooks';

/** Goals, the home-loan what-if, PPF and EPF projections, and the assumptions behind them. */
export function Plan() {
  const plan = usePlanInputs();
  const accounts = useAccounts();
  if (plan.data === undefined || accounts.data === undefined) return <ScreenSkeleton heights={[150, 280, 240]} />;
  if (accounts.data.length === 0) {
    return (
      <Empty
        icon="plan"
        title="Plan needs your numbers"
        action={
          <Link to="/import" className="btn fill">
            <Icon name="import" size={20} />
            Import a statement
          </Link>
        }
      >
        Once you have accounts, you can set goals and see where your loan, PPF and EPF are heading.
      </Empty>
    );
  }
  const { loan, epf, goals, defaults, balances, ppfBalance, ppfFirstFy } = plan.data;

  return (
    <>
      <GoalsSection goals={goals} balances={balances} accounts={accounts.data} />
      <LoanWhatIf loan={loan} rateOverride={defaults.loanRateOverridePct} />
      {ppfBalance > 0 && <PpfProjection balance={ppfBalance} firstFy={ppfFirstFy} defaults={defaults} />}
      {epf.totals.ee + epf.totals.er > 0 && <EpfProjection epf={epf} defaults={defaults} />}
      <Assumptions defaults={defaults} />
    </>
  );
}
