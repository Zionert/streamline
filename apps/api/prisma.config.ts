import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// Prisma CLI does not load .env automatically; use Node's built-in loader for local development.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // A missing DATABASE_URL is only fatal for commands that connect to the database
    // (migrate, studio); `prisma generate` works without it.
    url: process.env.DATABASE_URL ?? '',
  },
});
