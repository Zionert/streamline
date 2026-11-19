import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import {
  aiConversationWith,
  aiMessage,
  boardConversationPage,
  toolMessage,
} from '@/test/aiFixtures';
import {
  aiEnabled,
  ask,
  assistantButton,
  CONVERSATION_URL,
  messageInput,
  openPanel,
  renderBoardWithAssistant,
  TURN_URL,
} from '@/test/assistant';
import {
  controlledStream,
  installFakeFetch,
  jsonResponse,
  sseEvent,
  sseResponse,
} from '@/test/fakeFetch';
import {
  boardWith,
  cardListFor,
  cardWith,
  defaultColumns,
  memberWith,
  sessionWith,
} from '@/test/fixtures';
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
import { setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

const savedTurn = (question: string, answer: string) => [
  aiMessage({ id: 'u-saved', role: 'USER', content: question }),
  toolMessage({ id: 't-saved', toolName: 'get_flow_metrics' }),
  aiMessage({ id: 'a-saved', role: 'ASSISTANT', content: answer }),
];

const doneEvent = (question: string, answer: string) =>
  sseEvent('done', {
    messages: savedTurn(question, answer),
    usage: { promptTokens: 10, completionTokens: 5 },
  });

async function setup(options: Parameters<typeof renderBoardWithAssistant>[1] = {}) {
  aiEnabled(mock.current);
  const fetch = installFakeFetch();
  const result = await renderBoardWithAssistant(mock.current, options);
  return { fetch, ...result };
}

describe('assistant panel: layout and state', () => {
  it('opens from the top bar, loads the conversation and focuses the input', async () => {
    await setup();

    const panel = await openPanel();

    expect(assistantButton()).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByRole('heading', { name: 'Assistant' })).toBeInTheDocument();
    expect(within(panel).getByText('test-model')).toBeInTheDocument();
    expect(await within(panel).findByText('Ask about this board')).toBeInTheDocument();
    expect(messageInput(panel)).toHaveFocus();
    expect(messageInput(panel)).toHaveAttribute('placeholder', 'Ask about this board…');
    expect(within(panel).getByText('Answers can be inaccurate.')).toBeInTheDocument();
    expect(window.localStorage.getItem('streamline-assistant-open')).toBe('true');
    expect(mock.current.requestsTo('GET', CONVERSATION_URL)[0]?.params).toEqual({ limit: 30 });
    // The board stays usable next to the panel.
    expect(screen.getByRole('region', { name: 'Backlog' })).toBeInTheDocument();
  });

  it('shows only the title in the empty conversation, without suggested questions', async () => {
    await setup();
    const panel = await openPanel();

    expect(await within(panel).findByText('Ask about this board')).toBeInTheDocument();
    expect(within(panel).queryByRole('list', { name: 'Suggested questions' })).toBeNull();
  });

  it('closes with Escape and gives the focus back to the Assistant button', async () => {
    await setup();
    const panel = await openPanel();

    fireEvent.keyDown(messageInput(panel), { key: 'Escape' });

    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
    expect(assistantButton()).toHaveFocus();
    expect(assistantButton()).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('streamline-assistant-open')).toBe('false');
  });

  it('closes with the Close button', async () => {
    await setup();
    const panel = await openPanel();

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
    expect(assistantButton()).toHaveFocus();
  });

  it('stays open on the Flow page of the same board without reloading the conversation', async () => {
    const { router } = await setup();
    await openPanel();

    await act(async () => {
      await router.navigate('/boards/board-1/flow');
    });

    expect(screen.getByRole('complementary', { name: 'Assistant' })).toBeInTheDocument();
    expect(mock.current.requestsTo('GET', CONVERSATION_URL)).toHaveLength(1);
  });

  it('shows that the conversation is gone after a 404', async () => {
    mock.current.on('GET', CONVERSATION_URL, { status: 404, data: errorBody('NOT_FOUND') });
    await setup({ conversation: false });

    fireEvent.click(await screen.findByRole('button', { name: 'Assistant' }));

    const panel = await screen.findByRole('complementary', { name: 'Assistant' });
    expect(
      await within(panel).findByText('This conversation is no longer available.'),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('log')).toBeNull();
    expect(messageInput(panel)).toBeDisabled();
  });

  it('offers a retry when the conversation cannot be loaded', async () => {
    mock.current.on(
      'GET',
      CONVERSATION_URL,
      { status: 500, data: errorBody('INTERNAL_ERROR') },
      { status: 200, data: boardConversationPage() },
    );
    await setup({ conversation: false });
    const panel = await openPanel();

    fireEvent.click(await within(panel).findByRole('button', { name: 'Retry' }));

    expect(await within(panel).findByText('Ask about this board')).toBeInTheDocument();
  });
});

