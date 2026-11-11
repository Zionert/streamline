import { RANK_BASE, RANK_MAX_LENGTH, RankError, digitChar } from './keys.js';

/**
 * True when any key is longer than `maxLength`; the caller should then replace all keys
 * of the list with {@link rebalanceRanks}.
 */
export function needsRebalance(keys: readonly string[], maxLength = RANK_MAX_LENGTH): boolean {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) {
    throw new RankError(
      'INVALID_ARGUMENT',
      `Max length must be a positive integer, got ${maxLength}`,
    );
  }
  return keys.some((key) => key.length > maxLength);
}

/** Fixed-length base-62 digits of `value` (a safe integer), without trailing zeros. */
function encode(value: number, length: number): string {
  let key = '';
  let rest = value;
  for (let i = 0; i < length; i++) {
    key = digitChar(rest % RANK_BASE) + key;
    rest = Math.floor(rest / RANK_BASE);
  }
  return key.replace(/0+$/, '');
}

/**
 * `count` strictly ascending, evenly spaced keys covering the whole key space, using the
 * smallest key length that fits them. Used to rewrite all ranks of a list once its keys
 * have grown too long.
 *
 * Keys of length up to `L` are exactly the fractions `k / 62^L` for `k` in `[1, 62^L)`, so
 * `L` is the smallest length with `62^L > count`, and key `i` is
 * `floor((i + 1) * 62^L / (count + 1))`. Consecutive values differ by at least
 * `floor(62^L / (count + 1)) >= 1`, and the gaps before the first and after the last key
 * match the gaps between keys, leaving room on both ends of the list.
 */
export function rebalanceRanks(count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RankError('INVALID_ARGUMENT', `Count must be a non-negative integer, got ${count}`);
  }
  if (count === 0) return [];

  let length = 1;
  let space = RANK_BASE;
  while (space <= count) {
    length++;
    space *= RANK_BASE;
  }

  // value_i = floor((i + 1) * space / slots), accumulated as quotient + remainder so every
  // intermediate number stays an exact integer below `space` (no floating-point rounding).
  const slots = count + 1;
  const stepRemainder = space % slots;
  const step = (space - stepRemainder) / slots;
  const keys = new Array<string>(count);
  let value = 0;
  let remainder = 0;
  for (let i = 0; i < count; i++) {
    value += step;
    remainder += stepRemainder;
    if (remainder >= slots) {
      value++;
      remainder -= slots;
    }
    keys[i] = encode(value, length);
  }
  return keys;
}
