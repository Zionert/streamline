import { describe, expect, it } from 'vitest';

import {
  AI_CHAT_EVENT_NAMES,
  AI_MESSAGES_PAGE_DEFAULT_LIMIT,
  AI_USER_MESSAGE_MAX_LENGTH,
  AI_MESSAGES_PAGE_MAX_LIMIT,
  aiBoardConversationResponseSchema,
  aiMessageListQuerySchema,
  aiMessageSchema,
  aiStatusResponseSchema,
  createAiProjectSessionSchema,
  parseAiChatEvent,
  sendAiMessageSchema,
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

describe('sendAiMessageSchema', () => {
  it('trims the message and accepts up to the maximum length', () => {
    expect(sendAiMessageSchema.parse({ content: '  Hi  ' })).toEqual({ content: 'Hi' });
    const longest = 'x'.repeat(AI_USER_MESSAGE_MAX_LENGTH);
    expect(sendAiMessageSchema.parse({ content: ` ${longest} ` }).content).toBe(longest);
  });

  it.each([
    {},
    { content: '' },
    { content: '   ' },
    { content: 'x'.repeat(AI_USER_MESSAGE_MAX_LENGTH + 1) },
    { content: 42 },
    { content: 'Hi', boardId: 'board-1' },
  ])('rejects %o', (body) => {
    expect(sendAiMessageSchema.safeParse(body).success).toBe(false);
  });
});

describe('parseAiChatEvent', () => {
  it('parses every event of a chat turn', () => {
    expect(parseAiChatEvent('delta', { text: 'Hel' })).toEqual({
      event: 'delta',
      data: { text: 'Hel' },
    });
    expect(parseAiChatEvent('tool', { id: 'c1', name: 'get_card', status: 'started' })).toEqual({
      event: 'tool',
      data: { id: 'c1', name: 'get_card', status: 'started' },
    });
    expect(
      parseAiChatEvent('tool', { id: 'c1', name: 'get_card', status: 'finished', ok: false }),
    ).toMatchObject({ data: { ok: false } });
    expect(
      parseAiChatEvent('done', {
        messages: [validMessage],
        usage: { promptTokens: 10, completionTokens: 2 },
      }),
    ).toMatchObject({ event: 'done', data: { messages: [validMessage] } });
    expect(parseAiChatEvent('error', { code: 'AI_PROVIDER_BUSY', message: 'Busy' })).toEqual({
      event: 'error',
      data: { code: 'AI_PROVIDER_BUSY', message: 'Busy' },
    });
  });

  it.each([
    ['unknown', { text: 'x' }],
    ['toString', {}],
    ['delta', { text: 1 }],
    ['tool', { id: 'c1', name: 'get_card', status: 'running' }],
    ['done', { messages: [], usage: { promptTokens: -1, completionTokens: 0 } }],
    ['error', { code: 'X' }],
  ])('rejects the event %s with %o', (name, data) => {
    expect(parseAiChatEvent(name, data)).toBeNull();
  });

  it('lists the event names', () => {
    expect(AI_CHAT_EVENT_NAMES).toEqual(['delta', 'tool', 'done', 'error']);
  });
});
