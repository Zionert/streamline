import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import type { TestProject } from 'vitest/node';

import { API_ROOT, resolveTestDatabaseUrl } from './test-database.js';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/** Creates the test database if needed and applies all migrations before any test runs. */
export default function setup(project: TestProject): void {
  const databaseUrl = resolveTestDatabaseUrl();
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  project.provide('testDatabaseUrl', databaseUrl);
}
