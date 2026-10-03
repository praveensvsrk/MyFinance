import type { NetWorthRange } from '../../services/dashboard';
import type { IsoDate } from '../../parsers/types';

export const RANGES: NetWorthRange[] = ['12M', '3Y', 'All'];

/** The 12M / 3Y / All selector every time-series chart shares. */
export function RangeTabs({ range, onChange }: { range: NetWorthRange; onChange: (range: NetWorthRange) => void }) {
  return (
    <div className="seg" role="group" aria-label="Range">
      {RANGES.map((value) => (
        <button key={value} type="button" className={value === range ? 'on' : ''} aria-pressed={value === range} onClick={() => onChange(value)}>
          {value}
        </button>
      ))}
    </div>
  );
}

/** Points within the range, counted back from the latest point; the full series when that leaves under two. */
export function sliceRange<T extends { date: IsoDate }>(points: T[], range: NetWorthRange): T[] {
  if (range === 'All' || points.length === 0) return points;
  const last = points[points.length - 1].date;
  const years = range === '12M' ? 1 : 3;
  const cutoff = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`;
  const inRange = points.filter((point) => point.date >= cutoff);
  return inRange.length >= 2 ? inRange : points;
}
