import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { AppConfig } from './env.js';

/** Credentials that must never reach the logs (pino-http logs request and response headers). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
];

/**
 * Creates the application logger. A custom destination is used by tests; otherwise logs go
 * to stdout (pretty-printed in development).
 */
export function createLogger(
  config: Pick<AppConfig, 'NODE_ENV' | 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
  };

  if (destination) {
    return pino(options, destination);
  }
  if (config.NODE_ENV === 'development') {
    return pino({
      ...options,
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
  }
  return pino(options);
}
