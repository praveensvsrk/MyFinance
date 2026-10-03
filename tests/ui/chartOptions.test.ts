import { describe, expect, it } from 'vitest';
import { categoryOption, FALLBACK_THEME, sparkOption, stackedOption, trendOption } from '../../src/ui/charts/options';

const theme = FALLBACK_THEME;

describe('trendOption', () => {
  const points = [
    { date: '2026-08-31', total: 100_000_000 },
    { date: '2026-09-30', total: 120_000_000 },
  ];

  it('plots one series point per month and formats axis amounts in Indian compact form', () => {
    const option = trendOption(points, theme, false) as any;
    expect(option.series[0].data).toEqual([100_000_000, 120_000_000]);
    expect(option.xAxis.data).toHaveLength(2);
    expect(option.yAxis.axisLabel.formatter(120_000_000)).toBe('₹12L');
    expect(option.tooltip.valueFormatter(120_000_000)).toBe('₹12,00,000.00');
  });

  it('never prints a figure when amounts are hidden', () => {
    const option = trendOption(points, theme, true) as any;
    expect(option.yAxis.axisLabel.formatter(120_000_000)).toBe('');
    expect(option.tooltip.valueFormatter(120_000_000)).toBe('••••');
  });
});

describe('categoryOption', () => {
  it('sorts largest first and masks labels when hidden', () => {
    const rows = [
      { category: 'Groceries', amount: 500_000 },
      { category: 'Rent', amount: 1_500_000 },
    ];
    const option = categoryOption(rows, theme, false) as any;
    expect(option.yAxis.data).toEqual(['Rent', 'Groceries']);
    expect(option.series[0].data).toEqual([1_500_000, 500_000]);
    expect(categoryOption(rows, theme, true).series).toBeDefined();
    expect((categoryOption(rows, theme, true) as any).series[0].label.formatter({ value: 1_500_000 })).toBe('••••');
  });
});

describe('stackedOption', () => {
  it('drops zero and negative segments and stacks the rest', () => {
    const option = stackedOption(
      [
        { label: 'Liquid', value: 100 },
        { label: 'Liabilities', value: -50 },
        { label: 'Market', value: 0 },
        { label: 'Retirement', value: 300 },
      ],
      theme,
      false,
    ) as any;
    expect(option.series.map((series: { name: string }) => series.name)).toEqual(['Liquid', 'Retirement']);
    expect(option.series.every((series: { stack: string }) => series.stack === 'total')).toBe(true);
  });
});

describe('sparkOption', () => {
  it('has no axes or tooltip', () => {
    const option = sparkOption([1, 2, 3], theme) as any;
    expect(option.xAxis.show).toBe(false);
    expect(option.tooltip).toBeUndefined();
    expect(option.series[0].data).toEqual([1, 2, 3]);
  });
});
