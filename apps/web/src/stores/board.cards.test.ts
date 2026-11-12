import type { Card } from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import { cardsOf } from '@/features/cards/cardOrder';
import { useAuthStore } from '@/stores/auth';
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

import { useBoardStore } from './board';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const CARDS = `${BOARD}/cards`;

const t1 = cardWith({ id: 't1', number: 1, columnId: 'col-todo', rank: 'd' });
const t2 = cardWith({ id: 't2', number: 2, columnId: 'col-todo', rank: 'k' });
const t3 = cardWith({ id: 't3', number: 3, columnId: 'col-todo', rank: 's' });
const p1 = cardWith({ id: 'p1', number: 4, columnId: 'col-progress', rank: 'h' });
const initialCards = [t1, t2, t3, p1];

const ids = (columnId: string) =>
  cardsOf(useBoardStore.getState().cardsByColumn, columnId).map((card) => card.id);

function mockBoard(cards: Card[] = initialCards) {
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith() } });
  mock.current.on('GET', `${BOARD}/columns`, {
    status: 200,
    data: { columns: defaultColumns() },
  });
  mock.current.on('GET', `${BOARD}/members`, {
    status: 200,
    data: {
      members: [memberWith(), memberWith({ userId: 'user-2', name: 'Ola', role: 'MEMBER' })],
    },
  });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), cards) });
}

async function openBoard(cards?: Card[]) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mockBoard(cards);
  await useBoardStore.getState().openBoard('board-1');
}

describe('loading cards', () => {
  it('loads the cards of every column, sorted by rank, together with the board', async () => {
    await openBoard([t3, p1, t1, t2]);

    expect(useBoardStore.getState().cardsStatus).toBe('ready');
    expect(ids('col-todo')).toEqual(['t1', 't2', 't3']);
    expect(ids('col-progress')).toEqual(['p1']);
    expect(ids('col-done')).toEqual([]);
  });

  it('is loading until the cards arrive and shows the board meanwhile', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mockBoard();
    const reply = deferred<MockReply>();
    mock.current.on('GET', CARDS, () => reply.promise);

    const opening = useBoardStore.getState().openBoard('board-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useBoardStore.getState()).toMatchObject({
      boardStatus: 'ready',
      cardsStatus: 'loading',
    });
    reply.resolve({ status: 200, data: cardListFor(defaultColumns(), initialCards) });
    await opening;
    expect(useBoardStore.getState().cardsStatus).toBe('ready');
  });

  it('marks a failed first load as an error without a notice', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mockBoard();
    mock.current.on('GET', CARDS, { status: 503, data: errorBody('BOARD_BUSY') });

    await useBoardStore.getState().openBoard('board-1');

    // The page shows the failure inline (with a retry), so no toast is needed.
    expect(useBoardStore.getState().cardsStatus).toBe('error');
    expect(useBoardStore.getState().notice).toBeNull();
  });

  it('keeps the shown cards and reports a failed reload as a notice', async () => {
    await openBoard();
    mock.current.on('GET', CARDS, { status: 503, data: errorBody('BOARD_BUSY') });

    await useBoardStore.getState().reloadCards();

    expect(useBoardStore.getState().cardsStatus).toBe('ready');
    expect(ids('col-todo')).toEqual(['t1', 't2', 't3']);
    expect(useBoardStore.getState().notice).toMatch(/busy/i);
  });

  it('drops the cards of a board opened earlier', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mockBoard();
    const slow = deferred<MockReply>();
    mock.current.on('GET', CARDS, () => slow.promise);
    const first = useBoardStore.getState().openBoard('board-1');

    mock.current.on('GET', '/boards/board-2', {
      status: 200,
      data: { board: boardWith({ id: 'board-2' }) },
    });
    mock.current.on('GET', '/boards/board-2/columns', { status: 200, data: { columns: [] } });
    mock.current.on('GET', '/boards/board-2/members', { status: 200, data: { members: [] } });
    mock.current.on('GET', '/boards/board-2/cards', { status: 200, data: { columns: [] } });
    await useBoardStore.getState().openBoard('board-2');
    slow.resolve({ status: 200, data: cardListFor(defaultColumns(), initialCards) });
    await first;

    expect(useBoardStore.getState().boardId).toBe('board-2');
    expect(useBoardStore.getState().cardsByColumn).toEqual({});
  });

  it('applies only the latest of overlapping reloads', async () => {
    await openBoard();
    const older = deferred<MockReply>();
    mock.current.on('GET', CARDS, () => older.promise, {
      status: 200,
      data: cardListFor(defaultColumns(), [t1]),
    });

    const first = useBoardStore.getState().reloadCards();
    await useBoardStore.getState().reloadCards();
    older.resolve({ status: 200, data: cardListFor(defaultColumns(), initialCards) });
    await first;

    expect(ids('col-todo')).toEqual(['t1']);
  });

  it('forgets the cards on logout', async () => {
    await openBoard();

    useAuthStore.getState().clearSession();

    expect(useBoardStore.getState()).toMatchObject({ cardsByColumn: {}, cardsStatus: 'idle' });
  });
});

