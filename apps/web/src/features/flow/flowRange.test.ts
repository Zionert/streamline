import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RANGE,
  RANGE_ERRORS,
  isSameSelection,
  parseRangeQuery,
  rangeCaption,
  rangeLabel,
  resolveRange,
  validateCustomRange,
  withRangeQuery,
} from './flowRange';

const TODAY = '2026-11-18';

const parse = (query: string) => parseRangeQuery(new URLSearchParams(query), TODAY);

describe('parseRangeQuery', () => {
  it('selects the default range without a query', () => {
    expect(parse('')).toEqual({ selection: DEFAULT_RANGE, isCanonical: true });
    expect(parse('?other=1')).toEqual({ selection: DEFAULT_RANGE, isCanonical: true });
  });

  it('reads the presets; the spelled-out default is rewritten', () => {
    expect(parse('?range=14d')).toEqual({
      selection: { kind: 'preset', preset: '14d' },
      isCanonical: true,
    });
    expect(parse('?range=90d').selection).toEqual({ kind: 'preset', preset: '90d' });
    expect(parse('?range=30d')).toEqual({ selection: DEFAULT_RANGE, isCanonical: false });
  });

  it('reads a custom range', () => {
    expect(parse('?from=2026-01-01&to=2026-01-31')).toEqual({
      selection: { kind: 'custom', from: '2026-01-01', to: '2026-01-31' },
      isCanonical: true,
    });
    expect(parse(`?from=${TODAY}&to=${TODAY}`).isCanonical).toBe(true);
  });

  it.each([
    '?range=7d',
    '?range=',
    '?from=2026-01-01',
    '?to=2026-01-01',
    '?range=14d&from=2026-01-01&to=2026-01-31',
    '?from=2026-02-30&to=2026-03-01',
    '?from=yesterday&to=2026-03-01',
    '?from=2026-03-02&to=2026-03-01',
    '?from=2025-11-16&to=2026-11-17',
    '?from=2026-11-01&to=2026-11-19',
  ])('falls back to the default for %s', (query) => {
    expect(parse(query)).toEqual({ selection: DEFAULT_RANGE, isCanonical: false });
  });
});

describe('withRangeQuery', () => {
  const query = (base: string, selection: Parameters<typeof withRangeQuery>[1]) =>
    withRangeQuery(new URLSearchParams(base), selection).toString();

  it('writes nothing for the default range and keeps other parameters', () => {
    expect(query('range=14d&other=1', DEFAULT_RANGE)).toBe('other=1');
    expect(query('from=2026-01-01&to=2026-01-31', DEFAULT_RANGE)).toBe('');
  });

  it('writes a preset or the dates of a custom range', () => {
    expect(query('from=2026-01-01&to=2026-01-31', { kind: 'preset', preset: '90d' })).toBe(
      'range=90d',
    );
    expect(query('range=14d', { kind: 'custom', from: '2026-01-01', to: '2026-01-31' })).toBe(
      'from=2026-01-01&to=2026-01-31',
    );
  });
});

describe('resolveRange', () => {
  it('ends presets today and counts today as their last day', () => {
    expect(resolveRange({ kind: 'preset', preset: '14d' }, TODAY)).toEqual({
      from: '2026-11-05',
      to: TODAY,
    });
    expect(resolveRange(DEFAULT_RANGE, TODAY)).toEqual({ from: '2026-10-20', to: TODAY });
    expect(resolveRange({ kind: 'preset', preset: '90d' }, TODAY)).toEqual({
      from: '2026-08-21',
      to: TODAY,
    });
  });

  it('keeps the dates of a custom range', () => {
    expect(resolveRange({ kind: 'custom', from: '2026-01-01', to: '2026-01-31' }, TODAY)).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });
});

describe('validateCustomRange', () => {
  it('accepts a valid range up to today, of at most 366 days', () => {
    expect(validateCustomRange('2026-01-01', '2026-01-31', TODAY)).toEqual({});
    expect(validateCustomRange(TODAY, TODAY, TODAY)).toEqual({});
    expect(validateCustomRange('2025-11-18', TODAY, TODAY)).toEqual({});
  });

  it('reports each problem on its field', () => {
    expect(validateCustomRange('', '2026-01-31', TODAY)).toEqual({
      from: RANGE_ERRORS.invalidFrom,
    });
    expect(validateCustomRange('2026-01-01', '2026-02-30', TODAY)).toEqual({
      to: RANGE_ERRORS.invalidTo,
    });
    expect(validateCustomRange('2026-11-01', '2026-11-19', TODAY)).toEqual({
      to: RANGE_ERRORS.futureTo,
    });
    expect(validateCustomRange('2026-02-01', '2026-01-31', TODAY)).toEqual({
      from: RANGE_ERRORS.inverted,
    });
    expect(validateCustomRange('2025-11-17', TODAY, TODAY)).toEqual({
      from: RANGE_ERRORS.tooLong,
    });
    expect(validateCustomRange('', '', TODAY)).toEqual({
      from: RANGE_ERRORS.invalidFrom,
      to: RANGE_ERRORS.invalidTo,
    });
  });
});

describe('labels', () => {
  it('names presets and shows the dates of a custom range', () => {
    expect(rangeLabel(DEFAULT_RANGE)).toBe('Last 30 days');
    expect(rangeCaption({ kind: 'preset', preset: '14d' })).toBe('last 14 days');
    const custom = { kind: 'custom', from: '2026-10-01', to: '2026-10-15' } as const;
    expect(rangeLabel(custom)).toBe('1 Oct – 15 Oct');
    expect(rangeCaption(custom)).toBe('1 Oct – 15 Oct');
    expect(rangeLabel({ kind: 'custom', from: '2025-12-01', to: '2026-01-15' })).toBe(
      '1 Dec 2025 – 15 Jan 2026',
    );
  });

  it('compares selections', () => {
    expect(isSameSelection(DEFAULT_RANGE, { kind: 'preset', preset: '30d' })).toBe(true);
    expect(isSameSelection(DEFAULT_RANGE, { kind: 'preset', preset: '14d' })).toBe(false);
    const custom = { kind: 'custom', from: '2026-10-01', to: '2026-10-15' } as const;
    expect(isSameSelection(custom, { ...custom })).toBe(true);
    expect(isSameSelection(custom, DEFAULT_RANGE)).toBe(false);
  });
});
