import type { ActivityContent, PageCursor } from '@streamline/shared';

import type { Activity, Prisma } from '../generated/prisma/client.js';
import type { QueryClient } from './board-transaction.js';
import { cardExistsInBoard } from './card-exists.js';
import type { DbClient } from './db.js';

/** An activity row with the name of its actor (`null` when the account no longer exists). */
export type ActivityRecord = Activity & { actor: { id: string; name: string } | null };

export interface NewActivityData {
  boardId: string;
  actorId: string;
  /** The card the entry is about, if any (stored without a foreign key). */
  cardId?: string | null;
  content: ActivityContent;
}

/** One page of a feed in `(createdAt, id)` descending order. */
export interface ActivityPageRequest {
  cursor?: PageCursor | undefined;
  limit: number;
}

const actorInclude = { actor: { select: { id: true, name: true } } } as const;

/**
 * Inserts an activity entry with `db`, which must be the transaction client of the change the
 * entry describes, so the entry is committed or rolled back together with it.
 */
export function insertActivity(db: QueryClient, data: NewActivityData): Promise<ActivityRecord> {
  return db.activity.create({
    data: {
      boardId: data.boardId,
      actorId: data.actorId,
      cardId: data.cardId ?? null,
      type: data.content.type,
      payload: data.content.payload,
    },
    include: actorInclude,
  });
}

/** Rows strictly after the cursor in `(createdAt DESC, id DESC)` order. */
function olderThan(cursor: PageCursor | undefined): Prisma.ActivityWhereInput {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export interface ActivityRepository {
  /**
   * The board's entries, newest first; at most `limit + 1` rows, so the caller can tell whether
   * another page exists.
   */
  listForBoard(boardId: string, page: ActivityPageRequest): Promise<ActivityRecord[]>;
  /** Like `listForBoard`, for the entries about one card. */
  listForCard(
    boardId: string,
    cardId: string,
    page: ActivityPageRequest,
  ): Promise<ActivityRecord[]>;
  /** Whether the card exists in the board. */
  cardExists(boardId: string, cardId: string): Promise<boolean>;
}

export function createActivityRepository(db: DbClient): ActivityRepository {
  const list = (where: Prisma.ActivityWhereInput, { cursor, limit }: ActivityPageRequest) =>
    db.activity.findMany({
      where: { AND: [where, olderThan(cursor)] },
      include: actorInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

  return {
    listForBoard: (boardId, page) => list({ boardId }, page),

    listForCard: (boardId, cardId, page) => list({ boardId, cardId }, page),

    cardExists: (boardId, cardId) => cardExistsInBoard(db, boardId, cardId),
  };
}
