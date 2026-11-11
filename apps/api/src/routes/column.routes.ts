import { Router } from 'express';

import { createColumnController } from '../controllers/column.controller.js';
import type { RequireBoardPermission } from '../middleware/require-board-permission.js';
import type { ColumnService } from '../services/column.service.js';

export interface ColumnRouterDependencies {
  columnService: ColumnService;
  requireBoardPermission: RequireBoardPermission;
}

/**
 * Routes under `/boards/:boardId/columns`. Mounted by the board router, which has already
 * applied `requireAuth`; `mergeParams` exposes `:boardId` to the permission guard.
 */
export function createColumnRouter({
  columnService,
  requireBoardPermission: can,
}: ColumnRouterDependencies): Router {
  const controller = createColumnController(columnService);

  const router = Router({ mergeParams: true });

  router.get('/', can('board:view'), controller.list);
  router.post('/', can('column:write'), controller.create);
  router.patch('/:columnId', can('column:write'), controller.rename);
  router.patch('/:columnId/move', can('column:write'), controller.move);
  router.patch('/:columnId/settings', can('column:settings'), controller.updateSettings);
  router.delete('/:columnId', can('column:write'), controller.remove);

  return router;
}
