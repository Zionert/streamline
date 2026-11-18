import type { AnalyticsResponse } from '@streamline/shared';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import { ChartCard, DataTable } from './ChartCard';
import { SeriesSwatch, TooltipBox } from './chartParts';
import { CHART_MARGIN, axisStyle } from './chartStyle';
import { dateTicks, tickLabel } from './dateTicks';
import { formatDayMonth, formatFullDate } from './flowFormat';
import { cfdCategories, cumulativeFlowSummary, type FlowCategoryKey } from './flowMetrics';
import type { ChartColors } from './useChartColors';
import { useMaxTicks } from './useMaxTicks';

type CumulativeFlowPoint = AnalyticsResponse['cumulativeFlow'][number];

/** Opacity of the area fills under their category outline. */
const FILL_OPACITY = 0.3;

function categoryColors(colors: ChartColors): Record<FlowCategoryKey, string> {
  return {
    BACKLOG: colors.catBacklog,
    TODO: colors.catTodo,
    IN_PROGRESS: colors.catProgress,
    DONE: colors.catDone,
    unknown: colors.borderStrong,
  };
}

interface CumulativeFlowChartProps {
  points: AnalyticsResponse['cumulativeFlow'];
  colors: ChartColors;
}

/** Cards per column category at the end of each day, stacked Done at the bottom to Backlog. */
export function CumulativeFlowChart({ points, colors }: CumulativeFlowChartProps) {
  const categories = cfdCategories(points);
  // Drawn bottom to top: the reverse of the top-to-bottom order of the legend.
  const stack = [...categories].reverse();
  const palette = categoryColors(colors);
  const axis = axisStyle(colors);
  const maxTicks = useMaxTicks();
  const first = points[0];
  const last = points.at(-1);
  const ticks =
    first && last ? dateTicks(first.date, last.date, maxTicks) : { step: 'day' as const, keys: [] };

  return (
    <ChartCard
      title="Cumulative flow"
      description="Cards in each stage at the end of every day"
      footer={
        <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1">
          {categories.map(({ key, label }) => (
            <li key={key}>
              <SeriesSwatch color={palette[key]} label={label} />
            </li>
          ))}
        </ul>
      }
      table={<CumulativeFlowTable points={points} categories={categories} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          role="img"
          aria-label={cumulativeFlowSummary(points, categories)}
          accessibilityLayer={false}
          margin={CHART_MARGIN}
          className="font-mono"
        >
          <CartesianGrid vertical={false} stroke={colors.border} />
          <XAxis
            dataKey="date"
            ticks={ticks.keys}
            interval={0}
            tickFormatter={(value: string) => tickLabel(value, ticks.step)}
            {...axis}
          />
          <YAxis width={36} allowDecimals={false} {...axis} />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: colors.borderStrong }}
            content={(props: TooltipContentProps) => (
              <CumulativeFlowTooltip
                {...props}
                colors={colors}
                categories={categories}
                palette={palette}
              />
            )}
          />
          {stack.map(({ key, label }) => (
            <Area
              key={key}
              dataKey={key}
              name={label}
              stackId="flow"
              type="monotone"
              stroke={palette[key]}
              fill={palette[key]}
              fillOpacity={FILL_OPACITY}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function isFlowPoint(value: unknown): value is CumulativeFlowPoint {
  return typeof value === 'object' && value !== null && 'date' in value && 'DONE' in value;
}

function CumulativeFlowTooltip({
  active,
  payload,
  colors,
  categories,
  palette,
}: TooltipContentProps & {
  colors: ChartColors;
  categories: readonly { key: FlowCategoryKey; label: string }[];
  palette: Record<FlowCategoryKey, string>;
}) {
  const point: unknown = payload[0]?.payload;
  if (!active || !isFlowPoint(point)) {
    return null;
  }
  return (
    <TooltipBox colors={colors}>
      <p className="mb-1 font-mono" style={{ color: colors.textSubtle }}>
        {formatDayMonth(point.date)}
      </p>
      <ul className="flex flex-col gap-0.5">
        {categories.map(({ key, label }) => (
          <li key={key} className="flex items-center justify-between gap-4 tabular-nums">
            <SeriesSwatch color={palette[key]} label={label} />
            <span>{point[key]}</span>
          </li>
        ))}
      </ul>
    </TooltipBox>
  );
}

function CumulativeFlowTable({
  points,
  categories,
}: {
  points: readonly CumulativeFlowPoint[];
  categories: readonly { key: FlowCategoryKey; label: string }[];
}) {
  return (
    <DataTable caption="Cards in each stage at the end of every day">
      <thead>
        <tr>
          <th scope="col">Day</th>
          {categories.map(({ key, label }) => (
            <th key={key} scope="col">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.date}>
            <td className="whitespace-nowrap">{formatFullDate(point.date)}</td>
            {categories.map(({ key }) => (
              <td key={key}>{point[key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
