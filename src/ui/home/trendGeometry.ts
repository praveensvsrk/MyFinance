/**
 * Geometry for the Home net-worth trend (hand-drawn SVG, per the design). Pure, so the shapes can be
 * tested without a DOM. Coordinates are in the chart's 296 × 150 viewBox; the plot ends at x = 290
 * so the last point and its label stay inside.
 */

import type { IsoDate, Paise } from '../../parsers/types';
import { daysBetween } from '../../domain/dates';
import { formatInr } from '../../domain/money';
import { monthLabel } from '../format';

export const VIEW_W = 296;
export const VIEW_H = 150;
const PLOT_W = 290;
const TOP = 32;
const BOTTOM = 117.5;
const AREA_BOTTOM = 126;
const LABEL_Y = 146;
const MARKER_MIN_GAP = 24;
const MARKER_MAX_X = 260;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface TrendPoint {
  date: IsoDate;
  total: Paise;
}

export interface TrendShape {
  line: string;
  area: string;
  last: { x: number; y: number };
  grid: { y: number; label: string }[];
  xLabels: { x: number; text: string; anchor: 'start' | 'middle' | 'end' }[];
  markers: { x: number; y: number }[];
  baseline: number;
  areaBottom: number;
  labelY: number;
  caption: string;
}

const fix = (n: number): string => n.toFixed(1);

function monthShort(date: IsoDate): string {
  return MONTHS[Number(date.slice(5, 7)) - 1] ?? '';
}

function firstLabel(date: IsoDate): string {
  return `${monthShort(date)} '${date.slice(2, 4)}`;
}

/** "Net worth rose from ₹35.6L in Oct 2025 to ₹43.5L now." — or the hidden-amounts wording. */
export function trendCaption(points: TrendPoint[], hidden: boolean): string {
  if (hidden) return 'Amounts hidden. Shape only.';
  if (points.length < 2) return 'Not enough history yet.';
  const first = points[0];
  const last = points[points.length - 1];
  const from = formatInr(first.total, { compact: true });
  const to = formatInr(last.total, { compact: true });
  if (from === to) return `Net worth held at ${to} since ${monthLabel(first.date.slice(0, 7))}.`;
  const verb = last.total > first.total ? 'rose' : 'fell';
  return `Net worth ${verb} from ${from} in ${monthLabel(first.date.slice(0, 7))} to ${to} now.`;
}

/** The chart shape for at least two points; null when there is nothing to draw. */
export function trendShape(
  points: TrendPoint[],
  vestDates: IsoDate[],
  hidden: boolean,
): TrendShape | null {
  if (points.length < 2) return null;
  const values = points.map((point) => point.total);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = PLOT_W / (points.length - 1);
  const yOf = (value: number): number =>
    span === 0 ? (TOP + BOTTOM) / 2 : TOP + ((max - value) / span) * (BOTTOM - TOP);

  const xy = points.map((point, i) => ({ x: i * step, y: yOf(point.total) }));
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${fix(p.x)} ${fix(p.y)}`).join(' ');
  const area = `${line} L${fix(PLOT_W)} ${AREA_BOTTOM} L0.0 ${AREA_BOTTOM}Z`;
  const last = xy[xy.length - 1];

  const grid = hidden
    ? []
    : [max, min + span / 2, min].map((value) => ({
        y: yOf(value),
        label: formatInr(Math.round(value), { compact: true }),
      }));

  // First, last and up to three evenly spread points between, without repeating an index.
  const indexes = [...new Set([0, 1, 2, 3, 4].map((k) => Math.round((k * (points.length - 1)) / 4)))];
  const xLabels = hidden
    ? []
    : indexes.map((i) => ({
        x: xy[i].x,
        text: i === 0 ? firstLabel(points[i].date) : i === points.length - 1 ? 'Now' : monthShort(points[i].date),
        anchor: (i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle') as 'start' | 'middle' | 'end',
      }));

  const markers: TrendShape['markers'] = [];
  const startDate = points[0].date;
  const endDate = points[points.length - 1].date;
  for (const vest of [...vestDates].sort()) {
    if (vest < startDate || vest > endDate) continue;
    let segment = 0;
    while (segment < points.length - 2 && points[segment + 1].date < vest) segment++;
    const from = points[segment].date;
    const to = points[segment + 1].date;
    const length = daysBetween(from, to);
    const fraction = length <= 0 ? 0 : Math.min(1, Math.max(0, daysBetween(from, vest) / length));
    const x = (segment + fraction) * step;
    const y = xy[segment].y + (xy[segment + 1].y - xy[segment].y) * fraction;
    const previous = markers[markers.length - 1];
    if (x > MARKER_MAX_X || (previous !== undefined && x - previous.x < MARKER_MIN_GAP)) continue;
    markers.push({ x, y });
  }

  return {
    line,
    area,
    last,
    grid,
    xLabels,
    markers: hidden ? [] : markers,
    baseline: BOTTOM - 2,
    areaBottom: AREA_BOTTOM,
    labelY: LABEL_Y,
    caption: trendCaption(points, hidden),
  };
}
