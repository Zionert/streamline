import { Router } from 'express';

import { createAuthRouter, type AuthRouterDependencies } from './auth.routes.js';
import { createHealthRouter } from './health.routes.js';

export type RouterDependencies = AuthRouterDependencies;

export function createRouter(deps: RouterDependencies): Router {
  const router = Router();
  router.use('/health', createHealthRouter());
  router.use('/auth', createAuthRouter(deps));
  return router;
}
