import { describe, expect, it } from 'vitest';

import { loadConfig } from './env.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

describe('loadConfig', () => {
  it('applies defaults when optional variables are missing', () => {
    const config = loadConfig({ DATABASE_URL });

    expect(config).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL,
      CORS_ORIGIN: ['http://localhost:5173'],
      LOG_LEVEL: 'info',
    });
  });

  it('coerces PORT and splits a comma-separated CORS_ORIGIN', () => {
    const config = loadConfig({
      DATABASE_URL,
      PORT: '8080',
      CORS_ORIGIN: 'http://localhost:5173, https://streamline.example',
    });

    expect(config.PORT).toBe(8080);
    expect(config.CORS_ORIGIN).toEqual(['http://localhost:5173', 'https://streamline.example']);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a PostgreSQL URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('throws when PORT is out of range', () => {
    expect(() => loadConfig({ DATABASE_URL, PORT: '70000' })).toThrow(/PORT/);
  });
});
