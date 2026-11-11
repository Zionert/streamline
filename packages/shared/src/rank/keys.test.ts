import { describe, expect, it } from 'vitest';

import {
  RANK_ALPHABET,
  RANK_BASE,
  RANK_MAX_DIGIT,
  RANK_MAX_LENGTH,
  RANK_MIN_DIGIT,
  RankError,
  assertValidRank,
  isValidRank,
  rankSchema,
} from './keys.js';

const INVALID_RANKS: readonly unknown[] = [
  '',
  '0',
  '00',
  'a0',
  'V00',
  ' ',
  'a b',
  'a ',
  ' a',
  'a-b',
  'a_b',
  'a.b',
  'ą',
  'aé',
  'a\u{1F600}',
  'a\n',
  '\u0000a',
  'Ａ',
  null,
  undefined,
  42,
  {},
  ['a'],
];

describe('RANK_ALPHABET', () => {
  it('has 62 unique digits from 0 to z', () => {
    expect(RANK_BASE).toBe(62);
    expect(new Set(RANK_ALPHABET).size).toBe(62);
    expect(RANK_ALPHABET[0]).toBe(RANK_MIN_DIGIT);
    expect(RANK_ALPHABET[61]).toBe(RANK_MAX_DIGIT);
  });

  it('is strictly ascending by character code (single-byte ASCII)', () => {
    for (let i = 0; i < RANK_BASE; i++) {
      const code = RANK_ALPHABET.charCodeAt(i);
      expect(code).toBeLessThan(0x80);
      if (i > 0) expect(code).toBeGreaterThan(RANK_ALPHABET.charCodeAt(i - 1));
    }
  });
});

describe('isValidRank', () => {
  it.each(['1', 'V', 'z', 'a1', '01', '0001', 'zzzz', 'Az09b', RANK_ALPHABET.slice(1)])(
    'accepts %j',
    (value) => {
      expect(isValidRank(value)).toBe(true);
    },
  );

  it.each(INVALID_RANKS)('rejects %j', (value) => {
    expect(isValidRank(value)).toBe(false);
  });

  it('does not limit the length (long keys are still ordered correctly)', () => {
    expect(isValidRank('z'.repeat(1000))).toBe(true);
  });
});

describe('assertValidRank', () => {
  it('passes for valid keys', () => {
    expect(() => assertValidRank('a1')).not.toThrow();
  });

  it.each(INVALID_RANKS)('throws RankError for %j', (value) => {
    expect(() => assertValidRank(value)).toThrow(RankError);
  });

  it('reports the INVALID_RANK code and the label', () => {
    try {
      assertValidRank('a0', 'column rank');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RankError);
      expect(error).toBeInstanceOf(Error);
      const rankError = error as RankError;
      expect(rankError.code).toBe('INVALID_RANK');
      expect(rankError.name).toBe('RankError');
      expect(rankError.message).toContain('column rank');
    }
  });
});

describe('rankSchema', () => {
  it('accepts valid keys up to RANK_MAX_LENGTH', () => {
    expect(rankSchema.parse('a1')).toBe('a1');
    expect(rankSchema.safeParse('z'.repeat(RANK_MAX_LENGTH)).success).toBe(true);
  });

  it('rejects keys longer than RANK_MAX_LENGTH', () => {
    expect(rankSchema.safeParse('z'.repeat(RANK_MAX_LENGTH + 1)).success).toBe(false);
  });

  it.each(INVALID_RANKS)('rejects %j', (value) => {
    expect(rankSchema.safeParse(value).success).toBe(false);
  });
});
