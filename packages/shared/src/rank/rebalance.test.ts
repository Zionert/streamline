import { describe, expect, it } from 'vitest';

import { RANK_ALPHABET, RANK_MAX_LENGTH, RankError, isValidRank } from './keys.js';
import { rankAfter, rankBetween, rankFirst } from './lexorank.js';
import { needsRebalance, rebalanceRanks } from './rebalance.js';

function expectValidAscending(keys: readonly string[]): void {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] ?? '';
    if (!isValidRank(key)) throw new Error(`Invalid key at ${i}: ${JSON.stringify(key)}`);
    if (i > 0 && !((keys[i - 1] ?? '') < key)) {
      throw new Error(`Keys at ${i - 1} and ${i} out of order`);
    }
  }
}

describe('rebalanceRanks', () => {
  it('returns an empty list for 0', () => {
    expect(rebalanceRanks(0)).toEqual([]);
  });

  it('returns the middle key for 1', () => {
    expect(rebalanceRanks(1)).toEqual([rankFirst()]);
  });

  it('spreads small lists evenly over single characters', () => {
    expect(rebalanceRanks(3)).toEqual(['F', 'V', 'k']);
  });

  it.each([
    [1, 1],
    [2, 1],
    [61, 1],
    [62, 2],
    [100, 2],
    [3843, 2],
    [3844, 3],
    [100_000, 3],
  ])('uses the minimal key length for %i keys (%i)', (count, length) => {
    const keys = rebalanceRanks(count);
    expect(keys).toHaveLength(count);
    expect(Math.max(...keys.map((key) => key.length))).toBe(length);
    expectValidAscending(keys);
  });

  it('handles 100 000 keys with unique values', () => {
    const keys = rebalanceRanks(100_000);
    expectValidAscending(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('matches the exact formula floor((i + 1) * 62^L / (count + 1))', () => {
    for (const count of [1, 7, 61, 62, 999, 3843, 3844, 12_345]) {
      const keys = rebalanceRanks(count);
      const length = Math.max(...keys.map((key) => key.length));
      const space = 62n ** BigInt(length);
      keys.forEach((key, i) => {
        const expected = (BigInt(i + 1) * space) / BigInt(count + 1);
        let actual = 0n;
        for (let d = 0; d < length; d++) {
          actual = actual * 62n + BigInt(Math.max(0, RANK_ALPHABET.indexOf(key.charAt(d))));
        }
        expect(actual).toBe(expected);
      });
    }
  });

  it('leaves room before the first and after the last key', () => {
    for (const count of [1, 61, 62, 1000]) {
      const keys = rebalanceRanks(count);
      const first = keys[0] ?? '';
      const last = keys[keys.length - 1] ?? '';
      expect(rankBetween(null, first).length).toBeLessThanOrEqual(first.length + 1);
      expect(rankAfter(last).length).toBeLessThanOrEqual(last.length + 1);
    }
  });

  it('produces keys that can be inserted between', () => {
    const keys = rebalanceRanks(500);
    for (let i = 1; i < keys.length; i++) {
      const low = keys[i - 1] ?? null;
      const high = keys[i] ?? null;
      const key = rankBetween(low, high);
      expect(key > (low ?? '') && key < (high ?? '')).toBe(true);
    }
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RankError for count %s',
    (count) => {
      expect(() => rebalanceRanks(count)).toThrow(RankError);
    },
  );
});

describe('needsRebalance', () => {
  it('is false for an empty list and short keys', () => {
    expect(needsRebalance([])).toBe(false);
    expect(needsRebalance(['a', 'b1', 'z'.repeat(RANK_MAX_LENGTH)])).toBe(false);
  });

  it('is true once any key is longer than RANK_MAX_LENGTH', () => {
    expect(needsRebalance(['a', 'z'.repeat(RANK_MAX_LENGTH + 1)])).toBe(true);
  });

  it('accepts a custom threshold', () => {
    expect(needsRebalance(['abc'], 3)).toBe(false);
    expect(needsRebalance(['abcd'], 3)).toBe(true);
  });

  it.each([0, -1, 2.5, Number.NaN])('throws RankError for max length %s', (maxLength) => {
    expect(() => needsRebalance(['a'], maxLength)).toThrow(RankError);
  });

  it('triggers after a bounded number of worst-case inserts and rebalancing fixes it', () => {
    const left = rankFirst();
    let right = rankAfter(left);
    const keys = [left, right];
    let inserts = 0;
    while (!needsRebalance(keys)) {
      right = rankBetween(left, right);
      keys.splice(1, 0, right);
      inserts++;
    }
    // About 5 worst-case inserts per character.
    expect(inserts).toBeGreaterThanOrEqual(RANK_MAX_LENGTH * 4);
    expect(inserts).toBeLessThanOrEqual(RANK_MAX_LENGTH * 6);

    const rebalanced = rebalanceRanks(keys.length);
    expect(needsRebalance(rebalanced)).toBe(false);
    expectValidAscending(rebalanced);
  });
});
