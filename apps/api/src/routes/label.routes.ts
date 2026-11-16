import { Router } from 'express';

import { createLabelController } from '../controllers/label.controller.js';
import type { RequireBoardPermission } from '../middleware/require-board-permission.js';
import type { LabelService } from '../services/label.service.js';

export interface LabelRouterDependencies {
  labelService: LabelService;
  requireBoardPermission: RequireBoardPermission;
}

/** Routes under `/boards/:boardId/labels`; managing labels is part of editing cards. */
export function createLabelRouter({
  labelService,
  requireBoardPermission: can,
}: LabelRouterDependencies): Router {
  const controller = createLabelController(labelService);

  const router = Router({ mergeParams: true });

  router.get('/', can('board:view'), controller.list);
  router.post('/', can('card:write'), controller.create);
  router.patch('/:labelId', can('card:write'), controller.update);
  // Also removes the label from every card of the board.
  router.delete('/:labelId', can('card:write'), controller.remove);

  return router;
}
