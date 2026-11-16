import type {
  BoardEvent,
  BoardEventName,
  BoardEventPayloads,
  Card,
  Column,
  Label,
} from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import { cardsOf } from '@/features/cards/cardOrder';
import { useBoardActivityStore, useCardActivityStore } from '@/stores/activity';
import { useAuthStore } from '@/stores/auth';
import { useCommentsStore } from '@/stores/comments';
import {
  activityWith,
  boardWith,
  cardListFor,
  cardWith,
  commentWith,
  defaultColumns,
  labelWith,
  memberWith,
  sessionWith,
} from '@/test/fixtures';
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
import { setupMockApi } from '@/test/renderApp';

import { useBoardStore } from './board';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const CARDS = `${BOARD}/cards`;
const LABELS = `${BOARD}/labels`;
const LATER = '2026-11-12T12:00:00.000Z';
const NEWEST = '2026-11-12T13:00:00.000Z';

const bug = labelWith({ id: 'bug', name: 'Bug', color: 'RED' });
const ui = labelWith({ id: 'ui', name: 'UI', color: 'BLUE' });
const t1 = cardWith({ id: 't1', number: 1, columnId: 'col-todo', rank: 'd', labelIds: ['bug'] });
const t2 = cardWith({ id: 't2', number: 2, columnId: 'col-todo', rank: 'k', labelIds: ['ui'] });
const p1 = cardWith({ id: 'p1', number: 3, columnId: 'col-progress', rank: 'h' });

const state = () => useBoardStore.getState();
const shown = (cardId: string) =>
  Object.values(state().cardsByColumn)
    .flat()
    .find((card) => card.id === cardId);
const labelIdsOf = (cardId: string) => shown(cardId)?.labelIds;

function event<E extends BoardEventName>(
  name: E,
  data: Omit<BoardEventPayloads[E], 'boardId' | 'actorId'>,
): BoardEvent {
  // The name and the payload match by construction.
  return { name, payload: { boardId: 'board-1', actorId: 'user-2', ...data } } as BoardEvent;
}

function mockBoard({
  cards = [t1, t2, p1],
  labels = [bug, ui],
  columns = defaultColumns(),
}: { cards?: Card[]; labels?: Label[]; columns?: Column[] } = {}) {
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith() } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns } });
  mock.current.on('GET', `${BOARD}/members`, { status: 200, data: { members: [memberWith()] } });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(columns, cards) });
  mock.current.on('GET', LABELS, { status: 200, data: { labels } });
}

async function openBoard(options?: Parameters<typeof mockBoard>[0]) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mockBoard(options);
  await state().openBoard('board-1');
}

