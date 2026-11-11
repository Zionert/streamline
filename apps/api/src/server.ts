import { existsSync } from 'node:fs';

import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDbClient } from './repositories/db.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const config = loadConfig();
const logger = createLogger(config);
const db = createDbClient(config.DATABASE_URL);
const app = createApp({ config, logger, db });

const server = app.listen(config.PORT, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, 'Failed to start HTTP server');
    process.exit(1);
  }
  logger.info(`API listening on http://localhost:${config.PORT}`);
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    db.$disconnect()
      .catch((err: unknown) => {
        logger.error({ err }, 'Failed to disconnect from the database');
      })
      .finally(() => process.exit(0));
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
