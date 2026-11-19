import { inspect } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFetchStub,
  hangingResponse,
  readSseFixture,
  splitAt,
  splitAtRandom,
  streamingResponse,
} from '../test/llm-fetch.js';
import { LlmError } from './ai-errors.js';
import type { LlmEvent, LlmRequest } from './llm-provider.js';
import {
  OpenAICompatibleProvider,
  chatCompletionsUrl,
  type OpenAICompatibleProviderOptions,
} from './openai-compatible-provider.js';
import { OpenAIStreamAssembler, type LlmStreamDiagnostic } from './openai-stream.js';

const API_KEY = 'sk-test-secret-0123456789';
const encoder = new TextEncoder();
const REQUEST: LlmRequest = { messages: [{ role: 'user', content: 'Hi' }] };

function createProvider(
  fetchImpl: typeof fetch,
  options: Partial<OpenAICompatibleProviderOptions> = {},
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3.5:9b',
    timeoutMs: 60_000,
    idleTimeoutMs: 30_000,
    fetch: fetchImpl,
    ...options,
  });
}

async function collect(events: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const result: LlmEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

/** Streams the pieces through the provider and returns the events. */
function streamPieces(
  pieces: Uint8Array[],
  options: Partial<OpenAICompatibleProviderOptions> = {},
): Promise<LlmEvent[]> {
  const stub = createFetchStub(() => streamingResponse(pieces));
  return collect(createProvider(stub.fetch, options).streamChat(REQUEST));
}

async function captureError(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof LlmError) return err;
    throw err;
  }
  throw new Error('Expected an LlmError');
}

const FIXTURES: { name: string; file: string; expected: LlmEvent[] }[] = [
  {
    name: 'Ollama qwen3.5 (reasoning, then one tool call)',
    file: 'ollama-qwen-tool-call.sse',
    expected: [
      {
        type: 'tool-call',
        id: 'call_b2tc3lzc',
        name: 'get_board_summary',
        argumentsJson: '{"boardKey":"WEB"}',
      },
      { type: 'usage', promptTokens: 285, completionTokens: 107 },
      { type: 'done', finishReason: 'tool_calls' },
    ],
  },
  {
    name: 'OpenAI text with usage',
    file: 'openai-text-usage.sse',
    expected: [
      ...[
        'Tablica',
        ' Kanban',
        ' pokazuje',
        ' każde',
        ' zadanie',
        ' w drodze od „Do zrobienia”',
        ' do „Gotowe”.',
      ].map((text): LlmEvent => ({ type: 'text-delta', text })),
      { type: 'usage', promptTokens: 31, completionTokens: 19 },
      { type: 'done', finishReason: 'stop' },
    ],
  },
  {
    name: 'OpenAI parallel tool calls split across chunks',
    file: 'openai-parallel-tool-calls.sse',
    expected: [
      {
        type: 'tool-call',
        id: 'call_7GxQmZ1cW4pVhN2sKe8YtR0b',
        name: 'get_board_summary',
        argumentsJson: '{"boardKey": "WEB"}',
      },
      {
        type: 'tool-call',
        id: 'call_Lp3Vd8sQwE6nJ1zXc5uB9mTa',
        name: 'search_cards',
        argumentsJson: '{"query": "logowanie użytkownika", "limit": 5}',
      },
      { type: 'usage', promptTokens: 142, completionTokens: 48 },
      { type: 'done', finishReason: 'tool_calls' },
    ],
  },
  {
    name: 'Gemini OpenAI-compatible text with usage',
    file: 'gemini-text-usage.sse',
    expected: [
      ...[
        'Час циклу — це',
        ' час від початку роботи над задачею до її завершення.',
        ' Він допомагає прогнозувати, коли команда завершить наступні задачі.',
      ].map((text): LlmEvent => ({ type: 'text-delta', text })),
      { type: 'usage', promptTokens: 17, completionTokens: 34 },
      { type: 'done', finishReason: 'stop' },
    ],
  },
  {
    name: 'Gemini OpenAI-compatible tool calls with a thought signature',
    file: 'gemini-tool-call-thought-signature.sse',
    expected: [
      {
        type: 'tool-call',
        id: 'function-call-12731964598421563478',
        name: 'get_board_overview',
        argumentsJson: '{}',
        extraContent: {
          google: { thought_signature: 'CsgBAdHtim9Q2xE7yQ0bVfL3kRj8uT1wZp==' },
        },
      },
      {
        type: 'tool-call',
        id: 'function-call-12731964598421563479',
        name: 'search_cards',
        argumentsJson: '{"limit":50}',
      },
      { type: 'usage', promptTokens: 2310, completionTokens: 21 },
      { type: 'done', finishReason: 'tool_calls' },
    ],
  },
];

