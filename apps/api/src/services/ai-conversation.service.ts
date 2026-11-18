import {
  AI_ERROR_CODES,
  type AiConversation,
  type AiJsonValue,
  type AiMessage,
  type AiMessageListQuery,
} from '@streamline/shared';

import { NotFoundError } from '../errors/app-error.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  AiConversationRecord,
  AiConversationRepository,
  AiMessageRecord,
} from '../repositories/ai-conversation.repository.js';
import {
  assertBoardPermission,
  BOARD_NOT_FOUND_MESSAGE,
  type BoardAccessService,
  type BoardMembership,
} from './board-access.service.js';
import { toPage, type Page } from './pagination.js';

/**
 * Conversations with the AI assistant. They are private to their author: another user's
 * conversation is reported as missing. A board chat (one per user and board) needs `board:view`
 * on its board for as long as it is used, so a user who lost access to the board can no longer
 * read it; it is deleted together with the board.
 */
export interface AiConversationService {
  /** The caller's conversation about the board (created on first use) with its newest messages. */
  getBoardConversation(
    membership: BoardMembership,
    query: AiMessageListQuery,
  ): Promise<{ conversation: AiConversation; page: Page<AiMessage> }>;
  /** Deletes the messages of the caller's conversation about the board; no-op if there is none. */
  clearBoardConversation(membership: BoardMembership): Promise<void>;
  /** Starts a board-less "New project with assistant" conversation. */
  createProjectSession(userId: string): Promise<AiConversation>;
  /** A page of the messages of one of the caller's conversations, newest page first. */
  listMessages(
    userId: string,
    conversationId: string,
    query: AiMessageListQuery,
  ): Promise<Page<AiMessage>>;
}

export interface AiConversationServiceDependencies {
  conversations: AiConversationRepository;
  boardAccess: Pick<BoardAccessService, 'require'>;
}

export const CONVERSATION_NOT_FOUND_MESSAGE = 'Conversation not found';

export function conversationNotFound(): NotFoundError {
  return new NotFoundError(CONVERSATION_NOT_FOUND_MESSAGE, AI_ERROR_CODES.CONVERSATION_NOT_FOUND);
}

export function toAiConversation(conversation: AiConversationRecord): AiConversation {
  return {
    id: conversation.id,
    kind: conversation.kind,
    boardId: conversation.boardId,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

/** Copies a stored JSON value into the shared JSON type (drops keys holding `undefined`). */
function toJsonValue(value: Prisma.JsonValue): AiJsonValue {
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, AiJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = toJsonValue(item);
    }
    return result;
  }
  return value;
}

export function toAiMessage(message: AiMessageRecord): AiMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    toolName: message.toolName,
    toolCallId: message.toolCallId,
    toolArgs: message.toolArgs === null ? null : toJsonValue(message.toolArgs),
    toolResult: message.toolResult === null ? null : toJsonValue(message.toolResult),
    createdAt: message.createdAt.toISOString(),
  };
}

export function createAiConversationService({
  conversations,
  boardAccess,
}: AiConversationServiceDependencies): AiConversationService {
  /** Reads a page newest first and returns it in chronological order, ready to display. */
  async function messagePage(
    conversationId: string,
    { cursor, limit }: AiMessageListQuery,
  ): Promise<Page<AiMessage>> {
    const page = toPage(await conversations.listMessages(conversationId, { cursor, limit }), limit);
    return { items: page.items.map(toAiMessage).reverse(), nextCursor: page.nextCursor };
  }

  /** A board chat is readable only while its author may still view the board. */
  async function assertStillHasAccess(conversation: AiConversationRecord): Promise<void> {
    if (conversation.boardId === null) return;
    try {
      await boardAccess.require(conversation.boardId, conversation.userId, 'board:view');
    } catch (err) {
      if (err instanceof NotFoundError) throw conversationNotFound();
      throw err;
    }
  }

  return {
    async getBoardConversation(membership, query) {
      assertBoardPermission(membership, 'board:view');
      const conversation = await conversations.getOrCreateBoardChat(
        membership.userId,
        membership.boardId,
      );
      if (!conversation) throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      return {
        conversation: toAiConversation(conversation),
        page: await messagePage(conversation.id, query),
      };
    },

    async clearBoardConversation(membership) {
      assertBoardPermission(membership, 'board:view');
      const conversation = await conversations.findBoardChat(membership.userId, membership.boardId);
      if (conversation) await conversations.clearMessages(conversation.id);
    },

    async createProjectSession(userId) {
      return toAiConversation(await conversations.createProjectSession(userId));
    },

    async listMessages(userId, conversationId, query) {
      const conversation = await conversations.findOwned(userId, conversationId);
      if (!conversation) throw conversationNotFound();
      await assertStillHasAccess(conversation);
      return messagePage(conversation.id, query);
    },
  };
}
