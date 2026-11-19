import type { Card } from '@streamline/shared';
import { fireEvent, screen, within } from '@testing-library/react';

import { useAuthStore } from '@/stores/auth';
import { boardConversationPage } from '@/test/aiFixtures';
import { boardWith, cardListFor, defaultColumns, memberWith, sessionWith } from '@/test/fixtures';
import type { MockAdapter } from '@/test/mockAdapter';
import { renderApp } from '@/test/renderApp';

export const BOARD_PATH = '/boards/board-1';
export const CONVERSATION_URL = '/ai/boards/board-1/conversation';
export const TURN_URL = '/api/ai/conversations/conv-1/messages';

/** `GET /ai/status` answers that the assistant is enabled (or disabled). */
export function aiEnabled(mock: MockAdapter, enabled = true, model = 'test-model') {
  mock.on('GET', '/ai/status', {
    status: 200,
    data: { enabled, model: enabled ? model : null },
  });
}

/**
 * Opens board-1 (key `SB`) as its owner with the assistant enabled and an empty conversation
 * unless the test registered another answer for it.
 */
export async function renderBoardWithAssistant(
  mock: MockAdapter,
  options: { cards?: Card[]; path?: string; conversation?: boolean } = {},
) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  const columns = defaultColumns();
  mock.on('GET', BOARD_PATH, { status: 200, data: { board: boardWith() } });
  mock.on('GET', `${BOARD_PATH}/columns`, { status: 200, data: { columns } });
  mock.on('GET', `${BOARD_PATH}/members`, { status: 200, data: { members: [memberWith()] } });
  mock.on('GET', `${BOARD_PATH}/cards`, {
    status: 200,
    data: cardListFor(columns, options.cards),
  });
  if (options.conversation !== false) {
    mock.on('GET', CONVERSATION_URL, { status: 200, data: boardConversationPage() });
  }
  const result = renderApp(options.path ?? BOARD_PATH);
  await screen.findByRole('heading', { level: 1, name: 'Sprint board' });
  return result;
}

export function assistantButton(): HTMLElement {
  return within(screen.getByRole('banner')).getByRole('button', { name: 'Assistant' });
}

/** Opens the panel with the top bar button and waits for its code and conversation. */
export async function openPanel(): Promise<HTMLElement> {
  fireEvent.click(
    await within(screen.getByRole('banner')).findByRole('button', { name: 'Assistant' }),
  );
  // The first open loads the panel's code (a placeholder panel is shown meanwhile).
  await screen.findByRole('log', { name: 'Conversation' }, { timeout: 5000 });
  return screen.getByRole('complementary', { name: 'Assistant' });
}

export function messageInput(panel: HTMLElement = document.body): HTMLTextAreaElement {
  return within(panel).getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
}

/** Types the question and presses Enter. */
export function ask(question: string, panel: HTMLElement = document.body) {
  const input = messageInput(panel);
  fireEvent.change(input, { target: { value: question } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
