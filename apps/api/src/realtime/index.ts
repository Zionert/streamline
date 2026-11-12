import type { Server as HttpServer } from 'node:http';

import type { Logger } from 'pino';

import type { AppConfig } from '../config/env.js';
import { createBoardMemberRepository } from '../repositories/board-member.repository.js';
import type { DbClient } from '../repositories/db.js';
import { createUserRepository } from '../repositories/user.repository.js';
import { createBoardAccessService } from '../services/board-access.service.js';
import { createTokenService } from '../services/token.service.js';
import { attachRealtime, type Realtime } from './socket-server.js';

export type { Realtime } from './socket-server.js';

export interface RealtimeWiring {
  config: AppConfig;
  logger: Logger;
  db: DbClient;
}

/** Attaches the Socket.io server with its dependencies built from the configuration. */
export function createRealtime(
  httpServer: HttpServer,
  { config, logger, db }: RealtimeWiring,
): Realtime {
  return attachRealtime(httpServer, {
    config,
    logger,
    tokens: createTokenService(config),
    boardAccess: createBoardAccessService({ members: createBoardMemberRepository(db) }),
    users: createUserRepository(db),
  });
}
