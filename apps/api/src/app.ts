import type { RandomSource } from '@streamline/shared';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import type { LlmProvider } from './ai/llm-provider.js';
import type { AppConfig } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { createRequireAuth } from './middleware/require-auth.js';
import { createRequireBoardPermission } from './middleware/require-board-permission.js';
import { noopBoardEvents, type BoardEvents } from './realtime/board-events.js';
import { createAiConversationRepository } from './repositories/ai-conversation.repository.js';
import { createAiUsageRepository } from './repositories/ai-usage.repository.js';
import { createActivityRepository } from './repositories/activity.repository.js';
import { createAnalyticsRepository } from './repositories/analytics.repository.js';
import { createBoardMemberRepository } from './repositories/board-member.repository.js';
import { createBoardRepository } from './repositories/board.repository.js';
import { createCardRepository } from './repositories/card.repository.js';
import { createColumnRepository } from './repositories/column.repository.js';
import { createCommentRepository } from './repositories/comment.repository.js';
import type { DbClient } from './repositories/db.js';
import { createLabelRepository } from './repositories/label.repository.js';
import { createRefreshTokenRepository } from './repositories/refresh-token.repository.js';
import { createUserRepository } from './repositories/user.repository.js';
import { createRouter } from './routes/index.js';
import { createActivityService } from './services/activity.service.js';
import { createAiChatService } from './services/ai-chat.service.js';
import { createAiConversationService } from './services/ai-conversation.service.js';
import { createBoardTools } from './services/ai-tools/board-tools.js';
import { createAnalyticsService } from './services/analytics.service.js';
import { createAuthService } from './services/auth.service.js';
import { createBoardAccessService } from './services/board-access.service.js';
import { createBoardService } from './services/board.service.js';
import { createCardService } from './services/card.service.js';
import { createColumnService } from './services/column.service.js';
import { createCommentService } from './services/comment.service.js';
import { createLabelService } from './services/label.service.js';
import { createPasswordHasher } from './services/password.service.js';
import { createTokenService } from './services/token.service.js';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  db: DbClient;
  /**
   * Model provider of the AI assistant (for the assistant's routes); `null` or absent while the
   * assistant is disabled. Tests inject a `MockLlmProvider`.
   */
  llm?: LlmProvider | null;
}

export interface CreateAppOptions extends AppDependencies {
  /** Broadcasts committed board changes (no-op without a socket server, e.g. in REST tests). */
  events?: BoardEvents;
  /** Current time used by the analytics ("today", age of cards); tests pass a fixed clock. */
  now?: () => Date;
  /** Random source of the Monte Carlo forecast (`Math.random`); tests pass a seeded one. */
  random?: RandomSource;
}

/** Builds the Express application (wiring repositories and services) without starting the server. */
export function createApp({
  config,
  logger,
  db,
  llm = null,
  events = noopBoardEvents,
  now = () => new Date(),
  random = Math.random,
}: CreateAppOptions): Express {
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
    events,
  });
  const boardAccess = createBoardAccessService({ members: boardMembers });
  const columnService = createColumnService({ columns: createColumnRepository(db), events });
  const cardService = createCardService({ cards: createCardRepository(db), events });
  const labelService = createLabelService({ labels: createLabelRepository(db), events });
  const commentService = createCommentService({ comments: createCommentRepository(db), events });
  const activityService = createActivityService({ activities: createActivityRepository(db) });
  const analyticsService = createAnalyticsService({
    analytics: createAnalyticsRepository(db),
    now,
    random,
  });
  const aiConversations = createAiConversationRepository(db);
  const aiConversationService = createAiConversationService({
    conversations: aiConversations,
    boardAccess,
  });
  const aiChatService =
    config.AI_ENABLED && llm
      ? createAiChatService({
          llm,
          conversations: aiConversations,
          usage: createAiUsageRepository(db),
          boardAccess,
          boardService,
          tools: createBoardTools({
            boardService,
            columnService,
            cardService,
            labelService,
            commentService,
            analyticsService,
          }),
          logger,
          now,
          limits: {
            requests: config.AI_DAILY_REQUEST_LIMIT,
            tokens: config.AI_DAILY_TOKEN_LIMIT,
          },
          contextTokens: config.LLM_CONTEXT_TOKENS,
        })
      : null;

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
      columnService,
      cardService,
      labelService,
      commentService,
      activityService,
      analyticsService,
      aiConversationService,
      aiChatService,
      aiStatus: {
        enabled: config.AI_ENABLED,
        model: config.AI_ENABLED ? (config.LLM_MODEL ?? null) : null,
      },
      requireAuth: createRequireAuth(tokens),
      requireBoardPermission: createRequireBoardPermission(boardAccess),
      config,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
