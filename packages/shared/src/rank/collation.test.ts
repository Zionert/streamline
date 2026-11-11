/**
 * PostgreSQL sorts rank columns with `COLLATE "C"`, i.e. by raw UTF-8 bytes. These tests
 * check that the default JavaScript string comparison used by the rank functions agrees
 * with that byte order for every generated key.
 */
import { describe, expect, it } from 'vitest';

import { createPrng } from '../../test-utils/prng.js';
import { RANK_ALPHABET } from './keys.js';
import { rankBetween, rankFirst } from './lexorank.js';
import { rebalanceRanks } from './rebalance.js';

/** Byte-wise comparison, as done by PostgreSQL `COLLATE "C"`. */
function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function compareJs(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Keys produced by a deterministic mix of inserts at random positions. */
function generateKeys(count: number, seed: number): string[] {
  const prng = createPrng(seed);
  const keys = [rankFirst()];
  for (let i = 1; i < count; i++) {
    const at = prng.int(keys.length + 1);
    keys.splice(at, 0, rankBetween(keys[at - 1] ?? null, keys[at] ?? null));
  }
  return keys;
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const prng = createPrng(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = prng.int(i + 1);
    const tmp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = tmp;
  }
  return result;
}

describe('rank ordering vs COLLATE "C" (byte order)', () => {
  it('every pair of alphabet digits compares the same in JS and byte-wise', () => {
    for (const a of RANK_ALPHABET) {
      for (const b of RANK_ALPHABET) {
        expect(Math.sign(compareBytes(a, b))).toBe(compareJs(a, b));
      }
    }
  });

  it('generated keys are already in byte order and JS order', () => {
    const keys = generateKeys(3000, 42);
    for (let i = 1; i < keys.length; i++) {
      const previous = keys[i - 1] ?? '';
      const current = keys[i] ?? '';
      expect(compareJs(previous, current)).toBe(-1);
      expect(compareBytes(previous, current)).toBeLessThan(0);
    }
  });

  it('random pairs of generated keys compare identically', () => {
    const keys = [...generateKeys(2000, 1), ...rebalanceRanks(2000)];
    const prng = createPrng(99);
    for (let i = 0; i < 20_000; i++) {
      const a = keys[prng.int(keys.length)] ?? '';
      const b = keys[prng.int(keys.length)] ?? '';
      expect(Math.sign(compareBytes(a, b))).toBe(compareJs(a, b));
    }
  });

  it('default Array.prototype.sort() equals byte sort for shuffled keys', () => {
    const keys = generateKeys(5000, 2026);
    const shuffled = shuffle(keys, 5);
    const jsSorted = [...shuffled].sort();
    const byteSorted = [...shuffled].sort(compareBytes);
    expect(jsSorted).toEqual(byteSorted);
    expect(jsSorted).toEqual(keys);
  });

  it('locale collation disagrees for mixed-case keys, so it must never be used', () => {
    // Byte order: all uppercase letters (0x41-0x5A) come before lowercase ones (0x61-0x7A).
    expect(compareBytes('B', 'a')).toBeLessThan(0);
    expect(compareJs('B', 'a')).toBe(-1);
    // Locale collation interleaves cases: a < B.
    expect('B'.localeCompare('a', 'en')).toBeGreaterThan(0);
    expect(new Intl.Collator('pl').compare('Z', 'a')).toBeGreaterThan(0);

    const mixed = ['a', 'B', 'b', 'A', 'Z', 'z', '1'];
    const byteSorted = [...mixed].sort(compareBytes);
    const localeSorted = [...mixed].sort((x, y) => x.localeCompare(y, 'en'));
    expect(byteSorted).toEqual(['1', 'A', 'B', 'Z', 'a', 'b', 'z']);
    expect([...mixed].sort()).toEqual(byteSorted);
    expect(localeSorted).not.toEqual(byteSorted);
  });

  it('keys generated around a case boundary break locale ordering but not byte ordering', () => {
    const low = 'Z';
    const high = 'a';
    const middle = rankBetween(low, high);
    expect(compareBytes(low, middle)).toBeLessThan(0);
    expect(compareBytes(middle, high)).toBeLessThan(0);
    // 'Z' < 'ZV' < 'a' in bytes; locale collation puts 'a' before 'Z'.
    expect(high.localeCompare(low, 'en')).toBeLessThan(0);
  });
});
