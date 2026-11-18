import type {
  BoardRole,
  CardPriority,
  ColumnCategory,
  LabelColor,
} from '../generated/prisma/client.js';
import type { DbClient } from './db.js';

/** Writes of the demo data seed (development tool, never used by the API). */

export interface DemoUserData {
  email: string;
  name: string;
  passwordHash: string;
}

export interface DemoBoardColumn {
  title: string;
  rank: string;
  category: ColumnCategory;
}

export interface DemoBoardLabel {
  name: string;
  color: LabelColor;
}

export interface DemoBoardTransition {
  /** Index into `DemoBoardData.columns`. */
  column: number;
  at: Date;
}

export interface DemoBoardCard {
  number: number;
  title: string;
  /** Index into `DemoBoardData.columns`; must be the column of the last transition. */
  column: number;
  rank: string;
  priority: CardPriority;
  assigneeId: string | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Indexes into `DemoBoardData.labels`. */
  labels: readonly number[];
  /** Oldest first; the first one is the creation of the card. */
  transitions: readonly DemoBoardTransition[];
}

export interface DemoBoardData {
  name: string;
  key: string;
  ownerId: string;
  createdAt: Date;
  members: readonly { userId: string; role: Exclude<BoardRole, 'OWNER'> }[];
  columns: readonly DemoBoardColumn[];
  labels: readonly DemoBoardLabel[];
  cards: readonly DemoBoardCard[];
}

export interface DemoSeedRepository {
  /**
   * Creates the user or updates the name and password of the existing one; returns its id.
   * Re-running the seed therefore resets the name and password of the demo accounts
   * (`*@streamline.local`), including changes made to them in the app.
   */
  upsertUser(data: DemoUserData): Promise<string>;
  /**
   * In one transaction: deletes the owner's boards with the same key (their columns, cards,
   * transitions, labels, ... are deleted by cascade) and creates the board with everything in
   * it using bulk inserts. Returns the id of the new board and the number of deleted boards.
   */
  replaceBoard(data: DemoBoardData): Promise<{ boardId: string; deletedBoards: number }>;
}

/** Bulk inserts of a few hundred rows; well within this limit. */
const TRANSACTION_TIMEOUT_MS = 30_000;

export function createDemoSeedRepository(db: DbClient): DemoSeedRepository {
  return {
    async upsertUser({ email, name, passwordHash }) {
      const user = await db.user.upsert({
        where: { email },
        update: { name, passwordHash },
        create: { email, name, passwordHash },
        select: { id: true },
      });
      return user.id;
    },

    replaceBoard(data) {
      return db.$transaction(
        async (tx) => {
          const { count: deletedBoards } = await tx.board.deleteMany({
            where: { ownerId: data.ownerId, key: data.key },
          });

          const board = await tx.board.create({
            data: {
              name: data.name,
              key: data.key,
              ownerId: data.ownerId,
              nextCardNumber: data.cards.reduce((max, card) => Math.max(max, card.number), 0) + 1,
              createdAt: data.createdAt,
              updatedAt: data.createdAt,
              members: {
                create: [
                  { userId: data.ownerId, role: 'OWNER', createdAt: data.createdAt },
                  ...data.members.map((member) => ({ ...member, createdAt: data.createdAt })),
                ],
              },
            },
            select: { id: true },
          });
          const boardId = board.id;

          const columns = await tx.column.createManyAndReturn({
            data: data.columns.map((column) => ({
              ...column,
              boardId,
              createdAt: data.createdAt,
              updatedAt: data.createdAt,
            })),
            select: { id: true, rank: true },
          });
          const columnIdByRank = new Map(columns.map((column) => [column.rank, column.id]));
          const columnId = (index: number): string => {
            const id = columnIdByRank.get(data.columns[index]?.rank ?? '');
            if (!id) throw new Error(`Unknown demo column ${String(index)}`);
            return id;
          };

          const labels = await tx.label.createManyAndReturn({
            data: data.labels.map((label) => ({
              ...label,
              boardId,
              createdAt: data.createdAt,
              updatedAt: data.createdAt,
            })),
            select: { id: true, name: true },
          });
          const labelIdByName = new Map(labels.map((label) => [label.name, label.id]));
          const labelId = (index: number): string => {
            const id = labelIdByName.get(data.labels[index]?.name ?? '');
            if (!id) throw new Error(`Unknown demo label ${String(index)}`);
            return id;
          };

          const cards = await tx.card.createManyAndReturn({
            data: data.cards.map((card) => ({
              boardId,
              columnId: columnId(card.column),
              number: card.number,
              title: card.title,
              rank: card.rank,
              priority: card.priority,
              assigneeId: card.assigneeId,
              dueDate: card.dueDate,
              createdAt: card.createdAt,
              updatedAt: card.updatedAt,
            })),
            select: { id: true, number: true },
          });
          const cardIdByNumber = new Map(cards.map((card) => [card.number, card.id]));
          const cardId = (number: number): string => {
            const id = cardIdByNumber.get(number);
            if (!id) throw new Error(`Unknown demo card ${String(number)}`);
            return id;
          };

          await tx.cardTransition.createMany({
            data: data.cards.flatMap((card) =>
              card.transitions.map((transition, index) => {
                const previous = index === 0 ? undefined : card.transitions[index - 1];
                return {
                  cardId: cardId(card.number),
                  boardId,
                  fromColumnId: previous ? columnId(previous.column) : null,
                  toColumnId: columnId(transition.column),
                  movedById: card.assigneeId ?? data.ownerId,
                  movedAt: transition.at,
                };
              }),
            ),
          });
          await tx.cardLabel.createMany({
            data: data.cards.flatMap((card) =>
              card.labels.map((label) => ({
                cardId: cardId(card.number),
                labelId: labelId(label),
              })),
            ),
          });

          return { boardId, deletedBoards };
        },
        { timeout: TRANSACTION_TIMEOUT_MS },
      );
    },
  };
}
