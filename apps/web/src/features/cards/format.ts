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
