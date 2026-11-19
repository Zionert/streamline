import { describe, expect, it } from 'vitest';

import {
  estimateMessageTokens,
  estimateRequestTokens,
  estimateTokens,
  estimateToolsTokens,
  fitContext,
  MESSAGE_OVERHEAD_TOKENS,
  responseReserveTokens,
  type ContextTurnMessage,
} from './context-budget.js';
import type { LlmMessage, LlmToolDefinition } from './llm-provider.js';

describe('estimateTokens', () => {
  it('counts one token per started group of 3 characters', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
  });

  it('is conservative for Cyrillic and Polish text', () => {
    // A real tokenizer needs roughly 1 token per 2-3 Cyrillic characters.
    const ukrainian = 'Привіт, як справи з дошкою?';
    expect(estimateTokens(ukrainian)).toBe(Math.ceil(ukrainian.length / 3));
    expect(estimateTokens('Zażółć gęślą jaźń')).toBe(6);
  });
});

describe('message and request estimates', () => {
  it('adds a fixed overhead per message and counts tool calls', () => {
    expect(estimateMessageTokens({ role: 'user', content: 'abcdef' })).toBe(
      2 + MESSAGE_OVERHEAD_TOKENS,
    );
    expect(
      estimateMessageTokens({
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'c1', name: 'tool', argumentsJson: '{}' }],
      }),
    ).toBe(estimateTokens('c1tool{}') + MESSAGE_OVERHEAD_TOKENS);
    expect(estimateMessageTokens({ role: 'tool', toolCallId: 'c1', content: 'abcd' })).toBe(
      estimateTokens('abcdc1') + MESSAGE_OVERHEAD_TOKENS,
    );
  });

  it('counts tool definitions as JSON', () => {
    const tools: LlmToolDefinition[] = [{ name: 't', description: 'd', parameters: {} }];
    expect(estimateToolsTokens(undefined)).toBe(0);
    expect(estimateToolsTokens([])).toBe(0);
    expect(estimateToolsTokens(tools)).toBe(estimateTokens(JSON.stringify(tools)));
    expect(estimateRequestTokens([{ role: 'user', content: 'abc' }], tools)).toBe(
      1 + MESSAGE_OVERHEAD_TOKENS + estimateToolsTokens(tools),
    );
  });

  it('reserves a quarter of the window for the answer, at most 2048 tokens', () => {
    expect(responseReserveTokens(4000)).toBe(1000);
    expect(responseReserveTokens(16_000)).toBe(2048);
  });
});

const text = (role: 'user' | 'assistant', content: string): LlmMessage =>
  role === 'user' ? { role, content } : { role, content };

/** `count` alternating user/assistant groups, each of about `chars` characters. */
function conversation(count: number, chars = 300): LlmMessage[][] {
  return Array.from({ length: count }, (_, index) => [
    text(index % 2 === 0 ? 'user' : 'assistant', `m${String(index)} ${'x'.repeat(chars)}`),
  ]);
}

const contents = (messages: LlmMessage[]) => messages.map((message) => message.content ?? '');

describe('fitContext', () => {
  it('keeps everything when it fits', () => {
    const history = conversation(4, 10);
    const fitted = fitContext({ system: 'S', history, user: 'Q', turn: [], budget: 10_000 });
    expect(fitted.messages).toEqual([
      { role: 'system', content: 'S' },
      ...history.flat(),
      { role: 'user', content: 'Q' },
    ]);
    expect(fitted.droppedHistoryMessages).toBe(0);
    expect(fitted.estimatedTokens).toBe(estimateRequestTokens(fitted.messages));
  });

  it('keeps a 200-message conversation within the budget with the newest messages', () => {
    const history = conversation(200);
    const tools: LlmToolDefinition[] = [
      { name: 'tool', description: 'x'.repeat(300), parameters: {} },
    ];
    const budget = 2000;

    const fitted = fitContext({ system: 'System', tools, history, user: 'Now?', turn: [], budget });

    expect(estimateRequestTokens(fitted.messages, tools)).toBeLessThanOrEqual(budget);
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(budget);
    expect(fitted.messages.at(-2)?.content).toMatch(/^m199 /);
    expect(fitted.messages[1]?.role).toBe('user');
    expect(contents(fitted.messages)).not.toContain(history[0]?.[0]?.content);
    expect(fitted.droppedHistoryMessages).toBeGreaterThan(150);
  });

  it('never splits a tool-call group and starts the history with a user message', () => {
    const toolGroup: LlmMessage[] = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'c', name: 't', argumentsJson: '{}' }],
      },
      { role: 'tool', toolCallId: 'c', content: 'r'.repeat(600) },
    ];
    const history: LlmMessage[][] = [
      [text('user', 'old question')],
      toolGroup,
      [text('assistant', 'old answer')],
      [text('user', 'recent question')],
      [text('assistant', 'recent answer')],
    ];
    const smallBudget =
      estimateRequestTokens([
        { role: 'system', content: 'S' },
        { role: 'user', content: 'Q' },
        ...history.slice(2).flat(),
      ]) + 50;

    const fitted = fitContext({ system: 'S', history, user: 'Q', turn: [], budget: smallBudget });

    // The tool group does not fit whole, so it and everything older are left out; the leading
    // "old answer" whose question was dropped is left out too.
    expect(contents(fitted.messages)).toEqual(['S', 'recent question', 'recent answer', 'Q']);
  });

  it('always keeps the current turn and shrinks its oldest tool results first', () => {
    const shrinkCalls: number[] = [];
    const result = (id: string, size: number): ContextTurnMessage => ({
      message: { role: 'tool', toolCallId: id, content: id.repeat(size) },
      shrink: (maxChars) => {
        shrinkCalls.push(maxChars);
        return id.repeat(Math.min(size, maxChars));
      },
    });
    const turn: ContextTurnMessage[] = [
      {
        message: {
          role: 'assistant',
          content: null,
          toolCalls: [
            { id: 'a', name: 't', argumentsJson: '{}' },
            { id: 'b', name: 't', argumentsJson: '{}' },
          ],
        },
      },
      result('a', 3000),
      result('b', 600),
    ];

    const fitted = fitContext({
      system: 'S',
      history: conversation(10),
      user: 'Q',
      turn,
      budget: 700,
    });

    expect(fitted.estimatedTokens).toBeLessThanOrEqual(700);
    expect(fitted.shrunkToolResults).toBe(1);
    expect(shrinkCalls).toHaveLength(1);
    const tools = fitted.messages.filter((message) => message.role === 'tool');
    expect(tools.map((message) => message.toolCallId)).toEqual(['a', 'b']);
    expect(tools[0]?.content.length).toBeLessThan(3000);
    expect(tools[1]?.content).toBe('b'.repeat(600));
    expect(fitted.messages.slice(-4).map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
    ]);
    expect(fitted.droppedHistoryMessages).toBe(10);
  });
});
