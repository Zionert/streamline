import { describe, expect, it } from 'vitest';

import { SCATTER_POINTS, analyticsWith } from '@/test/flowFixtures';

import {
  LITTLES_LAW_MESSAGES,
  cfdCategories,
  completedCount,
  cumulativeFlowSummary,
  cycleTimePoints,
  cycleTimeSummary,
  littlesLawVerdict,
  percentileLabel,
  percentileLines,
  throughputSeries,
  throughputSummary,
} from './flowMetrics';

const law = (relativeError: number | null) => ({
  avgWip: 4,
  avgThroughputPerDay: 1,
  avgCycleTimeDays: relativeError === null ? null : 4,
  predictedWip: relativeError === null ? null : 4,
  relativeError,
});

describe('throughput', () => {
  const { throughput } = analyticsWith();

  it('counts the completed cards of the range', () => {
    expect(completedCount(throughput)).toBe(7);
  });

  it('averages per day and per week', () => {
    const daily = throughputSeries(throughput, 'day');
    expect(daily.bars).toHaveLength(30);
    expect(daily.averageLabel).toBe('avg 0.2 / day');

    const weekly = throughputSeries(throughput, 'week');
    expect(weekly.bars.map((bar) => bar.date)).toEqual([
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ]);
    expect(weekly.average).toBeCloseTo((7 / 30) * 7);
    expect(weekly.averageLabel).toBe('avg 1.6 / week');
  });

  it('bases the weekly average on the daily rate, so a partial last week does not lower it', () => {
    // A full week (Mon 2 Nov - Sun 8 Nov) with 7 cards, then Mon-Wed with 3: one card a day.
    const daily = Array.from({ length: 10 }, (_, index) => ({
      date: `2026-11-${String(index + 2).padStart(2, '0')}`,
      count: 1,
    }));
    const weekly = [
      { weekStart: '2026-11-02', count: 7 },
      { weekStart: '2026-11-09', count: 3 },
    ];

    const series = throughputSeries({ daily, weekly }, 'week');

    // Averaging the two bars would give 5.
    expect(series.average).toBe(7);
    expect(series.averageLabel).toBe('avg 7 / week');
    expect(throughputSummary(series, 'week')).toContain('average 7 / week');
    expect(throughputSeries({ daily, weekly }, 'day').averageLabel).toBe('avg 1.0 / day');
  });

  it('averages an empty series as zero', () => {
    expect(throughputSeries({ daily: [], weekly: [] }, 'week').averageLabel).toBe('avg 0 / week');
  });

  it('describes the series', () => {
    expect(throughputSummary(throughputSeries(throughput, 'week'), 'week')).toBe(
      'Throughput per week: 7 cards completed over 5 weeks, average 1.6 / week, highest 2 in the week of 26 Oct.',
    );
  });
});

describe('cycle time', () => {
  it('plots only the cards with a cycle time', () => {
    const { plotted, withoutCycleTime } = cycleTimePoints(SCATTER_POINTS);
    expect(plotted).toHaveLength(6);
    expect(withoutCycleTime).toBe(1);
  });

  it('draws only the known percentiles', () => {
    expect(percentileLines({ count: 3, p50: 4.1, p85: null, p95: null })).toEqual([
      { key: 'p50', value: 4.1 },
    ]);
    expect(percentileLines({ count: 0, p50: null, p85: null, p95: null })).toEqual([]);
    expect(percentileLabel('p85', 8.25)).toBe('p85 · 8.3 d');
  });

  it('describes the chart, with the percentiles that are known', () => {
    const range = { from: '2026-10-19', to: '2026-11-17', timeZone: 'UTC' };
    expect(cycleTimeSummary({ count: 3, p50: 4.1, p85: null, p95: null }, 3, range)).toBe(
      'Cycle time of 3 cards completed 19 Oct – 17 Nov: p50 4.1 days.',
    );
    expect(cycleTimeSummary({ count: 0, p50: null, p85: null, p95: null }, 0, range)).toBe(
      'Cycle time of 0 cards completed 19 Oct – 17 Nov.',
    );
  });
});

describe('cumulative flow', () => {
  it('lists the categories top to bottom, Unknown only when it has cards', () => {
    const { cumulativeFlow } = analyticsWith();
    expect(cfdCategories(cumulativeFlow).map((category) => category.key)).toEqual([
      'BACKLOG',
      'TODO',
      'IN_PROGRESS',
      'DONE',
    ]);
    const withUnknown = cumulativeFlow.map((point, index) => ({
      ...point,
      unknown: index === 0 ? 2 : 0,
    }));
    expect(cfdCategories(withUnknown).map((category) => category.label)).toEqual([
      'Unknown',
      'Backlog',
      'To do',
      'In progress',
      'Done',
    ]);
  });

  it('describes the last day', () => {
    const { cumulativeFlow } = analyticsWith();
    expect(cumulativeFlowSummary(cumulativeFlow, cfdCategories(cumulativeFlow))).toBe(
      'Cumulative flow 19 Oct – 17 Nov. Cards at the end: Backlog 5, To do 3, In progress 2, Done 25.',
    );
    expect(cumulativeFlowSummary([], [])).toBe('Cumulative flow: no data.');
  });
});

describe("Little's law verdict", () => {
  it.each([
    [0, 'stable'],
    [0.2, 'stable'],
    [-0.2, 'stable'],
    [0.2001, 'piling-up'],
    [1.5, 'piling-up'],
    [-0.2001, 'below-prediction'],
    [-0.9, 'below-prediction'],
    [null, 'unknown'],
  ] as const)('%s is %s', (relativeError, verdict) => {
    expect(littlesLawVerdict(law(relativeError))).toBe(verdict);
  });

  it('is unknown without a prediction even if a gap is given', () => {
    expect(littlesLawVerdict({ ...law(0.1), predictedWip: null })).toBe('unknown');
    expect(LITTLES_LAW_MESSAGES.unknown).toBe(
      'Not enough completed cards in this period to check.',
    );
  });
});
