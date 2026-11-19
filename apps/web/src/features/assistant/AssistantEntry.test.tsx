import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAiStatusStore } from '@/stores/aiStatus';
import { resetAssistantPanelStore } from '@/stores/assistantPanel';
import { useAuthStore } from '@/stores/auth';
import { aiConversationWith, aiMessage } from '@/test/aiFixtures';
import {
  aiEnabled,
  ask,
  CONVERSATION_URL,
  messageInput,
  openPanel,
  renderBoardWithAssistant,
} from '@/test/assistant';
import { installFakeFetch, sseEvent, sseResponse } from '@/test/fakeFetch';
import { sessionWith } from '@/test/fixtures';
import { errorBody } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

const PROJECT_BUTTON = 'New project with assistant';

async function renderBoardList() {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  renderApp('/boards');
  await screen.findByRole('heading', { name: 'Your boards' });
}

describe('assistant availability', () => {
  it('shows the Assistant button on a board page when the assistant is enabled', async () => {
    aiEnabled(mock.current);
    await renderBoardWithAssistant(mock.current);

    const button = await within(screen.getByRole('banner')).findByRole('button', {
      name: 'Assistant',
    });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(mock.current.requestsTo('GET', '/ai/status')).toHaveLength(1);
  });

  it('hides every assistant element when the assistant is disabled', async () => {
    aiEnabled(mock.current, false);
    await renderBoardWithAssistant(mock.current);

    await waitFor(() => expect(useAiStatusStore.getState().status).toBe('ready'));
    expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
  });

  it('hides every assistant element when the status check fails', async () => {
    mock.current.on('GET', '/ai/status', { status: 500, data: errorBody('INTERNAL_ERROR') });
    window.localStorage.setItem('streamline-assistant-open', 'true');
    resetAssistantPanelStore();
    await renderBoardWithAssistant(mock.current);

    await waitFor(() => expect(useAiStatusStore.getState().status).toBe('error'));
    expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
  });

  it('checks the status once per session', async () => {
    aiEnabled(mock.current);
    await renderBoardList();
    await screen.findByRole('button', { name: PROJECT_BUTTON });

    expect(mock.current.requestsTo('GET', '/ai/status')).toHaveLength(1);
  });

  it('shows no Assistant button on the board list', async () => {
    aiEnabled(mock.current);
    await renderBoardList();
    await screen.findByRole('button', { name: PROJECT_BUTTON });

    expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull();
  });
});

