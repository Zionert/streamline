import type { ColumnCategory, Column as ColumnRecord, Prisma } from '../generated/prisma/client.js';
import type { DbClient } from './db.js';
import {
  isPrismaError,
  isUniqueViolationOf,
  PG_ERROR,
  postgresErrorCode,
  PRISMA_ERROR,
} from './prisma-errors.js';

export type { ColumnRecord };

/**
 * How a column-changing transaction locks its board row:
 * - `shared` (`FOR SHARE`) — inserts and moves; they may run concurrently with each other and
 *   rely on the unique `(boardId, rank)` constraint to detect rank collisions,
 * - `exclusive` (`FOR NO KEY UPDATE`) — rebalancing, deletes and settings changes; excludes every
 *   other column-changing transaction of the board, so whole-board reads stay valid until commit.
 */
export type BoardLockMode = 'shared' | 'exclusive';

/**
 * Two transactions computed the same rank for one board (`rankBetween` is deterministic) and
 * the unique `(boardId, rank)` constraint rejected the later one. The caller may retry with
 * freshly read neighbours.
 */
export class RankCollisionError extends Error {
  constructor() {
    super('Rank already taken in this board');
    this.name = 'RankCollisionError';
  }
}

/**
 * A column transaction could not get its locks or a connection in time (see
 * {@link ColumnTransactionOptions}), typically because many requests queue on one board.
 * Nothing was written; the request may be retried later.
 */
export class BoardBusyError extends Error {
  constructor(options?: ErrorOptions) {
    super('The board is busy', options);
    this.name = 'BoardBusyError';
  }
}

/** The unique constraint that detects rank collisions (defined in the migration SQL). */
const RANK_UNIQUE_CONSTRAINT = { name: 'Column_boardId_rank_key', fields: ['boardId', 'rank'] };

/** Time limits of column transactions, in milliseconds. */
export interface ColumnTransactionOptions {
  /** Maximum wait for each lock (PostgreSQL `lock_timeout`, set per transaction). */
  lockTimeoutMs: number;
  /** Maximum wait for Prisma to start the transaction (connection from the pool). */
  maxWaitMs: number;
  /** Maximum duration of the whole transaction; must be longer than `lockTimeoutMs`. */
  timeoutMs: number;
}

export const DEFAULT_COLUMN_TRANSACTION_OPTIONS: Readonly<ColumnTransactionOptions> = {
  lockTimeoutMs: 2000,
  maxWaitMs: 2000,
  timeoutMs: 5000,
};

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

export interface RankAssignment {
  id: string;
  rank: string;
}

/** Column queries; inside `ColumnRepository.transaction` they all run in that transaction. */
export interface ColumnStore {
  /** Locks the board row until the end of the transaction; `false` if the board does not exist. */
  lockBoard(boardId: string, mode: BoardLockMode): Promise<boolean>;
  /** Columns of the board in rank order. */
  listForBoard(boardId: string): Promise<ColumnRecord[]>;
  findInBoard(boardId: string, columnId: string): Promise<ColumnRecord | null>;
  countByCategory(boardId: string, category: ColumnCategory): Promise<number>;
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

type QueryClient = DbClient | Prisma.TransactionClient;

async function nullIfMissing<T>(query: Promise<T>): Promise<T | null> {
  try {
    return await query;
  } catch (err) {
    if (isPrismaError(err, PRISMA_ERROR.RECORD_NOT_FOUND)) {
      return null;
    }
    throw err;
  }
}

function createColumnStore(db: QueryClient): ColumnStore {
  return {
    async lockBoard(boardId, mode) {
      const rows =
        mode === 'shared'
          ? await db.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "Board" WHERE "id" = ${boardId} FOR SHARE`
          : await db.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "Board" WHERE "id" = ${boardId} FOR NO KEY UPDATE`;
      return rows.length > 0;
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
  const { lockTimeoutMs, maxWaitMs, timeoutMs } = {
    ...DEFAULT_COLUMN_TRANSACTION_OPTIONS,
    ...options,
  };
  const lockTimeout = `${String(lockTimeoutMs)}ms`;

  return {
    ...createColumnStore(db),

    async transaction(fn) {
      try {
        return await db.$transaction(
          async (tx) => {
            // `is_local = true` limits the setting to this transaction (like SET LOCAL).
            await tx.$queryRaw`SELECT set_config('lock_timeout', ${lockTimeout}, true)`;
            return fn(createColumnStore(tx));
          },
          { maxWait: maxWaitMs, timeout: timeoutMs },
        );
      } catch (err) {
        if (isUniqueViolationOf(err, RANK_UNIQUE_CONSTRAINT)) {
          throw new RankCollisionError();
        }
        if (
          postgresErrorCode(err) === PG_ERROR.LOCK_NOT_AVAILABLE ||
          isPrismaError(err, PRISMA_ERROR.TRANSACTION_API_ERROR)
        ) {
          throw new BoardBusyError({ cause: err });
        }
        throw err;
      }
    },
  };
}
