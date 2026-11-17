import { describe, expect, it } from 'vitest';

import { at, flowCard } from '../../test-utils/flow.js';
import { littlesLaw } from './littles-law.js';

/**
 * Steady state: every day at 09:00 one card is created in IN_PROGRESS and it is done exactly
 * two days later. At the end of any day the cards started that day and the day before are in
 * progress (WIP 2), one card finishes per day (throughput 1) and cycle time is 2 days, so
 * Little's law predicts WIP = 1 x 2 = 2.
 */
function steadyState(count: number) {
  return Array.from({ length: count }, (_, i) =>
    flowCard(`c${i}`, [
      [new Date(Date.UTC(2026, 0, 1 + i, 9)).toISOString(), 'IN_PROGRESS'],
      [new Date(Date.UTC(2026, 0, 3 + i, 9)).toISOString(), 'DONE'],
    ]),
  );
}

describe('littlesLaw', () => {
  it('matches a hand-computed steady state exactly', () => {
    const result = littlesLaw(steadyState(20), {
      from: at('2026-01-06T00:00:00Z'),
      to: at('2026-01-15T00:00:00Z'),
    });
    expect(result).toEqual({
      days: 10,
      avgWip: 2,
      avgThroughputPerDay: 1,
      avgCycleTimeDays: 2,
      predictedWip: 2,
      relativeError: 0,
    });
  });

  it('reports the relative error of observed vs predicted WIP', () => {
    // Range Jan 1-2: WIP end of Jan 1 = 1, Jan 2 = 2 -> avg 1.5; completions: none.
    const early = littlesLaw(steadyState(20), {
      from: at('2026-01-01T00:00:00Z'),
      to: at('2026-01-02T00:00:00Z'),
    });
    expect(early.avgWip).toBe(1.5);
    expect(early.avgThroughputPerDay).toBe(0);
    expect(early.avgCycleTimeDays).toBeNull();
    expect(early.predictedWip).toBeNull();
    expect(early.relativeError).toBeNull();

    // Range Jan 3-4: WIP 2 and 2, completions 2 in 2 days, cycle 2 -> predicted 2.
    // Add a stale card that stays in progress to make WIP 3 -> error +50%.
    const stale = flowCard('stale', [['2025-12-01T00:00:00Z', 'IN_PROGRESS']]);
    const skewed = littlesLaw([...steadyState(20), stale], {
      from: at('2026-01-03T00:00:00Z'),
      to: at('2026-01-04T00:00:00Z'),
    });
    expect(skewed.avgWip).toBe(3);
    expect(skewed.predictedWip).toBe(2);
    expect(skewed.relativeError).toBe(0.5);
  });

  it('counts completions without cycle time in throughput only', () => {
    const cards = [
      flowCard('a', [
        ['2026-01-01T09:00:00Z', 'IN_PROGRESS'],
        ['2026-01-02T09:00:00Z', 'DONE'],
      ]),
      flowCard('b', [
        ['2026-01-01T09:00:00Z', 'TODO'],
        ['2026-01-02T10:00:00Z', 'DONE'],
      ]),
    ];
    const result = littlesLaw(cards, {
      from: at('2026-01-01T00:00:00Z'),
      to: at('2026-01-02T00:00:00Z'),
    });
    expect(result.avgThroughputPerDay).toBe(1);
    expect(result.avgCycleTimeDays).toBe(1);
    expect(result.predictedWip).toBe(1);
    expect(result.avgWip).toBe(0.5);
    expect(result.relativeError).toBe(-0.5);
  });
});
