import { useState } from 'react';
import { AttentionCard } from '../home/AttentionCard';
import { CalcSheet } from '../home/CalcSheet';
import { Composition } from '../home/Composition';
import { FirstRun } from '../home/FirstRun';
import { Hero } from '../home/Hero';
import { HomeSkeleton } from '../home/HomeSkeleton';
import { ThisMonth } from '../home/ThisMonth';
import { TrendCard } from '../home/TrendCard';
import { Upcoming } from '../home/Upcoming';
import { useApp } from '../AppContext';
import { Icon } from '../Icon';
import { dateShort } from '../format';
import { useAccounts, useHome, useLoan, useNetWorthBreakdown } from '../hooks';
import { useOnline } from '../useOnline';

export function Home() {
  const { hideAmounts } = useApp();
  const online = useOnline();
  const home = useHome();
  const accounts = useAccounts();
  const loan = useLoan();
  const breakdown = useNetWorthBreakdown();
  const [sheet, setSheet] = useState(false);

  if (home.data === undefined || accounts.data === undefined) return <HomeSkeleton />;
  if (accounts.data.length === 0) return <FirstRun />;

  const summary = home.data;
  const pricesAsOf = breakdown.data?.pricesAsOf ?? null;

  return (
    <>
      {!online && (
        <div className="offline" role="status">
          <Icon name="offline" size={16} />
          Offline{pricesAsOf === null ? '' : ` · prices as of ${dateShort(pricesAsOf)}`}
        </div>
      )}
      {hideAmounts && (
        <div className="offline" role="status">
          <Icon name="eyeOff" size={16} />
          Amounts hidden
        </div>
      )}
      <Hero netWorth={summary.netWorth} change={summary.change} asOf={summary.asOf} onOpen={() => setSheet(true)} />
      <AttentionCard items={summary.attention} />
      <Composition groups={summary.groups} unvested={summary.unvestedInr} onOpen={() => setSheet(true)} />
      <TrendCard vestDates={breakdown.data?.vestDates ?? []} />
      <ThisMonth data={summary.thisMonth} />
      <Upcoming data={summary.upcoming} emi={loan.data?.emi ?? null} accounts={accounts.data} />
      {sheet && (
        <CalcSheet
          breakdown={breakdown.data}
          netWorth={summary.netWorth}
          unvested={summary.unvestedInr}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  );
}
