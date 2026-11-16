import type { PageCursor } from '@streamline/shared';

import type { Comment, Prisma } from '../generated/prisma/client.js';
import {
  insertActivity,
  type ActivityRecord,
  type NewActivityData,
} from './activity.repository.js';
import {
  createBoardTransactionRunner,
  lockBoardRow,
  type BoardLockMode,
  type BoardTransactionOptions,
  type QueryClient,
} from './board-transaction.js';
import { cardExistsInBoard } from './card-exists.js';
import type { DbClient } from './db.js';

/** A comment with the name of its author (`null` when the account no longer exists). */
export type CommentRecord = Comment & { author: { id: string; name: string } | null };

/** The card a comment is written on, as described in the activity log. */
export interface CommentedCard {
  id: string;
  number: number;
  title: string;
  boardKey: string;
}

/** The fields of a comment that decide whether it may be changed. */
export interface LockedComment {
  id: string;
  authorId: string | null;
  body: string;
}

export interface NewCommentData {
  cardId: string;
  boardId: string;
  authorId: string;
  body: string;
}

/** One page of a card's comments in `(createdAt, id)` ascending order. */
export interface CommentPageRequest {
  cursor?: PageCursor | undefined;
  limit: number;
}

const authorInclude = { author: { select: { id: true, name: true } } } as const;

/** Comment queries; inside `CommentRepository.transaction` they all run in that transaction. */
export interface CommentStore {
  /** Locks the board row until the end of the transaction; `false` if the board does not exist. */
  lockBoard(boardId: string, mode: BoardLockMode): Promise<boolean>;
  /**
   * Finds the card in the board and locks it `FOR SHARE`, so it cannot be deleted before the
   * transaction ends (a delete in progress is waited for, then the card is reported missing).
   */
  lockCard(boardId: string, cardId: string): Promise<CommentedCard | null>;
  /** Finds the comment on the card and locks it (`FOR UPDATE`); `null` if it is not there. */
  lockComment(boardId: string, cardId: string, commentId: string): Promise<LockedComment | null>;
  create(data: NewCommentData): Promise<CommentRecord>;
  /** Replaces the body and sets `editedAt`. */
  updateBody(commentId: string, body: string): Promise<CommentRecord>;
  delete(commentId: string): Promise<void>;
  findById(commentId: string): Promise<CommentRecord | null>;
  /** Writes an activity entry in this transaction. */
  recordActivity(data: NewActivityData): Promise<ActivityRecord>;
}

export interface CommentRepository {
  /**
   * Runs `fn` in a transaction (READ COMMITTED); a lock wait or transaction exceeding the time
   * limits surfaces as `BoardBusyError`.
   */
  transaction<T>(fn: (store: CommentStore) => Promise<T>): Promise<T>;
  /** Whether the card exists in the board. */
  cardExists(boardId: string, cardId: string): Promise<boolean>;
  /**
   * The card's comments, oldest first, after the cursor; at most `limit + 1` rows, so the caller
   * can tell whether another page exists.
   */
  listForCard(cardId: string, page: CommentPageRequest): Promise<CommentRecord[]>;
}

/** Rows strictly after the cursor in `(createdAt ASC, id ASC)` order. */
function newerThan(cursor: PageCursor | undefined): Prisma.CommentWhereInput {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}

function createCommentStore(db: QueryClient): CommentStore {
  return {
    lockBoard(boardId, mode) {
      return lockBoardRow(db, boardId, mode);
    },

    async lockCard(boardId, cardId) {
      const [row] = await db.$queryRaw<CommentedCard[]>`
        SELECT c."id", c."number", c."title", b."key" AS "boardKey"
        FROM "Card" AS c JOIN "Board" AS b ON b."id" = c."boardId"
        WHERE c."id" = ${cardId} AND c."boardId" = ${boardId}
        FOR SHARE OF c`;
      return row ?? null;
    },

    async lockComment(boardId, cardId, commentId) {
      const [row] = await db.$queryRaw<LockedComment[]>`
        SELECT "id", "authorId", "body" FROM "Comment"
        WHERE "id" = ${commentId} AND "cardId" = ${cardId} AND "boardId" = ${boardId}
        FOR UPDATE`;
      return row ?? null;
    },

    create(data) {
      return db.comment.create({ data, include: authorInclude });
    },

    updateBody(commentId, body) {
      return db.comment.update({
        where: { id: commentId },
        data: { body, editedAt: new Date() },
        include: authorInclude,
      });
    },

    async delete(commentId) {
      await db.comment.delete({ where: { id: commentId } });
    },

    findById(commentId) {
      return db.comment.findUnique({ where: { id: commentId }, include: authorInclude });
    },

    recordActivity(data) {
      return insertActivity(db, data);
    },
  };
}

export function createCommentRepository(
  db: DbClient,
  options: Partial<BoardTransactionOptions> = {},
): CommentRepository {
  const run = createBoardTransactionRunner(db, null, options);
  return {
    transaction: (fn) => run((tx) => fn(createCommentStore(tx))),

    cardExists: (boardId, cardId) => cardExistsInBoard(db, boardId, cardId),

    listForCard(cardId, { cursor, limit }) {
      return db.comment.findMany({
        where: { AND: [{ cardId }, newerThan(cursor)] },
        include: authorInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
    },
  };
}
