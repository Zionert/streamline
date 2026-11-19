import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MockLlmProvider } from '../ai/mock-llm-provider.js';

import type { AiMessageRecord } from '../repositories/ai-conversation.repository.js';
import {
  buildBoardContextPreview,
  createAiChatService,
  historyGroups,
  promptBudget,
  toolMessageContent,
  utcDay,
} from './ai-chat.service.js';
import type { BoardToolSet } from './ai-tools/board-tools.js';
import { estimateRequestTokens } from '../ai/context-budget.js';

let counter = 0;

function row(overrides: Partial<AiMessageRecord>): AiMessageRecord {
  counter += 1;
  return {
    id: `m${String(counter)}`,
    conversationId: 'conv',
    role: 'USER',
    content: '',
    toolName: null,
    toolCallId: null,
    toolArgs: null,
    toolResult: null,
    createdAt: new Date(Date.UTC(2026, 10, 18, 0, 0, counter)),
    ...overrides,
  };
}

const tool = (id: string, round: number, extra: Partial<AiMessageRecord> = {}) =>
  row({
    role: 'TOOL',
    toolName: 'search_cards',
    toolCallId: id,
    toolArgs: { query: id },
    toolResult: { round, ok: true, data: { cards: [id] } },
    ...extra,
  });

describe('utcDay', () => {
  it('is the UTC calendar day at midnight', () => {
    expect(utcDay(new Date('2026-11-18T23:59:59.999Z')).toISOString()).toBe(
      '2026-11-18T00:00:00.000Z',
    );
    expect(utcDay(new Date('2026-11-19T00:30:00+02:00')).toISOString()).toBe(
      '2026-11-18T00:00:00.000Z',
    );
  });
});

describe('toolMessageContent', () => {
  it('wraps successful results as board data and reports failures as errors', () => {
    expect(toolMessageContent('get_card', { ok: true, data: { key: 'RO-1' } })).toBe(
      '<board_data tool="get_card">\n{"key":"RO-1"}\n</board_data>',
    );
    expect(toolMessageContent('get_card', { ok: false, error: 'Card RO-9 was not found.' })).toBe(
      'Error: Card RO-9 was not found.',
    );
  });
});

describe('historyGroups', () => {
  it('rebuilds one assistant tool-call message per round from the TOOL rows', () => {
    const groups = historyGroups([
      row({ role: 'USER', content: 'Question' }),
      tool('a', 1),
      tool('b', 1),
      tool('c', 2, { toolArgs: 'not json', toolResult: { round: 2, ok: false, error: 'Bad' } }),
      row({ role: 'ASSISTANT', content: 'Answer' }),
    ]);

    expect(groups).toEqual([
      [{ role: 'user', content: 'Question' }],
      [
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            { id: 'a', name: 'search_cards', argumentsJson: '{"query":"a"}' },
            { id: 'b', name: 'search_cards', argumentsJson: '{"query":"b"}' },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'a',
          content: '<board_data tool="search_cards">\n{"cards":["a"]}\n</board_data>',
        },
        {
          role: 'tool',
          toolCallId: 'b',
          content: '<board_data tool="search_cards">\n{"cards":["b"]}\n</board_data>',
        },
      ],
      [
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'c', name: 'search_cards', argumentsJson: '{}' }],
        },
        { role: 'tool', toolCallId: 'c', content: 'Error: Bad' },
      ],
      [{ role: 'assistant', content: 'Answer' }],
    ]);
  });

  it('copes with rows in another shape and skips empty answers', () => {
    const legacy = row({
      role: 'TOOL',
      toolName: null,
      toolCallId: null,
      toolResult: [{ email: 'x@example.com' }],
    });
    const groups = historyGroups([legacy, row({ role: 'ASSISTANT', content: '  ' })]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.[0]).toEqual({
      role: 'assistant',
      content: null,
      toolCalls: [{ id: `call_${legacy.id}`, name: 'unknown_tool', argumentsJson: '{}' }],
    });
    expect(groups[0]?.[1]?.content).toContain('[email hidden]');
  });
});

