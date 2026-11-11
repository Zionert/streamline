import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import type { AppConfig } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { createRequireAuth } from './middleware/require-auth.js';
import { createRequireBoardPermission } from './middleware/require-board-permission.js';
import { createBoardMemberRepository } from './repositories/board-member.repository.js';
import { createBoardRepository } from './repositories/board.repository.js';
import type { DbClient } from './repositories/db.js';
import { createRefreshTokenRepository } from './repositories/refresh-token.repository.js';
import { createUserRepository } from './repositories/user.repository.js';
import { createRouter } from './routes/index.js';
import { createAuthService } from './services/auth.service.js';
import { createBoardAccessService } from './services/board-access.service.js';
import { createBoardService } from './services/board.service.js';
import { createPasswordHasher } from './services/password.service.js';
import { createTokenService } from './services/token.service.js';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  db: DbClient;
}

/** Builds the Express application (wiring repositories and services) without starting the server. */
export function createApp({ config, logger, db }: AppDependencies): Express {
  const tokens = createTokenService(config);
  const users = createUserRepository(db);
  const boardMembers = createBoardMemberRepository(db);

  const authService = createAuthService({
    users,
    refreshTokens: createRefreshTokenRepository(db),
    passwords: createPasswordHasher(config.BCRYPT_COST),
    tokens,
    logger,
    refreshReuseGraceSeconds: config.REFRESH_REUSE_GRACE_SECONDS,
  });
  const boardService = createBoardService({
    boards: createBoardRepository(db),
    members: boardMembers,
    users,
  });
  const boardAccess = createBoardAccessService({ members: boardMembers });

  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    createRouter({
      authService,
      boardService,
      requireAuth: createRequireAuth(tokens),
      requireBoardPermission: createRequireBoardPermission(boardAccess),
      config,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
