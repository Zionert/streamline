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

/** Longest message a user may send to the assistant (characters, after trimming). */
export const AI_USER_MESSAGE_MAX_LENGTH = 4000;

/**
 * Body of `POST /ai/conversations/:conversationId/messages`: the user's next message. The answer
 * is streamed back as Server-Sent Events (see {@link AI_CHAT_EVENT_NAMES}).
 */
export const sendAiMessageSchema = z.strictObject({
  content: z
    .string()
    .trim()
    .min(1, 'Message is required')
    .max(
      AI_USER_MESSAGE_MAX_LENGTH,
      `Message must be at most ${String(AI_USER_MESSAGE_MAX_LENGTH)} characters`,
    ),
});

export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;

/** Tokens spent by the model on one turn (all model calls of the turn together). */
export const aiTokenUsageSchema = z.object({
  promptTokens: z.int().min(0),
  completionTokens: z.int().min(0),
});

export type AiTokenUsage = z.infer<typeof aiTokenUsageSchema>;

/** `delta`: the next fragment of the assistant's visible answer (append it to the text so far). */
export const aiChatDeltaEventSchema = z.object({ text: z.string() });

/**
 * `tool`: the assistant uses a tool (e.g. reads the board). `started` and then `finished` are sent
 * for every call, paired by `id`; `ok` (only with `finished`) tells whether the call succeeded.
 * The tool's result itself is never streamed.
 */
export const aiChatToolEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['started', 'finished']),
  ok: z.boolean().optional(),
});

/**
 * `done`: the turn succeeded and was saved. `messages` are the rows stored for it, in order (the
 * user's message, the tool calls, the final answer, whose `content` equals the streamed deltas).
 */
export const aiChatDoneEventSchema = z.object({
  messages: z.array(aiMessageSchema),
  usage: aiTokenUsageSchema,
});

/**
 * `error`: the turn failed after the stream had started; nothing of it was saved (the streamed
 * text should be discarded). `message` is safe to show to users.
 */
export const aiChatErrorEventSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type AiChatDeltaEvent = z.infer<typeof aiChatDeltaEventSchema>;
export type AiChatToolEvent = z.infer<typeof aiChatToolEventSchema>;
export type AiChatDoneEvent = z.infer<typeof aiChatDoneEventSchema>;
export type AiChatErrorEvent = z.infer<typeof aiChatErrorEventSchema>;

/**
 * Server-Sent Events of a chat turn (`event:` name → schema of the JSON `data:`). A stream sends
 * any number of `delta` and `tool` events and ends with exactly one `done` or `error`.
 */
export const aiChatEventSchemas = {
  delta: aiChatDeltaEventSchema,
  tool: aiChatToolEventSchema,
  done: aiChatDoneEventSchema,
  error: aiChatErrorEventSchema,
} as const;

export type AiChatEventName = keyof typeof aiChatEventSchemas;

export const AI_CHAT_EVENT_NAMES = Object.keys(aiChatEventSchemas) as AiChatEventName[];

/** The `data` payload of each chat turn event. */
export type AiChatEventPayloads = {
  [Name in AiChatEventName]: z.infer<(typeof aiChatEventSchemas)[Name]>;
};

/** A parsed chat turn event. */
export type AiChatEvent =
  | { event: 'delta'; data: AiChatDeltaEvent }
  | { event: 'tool'; data: AiChatToolEvent }
  | { event: 'done'; data: AiChatDoneEvent }
  | { event: 'error'; data: AiChatErrorEvent };

function isAiChatEventName(name: string): name is AiChatEventName {
  return Object.hasOwn(aiChatEventSchemas, name);
}

/**
 * Validates one received event (its name and the parsed JSON of its data); `null` for an unknown
 * event name or a payload not matching its schema.
 */
export function parseAiChatEvent(name: string, data: unknown): AiChatEvent | null {
  if (!isAiChatEventName(name)) return null;
  switch (name) {
    case 'delta': {
      const result = aiChatDeltaEventSchema.safeParse(data);
      return result.success ? { event: name, data: result.data } : null;
    }
    case 'tool': {
      const result = aiChatToolEventSchema.safeParse(data);
      return result.success ? { event: name, data: result.data } : null;
    }
    case 'done': {
      const result = aiChatDoneEventSchema.safeParse(data);
      return result.success ? { event: name, data: result.data } : null;
    }
    case 'error': {
      const result = aiChatErrorEventSchema.safeParse(data);
      return result.success ? { event: name, data: result.data } : null;
    }
  }
}

/** Error codes specific to the AI assistant endpoints (besides the generic ones). */
export const AI_ERROR_CODES = {
  /** 404: the assistant is turned off on this server (every `/ai/*` route except the status). */
  AI_DISABLED: 'AI_DISABLED',
  /** 404: no such conversation of the caller (another user's conversations are never revealed). */
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  /** 429: the caller used up the daily requests or tokens of the assistant (UTC day). */
  AI_LIMIT_REACHED: 'AI_LIMIT_REACHED',
  /** 409: the conversation is already answering another message. */
  AI_TURN_IN_PROGRESS: 'AI_TURN_IN_PROGRESS',
  /** `error` event: the model provider is overloaded or rate-limited; try again shortly. */
  AI_PROVIDER_BUSY: 'AI_PROVIDER_BUSY',
  /** `error` event: the model provider failed (timeout, unexpected response, configuration). */
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  /** `error` event: the model's output (e.g. tool arguments) stayed invalid after a correction. */
  AI_INVALID_OUTPUT: 'AI_INVALID_OUTPUT',
  /** `error` event: the conversation was cleared during the turn, so the turn was not saved. */
  AI_CONVERSATION_CLEARED: 'AI_CONVERSATION_CLEARED',
  /** `error` event: an unexpected server error ended the turn. */
  AI_INTERNAL_ERROR: 'AI_INTERNAL_ERROR',
} as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];
