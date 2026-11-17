import type { Activity } from '@streamline/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { setSocketFactory } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth';
import { FakeSocket } from '@/test/fakeSocket';
import {
  activityWith,
  boardWith,
  cardListFor,
  cardWith,
  defaultColumns,
  memberWith,
  sessionWith,
  testUser,
} from '@/test/fixtures';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const CARDS = `${BOARD}/cards`;
const ACTIVITY = `${BOARD}/activity`;

const t1 = cardWith({ id: 't1', number: 1, columnId: 'col-todo', rank: 'd', title: 'Fix login' });

const created = activityWith(
  {
    type: 'CARD_CREATED',
    payload: {
      card: { key: 'SB-1', title: 'Fix login' },
      column: { id: 'col-todo', name: 'To Do' },
    },
  },
  { id: 'a1', cardId: 't1', createdAt: '2026-11-11T09:00:00.000Z' },
);
const deletedCard = activityWith(
  {
    type: 'CARD_DELETED',
    payload: {
      card: { key: 'SB-7', title: 'Old idea' },
      column: { id: 'col-todo', name: 'To Do' },
    },
  },
  { id: 'a0', cardId: 'gone', createdAt: '2026-11-11T08:00:00.000Z' },
);
const moved = activityWith(
  {
    type: 'CARD_MOVED',
    payload: {
      card: { key: 'SB-1', title: 'Fix login' },
      from: { id: 'col-todo', name: 'To Do' },
      to: { id: 'col-progress', name: 'In Progress' },
    },
  },
  { id: 'a2', cardId: 't1', createdAt: '2026-11-11T10:00:00.000Z' },
);

let sockets: FakeSocket[] = [];

beforeEach(() => {
  sockets = [];
  setSocketFactory(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket.asSocket();
  });
});

function lastSocket(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error('No socket was created');
  return socket;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

async function renderBoard(
  activities: Activity[] = [created, deletedCard],
  nextCursor: string | null = null,
) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith() } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: defaultColumns() } });
  mock.current.on('GET', `${BOARD}/members`, { status: 200, data: { members: [memberWith()] } });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), [t1]) });
  mock.current.on('GET', `${BOARD}/labels`, { status: 200, data: { labels: [] } });
  mock.current.on('GET', ACTIVITY, { status: 200, data: { activities, nextCursor } });
  const result = renderApp(BOARD);
  await screen.findByRole('heading', { level: 1, name: 'Sprint board' });
  await screen.findByRole('button', { name: /^SB-1 / });
  return result;
}

async function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
  const panel = await screen.findByRole('dialog', { name: 'Activity' });
  await within(panel).findByRole('list', { name: 'Board activity' });
  return panel;
}

const entryTexts = (panel: HTMLElement) =>
  within(panel)
    .getAllByTestId('activity-text')
    .map((entry) => entry.textContent?.replace(/\s+/g, ' ').trim());

describe('board activity panel', () => {
  it('opens from the Activity tab and shows the activity newest first', async () => {
    await renderBoard();

    const panel = await openPanel();

    expect(entryTexts(panel)).toEqual([
      `${testUser.name} created SB-1 Fix login in To Do`,
      `${testUser.name} deleted SB-7 Old idea from To Do`,
    ]);
    // Only a card still on the board is a link.
    expect(within(panel).getAllByRole('link')).toHaveLength(1);
  });

  it('opens a card from its link and closes the panel', async () => {
    const { router } = await renderBoard();
    const panel = await openPanel();

    fireEvent.click(within(panel).getByRole('link', { name: /SB-1 Fix login/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`${BOARD}/cards/SB-1`));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Activity' })).toBeNull());
  });

  it('prepends live entries once, also those of the own changes', async () => {
    await renderBoard();
    const socket = lastSocket();
    await act(async () => {
      socket.serverConnect();
      await Promise.resolve();
    });
    await settle();
    const panel = await openPanel();

    act(() => {
      const payload = { boardId: 'board-1', actorId: testUser.id, activity: moved };
      socket.serverEmit('activity:created', payload);
      // The same entry again (e.g. delivered twice around a reconnect).
      socket.serverEmit('activity:created', payload);
    });

    await waitFor(() => expect(entryTexts(panel)).toHaveLength(3));
    expect(entryTexts(panel)[0]).toBe(
      `${testUser.name} moved SB-1 Fix login from To Do to In Progress`,
    );
  });

  it('loads older entries with "Load more"', async () => {
    await renderBoard([created], 'cursor-1');
    mock.current.on('GET', ACTIVITY, (config) => {
      const params = config.params as { cursor?: string } | undefined;
      return params?.cursor === 'cursor-1'
        ? { status: 200, data: { activities: [deletedCard], nextCursor: null } }
        : { status: 200, data: { activities: [created], nextCursor: 'cursor-1' } };
    });
    const panel = await openPanel();

    fireEvent.click(within(panel).getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(entryTexts(panel)).toHaveLength(2));
    expect(within(panel).queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('offers a retry when the activity cannot be loaded', async () => {
    await renderBoard();
    mock.current.on(
      'GET',
      ACTIVITY,
      { status: 500, data: { error: { code: 'INTERNAL_ERROR', message: 'x' } } },
      { status: 200, data: { activities: [created], nextCursor: null } },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    const panel = await screen.findByRole('dialog', { name: 'Activity' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Retry' }));

    expect(await within(panel).findByRole('list', { name: 'Board activity' })).toBeVisible();
  });
});
