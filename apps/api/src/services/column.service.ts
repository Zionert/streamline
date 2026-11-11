import {
  COLUMN_ERROR_CODES,
  needsRebalance,
  rankBetween,
  rebalanceRanks,
  type Column,
  type CreateColumnInput,
  type MoveColumnInput,
  type RenameColumnInput,
  type UpdateColumnSettingsInput,
} from '@streamline/shared';

import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../errors/app-error.js';
import {
  BoardBusyError,
  RankCollisionError,
  type BoardLockMode,
  type ColumnRecord,
  type ColumnRepository,
  type ColumnStore,
  type RankAssignment,
} from '../repositories/column.repository.js';
import {
  assertBoardPermission,
  BOARD_NOT_FOUND_MESSAGE,
  type BoardMembership,
} from './board-access.service.js';

/**
 * Column use cases (methods take the caller's membership verified by `BoardAccessService` and
 * re-check the role themselves).
 *
 * Ranks are always computed here from the persisted neighbours:
 * - inserts and moves take a shared lock on the board row and rely on the unique
 *   `(boardId, rank)` constraint; on a collision the attempt is retried with fresh data,
 *   up to {@link MAX_RANK_ATTEMPTS} times, then 409 `RANK_CONFLICT`,
 * - when the new rank would exceed `RANK_MAX_LENGTH`, the attempt is restarted with an
 *   exclusive board lock and the ranks of the whole board are rebalanced in that transaction,
 * - deletes and settings changes take the exclusive lock, which makes the
 *   "at least one DONE column" invariant safe against concurrent requests,
 * - a transaction that cannot get its locks in time fails with 503 `BOARD_BUSY` (not retried).
 */
export interface ColumnService {
  /** Columns of the board in rank order. */
  list(membership: BoardMembership): Promise<Column[]>;
  create(membership: BoardMembership, input: CreateColumnInput): Promise<Column>;
  rename(membership: BoardMembership, columnId: string, input: RenameColumnInput): Promise<Column>;
  move(membership: BoardMembership, columnId: string, input: MoveColumnInput): Promise<Column>;
  updateSettings(
    membership: BoardMembership,
    columnId: string,
    input: UpdateColumnSettingsInput,
  ): Promise<Column>;
  delete(membership: BoardMembership, columnId: string): Promise<void>;
}

export interface ColumnServiceDependencies {
  columns: ColumnRepository;
}

/** Attempts per insert/move before giving up with `RANK_CONFLICT`. */
export const MAX_RANK_ATTEMPTS = 5;

export const COLUMN_NOT_FOUND_MESSAGE = 'Column not found';

/**
 * How strictly `afterId` + `beforeId` given together are checked:
 * - `strict` — they must be adjacent (otherwise the client's view is stale),
 * - `lenient` — used after a rank collision, i.e. when another request has just inserted a
 *   column into the same gap: `afterId` only has to precede `beforeId`, and the column is
 *   placed directly after `afterId`, which still satisfies "between the two".
 */
export type PositionMode = 'strict' | 'lenient';

export interface ColumnPosition {
  afterId?: string | null | undefined;
  beforeId?: string | null | undefined;
}

/**
 * Index at which a column is inserted into `others` (the board's columns in rank order,
 * without the positioned column). No neighbours means the end of the list.
 *
 * Throws `NotFoundError` (`NEIGHBOR_NOT_FOUND`) for ids that are not in `others` and
 * `ConflictError` (`INVALID_POSITION`) when the two neighbours do not describe one gap.
 */
