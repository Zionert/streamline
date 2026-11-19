import { describe, expect, it } from 'vitest';

import { aiMessage } from '@/test/aiFixtures';

import { chatReducer, initialChatState, type ChatAction, type ChatState } from './chatState';

function run(actions: ChatAction[], state: ChatState = initialChatState): ChatState {
  return actions.reduce(chatReducer, state);
}

const ready: ChatState = run([
  { type: 'loaded', conversationId: 'conv-1', messages: [], nextCursor: null },
]);

describe('chatReducer', () => {
  it('pairs tool events by id and appends deltas to the live turn', () => {
    const state = run(
      [
        { type: 'turnStarted', question: 'Q' },
        { type: 'tool', event: { id: 'c1', name: 'search_cards', status: 'started' } },
        { type: 'tool', event: { id: 'c2', name: 'get_card', status: 'started' } },
        { type: 'tool', event: { id: 'c1', name: 'search_cards', status: 'finished', ok: true } },
        { type: 'tool', event: { id: 'c2', name: 'get_card', status: 'finished', ok: false } },
        { type: 'delta', text: 'Hel' },
        { type: 'delta', text: 'lo' },
      ],
      ready,
    );

    expect(state.turn).toEqual({
      question: 'Q',
      text: 'Hello',
      steps: [
        { id: 'c1', label: 'Searched cards', state: 'ok' },
        { id: 'c2', label: 'Opened a card', state: 'failed' },
      ],
    });
  });

  it('replaces the live turn with the saved messages on done and announces the answer', () => {
    const saved = [
      aiMessage({ id: 'u1', role: 'USER', content: 'Q' }),
      aiMessage({ id: 'a1', role: 'ASSISTANT', content: 'Answer' }),
    ];
    const state = run(
      [
        { type: 'turnStarted', question: 'Q' },
        { type: 'delta', text: 'Answer' },
        { type: 'done', messages: saved },
      ],
      ready,
    );

    expect(state.turn).toBeNull();
    expect(state.messages).toEqual(saved);
    expect(state.announcement).toBe('Answer');
  });

  it('puts the question back into an empty input when stopped, but keeps new typing', () => {
    const stopped = run([{ type: 'turnStarted', question: 'Q' }, { type: 'turnStopped' }], ready);
    expect(stopped).toMatchObject({ turn: null, stopped: true, draft: 'Q' });

    const typed = run(
      [
        { type: 'turnStarted', question: 'Q' },
        { type: 'draftChanged', draft: 'next' },
        { type: 'turnRejected' },
      ],
      ready,
    );
    expect(typed.draft).toBe('next');
  });

  it('prepends earlier messages without duplicates', () => {
    const state = run([
      {
        type: 'loaded',
        conversationId: 'conv-1',
        messages: [aiMessage({ id: 'm2' }), aiMessage({ id: 'm3' })],
        nextCursor: 'c',
      },
      { type: 'earlierStarted' },
      {
        type: 'earlierLoaded',
        messages: [aiMessage({ id: 'm1' }), aiMessage({ id: 'm2' })],
        nextCursor: null,
      },
    ]);

    expect(state.messages.map((message) => message.id)).toEqual(['m1', 'm2', 'm3']);
    expect(state).toMatchObject({ nextCursor: null, isLoadingEarlier: false });
  });

  it('clears the messages and the notices', () => {
    const state = run([
      {
        type: 'loaded',
        conversationId: 'conv-1',
        messages: [aiMessage({ id: 'm1' })],
        nextCursor: 'c',
      },
      { type: 'turnStarted', question: 'Q' },
      { type: 'turnFailed', failure: { question: 'Q', message: 'x', canRetry: true } },
      { type: 'cleared' },
    ]);

    expect(state).toMatchObject({ messages: [], nextCursor: null, failure: null, stopped: false });
  });
});
