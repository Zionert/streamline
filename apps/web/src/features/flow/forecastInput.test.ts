import { describe, expect, it } from 'vitest';

import {
  REMAINING_MESSAGE,
  TARGET_DATE_FAR_MESSAGE,
  TARGET_DATE_PAST_MESSAGE,
  TARGET_DATE_REQUIRED_MESSAGE,
  checkRemaining,
  checkTargetDate,
  targetDateBounds,
} from './forecastInput';

describe('checkRemaining', () => {
  it('accepts an empty value (all open cards) and whole numbers from 1 to 10,000', () => {
    expect(checkRemaining('')).toEqual({ ok: true, value: undefined });
    expect(checkRemaining('  ')).toEqual({ ok: true, value: undefined });
    expect(checkRemaining('1')).toEqual({ ok: true, value: 1 });
    expect(checkRemaining(' 42 ')).toEqual({ ok: true, value: 42 });
    expect(checkRemaining('10000')).toEqual({ ok: true, value: 10_000 });
  });

  it.each(['0', '-1', '2.5', '1e3', 'abc', '10001'])('rejects %s', (text) => {
    expect(checkRemaining(text)).toEqual({ ok: false, message: REMAINING_MESSAGE });
  });

  it('names the allowed range', () => {
    expect(REMAINING_MESSAGE).toBe('Enter a whole number from 1 to 10,000.');
  });
});

describe('targetDateBounds', () => {
  it('runs from tomorrow to 730 days ahead in the time zone', () => {
    const now = new Date('2026-11-17T23:30:00Z');
    expect(targetDateBounds('UTC', now)).toEqual({ min: '2026-11-18', max: '2028-11-16' });
    // Already Nov 18 in Warsaw.
    expect(targetDateBounds('Europe/Warsaw', now)).toEqual({
      min: '2026-11-19',
      max: '2028-11-17',
    });
  });
});

describe('checkTargetDate', () => {
  const bounds = { min: '2026-11-18', max: '2028-11-16' };

  it('accepts the dates within the bounds', () => {
    expect(checkTargetDate('2026-11-18', bounds)).toEqual({ ok: true, value: '2026-11-18' });
    expect(checkTargetDate('2028-11-16', bounds)).toEqual({ ok: true, value: '2028-11-16' });
  });

  it.each([
    ['', TARGET_DATE_REQUIRED_MESSAGE],
    ['18.11.2026', TARGET_DATE_REQUIRED_MESSAGE],
    ['2026-11-17', TARGET_DATE_PAST_MESSAGE],
    ['2020-01-01', TARGET_DATE_PAST_MESSAGE],
    ['2028-11-17', TARGET_DATE_FAR_MESSAGE],
  ])('rejects "%s"', (text, message) => {
    expect(checkTargetDate(text, bounds)).toEqual({ ok: false, message });
  });
});
