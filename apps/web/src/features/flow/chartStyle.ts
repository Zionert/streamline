import type { ChartColors } from './useChartColors';

/** Tick labels of an axis: 11 px in the muted text colour (the font comes from the plot area). */
export function axisTick(colors: ChartColors) {
  return { fill: colors.textMuted, fontSize: 11 };
}

/** Shared look of the axes: a strong axis line and no tick marks. */
export function axisStyle(colors: ChartColors) {
  return {
    tick: axisTick(colors),
    axisLine: { stroke: colors.borderStrong },
    tickLine: false,
  } as const;
}

/** Margin of every chart (the reference lines are named in a legend above the plot). */
export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;
