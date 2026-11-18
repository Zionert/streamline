import { describe, expect, it } from 'vitest';

import {
  addDays,
  assertValidTimeZone,
  dateRange,
  daysBetween,
  instantOnLocalDate,
  isValidTimeZone,
  resolveDateRange,
  startOfIsoWeek,
  toLocalDateKey,
} from './dates.js';
import { FlowError } from './errors.js';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof FlowError ? error.code : 'not-a-flow-error';
  }
  return undefined;
}

describe('toLocalDateKey', () => {
  it('defaults to UTC', () => {
    expect(toLocalDateKey(new Date('2026-11-16T23:30:00Z'))).toBe('2026-11-16');
  });

  it('puts the same instant on different days depending on the time zone', () => {
    const lateEvening = new Date('2026-11-16T23:30:00Z');
    expect(toLocalDateKey(lateEvening, 'UTC')).toBe('2026-11-16');
    expect(toLocalDateKey(lateEvening, 'Europe/Warsaw')).toBe('2026-11-17');
    expect(toLocalDateKey(lateEvening, 'America/Los_Angeles')).toBe('2026-11-16');

    const earlyMorning = new Date('2026-11-17T05:00:00Z');
    expect(toLocalDateKey(earlyMorning, 'UTC')).toBe('2026-11-17');
    expect(toLocalDateKey(earlyMorning, 'Europe/Warsaw')).toBe('2026-11-17');
    expect(toLocalDateKey(earlyMorning, 'America/Los_Angeles')).toBe('2026-11-16');
  });

  it('handles the DST change day in Europe/Warsaw (23-hour day)', () => {
    // 2026-03-29: clocks jump from 02:00 CET to 03:00 CEST.
    expect(toLocalDateKey(new Date('2026-03-28T22:59:00Z'), 'Europe/Warsaw')).toBe('2026-03-28');
    expect(toLocalDateKey(new Date('2026-03-28T23:00:00Z'), 'Europe/Warsaw')).toBe('2026-03-29');
    expect(toLocalDateKey(new Date('2026-03-29T21:59:00Z'), 'Europe/Warsaw')).toBe('2026-03-29');
    expect(toLocalDateKey(new Date('2026-03-29T22:00:00Z'), 'Europe/Warsaw')).toBe('2026-03-30');
  });

  it('rejects invalid time zones with INVALID_TIME_ZONE', () => {
    expect(codeOf(() => toLocalDateKey(new Date(), 'Mars/Olympus'))).toBe('INVALID_TIME_ZONE');
    expect(codeOf(() => assertValidTimeZone(''))).toBe('INVALID_TIME_ZONE');
    expect(codeOf(() => assertValidTimeZone('Europe/Warsaw'))).toBeUndefined();
  });

  it('rejects invalid dates with INVALID_ARGUMENT', () => {
    expect(codeOf(() => toLocalDateKey(new Date('x')))).toBe('INVALID_ARGUMENT');
  });
});

describe('calendar arithmetic', () => {
  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('counts days between keys', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-03-30', '2026-03-28')).toBe(-2);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('lists every day of an inclusive range, one per DST day', () => {
    expect(dateRange('2026-03-28', '2026-03-30')).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
    expect(dateRange('2026-01-02', '2026-01-01')).toEqual([]);
  });

  it('finds the Monday of the ISO week', () => {
    expect(startOfIsoWeek('2026-11-16')).toBe('2026-11-16'); // Monday
    expect(startOfIsoWeek('2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(startOfIsoWeek('2026-11-23')).toBe('2026-11-23'); // next Monday
    expect(startOfIsoWeek('2027-01-01')).toBe('2026-12-28'); // Friday, week spans the year
  });

  it('rejects malformed date keys', () => {
    expect(codeOf(() => addDays('2026/01/01', 1))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => addDays('2026-02-30', 1))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => addDays('2026-13-01', 1))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => daysBetween('2026-01-01', '2027-02-29'))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => startOfIsoWeek('2026-04-31'))).toBe('INVALID_ARGUMENT');
    expect(addDays('2028-02-29', 0)).toBe('2028-02-29'); // leap day is valid
  });
});

describe('resolveDateRange', () => {
  it('converts instants to local keys', () => {
    expect(
      resolveDateRange(
        new Date('2026-11-16T23:30:00Z'),
        new Date('2026-11-17T23:30:00Z'),
        'Europe/Warsaw',
      ),
    ).toEqual({ fromKey: '2026-11-17', toKey: '2026-11-18' });
  });

  it('rejects from after to', () => {
    expect(
      codeOf(() => resolveDateRange(new Date('2026-01-02'), new Date('2026-01-01'), 'UTC')),
    ).toBe('INVALID_ARGUMENT');
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects anything else', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Warsaw')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe('instantOnLocalDate', () => {
  it.each([
    'UTC',
    'Europe/Warsaw',
    'America/Los_Angeles',
    'Pacific/Kiritimati', // UTC+14
    'Etc/GMT+12', // UTC-12
    'Asia/Kathmandu', // UTC+5:45
  ])('returns an instant on the requested local date in %s', (timeZone) => {
    for (const key of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31']) {
      expect(toLocalDateKey(instantOnLocalDate(key, timeZone), timeZone)).toBe(key);
    }
  });

  it('defaults to UTC', () => {
    expect(instantOnLocalDate('2026-11-17').toISOString()).toBe('2026-11-17T12:00:00.000Z');
  });

  it('rejects malformed keys, unknown zones and dates skipped by the zone', () => {
    expect(codeOf(() => instantOnLocalDate('2026-02-30'))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => instantOnLocalDate('2026-11-17', 'Nowhere/City'))).toBe(
      'INVALID_TIME_ZONE',
    );
    // Samoa moved across the date line and skipped 30 December 2011.
    expect(codeOf(() => instantOnLocalDate('2011-12-30', 'Pacific/Apia'))).toBe('INVALID_ARGUMENT');
    expect(toLocalDateKey(instantOnLocalDate('2011-12-31', 'Pacific/Apia'), 'Pacific/Apia')).toBe(
      '2011-12-31',
    );
  });
});
