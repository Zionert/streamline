import { type FlowCardInput, deriveCardFlow } from './card-flow.js';
import {
  DEFAULT_TIME_ZONE,
  type LocalDateKey,
  addDays,
  assertValidTimeZone,
  dateRange,
  resolveDateRange,
  startOfIsoWeek,
  toLocalDateKey,
} from './dates.js';
import { assertIntegerInRange, assertValidDate } from './errors.js';

export type ThroughputGranularity = 'day' | 'week';

export interface ThroughputPoint {
  /** Local date (`'day'`) or the Monday of the ISO week (`'week'`). */
  date: LocalDateKey;
  count: number;
}

export interface ThroughputOptions {
  from: Date;
  to: Date;
  /** IANA time zone used to assign completions to days; default `'UTC'`. */
  timeZone?: string;
  granularity?: ThroughputGranularity;
}

/** Local completion dates of all completed cards (cards that never left DONE included). */
export function completionDateKeys(
  cards: readonly FlowCardInput[],
  timeZone: string,
): LocalDateKey[] {
  const keys: LocalDateKey[] = [];
  for (const card of cards) {
    const { completedAt } = deriveCardFlow(card);
    if (completedAt) keys.push(toLocalDateKey(completedAt, timeZone));
  }
  return keys;
}

/**
 * Number of cards completed per local day or ISO week (WF-FLOW-02), zero-filled for every
 * day/week of the inclusive range `[from, to]`. Only completions whose local date is inside
 * the range are counted, so the first and last week may cover only part of the week.
 */
export function throughput(
  cards: readonly FlowCardInput[],
  options: ThroughputOptions,
): ThroughputPoint[] {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const granularity = options.granularity ?? 'day';
  const { fromKey, toKey } = resolveDateRange(options.from, options.to, timeZone);

  const counts = new Map<LocalDateKey, number>();
  const bucketOf = granularity === 'week' ? startOfIsoWeek : (key: LocalDateKey) => key;
  let bucket = bucketOf(fromKey);
  const lastBucket = bucketOf(toKey);
  const step = granularity === 'week' ? 7 : 1;
  while (bucket <= lastBucket) {
    counts.set(bucket, 0);
    bucket = addDays(bucket, step);
  }

  for (const key of completionDateKeys(cards, timeZone)) {
    if (key < fromKey || key > toKey) continue;
    const target = bucketOf(key);
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return [...counts].map(([date, count]) => ({ date, count }));
}

export const DEFAULT_SAMPLE_DAYS = 30;

export interface DailySamplesOptions {
  /** The last sampled day is the local date of this instant (inclusive); use a complete day. */
  endDate: Date;
  /** Number of days, default {@link DEFAULT_SAMPLE_DAYS}. */
  days?: number;
  timeZone?: string;
}

/**
 * Daily completion counts of the last `days` local days ending with the day of `endDate`
 * (inclusive, oldest first, zeros included) — the input of the Monte Carlo forecast.
 *
 * Pass the last COMPLETE local day as `endDate` (e.g. yesterday in `timeZone`), not "now":
 * today is still in progress, so its count is artificially low and would bias forecasts
 * towards fewer cards and later dates.
 */
export function dailyThroughputSamples(
  cards: readonly FlowCardInput[],
  options: DailySamplesOptions,
): number[] {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const days = options.days ?? DEFAULT_SAMPLE_DAYS;
  assertValidDate(options.endDate, 'endDate');
  assertValidTimeZone(timeZone);
  assertIntegerInRange(days, 'days', 1, 3650);
  const toKey = toLocalDateKey(options.endDate, timeZone);
  const fromKey = addDays(toKey, -(days - 1));

  const counts = new Map<LocalDateKey, number>(dateRange(fromKey, toKey).map((d) => [d, 0]));
  for (const key of completionDateKeys(cards, timeZone)) {
    const current = counts.get(key);
    if (current !== undefined) counts.set(key, current + 1);
  }
  return [...counts.values()];
}
