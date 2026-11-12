import type {
  Card as CardRecord,
  CardPriority,
  Column as ColumnRecord,
} from '../generated/prisma/client.js';
import {
  createBoardTransactionRunner,
  lockBoardRow,
  nullIfMissing,
  type BoardLockMode,
  type BoardTransactionOptions,
  type QueryClient,
  type RankAssignment,
} from './board-transaction.js';
import type { DbClient } from './db.js';

export type { CardRecord };

/** The unique constraint that detects rank collisions (defined in the migration SQL). */
const RANK_UNIQUE_CONSTRAINT = { name: 'Card_columnId_rank_key', fields: ['columnId', 'rank'] };

/** A card's position, as read while locking it. */
export interface LockedCard {
  id: string;
  columnId: string;
  rank: string;
}

/** Column fields the card rules depend on. */
export type CardColumn = Pick<ColumnRecord, 'id' | 'wipLimit' | 'wipStrict'>;

export interface NewCardData {
  boardId: string;
  columnId: string;
  number: number;
  title: string;
  description: string | null;
  rank: string;
  priority: CardPriority | undefined;
  assigneeId: string | null;
  dueDate: Date | null;
}

export interface CardChanges {
  title?: string | undefined;
  description?: string | null | undefined;
  priority?: CardPriority | undefined;
  assigneeId?: string | null | undefined;
  dueDate?: Date | null | undefined;
}

export interface BoardCards {
  boardKey: string;
  columnIds: string[];
  cards: CardRecord[];
}

export interface NewTransitionData {
  cardId: string;
  boardId: string;
  fromColumnId: string | null;
  toColumnId: string;
  movedById: string;
}

/** Card queries; inside `CardRepository.transaction` they all run in that transaction. */
export interface CardStore {
  /** Locks the board row until the end of the transaction; `false` if the board does not exist. */
  lockBoard(boardId: string, mode: BoardLockMode): Promise<boolean>;
  /** Locks the card row (`FOR NO KEY UPDATE`); `null` if the card is not in the board. */
  lockCard(boardId: string, cardId: string): Promise<LockedCard | null>;
  findColumn(boardId: string, columnId: string): Promise<CardColumn | null>;
  /**
   * Locks the column row (`FOR NO KEY UPDATE`), serializing the transactions that add cards to
   * the column; `false` if the column is not in the board.
   */
  lockColumn(boardId: string, columnId: string): Promise<boolean>;
  countInColumn(columnId: string): Promise<number>;
  /** Cards of the column in rank order. */
  listInColumn(columnId: string): Promise<CardRecord[]>;
  /**
   * Whether the user is a member of the board; the membership row is locked `FOR SHARE`, so it
   * cannot be removed (which unassigns the user) before this transaction ends.
   */
  lockMembership(boardId: string, userId: string): Promise<boolean>;
  /** Takes the next card number of the board (atomic increment of its counter). */
  allocateNumber(boardId: string): Promise<number>;
  create(data: NewCardData): Promise<CardRecord>;
  /** Each method below returns `null` when the card is not in the board. */
  findById(boardId: string, cardId: string): Promise<CardRecord | null>;
  updatePosition(
    boardId: string,
    cardId: string,
    columnId: string,
    rank: string,
  ): Promise<CardRecord | null>;
  update(boardId: string, cardId: string, data: CardChanges): Promise<CardRecord | null>;
  /**
   * Rewrites the ranks of many cards of the column in one statement (the unique constraint is
   * checked at its end). `updatedAt` is left unchanged: a rebalance does not change the order.
   */
  setRanks(columnId: string, assignments: readonly RankAssignment[]): Promise<void>;
  recordTransition(data: NewTransitionData): Promise<void>;
}

export interface CardRepository {
  /**
   * Runs `fn` in a transaction (READ COMMITTED). Errors roll the transaction back; a unique
   * violation of `(columnId, rank)` surfaces as `RankCollisionError`, and a lock wait or
   * transaction exceeding the time limits as `BoardBusyError`.
   */
  transaction<T>(fn: (store: CardStore) => Promise<T>): Promise<T>;
  /** The board's key; `null` if the board does not exist. */
  findBoardKey(boardId: string): Promise<string | null>;
  /**
   * The board key, its column ids in rank order and its cards ordered by rank within each
   * column, read in one REPEATABLE READ transaction (a single snapshot, so a card can never
   * reference a column missing from the list); `null` if the board does not exist.
   */
  listBoard(boardId: string): Promise<BoardCards | null>;
  findById(boardId: string, cardId: string): Promise<CardRecord | null>;
  findByNumber(boardId: string, number: number): Promise<CardRecord | null>;
  /**
   * Deletes the card with its transitions; `false` if it was not in the board. Waits for row
   * locks at most `lockTimeoutMs` (`BoardBusyError` otherwise).
   */
  delete(boardId: string, cardId: string): Promise<boolean>;
}

