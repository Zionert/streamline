import { z } from 'zod';

import { pageQuerySchema } from './pagination.js';
import { userRefSchema } from './user-ref.js';

export const COMMENT_BODY_MAX_LENGTH = 5000;

/** Comments returned per page when the request gives no `limit`. */
export const COMMENTS_PAGE_DEFAULT_LIMIT = 50;
export const COMMENTS_PAGE_MAX_LIMIT = 100;

/** Trimmed, 1–5000 characters (plain text). */
export const commentBodySchema = z
  .string()
  .trim()
  .min(1, 'Comment is required')
  .max(COMMENT_BODY_MAX_LENGTH, `Comment must be at most ${COMMENT_BODY_MAX_LENGTH} characters`);

/** Body of `POST /boards/:boardId/cards/:cardId/comments`. */
export const createCommentSchema = z.strictObject({
  body: commentBodySchema,
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;

/** Body of `PATCH /boards/:boardId/cards/:cardId/comments/:commentId` (author only). */
export const updateCommentSchema = z.strictObject({
  body: commentBodySchema,
});

export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

/**
 * Query of `GET /boards/:boardId/cards/:cardId/comments`: comments in chronological order
 * (oldest first), `limit` per page (default 50, at most 100), `cursor` from the previous page.
 */
export const commentListQuerySchema = pageQuerySchema(
  COMMENTS_PAGE_DEFAULT_LIMIT,
  COMMENTS_PAGE_MAX_LIMIT,
);

export type CommentListQuery = z.infer<typeof commentListQuerySchema>;

export const commentSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  boardId: z.string(),
  /** `null` when the author's account no longer exists. */
  author: userRefSchema.nullable(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** When the author last changed the body; `null` for a comment never edited. */
  editedAt: z.iso.datetime().nullable(),
});

export type Comment = z.infer<typeof commentSchema>;

/** Response body of `POST` and `PATCH` on comments. */
export const commentResponseSchema = z.object({
  comment: commentSchema,
});

export type CommentResponse = z.infer<typeof commentResponseSchema>;

/**
 * Response body of `GET .../comments`: one page of comments, oldest first; `nextCursor` is `null`
 * on the last page.
 */
export const commentListResponseSchema = z.object({
  comments: z.array(commentSchema),
  nextCursor: z.string().nullable(),
});

export type CommentListResponse = z.infer<typeof commentListResponseSchema>;

/** Error codes specific to the comment endpoints (besides the generic ones). */
export const COMMENT_ERROR_CODES = {
  /** 404: the comment is not a comment of this card (or of this board). */
  COMMENT_NOT_FOUND: 'COMMENT_NOT_FOUND',
  /** 403: only the author may edit a comment; only the author or a manager may delete it. */
  COMMENT_FORBIDDEN: 'COMMENT_FORBIDDEN',
} as const;

export type CommentErrorCode = (typeof COMMENT_ERROR_CODES)[keyof typeof COMMENT_ERROR_CODES];