describe('OpenAICompatibleProvider: recorded streams', () => {
  describe.each(FIXTURES)('$name', ({ file, expected }) => {
    const bytes = readSseFixture(file);

    it('produces the expected events from a single chunk', async () => {
      expect(await streamPieces([bytes])).toEqual(expected);
    });

    it('produces the same events when every byte arrives separately', async () => {
      expect(await streamPieces(splitAtRandom(bytes, 1, 1))).toEqual(expected);
    });

    it.each([1, 2, 3, 4, 5])(
      'produces the same events for random chunk boundaries (seed %i)',
      async (seed) => {
        expect(await streamPieces(splitAtRandom(bytes, seed))).toEqual(expected);
      },
    );

    it('produces the same events with CRLF line endings', async () => {
      const crlf = encoder.encode(new TextDecoder().decode(bytes).replace(/\n/g, '\r\n'));
      expect(await streamPieces(splitAtRandom(crlf, 7))).toEqual(expected);
    });

    it('ends normally when the stream closes without [DONE]', async () => {
      const text = new TextDecoder().decode(bytes).replace('data: [DONE]\n', '');
      expect(await streamPieces([encoder.encode(text)])).toEqual(expected);
    });
  });

  it('decodes multi-byte characters split between chunks', async () => {
    for (const [file, character] of [
      ['openai-text-usage.sse', 'ż'],
      ['gemini-text-usage.sse', 'ї'],
    ] as const) {
      const bytes = readSseFixture(file);
      const charBytes = encoder.encode(character);
      const offset = Buffer.from(bytes).indexOf(Buffer.from(charBytes));
      expect(offset).toBeGreaterThan(0);

      const events = await streamPieces(splitAt(bytes, [offset + 1]));
      const text = events.map((event) => (event.type === 'text-delta' ? event.text : '')).join('');
      expect(text).toContain(character);
      expect(text).not.toContain('�');
    }
  });

  it('never emits reasoning as text and reports it as a diagnostic', async () => {
    const diagnostics: LlmStreamDiagnostic[] = [];
    const events = await streamPieces([readSseFixture('ollama-qwen-tool-call.sse')], {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(events.some((event) => event.type === 'text-delta')).toBe(false);
    expect(diagnostics.filter((d) => d.type === 'reasoning-delta')).toHaveLength(7);
    expect(diagnostics.filter((d) => d.type === 'tool-call-delta')).toHaveLength(1);
  });

  it('ends with the text received so far when the stream is cut off', async () => {
    const events = await streamPieces([
      encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"Partial"}}]}\n\n'),
    ]);

    expect(events).toEqual([
      { type: 'text-delta', text: 'Partial' },
      { type: 'done', finishReason: 'other' },
    ]);
  });

  it('fails with LLM_BAD_RESPONSE on a malformed JSON chunk', async () => {
    const error = await captureError(
      streamPieces([
        encoder.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {oops\n\n'),
      ]),
    );

    expect(error.code).toBe('LLM_BAD_RESPONSE');
  });

  it('stops reading after [DONE]', async () => {
    const events = await streamPieces([
      encoder.encode(
        'data: {"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":"stop"}]}\n\n',
      ),
      encoder.encode('data: [DONE]\n\ndata: {not json\n\n'),
    ]);

    expect(events).toEqual([
      { type: 'text-delta', text: 'a' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });
});

describe('OpenAICompatibleProvider: request', () => {
  const okResponse = () =>
    streamingResponse([encoder.encode('data: {"choices":[]}\n\ndata: [DONE]\n\n')]);

  it.each([
    ['http://localhost:11434/v1', 'http://localhost:11434/v1/chat/completions'],
    ['http://localhost:11434/v1/', 'http://localhost:11434/v1/chat/completions'],
    [
      'https://generativelanguage.googleapis.com/v1beta/openai/',
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    ],
  ])('posts to the chat completions URL of %s', async (baseUrl, expectedUrl) => {
    const stub = createFetchStub(okResponse);
    await collect(createProvider(stub.fetch, { baseUrl }).streamChat(REQUEST));

    expect(chatCompletionsUrl(baseUrl)).toBe(expectedUrl);
    expect(stub.calls[0]).toMatchObject({ url: expectedUrl, method: 'POST' });
  });

  it('sends no Authorization header without an API key', async () => {
    const stub = createFetchStub(okResponse);
    await collect(createProvider(stub.fetch).streamChat(REQUEST));

    expect(stub.calls[0]?.headers.authorization).toBeUndefined();
    expect(stub.calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('sends the API key as a Bearer token', async () => {
    const stub = createFetchStub(okResponse);
    await collect(createProvider(stub.fetch, { apiKey: API_KEY }).streamChat(REQUEST));

    expect(stub.calls[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('sends a streamed request with the messages, tools and options in the OpenAI format', async () => {
    const stub = createFetchStub(okResponse);
    await collect(
      createProvider(stub.fetch, { reasoningEffort: 'none' }).streamChat({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Summarize WEB' },
          {
            role: 'assistant',
            content: null,
            toolCalls: [
              { id: 'call_1', name: 'get_board_summary', argumentsJson: '{"boardKey":"WEB"}' },
            ],
          },
          { role: 'tool', toolCallId: 'call_1', content: '{"cards":3}' },
        ],
        tools: [
          {
            name: 'get_board_summary',
            description: 'Summary of a board',
            parameters: { type: 'object', properties: { boardKey: { type: 'string' } } },
          },
        ],
        temperature: 0.2,
      }),
    );

    expect(stub.calls[0]?.body).toEqual({
      model: 'qwen3.5:9b',
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      reasoning_effort: 'none',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Summarize WEB' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_board_summary', arguments: '{"boardKey":"WEB"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"cards":3}' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_board_summary',
            description: 'Summary of a board',
            parameters: { type: 'object', properties: { boardKey: { type: 'string' } } },
          },
        },
      ],
      tool_choice: 'auto',
    });
  });

  it('sends extra_content back only on tool calls that carried it', async () => {
    const stub = createFetchStub(okResponse);
    const extraContent = { google: { thought_signature: 'sig-1' } };
    await collect(
      createProvider(stub.fetch).streamChat({
        messages: [
          { role: 'user', content: 'Summarize' },
          {
            role: 'assistant',
            content: null,
            toolCalls: [
              { id: 'a', name: 'get_board_overview', argumentsJson: '{}', extraContent },
              { id: 'b', name: 'search_cards', argumentsJson: '{}' },
            ],
          },
          { role: 'tool', toolCallId: 'a', content: '{}' },
          { role: 'tool', toolCallId: 'b', content: '{}' },
        ],
      }),
    );

    expect(stub.calls[0]?.body).toMatchObject({
      messages: [
        { role: 'user', content: 'Summarize' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'a',
              type: 'function',
              function: { name: 'get_board_overview', arguments: '{}' },
              extra_content: extraContent,
            },
            { id: 'b', type: 'function', function: { name: 'search_cards', arguments: '{}' } },
          ],
        },
        {},
        {},
      ],
    });
    const body = stub.calls[0]?.body as { messages: { tool_calls?: object[] }[] };
    expect(body.messages[1]?.tool_calls?.[1]).not.toHaveProperty('extra_content');
  });

  it('sends tool_choice "none" when the request asks for an answer without tool calls', async () => {
    const stub = createFetchStub(okResponse);
    await collect(
      createProvider(stub.fetch).streamChat({
        ...REQUEST,
        tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
        toolChoice: 'none',
      }),
    );

    expect(stub.calls[0]?.body).toMatchObject({
      tool_choice: 'none',
      tools: [{ type: 'function' }],
    });
  });

  it('omits tools, tool_choice, temperature and reasoning_effort when not given', async () => {
    const stub = createFetchStub(okResponse);
    await collect(createProvider(stub.fetch).streamChat(REQUEST));

    expect(stub.calls[0]?.body).not.toHaveProperty('tools');
    expect(stub.calls[0]?.body).not.toHaveProperty('tool_choice');
    expect(stub.calls[0]?.body).not.toHaveProperty('temperature');
    expect(stub.calls[0]?.body).not.toHaveProperty('reasoning_effort');
  });

  it('lets the request override the configured reasoning effort', async () => {
    const stub = createFetchStub(okResponse);
    const provider = createProvider(stub.fetch, { reasoningEffort: 'none' });

    await collect(provider.streamChat({ ...REQUEST, reasoningEffort: 'medium' }));
    await collect(provider.streamChat({ ...REQUEST, reasoningEffort: 'default' }));
    await collect(provider.streamChat(REQUEST));

    expect(stub.calls[0]?.body).toMatchObject({ reasoning_effort: 'medium' });
    expect(stub.calls[1]?.body).not.toHaveProperty('reasoning_effort');
    expect(stub.calls[2]?.body).toMatchObject({ reasoning_effort: 'none' });
  });

  it('sends no reasoning_effort when configured as "default"', async () => {
    const stub = createFetchStub(okResponse);
    await collect(createProvider(stub.fetch, { reasoningEffort: 'default' }).streamChat(REQUEST));

    expect(stub.calls[0]?.body).not.toHaveProperty('reasoning_effort');
  });

  it('aborts the request when the consumer stops reading early', async () => {
    const stub = createFetchStub((call) =>
      hangingResponse(
        [encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"a"}}]}\n\n')],
        call.signal,
      ),
    );

    for await (const event of createProvider(stub.fetch).streamChat(REQUEST)) {
      expect(event).toEqual({ type: 'text-delta', text: 'a' });
      break;
    }

    expect(stub.calls[0]?.signal?.aborted).toBe(true);
  });
});

