import type { AiMessage } from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import { chatEntries, toolStepLabel, toolResultOk, turnFailureFor } from './assistantText';
import { aiMessage, toolMessage } from '@/test/aiFixtures';

describe('toolStepLabel', () => {
  it.each([
    ['get_board_overview', 'Read the board overview'],
    ['search_cards', 'Searched cards'],
    ['get_flow_metrics', 'Read flow metrics'],
    ['get_forecast', 'Ran the forecast'],
    ['get_card', 'Opened a card'],
    ['something_new', 'Used something_new'],
  ])('labels %s as "%s"', (name, label) => {
    expect(toolStepLabel(name)).toBe(label);
  });

  it('names the card opened by get_card from the call arguments', () => {
    expect(toolStepLabel('get_card', { key: 'sb-12' })).toBe('Opened SB-12');
    expect(toolStepLabel('get_card', { key: 7 })).toBe('Opened a card');
  });
});

describe('toolResultOk', () => {
  it('fails only for a result with ok: false', () => {
    expect(toolResultOk({ round: 1, ok: true, data: {} })).toBe(true);
    expect(toolResultOk({ round: 1, ok: false, error: 'x' })).toBe(false);
    expect(toolResultOk(null)).toBe(true);
  });
});

describe('turnFailureFor', () => {
  it('maps the error codes of the stream to messages', () => {
    expect(turnFailureFor('q', 'AI_PROVIDER_BUSY', 'raw')).toEqual({
      question: 'q',
      message: 'The assistant is busy right now. Please try again in a moment.',
      canRetry: true,
    });
    expect(turnFailureFor('q', 'AI_INVALID_OUTPUT', 'The model answered badly.').message).toBe(
      'The model answered badly.',
    );
    for (const code of ['AI_PROVIDER_ERROR', 'AI_INTERNAL_ERROR', 'UNKNOWN']) {
      expect(turnFailureFor('q', code, 'raw').message).toBe(
        'The assistant is unavailable. Please try again later.',
      );
    }
    expect(turnFailureFor('q', 'AI_CONVERSATION_CLEARED', 'raw')).toEqual({
      question: 'q',
      message: 'The conversation was cleared.',
      canRetry: false,
    });
  });
});

describe('chatEntries', () => {
  it('attaches tool rows as steps of the answer that follows them', () => {
    const messages: AiMessage[] = [
      aiMessage({ id: 'u1', role: 'USER', content: 'Q1' }),
      toolMessage({ id: 't1', toolName: 'get_card', toolArgs: { key: 'SB-3' } }),
      toolMessage({
        id: 't2',
        toolName: 'search_cards',
        toolResult: { round: 1, ok: false, error: 'x' },
      }),
      aiMessage({ id: 'a1', role: 'ASSISTANT', content: 'A1' }),
      aiMessage({ id: 'u2', role: 'USER', content: 'Q2' }),
      aiMessage({ id: 'a2', role: 'ASSISTANT', content: 'A2' }),
    ];

    const entries = chatEntries(messages);

    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(entries[1]).toMatchObject({
      kind: 'assistant',
      id: 'a1',
      steps: [
        { id: 't1', label: 'Opened SB-3', state: 'ok' },
        { id: 't2', label: 'Searched cards', state: 'failed' },
      ],
    });
    expect(entries[3]).toMatchObject({ kind: 'assistant', id: 'a2', steps: [] });
  });

  it('shows steps without a following answer on their own', () => {
    const entries = chatEntries([
      toolMessage({ id: 't1', toolName: 'get_forecast' }),
      aiMessage({ id: 'u1', role: 'USER', content: 'Q' }),
      toolMessage({ id: 't2', toolName: 'get_flow_metrics' }),
    ]);

    expect(entries).toMatchObject([
      { kind: 'assistant', id: 't1', message: null, steps: [{ label: 'Ran the forecast' }] },
      { kind: 'user' },
      { kind: 'assistant', id: 't2', message: null, steps: [{ label: 'Read flow metrics' }] },
    ]);
  });
});
