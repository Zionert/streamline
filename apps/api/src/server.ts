import { existsSync } from 'node:fs';

import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDbClient } from './repositories/db.js';
import { createStreamLineServer } from './server-factory.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const config = loadConfig();
const logger = createLogger(config);
const db = createDbClient(config.DATABASE_URL);
const { httpServer, realtime } = createStreamLineServer({ config, logger, db });

httpServer.once('error', (error) => {
  logger.fatal({ err: error }, 'Failed to start HTTP server');
  process.exit(1);
});
httpServer.listen(config.PORT, () => {
  logger.info(`API listening on http://localhost:${config.PORT}`);
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');
  // Closes the sockets and then the HTTP server.
  void realtime.close().finally(() => {
    db.$disconnect()
      .catch((err: unknown) => {
        logger.error({ err }, 'Failed to disconnect from the database');
      })
      .finally(() => process.exit(0));
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
