import { describe, expect, it } from 'vitest';

import { LlmError } from './ai-errors.js';
import type { LlmEvent } from './llm-provider.js';
import {
  OpenAIStreamAssembler,
  extractProviderErrorMessage,
  sanitizeProviderText,
  type LlmStreamDiagnostic,
} from './openai-stream.js';

function chunk(delta: Record<string, unknown>, finishReason: string | null = null, index = 0) {
  return JSON.stringify({ choices: [{ index, delta, finish_reason: finishReason }] });
}

function run(assembler: OpenAIStreamAssembler, ...payloads: string[]): LlmEvent[] {
  return [...payloads.flatMap((payload) => assembler.accept(payload)), ...assembler.finish()];
}

describe('OpenAIStreamAssembler', () => {
  it('passes text through and skips empty content', () => {
    const events = run(
      new OpenAIStreamAssembler(),
      chunk({ role: 'assistant', content: '' }),
      chunk({ content: 'Hi' }),
      chunk({ content: null }),
      chunk({}, 'stop'),
      '[DONE]',
    );

    expect(events).toEqual([
      { type: 'text-delta', text: 'Hi' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('counts reasoning chunks without emitting them', () => {
    const diagnostics: LlmStreamDiagnostic[] = [];
    const assembler = new OpenAIStreamAssembler({ onDiagnostic: (d) => diagnostics.push(d) });

    const events = run(
      assembler,
      chunk({ content: '', reasoning: 'Let me think' }),
      chunk({ reasoning_content: 'more thinking' }),
      chunk({ content: 'Answer' }, 'stop'),
    );

    expect(events).toEqual([
      { type: 'text-delta', text: 'Answer' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(assembler.reasoningChunks).toBe(2);
    expect(diagnostics).toEqual([{ type: 'reasoning-delta' }, { type: 'reasoning-delta' }]);
  });

  it('ignores choices other than the first', () => {
    expect(run(new OpenAIStreamAssembler(), chunk({ content: 'other' }, null, 1))).toEqual([
      { type: 'done', finishReason: 'other' },
    ]);
  });

  it('maps finish reasons', () => {
    const finish = (reason: string) =>
      run(new OpenAIStreamAssembler(), chunk({ content: 'x' }, reason)).at(-1);

    expect(finish('length')).toEqual({ type: 'done', finishReason: 'length' });
    expect(finish('STOP')).toEqual({ type: 'done', finishReason: 'stop' });
    expect(finish('content_filter')).toEqual({ type: 'done', finishReason: 'other' });
  });

  it('reports tool_calls when a server finishes a response with tool calls as "stop"', () => {
    const events = run(
      new OpenAIStreamAssembler(),
      chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '{}' } }] }),
      chunk({}, 'stop'),
    );

    expect(events).toEqual([
      { type: 'tool-call', id: 'a', name: 'f', argumentsJson: '{}' },
      { type: 'done', finishReason: 'tool_calls' },
    ]);
  });

  it('matches tool calls without an index by id', () => {
    const events = run(
      new OpenAIStreamAssembler(),
      chunk({ tool_calls: [{ id: 'a', function: { name: 'f', arguments: '{"x":1}' } }] }),
      chunk({ tool_calls: [{ id: 'b', function: { name: 'g', arguments: '{"y":2}' } }] }),
      chunk({}, 'tool_calls'),
    );

    expect(events.filter((event) => event.type === 'tool-call')).toEqual([
      { type: 'tool-call', id: 'a', name: 'f', argumentsJson: '{"x":1}' },
      { type: 'tool-call', id: 'b', name: 'g', argumentsJson: '{"y":2}' },
    ]);
  });

  it('starts a new call when a different id reuses an index', () => {
    const events = run(
      new OpenAIStreamAssembler(),
      chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '{}' } }] }),
      chunk({ tool_calls: [{ index: 0, id: 'b', function: { name: 'g', arguments: '{}' } }] }),
      chunk({}, 'tool_calls'),
    );

    expect(
      events
        .filter((event) => event.type === 'tool-call')
        .map((e) => e.type === 'tool-call' && e.id),
    ).toEqual(['a', 'b']);
  });

  it('accepts object arguments, defaults empty arguments to {} and generates missing ids', () => {
    const events = run(
      new OpenAIStreamAssembler(),
      chunk({
        tool_calls: [
          { index: 0, function: { name: 'f', arguments: { boardKey: 'WEB' } } },
          { index: 1, function: { name: 'g', arguments: '' } },
        ],
      }),
      chunk({}, 'tool_calls'),
    );

    expect(events.slice(0, 2)).toEqual([
      { type: 'tool-call', id: 'call_0', name: 'f', argumentsJson: '{"boardKey":"WEB"}' },
      { type: 'tool-call', id: 'call_1', name: 'g', argumentsJson: '{}' },
    ]);
  });

  it('emits tool calls of a stream that ends without a finish reason', () => {
    const events = run(
      new OpenAIStreamAssembler(),
      chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '{"x"' } }] }),
    );

    expect(events).toEqual([
      { type: 'tool-call', id: 'a', name: 'f', argumentsJson: '{"x"' },
      { type: 'done', finishReason: 'tool_calls' },
    ]);
  });

  it('rejects a tool call without a name', () => {
    const assembler = new OpenAIStreamAssembler();
    assembler.accept(chunk({ tool_calls: [{ index: 0, id: 'a', function: { arguments: '{}' } }] }));

    expect(() => assembler.accept(chunk({}, 'tool_calls'))).toThrow(
      expect.objectContaining({ code: 'LLM_BAD_RESPONSE' }),
    );
  });

  it('rejects malformed JSON and unexpected chunk shapes', () => {
    expect(() => new OpenAIStreamAssembler().accept('{"choices": [')).toThrow(LlmError);
    expect(() => new OpenAIStreamAssembler().accept('{"choices": "nope"}')).toThrow(
      expect.objectContaining({ code: 'LLM_BAD_RESPONSE' }),
    );
  });

  it('turns an error chunk into LLM_BAD_RESPONSE without the API key', () => {
    const assembler = new OpenAIStreamAssembler({ apiKey: 'sk-secret-key-123' });
    let error: unknown;
    try {
      assembler.accept(JSON.stringify({ error: { message: 'boom for sk-secret-key-123' } }));
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({
      code: 'LLM_BAD_RESPONSE',
      providerMessage: 'boom for [REDACTED]',
    });
  });

  it('emits usage once, before done', () => {
    const events = run(
      new OpenAIStreamAssembler(),
      chunk({ content: 'x' }, 'stop'),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
      '[DONE]',
    );

    expect(events.slice(1)).toEqual([
      { type: 'usage', promptTokens: 3, completionTokens: 4 },
      { type: 'done', finishReason: 'stop' },
    ]);
  });
});

