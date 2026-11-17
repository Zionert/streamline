import { describe, expect, it } from 'vitest';

import { at, flowCard } from '../../test-utils/flow.js';
import { deriveCardFlow } from './card-flow.js';
import { FlowError } from './errors.js';
import { leadCycleStats } from './lead-cycle.js';
import { throughput } from './throughput.js';

const cards = [
  // lead 4, cycle 2, completed Jan 5
  flowCard('a', [
    ['2026-01-01T00:00:00Z', 'TODO'],
    ['2026-01-03T00:00:00Z', 'IN_PROGRESS'],
    ['2026-01-05T00:00:00Z', 'DONE'],
  ]),
  // never in progress: lead 1, no cycle, completed Jan 2
  flowCard('b', [
    ['2026-01-01T00:00:00Z', 'TODO'],
    ['2026-01-02T00:00:00Z', 'DONE'],
  ]),
  // created in DONE and never left: excluded
  flowCard('c', [['2026-01-01T00:00:00Z', 'DONE']]),
  // in progress: excluded
  flowCard('d', [['2026-01-01T00:00:00Z', 'IN_PROGRESS']]),
  // reopened, currently in progress: excluded
  flowCard('e', [
    ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
    ['2026-01-02T00:00:00Z', 'DONE'],
    ['2026-01-03T00:00:00Z', 'IN_PROGRESS'],
  ]),
];

describe('leadCycleStats', () => {
  it('returns scatter points of completed cards sorted by completion', () => {
    const stats = leadCycleStats(cards);
    expect(stats.points).toEqual([
      {
        cardId: 'b',
        completedAt: at('2026-01-02T00:00:00Z'),
        leadTimeDays: 1,
        cycleTimeDays: null,
      },
      { cardId: 'a', completedAt: at('2026-01-05T00:00:00Z'), leadTimeDays: 4, cycleTimeDays: 2 },
    ]);
    expect(stats.leadTime).toEqual({ count: 2, p50: 1, p85: null, p95: null });
    expect(stats.cycleTime).toEqual({ count: 1, p50: 2, p85: null, p95: null });
  });

  it('filters by whole local days (inclusive bounds)', () => {
    const stats = leadCycleStats(cards, {
      from: at('2026-01-03T00:00:00Z'),
      to: at('2026-01-05T00:00:00Z'),
    });
    expect(stats.points.map((p) => p.cardId)).toEqual(['a']);
    expect(leadCycleStats(cards, { to: at('2026-01-02T00:00:00Z') }).points).toHaveLength(1);
  });

  it('computes tail percentiles with 5 completed cards', () => {
    const many = [1, 2, 3, 4, 5].map((days) =>
      flowCard(`k${days}`, [
        ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
        [new Date(Date.UTC(2026, 0, 1 + days)).toISOString(), 'DONE'],
      ]),
    );
    const stats = leadCycleStats(many);
    expect(stats.leadTime).toEqual({ count: 5, p50: 3, p85: 5, p95: 5 });
    expect(stats.cycleTime).toEqual({ count: 5, p50: 3, p85: 5, p95: 5 });
  });

  it('includes a completion on the `to` day even after the `to` instant', () => {
    const late = flowCard('late', [
      ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
      ['2026-01-05T18:00:00Z', 'DONE'],
    ]);
    const withLate = leadCycleStats([...cards, late], {
      from: at('2026-01-05T00:00:00Z'),
      to: at('2026-01-05T06:00:00Z'),
    });
    // `late` completes at 18:00, twelve hours after the `to` instant, but on the same day.
    expect(withLate.points.map((p) => p.cardId)).toEqual(['a', 'late']);
  });

  it('puts the same completion inside or outside the range depending on the time zone', () => {
    const card = flowCard('tz', [
      ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
      ['2026-01-05T23:30:00Z', 'DONE'], // Jan 5 in UTC and LA, Jan 6 in Warsaw
    ]);
    const range = { from: at('2026-01-05T12:00:00Z'), to: at('2026-01-05T12:00:00Z') };
    expect(leadCycleStats([card], range).points).toHaveLength(1);
    expect(
      leadCycleStats([card], { ...range, timeZone: 'America/Los_Angeles' }).points,
    ).toHaveLength(1);
    expect(leadCycleStats([card], { ...range, timeZone: 'Europe/Warsaw' }).points).toHaveLength(0);
  });

  it('includes cards created in DONE that were reopened and completed again', () => {
    const reopened = flowCard('r', [
      ['2026-01-01T00:00:00Z', 'DONE'],
      ['2026-01-02T00:00:00Z', 'IN_PROGRESS'],
      ['2026-01-04T00:00:00Z', 'DONE'],
    ]);
    const stats = leadCycleStats([...cards, reopened]);
    expect(stats.points.find((p) => p.cardId === 'r')).toEqual({
      cardId: 'r',
      completedAt: at('2026-01-04T00:00:00Z'),
      leadTimeDays: 3,
      cycleTimeDays: 2,
    });
    expect(stats.points.some((p) => p.cardId === 'c')).toBe(false);
  });

  it('scatter points plus never-left-DONE completions equal the throughput sum', () => {
    const all = [
      ...cards,
      flowCard('late-done', [
        ['2026-01-04T23:30:00Z', 'DONE'],
        ['2026-01-04T23:40:00Z', 'DONE'], // another DONE column: still never left
      ]),
      flowCard('reopened', [
        ['2026-01-01T15:00:00Z', 'DONE'],
        ['2026-01-02T15:00:00Z', 'TODO'],
        ['2026-01-03T15:00:00Z', 'DONE'], // created in DONE but counted in the scatter
      ]),
      flowCard('outside', [
        ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-09T00:00:00Z', 'DONE'],
      ]),
    ];
    for (const timeZone of ['UTC', 'Europe/Warsaw', 'America/Los_Angeles']) {
      const range = { from: at('2026-01-01T12:00:00Z'), to: at('2026-01-05T12:00:00Z'), timeZone };
      const scatter = leadCycleStats(all, range).points.length;
      const sum = (points: { count: number }[]) => points.reduce((acc, p) => acc + p.count, 0);
      const neverLeftDone = sum(
        throughput(
          all.filter((card) => deriveCardFlow(card).neverLeftDone),
          range,
        ),
      );
      const total = sum(throughput(all, range));
      expect(scatter + neverLeftDone).toBe(total);
      // c completes on Dec 31 in Los Angeles, outside the range; elsewhere both count.
      expect(neverLeftDone).toBe(timeZone === 'America/Los_Angeles' ? 1 : 2);
      expect(scatter).toBe(3);
    }
  });

  it('rejects invalid bounds, time zones and inverted ranges', () => {
    expect(() => leadCycleStats(cards, { from: new Date('x') })).toThrow(FlowError);
    expect(() => leadCycleStats(cards, { timeZone: 'Bad/Zone' })).toThrow(
      expect.objectContaining({ code: 'INVALID_TIME_ZONE' }),
    );
    expect(() =>
      leadCycleStats(cards, { from: at('2026-01-05T00:00:00Z'), to: at('2026-01-04T00:00:00Z') }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
