import {
  formatCardKey,
  type BoardMember,
  type Card,
  type Column,
  type RankAssignmentPayload,
} from '@streamline/shared';

import { sortByRank } from '@/features/boards/columnOrder';
import {
  cardsOf,
  findCard,
  insertCardByRank,
  removeCard,
  type CardsByColumn,
} from '@/features/cards/cardOrder';

/**
 * Pure state transitions for events broadcast by the server. All of them are idempotent: applying
 * the same event twice gives the same state, and events about unknown ids are ignored (or, for
 * creations, add the entity once).
 */

interface Timestamped {
  updatedAt: string;
}

/**
 * Whether the received version is not older than the shown one. ISO timestamps of the same
 * format compare correctly as strings; an equal timestamp is accepted (same version or a change
 * within the same millisecond, which arrives in commit order).
 */
export function isNotOlder(shown: Timestamped, received: Timestamped): boolean {
  return received.updatedAt >= shown.updatedAt;
}

/** Adds the column or replaces an older version of it, then orders the list by rank. */
export function upsertColumnByRank(columns: readonly Column[], column: Column): Column[] {
  const existing = columns.find((entry) => entry.id === column.id);
  if (existing && !isNotOlder(existing, column)) {
    return [...columns];
  }
  const others = columns.filter((entry) => entry.id !== column.id);
  return sortByRank([...others, column]);
}

/**
 * Applies a rename or settings change of a known column. The rank stays local: such changes never
 * move a column, and the local rank may be newer (e.g. after a rebalance).
 */
export function updateColumnFields(columns: readonly Column[], column: Column): Column[] {
  return columns.map((entry) =>
    entry.id === column.id && isNotOlder(entry, column) ? { ...column, rank: entry.rank } : entry,
  );
}

/** Removes the column and its cards. */
export function removeColumn(
  columns: readonly Column[],
  cardsByColumn: CardsByColumn,
  columnId: string,
): { columns: Column[]; cardsByColumn: CardsByColumn } {
  return {
    columns: columns.filter((column) => column.id !== columnId),
    cardsByColumn: Object.fromEntries(
      Object.entries(cardsByColumn).filter(([id]) => id !== columnId),
    ),
  };
}

/** Sets new ranks (of a rebalance) on the known items and orders them by rank. */
export function applyRanks<T extends { id: string; rank: string }>(
  items: readonly T[],
  ranks: readonly RankAssignmentPayload[],
): T[] {
  const byId = new Map(ranks.map((entry) => [entry.id, entry.rank]));
  return sortByRank(items.map((item) => ({ ...item, rank: byId.get(item.id) ?? item.rank })));
}

/** Applies new ranks to the cards of one column. */
export function applyCardRanks(
  cardsByColumn: CardsByColumn,
  columnId: string,
  ranks: readonly RankAssignmentPayload[],
): CardsByColumn {
  if (!(columnId in cardsByColumn)) {
    return cardsByColumn;
  }
  return { ...cardsByColumn, [columnId]: applyRanks(cardsOf(cardsByColumn, columnId), ranks) };
}

/**
 * Shows the card at the place given by its column and rank (a created or moved card), unless an
 * equal or newer version is already shown at that place. An older version is replaced.
 */
export function placeCard(cardsByColumn: CardsByColumn, card: Card): CardsByColumn {
  const shown = findCard(cardsByColumn, card.id);
  if (shown && !isNotOlder(shown.card, card)) {
    return cardsByColumn;
  }
  if (!(card.columnId in cardsByColumn) && !shown) {
    // The column is not shown (yet); the next reload brings both.
    return cardsByColumn;
  }
  return insertCardByRank(removeCard(cardsByColumn, card.id), card);
}

/**
 * Applies field changes of a known card. The column and rank stay local (an edit never moves a
 * card); `keepLocal` lists fields with a local edit still in flight, which keep the local value.
 */
export function updateCardFields(
  cardsByColumn: CardsByColumn,
  card: Card,
  keepLocal: readonly (keyof Card)[] = [],
): CardsByColumn {
  const shown = findCard(cardsByColumn, card.id);
  if (!shown || !isNotOlder(shown.card, card)) {
    return cardsByColumn;
  }
  let merged: Card = { ...card, columnId: shown.card.columnId, rank: shown.card.rank };
  for (const field of keepLocal) {
    merged = { ...merged, [field]: shown.card[field] };
  }
  const cards = [...cardsOf(cardsByColumn, shown.columnId)];
  cards[shown.index] = merged;
  return { ...cardsByColumn, [shown.columnId]: cards };
}

/** Recomputes the keys of all cards after the board key changed (numbers stay the same). */
export function withBoardKey(cardsByColumn: CardsByColumn, boardKey: string): CardsByColumn {
  const result: Record<string, readonly Card[]> = {};
  for (const [columnId, cards] of Object.entries(cardsByColumn)) {
    result[columnId] = cards.map((card) => ({
      ...card,
      key: formatCardKey(boardKey, card.number),
    }));
  }
  return result;
}

/** Adds the member or replaces them (a repeated or late `member:added`). */
export function upsertMember(members: readonly BoardMember[], member: BoardMember): BoardMember[] {
  return members.some((entry) => entry.userId === member.userId)
    ? members.map((entry) => (entry.userId === member.userId ? member : entry))
    : [...members, member];
}
