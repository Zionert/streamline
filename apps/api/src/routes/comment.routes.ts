import { Router } from 'express';

import { createCommentController } from '../controllers/comment.controller.js';
import type { RequireBoardPermission } from '../middleware/require-board-permission.js';
import type { CommentService } from '../services/comment.service.js';

export interface CommentRouterDependencies {
  commentService: CommentService;
  requireBoardPermission: RequireBoardPermission;
}

/**
 * Routes under `/boards/:boardId/cards/:cardId/comments` (`mergeParams` exposes both ids).
 * Editing (author only) and deleting (author or manager) are further checked in the service.
 */
export function createCommentRouter({
  commentService,
  requireBoardPermission: can,
}: CommentRouterDependencies): Router {
  const controller = createCommentController(commentService);

  const router = Router({ mergeParams: true });

  router.get('/', can('board:view'), controller.list);
  router.post('/', can('card:write'), controller.create);
  router.patch('/:commentId', can('card:write'), controller.update);
  router.delete('/:commentId', can('card:write'), controller.remove);

  return router;
}
