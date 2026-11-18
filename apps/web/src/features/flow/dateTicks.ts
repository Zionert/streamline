import { addDays, dateRange, daysBetween, startOfIsoWeek } from '@streamline/shared';

/**
 * Axis ticks of the date charts. Dates are local calendar keys `YYYY-MM-DD` of the range's time
 * zone, placed on the axis as UTC midnight of the key: the axis counts calendar days, so a
 * daylight saving change never shifts, repeats or drops a day.
 */

export type TickStep = 'day' | 'week' | 'month';

/** Ranges up to this many days get a tick per day. */
export const DAILY_TICKS_MAX_DAYS = 14;
/** Ranges longer than this get a tick per month (otherwise one per week, on Mondays). */
export const WEEKLY_TICKS_MAX_DAYS = 120;
/** Most ticks of an axis on a wide and on a narrow (below 640 px) screen. */
export const MAX_TICKS_WIDE = 10;
export const MAX_TICKS_NARROW = 5;

const MS_PER_DAY = 86_400_000;

/** Position of a calendar date on the time axis: UTC midnight of the key. */
export function dateKeyToMs(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

/** One formatter per time zone: creating them is slow and a chart converts every point. */
const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

function wallClockFormat(timeZone: string): Intl.DateTimeFormat {
  let format = wallClockFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallClockFormats.set(timeZone, format);
  }
  return format;
}

/**
 * Position of an instant on the time axis: its local date and time of day in `timeZone`,
 * encoded like {@link dateKeyToMs} (so the point sits inside its local day).
 */
export function instantToAxisMs(instant: string, timeZone: string): number {
  const parts = wallClockFormat(timeZone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  return Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
}

/** The axis domain of a range: from the start of `from` to the end of `to`. */
export function rangeDomain(from: string, to: string): [number, number] {
  return [dateKeyToMs(from), dateKeyToMs(to) + MS_PER_DAY];
}

/** Daily ticks for short ranges, weekly (Mondays) for longer ones, monthly beyond 120 days. */
export function tickStep(days: number): TickStep {
  if (days <= DAILY_TICKS_MAX_DAYS) return 'day';
  if (days <= WEEKLY_TICKS_MAX_DAYS) return 'week';
  return 'month';
}

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const monthYear = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Label of a tick: `12 Nov` for days and weeks, `Nov 2026` for months. */
export function tickLabel(key: string, step: TickStep): string {
  return (step === 'month' ? monthYear : dayMonth).format(new Date(dateKeyToMs(key)));
}

function candidateKeys(from: string, to: string, step: TickStep): string[] {
  if (step === 'day') {
    return dateRange(from, to);
  }
  const keys: string[] = [];
  if (step === 'week') {
    let monday = startOfIsoWeek(from);
    if (monday < from) monday = addDays(monday, 7);
    for (let key = monday; key <= to; key = addDays(key, 7)) keys.push(key);
    return keys;
  }
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  if (from.slice(8) !== '01') month += 1;
  for (;;) {
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const key = `${String(year)}-${String(month).padStart(2, '0')}-01`;
    if (key > to) return keys;
    keys.push(key);
    month += 1;
  }
}

export interface DateTicks {
  step: TickStep;
  /** Calendar dates of the ticks, ascending, each with a distinct label. */
  keys: string[];
}

/**
 * Evenly spaced ticks of the range `from`..`to` (inclusive local dates), at most `maxTicks`:
 * when more would fit the step, every n-th one is kept.
 */
export function dateTicks(from: string, to: string, maxTicks: number): DateTicks {
  const step = tickStep(daysBetween(from, to) + 1);
  const seen = new Set<string>();
  const keys = candidateKeys(from, to, step).filter((key) => {
    const label = tickLabel(key, step);
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
  return { step, keys: thinTicks(keys, maxTicks) };
}

/** At most `maxTicks` of `keys`, evenly spaced: every n-th one, starting with the first. */
export function thinTicks<T>(keys: readonly T[], maxTicks: number): T[] {
  const every = Math.max(1, Math.ceil(keys.length / Math.max(1, maxTicks)));
  return keys.filter((_, index) => index % every === 0);
}

/** The calendar date of a position on the time axis (the inverse of {@link dateKeyToMs}). */
export function axisMsToDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