describe('assistant panel: history', () => {
  it('shows saved messages with tool rows as steps and loads earlier messages', async () => {
    mock.current.on('GET', CONVERSATION_URL, {
      status: 200,
      data: boardConversationPage(
        [
          aiMessage({ id: 'u2', role: 'USER', content: 'Which cards are late?' }),
          toolMessage({ id: 't1', toolName: 'get_card', toolArgs: { key: 'SB-4' } }),
          toolMessage({
            id: 't2',
            toolName: 'search_cards',
            toolResult: { round: 1, ok: false, error: 'bad' },
          }),
          aiMessage({ id: 'a2', role: 'ASSISTANT', content: 'Two cards are late.' }),
        ],
        'cursor-1',
      ),
    });
    mock.current.on('GET', '/ai/conversations/conv-1/messages', {
      status: 200,
      data: {
        messages: [
          aiMessage({ id: 'u1', role: 'USER', content: 'Hello there' }),
          aiMessage({ id: 'a1', role: 'ASSISTANT', content: 'Hi! Ask me about the board.' }),
        ],
        nextCursor: null,
      },
    });
    await setup({ conversation: false });
    const panel = await openPanel();
    const log = within(panel).getByRole('log');

    expect(await within(log).findByText('Two cards are late.')).toBeInTheDocument();
    expect(within(log).getByText('Which cards are late?')).toBeInTheDocument();
    const steps = within(log).getByRole('list', { name: 'Steps' });
    const [opened, searched] = within(steps).getAllByRole('listitem');
    expect(opened).toHaveTextContent(/^Opened SB-4, done$/);
    expect(searched).toHaveTextContent(/^!Searched cards, failed$/);
    expect(within(log).queryByText('Ask about this board')).toBeNull();

    fireEvent.click(within(log).getByRole('button', { name: 'Load earlier messages' }));

    expect(await within(log).findByText('Hello there')).toBeInTheDocument();
    expect(mock.current.requestsTo('GET', '/ai/conversations/conv-1/messages')[0]?.params).toEqual({
      cursor: 'cursor-1',
      limit: 30,
    });
    expect(within(log).queryByRole('button', { name: 'Load earlier messages' })).toBeNull();
    const texts = Array.from(log.querySelectorAll('p, [title]')).map((node) => node.textContent);
    expect(texts.findIndex((text) => text?.includes('Hello there'))).toBeLessThan(
      texts.findIndex((text) => text?.includes('Which cards are late?')),
    );
  });

  it('collapses more than three saved steps into one expandable line', async () => {
    mock.current.on('GET', CONVERSATION_URL, {
      status: 200,
      data: boardConversationPage([
        aiMessage({ id: 'u1', role: 'USER', content: 'Q' }),
        toolMessage({ id: 't1', toolName: 'get_board_overview' }),
        toolMessage({ id: 't2', toolName: 'search_cards' }),
        toolMessage({ id: 't3', toolName: 'get_flow_metrics' }),
        toolMessage({ id: 't4', toolName: 'get_forecast' }),
        aiMessage({ id: 'a1', role: 'ASSISTANT', content: 'Answer' }),
      ]),
    });
    await setup({ conversation: false });
    const panel = await openPanel();

    const toggle = await within(panel).findByRole('button', { name: '4 steps' });
    expect(within(panel).queryByText('Ran the forecast')).toBeNull();

    fireEvent.click(toggle);

    expect(within(panel).getByText('Read the board overview')).toBeInTheDocument();
    expect(within(panel).getByText('Ran the forecast')).toBeInTheDocument();
  });

  it("links this board's card keys in answers to the card details, keeping the panel open", async () => {
    mock.current.on('GET', CONVERSATION_URL, {
      status: 200,
      data: boardConversationPage([
        aiMessage({ id: 'a1', role: 'ASSISTANT', content: 'Look at SB-12, not XY-12.' }),
      ]),
    });
    const { router } = await setup({
      conversation: false,
      cards: [cardWith({ id: 'card-12', number: 12, columnId: 'col-todo', rank: 'm' })],
    });
    const panel = await openPanel();

    const link = await within(panel).findByRole('link', { name: 'SB-12' });
    expect(within(panel).queryByRole('link', { name: 'XY-12' })).toBeNull();
    fireEvent.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards/board-1/cards/SB-12'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: 'Assistant', hidden: true }),
    ).toBeInTheDocument();
  });
});

