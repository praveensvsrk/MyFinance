import { useId, useState, type ReactNode } from 'react';
import { formatInr } from '../../domain/money';
import type { IsoDate, Paise } from '../../parsers/types';
import { useApp } from '../AppContext';
import { ChartScrub } from './ChartScrub';
import { trendShape, VIEW_H, VIEW_W, type TrendPoint } from './trendGeometry';

export type ChartRange = '1M' | '6M' | '1Y' | '3Y' | 'All';
export const CHART_RANGES: ChartRange[] = ['1M', '6M', '1Y', '3Y', 'All'];
const MONTHS: Record<ChartRange, number | null> = { '1M': 1, '6M': 6, '1Y': 12, '3Y': 36, All: null };
const MAX_POINTS = 60;

/** At most `MAX_POINTS` evenly spread points, always keeping the first and the last. */
export function thin<T>(rows: T[]): T[] {
  if (rows.length <= MAX_POINTS) return rows;
  const step = (rows.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, i) => rows[Math.round(i * step)]);
}

/** The date `months` months before `date` (same day, clamped to that month's length). */
function monthsBack(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as IsoDate;
}

/** Points within the range, counted back from the latest; at least the last two when the range holds fewer. */
export function sliceChartRange<T extends { date: IsoDate }>(points: T[], range: ChartRange): T[] {
  const months = MONTHS[range];
  if (months === null || points.length < 2) return points;
  const cutoff = monthsBack(points[points.length - 1].date, months);
  const inRange = points.filter((point) => point.date >= cutoff);
  return inRange.length >= 2 ? inRange : points.slice(-2);
}

/**
 * The one value-over-time chart: area + line with axis labels, last value, touch scrub and the
 * 1M–All range row. Optional extras: vest markers and a dashed reference line (money invested).
 * Colours come from --chart-* tokens, so a dark card restyles it by overriding them.
 */
export function TrendChart({
  points,
  label,
  loading = false,
  vestDates = [],
  reference,
  referenceLabel,
  initialRange = '1Y',
  testId,
}: {
  points: TrendPoint[];
  /** Accessible description; defaults to the net-worth caption. */
  label?: string;
  loading?: boolean;
  vestDates?: IsoDate[];
  /** Draws a dashed line at this value. */
  reference?: Paise;
  referenceLabel?: string;
  initialRange?: ChartRange;
  testId?: string;
}) {
  const { hideAmounts } = useApp();
  const [range, setRange] = useState<ChartRange>(initialRange);
  const gradient = useId();
  const shown = thin(sliceChartRange(points, range));
  const shape = trendShape(shown, vestDates, hideAmounts, reference);

  let legend: ReactNode = null;
  if (shape !== null && shape.markers.length > 0) {
    legend = (
      <span className="tc-legend">
        <span className="tc-ring" aria-hidden="true" />
        RSU vest
      </span>
    );
  } else if (reference !== undefined && referenceLabel !== undefined) {
    legend = (
      <span className="tc-legend">
        <i className="tc-dash" aria-hidden="true" />
        {referenceLabel}
      </span>
    );
  }

  return (
    <div className="tc">
      {loading ? (
        <div className="sk tc-sk" aria-hidden="true" />
      ) : shape === null ? null : (
        <svg
          className="chart"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={label ?? shape.caption}
          data-testid={testId}
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--chart-1)" stopOpacity=".22" />
              <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {hideAmounts ? (
            <line x1="0" x2={VIEW_W} y1={shape.baseline} y2={shape.baseline} stroke="var(--chart-grid)" strokeWidth="1" />
          ) : (
            // The lowest gridline stays unlabelled: the line usually starts there and would cover its label.
            shape.grid.map((line, index) => (
              <g key={line.y}>
                <line x1="0" x2={VIEW_W} y1={line.y} y2={line.y} stroke="var(--chart-grid)" strokeWidth="1" />
                {index < shape.grid.length - 1 && (
                  <text className="ax" x="0" y={line.y - 4}>
                    {line.label}
                  </text>
                )}
              </g>
            ))
          )}
          {shape.xLabels.map((tick) => (
            <text key={tick.x} className="ax" x={tick.x} y={shape.labelY} textAnchor={tick.anchor}>
              {tick.text}
            </text>
          ))}
          <path d={shape.area} fill={`url(#${gradient})`} />
          {shape.referenceY !== undefined && (
            <line
              x1="0"
              x2={VIEW_W}
              y1={shape.referenceY}
              y2={shape.referenceY}
              stroke="var(--chart-axis)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          )}
          <path d={shape.line} fill="none" stroke="var(--chart-1)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {shape.markers.map((marker) => (
            <g key={marker.x}>
              <line x1={marker.x} x2={marker.x} y1={marker.y - 6} y2={marker.y - 14} stroke="var(--chart-axis)" strokeWidth="1" />
              <circle cx={marker.x} cy={marker.y} r="4" fill="var(--surface)" stroke="var(--chart-1)" strokeWidth="2" />
              <text className="mk" x={marker.x} y={marker.y - 17} textAnchor="middle">
                Vest
              </text>
            </g>
          ))}
          <circle cx={shape.last.x} cy={shape.last.y} r="4.5" fill="var(--chart-1)" stroke="var(--surface)" strokeWidth="2" />
          {!hideAmounts && (
            <text className="val" x={shape.last.x - 8} y={shape.last.y - 10} textAnchor="end">
              {formatInr(shown[shown.length - 1].total, { compact: true })}
            </text>
          )}
          <ChartScrub points={shown} xy={shape.xy} hidden={hideAmounts} />
        </svg>
      )}
      <div className="tc-foot">
        <div className="tc-ranges" role="group" aria-label="Range">
          {CHART_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              className={value === range ? 'on' : undefined}
              aria-pressed={value === range}
              onClick={() => setRange(value)}
            >
              {value}
            </button>
          ))}
        </div>
        {legend}
      </div>
      {!loading && label === undefined && <span className="sr">{shape?.caption ?? 'Not enough history yet.'}</span>}
    </div>
  );
}
