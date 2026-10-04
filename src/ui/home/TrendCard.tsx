import type { IsoDate } from '../../parsers/types';
import { TrendChart } from '../charts/TrendChart';
import { useTrend } from '../hooks';

/** Net worth by month-end on the dark hero, with vest markers (the shared TrendChart, lime via home.css). */
export function TrendCard({ vestDates }: { vestDates: IsoDate[] }) {
  const trend = useTrend('All');
  return (
    <div className="hh-trend">
      <TrendChart points={trend.data ?? []} loading={trend.loading} vestDates={vestDates} testId="trend-chart" />
    </div>
  );
}
