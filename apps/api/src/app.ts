import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import type { AppConfig } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { createRouter } from './routes/index.js';

export interface AppDependencies {
  config: Pick<AppConfig, 'CORS_ORIGIN'>;
  logger: Logger;
}

/** Builds the Express application without starting the HTTP server. */
export function createApp({ config, logger }: AppDependencies): Express {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.use(createRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
