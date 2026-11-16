import {
  commentListResponseSchema,
  commentResponseSchema,
  type Comment,
  type CommentListResponse,
} from '@streamline/shared';

import { api } from '@/lib/api';

const commentsUrl = (boardId: string, cardId: string) =>
  `/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(cardId)}/comments`;
const commentUrl = (boardId: string, cardId: string, commentId: string) =>
  `${commentsUrl(boardId, cardId)}/${encodeURIComponent(commentId)}`;

/** One page of the card's comments, oldest first; pass the previous `nextCursor` for the next. */
export async function listComments(
  boardId: string,
  cardId: string,
  cursor: string | null = null,
): Promise<CommentListResponse> {
  const response = await api.get<unknown>(commentsUrl(boardId, cardId), {
    params: cursor === null ? undefined : { cursor },
  });
  return commentListResponseSchema.parse(response.data);
}

export async function createComment(
  boardId: string,
  cardId: string,
  body: string,
): Promise<Comment> {
  const response = await api.post<unknown>(commentsUrl(boardId, cardId), { body });
  return commentResponseSchema.parse(response.data).comment;
}

export async function updateComment(
  boardId: string,
  cardId: string,
  commentId: string,
  body: string,
): Promise<Comment> {
  const response = await api.patch<unknown>(commentUrl(boardId, cardId, commentId), { body });
  return commentResponseSchema.parse(response.data).comment;
}

export async function deleteComment(
  boardId: string,
  cardId: string,
  commentId: string,
): Promise<void> {
  await api.delete(commentUrl(boardId, cardId, commentId));
}
