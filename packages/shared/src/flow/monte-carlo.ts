import {
  DEFAULT_TIME_ZONE,
  type LocalDateKey,
  addDays,
  assertValidTimeZone,
  daysBetween,
  toLocalDateKey,
} from './dates.js';
import { FlowError, assertFiniteNumber, assertIntegerInRange, assertValidDate } from './errors.js';
import { percentileOfSorted } from './percentile.js';
import type { RandomSource } from './random.js';

/**
 * Monte Carlo throughput forecast (WF-FLOW-05).
 *
 * Every trial simulates future days one by one; the throughput of each day is drawn uniformly
 * WITH replacement from the historical daily samples (by default the last 30 days, see
 * `dailyThroughputSamples`).
 *
 * Day-count convention (same in both modes): simulated days are calendar days starting with
 * the day AFTER the local date of `startDate`; the start day itself is never simulated (it is
 * usually partly over). A forecast of `d` days therefore ends on `startDate + d` days, and
 * "how many by `targetDate`" simulates the days `startDate + 1 ... targetDate` inclusive.
 *
 * Samples should cover COMPLETE days only: build them with `dailyThroughputSamples` ending on
 * the last complete local day (e.g. yesterday). Including today, which is still in progress,
 * adds an artificially low sample and biases both forecasts towards fewer cards / later dates.
 */

/** Default number of trials. */
export const DEFAULT_TRIALS = 10_000;
/**
 * Smallest accepted number of trials. Below ~1 000 the 95th percentile is unstable between
 * runs; production code uses {@link DEFAULT_TRIALS}.
 */
export const MIN_TRIALS = 1_000;
/** Largest accepted number of trials (bounds the computation time). */
export const MAX_TRIALS = 1_000_000;
/**
 * A trial that needs more days than this is aborted and the whole forecast returns
 * `horizon_exceeded` instead of looping (almost) forever on very low throughput.
 */
export const MAX_FORECAST_HORIZON_DAYS = 3650;

export interface ForecastBaseOptions {
  /** Historical daily throughput (non-negative numbers), sampled with replacement. */
  samples: readonly number[];
  /** The forecast starts on the day after the local date of this instant. */
  startDate: Date;
  timeZone?: string;
  /** Number of trials, {@link MIN_TRIALS}..{@link MAX_TRIALS}; default {@link DEFAULT_TRIALS}. */
  trials?: number;
  /** Random source, default `Math.random`; inject `mulberry32(seed)` for reproducible results. */
  random?: RandomSource;
}

export interface ForecastWhenOptions extends ForecastBaseOptions {
  /** Number of cards still to complete (integer); `<= 0` gives an immediate result. */
  remaining: number;
}

export interface ForecastHowManyOptions extends ForecastBaseOptions {
  /** Last simulated day (inclusive) is the local date of this instant. */
  targetDate: Date;
}

export interface ForecastInsufficientData {
  status: 'insufficient_data';
  reason: 'no_samples' | 'zero_throughput';
}

export interface ForecastHorizonExceeded {
  status: 'horizon_exceeded';
  maxHorizonDays: number;
}

export interface WhenForecastPoint {
  /** Local date by which the cards are completed. */
  date: LocalDateKey;
  /** Days after the start date. */
  days: number;
}

export interface WhenDistributionEntry extends WhenForecastPoint {
  /** Number of trials finishing exactly on this date. */
  trials: number;
  /** Share of trials finishing on or before this date. */
  cumulativeProbability: number;
}

export interface ForecastWhenResult {
  status: 'ok';
  startDate: LocalDateKey;
  remaining: number;
  trials: number;
  /** `p85` = the date by which 85% of the trials finished (likewise 50 and 95). */
  percentiles: { p50: WhenForecastPoint; p85: WhenForecastPoint; p95: WhenForecastPoint };
  /** Sorted by date ascending. */
  distribution: WhenDistributionEntry[];
}

export interface HowManyDistributionEntry {
  /** Number of completed cards. */
  cards: number;
  /** Number of trials with exactly this outcome. */
  trials: number;
  /** Share of trials completing at least `cards` cards. */
  probabilityAtLeast: number;
}

export interface ForecastHowManyResult {
  status: 'ok';
  startDate: LocalDateKey;
  targetDate: LocalDateKey;
  /** Number of simulated days. */
  days: number;
  trials: number;
  /**
   * "With X% confidence at least N cards": for confidence `c` the value is the LARGEST
   * outcome `v` with P(outcome >= v) >= c, i.e. `sorted[n - ceil(c * n)]` of the ascending
   * outcomes (`p50`, `p85`, `p95` for c = 0.50, 0.85, 0.95). Hence `p95 <= p85 <= p50`.
   */
  percentiles: { p50: number; p85: number; p95: number };
  /** Sorted by `cards` ascending. */
  distribution: HowManyDistributionEntry[];
}

export type ForecastWhenOutcome =
  ForecastWhenResult | ForecastInsufficientData | ForecastHorizonExceeded;

export type ForecastHowManyOutcome =
  ForecastHowManyResult | ForecastInsufficientData | ForecastHorizonExceeded;

interface ResolvedBase {
  samples: readonly number[];
  startKey: LocalDateKey;
  timeZone: string;
  trials: number;
  random: RandomSource;
}

