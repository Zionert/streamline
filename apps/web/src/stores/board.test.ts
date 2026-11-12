import type { Column } from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import {
  boardWith,
  cardListFor,
  columnWith,
  defaultColumns,
  memberWith,
  sessionWith,
  testUser,
} from '@/test/fixtures';
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
import { setupMockApi } from '@/test/renderApp';

import { useBoardStore } from './board';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const COLUMNS = `${BOARD}/columns`;
const MEMBERS = `${BOARD}/members`;
const CARDS = `${BOARD}/cards`;

const titles = () => useBoardStore.getState().columns.map((column) => column.title);

function mockOpenBoard(columns: Column[] = defaultColumns(), role = boardWith().role) {
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ role }) } });
  mock.current.on('GET', COLUMNS, { status: 200, data: { columns } });
  mock.current.on('GET', MEMBERS, { status: 200, data: { members: [memberWith()] } });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(columns) });
}

async function openBoard(columns?: Column[]) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mockOpenBoard(columns);
  await useBoardStore.getState().openBoard('board-1');
}

describe('board list', () => {
  it('loads the boards of the user', async () => {
    const boards = [boardWith(), boardWith({ id: 'board-2', name: 'Other', role: 'VIEWER' })];
    mock.current.on('GET', '/boards', { status: 200, data: { boards } });

    await useBoardStore.getState().loadBoards();

    expect(useBoardStore.getState()).toMatchObject({ boards, boardsStatus: 'ready' });
  });

  it('reports a failed load', async () => {
    mock.current.on('GET', '/boards', 'network-error');

    await useBoardStore.getState().loadBoards();

    expect(useBoardStore.getState().boardsStatus).toBe('error');
    expect(useBoardStore.getState().boardsError).toMatch(/unable to reach/i);
  });

  it('prepends a created board', async () => {
    useBoardStore.setState({ boards: [boardWith({ id: 'old' })] });
    mock.current.on('POST', '/boards', { status: 201, data: { board: boardWith({ id: 'new' }) } });

    await useBoardStore.getState().createBoard('New');

    expect(mock.current.requestsTo('POST', '/boards')[0]?.data).toEqual({ name: 'New' });
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual(['new', 'old']);
  });

  it('renames a board in the list and the opened board', async () => {
    await openBoard();
    useBoardStore.setState({ boards: [boardWith()] });
    mock.current.on('PATCH', BOARD, {
      status: 200,
      data: { board: boardWith({ name: 'Renamed' }) },
    });

    await useBoardStore.getState().renameBoard('board-1', 'Renamed');

    expect(useBoardStore.getState().boards[0]?.name).toBe('Renamed');
    expect(useBoardStore.getState().board?.name).toBe('Renamed');
  });

  it('drops a rename response when the board list was reset meanwhile', async () => {
    useBoardStore.setState({ boards: [boardWith()] });
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', BOARD, () => reply.promise);
    const renaming = useBoardStore.getState().renameBoard('board-1', 'Renamed');

    useAuthStore.getState().clearSession();
    useBoardStore.setState({ boards: [boardWith({ name: 'From the next session' })] });
    reply.resolve({ status: 200, data: { board: boardWith({ name: 'Renamed' }) } });
    await renaming;

    expect(useBoardStore.getState().boards[0]?.name).toBe('From the next session');
    expect(useBoardStore.getState().board).toBeNull();
  });

  it('removes a deleted board and keeps it on failure', async () => {
    useBoardStore.setState({ boards: [boardWith(), boardWith({ id: 'board-2' })] });
    mock.current.on(
      'DELETE',
      BOARD,
      { status: 403, data: errorBody('FORBIDDEN') },
      { status: 204 },
    );

    await expect(useBoardStore.getState().deleteBoard('board-1')).rejects.toThrow();
    expect(useBoardStore.getState().boards).toHaveLength(2);

    await useBoardStore.getState().deleteBoard('board-1');
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual(['board-2']);
  });
});

