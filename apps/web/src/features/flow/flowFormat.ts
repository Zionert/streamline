import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@streamline/shared';

/** Shown in place of a value that cannot be computed yet. */
export const NO_VALUE = '—';

/** The IANA time zone of the browser (e.g. `Europe/Warsaw`), `UTC` when it is unknown. */
export function browserTimeZone(): string {
  try {
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

const oneDecimal = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const upToOneDecimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const wholeNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const signedPercent = new Intl.NumberFormat('en-GB', {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});

/** A number with exactly one decimal, e.g. `4.6`. */
export function formatDecimal(value: number): string {
  return oneDecimal.format(value);
}

/** A number with at most one decimal, e.g. `6` or `6.5`. */
export function formatShortDecimal(value: number): string {
  return upToOneDecimal.format(value);
}

/** A whole number with thousands separators, e.g. `10,000`. */
export function formatCount(value: number): string {
  return wholeNumber.format(value);
}

/** A duration in days, e.g. `4.5 d`; a dash when unknown. */
export function formatDays(value: number | null): string {
  return value === null ? NO_VALUE : `${formatDecimal(value)} d`;
}

/** A relative difference as a signed percentage, e.g. `+3%`, `-25%`, `0%`. */
export function formatSignedPercent(value: number): string {
  return signedPercent.format(value);
}

/** `1 card`, `3 cards`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Midnight UTC of a calendar date `YYYY-MM-DD` (formatted in UTC, so the date never shifts). */
function dateKeyToUtc(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00Z`);
}

/** A calendar date `YYYY-MM-DD` as `12 Nov`. */
export function formatDayMonth(dateKey: string): string {
  return dayMonth.format(dateKeyToUtc(dateKey));
}

/** A calendar date `YYYY-MM-DD` as `12 Nov 2026`. */
export function formatFullDate(dateKey: string): string {
  return dayMonthYear.format(dateKeyToUtc(dateKey));
}

/** A range of calendar dates, e.g. `18 Oct – 16 Nov`; with years when they differ. */
export function formatDateRange(from: string, to: string): string {
  const format = from.slice(0, 4) === to.slice(0, 4) ? formatDayMonth : formatFullDate;
  return `${format(from)} – ${format(to)}`;
}

/** An instant (ISO string or epoch milliseconds) as its calendar date in `timeZone`, e.g. `12 Nov`. */
export function formatInstantDayMonth(instant: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(
    new Date(instant),
  );
}

/** An instant (ISO string) as its calendar date in `timeZone`, e.g. `12 Nov 2026`. */
export function formatInstantFullDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(instant));
}
