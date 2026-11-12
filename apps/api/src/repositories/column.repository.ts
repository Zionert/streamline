import type { ColumnCategory, Column as ColumnRecord } from '../generated/prisma/client.js';
import {
  createBoardTransactionRunner,
  DEFAULT_BOARD_TRANSACTION_OPTIONS,
  lockBoardRow,
  nullIfMissing,
  type BoardLockMode,
  type BoardTransactionOptions,
  type QueryClient,
  type RankAssignment,
} from './board-transaction.js';
import type { DbClient } from './db.js';

export type { ColumnRecord };
export {
  BoardBusyError,
  RankCollisionError,
  type BoardLockMode,
  type RankAssignment,
} from './board-transaction.js';

/** The unique constraint that detects rank collisions (defined in the migration SQL). */
const RANK_UNIQUE_CONSTRAINT = { name: 'Column_boardId_rank_key', fields: ['boardId', 'rank'] };

/** Time limits of column transactions, in milliseconds. */
export type ColumnTransactionOptions = BoardTransactionOptions;

export const DEFAULT_COLUMN_TRANSACTION_OPTIONS: Readonly<ColumnTransactionOptions> =
  DEFAULT_BOARD_TRANSACTION_OPTIONS;

export interface NewColumnData {
  boardId: string;
  title: string;
  rank: string;
  category: ColumnCategory;
}

export interface ColumnSettingsData {
  category?: ColumnCategory;
  wipLimit?: number | null;
  wipStrict?: boolean;
}

/** Column queries; inside `ColumnRepository.transaction` they all run in that transaction. */
export interface ColumnStore {
  /** Locks the board row until the end of the transaction; `false` if the board does not exist. */
  lockBoard(boardId: string, mode: BoardLockMode): Promise<boolean>;
  /** Columns of the board in rank order. */
  listForBoard(boardId: string): Promise<ColumnRecord[]>;
  findInBoard(boardId: string, columnId: string): Promise<ColumnRecord | null>;
  countByCategory(boardId: string, category: ColumnCategory): Promise<number>;
  /** Number of cards in the column. */
  countCards(boardId: string, columnId: string): Promise<number>;
  create(data: NewColumnData): Promise<ColumnRecord>;
  /** Each method below returns `null` / `false` when the column is not in the board. */
  rename(boardId: string, columnId: string, title: string): Promise<ColumnRecord | null>;
  updateRank(boardId: string, columnId: string, rank: string): Promise<ColumnRecord | null>;
  updateSettings(
    boardId: string,
    columnId: string,
    data: ColumnSettingsData,
  ): Promise<ColumnRecord | null>;
  delete(boardId: string, columnId: string): Promise<boolean>;
  /**
   * Rewrites the ranks of many columns of the board in one statement. The unique constraint is
   * checked at the end of the statement, so new ranks may reuse ranks of other updated rows.
   * `updatedAt` is left unchanged: a rebalance does not change the order.
   */
  setRanks(boardId: string, assignments: readonly RankAssignment[]): Promise<void>;
}

export interface ColumnRepository extends ColumnStore {
  /**
   * Runs `fn` in a transaction (READ COMMITTED). Errors roll the transaction back; a unique
   * violation of `(boardId, rank)` surfaces as {@link RankCollisionError}, and a lock wait or
   * transaction exceeding {@link ColumnTransactionOptions} as {@link BoardBusyError}.
   */
  transaction<T>(fn: (store: ColumnStore) => Promise<T>): Promise<T>;
}

function createColumnStore(db: QueryClient): ColumnStore {
  return {
    lockBoard(boardId, mode) {
      return lockBoardRow(db, boardId, mode);
    },

    listForBoard(boardId) {
      // "rank" has COLLATE "C", so the database order equals JavaScript string order.
      return db.column.findMany({ where: { boardId }, orderBy: { rank: 'asc' } });
    },

    findInBoard(boardId, columnId) {
      return db.column.findFirst({ where: { id: columnId, boardId } });
    },

    countByCategory(boardId, category) {
      return db.column.count({ where: { boardId, category } });
    },

    countCards(boardId, columnId) {
      return db.card.count({ where: { boardId, columnId } });
    },

    create(data) {
      return db.column.create({ data });
    },

    rename(boardId, columnId, title) {
      return nullIfMissing(db.column.update({ where: { id: columnId, boardId }, data: { title } }));
    },

    updateRank(boardId, columnId, rank) {
      return nullIfMissing(db.column.update({ where: { id: columnId, boardId }, data: { rank } }));
    },

    updateSettings(boardId, columnId, data) {
      return nullIfMissing(db.column.update({ where: { id: columnId, boardId }, data }));
    },

    async delete(boardId, columnId) {
      const { count } = await db.column.deleteMany({ where: { id: columnId, boardId } });
      return count > 0;
    },

    async setRanks(boardId, assignments) {
      if (assignments.length === 0) return;
      const ids = assignments.map((entry) => entry.id);
      const ranks = assignments.map((entry) => entry.rank);
      await db.$executeRaw`
        UPDATE "Column" AS c
        SET "rank" = v."rank"
        FROM unnest(${ids}::text[], ${ranks}::text[]) AS v("id", "rank")
        WHERE c."id" = v."id" AND c."boardId" = ${boardId}`;
    },
  };
}

export function createColumnRepository(
  db: DbClient,
  options: Partial<ColumnTransactionOptions> = {},
): ColumnRepository {
  const run = createBoardTransactionRunner(db, RANK_UNIQUE_CONSTRAINT, options);
  return {
    ...createColumnStore(db),
    transaction: (fn) => run((tx) => fn(createColumnStore(tx))),
  };
}
