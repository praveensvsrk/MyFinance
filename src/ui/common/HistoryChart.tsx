import { useId } from 'react';
import { formatInr } from '../../domain/money';
import type { IsoDate, Paise } from '../../parsers/types';
import { useApp } from '../AppContext';
import { ChartScrub } from './ChartScrub';
import { trendShape, VIEW_H, VIEW_W } from '../home/trendGeometry';

const MAX_POINTS = 60;

/** At most `MAX_POINTS` evenly spread points, always keeping the first and the last. */
export function thin<T>(rows: T[]): T[] {
  if (rows.length <= MAX_POINTS) return rows;
  const step = (rows.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, i) => rows[Math.round(i * step)]);
}

/** A balance history as the design's area chart; shape only while amounts are hidden. */
export function HistoryChart({
  points,
  label,
}: {
  points: { date: IsoDate; balance: Paise }[];
  label: string;
}) {
  const { hideAmounts } = useApp();
  const gradient = useId();
  const series = thin(points).map((point) => ({ date: point.date, total: point.balance }));
  const shape = trendShape(series, [], hideAmounts);
  if (shape === null) return null;
  const last = series[series.length - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label}>
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
      {shape.xLabels.map((tick) => (
        <text key={tick.x} className="ax" x={tick.x} y={shape.labelY} textAnchor={tick.anchor}>
          {tick.text}
        </text>
      ))}
      <path d={shape.area} fill={`url(#${gradient})`} />
      <path d={shape.line} fill="none" stroke="var(--chart-1)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={shape.last.x} cy={shape.last.y} r="4.5" fill="var(--chart-1)" stroke="var(--surface)" strokeWidth="2" />
      {!hideAmounts && (
        <text className="val" x={shape.last.x - 8} y={shape.last.y - 10} textAnchor="end">
          {formatInr(last.total, { compact: true })}
        </text>
      )}
      <ChartScrub points={series} xy={shape.xy} hidden={hideAmounts} />
    </svg>
  );
}
