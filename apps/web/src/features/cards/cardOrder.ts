import type { Card, ColumnCards } from '@streamline/shared';

import { reorderList, restoreOriginalPosition, sortByRank } from '@/features/boards/columnOrder';

/** Cards of the opened board by column id, each list in display order. */
export type CardsByColumn = Readonly<Record<string, readonly Card[]>>;

const NO_CARDS: readonly Card[] = [];

/** The cards of a column (an empty list for an unknown column). */
export function cardsOf(cardsByColumn: CardsByColumn, columnId: string): readonly Card[] {
  return cardsByColumn[columnId] ?? NO_CARDS;
}

/** Turns the `GET .../cards` response into lists by column, sorted by rank. */
export function groupCards(columns: readonly ColumnCards[]): CardsByColumn {
  const result: Record<string, readonly Card[]> = {};
  for (const column of columns) {
    result[column.columnId] = sortByRank(column.cards);
  }
  return result;
}

export interface CardLocation {
  card: Card;
  columnId: string;
  index: number;
}

/** Where the card is shown right now, or `null` when it is not on the board. */
export function findCard(cardsByColumn: CardsByColumn, cardId: string): CardLocation | null {
  for (const [columnId, cards] of Object.entries(cardsByColumn)) {
    const index = cards.findIndex((card) => card.id === cardId);
    const card = cards[index];
    if (card) {
      return { card, columnId, index };
    }
  }
  return null;
}

/** The card with the given key (e.g. `SL-12`), or `null`. */
export function findCardByKey(cardsByColumn: CardsByColumn, key: string): Card | null {
  for (const cards of Object.values(cardsByColumn)) {
    const card = cards.find((entry) => entry.key === key);
    if (card) {
      return card;
    }
  }
  return null;
}

/**
 * Moves a card to `toIndex` of `toColumnId` (the index in the target list after the move, as
 * reported by drag & drop). Within one column this is a reorder.
 */
export function moveCardLocally(
  cardsByColumn: CardsByColumn,
  cardId: string,
  toColumnId: string,
  toIndex: number,
): CardsByColumn {
  const location = findCard(cardsByColumn, cardId);
  if (!location) {
    return cardsByColumn;
  }
  const { card, columnId, index } = location;
  if (columnId === toColumnId) {
    return {
      ...cardsByColumn,
      [columnId]: reorderList(cardsOf(cardsByColumn, columnId), index, toIndex),
    };
  }
  const source = cardsOf(cardsByColumn, columnId).filter((entry) => entry.id !== cardId);
  const target = [...cardsOf(cardsByColumn, toColumnId)];
  const at = Math.min(Math.max(toIndex, 0), target.length);
  target.splice(at, 0, { ...card, columnId: toColumnId });
  return { ...cardsByColumn, [columnId]: source, [toColumnId]: target };
}

/**
 * Undoes a local move of one card without discarding other changes made meanwhile: the card (in
 * its current version, e.g. with a title edited during the move) goes back to its original column
 * next to its original neighbours, with its original column and rank.
 */
export function restoreCardPosition(
  cardsByColumn: CardsByColumn,
  original: Card,
  originalList: readonly Card[],
): CardsByColumn {
  const location = findCard(cardsByColumn, original.id);
  if (!location) {
    return cardsByColumn;
  }
  const result: Record<string, readonly Card[]> = { ...cardsByColumn };
  result[location.columnId] = cardsOf(cardsByColumn, location.columnId).filter(
    (card) => card.id !== original.id,
  );
  const restored: Card = { ...location.card, columnId: original.columnId, rank: original.rank };
  const home = [...cardsOf(result, original.columnId), restored];
  result[original.columnId] = restoreOriginalPosition(home, original.id, originalList);
  return result;
}

/** Replaces the card (matched by id) wherever it is shown. */
export function replaceCard(cardsByColumn: CardsByColumn, card: Card): CardsByColumn {
  const location = findCard(cardsByColumn, card.id);
  if (!location) {
    return cardsByColumn;
  }
  const cards = [...cardsOf(cardsByColumn, location.columnId)];
  cards[location.index] = card;
  return { ...cardsByColumn, [location.columnId]: cards };
}

/** Adds a card that is not shown yet to its column, at the place given by its rank. */
export function insertCardByRank(cardsByColumn: CardsByColumn, card: Card): CardsByColumn {
  if (findCard(cardsByColumn, card.id)) {
    return cardsByColumn;
  }
  const cards = [...cardsOf(cardsByColumn, card.columnId)];
  // Strict `<` on rank strings (code unit order, like `COLLATE "C"`), never localeCompare.
  const index = cards.findIndex((entry) => card.rank < entry.rank);
  cards.splice(index < 0 ? cards.length : index, 0, card);
  return { ...cardsByColumn, [card.columnId]: cards };
}

/** Removes the card wherever it is shown. */
export function removeCard(cardsByColumn: CardsByColumn, cardId: string): CardsByColumn {
  const location = findCard(cardsByColumn, cardId);
  if (!location) {
    return cardsByColumn;
  }
  return {
    ...cardsByColumn,
    [location.columnId]: cardsOf(cardsByColumn, location.columnId).filter(
      (card) => card.id !== cardId,
    ),
  };
}

/** Clears the assignee of every card assigned to `userId` (the member left the board). */
export function unassignCards(cardsByColumn: CardsByColumn, userId: string): CardsByColumn {
  const result: Record<string, readonly Card[]> = {};
  for (const [columnId, cards] of Object.entries(cardsByColumn)) {
    result[columnId] = cards.some((card) => card.assigneeId === userId)
      ? cards.map((card) => (card.assigneeId === userId ? { ...card, assigneeId: null } : card))
      : cards;
  }
  return result;
}
