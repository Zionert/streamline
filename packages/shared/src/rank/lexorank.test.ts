import { describe, expect, it } from 'vitest';

import { createPrng } from '../../test-utils/prng.js';
import type { Prng } from '../../test-utils/prng.js';
import { RANK_ALPHABET, RankError, isValidRank } from './keys.js';
import { rankAfter, rankBefore, rankBetween, rankFirst, rankSequenceBetween } from './lexorank.js';

const BASE = BigInt(RANK_ALPHABET.length);

/** Key value scaled to an integer with `length` base-62 digits (key padded with zeros). */
function scaled(key: string, length: number): bigint {
  let value = 0n;
  for (let i = 0; i < length; i++) {
    value = value * BASE + BigInt(i < key.length ? RANK_ALPHABET.indexOf(key.charAt(i)) : 0);
  }
  return value;
}

/** Length of the shortest valid key strictly between `low` and `high`, by exhaustive reasoning. */
function shortestPossibleLength(low: string | null, high: string | null): number {
  const width = Math.max(low?.length ?? 0, high?.length ?? 0) + 1;
  const a = low === null ? 0n : scaled(low, width);
  const b = high === null ? BASE ** BigInt(width) : scaled(high, width);
  for (let length = 1; length <= width; length++) {
    // Keys of length <= `length` are multiples of `step` at this scale.
    const step = BASE ** BigInt(width - length);
    const firstAbove = (a / step + 1n) * step;
    if (firstAbove < b) return length;
  }
  throw new Error('No key fits, the bounds must be adjacent');
}

function randomRank(prng: Prng, maxLength: number): string {
  const length = 1 + prng.int(maxLength);
  let key = '';
  for (let i = 0; i < length - 1; i++) key += RANK_ALPHABET.charAt(prng.int(62));
  return key + RANK_ALPHABET.charAt(1 + prng.int(61));
}

function expectStrictlyAscending(keys: readonly string[]): void {
  for (let i = 1; i < keys.length; i++) {
    const previous = keys[i - 1] ?? '';
    const current = keys[i] ?? '';
    if (!(previous < current)) {
      throw new Error(`Keys at ${i - 1} and ${i} out of order: ${previous} >= ${current}`);
    }
  }
}

function expectBetween(key: string, low: string | null, high: string | null): void {
  expect(isValidRank(key)).toBe(true);
  if (low !== null) expect(key > low).toBe(true);
  if (high !== null) expect(key < high).toBe(true);
}

function maxLength(keys: readonly string[]): number {
  return keys.reduce((max, key) => Math.max(max, key.length), 0);
}

describe('rankFirst', () => {
  it('returns the middle of the key space', () => {
    expect(rankFirst()).toBe('V');
    expect(isValidRank(rankFirst())).toBe(true);
  });

  it('equals rankBetween(null, null)', () => {
    expect(rankBetween(null, null)).toBe(rankFirst());
  });
});