describe('openBoard', () => {
  it('loads the board, its columns sorted by rank and its members', async () => {
    const [a, b, c] = [
      columnWith({ id: 'lower', rank: 'a' }),
      columnWith({ id: 'upper', rank: 'B' }),
      columnWith({ id: 'digit', rank: '5' }),
    ];
    await openBoard([a, b, c]);

    expect(useBoardStore.getState()).toMatchObject({
      boardStatus: 'ready',
      board: { id: 'board-1', role: 'OWNER' },
      members: [memberWith()],
    });
    // Code unit order (digits, uppercase, lowercase), never locale order.
    expect(titles()).toEqual(['digit', 'upper', 'lower']);
  });

  it('marks a board the user cannot see as not found', async () => {
    mock.current.on('GET', BOARD, { status: 404, data: errorBody('NOT_FOUND') });
    mock.current.on('GET', COLUMNS, { status: 404, data: errorBody('NOT_FOUND') });
    mock.current.on('GET', MEMBERS, { status: 404, data: errorBody('NOT_FOUND') });
    mock.current.on('GET', CARDS, { status: 404, data: errorBody('NOT_FOUND') });

    await useBoardStore.getState().openBoard('board-1');

    expect(useBoardStore.getState().boardStatus).toBe('not-found');
  });

  it('drops the result of a board opened earlier', async () => {
    const slow = deferred<MockReply>();
    mock.current.on('GET', BOARD, () => slow.promise);
    mock.current.on('GET', COLUMNS, { status: 200, data: { columns: defaultColumns() } });
    mock.current.on('GET', MEMBERS, { status: 200, data: { members: [] } });
    mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns()) });
    const first = useBoardStore.getState().openBoard('board-1');

    mock.current.on('GET', '/boards/board-2', {
      status: 200,
      data: { board: boardWith({ id: 'board-2' }) },
    });
    mock.current.on('GET', '/boards/board-2/columns', { status: 200, data: { columns: [] } });
    mock.current.on('GET', '/boards/board-2/members', { status: 200, data: { members: [] } });
    mock.current.on('GET', '/boards/board-2/cards', { status: 200, data: { columns: [] } });
    await useBoardStore.getState().openBoard('board-2');
    slow.resolve({ status: 200, data: { board: boardWith() } });
    await first;

    expect(useBoardStore.getState().board?.id).toBe('board-2');
    expect(useBoardStore.getState().columns).toEqual([]);
  });
});

