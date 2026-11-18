import type { AnalyticsResponse, LeadCycleScatterPoint } from '@streamline/shared';

import {
  formatDateRange,
  formatDayMonth,
  formatDays,
  formatDecimal,
  formatShortDecimal,
  pluralize,
} from './flowFormat';

type Throughput = AnalyticsResponse['throughput'];
type LittlesLaw = AnalyticsResponse['littlesLaw'];
type CycleTimeStats = AnalyticsResponse['leadCycle']['cycleTime'];

/** Samples needed for the 85th and 95th percentiles (fewer leave them `null`). */
export const PERCENTILE_MIN_SAMPLES = 5;

/** Little's law counts as holding while the relative gap stays within ±20%. */
export const LITTLES_LAW_TOLERANCE = 0.2;

/** Cards completed in the range. */
export function completedCount(throughput: Throughput): number {
  return throughput.daily.reduce((sum, day) => sum + day.count, 0);
}

export type ThroughputGranularity = 'day' | 'week';

export interface ThroughputBar {
  /** Calendar date `YYYY-MM-DD` (the day, or the Monday of the week). */
  date: string;
  count: number;
}

const DAYS_PER_WEEK = 7;

export interface ThroughputSeries {
  bars: ThroughputBar[];
  /** Mean completions per day, or per 7 days (from the daily rate) in the weekly view. */
  average: number;
  /** E.g. `avg 0.8 / day`. */
  averageLabel: string;
}

export function throughputSeries(
  throughput: Throughput,
  granularity: ThroughputGranularity,
): ThroughputSeries {
  const bars =
    granularity === 'day'
      ? throughput.daily.map(({ date, count }) => ({ date, count }))
      : throughput.weekly.map(({ weekStart, count }) => ({ date: weekStart, count }));
  // Per week, the daily rate times 7: the weeks at the ends of the range are usually partial,
  // so averaging the weekly bars would understate the pace.
  const days = throughput.daily.length;
  const dailyRate = days === 0 ? 0 : completedCount(throughput) / days;
  const average = granularity === 'day' ? dailyRate : dailyRate * DAYS_PER_WEEK;
  const averageLabel =
    granularity === 'day'
      ? `avg ${formatDecimal(average)} / day`
      : `avg ${formatShortDecimal(average)} / week`;
  return { bars, average, averageLabel };
}

/** Text alternative of the throughput chart. */
export function throughputSummary(
  series: ThroughputSeries,
  granularity: ThroughputGranularity,
): string {
  const total = series.bars.reduce((sum, bar) => sum + bar.count, 0);
  const unit = granularity === 'day' ? 'day' : 'week';
  const peak = series.bars.reduce<ThroughputBar | null>(
    (best, bar) => (best === null || bar.count > best.count ? bar : best),
    null,
  );
  const parts = [
    `Throughput per ${unit}: ${pluralize(total, 'card')} completed over ${pluralize(series.bars.length, unit)}`,
    series.averageLabel.replace('avg', 'average'),
  ];
  if (peak && peak.count > 0) {
    parts.push(
      `highest ${formatShortDecimal(peak.count)} ${granularity === 'day' ? 'on' : 'in the week of'} ${formatDayMonth(peak.date)}`,
    );
  }
  return `${parts.join(', ')}.`;
}

/** Points of the cycle time chart (cards with a cycle time) and the number left out. */
export function cycleTimePoints(points: readonly LeadCycleScatterPoint[]): {
  plotted: (LeadCycleScatterPoint & { cycleTimeDays: number })[];
  withoutCycleTime: number;
} {
  const plotted = points.filter(
    (point): point is LeadCycleScatterPoint & { cycleTimeDays: number } =>
      point.cycleTimeDays !== null,
  );
  return { plotted, withoutCycleTime: points.length - plotted.length };
}

export type PercentileKey = 'p50' | 'p85' | 'p95';

export const PERCENTILE_KEYS: readonly PercentileKey[] = ['p50', 'p85', 'p95'];

/** Reference lines of the cycle time chart: only the percentiles that are known. */
export function percentileLines(stats: CycleTimeStats): { key: PercentileKey; value: number }[] {
  return PERCENTILE_KEYS.flatMap((key) => {
    const value = stats[key];
    return value === null ? [] : [{ key, value }];
  });
}

/** E.g. `p85 · 8.3 d`. */
export function percentileLabel(key: PercentileKey, value: number): string {
  return `${key} · ${formatDays(value)}`;
}

/** Text alternative of the cycle time chart. */
export function cycleTimeSummary(
  stats: CycleTimeStats,
  plottedCount: number,
  range: AnalyticsResponse['range'],
): string {
  const lines = percentileLines(stats).map(
    ({ key, value }) => `${key} ${formatDecimal(value)} days`,
  );
  const base = `Cycle time of ${pluralize(plottedCount, 'card')} completed ${formatDateRange(range.from, range.to)}`;
  return lines.length === 0 ? `${base}.` : `${base}: ${lines.join(', ')}.`;
}

export type FlowCategoryKey = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'DONE' | 'unknown';

/** Categories of the cumulative flow, from the top of the stack to the bottom. */
export const CFD_CATEGORIES: readonly { key: FlowCategoryKey; label: string }[] = [
  { key: 'unknown', label: 'Unknown' },
  { key: 'BACKLOG', label: 'Backlog' },
  { key: 'TODO', label: 'To do' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'DONE', label: 'Done' },
];

/**
 * Categories shown by the cumulative flow, top to bottom; "Unknown" (cards of deleted columns)
 * only when it is not zero somewhere in the range.
 */
export function cfdCategories(
  points: AnalyticsResponse['cumulativeFlow'],
): { key: FlowCategoryKey; label: string }[] {
  const hasUnknown = points.some((point) => point.unknown > 0);
  return CFD_CATEGORIES.filter((category) => category.key !== 'unknown' || hasUnknown);
}

/** Text alternative of the cumulative flow chart. */
export function cumulativeFlowSummary(
  points: AnalyticsResponse['cumulativeFlow'],
  categories: readonly { key: FlowCategoryKey; label: string }[],
): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) {
    return 'Cumulative flow: no data.';
  }
  const counts = categories
    .map(({ key, label }) => `${label} ${formatShortDecimal(last[key])}`)
    .join(', ');
  return `Cumulative flow ${formatDateRange(first.date, last.date)}. Cards at the end: ${counts}.`;
}

export type LittlesLawVerdict = 'stable' | 'piling-up' | 'below-prediction' | 'unknown';

export const LITTLES_LAW_MESSAGES: Readonly<Record<LittlesLawVerdict, string>> = {
  stable: 'Flow is stable: work in progress matches what throughput and cycle time predict.',
  'piling-up': 'More work is in progress than the team finishes — work is piling up.',
  'below-prediction':
    'Less work in progress than predicted — the period may include unusual spikes.',
  unknown: 'Not enough completed cards in this period to check.',
};

/** How the measured work in progress compares with the one Little's law predicts. */
export function littlesLawVerdict(law: LittlesLaw): LittlesLawVerdict {
  const { relativeError } = law;
  if (relativeError === null || law.predictedWip === null || law.avgCycleTimeDays === null) {
    return 'unknown';
  }
  if (relativeError > LITTLES_LAW_TOLERANCE) {
    return 'piling-up';
  }
  if (relativeError < -LITTLES_LAW_TOLERANCE) {
    return 'below-prediction';
  }
  return 'stable';
}
