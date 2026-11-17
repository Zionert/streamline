import {
  FORECAST_API_MAX_HORIZON_DAYS,
  FORECAST_MAX_REMAINING,
  addDays,
  toLocalDateKey,
} from '@streamline/shared';

import { formatCount } from './flowFormat';

export type InputCheck<T> = { ok: true; value: T } | { ok: false; message: string };

export const REMAINING_MESSAGE = `Enter a whole number from 1 to ${formatCount(FORECAST_MAX_REMAINING)}.`;
export const TARGET_DATE_REQUIRED_MESSAGE = 'Choose a target date.';
export const TARGET_DATE_PAST_MESSAGE = 'Choose a date after today.';
export const TARGET_DATE_FAR_MESSAGE = 'Choose a date at most 2 years ahead.';

/**
 * The number of cards of a "when" forecast: empty means all open cards (the API default),
 * otherwise a whole number from 1 to 10,000.
 */
export function checkRemaining(text: string): InputCheck<number | undefined> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: true, value: undefined };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: REMAINING_MESSAGE };
  }
  const value = Number(trimmed);
  if (value < 1 || value > FORECAST_MAX_REMAINING) {
    return { ok: false, message: REMAINING_MESSAGE };
  }
  return { ok: true, value };
}

export interface DateBounds {
  /** Tomorrow, `YYYY-MM-DD`. */
  min: string;
  /** Today + 730 days, `YYYY-MM-DD`. */
  max: string;
}

/** Dates a "how many" forecast accepts, counted from today in `timeZone`. */
export function targetDateBounds(timeZone: string, now: Date = new Date()): DateBounds {
  const today = toLocalDateKey(now, timeZone);
  return { min: addDays(today, 1), max: addDays(today, FORECAST_API_MAX_HORIZON_DAYS) };
}

/** The target date of a "how many" forecast: a date from tomorrow to two years ahead. */
export function checkTargetDate(text: string, bounds: DateBounds): InputCheck<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { ok: false, message: TARGET_DATE_REQUIRED_MESSAGE };
  }
  // Same-length ISO dates compare chronologically as strings.
  if (text < bounds.min) {
    return { ok: false, message: TARGET_DATE_PAST_MESSAGE };
  }
  if (text > bounds.max) {
    return { ok: false, message: TARGET_DATE_FAR_MESSAGE };
  }
  return { ok: true, value: text };
}
