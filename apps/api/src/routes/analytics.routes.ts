import { Router } from 'express';

import { createAnalyticsController } from '../controllers/analytics.controller.js';
import type { RequireBoardPermission } from '../middleware/require-board-permission.js';
import type { AnalyticsService } from '../services/analytics.service.js';

export interface AnalyticsRouterDependencies {
  analyticsService: AnalyticsService;
  requireBoardPermission: RequireBoardPermission;
}

/** Routes under `/boards/:boardId/analytics`; read-only, so every member may use them. */
export function createAnalyticsRouter({
  analyticsService,
  requireBoardPermission: can,
}: AnalyticsRouterDependencies): Router {
  const controller = createAnalyticsController(analyticsService);

  const router = Router({ mergeParams: true });

  router.get('/', can('board:view'), controller.get);
  router.get('/forecast', can('board:view'), controller.forecast);

  return router;
}