describe('buildBoardContextPreview', () => {
  it('builds a turn that read the overview and the card list, within the budget', async () => {
    const tools: BoardToolSet = {
      definitions: [{ name: 'get_board_overview', description: 'd', parameters: {} }],
      check: (call) => ({
        ok: true,
        run: () =>
          Promise.resolve({ ok: true, data: { tool: call.name, args: call.argumentsJson } }),
      }),
    };
    const boardService = {
      get: () =>
        Promise.resolve({
          id: 'b',
          name: 'Webshop launch',
          key: 'DEMO',
          role: 'OWNER' as const,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
        }),
    };

    const { request, estimatedTokens } = await buildBoardContextPreview({
      tools,
      boardService,
      membership: { boardId: 'b', userId: 'u', role: 'OWNER' },
      question: 'Are we on track?',
      now: new Date('2026-11-18T10:00:00.000Z'),
      contextTokens: 16_000,
    });

    const roles = request.messages.map((message) => message.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool', 'tool']);
    expect(request.messages[0]?.content).toContain('"Webshop launch" (key DEMO)');
    expect(request.messages[0]?.content).toContain('Today is 2026-11-18');
    expect(request.messages[3]?.content).toContain('get_board_overview');
    expect(request.messages[4]?.content).toContain('search_cards');
    expect(request.tools).toBe(tools.definitions);
    // Made-up calls carry the dummy signature that Gemini accepts for calls it did not produce.
    const assistant = request.messages[2];
    expect(assistant?.role === 'assistant' && assistant.toolCalls).toEqual([
      expect.objectContaining({
        name: 'get_board_overview',
        extraContent: { google: { thought_signature: 'skip_thought_signature_validator' } },
      }),
      expect.objectContaining({
        name: 'search_cards',
        extraContent: { google: { thought_signature: 'skip_thought_signature_validator' } },
      }),
    ]);
    expect(estimatedTokens).toBe(estimateRequestTokens(request.messages, request.tools));
    expect(estimatedTokens).toBeLessThanOrEqual(promptBudget(16_000));
  });
});

describe('createAiChatService', () => {
  const conversation = {
    id: 'conv',
    userId: 'u',
    kind: 'PROJECT_SESSION' as const,
    boardId: null,
    createdAt: new Date('2026-11-18T09:00:00.000Z'),
    updatedAt: new Date('2026-11-18T09:00:00.000Z'),
  };

  function setup(
    options: { onSave?: () => void; findOwned?: () => Promise<typeof conversation> } = {},
  ) {
    const order: string[] = [];
    const logs: string[] = [];
    const llm = new MockLlmProvider([MockLlmProvider.text('Answer')]);
    const logger = pino(
      { level: 'info' },
      {
        write(line: string) {
          logs.push((JSON.parse(line) as { msg: string }).msg);
        },
      },
    );
    const service = createAiChatService({
      llm,
      conversations: {
        findOwned: options.findOwned ?? (() => Promise.resolve(conversation)),
        listMessages: () => Promise.resolve([]),
        saveTurn: (_id, messages, expectedUpdatedAt) => {
          order.push(`expect:${expectedUpdatedAt.toISOString()}`);
          options.onSave?.();
          order.push('save');
          return Promise.resolve({
            status: 'saved' as const,
            rows: messages.map((message, index) =>
              row({ ...message, id: `saved-${String(index)}`, conversationId: 'conv' }),
            ),
          });
        },
      },
      usage: {
        reserveRequest: () => {
          order.push('reserve');
          return Promise.resolve({ status: 'reserved' as const });
        },
        addTokens: () => {
          order.push('tokens');
          return Promise.resolve();
        },
      },
      boardAccess: { require: () => Promise.reject(new Error('not used')) },
      boardService: { get: () => Promise.reject(new Error('not used')) },
      tools: { definitions: [], check: () => ({ ok: false, issues: [] }) },
      logger,
      limits: { requests: 10, tokens: 1000 },
      contextTokens: 16_000,
    });
    const sink = {
      send: (event: string) => {
        order.push(event);
      },
    };
    return { service, llm, order, logs, sink };
  }

  const turn = { userId: 'u', conversationId: 'conv', input: { content: 'Hi' } };

  it('records the tokens before sending done', async () => {
    const { service, sink, order } = setup();
    await service.runTurn({ ...turn, signal: new AbortController().signal, open: () => sink });
    expect(order).toEqual([
      'reserve',
      'delta',
      `expect:${conversation.updatedAt.toISOString()}`,
      'save',
      'tokens',
      'done',
    ]);
  });

  it('reads updatedAt again after taking the lock, so a just-finished turn is no clear', async () => {
    const later = { ...conversation, updatedAt: new Date('2026-11-18T09:05:00.000Z') };
    const reads = [conversation, later];
    const { service, sink, order } = setup({
      findOwned: () => Promise.resolve(reads.shift() ?? later),
    });

    await service.runTurn({ ...turn, signal: new AbortController().signal, open: () => sink });

    expect(order).toContain(`expect:${later.updatedAt.toISOString()}`);
    expect(order.at(-1)).toBe('done');
  });

  it('uses no daily request when the client left before the turn started', async () => {
    const { service, sink, order, llm, logs } = setup();
    const abort = new AbortController();
    abort.abort();
    const open = vi.fn(() => sink);

    await service.runTurn({ ...turn, signal: abort.signal, open });

    expect(open).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    expect(llm.requests).toHaveLength(0);
    expect(logs).toContain('AI turn cancelled by the client before it started');
  });

  it('keeps and logs a turn whose client disconnected while it was being saved', async () => {
    const abort = new AbortController();
    const { service, sink, order, logs } = setup({ onSave: () => abort.abort() });

    await service.runTurn({ ...turn, signal: abort.signal, open: () => sink });

    expect(order).toEqual([
      'reserve',
      'delta',
      `expect:${conversation.updatedAt.toISOString()}`,
      'save',
      'tokens',
    ]);
    expect(logs).toContain('AI turn saved after the client disconnected');
  });
});
