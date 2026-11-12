import type {
  BoardEvent,
  BoardEventName,
  BoardEventPayloads,
  Card,
  PresenceUser,
} from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import { cardsOf } from '@/features/cards/cardOrder';
import { useAuthStore } from '@/stores/auth';
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
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
import { setupMockApi } from '@/test/renderApp';

import { useBoardStore } from './board';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const CARDS = `${BOARD}/cards`;
const LATER = '2026-11-12T12:00:00.000Z';

const t1 = cardWith({ id: 't1', number: 1, columnId: 'col-todo', rank: 'd' });
const t2 = cardWith({ id: 't2', number: 2, columnId: 'col-todo', rank: 'k' });
const p1 = cardWith({ id: 'p1', number: 3, columnId: 'col-progress', rank: 'h' });
const ola = memberWith({ userId: 'user-2', name: 'Ola', email: 'ola@example.com', role: 'MEMBER' });

const state = () => useBoardStore.getState();
const columnIds = () => state().columns.map((column) => column.id);
const cardIds = (columnId: string) => cardsOf(state().cardsByColumn, columnId).map((c) => c.id);
const findShown = (cardId: string) =>
  Object.values(state().cardsByColumn)
    .flat()
    .find((card) => card.id === cardId);

/** A board event of board-1 made by Ola (another user). */
function event<E extends BoardEventName>(
  name: E,
  data: Omit<BoardEventPayloads[E], 'boardId' | 'actorId'>,
  boardId = 'board-1',
): BoardEvent {
  // The name and the payload match by construction.
  return { name, payload: { boardId, actorId: 'user-2', ...data } } as BoardEvent;
}

function mockBoard(cards: Card[] = [t1, t2, p1]) {
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith() } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: defaultColumns() } });
  mock.current.on('GET', `${BOARD}/members`, {
    status: 200,
    data: { members: [memberWith(), ola] },
  });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), cards) });
}

async function openBoard() {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mockBoard();
  mock.current.on('GET', '/boards', { status: 200, data: { boards: [boardWith()] } });
  await state().loadBoards();
  await state().openBoard('board-1');
}

