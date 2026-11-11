import { Router, type RequestHandler } from 'express';

import type { AppConfig } from '../config/env.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import type { AuthService } from '../services/auth.service.js';

export type AuthRouterConfig = Pick<
  AppConfig,
  | 'NODE_ENV'
  | 'REFRESH_COOKIE_PATH'
  | 'REFRESH_TOKEN_TTL_SECONDS'
  | 'AUTH_RATE_LIMIT_WINDOW_MS'
  | 'AUTH_RATE_LIMIT_MAX'
  | 'AUTH_CREDENTIALS_RATE_LIMIT_MAX'
>;

export interface AuthRouterDependencies {
  authService: AuthService;
  requireAuth: RequestHandler;
  config: AuthRouterConfig;
}

export function createAuthRouter({
  authService,
  requireAuth,
  config,
}: AuthRouterDependencies): Router {
  const controller = createAuthController(authService, config);

  const authLimiter = createRateLimiter({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: config.AUTH_RATE_LIMIT_MAX,
  });
  // Shared by login and register; only failed attempts count, so legitimate users are not blocked.
  const credentialsLimiter = createRateLimiter({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: config.AUTH_CREDENTIALS_RATE_LIMIT_MAX,
    skipSuccessfulRequests: true,
  });

  const router = Router();
  router.use(authLimiter);
  router.post('/register', credentialsLimiter, controller.register);
  router.post('/login', credentialsLimiter, controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth, controller.me);
  return router;
}