describe('board labels', () => {
  it('loads the labels together with the board', async () => {
    await openBoard();

    expect(state().labels).toEqual([bug, ui]);
    expect(state().labelsStatus).toBe('ready');
  });

  it('keeps the board usable when the labels cannot be loaded', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mockBoard();
    mock.current.on('GET', LABELS, { status: 500, data: errorBody('INTERNAL_ERROR') });

    await state().openBoard('board-1');

    expect(state().boardStatus).toBe('ready');
    expect(state().labelsStatus).toBe('error');
    expect(state().notice).toBeNull();
  });

  it('creates, updates and deletes labels; a deleted label leaves every card', async () => {
    await openBoard();
    const docs = labelWith({ id: 'docs', name: 'Docs', color: 'GRAY' });
    mock.current.on('POST', LABELS, { status: 201, data: { label: docs } });
    const renamed = { ...bug, name: 'Defect', updatedAt: LATER };
    mock.current.on('PATCH', `${LABELS}/bug`, { status: 200, data: { label: renamed } });
    mock.current.on('DELETE', `${LABELS}/bug`, { status: 204 });

    await state().createLabel({ name: 'Docs', color: 'GRAY' });
    await state().updateLabel('bug', { name: 'Defect' });
    expect(state().labels).toEqual([renamed, ui, docs]);

    await state().deleteLabel('bug');
    expect(state().labels).toEqual([ui, docs]);
    expect(labelIdsOf('t1')).toEqual([]);
    expect(labelIdsOf('t2')).toEqual(['ui']);
  });

  it('toggles a label on a card optimistically and takes the server ids', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PUT', `${CARDS}/t1/labels/ui`, () => reply.promise);

    const toggling = state().toggleCardLabel('t1', 'ui', true);
    expect(labelIdsOf('t1')).toEqual(['bug', 'ui']);

    reply.resolve({
      status: 200,
      data: { card: { ...t1, labelIds: ['bug', 'ui'], updatedAt: LATER } },
    });
    await toggling;
    expect(shown('t1')).toMatchObject({ labelIds: ['bug', 'ui'], updatedAt: LATER });
  });

  it('puts only the toggled label back when the request fails', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('DELETE', `${CARDS}/t1/labels/bug`, () => reply.promise);
    mock.current.on('PUT', `${CARDS}/t1/labels/ui`, {
      status: 200,
      data: { card: { ...t1, labelIds: ['bug', 'ui'] } },
    });

    const removing = state().toggleCardLabel('t1', 'bug', false);
    await state().toggleCardLabel('t1', 'ui', true);
    // The earlier toggle is still in flight, so the local ids stay.
    expect(labelIdsOf('t1')).toEqual(['ui']);

    reply.resolve({ status: 409, data: errorBody('CARD_LABEL_LIMIT_REACHED') });
    await expect(removing).rejects.toBeTruthy();
    expect(labelIdsOf('t1')).toEqual(['bug', 'ui']);
  });

  it('drops a label deleted elsewhere when attaching it fails with LABEL_NOT_FOUND', async () => {
    await openBoard();
    mock.current.on('PUT', `${CARDS}/t1/labels/ui`, {
      status: 404,
      data: errorBody('LABEL_NOT_FOUND'),
    });

    await expect(state().toggleCardLabel('t1', 'ui', true)).rejects.toBeTruthy();

    expect(state().labels).toEqual([bug]);
    expect(labelIdsOf('t1')).toEqual(['bug']);
    expect(labelIdsOf('t2')).toEqual([]);
  });

  it('keeps local label ids while a toggle is in flight and a remote edit arrives', async () => {
    await openBoard();
    const reply = deferred<MockReply>();
    mock.current.on('PUT', `${CARDS}/t1/labels/ui`, () => reply.promise);

    const toggling = state().toggleCardLabel('t1', 'ui', true);
    state().applyBoardEvent(
      event('card:updated', { card: { ...t1, title: 'Remote', updatedAt: LATER } }),
    );

    expect(shown('t1')).toMatchObject({ title: 'Remote', labelIds: ['bug', 'ui'] });
    reply.resolve({
      status: 200,
      data: { card: { ...t1, title: 'Remote', labelIds: ['bug', 'ui'], updatedAt: NEWEST } },
    });
    await toggling;
    expect(shown('t1')).toMatchObject({ title: 'Remote', labelIds: ['bug', 'ui'] });
  });

  it('shows no label the server never had after overlapping toggles of it both fail', async () => {
    await openBoard();
    const attachReply = deferred<MockReply>();
    const detachReply = deferred<MockReply>();
    mock.current.on('PUT', `${CARDS}/t2/labels/bug`, () => attachReply.promise);
    mock.current.on('DELETE', `${CARDS}/t2/labels/bug`, () => detachReply.promise);

    const attaching = state().toggleCardLabel('t2', 'bug', true);
    const detaching = state().toggleCardLabel('t2', 'bug', false);
    attachReply.resolve({ status: 503, data: errorBody('BOARD_BUSY') });
    await expect(attaching).rejects.toBeTruthy();
    detachReply.resolve({ status: 503, data: errorBody('BOARD_BUSY') });
    await expect(detaching).rejects.toBeTruthy();

    expect(labelIdsOf('t2')).toEqual(['ui']);
  });

  it('keeps the newest server ids when responses arrive out of order', async () => {
    await openBoard();
    const attachReply = deferred<MockReply>();
    const detachReply = deferred<MockReply>();
    mock.current.on('PUT', `${CARDS}/t1/labels/ui`, () => attachReply.promise);
    mock.current.on('DELETE', `${CARDS}/t1/labels/bug`, () => detachReply.promise);

    const attaching = state().toggleCardLabel('t1', 'ui', true);
    const detaching = state().toggleCardLabel('t1', 'bug', false);
    // The server handled the removal first; the response of the attach is the newer version.
    attachReply.resolve({
      status: 200,
      data: { card: { ...t1, labelIds: ['ui'], updatedAt: NEWEST } },
    });
    await attaching;
    detachReply.resolve({ status: 200, data: { card: { ...t1, labelIds: [], updatedAt: LATER } } });
    await detaching;

    expect(shown('t1')).toMatchObject({ labelIds: ['ui'], updatedAt: NEWEST });
  });

  it('does not let a toggle from before a board switch disturb a new one', async () => {
    await openBoard();
    const oldReply = deferred<MockReply>();
    mock.current.on('PUT', `${CARDS}/t1/labels/ui`, () => oldReply.promise);
    const oldToggle = state().toggleCardLabel('t1', 'ui', true);

    state().forgetBoard('board-1');
    await openBoard();
    const newReply = deferred<MockReply>();
    mock.current.on('DELETE', `${CARDS}/t1/labels/bug`, () => newReply.promise);
    const newToggle = state().toggleCardLabel('t1', 'bug', false);
    oldReply.resolve({ status: 503, data: errorBody('BOARD_BUSY') });
    await expect(oldToggle).rejects.toBeTruthy();

    // The new toggle is still in flight, so a remote edit keeps the local ids.
    state().applyBoardEvent(
      event('card:updated', { card: { ...t1, title: 'Remote', updatedAt: LATER } }),
    );
    expect(shown('t1')).toMatchObject({ title: 'Remote', labelIds: [] });

    newReply.resolve({
      status: 200,
      data: { card: { ...t1, title: 'Remote', labelIds: [], updatedAt: NEWEST } },
    });
    await newToggle;
    expect(labelIdsOf('t1')).toEqual([]);
  });
});

