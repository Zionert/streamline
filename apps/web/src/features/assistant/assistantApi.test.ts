import type { AiChatEvent } from '@streamline/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetAuthStore, useAuthStore } from '@/stores/auth';
import { installFakeFetch, jsonResponse, sseEvent, sseResponse } from '@/test/fakeFetch';
import { sessionWith } from '@/test/fixtures';
import { errorBody } from '@/test/mockAdapter';

import { AssistantRequestError, streamAssistantTurn } from './assistantApi';

beforeEach(() => {
  resetAuthStore();
  useAuthStore.getState().setSession(sessionWith('token-1'));
});

async function collect(chunks: string[]) {
  const fetch = installFakeFetch();
  fetch.respond(() => sseResponse(chunks));
  const events: AiChatEvent[] = [];
  const end = await streamAssistantTurn('conv-1', 'Q', {
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });
  return { end, events, fetch };
}

const done = sseEvent('done', { messages: [], usage: { promptTokens: 0, completionTokens: 0 } });

describe('streamAssistantTurn', () => {
  it('validates events and skips unknown, malformed and invalid ones', async () => {
    const { end, events } = await collect([
      sseEvent('delta', { text: 'a' }) +
        'event: delta\ndata: not json\n\n' +
        sseEvent('delta', { text: 7 }) +
        sseEvent('ping', {}) +
        ': keep-alive\r\n\r\n',
      sseEvent('tool', { id: 'c1', name: 'get_card', status: 'started' }),
      done,
    ]);

    expect(end).toBe('done');
    expect(events.map((event) => event.event)).toEqual(['delta', 'tool', 'done']);
  });

  it('ignores anything after the final event', async () => {
    const { end, events } = await collect([done + sseEvent('delta', { text: 'late' })]);

    expect(end).toBe('done');
    expect(events).toHaveLength(1);
  });

  it('reports an error event and a stream ending early', async () => {
    expect((await collect([sseEvent('error', { code: 'X', message: 'm' })])).end).toBe('error');
    expect((await collect([sseEvent('delta', { text: 'a' })])).end).toBe('incomplete');
  });

  it('reads a last event without the closing blank line', async () => {
    const { end } = await collect([done.trimEnd()]);

    expect(end).toBe('done');
  });

  it('rejects with the status and code of an error before the stream', async () => {
    const fetch = installFakeFetch();
    fetch.respond(() => jsonResponse(429, errorBody('AI_LIMIT_REACHED', 'Limit')));

    const error = await streamAssistantTurn('conv-1', 'Q', {
      signal: new AbortController().signal,
      onEvent: () => undefined,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AssistantRequestError);
    expect(error).toMatchObject({ status: 429, code: 'AI_LIMIT_REACHED', message: 'Limit' });
  });

  it('rejects without a status when the server is unreachable', async () => {
    const fetch = installFakeFetch();
    fetch.respond(() => 'network-error');

    const error = await streamAssistantTurn('conv-1', 'Q', {
      signal: new AbortController().signal,
      onEvent: () => undefined,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'AssistantRequestError', status: undefined });
  });

  it('uses a token refreshed by another request instead of refreshing again', async () => {
    const fetch = installFakeFetch();
    fetch.respond(
      () => {
        // Another request refreshed the session while this one was on its way.
        useAuthStore.getState().setSession(sessionWith('token-2'));
        return jsonResponse(401, errorBody('UNAUTHORIZED'));
      },
      () => sseResponse([done]),
    );

    const end = await streamAssistantTurn('conv-1', 'Q', {
      signal: new AbortController().signal,
      onEvent: () => undefined,
    });

    expect(end).toBe('done');
    expect(fetch.calls.map((call) => call.headers.get('Authorization'))).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });
});