describe('applying board events', () => {
  it('ignores events of another board and events without an opened board', async () => {
    const column = columnWith({ id: 'col-new', rank: 'z' });

    state().applyBoardEvent(event('column:created', { column }));
    expect(state().columns).toEqual([]);

    await openBoard();
    state().applyBoardEvent(event('column:created', { column }, 'board-2'));
    expect(columnIds()).not.toContain('col-new');
  });

  it('adds a created column at its rank, once', async () => {
    await openBoard();
    const column = columnWith({ id: 'col-new', rank: 'k' });

    state().applyBoardEvent(event('column:created', { column }));
    state().applyBoardEvent(event('column:created', { column }));

    expect(columnIds()).toEqual(['col-backlog', 'col-todo', 'col-new', 'col-progress', 'col-done']);
  });

  it('does not duplicate a column created here and announced to another tab of the user', async () => {
    await openBoard();
    const column = columnWith({ id: 'col-new', rank: 'z' });
    mock.current.on('POST', `${BOARD}/columns`, { status: 201, data: { column } });

    await state().createColumn('col-new');
    state().applyBoardEvent(event('column:created', { column }));

    expect(columnIds().filter((id) => id === 'col-new')).toHaveLength(1);
  });

  it('applies column moves, renames, rebalances and deletions', async () => {
    await openBoard();

    state().applyBoardEvent(
      event('column:moved', {
        column: { ...defaultColumns()[3]!, rank: 'b', updatedAt: LATER },
      }),
    );
    expect(columnIds()).toEqual(['col-backlog', 'col-done', 'col-todo', 'col-progress']);

    state().applyBoardEvent(
      event('column:updated', {
        column: { ...defaultColumns()[1]!, title: 'Ready', wipLimit: 5, updatedAt: LATER },
      }),
    );
    expect(state().columns[2]).toMatchObject({ id: 'col-todo', title: 'Ready', wipLimit: 5 });

    state().applyBoardEvent(
      event('columns:rebalanced', {
        ranks: [
          { id: 'col-backlog', rank: 'w' },
          { id: 'col-done', rank: 'x' },
          { id: 'col-todo', rank: 'y' },
          { id: 'col-progress', rank: 'V' },
        ],
      }),
    );
    expect(columnIds()).toEqual(['col-progress', 'col-backlog', 'col-done', 'col-todo']);

    state().applyBoardEvent(event('column:deleted', { columnId: 'col-todo' }));
    state().applyBoardEvent(event('column:deleted', { columnId: 'col-todo' }));
    expect(columnIds()).toEqual(['col-progress', 'col-backlog', 'col-done']);
    expect(state().cardsByColumn['col-todo']).toBeUndefined();
  });

  it('applies card creations, moves, rebalances and deletions idempotently', async () => {
    await openBoard();
    const created = cardWith({ id: 'n1', number: 7, columnId: 'col-todo', rank: 'g' });

    state().applyBoardEvent(event('card:created', { card: created }));
    state().applyBoardEvent(event('card:created', { card: created }));
    expect(cardIds('col-todo')).toEqual(['t1', 'n1', 't2']);

    const moved = { ...t1, columnId: 'col-done', rank: 'm', updatedAt: LATER };
    state().applyBoardEvent(event('card:moved', { card: moved }));
    state().applyBoardEvent(event('card:moved', { card: moved }));
    expect(cardIds('col-todo')).toEqual(['n1', 't2']);
    expect(cardIds('col-done')).toEqual(['t1']);

    state().applyBoardEvent(
      event('cards:rebalanced', {
        columnId: 'col-todo',
        ranks: [
          { id: 'n1', rank: 'x' },
          { id: 't2', rank: 'c' },
        ],
      }),
    );
    expect(cardIds('col-todo')).toEqual(['t2', 'n1']);

    state().applyBoardEvent(event('card:deleted', { cardId: 'n1' }));
    state().applyBoardEvent(event('card:deleted', { cardId: 'n1' }));
    state().applyBoardEvent(event('card:deleted', { cardId: 'never-existed' }));
    expect(cardIds('col-todo')).toEqual(['t2']);
    expect(state().deletedCardIds.has('n1')).toBe(true);
    expect(state().deletedCardIds.has('t2')).toBe(false);
  });

  it('does not duplicate a card created here and announced to another tab of the user', async () => {
    await openBoard();
    const card = cardWith({ id: 'n1', number: 7, columnId: 'col-todo', rank: 'z' });
    mock.current.on('POST', CARDS, { status: 201, data: { card } });

    await state().createCard('col-todo', card.title);
    state().applyBoardEvent(event('card:created', { card }));

    expect(cardIds('col-todo')).toEqual(['t1', 't2', 'n1']);
  });

  it('applies a remote edit but keeps a field with a local edit in flight', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t1`, () => reply.promise);

    const editing = state().updateCard('t1', { title: 'Local title' });
    state().applyBoardEvent(
      event('card:updated', {
        card: { ...t1, title: 'Remote title', priority: 'URGENT', updatedAt: LATER },
      }),
    );

    expect(findShown('t1')).toMatchObject({ title: 'Local title', priority: 'URGENT' });
    reply.resolve({
      status: 200,
      data: { card: { ...t1, title: 'Local title', priority: 'URGENT', updatedAt: LATER } },
    });
    await editing;
    expect(findShown('t1')).toMatchObject({ title: 'Local title', priority: 'URGENT' });
  });

  it('skips reordering events during a local column move and reloads after it', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${BOARD}/columns/col-done/move`, () => reply.promise);
    // The moved column's new rank fits its place, so only the skipped event causes a reload.
    const movedDone = { ...defaultColumns()[3]!, rank: '5', updatedAt: LATER };
    const added = columnWith({ id: 'col-new', rank: '1' });
    const remoteColumns = [added, movedDone, ...defaultColumns().slice(0, 3)];

    const moving = state().moveColumn('col-done', 0);
    state().applyBoardEvent(event('column:created', { column: added }));
    // The optimistic order stays as it is while the move is in flight.
    expect(columnIds()).toEqual(['col-done', 'col-backlog', 'col-todo', 'col-progress']);

    mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: remoteColumns } });
    reply.resolve({ status: 200, data: { column: movedDone } });
    await moving;

    expect(columnIds()).toEqual(['col-new', 'col-done', 'col-backlog', 'col-todo', 'col-progress']);
    expect(mock.current.requestsTo('GET', `${BOARD}/columns`)).toHaveLength(2);
  });

  it('skips reordering card events during a local card move and reloads the cards after it', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t1/move`, () => reply.promise);

    const moving = state().moveCard('t1', 'col-progress', 0);
    state().applyBoardEvent(
      event('card:moved', { card: { ...t2, columnId: 'col-done', rank: 'a', updatedAt: LATER } }),
    );
    expect(cardIds('col-todo')).toEqual(['t2']);

    const movedT1 = { ...t1, columnId: 'col-progress', rank: 'c', updatedAt: LATER };
    const movedT2 = { ...t2, columnId: 'col-done', rank: 'a', updatedAt: LATER };
    mock.current.on('GET', CARDS, {
      status: 200,
      data: cardListFor(defaultColumns(), [movedT1, movedT2, p1]),
    });
    reply.resolve({ status: 200, data: { card: movedT1 } });
    await moving;

    expect(cardIds('col-done')).toEqual(['t2']);
    expect(cardIds('col-progress')).toEqual(['t1', 'p1']);
  });

  it('updates the board name and key, keeping the own role and updating card keys', async () => {
    await openBoard();
    useBoardStore.setState((current) => ({
      board: current.board ? { ...current.board, role: 'MEMBER' } : null,
    }));
    const { role: _role, ...summary } = boardWith({
      name: 'Renamed',
      key: 'NEW',
      updatedAt: LATER,
    });

    state().applyBoardEvent(event('board:updated', { board: summary }));

    expect(state().board).toMatchObject({ name: 'Renamed', key: 'NEW', role: 'MEMBER' });
    expect(state().boards[0]).toMatchObject({ name: 'Renamed', key: 'NEW', role: 'OWNER' });
    expect(cardsOf(state().cardsByColumn, 'col-todo').map((card) => card.key)).toEqual([
      'NEW-1',
      'NEW-2',
    ]);
  });

  it('applies member changes, including the own role, and unassigns removed members', async () => {
    await openBoard();
    useBoardStore.setState((current) => ({
      cardsByColumn: {
        ...current.cardsByColumn,
        'col-todo': [{ ...t1, assigneeId: 'user-2' }, t2],
      },
    }));
    const piotr = memberWith({ userId: 'user-3', name: 'Piotr', role: 'VIEWER' });

    state().applyBoardEvent(event('member:added', { member: piotr }));
    state().applyBoardEvent(event('member:added', { member: piotr }));
    expect(state().members.map((member) => member.userId)).toEqual(['user-1', 'user-2', 'user-3']);

    state().applyBoardEvent(event('member:updated', { member: { ...piotr, role: 'ADMIN' } }));
    expect(state().members.map((member) => member.userId)).toEqual(['user-1', 'user-3', 'user-2']);

    state().applyBoardEvent(
      event('member:updated', { member: memberWith({ userId: testUser.id, role: 'VIEWER' }) }),
    );
    expect(state().board?.role).toBe('VIEWER');
    expect(state().boards[0]?.role).toBe('VIEWER');

    state().applyBoardEvent(event('member:removed', { userId: 'user-2' }));
    expect(state().members.map((member) => member.userId)).not.toContain('user-2');
    expect(findShown('t1')?.assigneeId).toBeNull();
  });

  it('reads the cards again when a change arrives while the card list is loading', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('GET', CARDS, () => reply.promise, {
      status: 200,
      data: cardListFor(defaultColumns(), [t1, t2, p1, { ...p1, id: 'p2', number: 9, rank: 'x' }]),
    });

    const reloading = state().reloadCards();
    state().applyBoardEvent(
      event('card:created', { card: { ...p1, id: 'p2', number: 9, rank: 'x' } }),
    );
    // The first (older) list arrives without the new card and must not remove it.
    reply.resolve({ status: 200, data: cardListFor(defaultColumns(), [t1, t2, p1]) });
    await reloading;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cardIds('col-progress')).toEqual(['p1', 'p2']);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(3);
  });
});

describe('events during the reload that follows a move', () => {
  it('applies a column event that arrives while the post-move reload is in flight', async () => {
    await openBoard();
    const moveReply = deferred<MockReply>();
    mock.current.on('PATCH', `${BOARD}/columns/col-done/move`, () => moveReply.promise);
    const movedDone = { ...defaultColumns()[3]!, rank: '5', updatedAt: LATER };
    const first = columnWith({ id: 'col-first', rank: '1' });
    const second = columnWith({ id: 'col-second', rank: 'z' });
    const reloadReply = deferred<MockReply>();
    // The reload caused by the first event was served before the second change was committed.
    mock.current.on('GET', `${BOARD}/columns`, () => reloadReply.promise, {
      status: 200,
      data: { columns: [first, movedDone, ...defaultColumns().slice(0, 3), second] },
    });

    const moving = state().moveColumn('col-done', 0);
    state().applyBoardEvent(event('column:created', { column: first }));
    moveReply.resolve({ status: 200, data: { column: movedDone } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The reload is in flight now; the second change arrives meanwhile.
    state().applyBoardEvent(event('column:created', { column: second }));
    expect(columnIds()).toContain('col-second');
    reloadReply.resolve({
      status: 200,
      data: { columns: [first, movedDone, ...defaultColumns().slice(0, 3)] },
    });
    await moving;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(columnIds()).toEqual([
      'col-first',
      'col-done',
      'col-backlog',
      'col-todo',
      'col-progress',
      'col-second',
    ]);
  });

  it('applies a card event that arrives while the post-move reload is in flight', async () => {
    await openBoard();
    const moveReply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t1/move`, () => moveReply.promise);
    const movedT1 = { ...t1, columnId: 'col-progress', rank: 'c', updatedAt: LATER };
    const created = cardWith({ id: 'n1', number: 8, columnId: 'col-done', rank: 'm' });
    const reloadReply = deferred<MockReply>();
    mock.current.on('GET', CARDS, () => reloadReply.promise, {
      status: 200,
      data: cardListFor(defaultColumns(), [movedT1, t2, p1, created]),
    });

    const moving = state().moveCard('t1', 'col-progress', 0);
    state().applyBoardEvent(event('card:moved', { card: { ...t2, rank: 'z', updatedAt: LATER } }));
    moveReply.resolve({ status: 200, data: { card: movedT1 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    state().applyBoardEvent(event('card:created', { card: created }));
    expect(cardIds('col-done')).toEqual(['n1']);
    reloadReply.resolve({ status: 200, data: cardListFor(defaultColumns(), [movedT1, t2, p1]) });
    await moving;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cardIds('col-done')).toEqual(['n1']);
    expect(cardIds('col-progress')).toEqual(['t1', 'p1']);
  });

  it('applies only the latest of overlapping column reloads', async () => {
    await openBoard();
    const older = deferred<MockReply>();
    const newer = columnWith({ id: 'col-newer', rank: 'z' });
    mock.current.on('GET', `${BOARD}/columns`, () => older.promise, {
      status: 200,
      data: { columns: [...defaultColumns(), newer] },
    });

    const first = state().reloadColumns();
    await state().reloadColumns();
    older.resolve({ status: 200, data: { columns: defaultColumns().slice(0, 2) } });
    await first;

    expect(columnIds()).toEqual([
      'col-backlog',
      'col-todo',
      'col-progress',
      'col-done',
      'col-newer',
    ]);
  });
});

