import type { AnalyticsResponse, LeadCycleScatterPoint } from '@streamline/shared';
import { Link, useNavigate } from 'react-router';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  type ScatterShapeProps,
  type TooltipContentProps,
} from 'recharts';

import { flowCardPath, type CardLocationState } from '@/features/boards/paths';

import { ChartCard, DataTable } from './ChartCard';
import { ReferenceLegend, TooltipBox } from './chartParts';
import { CHART_MARGIN, axisStyle } from './chartStyle';
import {
  axisMsToDateKey,
  dateKeyToMs,
  dateTicks,
  instantToAxisMs,
  rangeDomain,
  tickLabel,
} from './dateTicks';
import {
  NO_VALUE,
  formatDays,
  formatInstantDayMonth,
  formatInstantFullDate,
  pluralize,
} from './flowFormat';
import {
  PERCENTILE_MIN_SAMPLES,
  cycleTimePoints,
  cycleTimeSummary,
  percentileLabel,
  percentileLines,
  type PercentileKey,
} from './flowMetrics';
import type { ChartColors } from './useChartColors';
import { useMaxTicks } from './useMaxTicks';

type PlottedPoint = LeadCycleScatterPoint & { cycleTimeDays: number; x: number };

const POINT_RADIUS = 3;
const FOCUS_RING_RADIUS = 6;

const CARD_STATE: CardLocationState = { fromBoard: true };

interface CycleTimeChartProps {
  boardId: string;
  analytics: AnalyticsResponse;
  colors: ChartColors;
}

/**
 * Cycle time of every card completed in the range against its completion, with the p50, p85
 * and p95 reference lines. A point (or its key in the data table) opens the card over the page.
 */
