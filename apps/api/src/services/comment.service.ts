import {
  canDeleteComment,
  canEditComment,
  COMMENT_ERROR_CODES,
  formatCardKey,
  type Comment,
  type CommentListQuery,
  type CreateCommentInput,
  type UpdateCommentInput,
} from '@streamline/shared';

import { ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { noopBoardEvents, type BoardEvents, type ChangeOrigin } from '../realtime/board-events.js';
import type {
  CommentRecord,
  CommentRepository,
  CommentStore,
  LockedComment,
} from '../repositories/comment.repository.js';
import { publishActivity } from './activity-publisher.js';
import { assertBoardPermission, type BoardMembership } from './board-access.service.js';
import { CARD_NOT_FOUND_MESSAGE } from './card.service.js';
import { toPage, type Page } from './pagination.js';
import { inLockedBoard } from './ranked-write.js';

/**
 * Comments on cards. Writing requires `card:write`; only the author may edit a comment, and the
 * author or a manager (OWNER, ADMIN) may delete it (rules shared with the web client:
 * `canEditComment`, `canDeleteComment`).
 *
 * Concurrency: writes take the shared board lock, then lock the card `FOR SHARE` (a new comment
 * never lands on a card being deleted) or the comment row. A new comment is recorded in the
 * activity log in its transaction.
 */
export interface CommentService {
  /** The card's comments, oldest first. */
  list(
    membership: BoardMembership,
    cardId: string,
    query: CommentListQuery,
  ): Promise<Page<Comment>>;
  create(
    membership: BoardMembership,
    cardId: string,
    input: CreateCommentInput,
    origin?: ChangeOrigin,
  ): Promise<Comment>;
  update(
    membership: BoardMembership,
    cardId: string,
    commentId: string,
    input: UpdateCommentInput,
    origin?: ChangeOrigin,
  ): Promise<Comment>;
  delete(
    membership: BoardMembership,
    cardId: string,
    commentId: string,
    origin?: ChangeOrigin,
  ): Promise<void>;
}

export interface CommentServiceDependencies {
  comments: CommentRepository;
  events?: BoardEvents;
}

export const COMMENT_NOT_FOUND_MESSAGE = 'Comment not found';

export function toComment(comment: CommentRecord): Comment {
  return {
    id: comment.id,
    cardId: comment.cardId,
    boardId: comment.boardId,
    author: comment.author ? { id: comment.author.id, name: comment.author.name } : null,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    editedAt: comment.editedAt === null ? null : comment.editedAt.toISOString(),
  };
}

function cardNotFound(): NotFoundError {
  return new NotFoundError(CARD_NOT_FOUND_MESSAGE);
}

function commentNotFound(): NotFoundError {
  return new NotFoundError(COMMENT_NOT_FOUND_MESSAGE, COMMENT_ERROR_CODES.COMMENT_NOT_FOUND);
}

export function createCommentService({
  comments,
  events = noopBoardEvents,
}: CommentServiceDependencies): CommentService {
  /** Locks the card and the comment on it; 404 when either is missing. */
  async function lockOwnComment(
    store: CommentStore,
    { boardId }: BoardMembership,
    cardId: string,
    commentId: string,
  ): Promise<LockedComment> {
    if (!(await store.lockCard(boardId, cardId))) throw cardNotFound();
    const comment = await store.lockComment(boardId, cardId, commentId);
    if (!comment) throw commentNotFound();
    return comment;
  }

  return {
    async list(membership, cardId, { cursor, limit }) {
      assertBoardPermission(membership, 'board:view');
      if (!(await comments.cardExists(membership.boardId, cardId))) throw cardNotFound();
      const page = toPage(await comments.listForCard(cardId, { cursor, limit }), limit);
      return { items: page.items.map(toComment), nextCursor: page.nextCursor };
    },

    async create(membership, cardId, { body }, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      const { comment, activity } = await inLockedBoard(
        comments,
        boardId,
        'shared',
        async (store) => {
          const card = await store.lockCard(boardId, cardId);
          if (!card) throw cardNotFound();
          const created = await store.create({ cardId, boardId, authorId: userId, body });
          const entry = await store.recordActivity({
            boardId,
            actorId: userId,
            cardId,
            content: {
              type: 'COMMENT_ADDED',
              payload: {
                card: { key: formatCardKey(card.boardKey, card.number), title: card.title },
                commentId: created.id,
              },
            },
          });
          return { comment: created, activity: entry };
        },
      );
      const result = toComment(comment);
      events.publish('comment:created', { boardId, actorId: userId, comment: result }, origin);
      publishActivity(events, membership, activity);
      return result;
    },

    async update(membership, cardId, commentId, { body }, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      const outcome = await inLockedBoard(comments, boardId, 'shared', async (store) => {
        const existing = await lockOwnComment(store, membership, cardId, commentId);
        if (!canEditComment(membership, existing)) {
          throw new ForbiddenError(
            'Only the author can edit a comment',
            COMMENT_ERROR_CODES.COMMENT_FORBIDDEN,
          );
        }
        if (existing.body === body) {
          const current = await store.findById(commentId);
          if (!current) throw commentNotFound();
          return { comment: current, changed: false };
        }
        return { comment: await store.updateBody(commentId, body), changed: true };
      });
      const comment = toComment(outcome.comment);
      if (outcome.changed) {
        events.publish('comment:updated', { boardId, actorId: userId, comment }, origin);
      }
      return comment;
    },

    async delete(membership, cardId, commentId, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      await inLockedBoard(comments, boardId, 'shared', async (store) => {
        const existing = await lockOwnComment(store, membership, cardId, commentId);
        if (!canDeleteComment(membership, existing)) {
          throw new ForbiddenError(
            'Only the author or a board admin can delete a comment',
            COMMENT_ERROR_CODES.COMMENT_FORBIDDEN,
          );
        }
        await store.delete(commentId);
      });
      events.publish('comment:deleted', { boardId, actorId: userId, cardId, commentId }, origin);
    },
  };
}
