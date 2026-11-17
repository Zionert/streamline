import { describe, expect, it } from 'vitest';

import { FlowError } from './errors.js';
import { MIN_PERCENTILE_SAMPLE, flowPercentiles, percentile } from './percentile.js';

describe('percentile (nearest rank)', () => {
  it('returns null for no samples', () => {
    expect(percentile([], 50)).toBeNull();
  });

  it('returns the only sample for n = 1', () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 100)).toBe(7);
  });

  it('uses rank ceil(p/100 * n) on unsorted input', () => {
    const values = [40, 10, 30, 20];
    expect(percentile(values, 25)).toBe(10); // rank 1
    expect(percentile(values, 26)).toBe(20); // rank ceil(1.04) = 2
    expect(percentile(values, 50)).toBe(20); // rank 2
    expect(percentile(values, 85)).toBe(40); // rank ceil(3.4) = 4
    expect(values).toEqual([40, 10, 30, 20]);
  });

  it('is exact at integer ranks (85% of 20 is rank 17)', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 85)).toBe(17);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile(values, 100)).toBe(20);
  });

  it('rejects invalid percentiles and samples', () => {
    expect(() => percentile([1], 101)).toThrow(FlowError);
    expect(() => percentile([1], -1)).toThrow(FlowError);
    expect(() => percentile([1], Number.NaN)).toThrow(FlowError);
    expect(() => percentile([1, Number.POSITIVE_INFINITY], 50)).toThrow(FlowError);
  });
});

describe('flowPercentiles', () => {
  it('n = 0: everything null', () => {
    expect(flowPercentiles([])).toEqual({ count: 0, p50: null, p85: null, p95: null });
  });

  it('n = 1: only p50', () => {
    expect(flowPercentiles([3])).toEqual({ count: 1, p50: 3, p85: null, p95: null });
  });

  it('n = 4: tail percentiles are still null', () => {
    expect(MIN_PERCENTILE_SAMPLE).toBe(5);
    expect(flowPercentiles([4, 1, 3, 2])).toEqual({ count: 4, p50: 2, p85: null, p95: null });
  });

  it('n = 5: all percentiles', () => {
    // ranks: p50 ceil(2.5) = 3, p85 ceil(4.25) = 5, p95 ceil(4.75) = 5
    expect(flowPercentiles([5, 1, 4, 2, 3])).toEqual({ count: 5, p50: 3, p85: 5, p95: 5 });
  });
});
