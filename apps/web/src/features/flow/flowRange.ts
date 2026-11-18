import {
  ANALYTICS_MAX_RANGE_DAYS,
  addDays,
  daysBetween,
  localDateSchema,
  toLocalDateKey,
} from '@streamline/shared';

import { browserTimeZone, formatDateRange } from './flowFormat';

/**
 * The date range of the Flow page and its place in the URL query:
 * - a preset is `?range=14d|30d|90d`, the default (30 days) has no query at all,
 * - a custom range is `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both inclusive).
 * Presets end today in the browser's time zone.
 */
export const RANGE_PRESETS = [
  { value: '14d', days: 14, label: 'Last 14 days' },
  { value: '30d', days: 30, label: 'Last 30 days' },
  { value: '90d', days: 90, label: 'Last 90 days' },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]['value'];

export const DEFAULT_RANGE_PRESET: RangePreset = '30d';

export type FlowRangeSelection =
  { kind: 'preset'; preset: RangePreset } | { kind: 'custom'; from: string; to: string };

export const DEFAULT_RANGE: FlowRangeSelection = { kind: 'preset', preset: DEFAULT_RANGE_PRESET };

/** Inclusive local dates `YYYY-MM-DD` of a range. */
export interface DateRange {
  from: string;
  to: string;
}

/** Query parameters owned by the range. */
const RANGE_PARAMS = ['range', 'from', 'to'] as const;

function presetOf(value: string): (typeof RANGE_PRESETS)[number] | undefined {
  return RANGE_PRESETS.find((preset) => preset.value === value);
}

/** Today in the browser's time zone, `YYYY-MM-DD`. */
export function localToday(timeZone: string = browserTimeZone()): string {
  return toLocalDateKey(new Date(), timeZone);
}

function isDateKey(value: string): boolean {
  return localDateSchema.safeParse(value).success;
}

export interface CustomRangeErrors {
  from?: string;
  to?: string;
}

export const RANGE_ERRORS = {
  invalidFrom: 'Enter a valid start date.',
  invalidTo: 'Enter a valid end date.',
  futureTo: 'The end date cannot be in the future.',
  inverted: 'The start date must be on or before the end date.',
  tooLong: `The range can be at most ${String(ANALYTICS_MAX_RANGE_DAYS)} days.`,
} as const;

/**
 * Checks a custom range against the limits of the API: valid dates, `from <= to`, at most
 * {@link ANALYTICS_MAX_RANGE_DAYS} days and `to` not after `today`. Empty when it is valid.
 */
export function validateCustomRange(from: string, to: string, today: string): CustomRangeErrors {
  const errors: CustomRangeErrors = {};
  const fromValid = isDateKey(from);
  const toValid = isDateKey(to);
  if (!fromValid) {
    errors.from = RANGE_ERRORS.invalidFrom;
  }
  if (!toValid) {
    errors.to = RANGE_ERRORS.invalidTo;
  } else if (to > today) {
    errors.to = RANGE_ERRORS.futureTo;
  }
  if (fromValid && toValid) {
    const days = daysBetween(from, to) + 1;
    if (days < 1) {
      errors.from = RANGE_ERRORS.inverted;
    } else if (days > ANALYTICS_MAX_RANGE_DAYS) {
      errors.from = RANGE_ERRORS.tooLong;
    }
  }
  return errors;
}

export function hasRangeErrors(errors: CustomRangeErrors): boolean {
  return errors.from !== undefined || errors.to !== undefined;
}

export interface ParsedRange {
  selection: FlowRangeSelection;
  /**
   * The query already is the canonical form of the selection. Otherwise (an invalid value, or
   * `range=30d` spelled out) the page rewrites it.
   */
  isCanonical: boolean;
}

/** The range selected by the URL query; anything invalid falls back to the default. */
export function parseRangeQuery(params: URLSearchParams, today: string): ParsedRange {
  const range = params.get('range');
  const from = params.get('from');
  const to = params.get('to');
  if (range === null && from === null && to === null) {
    return { selection: DEFAULT_RANGE, isCanonical: true };
  }
  if (range !== null && from === null && to === null) {
    const preset = presetOf(range);
    if (preset && preset.value !== DEFAULT_RANGE_PRESET) {
      return { selection: { kind: 'preset', preset: preset.value }, isCanonical: true };
    }
    return { selection: DEFAULT_RANGE, isCanonical: false };
  }
  if (range === null && from !== null && to !== null) {
    if (!hasRangeErrors(validateCustomRange(from, to, today))) {
      return { selection: { kind: 'custom', from, to }, isCanonical: true };
    }
  }
  return { selection: DEFAULT_RANGE, isCanonical: false };
}

/** `params` with the range parameters replaced by those of `selection` (others are kept). */
export function withRangeQuery(
  params: URLSearchParams,
  selection: FlowRangeSelection,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of RANGE_PARAMS) {
    next.delete(name);
  }
  if (selection.kind === 'custom') {
    next.set('from', selection.from);
    next.set('to', selection.to);
  } else if (selection.preset !== DEFAULT_RANGE_PRESET) {
    next.set('range', selection.preset);
  }
  return next;
}

/** The dates of a selection; a preset of N days ends today and starts N - 1 days earlier. */
export function resolveRange(selection: FlowRangeSelection, today: string): DateRange {
  if (selection.kind === 'custom') {
    return { from: selection.from, to: selection.to };
  }
  const days = presetOf(selection.preset)?.days ?? 30;
  return { from: addDays(today, -(days - 1)), to: today };
}

export function isSameSelection(a: FlowRangeSelection, b: FlowRangeSelection): boolean {
  if (a.kind === 'preset') {
    return b.kind === 'preset' && a.preset === b.preset;
  }
  return b.kind === 'custom' && a.from === b.from && a.to === b.to;
}

/** Text of the range button: `Last 30 days`, or the dates of a custom range. */
export function rangeLabel(selection: FlowRangeSelection): string {
  if (selection.kind === 'custom') {
    return formatDateRange(selection.from, selection.to);
  }
  return presetOf(selection.preset)?.label ?? '';
}

/** The range in running text: `last 30 days`, or `18 Oct – 16 Nov`. */
export function rangeCaption(selection: FlowRangeSelection): string {
  if (selection.kind === 'custom') {
    return formatDateRange(selection.from, selection.to);
  }
  return rangeLabel(selection).toLowerCase();
}
