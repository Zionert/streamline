import type { Express } from 'express';
import { pino } from 'pino';
import { inject } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config/env.js';
import { createDbClient, type DbClient } from '../repositories/db.js';

export const TEST_JWT_SECRET = 'test-access-secret-that-is-long-enough-0123456789';

/** Configuration for tests: fast bcrypt and rate limits high enough not to interfere. */
export function createTestConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('testDatabaseUrl'),
    JWT_ACCESS_SECRET: TEST_JWT_SECRET,
    BCRYPT_COST: '4',
    AUTH_RATE_LIMIT_MAX: '10000',
    AUTH_CREDENTIALS_RATE_LIMIT_MAX: '10000',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export function createTestDb(): DbClient {
  return createDbClient(inject('testDatabaseUrl'));
}

export function buildTestApp(db: DbClient, overrides: Partial<NodeJS.ProcessEnv> = {}): Express {
  return createApp({ config: createTestConfig(overrides), logger: pino({ level: 'silent' }), db });
}

/** Removes all rows from application tables (the migrations table is kept). */
export async function resetDatabase(db: DbClient): Promise<void> {
  await db.$executeRawUnsafe('TRUNCATE TABLE "RefreshToken", "User" RESTART IDENTITY CASCADE');
}