describe('assistant panel: a streamed turn', () => {
  it('streams steps and text, then shows the saved messages instead', async () => {
    const { fetch } = await setup();
    const stream = controlledStream();
    fetch.respond((call) => stream.respond(call));
    const panel = await openPanel();
    const log = within(panel).getByRole('log');

    ask('Which cards are at risk?', panel);

    expect(await within(log).findByText('Which cards are at risk?')).toBeInTheDocument();
    expect(messageInput(panel)).toHaveValue('');
    expect(within(panel).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    await waitFor(() => expect(stream.isOpen).toBe(true));
    const [call] = fetch.calls;
    expect(call?.url).toBe(TURN_URL);
    expect(call?.method).toBe('POST');
    expect(call?.headers.get('Authorization')).toBe('Bearer token-1');
    expect(call?.body).toEqual({ content: 'Which cards are at risk?' });

    stream.send('tool', { id: 'call-1', name: 'get_flow_metrics', status: 'started' });
    expect(await within(log).findByText('Read flow metrics')).toBeInTheDocument();
    expect(within(log).getByText(', in progress')).toBeInTheDocument();
    stream.send('tool', { id: 'call-1', name: 'get_flow_metrics', status: 'finished', ok: true });
    expect(await within(log).findByText(', done')).toBeInTheDocument();
    // An event split between two chunks.
    stream.push('event: delta\ndata: {"text":"**SB-1** is');
    stream.push(' at risk"}\n\n');
    expect(await within(log).findByText('SB-1')).toBeInTheDocument();
    expect(within(log).getByTestId('stream-cursor')).toBeInTheDocument();
    const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
    expect(live).toHaveTextContent(/^$/);

    stream.push(doneEvent('Which cards are at risk?', 'SB-1 is at risk (saved).'));
    stream.close();

    expect(await within(log).findByText(/is at risk \(saved\)\./)).toBeInTheDocument();
    expect(within(log).queryByTestId('stream-cursor')).toBeNull();
    expect(within(log).getAllByText('Which cards are at risk?')).toHaveLength(1);
    expect(within(log).getByText('Read flow metrics')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(live).toHaveTextContent('SB-1 is at risk (saved).');
  });

  it('keeps Shift+Enter as a new line and does not send blank questions', async () => {
    const { fetch } = await setup();
    const panel = await openPanel();
    const input = messageInput(panel);

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'line one' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(fetch.calls).toHaveLength(0);
    expect(within(panel).getByRole('button', { name: 'Send' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('shows the character counter near the limit and blocks too long questions', async () => {
    await setup();
    const panel = await openPanel();
    const input = messageInput(panel);

    fireEvent.change(input, { target: { value: 'a'.repeat(3499) } });
    expect(within(panel).queryByText(/\/ 4000/)).toBeNull();

    fireEvent.change(input, { target: { value: 'a'.repeat(4001) } });
    expect(within(panel).getByText('4001 / 4000')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Send' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('drops the partial answer on an error event and retries the same question', async () => {
    const { fetch } = await setup();
    fetch.respond(
      () =>
        sseResponse([
          sseEvent('delta', { text: 'Partial answer' }),
          sseEvent('error', { code: 'AI_PROVIDER_BUSY', message: 'Provider said no' }),
        ]),
      () => sseResponse([doneEvent('Forecast?', 'Done by Friday.')]),
    );
    const panel = await openPanel();
    const log = within(panel).getByRole('log');

    ask('Forecast?', panel);

    const alert = await within(log).findByRole('alert');
    expect(alert).toHaveTextContent(
      'The assistant is busy right now. Please try again in a moment.',
    );
    expect(within(log).queryByText('Partial answer')).toBeNull();
    expect(within(log).getByText('Forecast?')).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await within(log).findByText('Done by Friday.')).toBeInTheDocument();
    expect(within(log).queryByRole('alert')).toBeNull();
    expect(fetch.calls.map((call) => call.body)).toEqual([
      { content: 'Forecast?' },
      { content: 'Forecast?' },
    ]);
  });

  it('shows the server message for invalid model output', async () => {
    const { fetch } = await setup();
    fetch.respond(() =>
      sseResponse([
        sseEvent('error', { code: 'AI_INVALID_OUTPUT', message: 'The model got confused.' }),
      ]),
    );
    const panel = await openPanel();

    ask('Hi', panel);

    expect(await within(panel).findByRole('alert')).toHaveTextContent('The model got confused.');
  });

  it('offers no retry when the conversation was cleared meanwhile', async () => {
    mock.current.on('GET', CONVERSATION_URL, {
      status: 200,
      data: boardConversationPage([
        aiMessage({ id: 'old', role: 'USER', content: 'Old question' }),
      ]),
    });
    const { fetch } = await setup({ conversation: false });
    fetch.respond(() =>
      sseResponse([sseEvent('error', { code: 'AI_CONVERSATION_CLEARED', message: 'Cleared' })]),
    );
    const panel = await openPanel();
    await within(panel).findByText('Old question');

    ask('New question', panel);

    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent('The conversation was cleared.');
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(within(panel).queryByText('Old question')).toBeNull();
    expect(messageInput(panel)).toHaveValue('New question');
  });

  it('treats a stream that ends without its final event as a failure', async () => {
    const { fetch } = await setup();
    fetch.respond(() => sseResponse([sseEvent('delta', { text: 'Half' })]));
    const panel = await openPanel();

    ask('Hi', panel);

    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'The assistant is unavailable. Please try again later.',
    );
  });

  it('stops the answer: the request is aborted and the question goes back to the input', async () => {
    const { fetch } = await setup();
    const stream = controlledStream();
    fetch.respond((call) => stream.respond(call));
    const panel = await openPanel();

    ask('Long question', panel);
    await waitFor(() => expect(stream.isOpen).toBe(true));
    stream.send('delta', { text: 'Some partial text' });
    expect(await within(panel).findByText('Some partial text')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Stop' }));

    expect(await within(panel).findByText('Stopped.')).toBeInTheDocument();
    expect(fetch.calls[0]?.signal?.aborted).toBe(true);
    const log = within(panel).getByRole('log');
    expect(within(log).queryByText('Some partial text')).toBeNull();
    expect(within(log).queryByText('Long question')).toBeNull();
    expect(messageInput(panel)).toHaveValue('Long question');
    expect(within(panel).getByRole('button', { name: 'Send' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });
});

describe('assistant panel: errors before the stream', () => {
  it('shows the daily limit and disables the input after a 429', async () => {
    const { fetch } = await setup();
    fetch.respond(() => jsonResponse(429, errorBody('AI_LIMIT_REACHED', 'Limit')));
    const panel = await openPanel();

    ask('One more?', panel);

    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      "You've reached today's assistant limit. It resets at midnight UTC.",
    );
    expect(messageInput(panel)).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'Send' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('shows a toast and restores the question after a 409', async () => {
    const { fetch } = await setup();
    fetch.respond(() => jsonResponse(409, errorBody('AI_TURN_IN_PROGRESS', 'Busy')));
    const panel = await openPanel();

    ask('Parallel question', panel);

    expect(
      await screen.findByText('The assistant is still answering in another tab.'),
    ).toBeInTheDocument();
    expect(messageInput(panel)).toHaveValue('Parallel question');
    expect(within(within(panel).getByRole('log')).queryByText('Parallel question')).toBeNull();
  });

  it('shows a toast and restores the question without a network', async () => {
    const { fetch } = await setup();
    fetch.respond(() => 'network-error');
    const panel = await openPanel();

    ask('Offline question', panel);

    expect(
      await screen.findByText('Unable to reach the server. Please try again.'),
    ).toBeInTheDocument();
    expect(messageInput(panel)).toHaveValue('Offline question');
  });

  it('shows the validation message of a 400', async () => {
    const { fetch } = await setup();
    fetch.respond(() => jsonResponse(400, errorBody('VALIDATION_ERROR', 'Message is required')));
    const panel = await openPanel();

    ask('x', panel);

    expect(await screen.findByText('Message is required')).toBeInTheDocument();
  });

  it('shows the unavailable conversation after a 404', async () => {
    const { fetch } = await setup();
    fetch.respond(() => jsonResponse(404, errorBody('CONVERSATION_NOT_FOUND')));
    const panel = await openPanel();

    ask('Still there?', panel);

    expect(
      await within(panel).findByText('This conversation is no longer available.'),
    ).toBeInTheDocument();
  });

  it('refreshes an expired session once and sends the question again', async () => {
    mock.current.on('POST', '/auth/refresh', { status: 200, data: sessionWith('token-2') });
    const { fetch } = await setup();
    fetch.respond(
      () => jsonResponse(401, errorBody('UNAUTHORIZED')),
      () => sseResponse([doneEvent('Hi', 'Hello again.')]),
    );
    const panel = await openPanel();

    ask('Hi', panel);

    expect(
      await within(within(panel).getByRole('log')).findByText('Hello again.'),
    ).toBeInTheDocument();
    expect(fetch.calls.map((call) => call.headers.get('Authorization'))).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
    expect(mock.current.requestsTo('POST', '/auth/refresh')).toHaveLength(1);
  });

  it('ends the session when the refresh fails too', async () => {
    mock.current.on('POST', '/auth/refresh', { status: 401, data: errorBody('UNAUTHORIZED') });
    const { fetch } = await setup();
    fetch.respond(() => jsonResponse(401, errorBody('UNAUTHORIZED')));
    const panel = await openPanel();

    ask('Hi', panel);

    expect(
      await screen.findByRole('heading', { name: 'Log in to StreamLine' }),
    ).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(fetch.calls).toHaveLength(1);
  });
});

describe('assistant panel: clearing the conversation', () => {
  it('asks first, deletes the conversation and shows the empty state', async () => {
    mock.current.on('GET', CONVERSATION_URL, {
      status: 200,
      data: boardConversationPage([
        aiMessage({ id: 'u1', role: 'USER', content: 'Old question' }),
        aiMessage({ id: 'a1', role: 'ASSISTANT', content: 'Old answer' }),
      ]),
    });
    mock.current.on('DELETE', CONVERSATION_URL, { status: 204 });
    await setup({ conversation: false });
    const panel = await openPanel();
    await within(panel).findByText('Old answer');

    fireEvent.click(within(panel).getByRole('button', { name: 'Clear conversation' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Clear this conversation?' });
    expect(dialog).toHaveTextContent('The assistant forgets it too.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear conversation' }));

    expect(await within(panel).findByText('Ask about this board')).toBeInTheDocument();
    expect(within(panel).queryByText('Old answer')).toBeNull();
    expect(mock.current.requestsTo('DELETE', CONVERSATION_URL)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('complementary', { name: 'Assistant' })).toBeInTheDocument();
  });

  it('keeps the panel open when Escape closes the confirmation', async () => {
    await setup();
    const panel = await openPanel();

    fireEvent.click(within(panel).getByRole('button', { name: 'Clear conversation' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('complementary', { name: 'Assistant' })).toBeInTheDocument();
    expect(mock.current.requestsTo('DELETE', CONVERSATION_URL)).toHaveLength(0);
  });

  it('drops older messages still loading when the conversation is cleared', async () => {
    const page = deferred<MockReply>();
    mock.current.on('GET', CONVERSATION_URL, {
      status: 200,
      data: boardConversationPage(
        [aiMessage({ id: 'a1', role: 'ASSISTANT', content: 'Newest answer' })],
        'cursor-1',
      ),
    });
    mock.current.on('GET', '/ai/conversations/conv-1/messages', () => page.promise);
    mock.current.on('DELETE', CONVERSATION_URL, { status: 204 });
    await setup({ conversation: false });
    const panel = await openPanel();
    fireEvent.click(await within(panel).findByRole('button', { name: 'Load earlier messages' }));

    fireEvent.click(within(panel).getByRole('button', { name: 'Clear conversation' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear conversation' }));
    expect(await within(panel).findByText('Ask about this board')).toBeInTheDocument();
    await act(async () => {
      page.resolve({
        status: 200,
        data: {
          messages: [aiMessage({ id: 'old', role: 'USER', content: 'Old question' })],
          nextCursor: null,
        },
      });
      await page.promise;
    });

    expect(within(panel).queryByText('Old question')).toBeNull();
    expect(within(panel).getByText('Ask about this board')).toBeInTheDocument();
  });
});

/** Answers for board-2 (key `OT`) and its conversation (`conv-2`, with one saved answer). */
function mockSecondBoard() {
  const columns = defaultColumns('board-2');
  mock.current.on('GET', '/boards/board-2', {
    status: 200,
    data: { board: boardWith({ id: 'board-2', key: 'OT', name: 'Other board' }) },
  });
  mock.current.on('GET', '/boards/board-2/columns', { status: 200, data: { columns } });
  mock.current.on('GET', '/boards/board-2/members', {
    status: 200,
    data: { members: [memberWith()] },
  });
  mock.current.on('GET', '/boards/board-2/cards', { status: 200, data: cardListFor(columns) });
  mock.current.on('GET', '/ai/boards/board-2/conversation', {
    status: 200,
    data: boardConversationPage(
      [
        aiMessage({
          id: 'b2-a',
          conversationId: 'conv-2',
          role: 'ASSISTANT',
          content: 'Board two answer',
        }),
      ],
      null,
      aiConversationWith({ id: 'conv-2', boardId: 'board-2' }),
    ),
  });
}

const LIMIT_TEXT = /today's assistant limit/;

describe('assistant panel: focus, refresh failures, limit and board changes', () => {
  it('keeps the keyboard focus on the Send / Stop button while it switches', async () => {
    const { fetch } = await setup();
    const stream = controlledStream();
    fetch.respond((call) => stream.respond(call));
    const panel = await openPanel();
    fireEvent.change(messageInput(panel), { target: { value: 'Focus test' } });
    const button = within(panel).getByRole('button', { name: 'Send' });
    button.focus();

    fireEvent.click(button);

    expect(await within(panel).findByRole('button', { name: 'Stop' })).toBe(button);
    expect(button).toHaveFocus();
    await waitFor(() => expect(stream.isOpen).toBe(true));

    fireEvent.click(button);

    expect(await within(panel).findByText('Stopped.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Send' })).toBe(button);
    expect(button).toHaveFocus();
  });

  it('shows the network toast when the session refresh cannot reach the server', async () => {
    mock.current.on('POST', '/auth/refresh', 'network-error');
    const { fetch } = await setup();
    fetch.respond(() => jsonResponse(401, errorBody('UNAUTHORIZED')));
    const panel = await openPanel();

    ask('Refresh question', panel);

    expect(
      await screen.findByText('Unable to reach the server. Please try again.'),
    ).toBeInTheDocument();
    expect(messageInput(panel)).toHaveValue('Refresh question');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('keeps the daily limit after reopening the panel and on another board', async () => {
    mockSecondBoard();
    const { fetch, router } = await setup();
    fetch.respond(() => jsonResponse(429, errorBody('AI_LIMIT_REACHED', 'Limit')));
    let panel = await openPanel();
    ask('One more?', panel);
    expect(await within(panel).findByRole('alert')).toHaveTextContent(LIMIT_TEXT);

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    panel = await openPanel();
    expect(within(panel).getByRole('alert')).toHaveTextContent(LIMIT_TEXT);
    expect(messageInput(panel)).toBeDisabled();

    await act(async () => {
      await router.navigate('/boards/board-2');
    });
    await screen.findByRole('heading', { level: 1, name: 'Other board' });
    panel = screen.getByRole('complementary', { name: 'Assistant' });
    expect(await within(panel).findByText('Board two answer')).toBeInTheDocument();
    expect(within(panel).getByRole('alert')).toHaveTextContent(LIMIT_TEXT);
    expect(messageInput(panel)).toBeDisabled();
    expect(fetch.calls).toHaveLength(1);
  });

  it('aborts the answer being streamed when the panel closes', async () => {
    const { fetch } = await setup();
    const stream = controlledStream();
    fetch.respond((call) => stream.respond(call));
    const panel = await openPanel();
    ask('Closing question', panel);
    await waitFor(() => expect(stream.isOpen).toBe(true));

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));

    expect(fetch.calls[0]?.signal?.aborted).toBe(true);
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
  });

  it("aborts the answer on a board change and shows the other board's conversation", async () => {
    mockSecondBoard();
    const { fetch, router } = await setup();
    const stream = controlledStream();
    fetch.respond((call) => stream.respond(call));
    const panel = await openPanel();
    ask('Board one question', panel);
    await waitFor(() => expect(stream.isOpen).toBe(true));

    await act(async () => {
      await router.navigate('/boards/board-2');
    });
    await screen.findByRole('heading', { level: 1, name: 'Other board' });

    expect(fetch.calls[0]?.signal?.aborted).toBe(true);
    const next = screen.getByRole('complementary', { name: 'Assistant' });
    expect(await within(next).findByText('Board two answer')).toBeInTheDocument();
    expect(within(next).queryByText('Board one question')).toBeNull();
    expect(mock.current.requestsTo('GET', '/ai/boards/board-2/conversation')).toHaveLength(1);
  });
});
