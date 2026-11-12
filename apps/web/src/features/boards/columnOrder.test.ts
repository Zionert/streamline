import { describe, expect, it } from 'vitest';

import {
  compareRanks,
  getMoveNeighbors,
  rankFitsAt,
  rankFitsBetween,
  reorderList,
  restoreOriginalPosition,
  sortByRank,
} from './columnOrder';

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

describe('compareRanks / sortByRank', () => {
  it('orders by code units like COLLATE "C", not by locale', () => {
    // Digits < uppercase < lowercase in the rank alphabet; localeCompare would put 'a' before 'B'.
    expect('a'.localeCompare('B')).toBeLessThan(0);
    expect(compareRanks('a', 'B')).toBe(1);
    expect(compareRanks('B', 'a')).toBe(-1);
    expect(compareRanks('h', 'h')).toBe(0);

    const sorted = sortByRank([
      { id: 'lower', rank: 'a' },
      { id: 'digit', rank: '5' },
      { id: 'upper', rank: 'B' },
      { id: 'longer', rank: 'a5' },
    ]);
    expect(ids(sorted)).toEqual(['digit', 'upper', 'lower', 'longer']);
  });

  it('does not mutate the input', () => {
    const input = [
      { id: 'b', rank: 'b' },
      { id: 'a', rank: 'a' },
    ];
    sortByRank(input);
    expect(ids(input)).toEqual(['b', 'a']);
  });
});

describe('reorderList', () => {
  const list = ['a', 'b', 'c', 'd'];

  it.each([
    [0, 2, ['b', 'c', 'a', 'd']],
    [3, 0, ['d', 'a', 'b', 'c']],
    [1, 3, ['a', 'c', 'd', 'b']],
    [2, 2, ['a', 'b', 'c', 'd']],
  ])('moves index %i to %i', (from, to, expected) => {
    expect(reorderList(list, from, to)).toEqual(expected);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns an unchanged copy for an out-of-range source', () => {
    expect(reorderList(list, 9, 0)).toEqual(list);
  });
});

describe('getMoveNeighbors', () => {
  const ordered = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('returns both neighbours in the middle', () => {
    expect(getMoveNeighbors(ordered, 1)).toEqual({ afterId: 'a', beforeId: 'c' });
  });

  it('uses null for the open start', () => {
    expect(getMoveNeighbors(ordered, 0)).toEqual({ afterId: null, beforeId: 'b' });
  });

  it('uses null for the open end', () => {
    expect(getMoveNeighbors(ordered, 2)).toEqual({ afterId: 'b', beforeId: null });
  });

  it('computes neighbours from the destination index after a reorder', () => {
    // Drag "a" from the first place to the last one.
    const after = reorderList(ordered, 0, 2);
    expect(getMoveNeighbors(after, 2)).toEqual({ afterId: 'c', beforeId: null });
  });
});

describe('rankFitsBetween / rankFitsAt', () => {
  it('accepts a rank strictly between its neighbours', () => {
    expect(rankFitsBetween('a', 'b', 'c')).toBe(true);
    expect(rankFitsBetween(undefined, 'b', 'c')).toBe(true);
    expect(rankFitsBetween('a', 'b', undefined)).toBe(true);
    expect(rankFitsBetween(undefined, 'b', undefined)).toBe(true);
  });

  it('rejects equal or out-of-order ranks', () => {
    expect(rankFitsBetween('b', 'b', 'c')).toBe(false);
    expect(rankFitsBetween('a', 'c', 'c')).toBe(false);
    expect(rankFitsBetween('c', 'b', undefined)).toBe(false);
    expect(rankFitsBetween(undefined, 'd', 'c')).toBe(false);
  });

  it('compares by code units: "B" sorts before "a"', () => {
    expect(rankFitsBetween('B', 'Z', 'a')).toBe(true);
    expect(rankFitsBetween('a', 'B', undefined)).toBe(false);
  });

  it('checks the item at an index against its neighbours in the list', () => {
    const list = [{ rank: 'a' }, { rank: 'm' }, { rank: 'z' }];
    expect(rankFitsAt(list, 1)).toBe(true);
    expect(rankFitsAt([{ rank: 'a' }, { rank: '0' }, { rank: 'z' }], 1)).toBe(false);
    expect(rankFitsAt(list, 5)).toBe(false);
  });
});

describe('restoreOriginalPosition', () => {
  const original = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('undoes a move when nothing else changed', () => {
    const moved = reorderList(original, 1, 3);
    expect(ids(restoreOriginalPosition(moved, 'b', original))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps a column added meanwhile and the current version of the items', () => {
    const current = [
      { id: 'a' },
      { id: 'c' },
      { id: 'd' },
      { id: 'b', title: 'renamed' },
      { id: 'e' },
    ];
    const restored = restoreOriginalPosition(current, 'b', original);
    expect(ids(restored)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(restored[1]).toEqual({ id: 'b', title: 'renamed' });
  });

  it('falls back to the original successor when the predecessor was deleted', () => {
    const current = [{ id: 'c' }, { id: 'b' }, { id: 'd' }];
    expect(ids(restoreOriginalPosition(current, 'b', original))).toEqual(['b', 'c', 'd']);
  });

  it('puts an originally first item back at the start', () => {
    const current = [{ id: 'b' }, { id: 'a' }, { id: 'c' }];
    expect(ids(restoreOriginalPosition(current, 'a', original))).toEqual(['a', 'b', 'c']);
  });

  it('falls back to the original index when both neighbours are gone', () => {
    const current = [{ id: 'a' }, { id: 'd' }, { id: 'c' }];
    expect(
      ids(
        restoreOriginalPosition(current, 'c', [{ id: 'a' }, { id: 'x' }, { id: 'c' }, { id: 'y' }]),
      ),
    ).toEqual(['a', 'd', 'c']);
  });

  it('returns the list unchanged when the item was deleted meanwhile', () => {
    const current = [{ id: 'a' }, { id: 'c' }];
    expect(ids(restoreOriginalPosition(current, 'b', original))).toEqual(['a', 'c']);
  });
});
