import type { Label as LabelRecord, LabelColor } from '../generated/prisma/client.js';
import {
  createBoardTransactionRunner,
  lockBoardRow,
  nullIfMissing,
  type BoardLockMode,
  type BoardTransactionOptions,
  type QueryClient,
} from './board-transaction.js';
import type { DbClient } from './db.js';
import { isPrismaError, PRISMA_ERROR } from './prisma-errors.js';

export type { LabelRecord };

export interface NewLabelData {
  boardId: string;
  name: string;
  color: LabelColor;
}

export interface LabelChanges {
  name?: string | undefined;
  color?: LabelColor | undefined;
}

/** Label queries; inside `LabelRepository.transaction` they all run in that transaction. */
export interface LabelStore {
  /** Locks the board row until the end of the transaction; `false` if the board does not exist. */
  lockBoard(boardId: string, mode: BoardLockMode): Promise<boolean>;
  countForBoard(boardId: string): Promise<number>;
  create(data: NewLabelData): Promise<LabelRecord>;
  /** Locks the label row until the end of the transaction; `null` when it is not in the board. */
  lockLabel(boardId: string, labelId: string): Promise<LabelRecord | null>;
  /** `null` when the label is not in the board. */
  update(boardId: string, labelId: string, data: LabelChanges): Promise<LabelRecord | null>;
  /** Deletes the label and its card assignments; `false` when it is not in the board. */
  delete(boardId: string, labelId: string): Promise<boolean>;
}

export interface LabelRepository {
  /**
   * Runs `fn` in a transaction (READ COMMITTED). A lock wait or transaction exceeding the time
   * limits surfaces as `BoardBusyError`, and a duplicate name (case-insensitive, the unique index
   * `Label_boardId_lower_name_key`) as {@link LabelNameTakenError}.
   */
  transaction<T>(fn: (store: LabelStore) => Promise<T>): Promise<T>;
  /** The board's labels in creation order. */
  listForBoard(boardId: string): Promise<LabelRecord[]>;
}

/** Another label of the board already has the name (compared case-insensitively). */
export class LabelNameTakenError extends Error {
  constructor(options?: ErrorOptions) {
    super('Label name already taken', options);
    this.name = 'LabelNameTakenError';
  }
}

function createLabelStore(db: QueryClient): LabelStore {
  return {
    lockBoard(boardId, mode) {
      return lockBoardRow(db, boardId, mode);
    },

    countForBoard(boardId) {
      return db.label.count({ where: { boardId } });
    },

    create(data) {
      return db.label.create({ data });
    },

    async lockLabel(boardId, labelId) {
      const [row] = await db.$queryRaw<LabelRecord[]>`
        SELECT "id", "boardId", "name", "color", "createdAt", "updatedAt" FROM "Label"
        WHERE "id" = ${labelId} AND "boardId" = ${boardId}
        FOR NO KEY UPDATE`;
      return row ?? null;
    },

    update(boardId, labelId, data) {
      return nullIfMissing(db.label.update({ where: { id: labelId, boardId }, data }));
    },

    async delete(boardId, labelId) {
      const { count } = await db.label.deleteMany({ where: { id: labelId, boardId } });
      return count > 0;
    },
  };
}

export function createLabelRepository(
  db: DbClient,
  options: Partial<BoardTransactionOptions> = {},
): LabelRepository {
  const run = createBoardTransactionRunner(db, null, options);
  return {
    async transaction(fn) {
      try {
        return await run((tx) => fn(createLabelStore(tx)));
      } catch (err) {
        // The id is generated, so the only unique violation a label write can cause is its name.
        if (isPrismaError(err, PRISMA_ERROR.UNIQUE_CONSTRAINT_VIOLATION)) {
          throw new LabelNameTakenError({ cause: err });
        }
        throw err;
      }
    },

    listForBoard(boardId) {
      return db.label.findMany({
        where: { boardId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    },
  };
}
