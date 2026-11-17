import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  browserTimeZone,
  formatCount,
  formatDateRange,
  formatDayMonth,
  formatDays,
  formatDecimal,
  formatFullDate,
  formatInstantDayMonth,
  formatInstantFullDate,
  formatShortDecimal,
  formatSignedPercent,
  pluralize,
} from './flowFormat';

afterEach(() => {
  vi.restoreAllMocks();
});

function resolvedTimeZone(timeZone: string | undefined) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

describe('browserTimeZone', () => {
  it('is the IANA zone detected by the browser', () => {
    resolvedTimeZone('Europe/Warsaw');
    expect(browserTimeZone()).toBe('Europe/Warsaw');
  });

  it.each([undefined, '', 'Not/AZone'])('falls back to UTC for %s', (timeZone) => {
    resolvedTimeZone(timeZone);
    expect(browserTimeZone()).toBe('UTC');
  });
});

describe('numbers', () => {
  it('formats days with one decimal and a dash when unknown', () => {
    expect(formatDays(4.5)).toBe('4.5 d');
    expect(formatDays(3)).toBe('3.0 d');
    expect(formatDays(11.64)).toBe('11.6 d');
    expect(formatDays(null)).toBe('—');
  });

  it('formats decimals, counts and percentages', () => {
    expect(formatDecimal(0.25)).toBe('0.3');
    expect(formatShortDecimal(6)).toBe('6');
    expect(formatShortDecimal(6.54)).toBe('6.5');
    expect(formatCount(10_000)).toBe('10,000');
    expect(formatSignedPercent(0.106)).toBe('+11%');
    expect(formatSignedPercent(-0.25)).toBe('-25%');
    expect(formatSignedPercent(0)).toBe('0%');
  });

  it('pluralizes', () => {
    expect(pluralize(1, 'card')).toBe('1 card');
    expect(pluralize(0, 'card')).toBe('0 cards');
    expect(pluralize(31, 'card')).toBe('31 cards');
  });
});

describe('dates', () => {
  it('formats calendar dates in en-GB without shifting them', () => {
    expect(formatDayMonth('2026-11-12')).toBe('12 Nov');
    expect(formatFullDate('2026-11-24')).toBe('24 Nov 2026');
  });

  it('adds the years to a range across the new year only', () => {
    expect(formatDateRange('2026-10-18', '2026-11-16')).toBe('18 Oct – 16 Nov');
    expect(formatDateRange('2026-12-20', '2027-01-18')).toBe('20 Dec 2026 – 18 Jan 2027');
  });

  it('formats an instant as its date in the time zone', () => {
    // 23:30 UTC on Nov 12 is already Nov 13 in Warsaw.
    expect(formatInstantDayMonth('2026-11-12T23:30:00.000Z', 'UTC')).toBe('12 Nov');
    expect(formatInstantDayMonth('2026-11-12T23:30:00.000Z', 'Europe/Warsaw')).toBe('13 Nov');
    expect(formatInstantDayMonth(Date.parse('2026-11-12T10:00:00Z'), 'UTC')).toBe('12 Nov');
    expect(formatInstantFullDate('2026-11-12T23:30:00.000Z', 'Europe/Warsaw')).toBe('13 Nov 2026');
  });
});
