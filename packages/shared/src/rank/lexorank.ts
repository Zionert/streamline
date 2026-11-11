import {
  RANK_ALPHABET,
  RANK_BASE,
  RankError,
  assertValidRank,
  digitAt,
  digitChar,
} from './keys.js';

/** Which of the shortest candidate keys to pick. */
type Placement = 'middle' | 'nearLow' | 'nearHigh';

/** Key for the first element of an empty list: the middle of the whole key space (0.5). */
export function rankFirst(): string {
  return RANK_ALPHABET.charAt(RANK_BASE >> 1);
}

/**
 * Shortest key strictly between `low` and `high` (`null` = open bound: 0 or 1).
 *
 * Walks the digits from left to right. At position `i` every key in the interval must
 * start with the digits of `low` (padded with zeros) seen so far, so the only freedom is the
 * digit at `i`. If some digit there yields a key inside the interval, the key ends at `i`
 * (which makes it the shortest possible); otherwise the digit of `low` is copied and the
 * walk continues. Inputs must be valid and ordered; callers check that.
 */
function shortestBetween(low: string | null, high: string | null, placement: Placement): string {
  let prefix = '';
  // True while `prefix` still equals the beginning of `high`, i.e. `high` constrains digit i.
  let highActive = high !== null;

  for (let i = 0; ; i++) {
    const lowDigit = low !== null && i < low.length ? digitAt(low, i) : 0;
    let highDigit = -1;
    let maxDigit = RANK_BASE - 1;
    if (highActive && high !== null) {
      highDigit = digitAt(high, i);
      // `prefix + highDigit` is still below `high` only if `high` has more digits after it.
      maxDigit = i + 1 < high.length ? highDigit : highDigit - 1;
    }
    // Strictly above `low`; also never 0, so the key cannot end with the minimum digit.
    const minDigit = lowDigit + 1;

    if (minDigit <= maxDigit) {
      let digit: number;
      if (placement === 'nearLow') digit = minDigit;
      else if (placement === 'nearHigh') digit = maxDigit;
      else digit = (minDigit + maxDigit) >> 1;
      return prefix + digitChar(digit);
    }

    prefix += digitChar(lowDigit);
    if (lowDigit !== highDigit) highActive = false;
  }
}

function assertBounds(low: string | null, high: string | null): void {
  if (low !== null) assertValidRank(low, 'lower bound rank');
  if (high !== null) assertValidRank(high, 'upper bound rank');
  if (low !== null && high !== null && !(low < high)) {
    throw new RankError(
      'INVALID_RANK_ORDER',
      `Lower bound rank ${JSON.stringify(low)} must be less than upper bound ${JSON.stringify(high)}`,
    );
  }
}

/**
 * Key strictly between `low` and `high`; `null` means the start (for `low`) or end
 * (for `high`) of the list. Always returns the shortest such key:
 * - both bounds given: the one closest to the middle of the gap,
 * - only one bound given: the one closest to that neighbour, so appending (or prepending)
 *   repeatedly increments a digit and the key grows by one character per ~61 inserts,
 * - no bounds: {@link rankFirst}.
 *
 * Usage contract:
 * - The function is deterministic: two concurrent inserts into the same gap get the same
 *   key. Persist ranks under a unique `(container, rank)` constraint and retry on conflict,
 *   or serialize writes to a list (e.g. row locking).
 * - Keys are computed on the server from the persisted neighbours, not taken from clients.
 * - If the result is longer than `RANK_MAX_LENGTH`, do not persist it; instead rewrite
 *   the ranks of the whole list with `rebalanceRanks` in the same transaction.
 *
 * Throws {@link RankError} on malformed keys or when `low >= high`.
 */
export function rankBetween(low: string | null, high: string | null): string {
  assertBounds(low, high);
  if (low !== null && high === null) return shortestBetween(low, null, 'nearLow');
  if (low === null && high !== null) return shortestBetween(null, high, 'nearHigh');
  return shortestBetween(low, high, 'middle');
}

/** Key placed after `low` (end of the list). */
export function rankAfter(low: string): string {
  return rankBetween(low, null);
}

/** Key placed before `high` (start of the list). */
export function rankBefore(high: string): string {
  return rankBetween(null, high);
}

/**
 * `count` ascending keys strictly between `low` and `high`, for inserting several elements
 * at once. Uses recursive bisection, so key length grows only logarithmically with `count`.
 */
export function rankSequenceBetween(
  low: string | null,
  high: string | null,
  count: number,
): string[] {
  assertBounds(low, high);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RankError('INVALID_ARGUMENT', `Count must be a non-negative integer, got ${count}`);
  }

  const keys = new Array<string>(count);
  const fill = (from: number, to: number, a: string | null, b: string | null): void => {
    if (from > to) return;
    const mid = (from + to) >> 1;
    const key = shortestBetween(a, b, 'middle');
    keys[mid] = key;
    fill(from, mid - 1, a, key);
    fill(mid + 1, to, key, b);
  };
  fill(0, count - 1, low, high);
  return keys;
}