describe('rankBetween', () => {
  it.each([
    // [low, high, expected]
    ['1', '3', '2'],
    ['U', 'k', 'c'],
    ['1', 'z', 'V'],
    ['a', 'b', 'aV'],
    ['a', 'a1', 'a0V'],
    ['a', 'a01', 'a00V'],
    ['a1', 'a2', 'a1V'],
    ['Uz', 'V', 'UzV'],
    ['zy', 'zz', 'zyV'],
    ['zz', 'zz1', 'zz0V'],
    ['01', '02', '01V'],
    ['0001', '0002', '0001V'],
    ['1', '2', '1V'],
    ['a', 'c', 'b'],
    ['a', 'b1', 'b'],
    ['ay', 'b', 'az'],
  ])('between %j and %j is %j', (low, high, expected) => {
    expect(rankBetween(low, high)).toBe(expected);
  });

  it.each([
    // Insert at the start: closest to the first key.
    [null, 'V', 'U'],
    [null, 'b', 'a'],
    [null, '1', '0z'],
    [null, '01', '00z'],
    [null, '0z', '0y'],
    [null, '0001', '0000z'],
    [null, 'V1', 'V'],
    [null, 'a01', 'a'],
    // Insert at the end: closest to the last key.
    ['V', null, 'W'],
    ['Va', null, 'W'],
    ['y', null, 'z'],
    ['z', null, 'z1'],
    ['zz', null, 'zz1'],
    ['zzz', null, 'zzz1'],
    ['zzy', null, 'zzz'],
    ['zzyk', null, 'zzz'],
    ['zzzk', null, 'zzzl'],
    ['01', null, '1'],
    ['0001', null, '1'],
  ])('between %j and %j is %j', (low, high, expected) => {
    expect(rankBetween(low, high)).toBe(expected);
  });

  it('handles keys of all minimum and maximum digits', () => {
    const smallest = '0'.repeat(40) + '1';
    const largest = 'z'.repeat(40);
    expectBetween(rankBefore(smallest), null, smallest);
    expectBetween(rankAfter(largest), largest, null);
    expectBetween(rankBetween(smallest, largest), smallest, largest);
    expect(rankBetween(smallest, largest)).toBe('V');
    expect(rankBefore(smallest)).toBe('0'.repeat(41) + 'z');
    expect(rankAfter(largest)).toBe(largest + '1');
  });

  it('accepts keys longer than the rebalance threshold', () => {
    const low = 'a'.repeat(100) + '1';
    const high = 'a'.repeat(100) + '2';
    expectBetween(rankBetween(low, high), low, high);
  });

  describe('invalid input', () => {
    it.each([
      ['', null],
      [null, ''],
      ['a0', null],
      [null, 'a0'],
      ['0', 'a'],
      ['a b', null],
      [null, ' '],
      ['ą', null],
      [null, 'a\u{1F600}'],
      ['a', 'b-'],
      ['A_', 'B'],
    ])('rejects malformed bounds %j and %j', (low, high) => {
      expect(() => rankBetween(low, high)).toThrow(RankError);
    });

    it('rejects non-string values passed from untyped code', () => {
      const bounds: unknown[] = [42, undefined, {}, true];
      for (const bound of bounds) {
        expect(() => rankBetween(bound as string, null)).toThrow(RankError);
        expect(() => rankBetween(null, bound as string)).toThrow(RankError);
      }
    });

    it.each([
      ['a', 'a'],
      ['b', 'a'],
      ['a1', 'a'],
      ['z', '1'],
      ['b', 'B'],
    ])('rejects unordered bounds %j and %j with INVALID_RANK_ORDER', (low, high) => {
      try {
        rankBetween(low, high);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(RankError);
        expect((error as RankError).code).toBe('INVALID_RANK_ORDER');
      }
    });

    it('rejects malformed keys with INVALID_RANK', () => {
      try {
        rankBetween('a0', 'b');
        expect.unreachable();
      } catch (error) {
        expect((error as RankError).code).toBe('INVALID_RANK');
      }
    });
  });

  it('returns the shortest possible key for random bounds', () => {
    const prng = createPrng(0x5eed);
    for (let i = 0; i < 5000; i++) {
      let low: string | null = randomRank(prng, 4);
      let high: string | null = randomRank(prng, 4);
      if (low === high) continue;
      if (low > high) [low, high] = [high, low];
      const mode = prng.int(4);
      if (mode === 1) low = null;
      if (mode === 2) high = null;

      const key = rankBetween(low, high);
      expectBetween(key, low, high);
      expect(key.length).toBe(shortestPossibleLength(low, high));
    }
  });

  it('returns the shortest possible key between adjacent short keys', () => {
    for (const a of RANK_ALPHABET.slice(1)) {
      for (const b of RANK_ALPHABET.slice(1)) {
        if (!(a < b)) continue;
        const key = rankBetween(a, b);
        expectBetween(key, a, b);
        expect(key.length).toBe(shortestPossibleLength(a, b));
      }
    }
  });
});

describe('rankAfter / rankBefore', () => {
  it('are rankBetween with an open bound', () => {
    for (const key of ['1', 'V', 'z', 'a01', 'zzk']) {
      expect(rankAfter(key)).toBe(rankBetween(key, null));
      expect(rankBefore(key)).toBe(rankBetween(null, key));
    }
  });

  it('increment the first digit with room instead of appending', () => {
    expect(rankAfter('V')).toBe('W');
    expect(rankAfter('Vzzz')).toBe('W');
    expect(rankBefore('V')).toBe('U');
    expect(rankBefore('V001')).toBe('V');
  });

  it('throw RankError for invalid keys', () => {
    expect(() => rankAfter('')).toThrow(RankError);
    expect(() => rankBefore('x0')).toThrow(RankError);
  });
});

