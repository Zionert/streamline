import {
  aiBoardConversationResponseSchema,
  aiConversationResponseSchema,
  aiMessageListResponseSchema,
  errorResponseSchema,
  parseAiChatEvent,
  AI_MESSAGES_PAGE_DEFAULT_LIMIT,
  type AiBoardConversationResponse,
  type AiChatEvent,
  type AiConversation,
  type AiMessageListResponse,
} from '@streamline/shared';

import { api, refreshSession, waitForPendingRefresh } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

import { SseParser } from './sseParser';

/** Messages loaded per page of the conversation history. */
export const ASSISTANT_PAGE_SIZE = AI_MESSAGES_PAGE_DEFAULT_LIMIT;

/** The caller's conversation about the board (created on first use) and its newest messages. */
export async function getBoardConversation(boardId: string): Promise<AiBoardConversationResponse> {
  const response = await api.get<unknown>(
    `/ai/boards/${encodeURIComponent(boardId)}/conversation`,
    { params: { limit: ASSISTANT_PAGE_SIZE } },
  );
  return aiBoardConversationResponseSchema.parse(response.data);
}

/** Older messages of a conversation (`cursor` is the `nextCursor` of the previous page). */
export async function getConversationMessages(
  conversationId: string,
  cursor: string,
): Promise<AiMessageListResponse> {
  const response = await api.get<unknown>(
    `/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
    { params: { cursor, limit: ASSISTANT_PAGE_SIZE } },
  );
  return aiMessageListResponseSchema.parse(response.data);
}

/** Deletes every message of the caller's conversation about the board. */
export async function clearBoardConversation(boardId: string): Promise<void> {
  await api.delete(`/ai/boards/${encodeURIComponent(boardId)}/conversation`);
}

/** Starts a new "New project with assistant" session. */
export async function createProjectSession(): Promise<AiConversation> {
  const response = await api.post<unknown>('/ai/project-sessions', {});
  return aiConversationResponseSchema.parse(response.data).conversation;
}

/**
 * A chat turn failed before its stream started: the server answered with an error status
 * (`status` and the `code` of its error body) or could not be reached (`status` undefined).
 */
export class AssistantRequestError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(status: number | undefined, code: string | undefined, message: string) {
    super(message);
    this.name = 'AssistantRequestError';
    this.status = status;
    this.code = code;
  }
}

/** How a streamed turn ended: with `done`, with `error`, or with the stream closing early. */
export type TurnStreamEnd = 'done' | 'error' | 'incomplete';

export interface StreamTurnOptions {
  /** Aborting it stops the answer (the server saves nothing then). */
  signal: AbortSignal;
  /** Called for every valid event of the stream, in order. */
  onEvent: (event: AiChatEvent) => void;
}

function turnUrl(conversationId: string): string {
  return `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages`;
}

async function postTurn(
  conversationId: string,
  content: string,
  accessToken: string | null,
  signal: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  try {
    return await fetch(turnUrl(conversationId), {
      method: 'POST',
      headers,
      body: JSON.stringify({ content }),
      credentials: 'include',
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new AssistantRequestError(undefined, undefined, 'Network error');
  }
}

async function requestError(response: Response): Promise<AssistantRequestError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (e.g. a proxy error page): only the status is known.
  }
  const parsed = errorResponseSchema.safeParse(body);
  return parsed.success
    ? new AssistantRequestError(response.status, parsed.data.error.code, parsed.data.error.message)
    : new AssistantRequestError(response.status, undefined, `Request failed (${response.status})`);
}

/**
 * Opens the turn's stream with the current access token. An expired token (401 before the stream
 * starts) is refreshed once through the shared single-flight refresh of the API client and the
 * request is sent again. A rejected refresh ends the session like for any other request (the
 * turn fails with the 401); a refresh that cannot reach the server fails like a network error.
 */
async function openTurnStream(
  conversationId: string,
  content: string,
  signal: AbortSignal,
): Promise<Response> {
  await waitForPendingRefresh();
  const sentToken = useAuthStore.getState().accessToken;
  let response = await postTurn(conversationId, content, sentToken, signal);
  if (response.status === 401) {
    // Another request may have refreshed the session meanwhile: then just use the new token.
    const current = useAuthStore.getState().accessToken;
    if (!current || current === sentToken) {
      try {
        await refreshSession();
      } catch {
        // A rejected refresh token has ended the session (the app returns to the login page);
        // otherwise the refresh itself could not reach the server (network, 5xx).
        if (useAuthStore.getState().status === 'unauthenticated') {
          throw await requestError(response);
        }
        throw new AssistantRequestError(undefined, undefined, 'Session refresh failed');
      }
    }
    response = await postTurn(conversationId, content, useAuthStore.getState().accessToken, signal);
  }
  if (!response.ok) {
    throw await requestError(response);
  }
  return response;
}

function parseData(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Sends the user's message and reads the assistant's answer from the Server-Sent Events stream
 * (`fetch`, as the request needs a POST body and the `Authorization` header). Events are
 * validated with the shared schemas; invalid or unknown ones are skipped. Rejects with
 * `AssistantRequestError` when the turn cannot start, with the abort reason when `signal` is
 * aborted, and with the read error when the connection drops mid-stream.
 */
export async function streamAssistantTurn(
  conversationId: string,
  content: string,
  { signal, onEvent }: StreamTurnOptions,
): Promise<TurnStreamEnd> {
  const response = await openTurnStream(conversationId, content, signal);
  if (!response.body) {
    return 'incomplete';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let end: TurnStreamEnd = 'incomplete';

  const handle = (messages: ReturnType<SseParser['push']>) => {
    for (const message of messages) {
      if (end !== 'incomplete') {
        return;
      }
      const event = parseAiChatEvent(message.event, parseData(message.data));
      if (!event) {
        continue;
      }
      if (event.event === 'done' || event.event === 'error') {
        end = event.event;
      }
      onEvent(event);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      handle(parser.push(decoder.decode(value, { stream: true })));
      if (end !== 'incomplete') {
        break;
      }
    }
    if (end === 'incomplete') {
      handle(parser.push(decoder.decode()));
      handle(parser.end());
    }
  } finally {
    if (end !== 'incomplete') {
      void reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
  return end;
}
