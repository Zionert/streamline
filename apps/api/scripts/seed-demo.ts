/**
 * Seeds the demo board for presentations: `pnpm db:seed:demo` (from the repository root).
 * Uses DATABASE_URL and BCRYPT_COST from apps/api/.env; DEMO_PASSWORD overrides the default
 * password of the demo accounts. Refuses to run with NODE_ENV=production.
 */
import { existsSync } from 'node:fs';

import { loadConfig } from '../src/config/env.js';
import { DEFAULT_DEMO_PASSWORD, assertDemoSeedAllowed, seedDemo } from '../src/demo/seed-demo.js';
import { createDbClient } from '../src/repositories/db.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

async function main(): Promise<void> {
  assertDemoSeedAllowed(process.env);
  const config = loadConfig();
  assertDemoSeedAllowed({ NODE_ENV: config.NODE_ENV });

  const db = createDbClient(config.DATABASE_URL);
  try {
    // An empty or whitespace-only value counts as unset.
    const customPassword = process.env.DEMO_PASSWORD?.trim()
      ? process.env.DEMO_PASSWORD
      : undefined;
    const result = await seedDemo(db, {
      password: customPassword ?? DEFAULT_DEMO_PASSWORD,
      bcryptCost: config.BCRYPT_COST,
    });
    console.info(
      [
        `Demo board "${result.boardKey}" created with ${String(result.cardCount)} cards and ${String(result.transitionCount)} transitions` +
          (result.replacedBoards > 0 ? ' (previous demo board replaced).' : '.'),
        `Log in as:  ${result.email}`,
        // A password from the environment is never echoed.
        customPassword === undefined
          ? `Password:   ${result.password} (default; set DEMO_PASSWORD to change)`
          : 'Password:   the value of DEMO_PASSWORD',
        `Board:      /boards/${result.boardId}`,
        `Note: the name and password of existing *@streamline.local demo accounts were reset.`,
      ].join('\n'),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
