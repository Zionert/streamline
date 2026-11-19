import type { AiConversation, AiMessage } from '@streamline/shared';

const TIMESTAMP = '2026-11-19T10:00:00.000Z';

export function aiConversationWith(overrides: Partial<AiConversation> = {}): AiConversation {
  return {
    id: 'conv-1',
    kind: 'BOARD_CHAT',
    boardId: 'board-1',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

export function aiMessage(overrides: Partial<AiMessage> & Pick<AiMessage, 'id'>): AiMessage {
  return {
    conversationId: 'conv-1',
    role: 'USER',
    content: '',
    toolName: null,
    toolCallId: null,
    toolArgs: null,
    toolResult: null,
    createdAt: TIMESTAMP,
    ...overrides,
  };
}

/** A stored tool call (a successful one unless `toolResult` says otherwise). */
export function toolMessage(
  overrides: Partial<AiMessage> & Pick<AiMessage, 'id' | 'toolName'>,
): AiMessage {
  return aiMessage({
    role: 'TOOL',
    toolCallId: `call-${overrides.id}`,
    toolArgs: {},
    toolResult: { round: 1, ok: true, data: {} },
    ...overrides,
  });
}

/** Response of `GET /ai/boards/:boardId/conversation`. */
export function boardConversationPage(
  messages: AiMessage[] = [],
  nextCursor: string | null = null,
  conversation: AiConversation = aiConversationWith(),
) {
  return { conversation, messages, nextCursor };
}
