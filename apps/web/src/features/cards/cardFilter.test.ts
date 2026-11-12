import { describe, expect, it } from 'vitest';

import { cardWith } from '@/test/fixtures';

import { filterCards, isFilterActive, matchesFilter, type CardFilter } from './cardFilter';

const login = cardWith({
  id: 'c1',
  number: 12,
  columnId: 'A',
  rank: 'b',
  title: 'Fix Login page',
  assigneeId: 'u1',
});
const docs = cardWith({ id: 'c2', number: 3, columnId: 'A', rank: 'c', title: 'Write docs' });

const filter = (text = '', assigneeIds: string[] = []): CardFilter => ({
  text,
  assigneeIds: new Set(assigneeIds),
});

describe('card filter', () => {
  it('is inactive without text (or with spaces only) and without assignees', () => {
    expect(isFilterActive(filter())).toBe(false);
    expect(isFilterActive(filter('   '))).toBe(false);
    expect(isFilterActive(filter('x'))).toBe(true);
    expect(isFilterActive(filter('', ['u1']))).toBe(true);
  });

  it('matches the title or the key, case-insensitively', () => {
    expect(matchesFilter(login, filter('login'))).toBe(true);
    expect(matchesFilter(login, filter('  LOGIN '))).toBe(true);
    expect(matchesFilter(login, filter('sb-12'))).toBe(true);
    expect(matchesFilter(docs, filter('login'))).toBe(false);
  });

  it('keeps only cards of the selected assignees', () => {
    expect(matchesFilter(login, filter('', ['u1', 'u2']))).toBe(true);
    expect(matchesFilter(docs, filter('', ['u1']))).toBe(false);
    expect(matchesFilter(login, filter('docs', ['u1']))).toBe(false);
  });

  it('returns the same list when inactive', () => {
    const cards = [login, docs];
    expect(filterCards(cards, filter())).toBe(cards);
    expect(filterCards(cards, filter('write'))).toEqual([docs]);
  });
});
