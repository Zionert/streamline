import type { AiJsonValue, PageCursor } from '@streamline/shared';

import { Prisma, type AiConversation, type AiMessage } from '../generated/prisma/client.js';
import type { DbClient } from './db.js';
import { isPrismaError, PRISMA_ERROR } from './prisma-errors.js';

export type AiConversationRecord = AiConversation;
export type AiMessageRecord = AiMessage;

/** One page of a conversation's messages in `(createdAt, id)` descending order. */
export interface AiMessagePageRequest {
  cursor?: PageCursor | undefined;
  limit: number;
}

/** A message of a finished turn, to be stored. */
export interface NewAiMessageData {
  role: AiMessageRecord['role'];
  content: string;
  toolName?: string | null;
  toolCallId?: string | null;
  toolArgs?: AiJsonValue;
  toolResult?: AiJsonValue;
  createdAt: Date;
}

export type SaveTurnResult =
  | { status: 'saved'; rows: AiMessageRecord[] }
  /** The conversation no longer exists. */
  | { status: 'missing' }
  /** The conversation changed since the turn started (its messages were cleared). */
  | { status: 'changed' };

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
  /**
   * Deletes all messages of the conversation (the conversation itself stays); its `updatedAt`
   * changes only when there was something to delete.
   */
  clearMessages(conversationId: string): Promise<void>;
  /**
   * Stores the messages of a finished turn and marks the conversation as updated, in one
   * transaction, only if the conversation still has the `updatedAt` read when the turn started
   * (otherwise it was cleared meanwhile and nothing is stored). Returns the stored rows in
   * `(createdAt, id)` order.
   */
  saveTurn(
    conversationId: string,
    messages: NewAiMessageData[],
    expectedUpdatedAt: Date,
  ): Promise<SaveTurnResult>;
}

/** `null` JSON fields are stored as SQL NULL. */
function jsonField(
  value: AiJsonValue | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  return value === null ? Prisma.DbNull : value;
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
      await db.$transaction(async (tx) => {
        const { count } = await tx.aiMessage.deleteMany({ where: { conversationId } });
        if (count === 0) return;
        await tx.aiConversation.updateMany({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
      });
    },

    saveTurn(conversationId, messages, expectedUpdatedAt) {
      return db.$transaction(async (tx): Promise<SaveTurnResult> => {
        const { count } = await tx.aiConversation.updateMany({
          where: { id: conversationId, updatedAt: expectedUpdatedAt },
          data: { updatedAt: new Date() },
        });
        if (count === 0) {
          const exists = await tx.aiConversation.count({ where: { id: conversationId } });
          return { status: exists === 0 ? 'missing' : 'changed' };
        }
        const rows = await tx.aiMessage.createManyAndReturn({
          data: messages.map((message) => ({
            conversationId,
            role: message.role,
            content: message.content,
            toolName: message.toolName ?? null,
            toolCallId: message.toolCallId ?? null,
            toolArgs: jsonField(message.toolArgs),
            toolResult: jsonField(message.toolResult),
            createdAt: message.createdAt,
          })),
        });
        rows.sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
        return { status: 'saved', rows };
      });
    },
  };
}
