import { describe, expect, it } from 'vitest';

import { FlowError } from './errors.js';
import {
  DEFAULT_TRIALS,
  MAX_FORECAST_HORIZON_DAYS,
  MIN_TRIALS,
  type ForecastHowManyOutcome,
  type ForecastHowManyResult,
  type ForecastWhenOutcome,
  type ForecastWhenResult,
  forecastHowMany,
  forecastWhen,
} from './monte-carlo.js';
import { mulberry32 } from './random.js';

const startDate = new Date('2026-11-17T10:00:00Z');
const samples = [0, 1, 3, 0, 2, 5, 1, 0, 4, 2, 1, 0, 0, 3, 2];

function okWhen(outcome: ForecastWhenOutcome): ForecastWhenResult {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.status}`);
  return outcome;
}

function okHowMany(outcome: ForecastHowManyOutcome): ForecastHowManyResult {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.status}`);
  return outcome;
}

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const fromA = Array.from({ length: 1000 }, a);
    expect(Array.from({ length: 1000 }, b)).toEqual(fromA);
    expect(c()).not.toBe(fromA[0]);
    expect(fromA.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('forecastWhen', () => {
  it('constant throughput: 2 per day, 10 remaining -> exactly 5 days', () => {
    const result = okWhen(
      forecastWhen({ samples: [2, 2, 2], remaining: 10, startDate, random: mulberry32(1) }),
    );
    expect(result.trials).toBe(DEFAULT_TRIALS);
    expect(result.startDate).toBe('2026-11-17');
    const expected = { date: '2026-11-22', days: 5 };
    expect(result.percentiles).toEqual({ p50: expected, p85: expected, p95: expected });
    expect(result.distribution).toEqual([
      { ...expected, trials: DEFAULT_TRIALS, cumulativeProbability: 1 },
    ]);
  });

  it('is deterministic with a seeded random source', () => {
    const run = () => forecastWhen({ samples, remaining: 30, startDate, random: mulberry32(2026) });
    expect(run()).toEqual(run());
  });

  it('percentile dates are monotonic and match the distribution', () => {
    const result = okWhen(
      forecastWhen({ samples, remaining: 30, startDate, random: mulberry32(7) }),
    );
    const { p50, p85, p95 } = result.percentiles;
    expect(p50.days).toBeLessThanOrEqual(p85.days);
    expect(p85.days).toBeLessThanOrEqual(p95.days);
    expect(p50.date <= p85.date && p85.date <= p95.date).toBe(true);

    const total = result.distribution.reduce((sum, e) => sum + e.trials, 0);
    expect(total).toBe(result.trials);
    expect(result.distribution.at(-1)?.cumulativeProbability).toBe(1);
    const at85 = result.distribution.find((e) => e.days === p85.days);
    expect(at85?.cumulativeProbability).toBeGreaterThanOrEqual(0.85);
    const before85 = result.distribution.filter((e) => e.days < p85.days).at(-1);
    expect(before85?.cumulativeProbability ?? 0).toBeLessThan(0.85);
    // Mean throughput ~1.6/day -> roughly 19 days for 30 cards.
    expect(p50.days).toBeGreaterThan(12);
    expect(p50.days).toBeLessThan(28);
  });

  it('dates are calendar days in the time zone, starting the day after startDate', () => {
    // 23:30 UTC on Nov 17 is Nov 18 in Warsaw.
    const late = new Date('2026-11-17T23:30:00Z');
    const base = { samples: [1], remaining: 2, startDate: late, trials: MIN_TRIALS };
    expect(okWhen(forecastWhen(base)).percentiles.p50.date).toBe('2026-11-19');
    expect(okWhen(forecastWhen({ ...base, timeZone: 'Europe/Warsaw' })).percentiles.p50.date).toBe(
      '2026-11-20',
    );
  });

  it('remaining <= 0 finishes on the start date without data', () => {
    for (const remaining of [0, -3]) {
      const result = okWhen(forecastWhen({ samples: [], remaining, startDate }));
      expect(result.percentiles.p95).toEqual({ date: '2026-11-17', days: 0 });
    }
  });

  it('returns insufficient_data for empty or all-zero history', () => {
    expect(forecastWhen({ samples: [], remaining: 5, startDate })).toEqual({
      status: 'insufficient_data',
      reason: 'no_samples',
    });
    expect(forecastWhen({ samples: [0, 0, 0], remaining: 5, startDate })).toEqual({
      status: 'insufficient_data',
      reason: 'zero_throughput',
    });
  });

  it('returns horizon_exceeded instead of running forever', () => {
    expect(
      forecastWhen({
        samples: [1],
        remaining: MAX_FORECAST_HORIZON_DAYS + 1,
        startDate,
        trials: MIN_TRIALS,
      }),
    ).toEqual({ status: 'horizon_exceeded', maxHorizonDays: MAX_FORECAST_HORIZON_DAYS });
    expect(
      okWhen(forecastWhen({ samples: [1], remaining: MAX_FORECAST_HORIZON_DAYS, startDate }))
        .percentiles.p50.days,
    ).toBe(MAX_FORECAST_HORIZON_DAYS);
  });

  it('rejects invalid arguments with INVALID_ARGUMENT', () => {
    const base = { samples: [1], remaining: 5, startDate };
    const invalid = [
      { ...base, remaining: Number.NaN },
      { ...base, remaining: 2.5 },
      { ...base, remaining: Number.POSITIVE_INFINITY },
      { ...base, samples: [1, -1] },
      { ...base, samples: [Number.POSITIVE_INFINITY] },
      { ...base, startDate: new Date('x') },
      { ...base, trials: MIN_TRIALS - 1 },
      { ...base, trials: 1500.5 },
      { ...base, random: () => 1 },
    ];
    for (const options of invalid) {
      expect(() => forecastWhen(options)).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    }
    expect(() => forecastWhen({ ...base, timeZone: 'Bad/Zone' })).toThrow(FlowError);
  });
});

describe('forecastHowMany', () => {
  const targetDate = new Date('2026-11-27T10:00:00Z'); // 10 days after the start

  it('constant throughput: 2 per day for 10 days -> exactly 20 cards', () => {
    const result = okHowMany(
      forecastHowMany({ samples: [2, 2], targetDate, startDate, random: mulberry32(1) }),
    );
    expect(result.days).toBe(10);
    expect(result.targetDate).toBe('2026-11-27');
    expect(result.percentiles).toEqual({ p50: 20, p85: 20, p95: 20 });
    expect(result.distribution).toEqual([
      { cards: 20, trials: DEFAULT_TRIALS, probabilityAtLeast: 1 },
    ]);
  });

  it('is deterministic with a seeded random source', () => {
    const run = () => forecastHowMany({ samples, targetDate, startDate, random: mulberry32(9) });
    expect(run()).toEqual(run());
  });

  it('higher confidence means fewer cards (p95 <= p85 <= p50)', () => {
    const result = okHowMany(
      forecastHowMany({ samples, targetDate, startDate, random: mulberry32(11) }),
    );
    const { p50, p85, p95 } = result.percentiles;
    expect(p95).toBeLessThanOrEqual(p85);
    expect(p85).toBeLessThanOrEqual(p50);
    expect(p95).toBeLessThan(p50);

    expect(result.distribution[0]?.probabilityAtLeast).toBe(1);
    // Mean throughput 1.6/day over 10 days -> around 16 cards.
    expect(p50).toBeGreaterThan(10);
    expect(p50).toBeLessThan(22);
  });

  it.each([
    [[0, 1, 3, 0, 2, 5, 1, 0, 4, 2], 1, 10_000],
    [[0, 0, 0, 1], 2, 1_000],
    [[1, 2, 3], 3, 1_234],
    [[7, 0, 0, 0, 0, 0, 0], 4, 5_000],
  ])(
    'each confidence value is the largest count reached by at least that share (%j, seed %i)',
    (history, seed, trials) => {
      const result = okHowMany(
        forecastHowMany({
          samples: history,
          targetDate,
          startDate,
          trials,
          random: mulberry32(seed),
        }),
      );
      const checks: [number, number][] = [
        [0.5, result.percentiles.p50],
        [0.85, result.percentiles.p85],
        [0.95, result.percentiles.p95],
      ];
      for (const [confidence, value] of checks) {
        const entry = result.distribution.find((e) => e.cards === value);
        expect(entry?.probabilityAtLeast).toBeGreaterThanOrEqual(confidence);
        for (const larger of result.distribution.filter((e) => e.cards > value)) {
          expect(larger.probabilityAtLeast).toBeLessThan(confidence);
        }
      }
    },
  );

  it('counts the days after startDate up to targetDate inclusive, in the time zone', () => {
    const base = { samples: [1], startDate, trials: MIN_TRIALS };
    const sameDay = okHowMany(
      forecastHowMany({ ...base, targetDate: new Date('2026-11-17T23:00:00Z') }),
    );
    expect(sameDay.days).toBe(0);
    expect(sameDay.percentiles).toEqual({ p50: 0, p85: 0, p95: 0 });
    // 23:30 UTC on Nov 17 is Nov 18 in Warsaw -> one simulated day there.
    const warsaw = okHowMany(
      forecastHowMany({
        ...base,
        targetDate: new Date('2026-11-17T23:30:00Z'),
        timeZone: 'Europe/Warsaw',
      }),
    );
    expect(warsaw.days).toBe(1);
    expect(warsaw.percentiles.p50).toBe(1);
  });

  it('is consistent with forecastWhen for the same day convention', () => {
    const when = okWhen(
      forecastWhen({ samples: [3], remaining: 9, startDate, trials: MIN_TRIALS }),
    );
    const howMany = okHowMany(
      forecastHowMany({
        samples: [3],
        startDate,
        targetDate: new Date(`${when.percentiles.p50.date}T12:00:00Z`),
        trials: MIN_TRIALS,
      }),
    );
    expect(howMany.percentiles.p50).toBe(9);
  });

  it('returns insufficient_data and horizon_exceeded results', () => {
    expect(forecastHowMany({ samples: [], targetDate, startDate })).toEqual({
      status: 'insufficient_data',
      reason: 'no_samples',
    });
    expect(forecastHowMany({ samples: [0, 0], targetDate, startDate })).toEqual({
      status: 'insufficient_data',
      reason: 'zero_throughput',
    });
    expect(
      forecastHowMany({ samples: [1], targetDate: new Date('2040-01-01T00:00:00Z'), startDate }),
    ).toEqual({ status: 'horizon_exceeded', maxHorizonDays: MAX_FORECAST_HORIZON_DAYS });
  });

  it('rejects a target before the start and invalid dates', () => {
    expect(() =>
      forecastHowMany({ samples: [1], startDate, targetDate: new Date('2026-11-16T10:00:00Z') }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => forecastHowMany({ samples: [1], startDate, targetDate: new Date('x') })).toThrow(
      FlowError,
    );
  });
});

describe('maxHorizonDays option', () => {
  const base = { samples: [1], startDate, trials: MIN_TRIALS };

  it('lowers the horizon of both forecasts', () => {
    expect(forecastWhen({ ...base, remaining: 31, maxHorizonDays: 30 })).toEqual({
      status: 'horizon_exceeded',
      maxHorizonDays: 30,
    });
    expect(
      okWhen(forecastWhen({ ...base, remaining: 30, maxHorizonDays: 30 })).percentiles.p95,
    ).toEqual({ date: '2026-12-17', days: 30 });

    expect(
      forecastHowMany({
        ...base,
        targetDate: new Date('2026-12-18T10:00:00Z'),
        maxHorizonDays: 30,
      }),
    ).toEqual({ status: 'horizon_exceeded', maxHorizonDays: 30 });
    expect(
      okHowMany(
        forecastHowMany({
          ...base,
          targetDate: new Date('2026-12-17T10:00:00Z'),
          maxHorizonDays: 30,
        }),
      ).percentiles.p50,
    ).toBe(30);
  });

  it.each([0, 1.5, MAX_FORECAST_HORIZON_DAYS + 1, Number.NaN])(
    'rejects maxHorizonDays=%s',
    (maxHorizonDays) => {
      expect(() => forecastWhen({ ...base, remaining: 1, maxHorizonDays })).toThrow(FlowError);
      expect(() => forecastHowMany({ ...base, targetDate: startDate, maxHorizonDays })).toThrow(
        FlowError,
      );
    },
  );
});