describe('OpenAICompatibleProvider: errors', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [
      401,
      JSON.stringify({
        error: {
          message: `Incorrect API key provided: ${API_KEY}. You can find your API key at https://platform.openai.com/account/api-keys.`,
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      }),
      'Incorrect API key provided: [REDACTED]',
    ],
    [
      404,
      JSON.stringify({
        error: { message: 'model "nope" not found, try pulling it first', type: 'api_error' },
      }),
      'model "nope" not found, try pulling it first',
    ],
    [500, `Internal Server Error (key ${API_KEY})`, 'Internal Server Error (key [REDACTED])'],
  ])(
    'maps HTTP %i to LLM_HTTP_ERROR without the API key',
    async (status, body, providerMessage) => {
      const stub = createFetchStub(() => new Response(body, { status }));
      const error = await captureError(
        collect(createProvider(stub.fetch, { apiKey: API_KEY }).streamChat(REQUEST)),
      );

      expect(error).toMatchObject({
        code: 'LLM_HTTP_ERROR',
        statusCode: 502,
        providerStatus: status,
        message: `The AI provider responded with HTTP ${String(status)}`,
      });
      expect(error.providerMessage).toContain(providerMessage);
      expect(
        `${error.message} ${String(error.providerMessage)} ${JSON.stringify(error)}`,
      ).not.toContain(API_KEY);
    },
  );

  it('reads only a capped part of a large error body', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024).fill(0x61));
      },
    });
    const stub = createFetchStub(() => new Response(body, { status: 500 }));
    const error = await captureError(collect(createProvider(stub.fetch).streamChat(REQUEST)));

    expect(error.code).toBe('LLM_HTTP_ERROR');
    expect(pulls).toBeLessThan(10);
    expect((error.providerMessage ?? '').length).toBeLessThanOrEqual(301);
  });

  it('maps a refused connection to LLM_UNAVAILABLE', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
      code: 'ECONNREFUSED',
    });
    const stub = createFetchStub(() =>
      Promise.reject(new TypeError('fetch failed', { cause: refused })),
    );
    const error = await captureError(collect(createProvider(stub.fetch).streamChat(REQUEST)));

    expect(error).toMatchObject({
      code: 'LLM_UNAVAILABLE',
      statusCode: 503,
      message: 'The AI provider is unavailable.',
      providerMessage: 'Could not reach localhost:11434: fetch failed (ECONNREFUSED)',
    });
  });

  it('maps a connection lost during the stream to LLM_UNAVAILABLE', async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new TypeError('terminated'));
          return;
        }
        sent = true;
        controller.enqueue(
          encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"a"}}]}\n\n'),
        );
      },
    });
    const stub = createFetchStub(() => new Response(body));
    const error = await captureError(collect(createProvider(stub.fetch).streamChat(REQUEST)));

    expect(error.code).toBe('LLM_UNAVAILABLE');
  });

  it('times out with LLM_TIMEOUT when the response does not finish in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = createFetchStub((call) =>
      hangingResponse([encoder.encode(': still working\n\n')], call.signal),
    );
    const provider = createProvider(stub.fetch, { timeoutMs: 5_000, idleTimeoutMs: 60_000 });

    const result = captureError(collect(provider.streamChat(REQUEST)));
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await result;

    expect(error).toMatchObject({ code: 'LLM_TIMEOUT', statusCode: 504 });
    expect(error.message).toContain('5000 ms');
  });

  it('times out with LLM_TIMEOUT when the provider stops sending data', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = createFetchStub(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const provider = createProvider(stub.fetch, { timeoutMs: 60_000, idleTimeoutMs: 2_000 });

    const result = captureError(collect(provider.streamChat(REQUEST)));
    await vi.advanceTimersByTimeAsync(2_000);
    const error = await result;

    expect(error.code).toBe('LLM_TIMEOUT');
    expect(error.message).toContain('no data for 2000 ms');
  });

  it('maps a caller abort to LLM_ABORTED', async () => {
    const controller = new AbortController();
    const stub = createFetchStub((call) =>
      hangingResponse(
        [encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"a"}}]}\n\n')],
        call.signal,
      ),
    );
    const events: LlmEvent[] = [];

    const error = await captureError(
      (async () => {
        for await (const event of createProvider(stub.fetch).streamChat({
          ...REQUEST,
          signal: controller.signal,
        })) {
          events.push(event);
          controller.abort();
        }
      })(),
    );

    expect(events).toEqual([{ type: 'text-delta', text: 'a' }]);
    expect(error).toMatchObject({ code: 'LLM_ABORTED' });
    expect(stub.calls[0]?.signal?.aborted).toBe(true);
  });

  it('fails with LLM_ABORTED without calling the provider when already aborted', async () => {
    const stub = createFetchStub(() => streamingResponse([]));
    const error = await captureError(
      collect(createProvider(stub.fetch).streamChat({ ...REQUEST, signal: AbortSignal.abort() })),
    );

    expect(error.code).toBe('LLM_ABORTED');
    expect(stub.calls).toHaveLength(0);
  });
});

