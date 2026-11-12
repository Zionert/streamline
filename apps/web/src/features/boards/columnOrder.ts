interface Ranked {
  rank: string;
}

interface Identified {
  id: string;
}

/** Body of the move request (a valid `MoveColumnInput` with both neighbours present). */
export interface MoveNeighbors {
  afterId: string | null;
  beforeId: string | null;
}

/**
 * Orders rank keys by plain code unit comparison, which matches the database (`COLLATE "C"`).
 * `localeCompare` must never be used: it orders e.g. `a` before `B`, unlike the server.
 */
export function compareRanks(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** A sorted copy of the items, by rank. */
export function sortByRank<T extends Ranked>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareRanks(a.rank, b.rank));
}

/** A copy of the list with the item at `from` moved to index `to` (as reported by drag & drop). */
export function reorderList<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items];
  const [moved] = result.splice(from, 1);
  if (moved === undefined) {
    return result;
  }
  result.splice(to, 0, moved);
  return result;
}

/**
 * Neighbours of the item at `index` in the list as it looks AFTER the move: `afterId` is the item
 * directly preceding it (`null` = it is first), `beforeId` the one directly following it
 * (`null` = it is last). Both are always sent, so the server can detect a stale view.
 */
export function getMoveNeighbors(
  orderedAfterMove: readonly Identified[],
  index: number,
): MoveNeighbors {
  return {
    afterId: orderedAfterMove[index - 1]?.id ?? null,
    beforeId: orderedAfterMove[index + 1]?.id ?? null,
  };
}

/**
 * Undoes a local move of one item without discarding other changes made to the list meanwhile:
 * the item (as it is in `current`) is put back after its original predecessor, or before its
 * original successor if the predecessor is gone, or at its original index as a last resort.
 */
export function restoreOriginalPosition<T extends Identified>(
  current: readonly T[],
  itemId: string,
  original: readonly Identified[],
): T[] {
  const item = current.find((entry) => entry.id === itemId);
  if (!item) {
    return [...current];
  }
  const rest = current.filter((entry) => entry.id !== itemId);
  const originalIndex = original.findIndex((entry) => entry.id === itemId);
  const predecessorId = original[originalIndex - 1]?.id;
  const successorId = original[originalIndex + 1]?.id;
  const predecessorIndex = rest.findIndex((entry) => entry.id === predecessorId);
  const successorIndex = rest.findIndex((entry) => entry.id === successorId);
  let index: number;
  if (originalIndex === 0) {
    index = 0;
  } else if (predecessorIndex >= 0) {
    index = predecessorIndex + 1;
  } else if (successorIndex >= 0) {
    index = successorIndex;
  } else {
    index = Math.min(Math.max(originalIndex, 0), rest.length);
  }
  rest.splice(index, 0, item);
  return rest;
}

/** Whether `rank` lies strictly between the neighbouring ranks (`undefined` = open end). */
export function rankFitsBetween(
  previous: string | undefined,
  rank: string,
  next: string | undefined,
): boolean {
  return (previous === undefined || previous < rank) && (next === undefined || rank < next);
}

/** Whether the item at `index` is correctly ordered relative to its neighbours in the list. */
export function rankFitsAt(items: readonly Ranked[], index: number): boolean {
  const item = items[index];
  if (!item) {
    return false;
  }
  return rankFitsBetween(items[index - 1]?.rank, item.rank, items[index + 1]?.rank);
}