export function resolveInsertIndex(
  others: readonly { id: string }[],
  { afterId, beforeId }: ColumnPosition,
  mode: PositionMode = 'strict',
): number {
  const indexOf = (id: string): number => {
    const index = others.findIndex((column) => column.id === id);
    if (index < 0) {
      throw new NotFoundError(
        'Neighbor column not found in this board',
        COLUMN_ERROR_CODES.NEIGHBOR_NOT_FOUND,
      );
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

/** Rank for a column inserted at `index` of `others`, or `null` if it needs a rebalance. */
function rankAt(others: readonly ColumnRecord[], index: number): string | null {
  const rank = rankBetween(others[index - 1]?.rank ?? null, others[index]?.rank ?? null);
  return needsRebalance([rank]) ? null : rank;
}

/** Fresh, evenly spread ranks for `ids` in the given order. */
function rebalancedAssignments(ids: readonly string[]): RankAssignment[] {
  const ranks = rebalanceRanks(ids.length);
  return ids.map((id, index) => {
    const rank = ranks[index];
    if (rank === undefined) {
      throw new Error('rebalanceRanks returned fewer keys than requested');
    }
    return { id, rank };
  });
}

/** Stand-in id for a column that does not exist yet when computing rebalanced ranks. */
const NEW_COLUMN_SLOT = '';

/** The attempt computed a rank that is too long; restart it with an exclusive board lock. */
class RebalanceRequiredError extends Error {
  constructor() {
    super('Ranks of the board need rebalancing');
    this.name = 'RebalanceRequiredError';
  }
}

interface RankAttempt {
  store: ColumnStore;
  lock: BoardLockMode;
  positionMode: PositionMode;
}

export function toColumn(column: ColumnRecord): Column {
  return {
    id: column.id,
    boardId: column.boardId,
    title: column.title,
    rank: column.rank,
    category: column.category,
    wipLimit: column.wipLimit,
    wipStrict: column.wipStrict,
    createdAt: column.createdAt.toISOString(),
    updatedAt: column.updatedAt.toISOString(),
  };
}

function columnNotFound(): NotFoundError {
  return new NotFoundError(COLUMN_NOT_FOUND_MESSAGE);
}

export function createColumnService({ columns }: ColumnServiceDependencies): ColumnService {
  /**
   * Runs `fn` in a transaction holding the board lock; `NotFoundError` if the board is gone,
   * `ServiceUnavailableError` (`BOARD_BUSY`) if the locks could not be acquired in time.
   */
  async function inLockedBoard<T>(
    boardId: string,
    lock: BoardLockMode,
    fn: (store: ColumnStore) => Promise<T>,
  ): Promise<T> {
    try {
      return await columns.transaction(async (store) => {
        if (!(await store.lockBoard(boardId, lock))) {
          throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
        }
        return fn(store);
      });
    } catch (err) {
      if (err instanceof BoardBusyError) {
        throw new ServiceUnavailableError(
          'The board is being changed by too many requests; please try again',
          COLUMN_ERROR_CODES.BOARD_BUSY,
        );
      }
      throw err;
    }
  }

  /** Runs a rank-assigning operation, each attempt in its own transaction (see `ColumnService`). */
  async function withRankRetry<T>(
    boardId: string,
    operation: (attempt: RankAttempt) => Promise<T>,
  ): Promise<T> {
    let lock: BoardLockMode = 'shared';
    let positionMode: PositionMode = 'strict';
    for (let attempt = 1; attempt <= MAX_RANK_ATTEMPTS; attempt++) {
      try {
        return await inLockedBoard(boardId, lock, (store) =>
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

  /** Throws `LAST_DONE_COLUMN` unless the board has another DONE column. */
  async function assertNotLastDone(store: ColumnStore, boardId: string): Promise<void> {
    if ((await store.countByCategory(boardId, 'DONE')) <= 1) {
      throw new ConflictError(
        'The board must keep at least one column with category DONE',
        COLUMN_ERROR_CODES.LAST_DONE_COLUMN,
      );
    }
  }

  return {
    async list(membership) {
      assertBoardPermission(membership, 'board:view');
      const list = await columns.listForBoard(membership.boardId);
      return list.map(toColumn);
    },

    async create(membership, { title, afterId, beforeId }) {
      assertBoardPermission(membership, 'column:write');
      const { boardId } = membership;

      const created = await withRankRetry(boardId, async ({ store, lock, positionMode }) => {
        const others = await store.listForBoard(boardId);
        const index = resolveInsertIndex(others, { afterId, beforeId }, positionMode);
        const rank = rankAt(others, index);
        if (rank !== null) {
          return store.create({ boardId, title, rank, category: 'TODO' });
        }
        if (lock === 'shared') throw new RebalanceRequiredError();

        // Rebalance as if the new column were already at `index`, then insert it with its key.
        const assignments = rebalancedAssignments([
          ...others.slice(0, index).map((column) => column.id),
          NEW_COLUMN_SLOT,
          ...others.slice(index).map((column) => column.id),
        ]);
        const [own] = assignments.splice(index, 1);
        if (!own) throw new Error('Missing rank for the new column');
        await store.setRanks(boardId, assignments);
        return store.create({ boardId, title, rank: own.rank, category: 'TODO' });
      });
      return toColumn(created);
    },

    async rename(membership, columnId, { title }) {
      assertBoardPermission(membership, 'column:write');
      const column = await columns.rename(membership.boardId, columnId, title);
      if (!column) throw columnNotFound();
      return toColumn(column);
    },

    async move(membership, columnId, { afterId, beforeId }) {
      assertBoardPermission(membership, 'column:write');
      const { boardId } = membership;
      if (afterId === columnId || beforeId === columnId) {
        throw new ValidationError('A column cannot be its own neighbor');
      }

      const moved = await withRankRetry(boardId, async ({ store, lock, positionMode }) => {
        const list = await store.listForBoard(boardId);
        const column = list.find((entry) => entry.id === columnId);
        if (!column) throw columnNotFound();

        const others = list.filter((entry) => entry.id !== columnId);
        const index = resolveInsertIndex(others, { afterId, beforeId }, positionMode);
        const prev = others[index - 1]?.rank ?? null;
        const next = others[index]?.rank ?? null;
        if ((prev === null || prev < column.rank) && (next === null || column.rank < next)) {
          return column; // Already at the requested position.
        }

        const rank = rankAt(others, index);
        if (rank !== null) {
          const updated = await store.updateRank(boardId, columnId, rank);
          if (!updated) throw columnNotFound();
          return updated;
        }
        if (lock === 'shared') throw new RebalanceRequiredError();

        const ordered = others.map((entry) => entry.id);
        ordered.splice(index, 0, columnId);
        await store.setRanks(boardId, rebalancedAssignments(ordered));
        const updated = await store.findInBoard(boardId, columnId);
        if (!updated) throw columnNotFound();
        return updated;
      });
      return toColumn(moved);
    },

    async updateSettings(membership, columnId, { category, wipLimit, wipStrict }) {
      assertBoardPermission(membership, 'column:settings');
      const { boardId } = membership;

      const updated = await inLockedBoard(boardId, 'exclusive', async (store) => {
        const column = await store.findInBoard(boardId, columnId);
        if (!column) throw columnNotFound();
        if (column.category === 'DONE' && category !== undefined && category !== 'DONE') {
          await assertNotLastDone(store, boardId);
        }
        const result = await store.updateSettings(boardId, columnId, {
          category,
          wipLimit,
          wipStrict,
        });
        if (!result) throw columnNotFound();
        return result;
      });
      return toColumn(updated);
    },

    async delete(membership, columnId) {
      assertBoardPermission(membership, 'column:write');
      const { boardId } = membership;

      await inLockedBoard(boardId, 'exclusive', async (store) => {
        const column = await store.findInBoard(boardId, columnId);
        if (!column) throw columnNotFound();
        if (column.category === 'DONE') {
          await assertNotLastDone(store, boardId);
        }
        if (!(await store.delete(boardId, columnId))) throw columnNotFound();
      });
    },
  };
}