export function CycleTimeChart({ boardId, analytics, colors }: CycleTimeChartProps) {
  const navigate = useNavigate();
  const maxTicks = useMaxTicks();
  const { range, leadCycle } = analytics;
  const timeZone = range.timeZone;
  const { plotted, withoutCycleTime } = cycleTimePoints(leadCycle.points);
  const data: PlottedPoint[] = plotted.map((point) => ({
    ...point,
    x: instantToAxisMs(point.completedAt, timeZone),
  }));
  const lines = percentileLines(leadCycle.cycleTime);
  const sampleCount = leadCycle.cycleTime.count;
  const lineColors: Record<PercentileKey, string> = {
    p50: colors.catDone,
    p85: colors.warningText,
    p95: colors.destructive,
  };
  // The labels are text: the light --cat-done is below 4.5:1 on the surface, so p50 is labelled
  // in the subtle text colour (its line keeps the category colour).
  const labelColors: Record<PercentileKey, string> = {
    ...lineColors,
    p50: colors.textSubtle,
  };
  const legend = lines.map(({ key, value }) => ({
    key,
    label: percentileLabel(key, value),
    lineColor: lineColors[key],
    textColor: labelColors[key],
  }));
  const axis = axisStyle(colors);
  const ticks = dateTicks(range.from, range.to, maxTicks);

  const openCard = (cardKey: string) => {
    void navigate(flowCardPath(boardId, cardKey), { state: CARD_STATE });
  };

  const renderPoint = ({ cx, cy, index, isActive }: ScatterShapeProps) => {
    const point = data[index];
    if (cx === undefined || cy === undefined || !point) {
      return <g />;
    }
    return (
      <g
        data-testid="cycle-time-point"
        className="cursor-pointer"
        onClick={() => openCard(point.cardKey)}
      >
        {isActive && (
          <circle
            cx={cx}
            cy={cy}
            r={FOCUS_RING_RADIUS}
            fill="none"
            stroke={colors.ring}
            strokeWidth={2}
          />
        )}
        <circle
          cx={cx}
          cy={cy}
          r={POINT_RADIUS}
          fill={isActive ? colors.primaryText : colors.textSubtle}
        />
      </g>
    );
  };

  const footer = (
    <div className="flex flex-col gap-1 text-xs text-subtle">
      {withoutCycleTime > 0 && (
        <p>
          {withoutCycleTime === 1
            ? '1 completed card without cycle time is not shown'
            : `${pluralize(withoutCycleTime, 'completed card')} without cycle time are not shown`}
        </p>
      )}
      {sampleCount < PERCENTILE_MIN_SAMPLES && (
        <p>
          Percentiles need at least {PERCENTILE_MIN_SAMPLES} completed cards ({sampleCount} so far).
        </p>
      )}
    </div>
  );

  return (
    <ChartCard
      title="Cycle time"
      description="Days from the start of work to done, per completed card"
      legend={<ReferenceLegend items={legend} />}
      tall
      footer={footer}
      table={<CycleTimeTable boardId={boardId} points={leadCycle.points} timeZone={timeZone} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart
          role="img"
          aria-label={cycleTimeSummary(leadCycle.cycleTime, data.length, range)}
          accessibilityLayer={false}
          margin={CHART_MARGIN}
          className="font-mono"
        >
          <CartesianGrid vertical={false} stroke={colors.border} />
          <XAxis
            type="number"
            dataKey="x"
            scale="time"
            domain={rangeDomain(range.from, range.to)}
            padding={{ left: 8, right: 8 }}
            ticks={ticks.keys.map(dateKeyToMs)}
            interval={0}
            tickFormatter={(value: number) => tickLabel(axisMsToDateKey(value), ticks.step)}
            {...axis}
          />
          <YAxis type="number" dataKey="cycleTimeDays" width={36} allowDecimals={false} {...axis} />
          <Tooltip
            cursor={false}
            isAnimationActive={false}
            content={(props: TooltipContentProps) => (
              <CycleTimeTooltip {...props} colors={colors} timeZone={timeZone} />
            )}
          />
          {lines.map(({ key, value }) => (
            <ReferenceLine
              key={key}
              y={value}
              stroke={lineColors[key]}
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
          ))}
          <Scatter data={data} isAnimationActive={false} shape={renderPoint} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function isPlottedPoint(value: unknown): value is PlottedPoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cardKey' in value &&
    'cycleTimeDays' in value &&
    'leadTimeDays' in value
  );
}

function CycleTimeTooltip({
  active,
  payload,
  colors,
  timeZone,
}: TooltipContentProps & { colors: ChartColors; timeZone: string }) {
  const point: unknown = payload[0]?.payload;
  if (!active || !isPlottedPoint(point)) {
    return null;
  }
  return (
    <TooltipBox colors={colors}>
      <p className="font-mono" style={{ color: colors.textSubtle }}>
        {point.cardKey}
      </p>
      <p className="line-clamp-2 font-medium">{point.title}</p>
      <p className="mt-1 tabular-nums" style={{ color: colors.textSubtle }}>
        Cycle {formatDays(point.cycleTimeDays)} · Lead {formatDays(point.leadTimeDays)} · Done{' '}
        {formatInstantDayMonth(point.completedAt, timeZone)}
      </p>
    </TooltipBox>
  );
}

function CycleTimeTable({
  boardId,
  points,
  timeZone,
}: {
  boardId: string;
  points: readonly LeadCycleScatterPoint[];
  timeZone: string;
}) {
  return (
    <DataTable caption="Completed cards with their cycle and lead time">
      <thead>
        <tr>
          <th scope="col">Card</th>
          <th scope="col">Title</th>
          <th scope="col">Cycle time</th>
          <th scope="col">Lead time</th>
          <th scope="col">Done</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.cardId}>
            <td className="font-mono whitespace-nowrap">
              <Link
                to={flowCardPath(boardId, point.cardKey)}
                state={CARD_STATE}
                className="rounded-sm text-primary-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {point.cardKey}
              </Link>
            </td>
            <td className="min-w-40">{point.title}</td>
            <td className="whitespace-nowrap">
              {point.cycleTimeDays === null ? NO_VALUE : formatDays(point.cycleTimeDays)}
            </td>
            <td className="whitespace-nowrap">{formatDays(point.leadTimeDays)}</td>
            <td className="whitespace-nowrap">
              {formatInstantFullDate(point.completedAt, timeZone)}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
