import { pino, type Logger } from 'pino';

import type { AppConfig } from './env.js';

export function createLogger(config: Pick<AppConfig, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  });
}
