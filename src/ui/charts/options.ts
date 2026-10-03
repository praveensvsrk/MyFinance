/**
 * Pure ECharts option builders. They take already-queried data plus a theme and the hide-amounts
 * flag and return a plain option object, so they are unit-testable without a canvas. When amounts
 * are hidden, axis labels and tooltips never contain a figure.
 */

import type { EChartsCoreOption } from 'echarts/core';
import { formatInr } from '../../domain/money';
import { dateShort } from '../format';
import { MASK } from '../format';

export interface ChartTheme {
  text: string;
  muted: string;
  grid: string;
  /** Series colours in order (`--chart-1` … `--chart-5`). */
  series: string[];
}

export const FALLBACK_THEME: ChartTheme = {
  text: '#1c1b1f',
  muted: '#6b6a70',
  grid: '#e4e2e8',
  series: ['#2f6fed', '#e8833a', '#2a9d8f', '#8e5bd6', '#c9a227'],
};

/** Reads the chart colours from the page's CSS variables, falling back to the defaults. */
export function readTheme(element: Element = document.documentElement): ChartTheme {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    text: read('--text', FALLBACK_THEME.text),
    muted: read('--chart-axis', FALLBACK_THEME.muted),
    grid: read('--chart-grid', FALLBACK_THEME.grid),
    series: FALLBACK_THEME.series.map((fallback, index) => read(`--chart-${index + 1}`, fallback)),
  };
}

function amountLabel(paise: number, hidden: boolean, compact: boolean): string {
  return hidden ? MASK : formatInr(paise, { compact });
}

/** Net worth over time (§6.2): a line with a soft area, month-end points. */
export function trendOption(
  points: { date: string; total: number }[],
  theme: ChartTheme,
  hidden: boolean,
): EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 8, right: 8, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number) => amountLabel(value, hidden, false),
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => dateShort(point.date)),
      axisLine: { lineStyle: { color: theme.grid } },
      axisLabel: { color: theme.muted, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: theme.grid } },
      axisLabel: {
        color: theme.muted,
        formatter: (value: number) => (hidden ? '' : formatInr(value, { compact: true })),
      },
    },
    series: [
      {
        type: 'line',
        name: 'Net worth',
        data: points.map((point) => point.total),
        showSymbol: false,
        smooth: false,
        lineStyle: { color: theme.series[0], width: 2 },
        areaStyle: { color: theme.series[0], opacity: 0.12 },
      },
    ],
  };
}

/** Spending by category (§6.3): horizontal bars, largest first. */
export function categoryOption(
  categories: { category: string; amount: number }[],
  theme: ChartTheme,
  hidden: boolean,
): EChartsCoreOption {
  const sorted = [...categories].sort((a, b) => b.amount - a.amount);
  return {
    animation: false,
    grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'item',
      valueFormatter: (value: number) => amountLabel(value, hidden, false),
    },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      inverse: true,
      data: sorted.map((row) => row.category),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.text },
    },
    series: [
      {
        type: 'bar',
        data: sorted.map((row) => row.amount),
        itemStyle: { color: theme.series[0], borderRadius: [0, 3, 3, 0] },
        label: {
          show: true,
          position: 'right',
          color: theme.muted,
          formatter: (params: { value: number }) => amountLabel(params.value, hidden, true),
        },
      },
    ],
  };
}

/** One horizontal stacked bar (§6.2 composition): each segment a share of the whole. */
export function stackedOption(
  segments: { label: string; value: number }[],
  theme: ChartTheme,
  hidden: boolean,
): EChartsCoreOption {
  const positive = segments.filter((segment) => segment.value > 0);
  return {
    animation: false,
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    tooltip: {
      trigger: 'item',
      formatter: (params: { seriesName: string; value: number }) =>
        `${params.seriesName}: ${amountLabel(params.value, hidden, false)}`,
    },
    xAxis: { type: 'value', show: false, max: 'dataMax' },
    yAxis: { type: 'category', show: false, data: [''] },
    series: positive.map((segment, index) => ({
      type: 'bar',
      name: segment.label,
      stack: 'total',
      data: [segment.value],
      barWidth: '100%',
      itemStyle: { color: theme.series[index % theme.series.length] },
    })),
  };
}

/** A tiny axis-less line for list rows and cards. */
export function sparkOption(values: number[], theme: ChartTheme): EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: 'category', show: false, data: values.map((_, index) => index) },
    yAxis: { type: 'value', show: false, scale: true },
    series: [
      {
        type: 'line',
        data: values,
        showSymbol: false,
        silent: true,
        lineStyle: { color: theme.series[0], width: 1.5 },
      },
    ],
  };
}
