import { Router } from 'express';

import { createAiRouter, type AiRouterDependencies } from './ai.routes.js';
import { createAuthRouter, type AuthRouterDependencies } from './auth.routes.js';
import { createBoardRouter, type BoardRouterDependencies } from './board.routes.js';
import { createHealthRouter } from './health.routes.js';

export type RouterDependencies = AuthRouterDependencies &
  BoardRouterDependencies &
  AiRouterDependencies;

export function createRouter(deps: RouterDependencies): Router {
  const router = Router();
  router.use('/health', createHealthRouter());
  router.use('/auth', createAuthRouter(deps));
  router.use('/boards', createBoardRouter(deps));
  router.use('/ai', createAiRouter(deps));
  return router;
}
