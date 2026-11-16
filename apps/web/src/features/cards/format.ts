const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

/** A timestamp in the user's time zone, e.g. "12 Nov 2026, 14:05". */
export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}

/** A calendar date `YYYY-MM-DD` (no time zone), e.g. "1 Dec 2026". */
export function formatCalendarDate(date: string): string {
  return DATE_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A recent timestamp relative to `now` ("just now", "5 minutes ago", "yesterday"); a week or
 * more ago it is a date ("12 Nov 2026").
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (elapsed < MINUTE) {
    // Also covers a timestamp slightly ahead of the local clock.
    return 'just now';
  }
  if (elapsed < HOUR) {
    return RELATIVE_FORMAT.format(-Math.floor(elapsed / MINUTE), 'minute');
  }
  if (elapsed < DAY) {
    return RELATIVE_FORMAT.format(-Math.floor(elapsed / HOUR), 'hour');
  }
  if (elapsed < 7 * DAY) {
    return RELATIVE_FORMAT.format(-Math.floor(elapsed / DAY), 'day');
  }
  return SHORT_DATE_FORMAT.format(new Date(iso));
}
