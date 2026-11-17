import { FlowError, assertFiniteNumber } from './errors.js';

/**
 * Minimum number of samples for the 85th and 95th percentile. With fewer samples these tail
 * percentiles would just be the maximum, which is not a meaningful forecast.
 */
export const MIN_PERCENTILE_SAMPLE = 5;

export interface FlowPercentiles {
  count: number;
  /** `null` only when there are no samples. */
  p50: number | null;
  /** `null` when `count < MIN_PERCENTILE_SAMPLE`. */
  p85: number | null;
  /** `null` when `count < MIN_PERCENTILE_SAMPLE`. */
  p95: number | null;
}

function sortedCopy(values: readonly number[]): number[] {
  for (const value of values) assertFiniteNumber(value, 'sample');
  return [...values].sort((a, b) => a - b);
}

/** Nearest-rank percentile of already ascending-sorted values (no validation). */
export function percentileOfSorted(sorted: readonly number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  // `p * n` is computed before dividing so that e.g. 85% of 20 gives exactly 17.
  const rank = Math.max(1, Math.ceil((p * n) / 100));
  return sorted[Math.min(rank, n) - 1] ?? null;
}

/**
 * Nearest-rank percentile: the smallest sample such that at least `p`% of the samples are
 * less than or equal to it, i.e. the value at 1-based rank `ceil(p / 100 * n)` of the sorted
 * samples (rank 1 for `p = 0`). Always returns an actual sample, never an interpolated value.
 * Values may be unsorted; returns `null` for no samples.
 */
export function percentile(values: readonly number[], p: number): number | null {
  assertFiniteNumber(p, 'percentile');
  if (p < 0 || p > 100) {
    throw new FlowError('INVALID_ARGUMENT', 'Percentile must be between 0 and 100');
  }
  return percentileOfSorted(sortedCopy(values), p);
}

/** 50th, 85th and 95th nearest-rank percentiles; tail percentiles need 5 samples. */
export function flowPercentiles(values: readonly number[]): FlowPercentiles {
  const sorted = sortedCopy(values);
  const enough = sorted.length >= MIN_PERCENTILE_SAMPLE;
  return {
    count: sorted.length,
    p50: percentileOfSorted(sorted, 50),
    p85: enough ? percentileOfSorted(sorted, 85) : null,
    p95: enough ? percentileOfSorted(sorted, 95) : null,
  };
}
