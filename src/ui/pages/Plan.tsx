import { Link } from 'react-router-dom';
import '../styles/plan.css';
import { ProjectionRow } from '../plan/ProjectionRow';
import { Money } from '../Money';
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
  if (plan.data === undefined || accounts.data === undefined) return <ScreenSkeleton heights={[420, 200, 200]} />;
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

  const showPpf = ppfBalance > 0;
  const epfBalance = epf.totals.ee + epf.totals.er;
  const showEpf = epfBalance > 0;

  return (
    <>
      <LoanWhatIf loan={loan} rateOverride={defaults.loanRateOverridePct} />
      <section aria-labelledby="proj-h">
        <div className="sec">
          <h2 id="proj-h">Projections</h2>
        </div>
        <ul className="card proj-list">
          {showPpf && (
            <ProjectionRow badge="PPF" badgeClass="ppf" title="PPF to maturity" sub={<><Money paise={ppfBalance} compact /> today</>}>
              <PpfProjection balance={ppfBalance} firstFy={ppfFirstFy} defaults={defaults} />
            </ProjectionRow>
          )}
          {showEpf && (
            <ProjectionRow badge="EPF" badgeClass="epf" title="EPF at retirement" sub={<><Money paise={epfBalance} compact /> today</>}>
              <EpfProjection epf={epf} defaults={defaults} />
            </ProjectionRow>
          )}
          <ProjectionRow
            badge={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="10" cy="17" r="2" />
              </svg>
            }
            badgeClass="asm"
            title="Assumptions"
            sub="Returns, ages, loan rate"
          >
            <Assumptions defaults={defaults} />
          </ProjectionRow>
        </ul>
      </section>
      <GoalsSection goals={goals} balances={balances} accounts={accounts.data} />
    </>
  );
}
