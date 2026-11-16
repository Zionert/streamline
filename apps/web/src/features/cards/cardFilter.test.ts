import { describe, expect, it } from 'vitest';

import { cardWith } from '@/test/fixtures';

import {
  EMPTY_CARD_FILTER,
  filterCards,
  isFilterActive,
  matchesFilter,
  type CardFilter,
} from './cardFilter';

const login = cardWith({
  id: 'c1',
  number: 12,
  columnId: 'A',
  rank: 'b',
  title: 'Fix Login page',
  assigneeId: 'u1',
  labelIds: ['bug', 'urgent'],
});
const docs = cardWith({
  id: 'c2',
  number: 3,
  columnId: 'A',
  rank: 'c',
  title: 'Write docs',
  labelIds: ['docs'],
});
const plain = cardWith({ id: 'c3', number: 4, columnId: 'A', rank: 'd', title: 'Plain login' });

const filter = (text = '', assigneeIds: string[] = [], labelIds: string[] = []): CardFilter => ({
  text,
  assigneeIds: new Set(assigneeIds),
  labelIds: new Set(labelIds),
});

describe('card filter', () => {
  it('is inactive without text (or with spaces only) and without assignees', () => {
    expect(isFilterActive(filter())).toBe(false);
    expect(isFilterActive(filter('   '))).toBe(false);
    expect(isFilterActive(filter('x'))).toBe(true);
    expect(isFilterActive(filter('', ['u1']))).toBe(true);
    expect(isFilterActive(filter('', [], ['bug']))).toBe(true);
    expect(isFilterActive(EMPTY_CARD_FILTER)).toBe(false);
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

  it('keeps cards carrying any of the selected labels (OR within labels)', () => {
    expect(matchesFilter(login, filter('', [], ['bug']))).toBe(true);
    expect(matchesFilter(login, filter('', [], ['docs', 'urgent']))).toBe(true);
    expect(matchesFilter(docs, filter('', [], ['bug']))).toBe(false);
    expect(matchesFilter(plain, filter('', [], ['bug']))).toBe(false);
  });

  it('combines text, assignees and labels with AND', () => {
    expect(matchesFilter(login, filter('login', ['u1'], ['bug']))).toBe(true);
    expect(matchesFilter(login, filter('login', ['u2'], ['bug']))).toBe(false);
    expect(matchesFilter(login, filter('docs', ['u1'], ['bug']))).toBe(false);
    expect(matchesFilter(plain, filter('login', [], ['bug']))).toBe(false);
    expect(filterCards([login, docs, plain], filter('login', [], ['urgent', 'docs']))).toEqual([
      login,
    ]);
  });

  it('returns the same list when inactive', () => {
    const cards = [login, docs];
    expect(filterCards(cards, filter())).toBe(cards);
    expect(filterCards(cards, filter('write'))).toEqual([docs]);
  });
});
