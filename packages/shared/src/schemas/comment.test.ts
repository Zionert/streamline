import { describe, expect, it } from 'vitest';

import {
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_ERROR_CODES,
  commentListQuerySchema,
  commentListResponseSchema,
  commentResponseSchema,
  commentSchema,
  COMMENTS_PAGE_DEFAULT_LIMIT,
  COMMENTS_PAGE_MAX_LIMIT,
  createCommentSchema,
  updateCommentSchema,
} from './comment.js';

const TIMESTAMP = '2026-11-15T10:00:00.000Z';

const validComment = {
  id: 'comment-1',
  cardId: 'card-1',
  boardId: 'board-1',
  author: { id: 'u1', name: 'Ann' },
  body: 'Looks good',
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  editedAt: null,
};

describe('createCommentSchema and updateCommentSchema', () => {
  it.each([createCommentSchema, updateCommentSchema])('trims the body', (schema) => {
    expect(schema.parse({ body: '  Hello\nworld  ' })).toEqual({ body: 'Hello\nworld' });
  });

  it('accepts the maximum length', () => {
    const body = 'x'.repeat(COMMENT_BODY_MAX_LENGTH);
    expect(createCommentSchema.parse({ body }).body).toBe(body);
  });

  it.each([
    {},
    { body: '' },
    { body: '  \n ' },
    { body: 'x'.repeat(COMMENT_BODY_MAX_LENGTH + 1) },
    { body: 'ok', authorId: 'u2' },
  ])('rejects %j', (body) => {
    expect(createCommentSchema.safeParse(body).success).toBe(false);
    expect(updateCommentSchema.safeParse(body).success).toBe(false);
  });
});

describe('commentListQuerySchema', () => {
  it('defaults to 50 per page and caps at 100', () => {
    expect(commentListQuerySchema.parse({})).toEqual({ limit: COMMENTS_PAGE_DEFAULT_LIMIT });
    expect(commentListQuerySchema.parse({ limit: '100' }).limit).toBe(COMMENTS_PAGE_MAX_LIMIT);
    expect(commentListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('comment response schemas', () => {
  it('accepts a comment, an edited comment and one without an author', () => {
    expect(commentResponseSchema.parse({ comment: validComment }).comment).toEqual(validComment);
    expect(commentSchema.safeParse({ ...validComment, editedAt: TIMESTAMP }).success).toBe(true);
    expect(commentSchema.safeParse({ ...validComment, author: null }).success).toBe(true);
  });

  it('accepts a page with or without a next cursor', () => {
    expect(
      commentListResponseSchema.safeParse({ comments: [validComment], nextCursor: '1_c' }).success,
    ).toBe(true);
    expect(commentListResponseSchema.safeParse({ comments: [], nextCursor: null }).success).toBe(
      true,
    );
  });

  it.each([{ author: { id: 'u1' } }, { editedAt: undefined }, { body: 5 }])(
    'rejects a comment with %j',
    (patch) => {
      expect(commentSchema.safeParse({ ...validComment, ...patch }).success).toBe(false);
    },
  );
});

describe('COMMENT_ERROR_CODES', () => {
  it('uses the key as the code', () => {
    for (const [key, value] of Object.entries(COMMENT_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});