describe('moveColumn', () => {
  it('reorders optimistically and sends only the new neighbours', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${COLUMNS}/col-backlog/move`, () => reply.promise);

    const moving = useBoardStore.getState().moveColumn('col-backlog', 2);

    expect(titles()).toEqual(['To Do', 'In Progress', 'Backlog', 'Done']);
    expect(useBoardStore.getState().isMovingColumn).toBe(true);
    reply.resolve({
      status: 200,
      data: { column: columnWith({ id: 'col-backlog', title: 'Backlog', rank: 't' }) },
    });
    await moving;

    expect(mock.current.requestsTo('PATCH', `${COLUMNS}/col-backlog/move`)[0]?.data).toEqual({
      afterId: 'col-progress',
      beforeId: 'col-done',
    });
    expect(titles()).toEqual(['To Do', 'In Progress', 'Backlog', 'Done']);
    expect(useBoardStore.getState().columns[2]?.rank).toBe('t');
    expect(useBoardStore.getState().isMovingColumn).toBe(false);
    // The new rank fits between its neighbours, so no reload is needed.
    expect(mock.current.requestsTo('GET', COLUMNS)).toHaveLength(1);
  });

  it('sends null for the open end when moving to the first place', async () => {
    await openBoard();
    mock.current.on('PATCH', `${COLUMNS}/col-done/move`, {
      status: 200,
      data: { column: columnWith({ id: 'col-done', title: 'Done', rank: 'V' }) },
    });

    await useBoardStore.getState().moveColumn('col-done', 0);

    expect(mock.current.requestsTo('PATCH', `${COLUMNS}/col-done/move`)[0]?.data).toEqual({
      afterId: null,
      beforeId: 'col-backlog',
    });
    expect(titles()).toEqual(['Done', 'Backlog', 'To Do', 'In Progress']);
  });

  it('rolls back to the previous order and reports a server error', async () => {
    await openBoard();
    mock.current.on('PATCH', `${COLUMNS}/col-backlog/move`, {
      status: 503,
      data: errorBody('BOARD_BUSY'),
    });

    await useBoardStore.getState().moveColumn('col-backlog', 3);

    expect(titles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
    expect(useBoardStore.getState().notice).toMatch(/busy/i);
    expect(useBoardStore.getState().isMovingColumn).toBe(false);
    expect(mock.current.requestsTo('GET', COLUMNS)).toHaveLength(1);
  });

  it('reloads the columns after 409 INVALID_POSITION (stale view)', async () => {
    await openBoard();
    const serverColumns = [
      columnWith({ id: 'col-new', title: 'Added elsewhere', rank: 'c' }),
      ...defaultColumns(),
    ];
    mock.current.on('GET', COLUMNS, { status: 200, data: { columns: serverColumns } });
    mock.current.on('PATCH', `${COLUMNS}/col-todo/move`, {
      status: 409,
      data: errorBody('INVALID_POSITION'),
    });

    await useBoardStore.getState().moveColumn('col-todo', 0);

    expect(mock.current.requestsTo('GET', COLUMNS)).toHaveLength(2);
    expect(titles()).toEqual(['Backlog', 'Added elsewhere', 'To Do', 'In Progress', 'Done']);
    expect(useBoardStore.getState().notice).toMatch(/refreshed/i);
    expect(useBoardStore.getState().isMovingColumn).toBe(false);
  });

  it('reloads the columns when the returned rank shows a server-side rebalance', async () => {
    await openBoard();
    // After a rebalance the moved column got a rank that no longer fits the stale local ranks.
    const rebalanced = [
      columnWith({ id: 'col-todo', title: 'To Do', rank: '1' }),
      columnWith({ id: 'col-backlog', title: 'Backlog', rank: '2', category: 'BACKLOG' }),
      columnWith({ id: 'col-progress', title: 'In Progress', rank: '3' }),
      columnWith({ id: 'col-done', title: 'Done', rank: '4', category: 'DONE' }),
    ];
    mock.current.on('PATCH', `${COLUMNS}/col-backlog/move`, {
      status: 200,
      data: { column: rebalanced[1] },
    });
    mock.current.on('GET', COLUMNS, { status: 200, data: { columns: rebalanced } });

    await useBoardStore.getState().moveColumn('col-backlog', 1);

    expect(mock.current.requestsTo('GET', COLUMNS)).toHaveLength(2);
    expect(useBoardStore.getState().columns.map((column) => column.rank)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(titles()).toEqual(['To Do', 'Backlog', 'In Progress', 'Done']);
  });

  it('undoes only the failed move and keeps changes made while it was in flight', async () => {
    await openBoard();
    const moveReply = deferred<MockReply>();
    mock.current.on('PATCH', `${COLUMNS}/col-backlog/move`, () => moveReply.promise);
    mock.current.on('PATCH', `${COLUMNS}/col-done`, {
      status: 200,
      data: { column: columnWith({ id: 'col-done', title: 'Shipped', rank: 'x' }) },
    });
    mock.current.on('POST', COLUMNS, {
      status: 201,
      data: { column: columnWith({ id: 'col-qa', title: 'QA', rank: 'z' }) },
    });

    const moving = useBoardStore.getState().moveColumn('col-backlog', 2);
    await useBoardStore.getState().renameColumn('col-done', 'Shipped');
    await useBoardStore.getState().createColumn('QA');
    moveReply.resolve({ status: 503, data: errorBody('BOARD_BUSY') });
    await moving;

    expect(titles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Shipped', 'QA']);
    expect(useBoardStore.getState().notice).toMatch(/busy/i);
  });

  it('ignores a move to the same place and a move while another one is saving', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${COLUMNS}/col-backlog/move`, () => reply.promise);

    await useBoardStore.getState().moveColumn('col-todo', 1);
    const moving = useBoardStore.getState().moveColumn('col-backlog', 1);
    await useBoardStore.getState().moveColumn('col-done', 0);
    reply.resolve({
      status: 200,
      data: { column: columnWith({ id: 'col-backlog', title: 'Backlog', rank: 'l' }) },
    });
    await moving;

    expect(mock.current.requests.filter((request) => request.method === 'PATCH')).toHaveLength(1);
    expect(titles()).toEqual(['To Do', 'Backlog', 'In Progress', 'Done']);
  });
});