describe('createCard', () => {
  it('appends the card without a reload when its rank fits', async () => {
    await openBoard();
    const created = cardWith({ id: 'new', number: 5, columnId: 'col-todo', rank: 'w' });
    mock.current.on('POST', CARDS, { status: 201, data: { card: created } });

    await useBoardStore.getState().createCard('col-todo', 'New card');

    expect(mock.current.requestsTo('POST', CARDS)[0]?.data).toEqual({
      columnId: 'col-todo',
      title: 'New card',
    });
    expect(ids('col-todo')).toEqual(['t1', 't2', 't3', 'new']);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(1);
  });

  it('reloads the cards when the created card shows a server-side rebalance', async () => {
    await openBoard();
    const rebalanced = [
      { ...t1, rank: '1' },
      { ...t2, rank: '2' },
      { ...t3, rank: '3' },
      cardWith({ id: 'new', number: 5, columnId: 'col-todo', rank: '4' }),
      p1,
    ];
    mock.current.on('POST', CARDS, { status: 201, data: { card: rebalanced[3] } });
    mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), rebalanced) });

    await useBoardStore.getState().createCard('col-todo', 'New card');

    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(2);
    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo').map((c) => c.rank)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });

  it('reloads the columns and the cards and rethrows 404 COLUMN_NOT_FOUND', async () => {
    await openBoard();
    const remaining = defaultColumns().filter((column) => column.id !== 'col-done');
    mock.current.on('POST', CARDS, { status: 404, data: errorBody('COLUMN_NOT_FOUND') });
    mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: remaining } });
    mock.current.on('GET', CARDS, { status: 200, data: cardListFor(remaining, initialCards) });

    await expect(useBoardStore.getState().createCard('col-done', 'Late')).rejects.toThrow();

    expect(useBoardStore.getState().columns.map((column) => column.id)).not.toContain('col-done');
    expect(useBoardStore.getState().notice).toBe(
      'This column no longer exists. The board has been refreshed.',
    );
    expect(mock.current.requestsTo('GET', `${BOARD}/columns`)).toHaveLength(2);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(2);
  });

  it('reads the list again when a list request was in flight while creating', async () => {
    await openBoard();
    const created = cardWith({ id: 'new', number: 5, columnId: 'col-todo', rank: 'w' });
    const listReply = deferred<MockReply>();
    mock.current.on('GET', CARDS, () => listReply.promise, {
      status: 200,
      data: cardListFor(defaultColumns(), [...initialCards, created]),
    });
    mock.current.on('POST', CARDS, { status: 201, data: { card: created } });

    const reloading = useBoardStore.getState().reloadCards();
    await useBoardStore.getState().createCard('col-todo', 'New card');
    // The older list (read before the card existed) arrives last and must be ignored.
    listReply.resolve({ status: 200, data: cardListFor(defaultColumns(), initialCards) });
    await reloading;

    expect(ids('col-todo')).toEqual(['t1', 't2', 't3', 'new']);
    expect(useBoardStore.getState().cardsStatus).toBe('ready');
  });

  it('rethrows WIP_LIMIT_EXCEEDED and adds nothing', async () => {
    await openBoard();
    mock.current.on('POST', CARDS, { status: 409, data: errorBody('WIP_LIMIT_EXCEEDED') });

    await expect(useBoardStore.getState().createCard('col-progress', 'Too many')).rejects.toThrow();
    expect(ids('col-progress')).toEqual(['p1']);
  });
});