function createCardStore(db: QueryClient): CardStore {
  return {
    lockBoard(boardId, mode) {
      return lockBoardRow(db, boardId, mode);
    },

    async lockCard(boardId, cardId) {
      const [row] = await db.$queryRaw<LockedCard[]>`
        SELECT "id", "columnId", "rank" FROM "Card"
        WHERE "id" = ${cardId} AND "boardId" = ${boardId}
        FOR NO KEY UPDATE`;
      return row ?? null;
    },

    findColumn(boardId, columnId) {
      return db.column.findFirst({
        where: { id: columnId, boardId },
        select: { id: true, wipLimit: true, wipStrict: true },
      });
    },

    async lockColumn(boardId, columnId) {
      const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Column"
        WHERE "id" = ${columnId} AND "boardId" = ${boardId}
        FOR NO KEY UPDATE`;
      return rows.length > 0;
    },

    countInColumn(columnId) {
      return db.card.count({ where: { columnId } });
    },

    listInColumn(columnId) {
      // "rank" has COLLATE "C", so the database order equals JavaScript string order.
      return db.card.findMany({ where: { columnId }, orderBy: { rank: 'asc' } });
    },

    async lockMembership(boardId, userId) {
      const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "BoardMember"
        WHERE "boardId" = ${boardId} AND "userId" = ${userId}
        FOR SHARE`;
      return rows.length > 0;
    },

    async allocateNumber(boardId) {
      const [row] = await db.$queryRaw<{ number: number }[]>`
        UPDATE "Board" SET "nextCardNumber" = "nextCardNumber" + 1
        WHERE "id" = ${boardId}
        RETURNING "nextCardNumber" - 1 AS "number"`;
      if (!row) throw new Error('Board not found while allocating a card number');
      return row.number;
    },

    create(data) {
      return db.card.create({ data });
    },

    findById(boardId, cardId) {
      return db.card.findFirst({ where: { id: cardId, boardId } });
    },

    updatePosition(boardId, cardId, columnId, rank) {
      return nullIfMissing(
        db.card.update({ where: { id: cardId, boardId }, data: { columnId, rank } }),
      );
    },

    update(boardId, cardId, data) {
      return nullIfMissing(db.card.update({ where: { id: cardId, boardId }, data }));
    },

    async setRanks(columnId, assignments) {
      if (assignments.length === 0) return;
      const ids = assignments.map((entry) => entry.id);
      const ranks = assignments.map((entry) => entry.rank);
      await db.$executeRaw`
        UPDATE "Card" AS c
        SET "rank" = v."rank"
        FROM unnest(${ids}::text[], ${ranks}::text[]) AS v("id", "rank")
        WHERE c."id" = v."id" AND c."columnId" = ${columnId}`;
    },

    async recordTransition(data) {
      await db.cardTransition.create({ data });
    },
  };
}

export function createCardRepository(
  db: DbClient,
  options: Partial<BoardTransactionOptions> = {},
): CardRepository {
  const run = createBoardTransactionRunner(db, RANK_UNIQUE_CONSTRAINT, options);
  const store = createCardStore(db);

  return {
    transaction: (fn) => run((tx) => fn(createCardStore(tx))),

    async findBoardKey(boardId) {
      const board = await db.board.findUnique({ where: { id: boardId }, select: { key: true } });
      return board?.key ?? null;
    },

    listBoard(boardId) {
      return run(
        async (tx) => {
          const board = await tx.board.findUnique({
            where: { id: boardId },
            select: { key: true },
          });
          if (!board) return null;
          const columns = await tx.column.findMany({
            where: { boardId },
            select: { id: true },
            orderBy: { rank: 'asc' },
          });
          // "rank" has COLLATE "C", so the database order equals JavaScript string order.
          const cards = await tx.card.findMany({
            where: { boardId },
            orderBy: [{ columnId: 'asc' }, { rank: 'asc' }],
          });
          return { boardKey: board.key, columnIds: columns.map((column) => column.id), cards };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },

    findById: (boardId, cardId) => store.findById(boardId, cardId),

    findByNumber(boardId, number) {
      return db.card.findUnique({ where: { boardId_number: { boardId, number } } });
    },

    delete(boardId, cardId) {
      return run(async (tx) => {
        const { count } = await tx.card.deleteMany({ where: { id: cardId, boardId } });
        return count > 0;
      });
    },
  };
}
