import { useEffect, useRef } from 'react';
import type { EChartsCoreOption } from 'echarts/core';

/**
 * Renders an ECharts option. ECharts itself is imported on first use so it stays out of the main
 * bundle; the container keeps its height meanwhile, so nothing jumps when the chart appears.
 */
export function EChart({
  option,
  height,
  label,
}: {
  option: EChartsCoreOption;
  height: number;
  /** Accessible description of what the chart shows. */
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<{ setOption: (o: EChartsCoreOption, notMerge?: boolean) => void; resize: () => void; dispose: () => void } | null>(null);
  const latest = useRef(option);
  latest.current = option;

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void import('./echartsCore').then(({ echarts }) => {
      if (disposed || container.current === null) return;
      const chart = echarts.init(container.current);
      instance.current = chart;
      chart.setOption(latest.current, true);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => chart.resize());
        observer.observe(container.current);
      }
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    instance.current?.setOption(option, true);
  }, [option]);

  return <div ref={container} role="img" aria-label={label} style={{ height, width: '100%' }} />;
}
