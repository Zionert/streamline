import type { BoardEvent, Comment } from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { commentWith, sessionWith } from '@/test/fixtures';
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
import { setupMockApi } from '@/test/renderApp';

import {
  applyCommentEvent,
  deleteComment,
  editComment,
  postComment,
  useCommentsStore,
} from './comments';

const mock = setupMockApi();

const COMMENTS = '/boards/board-1/cards/t1/comments';
const first = commentWith({ id: 'c1', cardId: 't1', createdAt: '2026-11-15T10:00:00.000Z' });
const second = commentWith({ id: 'c2', cardId: 't1', createdAt: '2026-11-15T10:05:00.000Z' });

const state = () => useCommentsStore.getState();
const bodies = () => state().items.map((comment) => comment.body);

function commentEvent(name: 'comment:created' | 'comment:updated', comment: Comment): BoardEvent {
  return { name, payload: { boardId: 'board-1', actorId: 'user-2', comment } };
}

async function openComments(comments: Comment[] = [first]) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mock.current.on('GET', COMMENTS, { status: 200, data: { comments, nextCursor: null } });
  await state().open({ boardId: 'board-1', cardId: 't1' });
}

describe('comments store', () => {
  it('posts a comment and shows it once, even when an event about it arrives too', async () => {
    await openComments();
    mock.current.on('POST', COMMENTS, { status: 201, data: { comment: second } });

    await postComment('Hello');
    applyCommentEvent(commentEvent('comment:created', second));

    expect(state().items.map((comment) => comment.id)).toEqual(['c1', 'c2']);
    expect(mock.current.requestsTo('POST', COMMENTS)[0]?.data).toEqual({ body: 'Hello' });
  });

  it('applies events of the open card only', async () => {
    await openComments();

    applyCommentEvent(
      commentEvent('comment:created', commentWith({ ...second, id: 'x', cardId: 'other' })),
    );
    applyCommentEvent({
      name: 'comment:deleted',
      payload: { boardId: 'board-1', actorId: 'user-2', cardId: 'other', commentId: 'c1' },
    });
    expect(state().items.map((comment) => comment.id)).toEqual(['c1']);

    applyCommentEvent(
      commentEvent('comment:updated', {
        ...first,
        body: 'Edited',
        updatedAt: '2026-11-15T11:00:00.000Z',
        editedAt: '2026-11-15T11:00:00.000Z',
      }),
    );
    expect(bodies()).toEqual(['Edited']);

    applyCommentEvent({
      name: 'comment:deleted',
      payload: { boardId: 'board-1', actorId: 'user-2', cardId: 't1', commentId: 'c1' },
    });
    expect(state().items).toEqual([]);
  });

  it('edits optimistically and restores the body on failure', async () => {
    await openComments();
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${COMMENTS}/c1`, () => reply.promise);

    const editing = editComment('c1', 'New text');
    expect(bodies()).toEqual(['New text']);

    reply.resolve({ status: 503, data: errorBody('BOARD_BUSY') });
    await expect(editing).rejects.toBeTruthy();
    expect(bodies()).toEqual([first.body]);
  });

  it('takes the server version after a successful edit', async () => {
    await openComments();
    const edited = { ...first, body: 'New text', editedAt: '2026-11-15T11:00:00.000Z' };
    mock.current.on('PATCH', `${COMMENTS}/c1`, { status: 200, data: { comment: edited } });

    await editComment('c1', 'New text');

    expect(state().items).toEqual([edited]);
  });

  it('deletes a comment, also one deleted elsewhere already', async () => {
    await openComments([first, second]);
    mock.current.on('DELETE', `${COMMENTS}/c1`, { status: 204 });
    mock.current.on('DELETE', `${COMMENTS}/c2`, {
      status: 404,
      data: errorBody('COMMENT_NOT_FOUND'),
    });

    await deleteComment('c1');
    await deleteComment('c2');

    expect(state().items).toEqual([]);
  });

  it('keeps a comment on a failed delete', async () => {
    await openComments();
    mock.current.on('DELETE', `${COMMENTS}/c1`, {
      status: 403,
      data: errorBody('COMMENT_FORBIDDEN'),
    });

    await expect(deleteComment('c1')).rejects.toBeTruthy();

    expect(state().items).toEqual([first]);
  });
});
