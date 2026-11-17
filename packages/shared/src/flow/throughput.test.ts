import { describe, expect, it } from 'vitest';

import { at, flowCard } from '../../test-utils/flow.js';
import { FlowError } from './errors.js';
import { dailyThroughputSamples, throughput } from './throughput.js';

function doneAt(cardId: string, iso: string) {
  return flowCard(
    cardId,
    [
      ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
      [iso, 'DONE'],
    ],
    '2026-01-01T00:00:00Z',
  );
}

describe('throughput (daily)', () => {
  it('returns a zero-filled series for every day in range', () => {
    const cards = [
      doneAt('a', '2026-11-16T10:00:00Z'),
      doneAt('b', '2026-11-16T12:00:00Z'),
      doneAt('c', '2026-11-18T10:00:00Z'),
      doneAt('outside', '2026-11-20T10:00:00Z'),
      flowCard('wip', [['2026-11-16T10:00:00Z', 'IN_PROGRESS']]),
    ];
    expect(
      throughput(cards, { from: at('2026-11-15T00:00:00Z'), to: at('2026-11-19T00:00:00Z') }),
    ).toEqual([
      { date: '2026-11-15', count: 0 },
      { date: '2026-11-16', count: 2 },
      { date: '2026-11-17', count: 0 },
      { date: '2026-11-18', count: 1 },
      { date: '2026-11-19', count: 0 },
    ]);
  });

  it('counts never-left-DONE cards and reopened cards only once', () => {
    const cards = [
      flowCard('created-done', [
        ['2026-11-16T10:00:00Z', 'DONE'],
        ['2026-11-16T11:00:00Z', 'DONE'],
      ]),
      flowCard('reopened', [
        ['2026-11-15T10:00:00Z', 'IN_PROGRESS'],
        ['2026-11-15T12:00:00Z', 'DONE'],
        ['2026-11-15T13:00:00Z', 'IN_PROGRESS'],
        ['2026-11-16T09:00:00Z', 'DONE'],
      ]),
    ];
    expect(
      throughput(cards, { from: at('2026-11-15T00:00:00Z'), to: at('2026-11-16T00:00:00Z') }),
    ).toEqual([
      { date: '2026-11-15', count: 0 },
      { date: '2026-11-16', count: 2 },
    ]);
  });

  it('buckets the same completion on different days per time zone', () => {
    const cards = [doneAt('a', '2026-11-16T23:30:00Z')];
    const range = { from: at('2026-11-16T12:00:00Z'), to: at('2026-11-17T12:00:00Z') };
    expect(throughput(cards, { ...range, timeZone: 'UTC' })).toEqual([
      { date: '2026-11-16', count: 1 },
      { date: '2026-11-17', count: 0 },
    ]);
    expect(throughput(cards, { ...range, timeZone: 'Europe/Warsaw' })).toEqual([
      { date: '2026-11-16', count: 0 },
      { date: '2026-11-17', count: 1 },
    ]);
    expect(throughput(cards, { ...range, timeZone: 'America/Los_Angeles' })).toEqual([
      { date: '2026-11-16', count: 1 },
      { date: '2026-11-17', count: 0 },
    ]);
  });

  it('handles the DST change day (one bucket per calendar day)', () => {
    // Europe/Warsaw 2026-03-29 has 23 hours; both completions fall on it locally.
    const cards = [doneAt('a', '2026-03-28T23:10:00Z'), doneAt('b', '2026-03-29T21:50:00Z')];
    expect(
      throughput(cards, {
        from: at('2026-03-28T12:00:00Z'),
        to: at('2026-03-30T12:00:00Z'),
        timeZone: 'Europe/Warsaw',
      }),
    ).toEqual([
      { date: '2026-03-28', count: 0 },
      { date: '2026-03-29', count: 2 },
      { date: '2026-03-30', count: 0 },
    ]);
  });

  it('rejects an invalid time zone and an inverted range', () => {
    const range = { from: at('2026-01-01'), to: at('2026-01-02') };
    expect(() => throughput([], { ...range, timeZone: 'Nowhere/City' })).toThrow(
      expect.objectContaining({ code: 'INVALID_TIME_ZONE' }),
    );
    expect(() => throughput([], { from: range.to, to: range.from })).toThrow(FlowError);
  });
});

describe('throughput (weekly)', () => {
  it('returns zero-filled ISO weeks keyed by Monday', () => {
    const cards = [
      doneAt('a', '2026-11-03T10:00:00Z'), // Tue, week of Nov 2
      doneAt('b', '2026-11-08T10:00:00Z'), // Sun, week of Nov 2
      doneAt('c', '2026-11-23T10:00:00Z'), // Mon, week of Nov 23
      doneAt('before', '2026-11-01T10:00:00Z'), // Sun before the range
    ];
    expect(
      throughput(cards, {
        from: at('2026-11-03T00:00:00Z'), // Tuesday
        to: at('2026-11-25T00:00:00Z'), // Wednesday
        granularity: 'week',
      }),
    ).toEqual([
      { date: '2026-11-02', count: 2 },
      { date: '2026-11-09', count: 0 },
      { date: '2026-11-16', count: 0 },
      { date: '2026-11-23', count: 1 },
    ]);
  });

  it('uses local Mondays across a DST change', () => {
    // Sunday 2026-03-29 23:30 in Warsaw is still the week of Monday 2026-03-23.
    const cards = [doneAt('a', '2026-03-29T21:30:00Z')];
    expect(
      throughput(cards, {
        from: at('2026-03-23T12:00:00Z'),
        to: at('2026-04-01T12:00:00Z'),
        timeZone: 'Europe/Warsaw',
        granularity: 'week',
      }),
    ).toEqual([
      { date: '2026-03-23', count: 1 },
      { date: '2026-03-30', count: 0 },
    ]);
  });
});

describe('dailyThroughputSamples', () => {
  it('returns the last N daily counts including zeros, oldest first', () => {
    const cards = [
      doneAt('a', '2026-11-15T10:00:00Z'),
      doneAt('b', '2026-11-17T10:00:00Z'),
      doneAt('c', '2026-11-17T11:00:00Z'),
      doneAt('old', '2026-11-10T10:00:00Z'),
      doneAt('future', '2026-11-18T10:00:00Z'),
    ];
    expect(dailyThroughputSamples(cards, { endDate: at('2026-11-17T20:00:00Z'), days: 4 })).toEqual(
      [0, 1, 0, 2],
    );
  });

  it('defaults to 30 days and respects the time zone', () => {
    const cards = [doneAt('a', '2026-11-17T23:30:00Z')];
    const utc = dailyThroughputSamples(cards, { endDate: at('2026-11-17T12:00:00Z') });
    expect(utc).toHaveLength(30);
    expect(utc.at(-1)).toBe(1);
    const warsaw = dailyThroughputSamples(cards, {
      endDate: at('2026-11-17T12:00:00Z'),
      timeZone: 'Europe/Warsaw',
    });
    expect(warsaw.every((n) => n === 0)).toBe(true);
  });

  it('rejects invalid day counts', () => {
    expect(() => dailyThroughputSamples([], { endDate: at('2026-01-01'), days: 0 })).toThrow(
      FlowError,
    );
    expect(() => dailyThroughputSamples([], { endDate: at('2026-01-01'), days: 1.5 })).toThrow(
      FlowError,
    );
  });
});