describe('label and card events', () => {
  it('applies label events idempotently', async () => {
    await openBoard();
    const docs = labelWith({ id: 'docs', name: 'Docs' });
    const renamed = { ...ui, name: 'Frontend', updatedAt: LATER };

    state().applyBoardEvent(event('label:created', { label: docs }));
    state().applyBoardEvent(event('label:created', { label: docs }));
    state().applyBoardEvent(event('label:updated', { label: renamed }));
    // A late, older version does not undo the rename.
    state().applyBoardEvent(event('label:updated', { label: ui }));

    expect(state().labels).toEqual([bug, renamed, docs]);
  });

  it('removes a deleted label from the board and from every card', async () => {
    await openBoard();

    state().applyBoardEvent(event('label:deleted', { labelId: 'ui' }));
    state().applyBoardEvent(event('label:deleted', { labelId: 'ui' }));

    expect(state().labels).toEqual([bug]);
    expect(labelIdsOf('t2')).toEqual([]);
    expect(labelIdsOf('t1')).toEqual(['bug']);
  });

  it('takes the label ids carried by card:updated', async () => {
    await openBoard();

    state().applyBoardEvent(
      event('card:updated', { card: { ...p1, labelIds: ['bug', 'ui'], updatedAt: LATER } }),
    );

    expect(labelIdsOf('p1')).toEqual(['bug', 'ui']);
  });
});

