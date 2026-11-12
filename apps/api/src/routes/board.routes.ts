import { Router, type RequestHandler } from 'express';

import { createBoardController } from '../controllers/board.controller.js';
import type { RequireBoardPermission } from '../middleware/require-board-permission.js';
import type { BoardService } from '../services/board.service.js';
import { createCardRouter, type CardRouterDependencies } from './card.routes.js';
import { createColumnRouter, type ColumnRouterDependencies } from './column.routes.js';

export interface BoardRouterDependencies extends ColumnRouterDependencies, CardRouterDependencies {
  boardService: BoardService;
  requireAuth: RequestHandler;
  requireBoardPermission: RequireBoardPermission;
}

export function createBoardRouter({
  boardService,
  columnService,
  cardService,
  requireAuth,
  requireBoardPermission: can,
}: BoardRouterDependencies): Router {
  const controller = createBoardController(boardService);

  const router = Router();
  router.use(requireAuth);

  router.get('/', controller.list);
  router.post('/', controller.create);

  router.get('/:boardId', can('board:view'), controller.get);
  // Name and key; changing the key changes the keys of all cards of the board.
  router.patch('/:boardId', can('board:rename'), controller.update);
  router.delete('/:boardId', can('board:delete'), controller.remove);

  router.get('/:boardId/members', can('board:view'), controller.listMembers);
  router.post('/:boardId/members', can('members:manage'), controller.addMember);
  router.patch('/:boardId/members/:userId', can('members:manage'), controller.updateMember);
  // Any member may leave the board; removing someone else is checked in the service.
  router.delete('/:boardId/members/:userId', can('board:view'), controller.removeMember);

  router.use(
    '/:boardId/columns',
    createColumnRouter({ columnService, requireBoardPermission: can }),
  );
  router.use('/:boardId/cards', createCardRouter({ cardService, requireBoardPermission: can }));

  return router;
}