describe('assistant panel: remembered state', () => {
  it('reopens a panel left open without taking the focus', async () => {
    window.localStorage.setItem('streamline-assistant-open', 'true');
    resetAssistantPanelStore();
    aiEnabled(mock.current);
    await renderBoardWithAssistant(mock.current);

    await screen.findByRole('log', { name: 'Conversation' }, { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Assistant' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(messageInput()).not.toHaveFocus();
  });

  it('still opens and closes when the browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    resetAssistantPanelStore();
    aiEnabled(mock.current);
    await renderBoardWithAssistant(mock.current);

    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
    expect(mock.current.requestsTo('GET', CONVERSATION_URL)).toHaveLength(1);
  });
});

describe('New project with assistant', () => {
  it('is hidden on the board list when the assistant is disabled', async () => {
    aiEnabled(mock.current, false);
    await renderBoardList();

    await waitFor(() => expect(useAiStatusStore.getState().status).toBe('ready'));
    expect(screen.queryByRole('button', { name: PROJECT_BUTTON })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create board' })).toBeInTheDocument();
  });

  it('starts a new session on every open, chats and asks before closing a conversation', async () => {
    aiEnabled(mock.current);
    mock.current.on(
      'POST',
      '/ai/project-sessions',
      {
        status: 201,
        data: {
          conversation: aiConversationWith({
            id: 'proj-1',
            kind: 'PROJECT_SESSION',
            boardId: null,
          }),
        },
      },
      {
        status: 201,
        data: {
          conversation: aiConversationWith({
            id: 'proj-2',
            kind: 'PROJECT_SESSION',
            boardId: null,
          }),
        },
      },
    );
    const fetch = installFakeFetch();
    fetch.respond(() =>
      sseResponse([
        sseEvent('delta', { text: 'You need SB-1 people.' }),
        sseEvent('done', {
          messages: [
            aiMessage({ id: 'u1', conversationId: 'proj-1', role: 'USER', content: 'Plan it' }),
            aiMessage({
              id: 'a1',
              conversationId: 'proj-1',
              role: 'ASSISTANT',
              content: 'You need 4 people.',
            }),
          ],
          usage: { promptTokens: 1, completionTokens: 1 },
        }),
      ]),
    );
    await renderBoardList();

    fireEvent.click(await screen.findByRole('button', { name: PROJECT_BUTTON }));

    const dialog = await screen.findByRole(
      'dialog',
      { name: 'New project with assistant' },
      { timeout: 5000 },
    );
    expect(dialog).toHaveTextContent(
      'Describe the project, the team and the deadline. Creating the board comes in a later version.',
    );
    const suggestions = await within(dialog).findByRole('list', { name: 'Suggested questions' });
    expect(
      within(suggestions)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Plan a webshop launch for 4 people in 6 weeks.',
      'Which roles do I need for a mobile app MVP?',
    ]);
    expect(mock.current.requestsTo('POST', '/ai/project-sessions')).toHaveLength(1);
    expect(mock.current.requestsTo('POST', '/ai/project-sessions')[0]?.data).toEqual({});
    await waitFor(() => expect(messageInput(dialog)).toHaveFocus());

    ask('Plan it', dialog);

    const log = within(dialog).getByRole('log', { name: 'Conversation' });
    expect(await within(log).findByText('You need 4 people.')).toBeInTheDocument();
    expect(fetch.calls[0]?.url).toBe('/api/ai/conversations/proj-1/messages');
    expect(within(dialog).queryByRole('button', { name: 'Clear conversation' })).toBeNull();

    // Closing a session with messages asks first; "Keep chatting" keeps it.
    fireEvent.keyDown(messageInput(dialog), { key: 'Escape' });
    let confirm = await screen.findByRole('alertdialog', { name: 'Close this conversation?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep chatting' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'New project with assistant' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    confirm = await screen.findByRole('alertdialog', { name: 'Close this conversation?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Close conversation' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New project with assistant' })).toBeNull(),
    );

    // A new open is a new session.
    fireEvent.click(screen.getByRole('button', { name: PROJECT_BUTTON }));
    const second = await screen.findByRole('dialog', { name: 'New project with assistant' });
    await within(second).findByRole('list', { name: 'Suggested questions' });
    expect(mock.current.requestsTo('POST', '/ai/project-sessions')).toHaveLength(2);
    expect(within(second).queryByText('You need 4 people.')).toBeNull();

    // An empty session closes without asking.
    fireEvent.click(within(second).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New project with assistant' })).toBeNull(),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('creates one session in StrictMode', async () => {
    aiEnabled(mock.current);
    mock.current.on('POST', '/ai/project-sessions', {
      status: 201,
      data: {
        conversation: aiConversationWith({ id: 'proj-1', kind: 'PROJECT_SESSION', boardId: null }),
      },
    });
    useAuthStore.getState().setSession(sessionWith('token-1'));
    renderApp('/boards', { strict: true });

    fireEvent.click(await screen.findByRole('button', { name: PROJECT_BUTTON }));
    const dialog = await screen.findByRole(
      'dialog',
      { name: 'New project with assistant' },
      { timeout: 5000 },
    );
    await within(dialog).findByRole('list', { name: 'Suggested questions' });

    expect(mock.current.requestsTo('POST', '/ai/project-sessions')).toHaveLength(1);
  });
});
