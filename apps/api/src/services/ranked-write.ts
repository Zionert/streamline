import {
  COLUMN_ERROR_CODES,
  needsRebalance,
  rankBetween,
  rebalanceRanks,
} from '@streamline/shared';

import { ConflictError, NotFoundError, ServiceUnavailableError } from '../errors/app-error.js';
import {
  BoardBusyError,
  RankCollisionError,
  type BoardLockMode,
  type RankAssignment,
} from '../repositories/board-transaction.js';
import { BOARD_NOT_FOUND_MESSAGE } from './board-access.service.js';

/**
 * Rank assignment shared by the column and card services. Ranks are always computed on the
 * server from the persisted neighbours:
 * - writes take a shared lock on the board row and rely on a unique `(container, rank)`
 *   constraint; on a collision the attempt is retried with fresh data, up to
 *   {@link MAX_RANK_ATTEMPTS} times, then 409 `RANK_CONFLICT`,
 * - when the new rank would exceed `RANK_MAX_LENGTH`, the attempt is restarted with an exclusive
 *   board lock (never upgrading a held lock) and the container is rebalanced in that transaction,
 * - a transaction that cannot get its locks in time fails with 503 `BOARD_BUSY` (not retried).
 */

/** Attempts per insert/move before giving up with `RANK_CONFLICT`. */
export const MAX_RANK_ATTEMPTS = 5;

/**
 * How strictly `afterId` + `beforeId` given together are checked:
 * - `strict` — they must be adjacent (otherwise the client's view is stale),
 * - `lenient` — used after a rank collision, i.e. when another request has just inserted an
 *   item into the same gap: `afterId` only has to precede `beforeId`, and the item is placed
 *   directly after `afterId`, which still satisfies "between the two".
 */
export type PositionMode = 'strict' | 'lenient';

export interface Position {
  afterId?: string | null | undefined;
  beforeId?: string | null | undefined;
}

/**
 * Index at which an item is inserted into `others` (the container's items in rank order,
 * without the positioned item). No neighbours means the end of the list.
 *
 * Throws `NotFoundError` (`NEIGHBOR_NOT_FOUND`, with `neighborNotFoundMessage`) for ids that are
 * not in `others` and `ConflictError` (`INVALID_POSITION`) when the two neighbours do not
 * describe one gap.
 */
export function resolveInsertIndex(
  others: readonly { id: string }[],
  { afterId, beforeId }: Position,
  mode: PositionMode = 'strict',
  neighborNotFoundMessage = 'Neighbor column not found in this board',
): number {
  const indexOf = (id: string): number => {
    const index = others.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new NotFoundError(neighborNotFoundMessage, COLUMN_ERROR_CODES.NEIGHBOR_NOT_FOUND);
    }
    return index;
  };

  // Insertion index implied by each neighbour on its own.
  const fromAfter = afterId === undefined ? undefined : afterId === null ? 0 : indexOf(afterId) + 1;
  const fromBefore =
    beforeId === undefined ? undefined : beforeId === null ? others.length : indexOf(beforeId);

  if (fromAfter === undefined) return fromBefore ?? others.length;
  if (fromBefore === undefined || fromAfter === fromBefore) return fromAfter;
  if (mode === 'lenient' && fromAfter < fromBefore) return fromAfter;
  throw new ConflictError(
    'afterId and beforeId are not adjacent; reload the board and try again',
    COLUMN_ERROR_CODES.INVALID_POSITION,
  );
}

/** Whether an item with `rank` already sits at `index` of `others` (so a move is a no-op). */
export function isAtIndex(
  others: readonly { rank: string }[],
  index: number,
  rank: string,
): boolean {
  const prev = others[index - 1]?.rank ?? null;
  const next = others[index]?.rank ?? null;
  return (prev === null || prev < rank) && (next === null || rank < next);
}

/** Rank for an item inserted at `index` of `others`, or `null` if it needs a rebalance. */
export function rankAt(others: readonly { rank: string }[], index: number): string | null {
  const rank = rankBetween(others[index - 1]?.rank ?? null, others[index]?.rank ?? null);
  return needsRebalance([rank]) ? null : rank;
}

