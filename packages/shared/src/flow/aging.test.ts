import { describe, expect, it } from 'vitest';

import { at, flowCard } from '../../test-utils/flow.js';
import { agingWip } from './aging.js';
import { FlowError, MS_PER_DAY } from './errors.js';

/** Completed card with the given cycle time in whole days. */
function completed(cardId: string, cycleDays: number) {
  return flowCard(cardId, [
    ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
    [new Date(Date.UTC(2026, 0, 1 + cycleDays)).toISOString(), 'DONE'],
  ]);
}

const now = at('2026-02-01T00:00:00Z');
const wip = [
  flowCard('old', [
    ['2026-01-01T00:00:00Z', 'TODO'],
    ['2026-01-21T00:00:00Z', 'IN_PROGRESS'], // 11 days old
  ]),
  flowCard('young', [['2026-01-30T00:00:00Z', 'IN_PROGRESS']]), // 2 days old
  flowCard('reopened', [
    ['2026-01-10T00:00:00Z', 'IN_PROGRESS'], // first start: 22 days old
    ['2026-01-12T00:00:00Z', 'DONE'],
    ['2026-01-31T00:00:00Z', 'IN_PROGRESS'],
  ]),
  flowCard('todo', [['2026-01-01T00:00:00Z', 'TODO']]),
];

describe('agingWip', () => {
  it('flags nothing with 4 cycle-time samples', () => {
    const cards = [...wip, ...[1, 2, 3, 4].map((d) => completed(`c${d}`, d))];
    const result = agingWip(cards, { now });
    expect(result.thresholdDays).toBeNull();
    expect(result.items.map((i) => i.cardId)).toEqual(['reopened', 'old', 'young']);
    expect(result.items.every((i) => !i.isAging)).toBe(true);
  });

  it('flags cards older than p85 with 5 samples', () => {
    // samples 1, 2, 3, 4, 10 -> p85 = rank 5 = 10 days
    const cards = [...wip, ...[1, 2, 3, 4, 10].map((d) => completed(`c${d}`, d))];
    const result = agingWip(cards, { now });
    expect(result.thresholdDays).toBe(10);
    expect(result.items).toEqual([
      { cardId: 'reopened', ageMs: 22 * MS_PER_DAY, ageDays: 22, isAging: true },
      { cardId: 'old', ageMs: 11 * MS_PER_DAY, ageDays: 11, isAging: true },
      { cardId: 'young', ageMs: 2 * MS_PER_DAY, ageDays: 2, isAging: false },
    ]);
  });

  it('a card exactly at the threshold is not aging', () => {
    const result = agingWip(wip, { now, cycleTimesDays: [1, 1, 1, 1, 11] });
    expect(result.items.find((i) => i.cardId === 'old')?.isAging).toBe(false);
  });

  it('uses explicit cycle time samples when given', () => {
    const result = agingWip(wip, { now, cycleTimesDays: [1, 1, 1, 1, 1] });
    expect(result.thresholdDays).toBe(1);
    expect(result.items.every((i) => i.isAging)).toBe(true);
    expect(agingWip(wip, { now, cycleTimesDays: [1, 1, 1, 1] }).thresholdDays).toBeNull();
  });

  it('clamps negative ages to 0 and validates now', () => {
    const result = agingWip(wip, { now: at('2025-01-01T00:00:00Z') });
    expect(result.items.every((i) => i.ageMs === 0)).toBe(true);
    expect(() => agingWip(wip, { now: new Date('x') })).toThrow(FlowError);
  });
});
