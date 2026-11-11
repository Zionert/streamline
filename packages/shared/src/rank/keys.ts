import { z } from 'zod';

/**
 * Digits of rank keys, listed in strictly ascending ASCII order.
 *
 * Because every character is single-byte ASCII and the alphabet is sorted by code point,
 * the default JavaScript string comparison (`<`, `Array.prototype.sort()`), UTF-8 byte order
 * and PostgreSQL `COLLATE "C"` all order keys identically. Locale-aware collation
 * (`localeCompare`, `Intl.Collator`, non-"C" database collations) does NOT, because it
 * interleaves upper- and lowercase letters, so it must never be used for ranks.
 */
export const RANK_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Numeric base of rank keys (62). */
export const RANK_BASE = RANK_ALPHABET.length;

/** Smallest digit. A key never ends with it, see {@link isValidRank}. */
export const RANK_MIN_DIGIT = '0';

/** Largest digit. */
export const RANK_MAX_DIGIT = 'z';

/**
 * Length above which a list of keys should be rebalanced.
 *
 * Inserting repeatedly into the same gap halves it every time, and one base-62 digit holds
 * about 5-6 halvings (log2(62) ~ 5.95), so 32 characters absorb roughly 160 adversarial
 * inserts into one spot (and ~1 900 appends to the end) before a rebalance is needed. Rebalancing rewrites the
 * whole list once, which is cheap for the expected list sizes (dozens of columns, hundreds of
 * cards), while 32 bytes keep the sort index small. Longer keys still work correctly; the
 * limit only bounds storage and index size.
 */
export const RANK_MAX_LENGTH = 32;

/** Non-empty, only alphabet characters, last character is not the minimum digit. */
const RANK_PATTERN = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export type RankErrorCode = 'INVALID_RANK' | 'INVALID_RANK_ORDER' | 'INVALID_ARGUMENT';

/** Thrown when rank functions receive malformed keys or arguments. */
export class RankError extends Error {
  readonly code: RankErrorCode;

  constructor(code: RankErrorCode, message: string) {
    super(message);
    this.name = 'RankError';
    this.code = code;
  }
}

/**
 * A rank key is a base-62 fraction `0.d1d2d3...` written as its digit string `d1d2d3...`.
 *
 * Keys must not end with `'0'`: a trailing zero does not change the value, so forbidding it
 * makes every value have exactly one spelling (string order == numeric order) and guarantees
 * that every key is strictly greater than zero, so there is always room before it.
 */
export function isValidRank(value: unknown): value is string {
  return typeof value === 'string' && RANK_PATTERN.test(value);
}

/** Throws {@link RankError} unless `value` is a valid rank key. */
export function assertValidRank(value: unknown, label = 'rank'): asserts value is string {
  if (!isValidRank(value)) {
    throw new RankError('INVALID_RANK', `Invalid ${label}: ${JSON.stringify(value)}`);
  }
}

/**
 * Zod schema for validating rank keys (e.g. in request or stored data). New keys are
 * computed on the server from persisted neighbours, never accepted from clients as-is.
 * Persisted keys never exceed {@link RANK_MAX_LENGTH}: when a generated key would be longer,
 * the whole list is rewritten with `rebalanceRanks` in the same transaction instead.
 */
export const rankSchema = z
  .string()
  .max(RANK_MAX_LENGTH)
  .refine(isValidRank, { message: 'Invalid rank key' });

const DIGIT_VALUES: readonly number[] = (() => {
  const values = new Array<number>(128).fill(-1);
  for (let i = 0; i < RANK_BASE; i++) {
    values[RANK_ALPHABET.charCodeAt(i)] = i;
  }
  return values;
})();

/** Numeric value of the digit at `index` of an already validated key. */
export function digitAt(key: string, index: number): number {
  return DIGIT_VALUES[key.charCodeAt(index)] ?? -1;
}

/** Character for a digit value in `[0, RANK_BASE)`. */
export function digitChar(value: number): string {
  return RANK_ALPHABET.charAt(value);
}