describe('moveCard', () => {
  it('moves to another column optimistically and sends both neighbours', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t2/move`, () => reply.promise);

    const moving = useBoardStore.getState().moveCard('t2', 'col-progress', 1);

    expect(ids('col-todo')).toEqual(['t1', 't3']);
    expect(ids('col-progress')).toEqual(['p1', 't2']);
    expect(useBoardStore.getState().isMovingCard).toBe(true);
    reply.resolve({ status: 200, data: { card: { ...t2, columnId: 'col-progress', rank: 'p' } } });
    await moving;

    expect(mock.current.requestsTo('PATCH', `${CARDS}/t2/move`)[0]?.data).toEqual({
      columnId: 'col-progress',
      afterId: 'p1',
      beforeId: null,
    });
    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-progress')[1]).toMatchObject({
      id: 't2',
      columnId: 'col-progress',
      rank: 'p',
    });
    expect(useBoardStore.getState().isMovingCard).toBe(false);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(1);
  });

  it('reorders within a column and sends null for the open end', async () => {
    await openBoard();
    mock.current.on('PATCH', `${CARDS}/t3/move`, {
      status: 200,
      data: { card: { ...t3, rank: 'b' } },
    });

    await useBoardStore.getState().moveCard('t3', 'col-todo', 0);

    expect(mock.current.requestsTo('PATCH', `${CARDS}/t3/move`)[0]?.data).toEqual({
      columnId: 'col-todo',
      afterId: null,
      beforeId: 't1',
    });
    expect(ids('col-todo')).toEqual(['t3', 't1', 't2']);
  });

  it('moves into an empty column with no neighbours', async () => {
    await openBoard();
    mock.current.on('PATCH', `${CARDS}/t1/move`, {
      status: 200,
      data: { card: { ...t1, columnId: 'col-done', rank: 'h' } },
    });

    await useBoardStore.getState().moveCard('t1', 'col-done', 0);

    expect(mock.current.requestsTo('PATCH', `${CARDS}/t1/move`)[0]?.data).toEqual({
      columnId: 'col-done',
      afterId: null,
      beforeId: null,
    });
    expect(ids('col-done')).toEqual(['t1']);
  });

  it('rolls back only the moved card on WIP_LIMIT_EXCEEDED without a reload', async () => {
    await openBoard();
    mock.current.on('PATCH', `${CARDS}/t1/move`, {
      status: 409,
      data: errorBody('WIP_LIMIT_EXCEEDED'),
    });

    await useBoardStore.getState().moveCard('t1', 'col-progress', 0);

    expect(ids('col-todo')).toEqual(['t1', 't2', 't3']);
    expect(ids('col-progress')).toEqual(['p1']);
    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo')[0]).toEqual(t1);
    expect(useBoardStore.getState().notice).toBe('This column has reached its WIP limit.');
    expect(useBoardStore.getState().isMovingCard).toBe(false);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(1);
  });

  it('keeps an edit made while the failed move was in flight', async () => {
    await openBoard();
    const moveReply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t1/move`, () => moveReply.promise);
    mock.current.on('PATCH', `${CARDS}/t1`, {
      status: 200,
      data: { card: { ...t1, columnId: 'col-done', title: 'Renamed' } },
    });

    const moving = useBoardStore.getState().moveCard('t1', 'col-done', 0);
    await useBoardStore.getState().updateCard('t1', { title: 'Renamed' });
    moveReply.resolve({ status: 503, data: errorBody('BOARD_BUSY') });
    await moving;

    expect(ids('col-todo')).toEqual(['t1', 't2', 't3']);
    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo')[0]).toMatchObject({
      title: 'Renamed',
      columnId: 'col-todo',
      rank: 'd',
    });
  });

  it.each([
    [409, 'INVALID_POSITION'],
    [404, 'NEIGHBOR_NOT_FOUND'],
    [404, 'NOT_FOUND'],
  ])('reloads the cards after %i %s', async (status, code) => {
    await openBoard();
    const elsewhere = cardWith({ id: 'x', number: 9, columnId: 'col-todo', rank: 'f' });
    mock.current.on('PATCH', `${CARDS}/t3/move`, { status, data: errorBody(code) });
    mock.current.on('GET', CARDS, {
      status: 200,
      data: cardListFor(defaultColumns(), [...initialCards, elsewhere]),
    });

    await useBoardStore.getState().moveCard('t3', 'col-todo', 0);

    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(2);
    expect(ids('col-todo')).toEqual(['t1', 'x', 't2', 't3']);
    expect(useBoardStore.getState().notice).not.toBeNull();
    expect(useBoardStore.getState().isMovingCard).toBe(false);
  });

  it('reloads the cards when the returned rank shows a server-side rebalance', async () => {
    await openBoard();
    // Moved between t1 (d) and t2 (k), but the server rebalanced the column: '2' does not fit.
    const rebalanced = [{ ...t1, rank: '1' }, { ...t3, rank: '2' }, { ...t2, rank: '3' }, p1];
    mock.current.on('PATCH', `${CARDS}/t3/move`, { status: 200, data: { card: rebalanced[1] } });
    mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), rebalanced) });

    await useBoardStore.getState().moveCard('t3', 'col-todo', 1);

    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(2);
    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo').map((c) => c.rank)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(ids('col-todo')).toEqual(['t1', 't3', 't2']);
  });

  it('compares ranks by code units, not by locale', async () => {
    await openBoard([
      cardWith({ id: 'u', number: 1, columnId: 'col-todo', rank: 'B' }),
      cardWith({ id: 'l', number: 2, columnId: 'col-todo', rank: 'a' }),
      cardWith({ id: 'm', number: 3, columnId: 'col-todo', rank: 'c' }),
    ]);
    // 'Z' < 'a' in code unit order, so the moved card fits between 'B' and 'a' (no reload),
    // although localeCompare would place 'Z' after 'a'.
    mock.current.on('PATCH', `${CARDS}/m/move`, {
      status: 200,
      data: { card: cardWith({ id: 'm', number: 3, columnId: 'col-todo', rank: 'Z' }) },
    });

    await useBoardStore.getState().moveCard('m', 'col-todo', 1);

    expect(ids('col-todo')).toEqual(['u', 'm', 'l']);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(1);
  });

  it('ignores a move to the same place and a move while another one is saving', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t1/move`, () => reply.promise);

    await useBoardStore.getState().moveCard('t2', 'col-todo', 1);
    const moving = useBoardStore.getState().moveCard('t1', 'col-done', 0);
    await useBoardStore.getState().moveCard('t3', 'col-done', 0);
    reply.resolve({ status: 200, data: { card: { ...t1, columnId: 'col-done' } } });
    await moving;

    expect(mock.current.requests.filter((request) => request.method === 'PATCH')).toHaveLength(1);
    expect(ids('col-done')).toEqual(['t1']);
  });

  it('drops a card list requested before the move and reads it again afterwards', async () => {
    await openBoard();
    const movedT1 = { ...t1, columnId: 'col-done', rank: 'h' };
    const listReply = deferred<MockReply>();
    mock.current.on('GET', CARDS, () => listReply.promise, {
      status: 200,
      data: cardListFor(defaultColumns(), [t2, t3, p1, movedT1]),
    });
    mock.current.on('PATCH', `${CARDS}/t1/move`, { status: 200, data: { card: movedT1 } });

    const reloading = useBoardStore.getState().reloadCards();
    await useBoardStore.getState().moveCard('t1', 'col-done', 0);
    listReply.resolve({ status: 200, data: cardListFor(defaultColumns(), initialCards) });
    await reloading;

    expect(ids('col-done')).toEqual(['t1']);
    expect(ids('col-todo')).toEqual(['t2', 't3']);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(3);
    expect(useBoardStore.getState().cardsStatus).toBe('ready');
  });

  it('reloads the columns and the cards after 404 COLUMN_NOT_FOUND', async () => {
    await openBoard();
    const remaining = defaultColumns().filter((column) => column.id !== 'col-done');
    mock.current.on('PATCH', `${CARDS}/t1/move`, {
      status: 404,
      data: errorBody('COLUMN_NOT_FOUND'),
    });
    mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: remaining } });
    mock.current.on('GET', CARDS, { status: 200, data: cardListFor(remaining, initialCards) });

    await useBoardStore.getState().moveCard('t1', 'col-done', 0);

    expect(useBoardStore.getState().columns.map((column) => column.id)).not.toContain('col-done');
    expect(ids('col-todo')).toEqual(['t1', 't2', 't3']);
    expect(useBoardStore.getState().notice).toBe(
      'This column no longer exists. The board has been refreshed.',
    );
    expect(mock.current.requestsTo('GET', `${BOARD}/columns`)).toHaveLength(2);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(2);
  });
});

describe('card edits', () => {
  it('updates optimistically and keeps the server version', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t1`, () => reply.promise);

    const updating = useBoardStore.getState().updateCard('t1', { priority: 'HIGH' });
    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo')[0]?.priority).toBe('HIGH');
    reply.resolve({
      status: 200,
      data: { card: { ...t1, priority: 'HIGH', updatedAt: '2026-11-12T10:00:00.000Z' } },
    });
    await updating;

    expect(mock.current.requestsTo('PATCH', `${CARDS}/t1`)[0]?.data).toEqual({ priority: 'HIGH' });
    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo')[0]?.updatedAt).toBe(
      '2026-11-12T10:00:00.000Z',
    );
  });

  it('restores only the failed fields and rethrows ASSIGNEE_NOT_MEMBER', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t1`, () => reply.promise);
    mock.current.on('PATCH', `${CARDS}/t2`, { status: 200, data: { card: t2 } });

    const assigning = useBoardStore.getState().updateCard('t1', { assigneeId: 'stranger' });
    useBoardStore.setState((state) => ({
      cardsByColumn: {
        ...state.cardsByColumn,
        'col-todo': cardsOf(state.cardsByColumn, 'col-todo').map((card) =>
          card.id === 't1' ? { ...card, title: 'Edited meanwhile' } : card,
        ),
      },
    }));
    reply.resolve({ status: 400, data: errorBody('ASSIGNEE_NOT_MEMBER') });

    await expect(assigning).rejects.toThrow();
    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo')[0]).toMatchObject({
      assigneeId: null,
      title: 'Edited meanwhile',
    });
  });

  it('applies only the latest of overlapping edits when responses arrive in reverse order', async () => {
    await openBoard();
    const first = deferred<MockReply>();
    const second = deferred<MockReply>();
    mock.current.on(
      'PATCH',
      `${CARDS}/t1`,
      () => first.promise,
      () => second.promise,
    );

    const older = useBoardStore.getState().updateCard('t1', { dueDate: '0202-01-01' });
    const newer = useBoardStore.getState().updateCard('t1', { dueDate: '2026-01-01' });
    second.resolve({ status: 200, data: { card: { ...t1, dueDate: '2026-01-01' } } });
    await newer;
    first.resolve({ status: 200, data: { card: { ...t1, dueDate: '0202-01-01' } } });
    await older;

    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo')[0]?.dueDate).toBe(
      '2026-01-01',
    );
  });

  it('does not let an older failed edit undo a newer successful one', async () => {
    await openBoard();
    const first = deferred<MockReply>();
    const second = deferred<MockReply>();
    mock.current.on(
      'PATCH',
      `${CARDS}/t1`,
      () => first.promise,
      () => second.promise,
    );

    const older = useBoardStore.getState().updateCard('t1', { priority: 'LOW' });
    const newer = useBoardStore.getState().updateCard('t1', { priority: 'URGENT' });
    second.resolve({ status: 200, data: { card: { ...t1, priority: 'URGENT' } } });
    await newer;
    first.resolve({ status: 503, data: errorBody('BOARD_BUSY') });
    await expect(older).rejects.toThrow();

    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo')[0]?.priority).toBe('URGENT');
  });

  it('keeps a field edited meanwhile when an edit of another field responds', async () => {
    await openBoard();
    const titleReply = deferred<MockReply>();
    const priorityReply = deferred<MockReply>();
    mock.current.on(
      'PATCH',
      `${CARDS}/t1`,
      () => titleReply.promise,
      () => priorityReply.promise,
    );

    const titleEdit = useBoardStore.getState().updateCard('t1', { title: 'New title' });
    const priorityEdit = useBoardStore.getState().updateCard('t1', { priority: 'HIGH' });
    // The title response does not know about the priority edit still in flight.
    titleReply.resolve({ status: 200, data: { card: { ...t1, title: 'New title' } } });
    await titleEdit;

    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo')[0]).toMatchObject({
      title: 'New title',
      priority: 'HIGH',
    });
    priorityReply.resolve({
      status: 200,
      data: { card: { ...t1, title: 'New title', priority: 'HIGH' } },
    });
    await priorityEdit;
  });

  it('removes the card when an edit finds it deleted elsewhere', async () => {
    await openBoard();
    mock.current.on('PATCH', `${CARDS}/t2`, { status: 404, data: errorBody('NOT_FOUND') });

    await expect(useBoardStore.getState().updateCard('t2', { title: 'Gone' })).rejects.toThrow();

    expect(ids('col-todo')).toEqual(['t1', 't3']);
  });

  it('removes a deleted card and keeps it when deleting fails', async () => {
    await openBoard();
    mock.current.on(
      'DELETE',
      `${CARDS}/t2`,
      { status: 503, data: errorBody('BOARD_BUSY') },
      { status: 204 },
    );

    await expect(useBoardStore.getState().deleteCard('t2')).rejects.toThrow();
    expect(ids('col-todo')).toEqual(['t1', 't2', 't3']);

    await useBoardStore.getState().deleteCard('t2');
    expect(ids('col-todo')).toEqual(['t1', 't3']);
  });

  it('remembers a card loaded on its own at its rank', async () => {
    await openBoard();

    useBoardStore
      .getState()
      .rememberCard(cardWith({ id: 'late', number: 9, columnId: 'col-todo', rank: 'm' }));
    useBoardStore
      .getState()
      .rememberCard(
        cardWith({ id: 'other', number: 1, columnId: 'col-todo', rank: 'a', boardId: 'board-2' }),
      );

    expect(ids('col-todo')).toEqual(['t1', 't2', 'late', 't3']);
  });

  it('unassigns the cards of a removed member', async () => {
    await openBoard([{ ...t1, assigneeId: 'user-2' }, t2]);
    mock.current.on('DELETE', `${BOARD}/members/user-2`, { status: 204 });

    await useBoardStore.getState().removeMember('user-2');

    expect(cardsOf(useBoardStore.getState().cardsByColumn, 'col-todo')[0]?.assigneeId).toBeNull();
  });

  it('keeps a column with cards when the server answers COLUMN_NOT_EMPTY', async () => {
    await openBoard();
    mock.current.on('DELETE', `${BOARD}/columns/col-todo`, {
      status: 409,
      data: errorBody('COLUMN_NOT_EMPTY'),
    });

    await expect(useBoardStore.getState().deleteColumn('col-todo')).rejects.toThrow();
    expect(ids('col-todo')).toEqual(['t1', 't2', 't3']);
  });
});