describe('strict WIP limit', () => {
  const strictColumns = () =>
    defaultColumns().map((column) =>
      column.id === 'col-progress' ? { ...column, wipLimit: 1, wipStrict: true } : column,
    );

  it('refuses a move into a full strict column without asking the server', async () => {
    await openBoard({ columns: strictColumns() });

    await state().moveCard('t1', 'col-progress', 0);

    expect(state().notice).toBe(
      'Column "In Progress" is at its WIP limit (1). Move a card out first.',
    );
    expect(cardsOf(state().cardsByColumn, 'col-progress').map((card) => card.id)).toEqual(['p1']);
    expect(mock.current.requestsTo('PATCH', `${CARDS}/t1/move`)).toHaveLength(0);
  });

  it('still reorders within a full strict column', async () => {
    const p2 = cardWith({ id: 'p2', number: 4, columnId: 'col-progress', rank: 'k' });
    await openBoard({
      cards: [t1, p1, p2],
      columns: strictColumns().map((column) =>
        column.id === 'col-progress' ? { ...column, wipLimit: 2 } : column,
      ),
    });
    mock.current.on('PATCH', `${CARDS}/p2/move`, {
      status: 200,
      data: { card: { ...p2, rank: 'c' } },
    });

    await state().moveCard('p2', 'col-progress', 0);

    expect(cardsOf(state().cardsByColumn, 'col-progress').map((card) => card.id)).toEqual([
      'p2',
      'p1',
    ]);
  });

  it('rolls the move back with the column named when the server refuses it', async () => {
    // The local view does not know the limit yet (e.g. it was set elsewhere a moment ago).
    await openBoard();
    mock.current.on('PATCH', `${CARDS}/t1/move`, {
      status: 409,
      data: {
        error: {
          code: 'WIP_LIMIT_EXCEEDED',
          message: 'full',
          details: { columnId: 'col-progress', columnName: 'In Progress', wipLimit: 1 },
        },
      },
    });

    await state().moveCard('t1', 'col-progress', 0);

    expect(cardsOf(state().cardsByColumn, 'col-todo').map((card) => card.id)).toEqual(['t1', 't2']);
    expect(cardsOf(state().cardsByColumn, 'col-progress').map((card) => card.id)).toEqual(['p1']);
    expect(state().notice).toBe(
      'Column "In Progress" is at its WIP limit (1). Move a card out first.',
    );
  });
});

describe('feeds next to the board', () => {
  it('routes comment and activity events to the open feeds, without duplicates', async () => {
    await openBoard();
    mock.current.on('GET', `${CARDS}/t1/comments`, {
      status: 200,
      data: { comments: [], nextCursor: null },
    });
    mock.current.on('GET', `${BOARD}/activity`, {
      status: 200,
      data: { activities: [], nextCursor: null },
    });
    mock.current.on('GET', `${CARDS}/t1/activity`, {
      status: 200,
      data: { activities: [], nextCursor: null },
    });
    await useCommentsStore.getState().open({ boardId: 'board-1', cardId: 't1' });
    await useBoardActivityStore.getState().open({ boardId: 'board-1' });
    await useCardActivityStore.getState().open({ boardId: 'board-1', cardId: 't1' });
    const comment = commentWith({ id: 'c1', cardId: 't1', createdAt: LATER });
    const activity = activityWith(
      {
        type: 'COMMENT_ADDED',
        payload: { card: { key: 'SB-1', title: 'Card 1' }, commentId: 'c1' },
      },
      { id: 'a1', cardId: 't1', createdAt: LATER },
    );
    const otherCard = activityWith(
      { type: 'COLUMN_CREATED', payload: { column: { id: 'col-x', name: 'X' } } },
      { id: 'a2', createdAt: LATER },
    );

    state().applyBoardEvent(event('comment:created', { comment }));
    state().applyBoardEvent(event('activity:created', { activity }));
    state().applyBoardEvent(event('activity:created', { activity }));
    state().applyBoardEvent(event('activity:created', { activity: otherCard }));

    expect(useCommentsStore.getState().items).toEqual([comment]);
    expect(useBoardActivityStore.getState().items.map((entry) => entry.id)).toEqual(['a2', 'a1']);
    expect(useCardActivityStore.getState().items.map((entry) => entry.id)).toEqual(['a1']);
  });

  it('drops the feeds when the board is forgotten or another board opens', async () => {
    await openBoard();
    mock.current.on('GET', `${BOARD}/activity`, {
      status: 200,
      data: { activities: [], nextCursor: null },
    });
    await useBoardActivityStore.getState().open({ boardId: 'board-1' });

    state().forgetBoard('board-1');

    expect(useBoardActivityStore.getState().scope).toBeNull();
  });

  it('reloads labels and open feeds after a resync', async () => {
    await openBoard();
    mock.current.on('GET', `${BOARD}/activity`, {
      status: 200,
      data: { activities: [], nextCursor: null },
    });
    await useBoardActivityStore.getState().open({ boardId: 'board-1' });
    const docs = labelWith({ id: 'docs', name: 'Docs' });
    mock.current.on('GET', LABELS, { status: 200, data: { labels: [bug, ui, docs] } });

    await state().resyncBoard('board-1');

    expect(state().labels).toEqual([bug, ui, docs]);
    expect(mock.current.requestsTo('GET', `${BOARD}/activity`)).toHaveLength(2);
  });
});
