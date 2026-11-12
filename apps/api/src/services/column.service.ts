import {
  COLUMN_ERROR_CODES,
  type Column,
  type CreateColumnInput,
  type MoveColumnInput,
  type RenameColumnInput,
  type UpdateColumnSettingsInput,
} from '@streamline/shared';

import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error.js';
import { noopBoardEvents, type BoardEvents, type ChangeOrigin } from '../realtime/board-events.js';
import type { RankAssignment } from '../repositories/board-transaction.js';
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
 *
 * Committed changes are broadcast through `BoardEvents`; a rebalance is announced first with
 * `columns:rebalanced` (the new ranks of the other columns), then the change itself.
 */
export interface ColumnService {
  /** Columns of the board in rank order. */
  list(membership: BoardMembership): Promise<Column[]>;
  create(
    membership: BoardMembership,
    input: CreateColumnInput,
    origin?: ChangeOrigin,
  ): Promise<Column>;
  rename(
    membership: BoardMembership,
    columnId: string,
    input: RenameColumnInput,
    origin?: ChangeOrigin,
  ): Promise<Column>;
  move(
    membership: BoardMembership,
    columnId: string,
    input: MoveColumnInput,
    origin?: ChangeOrigin,
  ): Promise<Column>;
  updateSettings(
    membership: BoardMembership,
    columnId: string,
    input: UpdateColumnSettingsInput,
    origin?: ChangeOrigin,
  ): Promise<Column>;
  delete(membership: BoardMembership, columnId: string, origin?: ChangeOrigin): Promise<void>;
}

export interface ColumnServiceDependencies {
  columns: ColumnRepository;
  events?: BoardEvents;
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

export function createColumnService({
  columns,
  events = noopBoardEvents,
}: ColumnServiceDependencies): ColumnService {
  /** Broadcasts the new ranks of a committed rebalance (if any), then the column change. */
  function publishColumn(
    name: 'column:created' | 'column:updated' | 'column:moved',
    membership: BoardMembership,
    column: Column,
    origin: ChangeOrigin | undefined,
    rebalanced: readonly RankAssignment[] | null = null,
  ): void {
    const { boardId, userId: actorId } = membership;
    if (rebalanced) {
      events.publish('columns:rebalanced', { boardId, actorId, ranks: [...rebalanced] }, origin);
    }
    events.publish(name, { boardId, actorId, column }, origin);
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

    async create(membership, { title, afterId, beforeId }, origin) {
      assertBoardPermission(membership, 'column:write');
      const { boardId } = membership;
      // Ranks given to the other columns by a rebalance in the attempt that succeeded.
      let rebalanced: RankAssignment[] | null = null;

      const created = await withRankRetry(
        columns,
        boardId,
        async ({ store, lock, positionMode }) => {
          rebalanced = null;
          const others = await store.listForBoard(boardId);
          const index = resolveInsertIndex(others, { afterId, beforeId }, positionMode);
          const rank = rankAt(others, index);
          if (rank !== null) {
            return store.create({ boardId, title, rank, category: 'TODO' });
          }
          if (lock === 'shared') throw new RebalanceRequiredError();

          // Rebalance as if the new column were already at `index`, then insert it with its key.
          const result = rebalanceAroundNewItem(others, index);
          await store.setRanks(boardId, result.assignments);
          rebalanced = result.assignments;
          return store.create({ boardId, title, rank: result.rank, category: 'TODO' });
        },
      );
      const column = toColumn(created);
      publishColumn('column:created', membership, column, origin, rebalanced);
      return column;
    },

    async rename(membership, columnId, { title }, origin) {
      assertBoardPermission(membership, 'column:write');
      const renamed = await columns.rename(membership.boardId, columnId, title);
      if (!renamed) throw columnNotFound();
      const column = toColumn(renamed);
      publishColumn('column:updated', membership, column, origin);
      return column;
    },

    async move(membership, columnId, { afterId, beforeId }, origin) {
      assertBoardPermission(membership, 'column:write');
      const { boardId } = membership;
      if (afterId === columnId || beforeId === columnId) {
        throw new ValidationError('A column cannot be its own neighbor');
      }
      let rebalanced: RankAssignment[] | null = null;

      const moved = await withRankRetry(columns, boardId, async ({ store, lock, positionMode }) => {
        rebalanced = null;
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
        const assignments = rebalancedAssignments(ordered);
        await store.setRanks(boardId, assignments);
        rebalanced = assignments;
        const updated = await store.findInBoard(boardId, columnId);
        if (!updated) throw columnNotFound();
        return updated;
      });
      const column = toColumn(moved);
      publishColumn('column:moved', membership, column, origin, rebalanced);
      return column;
    },

    async updateSettings(membership, columnId, { category, wipLimit, wipStrict }, origin) {
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
      const column = toColumn(updated);
      publishColumn('column:updated', membership, column, origin);
      return column;
    },

    async delete(membership, columnId, origin) {
      assertBoardPermission(membership, 'column:write');
      const { boardId, userId } = membership;

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
      events.publish('column:deleted', { boardId, actorId: userId, columnId }, origin);
    },
  };
}
