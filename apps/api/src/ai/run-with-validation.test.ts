import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AI_INVALID_OUTPUT_MESSAGE, AiValidationError, LlmError } from './ai-errors.js';
import type { LlmEvent, LlmRequest } from './llm-provider.js';
import { MockLlmProvider } from './mock-llm-provider.js';
import {
  collectResponse,
  formatValidationFeedback,
  jsonText,
  runWithValidation,
  toolCallArguments,
} from './run-with-validation.js';

const cardSchema = z.object({
  title: z.string().min(1),
  estimateDays: z.number().positive(),
});

const request: LlmRequest = {
  messages: [
    { role: 'system', content: 'You plan projects.' },
    { role: 'user', content: 'Add a card for the login tests, 2 days.' },
  ],
  tools: [
    { name: 'create_card', description: 'Creates a card', parameters: z.toJSONSchema(cardSchema) },
  ],
};

const withUsage = (
  scenario: ReturnType<typeof MockLlmProvider.toolCall>,
  promptTokens: number,
  completionTokens: number,
) => {
  const events = [...(scenario.events ?? [])];
  events.splice(events.length - 1, 0, { type: 'usage', promptTokens, completionTokens });
  return { events };
};

describe('runWithValidation', () => {
  it('returns the value validated on the first attempt', async () => {
    const provider = new MockLlmProvider([
      withUsage(
        MockLlmProvider.toolCall('create_card', { title: 'Login tests', estimateDays: 2 }),
        50,
        10,
      ),
    ]);

    const result = await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: toolCallArguments('create_card'),
    });

    expect(result).toMatchObject({
      value: { title: 'Login tests', estimateDays: 2 },
      attempts: 1,
      usage: { promptTokens: 50, completionTokens: 10 },
    });
    expect(provider.requests).toHaveLength(1);
  });

  it('sends the validation errors back once and returns the corrected value', async () => {
    const provider = new MockLlmProvider([
      withUsage(
        MockLlmProvider.toolCall('create_card', { title: '', estimateDays: '2' }, 'call_bad'),
        50,
        10,
      ),
      withUsage(
        MockLlmProvider.toolCall('create_card', { title: 'Login tests', estimateDays: 2 }),
        80,
        12,
      ),
    ]);

    const result = await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: toolCallArguments('create_card'),
    });

    expect(result).toMatchObject({
      value: { title: 'Login tests', estimateDays: 2 },
      attempts: 2,
      usage: { promptTokens: 130, completionTokens: 22 },
    });
    // The retry repeats the conversation, then the invalid call and its error as the tool result.
    expect(provider.requests[1]?.tools).toEqual(request.tools);
    expect(provider.requests[1]?.messages).toEqual([
      ...request.messages,
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          { id: 'call_bad', name: 'create_card', argumentsJson: '{"title":"","estimateDays":"2"}' },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'call_bad',
        content: [
          'The arguments of your call to "create_card" are invalid:',
          '- title: Too small: expected string to have >=1 characters',
          '- estimateDays: Invalid input: expected number, received string',
          'Call "create_card" again with corrected arguments that match its parameters schema.',
        ].join('\n'),
      },
    ]);
  });

  it('throws AiValidationError when the second attempt is invalid too', async () => {
    const provider = new MockLlmProvider([
      withUsage(MockLlmProvider.toolCall('create_card', '{"title": "Login tests", '), 50, 10),
      withUsage(MockLlmProvider.toolCall('create_card', { title: 'Login tests' }), 80, 12),
    ]);

    const error = await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: toolCallArguments('create_card'),
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AiValidationError);
    expect(error).toMatchObject({
      code: 'AI_INVALID_OUTPUT',
      statusCode: 502,
      message: AI_INVALID_OUTPUT_MESSAGE,
      issues: [
        { path: 'estimateDays', message: 'Invalid input: expected number, received undefined' },
      ],
      usage: { promptTokens: 130, completionTokens: 22 },
    });
    // The first feedback reported the broken JSON.
    const feedback = provider.requests[1]?.messages.at(-1);
    expect(feedback).toMatchObject({ role: 'tool', toolCallId: 'call_1' });
    expect(feedback?.content).toMatch(
      /^The arguments of your call to "create_card" are invalid:\n- \(root\): Invalid JSON \(/,
    );
    expect(provider.pendingScenarios).toBe(0);
  });

  it('repeats only JSON object arguments in the assistant message of the retry', async () => {
    const provider = new MockLlmProvider([
      {
        events: [
          { type: 'tool-call', id: 'a', name: 'create_card', argumentsJson: '{"title": "Lo' },
          { type: 'tool-call', id: 'b', name: 'get_board_summary', argumentsJson: '[1]' },
          { type: 'tool-call', id: 'c', name: 'search_cards', argumentsJson: '{"query":"x"}' },
          { type: 'done', finishReason: 'tool_calls' },
        ],
      },
      MockLlmProvider.toolCall('create_card', { title: 'x', estimateDays: 1 }),
    ]);

    await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: toolCallArguments('create_card'),
    });

    const assistant = provider.requests[1]?.messages[request.messages.length];
    expect(assistant).toEqual({
      role: 'assistant',
      content: null,
      toolCalls: [
        { id: 'a', name: 'create_card', argumentsJson: '{}' },
        { id: 'b', name: 'get_board_summary', argumentsJson: '{}' },
        { id: 'c', name: 'search_cards', argumentsJson: '{"query":"x"}' },
      ],
    });
    // Every echoed argument string is a JSON object, as Ollama and Gemini require.
    for (const call of assistant?.role === 'assistant' ? (assistant.toolCalls ?? []) : []) {
      const parsed: unknown = JSON.parse(call.argumentsJson);
      expect(parsed).toBeTypeOf('object');
      expect(Array.isArray(parsed)).toBe(false);
    }
    // The broken text is still quoted in the feedback for the invalid call.
    expect(provider.requests[1]?.messages.at(-3)).toMatchObject({ role: 'tool', toolCallId: 'a' });
  });

  it('keeps the text of the invalid response next to its tool calls', async () => {
    const provider = new MockLlmProvider([
      {
        events: [
          { type: 'text-delta', text: 'Adding it.' },
          { type: 'tool-call', id: 'a', name: 'create_card', argumentsJson: '{}' },
          { type: 'done', finishReason: 'tool_calls' },
        ],
      },
      MockLlmProvider.toolCall('create_card', { title: 'x', estimateDays: 1 }),
    ]);

    await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: toolCallArguments('create_card'),
    });

    expect(provider.requests[1]?.messages[request.messages.length]).toMatchObject({
      role: 'assistant',
      content: 'Adding it.',
    });
  });

  it('leaves out an empty assistant message when the expected tool call is missing', async () => {
    const provider = new MockLlmProvider([
      MockLlmProvider.toolCall('get_board_summary', {}),
      MockLlmProvider.toolCall('create_card', { title: 'x', estimateDays: 1 }),
    ]);

    await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: toolCallArguments('create_card'),
    });

    const retryMessages = provider.requests[1]?.messages ?? [];
    expect(retryMessages.slice(request.messages.length)).toEqual([
      {
        role: 'user',
        content: [
          'Your previous output is invalid:',
          '- (root): The expected output is missing. Call the tool "create_card".',
          'Respond again with the corrected output only, exactly in the required format.',
        ].join('\n'),
      },
    ]);
    expect(retryMessages.some((m) => m.role === 'assistant' && !m.content)).toBe(false);
  });

  it('attaches the usage of the first attempt to a provider error on the retry', async () => {
    const provider = new MockLlmProvider([
      withUsage(MockLlmProvider.toolCall('create_card', { title: '' }), 50, 10),
      MockLlmProvider.failure(new LlmError('LLM_TIMEOUT', 'slow')),
    ]);

    const error = await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: toolCallArguments('create_card'),
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({
      code: 'LLM_TIMEOUT',
      usage: { promptTokens: 50, completionTokens: 10 },
    });
  });

  it('answers every tool call of the invalid response', async () => {
    const provider = new MockLlmProvider([
      {
        events: [
          { type: 'tool-call', id: 'a', name: 'get_board_summary', argumentsJson: '{}' },
          { type: 'tool-call', id: 'b', name: 'create_card', argumentsJson: '{}' },
          { type: 'done', finishReason: 'tool_calls' },
        ],
      },
      MockLlmProvider.toolCall('create_card', { title: 'x', estimateDays: 1 }),
    ]);

    await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: toolCallArguments('create_card'),
    });

    expect(provider.requests[1]?.messages.slice(-2)).toEqual([
      {
        role: 'tool',
        toolCallId: 'a',
        content: 'Not executed, because another tool call in this response was invalid.',
      },
      expect.objectContaining({ role: 'tool', toolCallId: 'b' }),
    ]);
  });

  it('asks for the missing tool call with a user message', async () => {
    const provider = new MockLlmProvider([
      MockLlmProvider.text('Sure, I will add it.'),
      MockLlmProvider.toolCall('create_card', { title: 'x', estimateDays: 1 }),
    ]);

    const result = await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: toolCallArguments('create_card'),
    });

    expect(result.attempts).toBe(2);
    expect(provider.requests[1]?.messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'Sure, I will add it.' },
      {
        role: 'user',
        content: [
          'Your previous output is invalid:',
          '- (root): The expected output is missing. Call the tool "create_card".',
          'Respond again with the corrected output only, exactly in the required format.',
        ].join('\n'),
      },
    ]);
  });

  it('validates JSON given as text, also inside a code fence', async () => {
    const provider = new MockLlmProvider([
      MockLlmProvider.text('```json\n{"title":"A","estimateDays":3}\n```'),
    ]);

    const result = await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: jsonText,
    });

    expect(result.value).toEqual({ title: 'A', estimateDays: 3 });
  });

  it('passes provider errors through without retrying', async () => {
    const provider = new MockLlmProvider([
      MockLlmProvider.failure(new LlmError('LLM_TIMEOUT', 'slow')),
      MockLlmProvider.text('unused'),
    ]);

    await expect(
      runWithValidation({ provider, request, schema: cardSchema, extract: jsonText }),
    ).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(provider.pendingScenarios).toBe(1);
  });

  it('passes the events of each attempt to onEvent', async () => {
    const provider = new MockLlmProvider([
      MockLlmProvider.text('not json'),
      MockLlmProvider.text('{"title":"A","estimateDays":1}'),
    ]);
    const seen: [LlmEvent['type'], number][] = [];

    await runWithValidation({
      provider,
      request,
      schema: cardSchema,
      extract: jsonText,
      onEvent: (event, attempt) => seen.push([event.type, attempt]),
    });

    expect(seen).toEqual([
      ['text-delta', 1],
      ['done', 1],
      ['text-delta', 2],
      ['done', 2],
    ]);
  });
});

