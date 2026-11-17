import { describe, expect, it } from 'vitest';

import { at, flowCard } from '../../test-utils/flow.js';
import { cumulativeFlow } from './cumulative-flow.js';

const empty = { BACKLOG: 0, TODO: 0, IN_PROGRESS: 0, DONE: 0, unknown: 0 };

describe('cumulativeFlow', () => {
  it('counts each card in its category at the end of every day', () => {
    const cards = [
      flowCard('a', [
        ['2026-01-01T09:00:00Z', 'TODO'],
        ['2026-01-02T09:00:00Z', 'IN_PROGRESS'],
        ['2026-01-02T15:00:00Z', 'DONE'],
      ]),
      flowCard('b', [
        ['2026-01-02T09:00:00Z', 'BACKLOG'],
        ['2026-01-03T09:00:00Z', 'IN_PROGRESS'],
      ]),
      flowCard('later', [['2026-01-05T09:00:00Z', 'TODO']]),
    ];
    expect(
      cumulativeFlow(cards, { from: at('2026-01-01T00:00:00Z'), to: at('2026-01-03T00:00:00Z') }),
    ).toEqual([
      { ...empty, date: '2026-01-01', TODO: 1 },
      { ...empty, date: '2026-01-02', DONE: 1, BACKLOG: 1 },
      { ...empty, date: '2026-01-03', DONE: 1, IN_PROGRESS: 1 },
    ]);
  });

  it('counts cards created before the range and handles unsorted transitions', () => {
    const cards = [
      flowCard(
        'a',
        [
          ['2026-01-10T09:00:00Z', 'DONE'],
          ['2025-12-01T09:00:00Z', 'TODO'],
          ['2026-01-05T09:00:00Z', 'IN_PROGRESS'],
        ],
        '2025-12-01T09:00:00Z',
      ),
    ];
    const points = cumulativeFlow(cards, {
      from: at('2026-01-04T00:00:00Z'),
      to: at('2026-01-10T00:00:00Z'),
    });
    expect(points.map((p) => [p.TODO, p.IN_PROGRESS, p.DONE])).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('counts unknown categories and cards without transitions as unknown', () => {
    const cards = [
      flowCard('deleted', [
        ['2026-01-01T09:00:00Z', 'TODO'],
        ['2026-01-02T09:00:00Z', null],
      ]),
      { cardId: 'bare', createdAt: at('2026-01-02T10:00:00Z'), transitions: [] },
    ];
    expect(
      cumulativeFlow(cards, { from: at('2026-01-01T00:00:00Z'), to: at('2026-01-02T00:00:00Z') }),
    ).toEqual([
      { ...empty, date: '2026-01-01', TODO: 1 },
      { ...empty, date: '2026-01-02', unknown: 2 },
    ]);
  });

  it('reopened card leaves DONE in the CFD', () => {
    const cards = [
      flowCard('a', [
        ['2026-01-01T09:00:00Z', 'IN_PROGRESS'],
        ['2026-01-02T09:00:00Z', 'DONE'],
        ['2026-01-03T09:00:00Z', 'IN_PROGRESS'],
      ]),
    ];
    const points = cumulativeFlow(cards, {
      from: at('2026-01-01T00:00:00Z'),
      to: at('2026-01-03T00:00:00Z'),
    });
    expect(points.map((p) => [p.IN_PROGRESS, p.DONE])).toEqual([
      [1, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  it('assigns transitions to local days of the time zone', () => {
    // 23:30 UTC on Jan 1 is already Jan 2 in Warsaw and still Jan 1 in Los Angeles.
    const cards = [
      flowCard('a', [
        ['2026-01-01T12:00:00Z', 'TODO'],
        ['2026-01-01T23:30:00Z', 'IN_PROGRESS'],
      ]),
    ];
    const range = { from: at('2026-01-01T12:00:00Z'), to: at('2026-01-02T12:00:00Z') };
    const shape = (timeZone: string) =>
      cumulativeFlow(cards, { ...range, timeZone }).map((p) => [p.date, p.TODO, p.IN_PROGRESS]);
    expect(shape('UTC')).toEqual([
      ['2026-01-01', 0, 1],
      ['2026-01-02', 0, 1],
    ]);
    expect(shape('Europe/Warsaw')).toEqual([
      ['2026-01-01', 1, 0],
      ['2026-01-02', 0, 1],
    ]);
    expect(shape('America/Los_Angeles')).toEqual([
      ['2026-01-01', 0, 1],
      ['2026-01-02', 0, 1],
    ]);
  });

  it('produces one point per calendar day across a DST change', () => {
    const cards = [flowCard('a', [['2026-03-29T21:30:00Z', 'TODO']])]; // 23:30 CEST Mar 29
    const points = cumulativeFlow(cards, {
      from: at('2026-03-28T12:00:00Z'),
      to: at('2026-03-30T12:00:00Z'),
      timeZone: 'Europe/Warsaw',
    });
    expect(points.map((p) => [p.date, p.TODO])).toEqual([
      ['2026-03-28', 0],
      ['2026-03-29', 1],
      ['2026-03-30', 1],
    ]);
  });
});