describe('OpenAICompatibleProvider: timers and cleanup', () => {
  const textChunk = (text: string) =>
    encoder.encode(`data: {"choices":[{"index":0,"delta":{"content":"${text}"}}]}\n\n`);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out when the provider stops sending data between two chunks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = createFetchStub((call) => hangingResponse([textChunk('a')], call.signal));
    const provider = createProvider(stub.fetch, { timeoutMs: 60_000, idleTimeoutMs: 2_000 });
    const events: LlmEvent[] = [];

    const result = captureError(
      (async () => {
        for await (const event of provider.streamChat(REQUEST)) events.push(event);
      })(),
    );
    await vi.advanceTimersByTimeAsync(1_999);
    expect(events).toEqual([{ type: 'text-delta', text: 'a' }]);
    await vi.advanceTimersByTimeAsync(1);
    const error = await result;

    expect(error.code).toBe('LLM_TIMEOUT');
    expect(error.message).toContain('no data for 2000 ms');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses the idle timeout while the consumer holds an event', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = createFetchStub(() =>
      streamingResponse([textChunk('a'), textChunk('b'), encoder.encode('data: [DONE]\n\n')]),
    );
    const provider = createProvider(stub.fetch, { timeoutMs: 60_000, idleTimeoutMs: 1_000 });
    const iterator = provider.streamChat(REQUEST)[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toEqual({ type: 'text-delta', text: 'a' });
    // Only the overall timer runs while the event is held.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);

    expect((await iterator.next()).value).toEqual({ type: 'text-delta', text: 'b' });
    expect((await iterator.next()).value).toEqual({ type: 'done', finishReason: 'other' });
    expect((await iterator.next()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still bounds the whole call, including time the consumer holds an event', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = createFetchStub((call) => hangingResponse([textChunk('a')], call.signal));
    const provider = createProvider(stub.fetch, { timeoutMs: 3_000, idleTimeoutMs: 60_000 });
    const iterator = provider.streamChat(REQUEST)[Symbol.asyncIterator]();

    await iterator.next();
    await vi.advanceTimersByTimeAsync(3_000);
    const error = await captureError(iterator.next());

    expect(error.code).toBe('LLM_TIMEOUT');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timers after success, HTTP error, abort and an early stop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const ok = createFetchStub(() => streamingResponse([readSseFixture('openai-text-usage.sse')]));
    await collect(createProvider(ok.fetch).streamChat(REQUEST));
    expect(vi.getTimerCount()).toBe(0);

    const failing = createFetchStub(() => new Response('nope', { status: 500 }));
    await captureError(collect(createProvider(failing.fetch).streamChat(REQUEST)));
    expect(vi.getTimerCount()).toBe(0);

    const controller = new AbortController();
    const hanging = createFetchStub((call) => hangingResponse([textChunk('a')], call.signal));
    await captureError(
      (async () => {
        for await (const _event of createProvider(hanging.fetch).streamChat({
          ...REQUEST,
          signal: controller.signal,
        })) {
          controller.abort();
        }
      })(),
    );
    expect(vi.getTimerCount()).toBe(0);

    const early = createFetchStub((call) => hangingResponse([textChunk('a')], call.signal));
    for await (const _event of createProvider(early.fetch).streamChat(REQUEST)) break;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the body itself when the consumer stops early', async () => {
    let cancelled = false;
    // A body that ignores the abort signal, unlike Node's fetch.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(textChunk('a'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const stub = createFetchStub(() => new Response(body));

    for await (const _event of createProvider(stub.fetch).streamChat(REQUEST)) break;

    expect(cancelled).toBe(true);
  });
});

