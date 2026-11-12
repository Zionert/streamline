import {
  COLUMN_ERROR_CODES,
  type Column,
  type CreateColumnInput,
  type MoveColumnInput,
  type RenameColumnInput,
  type UpdateColumnSettingsInput,
} from '@streamline/shared';

import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error.js';
import type {
  ColumnRecord,
  ColumnRepository,
  ColumnStore,
} from '../repositories/column.repository.js';
import { assertBoardPermission, type BoardMembership } from './board-access.service.js';
import {
  inLockedBoard,
  isAtIndex,
  rankAt,
  rebalanceAroundNewItem,
  rebalancedAssignments,
  RebalanceRequiredError,
  resolveInsertIndex,
  withRankRetry,
  type Position,
} from './ranked-write.js';

export { MAX_RANK_ATTEMPTS, resolveInsertIndex, type PositionMode } from './ranked-write.js';

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
 *   "at least one DONE column" invariant and the "only empty columns can be deleted" rule safe
 *   against concurrent requests (card writes hold at least the shared lock),
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

export const COLUMN_NOT_FOUND_MESSAGE = 'Column not found';

export type ColumnPosition = Position;

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

      const created = await withRankRetry(
        columns,
        boardId,
        async ({ store, lock, positionMode }) => {
          const others = await store.listForBoard(boardId);
          const index = resolveInsertIndex(others, { afterId, beforeId }, positionMode);
          const rank = rankAt(others, index);
          if (rank !== null) {
            return store.create({ boardId, title, rank, category: 'TODO' });
          }
          if (lock === 'shared') throw new RebalanceRequiredError();

          // Rebalance as if the new column were already at `index`, then insert it with its key.
          const rebalanced = rebalanceAroundNewItem(others, index);
          await store.setRanks(boardId, rebalanced.assignments);
          return store.create({ boardId, title, rank: rebalanced.rank, category: 'TODO' });
        },
      );
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

      const moved = await withRankRetry(columns, boardId, async ({ store, lock, positionMode }) => {
        const list = await store.listForBoard(boardId);
        const column = list.find((entry) => entry.id === columnId);
        if (!column) throw columnNotFound();

        const others = list.filter((entry) => entry.id !== columnId);
        const index = resolveInsertIndex(others, { afterId, beforeId }, positionMode);
        if (isAtIndex(others, index, column.rank)) {
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

      const updated = await inLockedBoard(columns, boardId, 'exclusive', async (store) => {
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

      await inLockedBoard(columns, boardId, 'exclusive', async (store) => {
        const column = await store.findInBoard(boardId, columnId);
        if (!column) throw columnNotFound();
        if ((await store.countCards(boardId, columnId)) > 0) {
          throw new ConflictError(
            'The column still has cards; move or delete them first',
            COLUMN_ERROR_CODES.COLUMN_NOT_EMPTY,
          );
        }
        if (column.category === 'DONE') {
          await assertNotLastDone(store, boardId);
        }
        if (!(await store.delete(boardId, columnId))) throw columnNotFound();
      });
    },
  };
}
