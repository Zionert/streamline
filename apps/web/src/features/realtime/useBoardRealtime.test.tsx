import type { PublicUser } from '@streamline/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { setSocketFactory } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth';
import { useBoardStore } from '@/stores/board';
import { FakeSocket } from '@/test/fakeSocket';
import {
  boardWith,
  cardListFor,
  cardWith,
  columnWith,
  defaultColumns,
  memberWith,
  sessionWith,
  testUser,
} from '@/test/fixtures';
import { errorBody } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

import {
  ACCESS_REVOKED_MESSAGE,
  BOARD_DELETED_MESSAGE,
  JOIN_RETRY_DELAY_MS,
  LIVE_UPDATES_UNAVAILABLE_MESSAGE,
} from './useBoardRealtime';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const CARDS = `${BOARD}/cards`;

const ann: PublicUser = { ...testUser, id: 'user-ann', name: 'Ann Lee', email: 'ann@example.com' };
const t1 = cardWith({ id: 't1', number: 1, columnId: 'col-todo', rank: 'd', title: 'Fix login' });

let sockets: FakeSocket[] = [];

function lastSocket(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error('No socket was created');
  return socket;
}

beforeEach(() => {
  sockets = [];
  setSocketFactory(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket.asSocket();
  });
});

function mockBoard() {
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith() } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: defaultColumns() } });
  mock.current.on('GET', `${BOARD}/members`, { status: 200, data: { members: [memberWith()] } });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), [t1]) });
}

async function renderBoard(path = BOARD) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mockBoard();
  const result = renderApp(path);
  await screen.findByRole('heading', { level: 1, name: 'Board', hidden: true });
  return result;
}

/** Completes the socket connection; returns the socket. */
/** Lets pending promises (acknowledgements, mocked requests) settle. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

/** Completes the socket connection and waits for the reload that follows the join. */
async function connected(): Promise<FakeSocket> {
  const socket = lastSocket();
  await act(async () => {
    socket.serverConnect();
    await Promise.resolve();
  });
  await settle();
  return socket;
}

