import { describe, expect, it } from 'vitest';

import { cardWith } from '@/test/fixtures';

import {
  cardsOf,
  findCard,
  findCardByKey,
  groupCards,
  insertCardByRank,
  moveCardLocally,
  removeCard,
  replaceCard,
  restoreCardPosition,
  unassignCards,
  type CardsByColumn,
} from './cardOrder';

const a1 = cardWith({ id: 'a1', number: 1, columnId: 'A', rank: 'b' });
const a2 = cardWith({ id: 'a2', number: 2, columnId: 'A', rank: 'h' });
const a3 = cardWith({ id: 'a3', number: 3, columnId: 'A', rank: 'p' });
const b1 = cardWith({ id: 'b1', number: 4, columnId: 'B', rank: 'h' });

const board: CardsByColumn = { A: [a1, a2, a3], B: [b1], C: [] };

const ids = (cards: CardsByColumn, columnId: string) =>
  cardsOf(cards, columnId).map((card) => card.id);

describe('groupCards', () => {
  it('keys the lists by column and sorts by rank in code unit order', () => {
    const lower = cardWith({ id: 'lower', number: 1, columnId: 'A', rank: 'a' });
    const upper = cardWith({ id: 'upper', number: 2, columnId: 'A', rank: 'B' });
    const grouped = groupCards([
      { columnId: 'A', cards: [lower, upper] },
      { columnId: 'B', cards: [] },
    ]);

    // Uppercase sorts before lowercase (like `COLLATE "C"`), unlike localeCompare.
    expect(ids(grouped, 'A')).toEqual(['upper', 'lower']);
    expect(grouped.B).toEqual([]);
    expect(cardsOf(grouped, 'unknown')).toEqual([]);
  });
});

describe('lookups', () => {
  it('finds a card by id and by key', () => {
    expect(findCard(board, 'a2')).toEqual({ card: a2, columnId: 'A', index: 1 });
    expect(findCard(board, 'missing')).toBeNull();
    expect(findCardByKey(board, 'SB-4')).toBe(b1);
    expect(findCardByKey(board, 'SB-99')).toBeNull();
  });
});

describe('moveCardLocally', () => {
  it('reorders within a column', () => {
    const moved = moveCardLocally(board, 'a1', 'A', 2);

    expect(ids(moved, 'A')).toEqual(['a2', 'a3', 'a1']);
    expect(moved.B).toBe(board.B);
  });

  it('moves to another column and updates the column id', () => {
    const moved = moveCardLocally(board, 'a2', 'B', 0);

    expect(ids(moved, 'A')).toEqual(['a1', 'a3']);
    expect(ids(moved, 'B')).toEqual(['a2', 'b1']);
    expect(findCard(moved, 'a2')?.card.columnId).toBe('B');
  });

  it('moves into an empty column', () => {
    const moved = moveCardLocally(board, 'b1', 'C', 0);

    expect(ids(moved, 'B')).toEqual([]);
    expect(ids(moved, 'C')).toEqual(['b1']);
  });

  it('leaves the cards unchanged for an unknown card', () => {
    expect(moveCardLocally(board, 'missing', 'B', 0)).toBe(board);
  });
});

describe('restoreCardPosition', () => {
  it('puts a card moved to another column back next to its original neighbours', () => {
    const moved = moveCardLocally(board, 'a2', 'B', 1);
    const restored = restoreCardPosition(moved, a2, board.A ?? []);

    expect(ids(restored, 'A')).toEqual(['a1', 'a2', 'a3']);
    expect(ids(restored, 'B')).toEqual(['b1']);
    expect(findCard(restored, 'a2')?.card).toEqual(a2);
  });

  it('keeps changes made while the move was in flight', () => {
    const moved = moveCardLocally(board, 'a1', 'B', 0);
    const edited = replaceCard(
      {
        ...moved,
        B: [...cardsOf(moved, 'B'), cardWith({ id: 'new', number: 9, columnId: 'B', rank: 'z' })],
      },
      { ...a1, columnId: 'B', title: 'Renamed meanwhile' },
    );
    const restored = restoreCardPosition(edited, a1, board.A ?? []);

    expect(ids(restored, 'A')).toEqual(['a1', 'a2', 'a3']);
    expect(ids(restored, 'B')).toEqual(['b1', 'new']);
    expect(findCard(restored, 'a1')?.card).toMatchObject({
      title: 'Renamed meanwhile',
      columnId: 'A',
      rank: 'b',
    });
  });

  it('restores a reorder within the same column', () => {
    const moved = moveCardLocally(board, 'a3', 'A', 0);
    const restored = restoreCardPosition(moved, a3, board.A ?? []);

    expect(ids(restored, 'A')).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('list updates', () => {
  it('replaces and removes a card wherever it is', () => {
    const renamed = replaceCard(board, { ...b1, title: 'Renamed' });
    expect(cardsOf(renamed, 'B')[0]?.title).toBe('Renamed');
    expect(replaceCard(board, cardWith({ id: 'x', number: 9, columnId: 'A', rank: 'c' }))).toBe(
      board,
    );

    expect(ids(removeCard(board, 'a2'), 'A')).toEqual(['a1', 'a3']);
  });

  it('inserts a card that is not shown yet at its rank', () => {
    const late = cardWith({ id: 'late', number: 9, columnId: 'A', rank: 'k' });

    expect(ids(insertCardByRank(board, late), 'A')).toEqual(['a1', 'a2', 'late', 'a3']);
    expect(insertCardByRank(board, a1)).toBe(board);
    expect(ids(insertCardByRank(board, { ...late, columnId: 'C' }), 'C')).toEqual(['late']);
  });

  it('unassigns the cards of a removed member', () => {
    const assigned: CardsByColumn = {
      A: [
        { ...a1, assigneeId: 'u1' },
        { ...a2, assigneeId: 'u2' },
      ],
      B: [b1],
    };
    const result = unassignCards(assigned, 'u1');

    expect(cardsOf(result, 'A').map((card) => card.assigneeId)).toEqual([null, 'u2']);
    expect(result.B).toBe(assigned.B);
  });
});
