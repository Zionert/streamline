import { Router } from 'express';

import { createCardController } from '../controllers/card.controller.js';
import type { RequireBoardPermission } from '../middleware/require-board-permission.js';
import type { CardService } from '../services/card.service.js';

export interface CardRouterDependencies {
  cardService: CardService;
  requireBoardPermission: RequireBoardPermission;
}

/**
 * Routes under `/boards/:boardId/cards`. Mounted by the board router, which has already
 * applied `requireAuth`; `mergeParams` exposes `:boardId` to the permission guard.
 * Cards are read by key (`SL-12`) and changed by id.
 */
export function createCardRouter({
  cardService,
  requireBoardPermission: can,
}: CardRouterDependencies): Router {
  const controller = createCardController(cardService);

  const router = Router({ mergeParams: true });

  router.get('/', can('board:view'), controller.list);
  router.post('/', can('card:write'), controller.create);
  router.get('/:cardKey', can('board:view'), controller.getByKey);
  router.patch('/:cardId', can('card:write'), controller.update);
  router.patch('/:cardId/move', can('card:write'), controller.move);
  router.delete('/:cardId', can('card:write'), controller.remove);

  return router;
}
