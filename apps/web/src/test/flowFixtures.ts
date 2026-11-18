import {
  addDays,
  analyticsResponseSchema,
  forecastResponseSchema,
  type AnalyticsResponse,
  type ForecastResponse,
  type LeadCycleScatterPoint,
} from '@streamline/shared';

/** First day of the default 30-day range of the fixtures (a Monday). */
export const RANGE_FROM = '2026-10-19';
export const RANGE_TO = '2026-11-17';

const DAYS = Array.from({ length: 30 }, (_, index) => addDays(RANGE_FROM, index));

export function scatterPoint(
  overrides: Partial<LeadCycleScatterPoint> & Pick<LeadCycleScatterPoint, 'cardKey'>,
): LeadCycleScatterPoint {
  return {
    cardId: `card-${overrides.cardKey}`,
    title: `Card ${overrides.cardKey}`,
    completedAt: '2026-11-02T12:00:00.000Z',
    leadTimeDays: 6,
    cycleTimeDays: 3,
    ...overrides,
  };
}

/** Seven completed cards, one of them never in progress (no cycle time). */
export const SCATTER_POINTS: readonly LeadCycleScatterPoint[] = [
  scatterPoint({
    cardKey: 'SB-1',
    title: 'Fix login',
    completedAt: '2026-10-22T13:05:00.000Z',
    leadTimeDays: 9.4,
    cycleTimeDays: 4.1,
  }),
  scatterPoint({ cardKey: 'SB-2', completedAt: '2026-10-27T10:00:00.000Z', cycleTimeDays: 2.5 }),
  scatterPoint({ cardKey: 'SB-3', completedAt: '2026-10-30T10:00:00.000Z', cycleTimeDays: 8.3 }),
  scatterPoint({ cardKey: 'SB-4', completedAt: '2026-11-04T10:00:00.000Z', cycleTimeDays: 11.6 }),
  scatterPoint({ cardKey: 'SB-5', completedAt: '2026-11-10T10:00:00.000Z', cycleTimeDays: 3.2 }),
  scatterPoint({ cardKey: 'SB-6', completedAt: '2026-11-12T10:00:00.000Z', cycleTimeDays: 5 }),
  scatterPoint({ cardKey: 'SB-7', completedAt: '2026-11-16T10:00:00.000Z', cycleTimeDays: null }),
];

/** Completions per day of the range: one on the day each scatter point was completed. */
function dailyFor(points: readonly LeadCycleScatterPoint[]) {
  return DAYS.map((date) => ({
    date,
    count: points.filter((point) => point.completedAt.startsWith(date)).length,
  }));
}

function weeklyFor(daily: readonly { date: string; count: number }[]) {
  const weeks = [0, 7, 14, 21, 28].map((offset) => addDays(RANGE_FROM, offset));
  return weeks.map((weekStart) => ({
    weekStart,
    count: daily
      .filter((day) => day.date >= weekStart && day.date < addDays(weekStart, 7))
      .reduce((sum, day) => sum + day.count, 0),
  }));
}

/** Analytics of the default range (UTC): 7 completed cards, 3 in progress (2 aging). */
export function analyticsWith(
  overrides: Partial<AnalyticsResponse> = {},
  points: readonly LeadCycleScatterPoint[] = SCATTER_POINTS,
): AnalyticsResponse {
  const daily = dailyFor(points);
  return analyticsResponseSchema.parse({
    range: { from: RANGE_FROM, to: RANGE_TO, timeZone: 'UTC' },
    generatedAt: '2026-11-17T09:30:00.000Z',
    leadCycle: {
      points,
      leadTime: { count: 7, p50: 9.4, p85: 17.2, p95: 21 },
      cycleTime: { count: 6, p50: 4.1, p85: 8.3, p95: 11.6 },
    },
    throughput: { daily, weekly: weeklyFor(daily) },
    cumulativeFlow: DAYS.map((date, index) => ({
      date,
      BACKLOG: 5,
      TODO: 3,
      IN_PROGRESS: 2,
      DONE: 20 + Math.floor(index / 5),
      unknown: 0,
    })),
    aging: {
      thresholdDays: 8.3,
      items: ['SB-8', 'SB-9', 'SB-10'].map((cardKey, index) => ({
        cardId: `card-${cardKey}`,
        cardKey,
        title: `Card ${cardKey}`,
        columnId: 'col-progress',
        columnName: 'In Progress',
        assignee: null,
        cycleStartedAt: '2026-11-01T08:00:00.000Z',
        ageDays: 16 - index * 6,
        isAging: index < 2,
      })),
    },
    littlesLaw: {
      avgWip: 4.6,
      avgThroughputPerDay: 0.8,
      avgCycleTimeDays: 5.2,
      predictedWip: 4.16,
      relativeError: 0.106,
    },
    ...overrides,
  });
}

/** Analytics of a range without any completed card. */
export function emptyAnalytics(): AnalyticsResponse {
  return analyticsWith(
    {
      leadCycle: {
        points: [],
        leadTime: { count: 0, p50: null, p85: null, p95: null },
        cycleTime: { count: 0, p50: null, p85: null, p95: null },
      },
      littlesLaw: {
        avgWip: 2,
        avgThroughputPerDay: 0,
        avgCycleTimeDays: null,
        predictedWip: null,
        relativeError: null,
      },
    },
    [],
  );
}

const FORECAST_COMMON = {
  startDate: RANGE_TO,
  timeZone: 'UTC',
  sample: { days: 30, from: '2026-10-18', to: '2026-11-16', totalCompleted: 31 },
};

/** "When will 12 cards be done?": 14 Dec (50%), 22 Dec (85%), 29 Dec (95%). */
export function countForecast(remaining = 12): ForecastResponse {
  return forecastResponseSchema.parse({
    mode: 'count',
    remaining,
    ...FORECAST_COMMON,
    status: 'ok',
    trials: 10_000,
    percentiles: {
      p50: { date: '2026-12-14', days: 27 },
      p85: { date: '2026-12-22', days: 35 },
      p95: { date: '2026-12-29', days: 42 },
    },
    distribution: [],
  });
}

/** "How many by `targetDate`?": at least 20 (50%), 14 (85%), 11 (95%) cards. */
export function dateForecast(targetDate: string): ForecastResponse {
  return forecastResponseSchema.parse({
    mode: 'date',
    targetDate,
    ...FORECAST_COMMON,
    status: 'ok',
    days: 30,
    trials: 10_000,
    percentiles: { p50: 20, p85: 14, p95: 11 },
    distribution: [],
  });
}

export function insufficientForecast(): ForecastResponse {
  return forecastResponseSchema.parse({
    mode: 'count',
    remaining: 12,
    ...FORECAST_COMMON,
    status: 'insufficient_data',
    reason: 'zero_throughput',
  });
}

export function horizonExceededForecast(): ForecastResponse {
  return forecastResponseSchema.parse({
    mode: 'count',
    remaining: 5000,
    ...FORECAST_COMMON,
    status: 'horizon_exceeded',
    maxHorizonDays: 730,
  });
}