describe('formatValidationFeedback', () => {
  it('lists nested paths and limits the number of issues', () => {
    const issues = Array.from({ length: 12 }, (_, index) => ({
      path: `cards[${String(index)}].title`,
      message: 'Required',
    }));

    const text = formatValidationFeedback(issues);

    expect(text.split('\n')).toEqual([
      'Your previous output is invalid:',
      ...Array.from({ length: 10 }, (_, index) => `- cards[${String(index)}].title: Required`),
      '- …and 2 more',
      'Respond again with the corrected output only, exactly in the required format.',
    ]);
  });

  it('formats array and nested paths from Zod issues', async () => {
    const schema = z.object({ cards: z.array(z.object({ title: z.string() })) });
    const provider = new MockLlmProvider([
      MockLlmProvider.text('{"cards":[{"title":"ok"},{"title":5}]}'),
      MockLlmProvider.text('{"cards":[{"title":"ok"},{"title":5}]}'),
    ]);

    const error = await runWithValidation({ provider, request, schema, extract: jsonText }).catch(
      (err: unknown) => err,
    );

    expect(error).toMatchObject({
      issues: [
        { path: 'cards[1].title', message: 'Invalid input: expected string, received number' },
      ],
    });
  });
});

describe('collectResponse', () => {
  it('gathers text, tool calls, usage and the finish reason', async () => {
    const provider = new MockLlmProvider([
      {
        events: [
          { type: 'text-delta', text: 'a' },
          { type: 'text-delta', text: 'b' },
          { type: 'tool-call', id: 'x', name: 'f', argumentsJson: '{}' },
          { type: 'usage', promptTokens: 1, completionTokens: 2 },
          { type: 'done', finishReason: 'tool_calls' },
        ],
      },
    ]);

    expect(await collectResponse(provider.streamChat(request))).toEqual({
      text: 'ab',
      toolCalls: [{ id: 'x', name: 'f', argumentsJson: '{}' }],
      usage: { promptTokens: 1, completionTokens: 2 },
      finishReason: 'tool_calls',
    });
  });
});