/** Fresh, evenly spread ranks for `ids` in the given order. */
export function rebalancedAssignments(ids: readonly string[]): RankAssignment[] {
  const ranks = rebalanceRanks(ids.length);
  return ids.map((id, index) => {
    const rank = ranks[index];
    if (rank === undefined) {
      throw new Error('rebalanceRanks returned fewer keys than requested');
    }
    return { id, rank };
  });
}

/** Stand-in id for an item that does not exist yet when computing rebalanced ranks. */
const NEW_ITEM_SLOT = '';

/**
 * Rebalanced ranks for `others` as if a new item were already inserted at `index`: returns the
 * new item's rank and the assignments for the existing items.
 */
export function rebalanceAroundNewItem(
  others: readonly { id: string }[],
  index: number,
): { rank: string; assignments: RankAssignment[] } {
  const assignments = rebalancedAssignments([
    ...others.slice(0, index).map((item) => item.id),
    NEW_ITEM_SLOT,
    ...others.slice(index).map((item) => item.id),
  ]);
  const [own] = assignments.splice(index, 1);
  if (!own) throw new Error('Missing rank for the new item');
  return { rank: own.rank, assignments };
}

/** The attempt computed a rank that is too long; restart it with an exclusive board lock. */
export class RebalanceRequiredError extends Error {
  constructor() {
    super('Ranks need rebalancing');
    this.name = 'RebalanceRequiredError';
  }
}

/** A repository whose transactions can lock the board row. */
export interface BoardLockingRepository<S extends BoardLockingStore> {
  transaction<T>(fn: (store: S) => Promise<T>): Promise<T>;
}

export interface BoardLockingStore {
  lockBoard(boardId: string, mode: BoardLockMode): Promise<boolean>;
}

/**
 * Runs `fn` in a transaction holding the board lock; `NotFoundError` if the board is gone,
 * `ServiceUnavailableError` (`BOARD_BUSY`) if the locks could not be acquired in time.
 */
export async function inLockedBoard<S extends BoardLockingStore, T>(
  repository: BoardLockingRepository<S>,
  boardId: string,
  lock: BoardLockMode,
  fn: (store: S) => Promise<T>,
): Promise<T> {
  try {
    return await repository.transaction(async (store) => {
      if (!(await store.lockBoard(boardId, lock))) {
        throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
      return fn(store);
    });
  } catch (err) {
    throw busyToServiceUnavailable(err);
  }
}

/** Maps `BoardBusyError` to 503 `BOARD_BUSY`; returns other errors unchanged. */
export function busyToServiceUnavailable(err: unknown): unknown {
  if (err instanceof BoardBusyError) {
    return new ServiceUnavailableError(
      'The board is being changed by too many requests; please try again',
      COLUMN_ERROR_CODES.BOARD_BUSY,
    );
  }
  return err;
}

export interface RankAttempt<S> {
  store: S;
  lock: BoardLockMode;
  positionMode: PositionMode;
}

/**
 * Runs a rank-assigning operation, each attempt in its own transaction holding the board lock:
 * a rank collision retries in `lenient` position mode, `RebalanceRequiredError` retries with the
 * exclusive lock. `initialLock` is `exclusive` for operations that need it anyway.
 */
export async function withRankRetry<S extends BoardLockingStore, T>(
  repository: BoardLockingRepository<S>,
  boardId: string,
  operation: (attempt: RankAttempt<S>) => Promise<T>,
  initialLock: BoardLockMode = 'shared',
): Promise<T> {
  let lock = initialLock;
  let positionMode: PositionMode = 'strict';
  for (let attempt = 1; attempt <= MAX_RANK_ATTEMPTS; attempt++) {
    try {
      return await inLockedBoard(repository, boardId, lock, (store) =>
        operation({ store, lock, positionMode }),
      );
    } catch (err) {
      if (err instanceof RankCollisionError) {
        positionMode = 'lenient';
      } else if (err instanceof RebalanceRequiredError) {
        lock = 'exclusive';
      } else {
        throw err;
      }
    }
  }
  throw new ConflictError(
    'The board is being changed concurrently; please try again',
    COLUMN_ERROR_CODES.RANK_CONFLICT,
  );
}
