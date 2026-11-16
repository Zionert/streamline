import { commentSchema, type BoardRole } from '@streamline/shared';
import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../errors/app-error.js';
import type {
  CommentRecord,
  CommentRepository,
  CommentStore,
} from '../repositories/comment.repository.js';
import { fakeActivityRecord } from '../test/activity.js';
import { createRecordingBoardEvents, type RecordedBoardEvent } from '../test/board-events.js';
import type { BoardMembership } from './board-access.service.js';
import { createCommentService, toComment } from './comment.service.js';

const now = new Date('2026-11-15T10:00:00.000Z');

const record: CommentRecord = {
  id: 'comment-1',
  cardId: 'card-1',
  boardId: 'board-1',
  authorId: 'author',
  author: { id: 'author', name: 'Ann' },
  body: 'Hello',
  createdAt: now,
  updatedAt: now,
  editedAt: null,
};

function fakeStore(overrides: Partial<CommentStore> = {}): CommentStore {
  return {
    lockBoard: () => Promise.resolve(true),
    lockCard: () => Promise.resolve({ id: 'card-1', number: 3, title: 'Card', boardKey: 'SL' }),
    lockComment: () => Promise.resolve({ id: 'comment-1', authorId: 'author', body: 'Hello' }),
    create: (data) => Promise.resolve({ ...record, ...data }),
    updateBody: (_id, body) => Promise.resolve({ ...record, body, editedAt: now }),
    delete: () => Promise.resolve(),
    findById: () => Promise.resolve(record),
    recordActivity: (data) => Promise.resolve(fakeActivityRecord(data)),
    ...overrides,
  };
}

function fakeComments(
  store: CommentStore = fakeStore(),
  overrides: Partial<CommentRepository> = {},
): CommentRepository {
  return {
    transaction: (fn) => fn(store),
    cardExists: () => Promise.resolve(true),
    listForCard: () => Promise.resolve([record]),
    ...overrides,
  };
}

/** The payload of a recorded board event (`undefined` for an access revocation). */
function payloadOf(event: RecordedBoardEvent | undefined): unknown {
  return event && 'payload' in event ? event.payload : undefined;
}

const as = (role: BoardRole, userId = 'author'): BoardMembership => ({
  boardId: 'board-1',
  userId,
  role,
});

describe('CommentService', () => {
  it('maps records to the API shape', () => {
    const comment = toComment(record);
    expect(commentSchema.parse(comment)).toEqual(comment);
    expect(toComment({ ...record, authorId: null, author: null }).author).toBeNull();
  });

  it('re-checks the role even without the route guard', async () => {
    const transaction = vi.fn(() => Promise.reject(new Error('unexpected transaction')));
    const service = createCommentService({
      comments: fakeComments(fakeStore(), { transaction }),
    });

    await expect(service.create(as('VIEWER'), 'card-1', { body: 'X' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.update(as('VIEWER'), 'card-1', 'comment-1', { body: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.delete(as('VIEWER'), 'card-1', 'comment-1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('lets only the author edit (403 COMMENT_FORBIDDEN otherwise)', async () => {
    const updateBody = vi.fn(() => Promise.resolve(record));
    const service = createCommentService({ comments: fakeComments(fakeStore({ updateBody })) });

    for (const role of ['OWNER', 'ADMIN', 'MEMBER'] as const) {
      await expect(
        service.update(as(role, 'someone-else'), 'card-1', 'comment-1', { body: 'X' }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'COMMENT_FORBIDDEN' });
    }
    expect(updateBody).not.toHaveBeenCalled();
  });

  it('lets the author or a manager delete', async () => {
    const remove = vi.fn(() => Promise.resolve());
    const service = createCommentService({ comments: fakeComments(fakeStore({ delete: remove })) });

    await service.delete(as('MEMBER'), 'card-1', 'comment-1');
    await service.delete(as('ADMIN', 'admin'), 'card-1', 'comment-1');
    await service.delete(as('OWNER', 'owner'), 'card-1', 'comment-1');
    await expect(
      service.delete(as('MEMBER', 'someone-else'), 'card-1', 'comment-1'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'COMMENT_FORBIDDEN' });
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it('returns 404 for a missing card or comment', async () => {
    const noCard = createCommentService({
      comments: fakeComments(fakeStore({ lockCard: () => Promise.resolve(null) }), {
        cardExists: () => Promise.resolve(false),
      }),
    });
    const noComment = createCommentService({
      comments: fakeComments(fakeStore({ lockComment: () => Promise.resolve(null) })),
    });

    await expect(noCard.list(as('VIEWER'), 'x', { limit: 50 })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    await expect(noCard.create(as('MEMBER'), 'x', { body: 'Hi' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    await expect(noComment.delete(as('OWNER'), 'card-1', 'x')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COMMENT_NOT_FOUND',
    });
  });

  it('broadcasts changes, a new comment followed by its activity entry', async () => {
    const events = createRecordingBoardEvents();
    const service = createCommentService({ comments: fakeComments(), events });
    const origin = { socketId: 's1' };
    const meta = { boardId: 'board-1', actorId: 'author' };

    const created = await service.create(as('MEMBER'), 'card-1', { body: 'Hi' }, origin);
    const edited = await service.update(
      as('MEMBER'),
      'card-1',
      'comment-1',
      { body: 'Hi!' },
      origin,
    );
    await service.update(as('MEMBER'), 'card-1', 'comment-1', { body: 'Hello' }, origin); // No-op.
    await service.delete(as('MEMBER'), 'card-1', 'comment-1', origin);

    expect(events.events.map((event) => [event.name, event.origin])).toEqual([
      ['comment:created', origin],
      ['activity:created', undefined],
      ['comment:updated', origin],
      ['comment:deleted', origin],
    ]);
    expect(payloadOf(events.events[0])).toEqual({ ...meta, comment: created });
    expect(payloadOf(events.events[1])).toMatchObject({
      activity: {
        type: 'COMMENT_ADDED',
        cardId: 'card-1',
        payload: { card: { key: 'SL-3', title: 'Card' }, commentId: created.id },
      },
    });
    expect(payloadOf(events.events[2])).toEqual({ ...meta, comment: edited });
    expect(payloadOf(events.events[3])).toEqual({
      ...meta,
      cardId: 'card-1',
      commentId: 'comment-1',
    });
  });
});
