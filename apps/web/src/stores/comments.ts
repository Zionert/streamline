import type { BoardEvent, Comment } from '@streamline/shared';

import { getCardErrorMessage } from '@/features/cards/cardErrorMessage';
import * as commentsApi from '@/features/comments/commentsApi';
import { getApiErrorInfo } from '@/lib/api-error';

import { createPagedFeedStore } from './pagedFeed';

export interface CommentScope {
  boardId: string;
  cardId: string;
}

/** Comments of the card whose details are open, oldest first, kept up to date by live events. */
export const useCommentsStore = createPagedFeedStore<Comment, CommentScope>({
  order: 'oldest-first',
  fetchPage: async ({ boardId, cardId }, cursor) => {
    const page = await commentsApi.listComments(boardId, cardId, cursor);
    return { items: page.comments, nextCursor: page.nextCursor };
  },
  sameScope: (a, b) => a.boardId === b.boardId && a.cardId === b.cardId,
  belongs: (comment, scope) => comment.boardId === scope.boardId && comment.cardId === scope.cardId,
  // ISO timestamps of the same format compare correctly as strings.
  keepShown: (shown, received) => shown.updatedAt > received.updatedAt,
  errorMessage: getCardErrorMessage,
});

function requireScope(): CommentScope {
  const { scope } = useCommentsStore.getState();
  if (scope === null) {
    throw new Error('No card comments are open');
  }
  return scope;
}

/** Adds a comment to the open card; the server's comment is shown once (also if echoed). */
export async function postComment(body: string): Promise<Comment> {
  const { boardId, cardId } = requireScope();
  const comment = await commentsApi.createComment(boardId, cardId, body);
  useCommentsStore.getState().receive([comment]);
  return comment;
}

/**
 * Changes the body of an own comment optimistically; restores it and rethrows on failure (unless
 * a newer version arrived meanwhile). A comment deleted meanwhile disappears.
 */
export async function editComment(commentId: string, body: string): Promise<void> {
  const { boardId, cardId } = requireScope();
  const store = useCommentsStore.getState();
  const previous = store.items.find((comment) => comment.id === commentId);
  if (!previous) {
    return;
  }
  const optimistic: Comment = { ...previous, body };
  store.replace(optimistic);
  try {
    const comment = await commentsApi.updateComment(boardId, cardId, commentId, body);
    useCommentsStore.getState().receive([comment]);
  } catch (error) {
    const current = useCommentsStore.getState();
    if (getApiErrorInfo(error).status === 404) {
      current.remove(commentId);
    } else if (current.items.find((comment) => comment.id === commentId) === optimistic) {
      current.replace(previous);
    }
    throw error;
  }
}

/** Deletes a comment of the open card; a comment already deleted elsewhere just disappears. */
export async function deleteComment(commentId: string): Promise<void> {
  const { boardId, cardId } = requireScope();
  try {
    await commentsApi.deleteComment(boardId, cardId, commentId);
  } catch (error) {
    if (getApiErrorInfo(error).status !== 404) {
      throw error;
    }
  }
  useCommentsStore.getState().remove(commentId);
}

/** Applies a live comment event to the open card's comments (other cards are ignored). */
export function applyCommentEvent(event: BoardEvent): void {
  const store = useCommentsStore.getState();
  switch (event.name) {
    case 'comment:created':
    case 'comment:updated':
      store.receive([event.payload.comment]);
      return;
    case 'comment:deleted':
      if (
        store.scope !== null &&
        store.scope.boardId === event.payload.boardId &&
        store.scope.cardId === event.payload.cardId
      ) {
        store.remove(event.payload.commentId);
      }
      return;
    default:
      return;
  }
}
