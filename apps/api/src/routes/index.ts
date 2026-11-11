import { Router } from 'express';

import { createHealthRouter } from './health.routes.js';

export function createRouter(): Router {
  const router = Router();
  router.use('/health', createHealthRouter());
  return router;
}
