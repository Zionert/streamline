import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_MAX_RANGE_DAYS,
  FORECAST_DEFAULT_SAMPLE_DAYS,
  FORECAST_MAX_REMAINING,
  analyticsQuerySchema,
  analyticsResponseSchema,
  forecastQuerySchema,
  forecastResponseSchema,
  type AnalyticsResponse,
} from './analytics.js';

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join('.')) ?? [];
}

describe('analyticsQuerySchema', () => {
  it('defaults the time zone to UTC and leaves the dates to the server', () => {
    expect(analyticsQuerySchema.parse({})).toEqual({ timeZone: 'UTC' });
  });

  it('accepts a valid range and time zone', () => {
    expect(
      analyticsQuerySchema.parse({
        from: '2026-01-01',
        to: '2026-01-31',
        timeZone: 'Europe/Warsaw',
      }),
    ).toEqual({ from: '2026-01-01', to: '2026-01-31', timeZone: 'Europe/Warsaw' });
    // A single day is a valid range.
    expect(analyticsQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-01' }).success).toBe(
      true,
    );
  });

  it.each(['2026-1-01', '2026-02-30', '01/02/2026', 'today', ''])(
    'rejects the malformed date %j',
    (value) => {
      expect(issuePaths(analyticsQuerySchema.safeParse({ from: value }))).toEqual(['from']);
      expect(issuePaths(analyticsQuerySchema.safeParse({ to: value, from: '2026-01-01' }))).toEqual(
        ['to'],
      );
    },
  );

  it.each(['Mars/Olympus', '', 'utc+1'])('rejects the time zone %j', (timeZone) => {
    expect(issuePaths(analyticsQuerySchema.safeParse({ timeZone }))).toEqual(['timeZone']);
  });

  it('rejects an inverted range', () => {
    const result = analyticsQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-31' });
    expect(issuePaths(result)).toEqual(['from']);
  });

  it(`accepts at most ${String(ANALYTICS_MAX_RANGE_DAYS)} days`, () => {
    // 2024 is a leap year: 2024-01-01 .. 2024-12-31 is exactly 366 days.
    expect(analyticsQuerySchema.safeParse({ from: '2024-01-01', to: '2024-12-31' }).success).toBe(
      true,
    );
    expect(
      issuePaths(analyticsQuerySchema.safeParse({ from: '2024-01-01', to: '2025-01-01' })),
    ).toEqual(['from']);
  });
});

describe('forecastQuerySchema', () => {
  it('parses count mode with defaults', () => {
    expect(forecastQuerySchema.parse({ mode: 'count' })).toEqual({
      mode: 'count',
      timeZone: 'UTC',
      sampleDays: FORECAST_DEFAULT_SAMPLE_DAYS,
    });
    expect(
      forecastQuerySchema.parse({
        mode: 'count',
        remaining: '12',
        sampleDays: '60',
        timeZone: 'Asia/Tokyo',
      }),
    ).toEqual({ mode: 'count', remaining: 12, sampleDays: 60, timeZone: 'Asia/Tokyo' });
  });

  it('parses date mode', () => {
    expect(forecastQuerySchema.parse({ mode: 'date', targetDate: '2026-12-24' })).toEqual({
      mode: 'date',
      targetDate: '2026-12-24',
      timeZone: 'UTC',
      sampleDays: FORECAST_DEFAULT_SAMPLE_DAYS,
    });
  });

  it.each([undefined, 'week', ''])('rejects the mode %j', (mode) => {
    expect(forecastQuerySchema.safeParse({ mode }).success).toBe(false);
  });

  it.each(['0', '-1', '1.5', 'abc', String(FORECAST_MAX_REMAINING + 1)])(
    'rejects remaining=%j',
    (remaining) => {
      expect(issuePaths(forecastQuerySchema.safeParse({ mode: 'count', remaining }))).toEqual([
        'remaining',
      ]);
    },
  );

  it('accepts the bounds of remaining', () => {
    for (const remaining of ['1', String(FORECAST_MAX_REMAINING)]) {
      expect(forecastQuerySchema.safeParse({ mode: 'count', remaining }).success).toBe(true);
    }
  });

  it.each(['6', '181', '30.5', 'x'])('rejects sampleDays=%j', (sampleDays) => {
    expect(issuePaths(forecastQuerySchema.safeParse({ mode: 'count', sampleDays }))).toEqual([
      'sampleDays',
    ]);
  });

  it('requires a valid targetDate in date mode', () => {
    expect(issuePaths(forecastQuerySchema.safeParse({ mode: 'date' }))).toEqual(['targetDate']);
    expect(
      issuePaths(forecastQuerySchema.safeParse({ mode: 'date', targetDate: '2026-13-01' })),
    ).toEqual(['targetDate']);
  });

  it('rejects an invalid time zone', () => {
    expect(
      issuePaths(forecastQuerySchema.safeParse({ mode: 'count', timeZone: 'Nowhere' })),
    ).toEqual(['timeZone']);
  });
});

