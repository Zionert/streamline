import { afterEach, describe, expect, it, vi } from 'vitest';

import { LlmError } from './ai-errors.js';
import type { LlmEvent } from './llm-provider.js';
import { MockLlmProvider } from './mock-llm-provider.js';

async function collect(events: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const result: LlmEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

const request = { messages: [{ role: 'user' as const, content: 'Hi' }] };

describe('MockLlmProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers each call with the next scripted scenario', async () => {
    const provider = new MockLlmProvider([
      MockLlmProvider.text('Hel', 'lo'),
      MockLlmProvider.toolCall('get_board_summary', { boardKey: 'WEB' }),
    ]);

    expect(await collect(provider.streamChat(request))).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(await collect(provider.streamChat(request))).toEqual([
      {
        type: 'tool-call',
        id: 'call_1',
        name: 'get_board_summary',
        argumentsJson: '{"boardKey":"WEB"}',
      },
      { type: 'done', finishReason: 'tool_calls' },
    ]);
    expect(provider.pendingScenarios).toBe(0);
  });

  it('records a copy of every request', async () => {
    const provider = new MockLlmProvider([MockLlmProvider.text('ok')]);
    const tools = [{ name: 't', description: 'd', parameters: { type: 'object' } }];
    const messages = [{ role: 'user' as const, content: 'Hi' }];

    await collect(
      provider.streamChat({
        messages,
        tools,
        temperature: 0,
        reasoningEffort: 'medium',
        signal: new AbortController().signal,
      }),
    );
    messages.push({ role: 'user', content: 'changed later' });

    expect(provider.requests).toEqual([
      {
        messages: [{ role: 'user', content: 'Hi' }],
        tools,
        temperature: 0,
        reasoningEffort: 'medium',
        hasSignal: true,
      },
    ]);
  });

  it('yields the events and then throws the scripted error', async () => {
    const provider = new MockLlmProvider([
      {
        events: [{ type: 'text-delta', text: 'partial' }],
        error: new LlmError('LLM_UNAVAILABLE', 'down'),
      },
    ]);
    const seen: LlmEvent[] = [];

    await expect(
      (async () => {
        for await (const event of provider.streamChat(request)) seen.push(event);
      })(),
    ).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
    expect(seen).toEqual([{ type: 'text-delta', text: 'partial' }]);
  });

  it('waits for the scripted delay and fails with LLM_ABORTED when aborted meanwhile', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const delayed = new MockLlmProvider([{ ...MockLlmProvider.text('late'), delayMs: 1000 }]);
    const result = collect(delayed.streamChat(request));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toHaveLength(2);

    const controller = new AbortController();
    const aborted = new MockLlmProvider([{ ...MockLlmProvider.text('never'), delayMs: 1000 }]);
    const pending = collect(aborted.streamChat({ ...request, signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'LLM_ABORTED' });
  });

  it('fails clearly when no scenario is left', async () => {
    const provider = new MockLlmProvider().enqueue(MockLlmProvider.text('only one'));
    await collect(provider.streamChat(request));

    await expect(collect(provider.streamChat(request))).rejects.toThrow(/no scripted scenario/);
  });
});
