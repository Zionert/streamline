import type { Prisma } from '../generated/prisma/client.js';
import type { DbClient } from './db.js';
import {
  isPrismaError,
  isUniqueViolationOf,
  PG_ERROR,
  postgresErrorCode,
  PRISMA_ERROR,
} from './prisma-errors.js';

/**
 * Building blocks shared by the repositories whose writes are serialized on the board row
 * (columns and cards).
 */

export type QueryClient = DbClient | Prisma.TransactionClient;

/**
 * How a transaction locks its board row:
 * - `shared` (`FOR SHARE`) — writes that may run concurrently with each other (column inserts and
 *   moves, card moves); rank collisions are detected by unique `(container, rank)` constraints,
 * - `exclusive` (`FOR NO KEY UPDATE`) — rebalancing, column deletes and settings changes, card
 *   creation (it increments the board's card counter); excludes every other locking transaction
 *   of the board, so whole-board reads stay valid until commit.
 */
export type BoardLockMode = 'shared' | 'exclusive';

/**
 * Two transactions computed the same rank in one container (`rankBetween` is deterministic) and
 * a unique `(container, rank)` constraint rejected the later one. The caller may retry with
 * freshly read neighbours.
 */
export class RankCollisionError extends Error {
  constructor() {
    super('Rank already taken');
    this.name = 'RankCollisionError';
  }
}

/**
 * A board transaction could not get its locks or a connection in time (see
 * {@link BoardTransactionOptions}), typically because many requests queue on one board.
 * Nothing was written; the request may be retried later.
 */
export class BoardBusyError extends Error {
  constructor(options?: ErrorOptions) {
    super('The board is busy', options);
    this.name = 'BoardBusyError';
  }
}

/** Time limits of board transactions, in milliseconds. */
export interface BoardTransactionOptions {
  /** Maximum wait for each lock (PostgreSQL `lock_timeout`, set per transaction). */
  lockTimeoutMs: number;
  /** Maximum wait for Prisma to start the transaction (connection from the pool). */
  maxWaitMs: number;
  /** Maximum duration of the whole transaction; must be longer than `lockTimeoutMs`. */
  timeoutMs: number;
}

export const DEFAULT_BOARD_TRANSACTION_OPTIONS: Readonly<BoardTransactionOptions> = {
  lockTimeoutMs: 2000,
  maxWaitMs: 2000,
  timeoutMs: 5000,
};

/** New rank of one row, for a rebalance. */
export interface RankAssignment {
  id: string;
  rank: string;
}

/** A unique constraint as reported by Prisma (see `isUniqueViolationOf`). */
export interface UniqueConstraint {
  name: string;
  fields: readonly string[];
}

/** Locks the board row until the end of the transaction; `false` if the board does not exist. */
export async function lockBoardRow(
  db: QueryClient,
  boardId: string,
  mode: BoardLockMode,
): Promise<boolean> {
  const rows =
    mode === 'shared'
      ? await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Board" WHERE "id" = ${boardId} FOR SHARE`
      : await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Board" WHERE "id" = ${boardId} FOR NO KEY UPDATE`;
  return rows.length > 0;
}

/** Runs `query`, mapping Prisma's "record not found" to `null`. */
export async function nullIfMissing<T>(query: Promise<T>): Promise<T | null> {
  try {
    return await query;
  } catch (err) {
    if (isPrismaError(err, PRISMA_ERROR.RECORD_NOT_FOUND)) {
      return null;
    }
    throw err;
  }
}

export interface RunOptions {
  /** `RepeatableRead` gives all reads of the transaction one snapshot (default READ COMMITTED). */
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

export type BoardTransactionRunner = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  runOptions?: RunOptions,
) => Promise<T>;

/**
 * Creates a function running callbacks in a transaction (READ COMMITTED unless requested
 * otherwise) with the given time limits. Errors roll the transaction back; a unique violation of
 * `rankConstraint` (if given) surfaces as {@link RankCollisionError}, and a lock wait or
 * transaction exceeding the limits as {@link BoardBusyError}.
 */
export function createBoardTransactionRunner(
  db: DbClient,
  rankConstraint: UniqueConstraint | null,
  options: Partial<BoardTransactionOptions> = {},
): BoardTransactionRunner {
  const { lockTimeoutMs, maxWaitMs, timeoutMs } = {
    ...DEFAULT_BOARD_TRANSACTION_OPTIONS,
    ...options,
  };
  const lockTimeout = `${String(lockTimeoutMs)}ms`;

  return async (fn, runOptions = {}) => {
    try {
      return await db.$transaction(
        async (tx) => {
          // `is_local = true` limits the setting to this transaction (like SET LOCAL).
          await tx.$queryRaw`SELECT set_config('lock_timeout', ${lockTimeout}, true)`;
          return fn(tx);
        },
        {
          maxWait: maxWaitMs,
          timeout: timeoutMs,
          ...(runOptions.isolationLevel && { isolationLevel: runOptions.isolationLevel }),
        },
      );
    } catch (err) {
      if (rankConstraint && isUniqueViolationOf(err, rankConstraint)) {
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
  };
}
