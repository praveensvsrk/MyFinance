import { useId } from 'react';
import type { IsoDate, Paise } from '../../parsers/types';
import { thin } from '../common/HistoryChart';

const W = 350;
const H = 120;
const PAD_Y = 12;

/** A value-over-time area chart with an optional dashed reference line (what was put in). Shape only; no figures. */
export function ValueChart({
  points,
  invested,
  label,
}: {
  points: { date: IsoDate; balance: Paise }[];
  invested?: Paise;
  label: string;
}) {
  const gradient = useId();
  const series = thin(points);
  if (series.length < 2) return null;
  const values = series.map((point) => point.balance);
  const all = invested === undefined ? values : [...values, invested];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const y = (value: number) => PAD_Y + (1 - (value - min) / span) * (H - 2 * PAD_Y);
  const x = (index: number) => 4 + (index / (series.length - 1)) * (W - 12);
  const line = series.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(point.balance).toFixed(1)}`).join(' ');
  const lastX = x(series.length - 1);
  const lastY = y(values[values.length - 1]);
  return (
    <svg className="vchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--good)" stopOpacity=".12" />
          <stop offset="1" stopColor="var(--good)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[30, 70, 110].map((line) => (
        <line key={line} x1="0" x2={W} y1={line} y2={line} stroke="var(--line-soft)" />
      ))}
      <path d={`${line} L${lastX.toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`} fill={`url(#${gradient})`} />
      <path d={line} fill="none" stroke="var(--good)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {invested !== undefined && (
        <line x1="0" x2={W} y1={y(invested)} y2={y(invested)} stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 4" />
      )}
      <circle cx={lastX} cy={lastY} r="4.5" fill="var(--good)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}