describe('useBoardRealtime', () => {
  it('connects when the board opens, joins its room and shows who is viewing it', async () => {
    await renderBoard();
    const socket = lastSocket();
    expect(socket.connectCalls).toBe(1);
    socket.joinResponder = () => ({ ok: true, presence: [testUser, ann] });

    await connected();

    expect(socket.requests('board:join')).toEqual([{ boardId: 'board-1' }]);
    const presence = await screen.findByRole('group', { name: 'Users viewing this board' });
    expect(within(presence).getByRole('img', { name: 'Ann Lee' })).toBeTruthy();
    expect(within(presence).getByRole('img', { name: testUser.name })).toBeTruthy();
  });

  it('updates the presence from presence:update events of the board only', async () => {
    await renderBoard();
    const socket = await connected();

    act(() => {
      socket.serverEmit('presence:update', { boardId: 'board-2', users: [ann] });
    });
    expect(screen.queryByRole('group', { name: 'Users viewing this board' })).toBeNull();

    act(() => {
      socket.serverEmit('presence:update', { boardId: 'board-1', users: [testUser, ann] });
    });
    const presence = await screen.findByRole('group', { name: 'Users viewing this board' });
    expect(within(presence).getAllByRole('img')).toHaveLength(2);
  });

  it('leaves the room and disconnects when the board page is left', async () => {
    const { router } = await renderBoard();
    const socket = await connected();

    await act(() => router.navigate('/boards'));

    expect(socket.requests('board:leave')).toEqual([{ boardId: 'board-1' }]);
    expect(socket.disconnected).toBe(true);
  });

  it('disconnects on logout', async () => {
    await renderBoard();
    const socket = await connected();

    act(() => {
      useAuthStore.getState().clearSession();
    });

    await waitFor(() => expect(socket.disconnected).toBe(true));
  });

  it('applies changes broadcast by the server to the board', async () => {
    await renderBoard();
    const socket = await connected();

    act(() => {
      socket.serverEmit('column:created', {
        boardId: 'board-1',
        actorId: 'user-ann',
        column: columnWith({ id: 'col-review', title: 'Review', rank: 'z' }),
      });
      socket.serverEmit('card:updated', {
        boardId: 'board-1',
        actorId: 'user-ann',
        card: { ...t1, title: 'Fix login on Safari', updatedAt: '2026-11-12T10:00:00.000Z' },
      });
    });

    expect(await screen.findByRole('heading', { name: 'Review' })).toBeTruthy();
    expect(screen.getByText('Fix login on Safari')).toBeTruthy();
  });

  it('ignores malformed events', async () => {
    await renderBoard();
    const socket = await connected();
    const before = useBoardStore.getState().columns;

    act(() => {
      socket.serverEmit('column:created', { boardId: 'board-1', column: { id: 'x' } });
    });

    expect(useBoardStore.getState().columns).toBe(before);
  });

  it('rejoins the room and reloads the whole board after a reconnect', async () => {
    await renderBoard();
    const socket = await connected();
    const boardRequests = mock.current.requestsTo('GET', BOARD).length;
    mock.current.on('GET', BOARD, {
      status: 200,
      data: { board: boardWith({ name: 'Renamed meanwhile' }) },
    });

    act(() => {
      socket.serverDisconnect();
    });
    await connected();

    expect(socket.requests('board:join')).toHaveLength(2);
    await waitFor(() =>
      expect(mock.current.requestsTo('GET', BOARD)).toHaveLength(boardRequests + 1),
    );
    // Opening, the reload after the first join and the reload after the second one.
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(3);
    expect(mock.current.requestsTo('GET', `${BOARD}/columns`)).toHaveLength(3);
    expect(mock.current.requestsTo('GET', `${BOARD}/members`)).toHaveLength(3);
    expect(await screen.findAllByText('Renamed meanwhile')).not.toHaveLength(0);
  });

  it('reloads the board only once the server has acknowledged the join', async () => {
    await renderBoard();
    const socket = lastSocket();
    socket.joinResponder = () => null;
    await connected();
    expect(socket.requests('board:join')).toHaveLength(1);
    // Joined on the server only after the ack: a snapshot read before it could miss changes.
    expect(mock.current.requestsTo('GET', BOARD)).toHaveLength(1);

    await act(async () => {
      socket.ackJoin({ ok: true, presence: [] });
      await Promise.resolve();
    });

    await waitFor(() => expect(mock.current.requestsTo('GET', BOARD)).toHaveLength(2));
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(2);
  });

  it('reconnects when the server ends the connection (expired access token)', async () => {
    await renderBoard();
    const socket = await connected();
    expect(socket.connectCalls).toBe(1);

    act(() => {
      socket.serverDisconnect('io server disconnect');
    });
    expect(socket.connectCalls).toBe(2);
    await connected();

    expect(socket.requests('board:join')).toHaveLength(2);
  });

  it('leaves reconnecting after a dropped transport to Socket.io', async () => {
    await renderBoard();
    const socket = await connected();

    act(() => {
      socket.serverDisconnect('transport close');
    });

    expect(socket.connectCalls).toBe(1);
  });

  it('retries a join that failed on the server once, then reports it', async () => {
    await renderBoard();
    const socket = lastSocket();
    socket.joinResponder = () => ({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    await connected();
    expect(socket.requests('board:join')).toHaveLength(1);

    await waitFor(() => expect(socket.requests('board:join')).toHaveLength(2), {
      timeout: JOIN_RETRY_DELAY_MS + 1000,
    });

    expect(await screen.findByText(LIVE_UPDATES_UNAVAILABLE_MESSAGE)).toBeTruthy();
    await settle();
    expect(socket.requests('board:join')).toHaveLength(2);
  });

  it('leaves for the board list when the access is revoked', async () => {
    const { router } = await renderBoard();
    const socket = await connected();

    act(() => {
      socket.serverEmit('board:access-revoked', { boardId: 'board-1' });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
    expect(await screen.findByText(ACCESS_REVOKED_MESSAGE)).toBeTruthy();
    expect(useBoardStore.getState().boardId).toBeNull();
    expect(socket.disconnected).toBe(true);
  });

  it('ignores access revocation of another board', async () => {
    const { router } = await renderBoard();
    const socket = await connected();

    act(() => {
      socket.serverEmit('board:access-revoked', { boardId: 'board-2' });
    });

    expect(router.state.location.pathname).toBe(BOARD);
  });

  it('leaves for the board list when the board is deleted', async () => {
    const { router } = await renderBoard();
    const socket = await connected();

    act(() => {
      socket.serverEmit('board:deleted', { boardId: 'board-1', actorId: 'user-ann' });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
    expect(await screen.findByText(BOARD_DELETED_MESSAGE)).toBeTruthy();
  });

  it('leaves for the board list when joining the room is refused', async () => {
    const { router } = await renderBoard();
    lastSocket().joinResponder = () => ({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Board not found' },
    });

    await connected();

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
  });

  it('leaves for the board list when the reload after a reconnect answers 404', async () => {
    const { router } = await renderBoard();
    const socket = await connected();
    mock.current.on('GET', BOARD, { status: 404, data: errorBody('NOT_FOUND') });

    act(() => {
      socket.serverDisconnect();
    });
    await connected();

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
    expect(await screen.findByText(ACCESS_REVOKED_MESSAGE)).toBeTruthy();
  });

  it('refreshes the session and reconnects when the token has expired', async () => {
    await renderBoard();
    const socket = lastSocket();
    mock.current.on('POST', '/auth/refresh', { status: 200, data: sessionWith('token-2') });

    act(() => {
      socket.failConnect('TOKEN_EXPIRED');
    });

    await waitFor(() => expect(socket.connectCalls).toBe(2));
    expect(useAuthStore.getState().accessToken).toBe('token-2');
  });

  it('gives up after repeated handshake rejections', async () => {
    await renderBoard();
    const socket = lastSocket();
    mock.current.on('POST', '/auth/refresh', { status: 200, data: sessionWith('token-2') });

    for (let attempt = 0; attempt < 4; attempt++) {
      act(() => {
        socket.failConnect('UNAUTHORIZED');
      });
      await waitFor(() => expect(mock.current.requestsTo('POST', '/auth/refresh')).not.toEqual([]));
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    }

    expect(mock.current.requestsTo('POST', '/auth/refresh')).toHaveLength(2);
    expect(socket.connectCalls).toBe(3);
  });

  it('logs out when the session cannot be refreshed', async () => {
    const { router } = await renderBoard();
    mock.current.on('POST', '/auth/refresh', { status: 401, data: errorBody('UNAUTHORIZED') });

    act(() => {
      lastSocket().failConnect('TOKEN_EXPIRED');
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('ignores connection errors that are not about authentication', async () => {
    await renderBoard();

    act(() => {
      lastSocket().failConnect('INTERNAL_ERROR');
    });

    expect(mock.current.requestsTo('POST', '/auth/refresh')).toEqual([]);
  });
});

describe('card details during live updates', () => {
  it('closes the card with a toast when someone else deletes it', async () => {
    const { router } = await renderBoard(`${BOARD}/cards/SB-1`);
    await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
    const socket = await connected();

    act(() => {
      socket.serverEmit('card:deleted', { boardId: 'board-1', actorId: 'user-ann', cardId: 't1' });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe(BOARD));
    expect(await screen.findByText('This card has been deleted elsewhere.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('follows the card to its new key when the board key changes', async () => {
    const { router } = await renderBoard(`${BOARD}/cards/SB-1`);
    await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
    const socket = await connected();
    const { role: _role, ...summary } = boardWith({
      key: 'NEW',
      updatedAt: '2026-11-12T10:00:00.000Z',
    });

    act(() => {
      socket.serverEmit('board:updated', {
        boardId: 'board-1',
        actorId: 'user-ann',
        board: summary,
      });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe(`${BOARD}/cards/NEW-1`));
    expect(await screen.findByRole('dialog', { name: /^NEW-1 Fix login/ })).toBeTruthy();
  });
});
