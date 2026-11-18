import { z } from 'zod';

import { pageQuerySchema } from './pagination.js';

/**
 * AI assistant conversations. A user has one conversation per board (the assistant panel of the
 * board) and may start board-less "New project with assistant" sessions. Conversations are
 * private to their author.
 */

/** Response body of `GET /ai/status`; the client learns from it whether to show the assistant. */
export const aiStatusResponseSchema = z.object({
  enabled: z.boolean(),
  /** Model the assistant uses; `null` while the assistant is disabled. */
  model: z.string().nullable(),
});

export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;

/** `BOARD_CHAT`: the assistant panel of a board; `PROJECT_SESSION`: "New project with assistant". */
export const AI_CONVERSATION_KINDS = ['BOARD_CHAT', 'PROJECT_SESSION'] as const;

export type AiConversationKind = (typeof AI_CONVERSATION_KINDS)[number];

/** `TOOL` messages carry the result of a tool call made by the assistant. */
export const AI_MESSAGE_ROLES = ['USER', 'ASSISTANT', 'TOOL'] as const;

export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export const aiConversationSchema = z.object({
  id: z.string(),
  kind: z.enum(AI_CONVERSATION_KINDS),
  /** The board of a `BOARD_CHAT`; `null` for a `PROJECT_SESSION`. */
  boardId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type AiConversation = z.infer<typeof aiConversationSchema>;

/** Any JSON value (arguments and results of tool calls). */
export const aiJsonValueSchema = z.json();

export type AiJsonValue = z.infer<typeof aiJsonValueSchema>;

export const aiMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(AI_MESSAGE_ROLES),
  /** Text of the message; empty for an assistant message that only calls a tool. */
  content: z.string(),
  /** Name of the called tool (assistant calling a tool, or the tool's answer); otherwise `null`. */
  toolName: z.string().nullable(),
  /** Id of the tool call, pairing a `TOOL` message with the call it answers. */
  toolCallId: z.string().nullable(),
  toolArgs: aiJsonValueSchema.nullable(),
  toolResult: aiJsonValueSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export type AiMessage = z.infer<typeof aiMessageSchema>;

/** Messages returned per page when the request gives no `limit`. */
export const AI_MESSAGES_PAGE_DEFAULT_LIMIT = 30;
export const AI_MESSAGES_PAGE_MAX_LIMIT = 100;

/**
 * Query of the conversation endpoints: the history is paged from the newest message backwards;
 * `cursor` is the `nextCursor` of the previous page (it leads to older messages), `limit` per page
 * (default 30, at most 100).
 */
export const aiMessageListQuerySchema = pageQuerySchema(
  AI_MESSAGES_PAGE_DEFAULT_LIMIT,
  AI_MESSAGES_PAGE_MAX_LIMIT,
);

export type AiMessageListQuery = z.infer<typeof aiMessageListQuerySchema>;

/**
 * One page of a conversation's history: the newest messages not yet loaded, in chronological
 * order (oldest first, ready to display); `nextCursor` loads the older ones and is `null` when
 * the beginning of the conversation has been reached.
 */
export const aiMessageListResponseSchema = z.object({
  messages: z.array(aiMessageSchema),
  nextCursor: z.string().nullable(),
});

export type AiMessageListResponse = z.infer<typeof aiMessageListResponseSchema>;

/**
 * Response body of `GET /ai/boards/:boardId/conversation`: the caller's conversation about the
 * board (created on first use) with the newest page of its messages.
 */
export const aiBoardConversationResponseSchema = aiMessageListResponseSchema.extend({
  conversation: aiConversationSchema,
});

export type AiBoardConversationResponse = z.infer<typeof aiBoardConversationResponseSchema>;

/** Body of `POST /ai/project-sessions`: no fields yet (an empty object or no body). */
export const createAiProjectSessionSchema = z.strictObject({});

export type CreateAiProjectSessionInput = z.infer<typeof createAiProjectSessionSchema>;

/** Response body of `POST /ai/project-sessions`. */
export const aiConversationResponseSchema = z.object({
  conversation: aiConversationSchema,
});

export type AiConversationResponse = z.infer<typeof aiConversationResponseSchema>;

/** Error codes specific to the AI assistant endpoints (besides the generic ones). */
export const AI_ERROR_CODES = {
  /** 404: the assistant is turned off on this server (every `/ai/*` route except the status). */
  AI_DISABLED: 'AI_DISABLED',
  /** 404: no such conversation of the caller (another user's conversations are never revealed). */
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
} as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];
