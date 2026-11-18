import { describe, expect, it } from 'vitest';

import {
  AI_MESSAGES_PAGE_DEFAULT_LIMIT,
  AI_MESSAGES_PAGE_MAX_LIMIT,
  aiBoardConversationResponseSchema,
  aiMessageListQuerySchema,
  aiMessageSchema,
  aiStatusResponseSchema,
  createAiProjectSessionSchema,
} from './ai.js';

const TIMESTAMP = '2026-11-18T10:00:00.000Z';

const validMessage = {
  id: 'message-1',
  conversationId: 'conversation-1',
  role: 'ASSISTANT',
  content: '',
  toolName: 'search_cards',
  toolCallId: 'call-1',
  toolArgs: { query: 'login', filters: [1, true, null] },
  toolResult: null,
  createdAt: TIMESTAMP,
};

describe('aiStatusResponseSchema', () => {
  it('accepts an enabled assistant with a model and a disabled one without', () => {
    expect(aiStatusResponseSchema.parse({ enabled: true, model: 'qwen3.5:9b' }).model).toBe(
      'qwen3.5:9b',
    );
    expect(aiStatusResponseSchema.parse({ enabled: false, model: null }).model).toBeNull();
  });
});

describe('aiMessageSchema', () => {
  it('accepts tool calls with any JSON arguments', () => {
    expect(aiMessageSchema.parse(validMessage)).toEqual(validMessage);
  });

  it.each([{ role: 'SYSTEM' }, { toolArgs: { when: new Date() } }, { createdAt: 'yesterday' }])(
    'rejects %o',
    (override) => {
      expect(aiMessageSchema.safeParse({ ...validMessage, ...override }).success).toBe(false);
    },
  );
});

describe('aiBoardConversationResponseSchema', () => {
  it('accepts a conversation with a page of messages', () => {
    const body = {
      conversation: {
        id: 'conversation-1',
        kind: 'BOARD_CHAT',
        boardId: 'board-1',
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
      messages: [validMessage],
      nextCursor: null,
    };
    expect(aiBoardConversationResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects an unknown conversation kind', () => {
    const result = aiBoardConversationResponseSchema.safeParse({
      conversation: {
        id: 'c',
        kind: 'GENERAL',
        boardId: null,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
      messages: [],
      nextCursor: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('aiMessageListQuerySchema', () => {
  it('defaults the limit', () => {
    expect(aiMessageListQuerySchema.parse({})).toEqual({ limit: AI_MESSAGES_PAGE_DEFAULT_LIMIT });
  });

  it('decodes the cursor', () => {
    expect(aiMessageListQuerySchema.parse({ cursor: '1000_abc', limit: '5' })).toEqual({
      cursor: { createdAt: new Date(1000), id: 'abc' },
      limit: 5,
    });
  });

  it.each([{ limit: '0' }, { limit: String(AI_MESSAGES_PAGE_MAX_LIMIT + 1) }, { cursor: 'x' }])(
    'rejects %o',
    (query) => {
      expect(aiMessageListQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe('createAiProjectSessionSchema', () => {
  it('accepts an empty body and rejects unknown fields', () => {
    expect(createAiProjectSessionSchema.parse({})).toEqual({});
    expect(createAiProjectSessionSchema.safeParse({ title: 'Shop' }).success).toBe(false);
  });
});