function resolveBase(options: ForecastBaseOptions): ResolvedBase {
  if (!Array.isArray(options.samples)) {
    throw new FlowError('INVALID_ARGUMENT', 'Invalid samples: expected an array');
  }
  for (const sample of options.samples) {
    assertFiniteNumber(sample, 'throughput sample');
    if (sample < 0) {
      throw new FlowError('INVALID_ARGUMENT', 'Throughput samples must not be negative');
    }
  }
  assertValidDate(options.startDate, 'startDate');
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  assertValidTimeZone(timeZone);
  const trials = options.trials ?? DEFAULT_TRIALS;
  assertIntegerInRange(trials, 'trials', MIN_TRIALS, MAX_TRIALS);
  const random = options.random ?? Math.random;
  if (typeof random !== 'function') {
    throw new FlowError('INVALID_ARGUMENT', 'Invalid random: expected a function');
  }
  return {
    samples: options.samples,
    startKey: toLocalDateKey(options.startDate, timeZone),
    timeZone,
    trials,
    random,
  };
}

function insufficientData(samples: readonly number[]): ForecastInsufficientData | null {
  if (samples.length === 0) return { status: 'insufficient_data', reason: 'no_samples' };
  if (samples.every((s) => s === 0)) {
    return { status: 'insufficient_data', reason: 'zero_throughput' };
  }
  return null;
}

function drawSample(samples: readonly number[], random: RandomSource): number {
  const r = random();
  if (!(r >= 0 && r < 1)) {
    throw new FlowError('INVALID_ARGUMENT', 'Random source must return numbers in [0, 1)');
  }
  return samples[Math.min(samples.length - 1, Math.floor(r * samples.length))] ?? 0;
}

/** Counts of each distinct value, sorted by value ascending. */
function histogram(sorted: readonly number[]): { value: number; count: number }[] {
  const result: { value: number; count: number }[] = [];
  for (const value of sorted) {
    const last = result.at(-1);
    if (last && last.value === value) last.count++;
    else result.push({ value, count: 1 });
  }
  return result;
}

/**
 * Largest value `v` of ascending `sorted` such that at least `confidence`% of the values are
 * `>= v`: index `n - ceil(confidence * n / 100)`.
 */
function atLeastPercentile(sorted: readonly number[], confidence: number): number {
  const n = sorted.length;
  const needed = Math.max(1, Math.ceil((confidence * n) / 100));
  return sorted[n - needed] ?? 0;
}

function sortedOutcomes(outcomes: Float64Array): number[] {
  return Array.from(outcomes.sort());
}

/** "When will `remaining` cards be completed?" — distribution of completion dates. */
export function forecastWhen(options: ForecastWhenOptions): ForecastWhenOutcome {
  const base = resolveBase(options);
  if (!Number.isSafeInteger(options.remaining)) {
    throw new FlowError('INVALID_ARGUMENT', 'Invalid remaining: expected an integer');
  }
  const { remaining } = options;
  const { samples, startKey, trials, random } = base;

  const outcomes = new Float64Array(trials);
  if (remaining > 0) {
    const missing = insufficientData(samples);
    if (missing) return missing;
    for (let trial = 0; trial < trials; trial++) {
      let done = 0;
      let days = 0;
      while (done < remaining) {
        days++;
        if (days > MAX_FORECAST_HORIZON_DAYS) {
          return { status: 'horizon_exceeded', maxHorizonDays: MAX_FORECAST_HORIZON_DAYS };
        }
        done += drawSample(samples, random);
      }
      outcomes[trial] = days;
    }
  }

  const sorted = sortedOutcomes(outcomes);
  const point = (p: number): WhenForecastPoint => {
    const days = percentileOfSorted(sorted, p) ?? 0;
    return { date: addDays(startKey, days), days };
  };
  let cumulative = 0;
  const distribution = histogram(sorted).map(({ value, count }) => {
    cumulative += count;
    return {
      date: addDays(startKey, value),
      days: value,
      trials: count,
      cumulativeProbability: cumulative / trials,
    };
  });

  return {
    status: 'ok',
    startDate: startKey,
    remaining,
    trials,
    percentiles: { p50: point(50), p85: point(85), p95: point(95) },
    distribution,
  };
}

/** "How many cards will be completed by `targetDate`?" — distribution of completed counts. */
export function forecastHowMany(options: ForecastHowManyOptions): ForecastHowManyOutcome {
  const base = resolveBase(options);
  assertValidDate(options.targetDate, 'targetDate');
  const { samples, startKey, timeZone, trials, random } = base;
  const targetKey = toLocalDateKey(options.targetDate, timeZone);
  const days = daysBetween(startKey, targetKey);
  if (days < 0) {
    throw new FlowError('INVALID_ARGUMENT', '`targetDate` must not be before `startDate`');
  }

  const outcomes = new Float64Array(trials);
  if (days > 0) {
    const missing = insufficientData(samples);
    if (missing) return missing;
    if (days > MAX_FORECAST_HORIZON_DAYS) {
      return { status: 'horizon_exceeded', maxHorizonDays: MAX_FORECAST_HORIZON_DAYS };
    }
    for (let trial = 0; trial < trials; trial++) {
      let done = 0;
      for (let day = 0; day < days; day++) done += drawSample(samples, random);
      outcomes[trial] = done;
    }
  }

  const sorted = sortedOutcomes(outcomes);
  let atLeast = trials;
  const distribution = histogram(sorted).map(({ value, count }) => {
    const entry = { cards: value, trials: count, probabilityAtLeast: atLeast / trials };
    atLeast -= count;
    return entry;
  });

  return {
    status: 'ok',
    startDate: startKey,
    targetDate: targetKey,
    days,
    trials,
    percentiles: {
      p50: atLeastPercentile(sorted, 50),
      p85: atLeastPercentile(sorted, 85),
      p95: atLeastPercentile(sorted, 95),
    },
    distribution,
  };
}
