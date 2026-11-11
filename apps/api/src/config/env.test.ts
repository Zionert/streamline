import { describe, expect, it } from 'vitest';

import { loadConfig } from './env.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
const JWT_ACCESS_SECRET = 'a'.repeat(32);
const required = { DATABASE_URL, JWT_ACCESS_SECRET };

describe('loadConfig', () => {
  it('applies defaults when optional variables are missing', () => {
    const config = loadConfig(required);

    expect(config).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL,
      CORS_ORIGIN: ['http://localhost:5173'],
      LOG_LEVEL: 'info',
      JWT_ACCESS_SECRET,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_SECONDS: 604800,
      REFRESH_REUSE_GRACE_SECONDS: 30,
      REFRESH_COOKIE_PATH: '/api/auth',
      BCRYPT_COST: 12,
      AUTH_RATE_LIMIT_WINDOW_MS: 900000,
      AUTH_RATE_LIMIT_MAX: 100,
      AUTH_CREDENTIALS_RATE_LIMIT_MAX: 10,
    });
  });

  it('coerces PORT and splits a comma-separated CORS_ORIGIN', () => {
    const config = loadConfig({
      ...required,
      PORT: '8080',
      CORS_ORIGIN: 'http://localhost:5173, https://streamline.example',
    });

    expect(config.PORT).toBe(8080);
    expect(config.CORS_ORIGIN).toEqual(['http://localhost:5173', 'https://streamline.example']);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ JWT_ACCESS_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a PostgreSQL URL', () => {
    expect(() => loadConfig({ JWT_ACCESS_SECRET, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('throws when PORT is out of range', () => {
    expect(() => loadConfig({ ...required, PORT: '70000' })).toThrow(/PORT/);
  });

  it('throws when JWT_ACCESS_SECRET is missing or too short', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ DATABASE_URL, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('coerces token TTLs and rate limits from strings', () => {
    const config = loadConfig({
      ...required,
      ACCESS_TOKEN_TTL_SECONDS: '60',
      REFRESH_TOKEN_TTL_SECONDS: '120',
      AUTH_RATE_LIMIT_MAX: '5',
      AUTH_CREDENTIALS_RATE_LIMIT_MAX: '2',
    });

    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(60);
    expect(config.REFRESH_TOKEN_TTL_SECONDS).toBe(120);
    expect(config.AUTH_RATE_LIMIT_MAX).toBe(5);
    expect(config.AUTH_CREDENTIALS_RATE_LIMIT_MAX).toBe(2);
  });

  it('validates REFRESH_REUSE_GRACE_SECONDS', () => {
    expect(
      loadConfig({ ...required, REFRESH_REUSE_GRACE_SECONDS: '0' }).REFRESH_REUSE_GRACE_SECONDS,
    ).toBe(0);
    expect(() => loadConfig({ ...required, REFRESH_REUSE_GRACE_SECONDS: '-1' })).toThrow(
      /REFRESH_REUSE_GRACE_SECONDS/,
    );
  });

  it('allows a low BCRYPT_COST outside production', () => {
    expect(loadConfig({ ...required, NODE_ENV: 'test', BCRYPT_COST: '4' }).BCRYPT_COST).toBe(4);
  });

  it('rejects a BCRYPT_COST below 12 in production', () => {
    expect(() => loadConfig({ ...required, NODE_ENV: 'production', BCRYPT_COST: '10' })).toThrow(
      /BCRYPT_COST/,
    );
  });

  it('rejects a REFRESH_COOKIE_PATH that is not absolute', () => {
    expect(() => loadConfig({ ...required, REFRESH_COOKIE_PATH: 'auth' })).toThrow(
      /REFRESH_COOKIE_PATH/,
    );
  });
});
