import { useMemo } from 'react';
import { useApp } from '../AppContext';
import { EChart } from './EChart';
import { categoryOption, readTheme, sparkOption, stackedOption, trendOption } from './options';

export function TrendLine({ points, height = 200 }: { points: { date: string; total: number }[]; height?: number }) {
  const { hideAmounts } = useApp();
  const option = useMemo(() => trendOption(points, readTheme(), hideAmounts), [points, hideAmounts]);
  return <EChart option={option} height={height} label="Net worth over time" />;
}

export function CategoryBars({ categories }: { categories: { category: string; amount: number }[] }) {
  const { hideAmounts } = useApp();
  const option = useMemo(() => categoryOption(categories, readTheme(), hideAmounts), [categories, hideAmounts]);
  return <EChart option={option} height={Math.max(60, categories.length * 32)} label="Spending by category" />;
}

export function StackedBar({ segments, height = 24 }: { segments: { label: string; value: number }[]; height?: number }) {
  const { hideAmounts } = useApp();
  const option = useMemo(() => stackedOption(segments, readTheme(), hideAmounts), [segments, hideAmounts]);
  return <EChart option={option} height={height} label="Net worth composition" />;
}

export function Sparkline({ values, height = 32 }: { values: number[]; height?: number }) {
  const option = useMemo(() => sparkOption(values, readTheme()), [values]);
  return <EChart option={option} height={height} label="Trend" />;
}
