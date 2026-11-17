import { FlowError, MS_PER_DAY, assertValidDate } from './errors.js';

/**
 * Calendar days are represented as local date keys `YYYY-MM-DD` in an IANA time zone.
 * Instants are converted to keys once with `Intl.DateTimeFormat`; everything after that is
 * calendar arithmetic on the keys (via UTC midnights), so DST transitions never shift a day.
 */
export type LocalDateKey = string;

export const DEFAULT_TIME_ZONE = 'UTC';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new FlowError('INVALID_TIME_ZONE', `Invalid time zone: ${JSON.stringify(timeZone)}`);
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

/** Throws {@link FlowError} `INVALID_TIME_ZONE` unless `timeZone` is a known IANA zone. */
export function assertValidTimeZone(timeZone: unknown): asserts timeZone is string {
  if (typeof timeZone !== 'string' || timeZone === '') {
    throw new FlowError('INVALID_TIME_ZONE', `Invalid time zone: ${JSON.stringify(timeZone)}`);
  }
  formatterFor(timeZone);
}

/** Whether `timeZone` is a known IANA time zone (accepted by `Intl.DateTimeFormat`). */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  try {
    assertValidTimeZone(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date (`YYYY-MM-DD`) of `instant` in `timeZone`. */
export function toLocalDateKey(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): LocalDateKey {
  assertValidDate(instant, 'date');
  const parts = formatterFor(timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** UTC midnight of a date key; rejects malformed keys and non-existent dates (e.g. Feb 30). */
function keyToUtcMs(key: LocalDateKey): number {
  const invalid = () =>
    new FlowError('INVALID_ARGUMENT', `Invalid date key: ${JSON.stringify(key)}`);
  if (!DATE_KEY_PATTERN.test(key)) throw invalid();
  const ms = Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10)),
  );
  // Date.UTC silently rolls over (2026-02-30 -> 2026-03-02); a round trip catches that.
  if (utcMsToKey(ms) !== key) throw invalid();
  return ms;
}

function utcMsToKey(ms: number): LocalDateKey {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar date `days` days after `key` (negative = before). */
export function addDays(key: LocalDateKey, days: number): LocalDateKey {
  return utcMsToKey(keyToUtcMs(key) + days * MS_PER_DAY);
}

/** Number of calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDateKey, to: LocalDateKey): number {
  return Math.round((keyToUtcMs(to) - keyToUtcMs(from)) / MS_PER_DAY);
}

/** Every calendar date from `from` to `to`, both inclusive; empty when `to < from`. */
export function dateRange(from: LocalDateKey, to: LocalDateKey): LocalDateKey[] {
  const count = daysBetween(from, to) + 1;
  const result: LocalDateKey[] = [];
  for (let i = 0; i < count; i++) result.push(addDays(from, i));
  return result;
}

/**
 * An instant whose local date in `timeZone` is `key`, for passing a local day to the metric
 * functions (which take instants and only look at their local date). The instant is near the
 * middle of the day; which one exactly is unspecified. Throws `INVALID_ARGUMENT` for a malformed
 * key or a date that does not exist in the zone (e.g. a day skipped by a date-line change).
 */
export function instantOnLocalDate(key: LocalDateKey, timeZone: string = DEFAULT_TIME_ZONE): Date {
  assertValidTimeZone(timeZone);
  // UTC noon is within a day of every zone's local date (offsets are between -12 and +14 h),
  // so at most two corrections by one day are needed.
  let ms = keyToUtcMs(key) + MS_PER_DAY / 2;
  for (let attempt = 0; attempt < 3; attempt++) {
    const shift = daysBetween(key, toLocalDateKey(new Date(ms), timeZone));
    if (shift === 0) return new Date(ms);
    ms -= shift * MS_PER_DAY;
  }
  throw new FlowError(
    'INVALID_ARGUMENT',
    `Date ${JSON.stringify(key)} does not exist in time zone ${JSON.stringify(timeZone)}`,
  );
}

/** Monday of the ISO week (Monday-Sunday) containing `key`. */
export function startOfIsoWeek(key: LocalDateKey): LocalDateKey {
  const weekday = new Date(keyToUtcMs(key)).getUTCDay(); // 0 = Sunday
  return addDays(key, -((weekday + 6) % 7));
}

/**
 * Validates a `{ from, to, timeZone }` range and converts it to local date keys.
 * Throws `INVALID_ARGUMENT` when `from` falls on a later local day than `to`.
 */
export function resolveDateRange(
  from: Date,
  to: Date,
  timeZone: string,
): { fromKey: LocalDateKey; toKey: LocalDateKey } {
  assertValidDate(from, 'from');
  assertValidDate(to, 'to');
  assertValidTimeZone(timeZone);
  const fromKey = toLocalDateKey(from, timeZone);
  const toKey = toLocalDateKey(to, timeZone);
  if (toKey < fromKey) {
    throw new FlowError('INVALID_ARGUMENT', '`from` must not be later than `to`');
  }
  return { fromKey, toKey };
}