describe('column actions', () => {
  it('appends a created column at the end without a reload when its rank fits', async () => {
    await openBoard();
    mock.current.on('POST', COLUMNS, {
      status: 201,
      data: { column: columnWith({ id: 'col-qa', title: 'QA', rank: 'z' }) },
    });

    await useBoardStore.getState().createColumn('QA');

    expect(mock.current.requestsTo('POST', COLUMNS)[0]?.data).toEqual({ title: 'QA' });
    expect(titles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done', 'QA']);
    expect(mock.current.requestsTo('GET', COLUMNS)).toHaveLength(1);
  });

  it('reloads the columns when a created column shows a server-side rebalance', async () => {
    await openBoard();
    const rebalanced = [
      columnWith({ id: 'col-backlog', title: 'Backlog', rank: '1', category: 'BACKLOG' }),
      columnWith({ id: 'col-todo', title: 'To Do', rank: '2' }),
      columnWith({ id: 'col-progress', title: 'In Progress', rank: '3' }),
      columnWith({ id: 'col-done', title: 'Done', rank: '4', category: 'DONE' }),
      columnWith({ id: 'col-qa', title: 'QA', rank: '5' }),
    ];
    mock.current.on('POST', COLUMNS, { status: 201, data: { column: rebalanced[4] } });
    mock.current.on('GET', COLUMNS, { status: 200, data: { columns: rebalanced } });

    await useBoardStore.getState().createColumn('QA');

    expect(mock.current.requestsTo('GET', COLUMNS)).toHaveLength(2);
    expect(titles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done', 'QA']);
    expect(useBoardStore.getState().columns.map((column) => column.rank)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('renames optimistically and restores the title on failure', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${COLUMNS}/col-todo`, () => reply.promise);

    const renaming = useBoardStore.getState().renameColumn('col-todo', 'Ready');
    expect(titles()[1]).toBe('Ready');
    reply.resolve({ status: 503, data: errorBody('BOARD_BUSY') });

    await expect(renaming).rejects.toThrow();
    expect(titles()[1]).toBe('To Do');
  });

  it('replaces a column with updated settings', async () => {
    await openBoard();
    const updated = columnWith({ id: 'col-todo', title: 'To Do', rank: 'h', wipLimit: 5 });
    mock.current.on('PATCH', `${COLUMNS}/col-todo/settings`, {
      status: 200,
      data: { column: updated },
    });

    await useBoardStore.getState().updateColumnSettings('col-todo', { wipLimit: 5 });

    expect(useBoardStore.getState().columns[1]).toEqual(updated);
  });

  it('keeps the last Done column when the server refuses to delete it', async () => {
    await openBoard();
    mock.current.on('DELETE', `${COLUMNS}/col-done`, {
      status: 409,
      data: errorBody('LAST_DONE_COLUMN'),
    });

    await expect(useBoardStore.getState().deleteColumn('col-done')).rejects.toThrow();
    expect(titles()).toContain('Done');
  });
});

describe('member actions', () => {
  it('adds a member in role order', async () => {
    await openBoard();
    const viewer = memberWith({ userId: 'user-2', name: 'Ola', email: 'ola@example.com' });
    mock.current.on('POST', MEMBERS, {
      status: 201,
      data: { member: { ...viewer, role: 'VIEWER' } },
    });

    await useBoardStore.getState().addMember({ email: 'ola@example.com', role: 'VIEWER' });

    expect(useBoardStore.getState().members.map((member) => member.userId)).toEqual([
      testUser.id,
      'user-2',
    ]);
  });

  it('updates the own role on the board when the current user is re-roled', async () => {
    await openBoard();
    useBoardStore.setState((state) => ({
      board: state.board && { ...state.board, role: 'ADMIN' },
      members: [memberWith({ role: 'ADMIN' })],
    }));
    mock.current.on('PATCH', `${MEMBERS}/${testUser.id}`, {
      status: 200,
      data: { member: memberWith({ role: 'MEMBER' }) },
    });

    await useBoardStore.getState().updateMemberRole(testUser.id, 'MEMBER');

    expect(useBoardStore.getState().board?.role).toBe('MEMBER');
  });

  it('leaves the board and forgets it', async () => {
    await openBoard();
    useBoardStore.setState({ boards: [boardWith(), boardWith({ id: 'board-2' })] });
    mock.current.on('DELETE', `${MEMBERS}/${testUser.id}`, { status: 204 });

    await useBoardStore.getState().leaveBoard();

    expect(useBoardStore.getState()).toMatchObject({ boardId: null, board: null, columns: [] });
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual(['board-2']);
  });
});

describe('session changes', () => {
  it('clears board data on logout and drops responses that arrive afterwards', async () => {
    await openBoard();
    useBoardStore.setState({ boards: [boardWith()] });
    const reply = deferred<MockReply>();
    mock.current.on('GET', '/boards', () => reply.promise);
    const loading = useBoardStore.getState().loadBoards();

    useAuthStore.getState().clearSession();
    reply.resolve({ status: 200, data: { boards: [boardWith()] } });
    await loading;

    expect(useBoardStore.getState()).toMatchObject({
      boards: [],
      boardsStatus: 'idle',
      boardId: null,
      board: null,
      columns: [],
      members: [],
    });
  });
});
