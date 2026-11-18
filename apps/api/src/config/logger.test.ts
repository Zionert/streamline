import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, destination);
  return { logger, output: () => lines.join('') };
}

describe('createLogger', () => {
  it('redacts credentials from request and response headers', () => {
    const { logger, output } = captureLogger();

    logger.info({
      req: { headers: { authorization: 'Bearer secret-jwt', cookie: 'refresh_token=secret-rt' } },
      res: { headers: { 'set-cookie': 'refresh_token=secret-rt-2' } },
    });

    expect(output()).not.toMatch(/secret-jwt|secret-rt/);
    expect(output()).toContain('[REDACTED]');
  });

  it('redacts passwords and tokens in logged objects', () => {
    const { logger, output } = captureLogger();

    logger.info({ body: { password: 'hunter22', accessToken: 'jwt', refreshToken: 'rt' } });

    expect(output()).not.toMatch(/hunter22|"jwt"|"rt"/);
  });

  it('redacts the model provider API key', () => {
    const { logger, output } = captureLogger();

    logger.info({ LLM_API_KEY: 'sk-top-level' });
    logger.info({
      config: { LLM_API_KEY: 'sk-in-config' },
      provider: { apiKey: 'sk-in-provider' },
    });
    logger.info({ llm: { options: { apiKey: 'sk-in-options' } } });

    expect(output()).not.toMatch(/sk-top-level|sk-in-config|sk-in-provider|sk-in-options/);
  });
});
