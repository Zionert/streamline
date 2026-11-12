import { describe, expect, it } from 'vitest';

import { cardsOf, type CardsByColumn } from '@/features/cards/cardOrder';
import { cardWith, columnWith, defaultColumns, memberWith } from '@/test/fixtures';

import {
  applyCardRanks,
  applyRanks,
  isNotOlder,
  placeCard,
  removeColumn,
  updateCardFields,
  updateColumnFields,
  upsertColumnByRank,
  upsertMember,
  withBoardKey,
} from './boardEventReducers';

const EARLIER = '2026-11-11T10:00:00.000Z';
const LATER = '2026-11-12T10:00:00.000Z';

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

const a = cardWith({ id: 'a', number: 1, columnId: 'col-todo', rank: 'd' });
const b = cardWith({ id: 'b', number: 2, columnId: 'col-todo', rank: 'k' });
const c = cardWith({ id: 'c', number: 3, columnId: 'col-done', rank: 'h' });

const board = (): CardsByColumn => ({ 'col-todo': [a, b], 'col-done': [c], 'col-backlog': [] });

describe('isNotOlder', () => {
  it('accepts equal and newer versions only', () => {
    expect(isNotOlder({ updatedAt: EARLIER }, { updatedAt: LATER })).toBe(true);
    expect(isNotOlder({ updatedAt: LATER }, { updatedAt: LATER })).toBe(true);
    expect(isNotOlder({ updatedAt: LATER }, { updatedAt: EARLIER })).toBe(false);
  });
});

describe('columns', () => {
  it('inserts a new column at its rank and is idempotent', () => {
    const added = columnWith({ id: 'col-new', rank: 'k' });

    const once = upsertColumnByRank(defaultColumns(), added);
    const twice = upsertColumnByRank(once, added);

    expect(ids(once)).toEqual(['col-backlog', 'col-todo', 'col-new', 'col-progress', 'col-done']);
    expect(twice).toEqual(once);
  });

  it('moves a known column to its new rank but ignores an older version', () => {
    const moved = columnWith({ id: 'col-done', rank: 'b', updatedAt: LATER, title: 'Done' });

    const columns = upsertColumnByRank(defaultColumns(), moved);
    expect(ids(columns)).toEqual(['col-backlog', 'col-done', 'col-todo', 'col-progress']);

    const stale = columnWith({ id: 'col-done', rank: 'z', updatedAt: EARLIER });
    expect(upsertColumnByRank(columns, stale)).toEqual(columns);
  });

  it('applies a rename or settings change but keeps the local rank', () => {
    const renamed = columnWith({
      id: 'col-todo',
      rank: 'OLD',
      title: 'Ready',
      wipLimit: 2,
      updatedAt: LATER,
    });

    const [, todo] = updateColumnFields(defaultColumns(), renamed);

    expect(todo).toMatchObject({ id: 'col-todo', title: 'Ready', wipLimit: 2, rank: 'h' });
  });

  it('ignores a change of an unknown column', () => {
    const unknown = columnWith({ id: 'nope', rank: 'k' });

    expect(updateColumnFields(defaultColumns(), unknown)).toEqual(defaultColumns());
  });

  it('removes a column with its cards; removing it again is a no-op', () => {
    const first = removeColumn(defaultColumns(), board(), 'col-todo');
    const second = removeColumn(first.columns, first.cardsByColumn, 'col-todo');

    expect(ids(first.columns)).toEqual(['col-backlog', 'col-progress', 'col-done']);
    expect(first.cardsByColumn['col-todo']).toBeUndefined();
    expect(second).toEqual(first);
  });

  it('applies the ranks of a rebalance and re-sorts', () => {
    const ranks = [
      { id: 'col-backlog', rank: 'x' },
      { id: 'col-done', rank: 'a' },
      { id: 'unknown', rank: 'm' },
    ];

    const columns = applyRanks(defaultColumns(), ranks);

    expect(ids(columns)).toEqual(['col-done', 'col-todo', 'col-progress', 'col-backlog']);
    expect(applyRanks(columns, ranks)).toEqual(columns);
  });
});

describe('cards', () => {
  it('adds a created card at its rank once', () => {
    const created = cardWith({ id: 'n', number: 9, columnId: 'col-todo', rank: 'g' });

    const once = placeCard(board(), created);

    expect(ids(cardsOf(once, 'col-todo'))).toEqual(['a', 'n', 'b']);
    expect(placeCard(once, created)).toEqual(once);
  });

  it('moves a card between columns by its new rank', () => {
    const moved = { ...a, columnId: 'col-done', rank: 'z', updatedAt: LATER };

    const cards = placeCard(board(), moved);

    expect(ids(cardsOf(cards, 'col-todo'))).toEqual(['b']);
    expect(ids(cardsOf(cards, 'col-done'))).toEqual(['c', 'a']);
  });

  it('ignores an older version of a card', () => {
    const shown = { ...a, columnId: 'col-done', rank: 'z', updatedAt: LATER };
    const cards = placeCard(board(), shown);

    expect(placeCard(cards, { ...a, updatedAt: EARLIER })).toEqual(cards);
  });

  it('ignores a card of a column that is not shown', () => {
    const elsewhere = cardWith({ id: 'n', number: 9, columnId: 'col-unknown', rank: 'g' });

    expect(placeCard(board(), elsewhere)).toEqual(board());
  });

  it('updates fields but keeps the position and the fields edited locally', () => {
    const remote = {
      ...b,
      title: 'Remote title',
      priority: 'HIGH' as const,
      columnId: 'col-done',
      rank: 'a',
      updatedAt: LATER,
    };

    const cards = updateCardFields(board(), remote, ['title']);

    expect(cardsOf(cards, 'col-todo')[1]).toEqual({
      ...b,
      priority: 'HIGH',
      updatedAt: LATER,
    });
  });

  it('ignores updates of unknown cards and older versions', () => {
    expect(updateCardFields(board(), { ...b, id: 'x' })).toEqual(board());
    const cards = updateCardFields(board(), { ...b, title: 'New', updatedAt: LATER });
    expect(updateCardFields(cards, { ...b, title: 'Old', updatedAt: EARLIER })).toEqual(cards);
  });

  it('applies the ranks of a column rebalance', () => {
    const cards = applyCardRanks(board(), 'col-todo', [
      { id: 'a', rank: 'w' },
      { id: 'b', rank: 'c' },
    ]);

    expect(cardsOf(cards, 'col-todo').map(({ id, rank }) => `${id}:${rank}`)).toEqual([
      'b:c',
      'a:w',
    ]);
    expect(applyCardRanks(board(), 'col-unknown', [])).toEqual(board());
  });

  it('recomputes card keys after the board key changed', () => {
    const cards = withBoardKey(board(), 'NEW');

    expect(cardsOf(cards, 'col-todo').map((card) => card.key)).toEqual(['NEW-1', 'NEW-2']);
    expect(cardsOf(cards, 'col-done')[0]?.key).toBe('NEW-3');
  });
});

describe('members', () => {
  it('adds a member once and replaces a known one', () => {
    const ola = memberWith({ userId: 'u2', name: 'Ola', role: 'MEMBER' });

    const once = upsertMember([memberWith()], ola);
    const twice = upsertMember(once, ola);
    const promoted = upsertMember(twice, { ...ola, role: 'ADMIN' });

    expect(once).toHaveLength(2);
    expect(twice).toEqual(once);
    expect(promoted[1]?.role).toBe('ADMIN');
  });
});
