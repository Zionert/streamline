import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const API_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Resolves the connection string of the integration-test database.
 *
 * 1. `DATABASE_URL_TEST` from the environment (used in CI), or
 * 2. `DATABASE_URL` from `apps/api/.env` with `_test` appended to the database name.
 *
 * Refuses any database whose name does not end with `_test`, so tests can never truncate
 * the development database.
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  let raw = env.DATABASE_URL_TEST;

  if (!raw) {
    const envFile = path.join(API_ROOT, '.env');
    const devUrl = existsSync(envFile)
      ? parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL
      : undefined;
    if (!devUrl) {
      throw new Error(
        'Integration tests need DATABASE_URL_TEST or DATABASE_URL in apps/api/.env to derive it from.',
      );
    }
    const derived = new URL(devUrl);
    const dbName = derived.pathname.replace(/^\//, '');
    derived.pathname = `/${dbName.endsWith('_test') ? dbName : `${dbName}_test`}`;
    raw = derived.toString();
  }

  const dbName = new URL(raw).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${dbName}" (name must end with _test).`,
    );
  }
  return raw;
}