const sampleAnalytics: AnalyticsResponse = {
  range: { from: '2026-11-01', to: '2026-11-02', timeZone: 'UTC' },
  generatedAt: '2026-11-02T12:00:00.000Z',
  leadCycle: {
    points: [
      {
        cardId: 'c1',
        cardKey: 'DEMO-1',
        title: 'Checkout',
        completedAt: '2026-11-01T10:00:00.000Z',
        leadTimeDays: 3.5,
        cycleTimeDays: null,
      },
    ],
    leadTime: { count: 1, p50: 3.5, p85: null, p95: null },
    cycleTime: { count: 0, p50: null, p85: null, p95: null },
  },
  throughput: {
    daily: [
      { date: '2026-11-01', count: 1 },
      { date: '2026-11-02', count: 0 },
    ],
    weekly: [
      { weekStart: '2026-10-26', count: 1 },
      { weekStart: '2026-11-02', count: 0 },
    ],
  },
  cumulativeFlow: [
    { date: '2026-11-01', BACKLOG: 1, TODO: 0, IN_PROGRESS: 1, DONE: 1, unknown: 0 },
    { date: '2026-11-02', BACKLOG: 1, TODO: 0, IN_PROGRESS: 1, DONE: 1, unknown: 0 },
  ],
  aging: {
    thresholdDays: null,
    items: [
      {
        cardId: 'c2',
        cardKey: 'DEMO-2',
        title: 'Search',
        columnId: 'col',
        columnName: 'In Progress',
        assignee: { id: 'u1', name: 'Anna' },
        cycleStartedAt: '2026-10-30T09:00:00.000Z',
        ageDays: 3.125,
        isAging: false,
      },
    ],
  },
  littlesLaw: {
    avgWip: 1,
    avgThroughputPerDay: 0.5,
    avgCycleTimeDays: null,
    predictedWip: null,
    relativeError: null,
  },
};

describe('analyticsResponseSchema', () => {
  it('accepts a complete response', () => {
    expect(analyticsResponseSchema.parse(sampleAnalytics)).toEqual(sampleAnalytics);
  });

  it('rejects instants that are not ISO strings and negative counts', () => {
    expect(
      analyticsResponseSchema.safeParse({ ...sampleAnalytics, generatedAt: 'yesterday' }).success,
    ).toBe(false);
    expect(
      analyticsResponseSchema.safeParse({
        ...sampleAnalytics,
        throughput: { ...sampleAnalytics.throughput, daily: [{ date: '2026-11-01', count: -1 }] },
      }).success,
    ).toBe(false);
  });
});

describe('forecastResponseSchema', () => {
  const common = {
    startDate: '2026-11-17',
    timeZone: 'UTC',
    sample: { days: 30, from: '2026-10-17', to: '2026-11-15', totalCompleted: 30 },
  };

  it('accepts every status of both modes', () => {
    const responses = [
      {
        mode: 'count',
        remaining: 3,
        ...common,
        status: 'ok',
        trials: 10_000,
        percentiles: {
          p50: { date: '2026-11-20', days: 3 },
          p85: { date: '2026-11-20', days: 3 },
          p95: { date: '2026-11-20', days: 3 },
        },
        distribution: [{ date: '2026-11-20', days: 3, trials: 10_000, cumulativeProbability: 1 }],
      },
      { mode: 'count', remaining: 3, ...common, status: 'insufficient_data', reason: 'no_samples' },
      { mode: 'count', remaining: 3, ...common, status: 'horizon_exceeded', maxHorizonDays: 3650 },
      {
        mode: 'date',
        targetDate: '2026-11-20',
        ...common,
        status: 'ok',
        days: 3,
        trials: 10_000,
        percentiles: { p50: 3, p85: 3, p95: 3 },
        distribution: [{ cards: 3, trials: 10_000, probabilityAtLeast: 1 }],
      },
      {
        mode: 'date',
        targetDate: '2026-11-20',
        ...common,
        status: 'insufficient_data',
        reason: 'zero_throughput',
      },
    ];
    for (const response of responses) {
      expect(forecastResponseSchema.parse(response)).toEqual(response);
    }
  });

  it('rejects mode-specific fields of the other mode', () => {
    expect(
      forecastResponseSchema.safeParse({
        mode: 'date',
        remaining: 3,
        ...common,
        status: 'insufficient_data',
        reason: 'no_samples',
      }).success,
    ).toBe(false);
  });
});