describe('sanitizeProviderText', () => {
  it('removes the key, key-like tokens and bearer tokens', () => {
    expect(
      sanitizeProviderText(
        'Incorrect API key provided: sk-proj-****abcd. Key my-own-key, Bearer xyz, AIzaSyA-1_b',
        'my-own-key',
      ),
    ).toBe('Incorrect API key provided: [REDACTED] Key [REDACTED], Bearer [REDACTED] [REDACTED]');
  });

  it('collapses whitespace and truncates long text', () => {
    expect(sanitizeProviderText('a\n\n  b')).toBe('a b');
    expect(sanitizeProviderText('x'.repeat(500))).toHaveLength(301);
  });
});

describe('extractProviderErrorMessage', () => {
  it('reads OpenAI, Gemini and plain error bodies', () => {
    expect(extractProviderErrorMessage({ error: { message: 'openai' } })).toBe('openai');
    expect(extractProviderErrorMessage([{ error: { code: 400, message: 'gemini' } }])).toBe(
      'gemini',
    );
    expect(extractProviderErrorMessage({ error: 'ollama' })).toBe('ollama');
    expect(extractProviderErrorMessage({ message: 'plain' })).toBe('plain');
    expect(extractProviderErrorMessage(42)).toBeUndefined();
  });
});