describe('OpenAICompatibleProvider: API key storage', () => {
  it('does not expose the key when the provider or the assembler is serialized or inspected', () => {
    const provider = createProvider(createFetchStub(() => streamingResponse([])).fetch, {
      apiKey: API_KEY,
    });
    const assembler = new OpenAIStreamAssembler({ apiKey: API_KEY });

    for (const value of [provider, assembler, { llm: provider }]) {
      expect(JSON.stringify(value)).not.toContain(API_KEY);
      expect(inspect(value, { depth: 10, showHidden: true })).not.toContain(API_KEY);
    }
  });

  it('sends an assistant message without tool calls with string content', async () => {
    const stub = createFetchStub(() => streamingResponse([encoder.encode('data: [DONE]\n\n')]));
    await collect(
      createProvider(stub.fetch).streamChat({
        messages: [
          { role: 'assistant', content: null },
          { role: 'assistant', content: 'Hi', toolCalls: [] },
          {
            role: 'assistant',
            content: 'Checking.',
            toolCalls: [{ id: 'c', name: 'f', argumentsJson: '{}' }],
          },
        ],
      }),
    );

    expect((stub.calls[0]?.body as { messages: unknown[] }).messages).toEqual([
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'Hi' },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{}' } }],
      },
    ]);
  });
});