describe('repeated inserts', () => {
  const INSERTS = 3000;

  it('appending to the end grows by one character per ~61 inserts', () => {
    const keys = [rankFirst()];
    for (let i = 0; i < INSERTS; i++) keys.push(rankAfter(keys[keys.length - 1] ?? ''));
    expectStrictlyAscending(keys);
    expect(keys.every(isValidRank)).toBe(true);
    // 'V' -> 'z' takes 30 inserts, then every character gives 61 more.
    expect(maxLength(keys)).toBe(1 + Math.ceil((INSERTS - 30) / 61));
  });

  it('prepending to the start grows by one character per ~61 inserts', () => {
    const keys = [rankFirst()];
    for (let i = 0; i < INSERTS; i++) keys.unshift(rankBefore(keys[0] ?? ''));
    expectStrictlyAscending(keys);
    expect(keys.every(isValidRank)).toBe(true);
    expect(maxLength(keys)).toBeLessThanOrEqual(2 + Math.ceil(INSERTS / 61));
  });

  it('inserting right after a fixed neighbour (worst case) grows by one character per ~5 inserts', () => {
    const left = rankFirst();
    const keys = [left, rankAfter(left)];
    // Always between the fixed left neighbour and the previously inserted key.
    for (let i = 0; i < INSERTS; i++) keys.splice(1, 0, rankBetween(left, keys[1] ?? null));
    expectStrictlyAscending(keys);
    expect(keys.every(isValidRank)).toBe(true);
    expect(maxLength(keys)).toBeGreaterThan(INSERTS / 6);
    expect(maxLength(keys)).toBeLessThanOrEqual(Math.ceil(INSERTS / 5) + 2);
  });

  it('inserting right before a fixed neighbour grows by one character per ~6 inserts', () => {
    const right = rankFirst();
    const keys = [rankBefore(right), right];
    for (let i = 0; i < INSERTS; i++) {
      const at = keys.length - 1;
      keys.splice(at, 0, rankBetween(keys[at - 1] ?? null, right));
    }
    expectStrictlyAscending(keys);
    expect(maxLength(keys)).toBeLessThanOrEqual(Math.ceil(INSERTS / 5) + 2);
  });

  it('zig-zag inserts into one shrinking gap stay ordered', () => {
    let low = 'a';
    let high = 'b';
    const keys = [low, high];
    for (let i = 0; i < INSERTS; i++) {
      const key = rankBetween(low, high);
      keys.push(key);
      if (i % 2 === 0) low = key;
      else high = key;
    }
    keys.sort();
    expectStrictlyAscending(keys);
    expect(keys.every(isValidRank)).toBe(true);
    expect(maxLength(keys)).toBeLessThanOrEqual(Math.ceil(INSERTS / 5) + 2);
  });

  it('random positions keep strict order and short keys', () => {
    const prng = createPrng(20261111);
    const keys = [rankFirst()];
    for (let i = 0; i < 5000; i++) {
      const at = prng.int(keys.length + 1);
      const key = rankBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys.splice(at, 0, key);
    }
    expectStrictlyAscending(keys);
    expect(keys.every(isValidRank)).toBe(true);
    expect(maxLength(keys)).toBeLessThanOrEqual(8);
  });

  it('random moves (remove + reinsert) keep strict order', () => {
    const prng = createPrng(7);
    const keys = rankSequenceBetween(null, null, 200);
    for (let i = 0; i < 5000; i++) {
      const [moved] = keys.splice(prng.int(keys.length), 1);
      expect(moved).toBeDefined();
      const at = prng.int(keys.length + 1);
      keys.splice(at, 0, rankBetween(keys[at - 1] ?? null, keys[at] ?? null));
    }
    expectStrictlyAscending(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('rankSequenceBetween', () => {
  it('returns an empty list for count 0', () => {
    expect(rankSequenceBetween('a', 'b', 0)).toEqual([]);
  });

  it('returns a single middle key for count 1', () => {
    expect(rankSequenceBetween('a', 'c', 1)).toEqual(['b']);
  });

  it.each([
    [null, null],
    ['a', null],
    [null, 'a'],
    ['a', 'b'],
    ['a', 'a1'],
    ['zzz', null],
    [null, '0001'],
  ])('returns ascending keys strictly between %j and %j', (low, high) => {
    for (const count of [2, 10, 1000]) {
      const keys = rankSequenceBetween(low, high, count);
      expect(keys).toHaveLength(count);
      expectStrictlyAscending(keys);
      for (const key of keys) expectBetween(key, low, high);
    }
  });

  it('grows key length only logarithmically with count', () => {
    const keys = rankSequenceBetween('a', 'b', 10_000);
    // log2(10 000) ~ 14 halvings ~ 3 base-62 digits on top of the shared prefix.
    expect(maxLength(keys)).toBeLessThanOrEqual(5);
  });

  it('validates its arguments', () => {
    expect(() => rankSequenceBetween('b', 'a', 1)).toThrow(RankError);
    expect(() => rankSequenceBetween('a0', null, 1)).toThrow(RankError);
    expect(() => rankSequenceBetween(null, null, -1)).toThrow(RankError);
    expect(() => rankSequenceBetween(null, null, 1.5)).toThrow(RankError);
    expect(() => rankSequenceBetween(null, null, Number.NaN)).toThrow(RankError);
  });
});
