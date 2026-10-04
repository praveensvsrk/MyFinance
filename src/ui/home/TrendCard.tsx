import { useId, useState } from 'react';
import { formatInr } from '../../domain/money';
import type { IsoDate } from '../../parsers/types';
import { useApp } from '../AppContext';
import { useTrend } from '../hooks';
import { ChartScrub } from '../common/ChartScrub';
import { trendShape, VIEW_H, VIEW_W } from './trendGeometry';

export type HeroRange = '1M' | '6M' | '1Y' | '3Y' | 'All';
export const HERO_RANGES: HeroRange[] = ['1M', '6M', '1Y', '3Y', 'All'];
const MONTHS: Record<HeroRange, number | null> = { '1M': 1, '6M': 6, '1Y': 12, '3Y': 36, All: null };

/** The last N month-ends (N + 1 points for 1M so there is a line); everything for All. */
export function sliceHeroRange<T>(points: T[], range: HeroRange): T[] {
  const months = MONTHS[range];
  if (months === null) return points;
  const count = months === 1 ? 2 : months;
  return points.length > count ? points.slice(points.length - count) : points;
}

/** Net worth by month-end on the dark hero (lime line), with vest markers; shape only while amounts are hidden. */
export function TrendCard({ vestDates }: { vestDates: IsoDate[] }) {
  const { hideAmounts } = useApp();
  const [range, setRange] = useState<HeroRange>('1Y');
  const trend = useTrend('All');
  const gradient = useId();
  const points = sliceHeroRange(trend.data ?? [], range);
  const shape = trendShape(points, vestDates, hideAmounts);

  return (
    <div className="hh-trend">
      {trend.loading ? (
        <div className="sk" style={{ width: '100%', height: 130 }} aria-hidden="true" />
      ) : shape === null ? null : (
        <svg
          className="chart"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={shape.caption}
          data-testid="trend-chart"
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--chart-1)" stopOpacity=".22" />
              <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {hideAmounts ? (
            <line x1="0" x2="296" y1={shape.baseline} y2={shape.baseline} stroke="var(--chart-grid)" strokeWidth="1" />
          ) : (
            shape.grid.map((line) => (
              <g key={line.y}>
                <line x1="0" x2="296" y1={line.y} y2={line.y} stroke="var(--chart-grid)" strokeWidth="1" />
                <text className="ax" x="0" y={line.y - 4}>
                  {line.label}
                </text>
              </g>
            ))
          )}
          {shape.xLabels.map((label) => (
            <text key={label.x} className="ax" x={label.x} y={shape.labelY} textAnchor={label.anchor}>
              {label.text}
            </text>
          ))}
          <path d={shape.area} fill={`url(#${gradient})`} />
          <path
            d={shape.line}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
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
              {formatInr(points[points.length - 1].total, { compact: true })}
            </text>
          )}
          <ChartScrub points={points} xy={shape.xy} hidden={hideAmounts} />
        </svg>
      )}
      <div className="hh-range-row">
        <div className="hh-range" role="group" aria-label="Range">
          {HERO_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              className={`rng${value === range ? ' on' : ''}`}
              aria-pressed={value === range}
              onClick={() => setRange(value)}
            >
              {value}
            </button>
          ))}
        </div>
        {shape !== null && shape.markers.length > 0 && (
          <span className="hh-legend">
            <span className="hh-ring" aria-hidden="true" />
            RSU vest
          </span>
        )}
      </div>
      {!trend.loading && <span className="sr">{shape?.caption ?? 'Not enough history yet.'}</span>}
    </div>
  );
}
