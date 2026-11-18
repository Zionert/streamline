import type { PageCursor } from '@streamline/shared';

import type { AiConversation, AiMessage, Prisma } from '../generated/prisma/client.js';
import type { DbClient } from './db.js';
import { isPrismaError, PRISMA_ERROR } from './prisma-errors.js';

export type AiConversationRecord = AiConversation;
export type AiMessageRecord = AiMessage;

/** One page of a conversation's messages in `(createdAt, id)` descending order. */
export interface AiMessagePageRequest {
  cursor?: PageCursor | undefined;
  limit: number;
}

export interface AiConversationRepository {
  /**
   * The user's conversation about the board, created if it does not exist yet. Safe under
   * concurrent calls: the insert skips a row that a parallel request has just created (unique
   * `(userId, boardId)`), and the conversation is then read back. `null` when the board no longer
   * exists.
   */
  getOrCreateBoardChat(userId: string, boardId: string): Promise<AiConversationRecord | null>;
  /** The user's conversation about the board, if it was ever opened. */
  findBoardChat(userId: string, boardId: string): Promise<AiConversationRecord | null>;
  /** A new board-less conversation ("New project with assistant"). */
  createProjectSession(userId: string): Promise<AiConversationRecord>;
  /** The conversation, only if it belongs to the user. */
  findOwned(userId: string, conversationId: string): Promise<AiConversationRecord | null>;
  /**
   * The conversation's messages, newest first, before the cursor; at most `limit + 1` rows, so the
   * caller can tell whether older messages exist.
   */
  listMessages(conversationId: string, page: AiMessagePageRequest): Promise<AiMessageRecord[]>;
  /** Deletes all messages of the conversation (the conversation itself stays). */
  clearMessages(conversationId: string): Promise<void>;
}

/** Rows strictly after the cursor in `(createdAt DESC, id DESC)` order. */
function olderThan(cursor: PageCursor | undefined): Prisma.AiMessageWhereInput {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export function createAiConversationRepository(db: DbClient): AiConversationRepository {
  const findBoardChat = (userId: string, boardId: string) =>
    db.aiConversation.findFirst({ where: { userId, boardId, kind: 'BOARD_CHAT' } });

  return {
    async getOrCreateBoardChat(userId, boardId) {
      const existing = await findBoardChat(userId, boardId);
      if (existing) return existing;
      try {
        // ON CONFLICT DO NOTHING: a conversation created meanwhile by a parallel request wins.
        await db.aiConversation.createMany({
          data: [{ userId, boardId, kind: 'BOARD_CHAT' }],
          skipDuplicates: true,
        });
      } catch (err) {
        // The board was deleted after the caller's access was checked.
        if (isPrismaError(err, PRISMA_ERROR.FOREIGN_KEY_VIOLATION)) return null;
        throw err;
      }
      return findBoardChat(userId, boardId);
    },

    findBoardChat,

    createProjectSession(userId) {
      return db.aiConversation.create({ data: { userId, kind: 'PROJECT_SESSION' } });
    },

    findOwned(userId, conversationId) {
      return db.aiConversation.findFirst({ where: { id: conversationId, userId } });
    },

    listMessages(conversationId, { cursor, limit }) {
      return db.aiMessage.findMany({
        where: { AND: [{ conversationId }, olderThan(cursor)] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
    },

    async clearMessages(conversationId) {
      await db.$transaction([
        db.aiMessage.deleteMany({ where: { conversationId } }),
        db.aiConversation.updateMany({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        }),
      ]);
    },
  };
}
