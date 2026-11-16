import {
  commentListQuerySchema,
  COMMENT_ERROR_CODES,
  createCommentSchema,
  updateCommentSchema,
  type CommentListResponse,
  type CommentResponse,
} from '@streamline/shared';
import type { Request, Response } from 'express';

import { NotFoundError } from '../errors/app-error.js';
import { getBoardMembership } from '../middleware/require-board-permission.js';
import { CARD_NOT_FOUND_MESSAGE } from '../services/card.service.js';
import { COMMENT_NOT_FOUND_MESSAGE, type CommentService } from '../services/comment.service.js';
import { changeOrigin } from './change-origin.js';
import { routeParam } from './params.js';

const cardId = (req: Request): string =>
  routeParam(req, 'cardId', () => new NotFoundError(CARD_NOT_FOUND_MESSAGE));

const commentId = (req: Request): string =>
  routeParam(
    req,
    'commentId',
    () => new NotFoundError(COMMENT_NOT_FOUND_MESSAGE, COMMENT_ERROR_CODES.COMMENT_NOT_FOUND),
  );

export function createCommentController(commentService: CommentService) {
  return {
    list: async (req: Request, res: Response<CommentListResponse>): Promise<void> => {
      const query = commentListQuerySchema.parse(req.query);
      const page = await commentService.list(getBoardMembership(res), cardId(req), query);
      res.json({ comments: page.items, nextCursor: page.nextCursor });
    },

    create: async (req: Request, res: Response<CommentResponse>): Promise<void> => {
      const input = createCommentSchema.parse(req.body);
      const comment = await commentService.create(
        getBoardMembership(res),
        cardId(req),
        input,
        changeOrigin(req),
      );
      res.status(201).json({ comment });
    },

    update: async (req: Request, res: Response<CommentResponse>): Promise<void> => {
      const input = updateCommentSchema.parse(req.body);
      const comment = await commentService.update(
        getBoardMembership(res),
        cardId(req),
        commentId(req),
        input,
        changeOrigin(req),
      );
      res.json({ comment });
    },

    remove: async (req: Request, res: Response): Promise<void> => {
      await commentService.delete(
        getBoardMembership(res),
        cardId(req),
        commentId(req),
        changeOrigin(req),
      );
      res.status(204).end();
    },
  };
}

export type CommentController = ReturnType<typeof createCommentController>;
