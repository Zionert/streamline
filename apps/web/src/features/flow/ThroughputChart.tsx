import type { AnalyticsResponse } from '@streamline/shared';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import { ChartCard, DataTable } from './ChartCard';
import { TooltipBox } from './chartParts';
import { CHART_MARGIN, X_TICK_GAP, axisStyle } from './chartStyle';
import { formatDayMonth, formatFullDate, pluralize } from './flowFormat';
import {
  throughputSeries,
  throughputSummary,
  type ThroughputBar,
  type ThroughputGranularity,
} from './flowMetrics';
import { SegmentedToggle } from './SegmentedToggle';
import type { ChartColors } from './useChartColors';

const GRANULARITY_OPTIONS: readonly { value: ThroughputGranularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
];

interface ThroughputChartProps {
  throughput: AnalyticsResponse['throughput'];
  colors: ChartColors;
}

/** Cards completed per day or per week (labelled by its Monday), with their average. */
export function ThroughputChart({ throughput, colors }: ThroughputChartProps) {
  const [granularity, setGranularity] = useState<ThroughputGranularity>('day');
  const series = throughputSeries(throughput, granularity);
  const axis = axisStyle(colors);

  return (
    <ChartCard
      title="Throughput"
      description={granularity === 'day' ? 'Cards completed per day' : 'Cards completed per week'}
      controls={
        <SegmentedToggle
          label="Throughput period"
          options={GRANULARITY_OPTIONS}
          value={granularity}
          onChange={setGranularity}
        />
      }
      footer={<p className="text-xs text-subtle tabular-nums">{series.averageLabel}</p>}
      table={<ThroughputTable bars={series.bars} granularity={granularity} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={series.bars}
          role="img"
          aria-label={throughputSummary(series, granularity)}
          accessibilityLayer={false}
          margin={CHART_MARGIN}
          className="font-mono"
        >
          <CartesianGrid vertical={false} stroke={colors.border} />
          <XAxis
            dataKey="date"
            minTickGap={X_TICK_GAP}
            tickFormatter={(value: string) => formatDayMonth(value)}
            {...axis}
          />
          <YAxis width={36} allowDecimals={false} {...axis} />
          <Tooltip
            cursor={{ fill: colors.border, fillOpacity: 0.5 }}
            isAnimationActive={false}
            content={(props: TooltipContentProps) => (
              <ThroughputTooltip {...props} colors={colors} granularity={granularity} />
            )}
          />
          <Bar
            dataKey="count"
            name="Completed"
            fill={colors.catDone}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
          <ReferenceLine
            y={series.average}
            stroke={colors.textMuted}
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
            label={{
              value: series.averageLabel,
              position: 'insideTopRight',
              fill: colors.textMuted,
              fontSize: 11,
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function isBar(value: unknown): value is ThroughputBar {
  return typeof value === 'object' && value !== null && 'date' in value && 'count' in value;
}

function ThroughputTooltip({
  active,
  payload,
  colors,
  granularity,
}: TooltipContentProps & { colors: ChartColors; granularity: ThroughputGranularity }) {
  const bar: unknown = payload[0]?.payload;
  if (!active || !isBar(bar)) {
    return null;
  }
  return (
    <TooltipBox colors={colors}>
      <p className="font-mono" style={{ color: colors.textSubtle }}>
        {granularity === 'day' ? formatDayMonth(bar.date) : `Week of ${formatDayMonth(bar.date)}`}
      </p>
      <p className="tabular-nums">{pluralize(bar.count, 'card')} completed</p>
    </TooltipBox>
  );
}

function ThroughputTable({
  bars,
  granularity,
}: {
  bars: readonly ThroughputBar[];
  granularity: ThroughputGranularity;
}) {
  return (
    <DataTable
      caption={granularity === 'day' ? 'Cards completed per day' : 'Cards completed per week'}
    >
      <thead>
        <tr>
          <th scope="col">{granularity === 'day' ? 'Day' : 'Week of'}</th>
          <th scope="col">Completed</th>
        </tr>
      </thead>
      <tbody>
        {bars.map((bar) => (
          <tr key={bar.date}>
            <td>{formatFullDate(bar.date)}</td>
            <td>{bar.count}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