describe('resyncBoard', () => {
  it('is not overwritten by an older snapshot of the board that is still opening', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mockBoard();
    const slowBoard = deferred<MockReply>();
    mock.current.on('GET', BOARD, () => slowBoard.promise, {
      status: 200,
      data: { board: boardWith({ name: 'Newer' }) },
    });

    const opening = state().openBoard('board-1');
    await expect(state().resyncBoard('board-1')).resolves.toBe('ok');
    slowBoard.resolve({ status: 200, data: { board: boardWith({ name: 'Older' }) } });
    await opening;

    expect(state().board?.name).toBe('Newer');
    expect(state().boardStatus).toBe('ready');
  });

  it('ignores a board that is not the opened one', async () => {
    await openBoard();

    await expect(state().resyncBoard('board-2')).resolves.toBe('ok');
    expect(mock.current.requestsTo('GET', BOARD)).toHaveLength(1);
  });

  it('leaves the lists with a move in flight to the reload after the move', async () => {
    await openBoard();
    const moveReply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t1/move`, () => moveReply.promise);
    const movedT1 = { ...t1, columnId: 'col-progress', rank: 'c', updatedAt: LATER };

    const moving = state().moveCard('t1', 'col-progress', 0);
    await state().resyncBoard('board-1');
    // The optimistic position is kept and the cards were not read during the move.
    expect(cardIds('col-progress')).toEqual(['t1', 'p1']);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(1);

    mock.current.on('GET', CARDS, {
      status: 200,
      data: cardListFor(defaultColumns(), [movedT1, t2, p1]),
    });
    moveReply.resolve({ status: 200, data: { card: movedT1 } });
    await moving;

    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(2);
  });

  it('reloads the board, columns, members and cards without a loading state', async () => {
    await openBoard();
    const moved = { ...t1, columnId: 'col-done', rank: 'a' };
    mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ name: 'Fresh' }) } });
    mock.current.on('GET', CARDS, {
      status: 200,
      data: cardListFor(defaultColumns(), [moved, t2, p1]),
    });
    mock.current.on('GET', `${BOARD}/members`, { status: 200, data: { members: [memberWith()] } });

    const resyncing = state().resyncBoard('board-1');
    expect(state().boardStatus).toBe('ready');

    await expect(resyncing).resolves.toBe('ok');
    expect(state().board?.name).toBe('Fresh');
    expect(cardIds('col-done')).toEqual(['t1']);
    expect(state().members).toHaveLength(1);
  });

  it('reports a board that is gone as access-lost', async () => {
    await openBoard();
    mock.current.on('GET', BOARD, { status: 404, data: errorBody('NOT_FOUND') });

    await expect(state().resyncBoard('board-1')).resolves.toBe('access-lost');
  });

  it('keeps the board and sets a notice on other failures', async () => {
    await openBoard();
    mock.current.on('GET', `${BOARD}/columns`, { status: 500, data: errorBody('INTERNAL') });

    await expect(state().resyncBoard('board-1')).resolves.toBe('error');
    expect(state().boardStatus).toBe('ready');
    expect(state().notice).not.toBeNull();
  });
});

describe('forgetBoard and presence', () => {
  const ann: PresenceUser = { id: 'user-9', name: 'Ann' };

  it('forgets the opened board and removes it from the list', async () => {
    await openBoard();

    state().forgetBoard('board-1');

    expect(state()).toMatchObject({ boardId: null, board: null, boards: [] });
  });

  it('keeps presence of the opened board only', async () => {
    await openBoard();

    state().setPresence('board-2', [ann]);
    expect(state().presence).toEqual([]);
    state().setPresence('board-1', [ann]);
    expect(state().presence).toEqual([ann]);
  });
});
