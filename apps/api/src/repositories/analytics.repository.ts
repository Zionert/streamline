import type { ColumnCategory } from '../generated/prisma/client.js';
import { createBoardTransactionRunner, type BoardTransactionOptions } from './board-transaction.js';
import type { DbClient } from './db.js';

export interface FlowColumnRecord {
  id: string;
  title: string;
  /** The CURRENT category; earlier categories of the column are not stored. */
  category: ColumnCategory;
}

export interface FlowCardRecord {
  id: string;
  number: number;
  title: string;
  createdAt: Date;
  columnId: string;
  assignee: { id: string; name: string } | null;
}

export interface FlowTransitionRecord {
  cardId: string;
  /** `null` when the target column was deleted later. */
  toColumnId: string | null;
  movedAt: Date;
}

/** Everything the flow metrics of a board are computed from. */
export interface BoardFlowData {
  boardKey: string;
  columns: FlowColumnRecord[];
  cards: FlowCardRecord[];
  /** Every transition of the board's existing cards, oldest first. */
  transitions: FlowTransitionRecord[];
}

export interface AnalyticsRepository {
  /**
   * The board key, its columns, cards and the FULL transition history of its cards, read in one
   * REPEATABLE READ transaction (a single snapshot, so every transition belongs to a listed card
   * and references a listed or deleted column); `null` if the board does not exist.
   *
   * The history is not cut at the end of the requested range: current-state metrics (aging work,
   * the number of cards left for a forecast) and the cycle start of a card completed in the range
   * may depend on transitions outside of it, and the range filters are applied to the derived
   * dates afterwards. Only the columns the metrics use are selected.
   */
  loadBoardFlow(boardId: string): Promise<BoardFlowData | null>;
}

export function createAnalyticsRepository(
  db: DbClient,
  options: Partial<BoardTransactionOptions> = {},
): AnalyticsRepository {
  const run = createBoardTransactionRunner(db, null, options);

  return {
    loadBoardFlow(boardId) {
      return run(
        async (tx) => {
          const board = await tx.board.findUnique({
            where: { id: boardId },
            select: { key: true },
          });
          if (!board) return null;
          const columns = await tx.column.findMany({
            where: { boardId },
            select: { id: true, title: true, category: true },
            orderBy: { rank: 'asc' },
          });
          const cards = await tx.card.findMany({
            where: { boardId },
            select: {
              id: true,
              number: true,
              title: true,
              createdAt: true,
              columnId: true,
              assignee: { select: { id: true, name: true } },
            },
            orderBy: { number: 'asc' },
          });
          // Served by the (boardId, movedAt) index.
          const transitions = await tx.cardTransition.findMany({
            where: { boardId },
            select: { cardId: true, toColumnId: true, movedAt: true },
            orderBy: [{ movedAt: 'asc' }, { id: 'asc' }],
          });
          return { boardKey: board.key, columns, cards, transitions };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
  };
}
