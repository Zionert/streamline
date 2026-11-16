import { Router } from 'express';

import { createActivityController } from '../controllers/activity.controller.js';
import { createCardController } from '../controllers/card.controller.js';
import type { RequireBoardPermission } from '../middleware/require-board-permission.js';
import type { ActivityService } from '../services/activity.service.js';
import type { CardService } from '../services/card.service.js';
import { createCommentRouter, type CommentRouterDependencies } from './comment.routes.js';

export interface CardRouterDependencies extends CommentRouterDependencies {
  cardService: CardService;
  activityService: ActivityService;
  requireBoardPermission: RequireBoardPermission;
}

/**
 * Routes under `/boards/:boardId/cards`. Mounted by the board router, which has already
 * applied `requireAuth`; `mergeParams` exposes `:boardId` to the permission guard.
 * Cards are read by key (`SL-12`) and changed by id.
 */
export function createCardRouter({
  cardService,
  activityService,
  commentService,
  requireBoardPermission: can,
}: CardRouterDependencies): Router {
  const controller = createCardController(cardService);
  const activity = createActivityController(activityService);

  const router = Router({ mergeParams: true });

  router.get('/', can('board:view'), controller.list);
  router.post('/', can('card:write'), controller.create);
  router.get('/:cardKey', can('board:view'), controller.getByKey);
  router.patch('/:cardId', can('card:write'), controller.update);
  router.patch('/:cardId/move', can('card:write'), controller.move);
  router.delete('/:cardId', can('card:write'), controller.remove);

  // Attaching and removing labels is idempotent; the label must belong to the same board.
  router.put('/:cardId/labels/:labelId', can('card:write'), controller.attachLabel);
  router.delete('/:cardId/labels/:labelId', can('card:write'), controller.detachLabel);

  router.get('/:cardId/activity', can('board:view'), activity.listForCard);
  router.use(
    '/:cardId/comments',
    createCommentRouter({ commentService, requireBoardPermission: can }),
  );

  return router;
}
