import { dateRange } from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import {
  MAX_TICKS_NARROW,
  MAX_TICKS_WIDE,
  axisMsToDateKey,
  dateKeyToMs,
  dateTicks,
  instantToAxisMs,
  rangeDomain,
  thinTicks,
  tickLabel,
  tickStep,
} from './dateTicks';

const DAY_MS = 86_400_000;

const labels = (from: string, to: string, maxTicks: number) => {
  const { keys, step } = dateTicks(from, to, maxTicks);
  return keys.map((key) => tickLabel(key, step));
};

describe('tickStep', () => {
  it('is daily up to 14 days, weekly up to 120 and monthly beyond', () => {
    expect(tickStep(1)).toBe('day');
    expect(tickStep(14)).toBe('day');
    expect(tickStep(15)).toBe('week');
    expect(tickStep(120)).toBe('week');
    expect(tickStep(121)).toBe('month');
  });
});

describe('dateTicks', () => {
  it('puts a 30-day range on Mondays, without duplicates', () => {
    // Sun 18 Oct ... Mon 16 Nov 2026 (30 days).
    const { step, keys } = dateTicks('2026-10-18', '2026-11-16', MAX_TICKS_WIDE);

    expect(step).toBe('week');
    expect(keys).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    for (const key of keys) {
      expect(new Date(dateKeyToMs(key)).getUTCDay()).toBe(1);
    }
    const shown = labels('2026-10-18', '2026-11-16', MAX_TICKS_WIDE);
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('puts a 7-day range on every day', () => {
    expect(labels('2026-11-11', '2026-11-17', MAX_TICKS_WIDE)).toEqual([
      '11 Nov',
      '12 Nov',
      '13 Nov',
      '14 Nov',
      '15 Nov',
      '16 Nov',
      '17 Nov',
    ]);
  });

  it('lists every calendar day once in a range containing a DST change (25 Oct 2026)', () => {
    const { step, keys } = dateTicks('2026-10-20', '2026-10-31', MAX_TICKS_WIDE + 2);

    expect(step).toBe('day');
    expect(keys).toEqual(dateRange('2026-10-20', '2026-10-31'));
    expect(keys).toContain('2026-10-25');
    expect(new Set(keys).size).toBe(keys.length);
    // Consecutive ticks are exactly one day apart on the axis.
    const positions = keys.map(dateKeyToMs);
    for (let index = 1; index < positions.length; index++) {
      expect((positions[index] ?? 0) - (positions[index - 1] ?? 0)).toBe(DAY_MS);
    }
  });

  it('thins the ticks to the width: at most the given number, evenly spaced', () => {
    const narrow = dateTicks('2026-11-04', '2026-11-17', MAX_TICKS_NARROW);
    expect(narrow.keys).toEqual([
      '2026-11-04',
      '2026-11-07',
      '2026-11-10',
      '2026-11-13',
      '2026-11-16',
    ]);

    const wide = dateTicks('2026-11-04', '2026-11-17', MAX_TICKS_WIDE);
    expect(wide.keys).toHaveLength(7);
    expect(wide.keys.length).toBeGreaterThan(narrow.keys.length);
  });

  it('uses the first of each month, with the year, for long ranges', () => {
    const { step, keys } = dateTicks('2025-11-17', '2026-11-17', 24);

    expect(step).toBe('month');
    expect(keys[0]).toBe('2025-12-01');
    expect(keys.at(-1)).toBe('2026-11-01');
    expect(keys).toHaveLength(12);
    expect(tickLabel('2026-01-01', step)).toBe('Jan 2026');
    expect(labels('2025-11-17', '2026-11-17', 6)).toEqual([
      'Dec 2025',
      'Feb 2026',
      'Apr 2026',
      'Jun 2026',
      'Aug 2026',
      'Oct 2026',
    ]);
  });

  it('starts the weekly ticks on the first Monday of the range', () => {
    const { keys } = dateTicks('2026-11-02', '2026-11-30', MAX_TICKS_WIDE);
    expect(keys[0]).toBe('2026-11-02');
    expect(keys.at(-1)).toBe('2026-11-30');
  });
});

describe('thinTicks', () => {
  it('keeps every n-th item starting with the first', () => {
    expect(thinTicks([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7]);
    expect(thinTicks([1, 2], 5)).toEqual([1, 2]);
    expect(thinTicks([], 5)).toEqual([]);
  });
});

describe('time axis positions', () => {
  it('spans the range from the start of the first day to the end of the last', () => {
    expect(rangeDomain('2026-10-19', '2026-11-17')).toEqual([
      Date.UTC(2026, 9, 19),
      Date.UTC(2026, 10, 18),
    ]);
    expect(axisMsToDateKey(dateKeyToMs('2026-11-17'))).toBe('2026-11-17');
  });

  it('places an instant at its local date and time, also across a DST change', () => {
    // Local noon on 24, 25 (the change) and 26 Oct in Warsaw: one axis day apart each.
    // 12:00 CEST is 10:00 UTC; 12:00 CET (after the change) is 11:00 UTC: 25 real hours apart.
    const noons = [
      '2026-10-24T10:00:00.000Z',
      '2026-10-25T11:00:00.000Z',
      '2026-10-26T11:00:00.000Z',
    ].map((instant) => instantToAxisMs(instant, 'Europe/Warsaw'));
    expect(noons.map(axisMsToDateKey)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect((noons[1] ?? 0) - (noons[0] ?? 0)).toBe(DAY_MS);
    expect((noons[2] ?? 0) - (noons[1] ?? 0)).toBe(DAY_MS);

    // 23:30 UTC on 12 Nov is 00:30 on 13 Nov in Warsaw.
    expect(instantToAxisMs('2026-11-12T23:30:00.000Z', 'Europe/Warsaw')).toBe(
      Date.UTC(2026, 10, 13, 0, 30),
    );
    expect(instantToAxisMs('2026-11-12T23:30:00.000Z', 'UTC')).toBe(Date.UTC(2026, 10, 12, 23, 30));
  });
});
